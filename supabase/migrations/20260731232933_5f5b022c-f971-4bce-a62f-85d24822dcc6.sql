-- Access architecture closeout: users/roles, settings, vehicle shifts and audit logs.
-- All privileged changes are RPC-only and recorded in an immutable admin audit stream.

-- The project's role helper lives in the private schema; expose a thin, authenticated-only
-- wrapper so RLS policies below can evaluate it as the querying role.
create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path=public,private as $$
  select private.has_role(_user_id, _role);
$$;
revoke all on function public.has_role(uuid, public.app_role) from public, anon;
grant execute on function public.has_role(uuid, public.app_role) to authenticated, service_role;

create table if not exists public.system_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  module text not null,
  target_type text,
  target_id text,
  outcome text not null default 'success' check (outcome in ('success','failure')),
  before_data jsonb,
  after_data jsonb,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.system_audit_events enable row level security;
grant select on public.system_audit_events to authenticated;
grant all on public.system_audit_events to service_role;
drop policy if exists "admins read system audit events" on public.system_audit_events;
create policy "admins read system audit events" on public.system_audit_events
  for select to authenticated using (public.has_role(auth.uid(), 'admin'));

create table if not exists public.account_controls (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active','suspended')),
  reason text,
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now()
);
alter table public.account_controls enable row level security;
grant select on public.account_controls to authenticated;
grant all on public.account_controls to service_role;
drop policy if exists "users see own account control and admins see all" on public.account_controls;
create policy "users see own account control and admins see all" on public.account_controls
  for select to authenticated using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin'));

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  category text not null,
  description text,
  is_sensitive boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
grant select on public.app_settings to authenticated;
grant all on public.app_settings to service_role;
drop policy if exists "admins read non-secret settings" on public.app_settings;
create policy "admins read non-secret settings" on public.app_settings
  for select to authenticated using (public.has_role(auth.uid(), 'admin') and not is_sensitive);

insert into public.app_settings (key,value,category,description) values
  ('business.profile','{"name":"DAATS","publicName":"Access","phone":"011 395 5189","supportWhatsApp":"067 744 9729"}','business','Public business and support details'),
  ('branches.operating','[{"name":"Gauteng","active":true},{"name":"Cape Town","active":true}]','business','Active operating branches'),
  ('booking.rules','{"minimumNoticeHours":2,"allowReschedule":true,"allowCancellation":true}','booking','Booking behaviour'),
  ('notifications.preferences','{"email":true,"sms":false,"whatsapp":false,"push":true}','notifications','Enabled notification channels'),
  ('emergency.contacts','[]','safety','Administrator emergency escalation contacts'),
  ('privacy.retention','{"auditMonths":60,"locationDays":90}','privacy','Approved data-retention periods')
on conflict (key) do nothing;

create table if not exists public.driver_vehicle_shifts (
  id uuid primary key default gen_random_uuid(),
  driver_user_id uuid not null references auth.users(id) on delete restrict,
  vehicle_id uuid not null references public.vehicle_profiles(id) on delete restrict,
  status text not null default 'active' check (status in ('active','completed')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  start_odometer_km numeric(12,1) not null check (start_odometer_km >= 0),
  end_odometer_km numeric(12,1),
  start_checklist jsonb not null,
  end_checklist jsonb,
  start_notes text,
  end_notes text,
  handover_notes text,
  created_at timestamptz not null default now(),
  constraint shift_end_after_start check (ended_at is null or ended_at >= started_at),
  constraint shift_odometer_progress check (end_odometer_km is null or end_odometer_km >= start_odometer_km)
);
create unique index if not exists one_active_shift_per_driver on public.driver_vehicle_shifts(driver_user_id) where status='active';
create unique index if not exists one_active_shift_per_vehicle on public.driver_vehicle_shifts(vehicle_id) where status='active';
alter table public.driver_vehicle_shifts enable row level security;
grant select on public.driver_vehicle_shifts to authenticated;
grant all on public.driver_vehicle_shifts to service_role;
drop policy if exists "drivers see own shifts and admins see all" on public.driver_vehicle_shifts;
create policy "drivers see own shifts and admins see all" on public.driver_vehicle_shifts
  for select to authenticated using (driver_user_id=auth.uid() or public.has_role(auth.uid(),'admin'));

create or replace function public.write_system_audit(
  p_action text, p_module text, p_target_type text default null, p_target_id text default null,
  p_before jsonb default null, p_after jsonb default null, p_context jsonb default '{}'::jsonb
) returns void language sql security definer set search_path=public as $$
  insert into public.system_audit_events(actor_user_id,action,module,target_type,target_id,before_data,after_data,context)
  values(auth.uid(),p_action,p_module,p_target_type,p_target_id,p_before,p_after,coalesce(p_context,'{}'::jsonb));
$$;
revoke all on function public.write_system_audit(text,text,text,text,jsonb,jsonb,jsonb) from public, anon, authenticated;

create or replace function public.admin_list_users()
returns table(user_id uuid, full_name text, phone text, email text, roles public.app_role[], status text, created_at timestamptz)
language plpgsql security definer set search_path=public,auth as $$
begin
  if not public.has_role(auth.uid(),'admin') then raise exception 'Administrator access required'; end if;
  return query select u.id,p.full_name,p.phone,u.email::text,
    coalesce(array_agg(r.role order by r.role) filter(where r.role is not null),'{}'::public.app_role[]),
    coalesce(c.status,'active'),u.created_at
  from auth.users u left join public.profiles p on p.user_id=u.id
  left join public.user_roles r on r.user_id=u.id left join public.account_controls c on c.user_id=u.id
  group by u.id,p.full_name,p.phone,u.email,c.status,u.created_at order by u.created_at desc;
end $$;
grant execute on function public.admin_list_users() to authenticated;

create or replace function public.current_account_status()
returns text language sql stable security definer set search_path=public as $$
  select coalesce((select status from public.account_controls where user_id=auth.uid()),'active');
$$;
grant execute on function public.current_account_status() to authenticated;

create or replace function public.admin_set_user_status(p_user_id uuid,p_status text,p_reason text default null)
returns void language plpgsql security definer set search_path=public as $$
declare v_before jsonb; begin
  if not public.has_role(auth.uid(),'admin') then raise exception 'Administrator access required'; end if;
  if p_status not in ('active','suspended') then raise exception 'Invalid account status'; end if;
  if p_user_id=auth.uid() and p_status='suspended' then raise exception 'You cannot suspend your own administrator account'; end if;
  select to_jsonb(c) into v_before from public.account_controls c where user_id=p_user_id;
  insert into public.account_controls(user_id,status,reason,changed_by,changed_at)
  values(p_user_id,p_status,nullif(trim(p_reason),''),auth.uid(),now())
  on conflict(user_id) do update set status=excluded.status,reason=excluded.reason,changed_by=auth.uid(),changed_at=now();
  perform public.write_system_audit('account.status_changed','users','user',p_user_id::text,v_before,
    jsonb_build_object('status',p_status,'reason',p_reason));
end $$;
grant execute on function public.admin_set_user_status(uuid,text,text) to authenticated;

create or replace function public.admin_set_user_roles(p_user_id uuid,p_roles public.app_role[])
returns void language plpgsql security definer set search_path=public as $$
declare v_before jsonb; v_role public.app_role; v_admins integer; begin
  if not public.has_role(auth.uid(),'admin') then raise exception 'Administrator access required'; end if;
  if coalesce(array_length(p_roles,1),0)=0 then raise exception 'At least one role is required'; end if;
  select coalesce(jsonb_agg(role),'[]'::jsonb) into v_before from public.user_roles where user_id=p_user_id;
  if public.has_role(p_user_id,'admin') and not ('admin'=any(p_roles)) then
    select count(distinct user_id) into v_admins from public.user_roles where role='admin';
    if v_admins<=1 then raise exception 'The final administrator role cannot be removed'; end if;
  end if;
  delete from public.user_roles where user_id=p_user_id and not(role=any(p_roles));
  foreach v_role in array p_roles loop
    insert into public.user_roles(user_id,role) values(p_user_id,v_role) on conflict do nothing;
  end loop;
  perform public.write_system_audit('user.roles_changed','users','user',p_user_id::text,v_before,to_jsonb(p_roles));
end $$;
grant execute on function public.admin_set_user_roles(uuid,public.app_role[]) to authenticated;

create or replace function public.admin_update_setting(p_key text,p_value jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare v_before jsonb; begin
  if not public.has_role(auth.uid(),'admin') then raise exception 'Administrator access required'; end if;
  select value into v_before from public.app_settings where key=p_key and not is_sensitive for update;
  if not found then raise exception 'Setting is unavailable or sensitive'; end if;
  update public.app_settings set value=p_value,updated_by=auth.uid(),updated_at=now() where key=p_key;
  perform public.write_system_audit('setting.updated','settings','setting',p_key,v_before,p_value);
end $$;
grant execute on function public.admin_update_setting(text,jsonb) to authenticated;

create or replace function public.admin_list_settings()
returns jsonb language plpgsql security definer set search_path=public as $$
declare v jsonb; begin
  if not public.has_role(auth.uid(),'admin') then raise exception 'Administrator access required'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('key',key,'value',value,'category',category,
    'description',description,'updated_at',updated_at) order by category,key),'[]'::jsonb)
  into v from public.app_settings where not is_sensitive; return v;
end $$;
grant execute on function public.admin_list_settings() to authenticated;

create or replace function public.admin_list_audit_events(p_limit integer default 250)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v jsonb; begin
  if not public.has_role(auth.uid(),'admin') then raise exception 'Administrator access required'; end if;
  select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc),'[]'::jsonb) into v
  from (select * from public.system_audit_events order by created_at desc limit least(greatest(p_limit,1),1000)) e;
  return v;
end $$;
grant execute on function public.admin_list_audit_events(integer) to authenticated;

create or replace function public.driver_start_vehicle_shift(p_vehicle_id uuid,p_odometer numeric,p_checklist jsonb,p_notes text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid; begin
  if not public.has_role(auth.uid(),'driver') then raise exception 'Driver access required'; end if;
  if coalesce((p_checklist->>'brakes')::boolean,false)=false or coalesce((p_checklist->>'tyres')::boolean,false)=false
     or coalesce((p_checklist->>'lights')::boolean,false)=false or coalesce((p_checklist->>'wheelchairRestraints')::boolean,false)=false
     or coalesce((p_checklist->>'rampOrLift')::boolean,false)=false then
    raise exception 'Every critical safety item must pass before a shift can start';
  end if;
  if not exists(select 1 from public.vehicle_profiles where id=p_vehicle_id and status='active') then raise exception 'Vehicle is not active'; end if;
  if exists(select 1 from public.vehicle_driver_assignments a where a.driver_id=auth.uid() and a.vehicle_id=p_vehicle_id
    and a.status in ('active','scheduled') and a.start_at<=now() and (a.end_at is null or a.end_at>now())) is false then
    raise exception 'This vehicle is not currently assigned to you';
  end if;
  insert into public.driver_vehicle_shifts(driver_user_id,vehicle_id,start_odometer_km,start_checklist,start_notes)
  values(auth.uid(),p_vehicle_id,p_odometer,p_checklist,nullif(trim(p_notes),'')) returning id into v_id;
  perform public.write_system_audit('vehicle_shift.started','vehicle_shift','driver_vehicle_shift',v_id::text,null,
    jsonb_build_object('vehicleId',p_vehicle_id,'odometerKm',p_odometer)); return v_id;
end $$;
grant execute on function public.driver_start_vehicle_shift(uuid,numeric,jsonb,text) to authenticated;

create or replace function public.driver_end_vehicle_shift(p_shift_id uuid,p_odometer numeric,p_checklist jsonb,p_notes text default null,p_handover text default null)
returns void language plpgsql security definer set search_path=public as $$
declare v_shift public.driver_vehicle_shifts%rowtype; begin
  select * into v_shift from public.driver_vehicle_shifts where id=p_shift_id for update;
  if not found or (v_shift.driver_user_id<>auth.uid() and not public.has_role(auth.uid(),'admin')) then raise exception 'Shift not found'; end if;
  if v_shift.status<>'active' then raise exception 'Shift is already ended'; end if;
  if p_odometer<v_shift.start_odometer_km then raise exception 'Ending odometer cannot be lower than starting odometer'; end if;
  update public.driver_vehicle_shifts set status='completed',ended_at=now(),end_odometer_km=p_odometer,
    end_checklist=p_checklist,end_notes=nullif(trim(p_notes),''),handover_notes=nullif(trim(p_handover),'') where id=p_shift_id;
  perform public.write_system_audit('vehicle_shift.ended','vehicle_shift','driver_vehicle_shift',p_shift_id::text,
    jsonb_build_object('status','active'),jsonb_build_object('status','completed','odometerKm',p_odometer));
end $$;
grant execute on function public.driver_end_vehicle_shift(uuid,numeric,jsonb,text,text) to authenticated;

create or replace function public.driver_shift_dashboard()
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb; begin
  if not public.has_role(auth.uid(),'driver') and not public.has_role(auth.uid(),'admin') then raise exception 'Driver access required'; end if;
  select jsonb_build_object(
    'activeShift',(select to_jsonb(s) || jsonb_build_object('vehicle',to_jsonb(v)) from public.driver_vehicle_shifts s join public.vehicle_profiles v on v.id=s.vehicle_id where s.driver_user_id=auth.uid() and s.status='active' limit 1),
    'vehicles',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'vehicle_name',v.vehicle_name,'license_plate',v.license_plate,'make',v.make,'model',v.model))
      from public.vehicle_driver_assignments a join public.vehicle_profiles v on v.id=a.vehicle_id where a.driver_id=auth.uid() and v.status='active'
      and a.status in ('active','scheduled') and a.start_at<=now() and (a.end_at is null or a.end_at>now())),'[]'::jsonb),
    'history',coalesce((select jsonb_agg(to_jsonb(x) order by x.started_at desc) from (select * from public.driver_vehicle_shifts where driver_user_id=auth.uid() order by started_at desc limit 20)x),'[]'::jsonb)
  ) into v_result; return v_result;
end $$;
grant execute on function public.driver_shift_dashboard() to authenticated;

create or replace function public.admin_list_vehicle_shifts()
returns jsonb language plpgsql security definer set search_path=public as $$
declare v jsonb; begin if not public.has_role(auth.uid(),'admin') then raise exception 'Administrator access required'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'status',s.status,'driverUserId',s.driver_user_id,'driverName',p.full_name,
    'vehicleId',s.vehicle_id,'vehicleName',vp.vehicle_name,'licensePlate',vp.license_plate,'startedAt',s.started_at,'endedAt',s.ended_at,
    'startOdometerKm',s.start_odometer_km,'endOdometerKm',s.end_odometer_km,'startNotes',s.start_notes,'endNotes',s.end_notes,'handoverNotes',s.handover_notes)
    order by s.started_at desc),'[]'::jsonb) into v from public.driver_vehicle_shifts s left join public.profiles p on p.user_id=s.driver_user_id
    join public.vehicle_profiles vp on vp.id=s.vehicle_id; return v; end $$;
grant execute on function public.admin_list_vehicle_shifts() to authenticated;

-- Prevent browser clients from changing these protected records directly.
revoke insert,update,delete on public.system_audit_events,public.account_controls,public.app_settings,public.driver_vehicle_shifts from authenticated,anon;