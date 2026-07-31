-- phase5_driver_financial_role_boundary
-- Idempotent closeout: driver financial data boundary + role boundary.

-- ---------------------------------------------------------------
-- 1. Internal helpers
-- ---------------------------------------------------------------
create or replace function private.is_ride_driver(p_ride_id uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select exists (
    select 1 from public.rides r
    where r.id = p_ride_id and r.driver_id = p_user
  );
$$;
revoke all on function private.is_ride_driver(uuid, uuid) from public;
revoke all on function private.is_ride_driver(uuid, uuid) from anon;
grant execute on function private.is_ride_driver(uuid, uuid) to authenticated;
grant execute on function private.is_ride_driver(uuid, uuid) to service_role;

-- Safe, explicit driver projection. Never includes estimated_price,
-- pricing_version_id, estimate_snapshot or any financial column.
create or replace function private.driver_ride_projection(r public.rides)
returns jsonb
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select jsonb_build_object(
    'id', r.id,
    'status', r.status,
    'request_type', r.request_type,
    'scheduled_at', r.scheduled_at,
    'pickup_address', r.pickup_address,
    'destination_address', r.destination_address,
    'pickup_lat', r.pickup_lat,
    'pickup_lng', r.pickup_lng,
    'destination_lat', r.destination_lat,
    'destination_lng', r.destination_lng,
    'distance_km', r.distance_km,
    'actual_distance_km', r.actual_distance_km,
    'estimated_duration_seconds', r.estimated_duration_seconds,
    'actual_duration_seconds', r.actual_duration_seconds,
    'accepted_at', r.accepted_at,
    'driver_arrived_at', r.driver_arrived_at,
    'started_at', r.started_at,
    'completed_at', r.completed_at,
    'created_at', r.created_at,
    'updated_at', r.updated_at,
    'passenger_id', r.passenger_id,
    'driver_id', r.driver_id,
    'vehicle_id', r.vehicle_id,
    'route_version', r.route_version,
    'last_route_updated_at', r.last_route_updated_at,
    'service_booking_id', r.service_booking_id,
    'itinerary_item_id', r.itinerary_item_id,
    'leg_sequence', r.leg_sequence,
    'day_number', r.day_number
  );
$$;
revoke all on function private.driver_ride_projection(public.rides) from public;
revoke all on function private.driver_ride_projection(public.rides) from anon;
revoke all on function private.driver_ride_projection(public.rides) from authenticated;
grant execute on function private.driver_ride_projection(public.rides) to service_role;

create or replace function private.require_driver()
returns uuid
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not private.has_role(v_uid, 'driver') then
    raise exception 'Driver role required' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;
revoke all on function private.require_driver() from public;
revoke all on function private.require_driver() from anon;
revoke all on function private.require_driver() from authenticated;
grant execute on function private.require_driver() to service_role;

-- ---------------------------------------------------------------
-- 2. Protected driver ride projections
-- ---------------------------------------------------------------
create or replace function public.driver_rides(
  p_scope text default 'all',
  p_limit integer default 200
)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_uid uuid := private.require_driver();
begin
  return query
  select private.driver_ride_projection(r)
  from public.rides r
  where r.driver_id = v_uid
    and (
      (p_scope = 'all')
      or (p_scope = 'active'
          and r.status in ('accepted','driver_arriving','arrived','in_progress'))
      or (p_scope = 'upcoming' and r.status = 'accepted')
      or (p_scope = 'history' and r.status in ('completed','cancelled'))
    )
  order by coalesce(r.scheduled_at, r.created_at) desc
  limit greatest(1, least(coalesce(p_limit, 200), 500));
end;
$$;
revoke all on function public.driver_rides(text, integer) from public;
revoke all on function public.driver_rides(text, integer) from anon;
grant execute on function public.driver_rides(text, integer) to authenticated;

create or replace function public.driver_ride(p_ride_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_uid uuid := private.require_driver();
  v_row public.rides;
begin
  select * into v_row from public.rides
  where id = p_ride_id and driver_id = v_uid;
  if not found then
    return null;
  end if;
  return private.driver_ride_projection(v_row);
end;
$$;
revoke all on function public.driver_ride(uuid) from public;
revoke all on function public.driver_ride(uuid) from anon;
grant execute on function public.driver_ride(uuid) to authenticated;

-- ---------------------------------------------------------------
-- 3. Protected driver transitions (safe responses only)
-- ---------------------------------------------------------------
create or replace function public.driver_accept_ride(p_ride_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_uid uuid := private.require_driver();
  v_row public.rides;
  v_window constant interval := interval '30 minutes';
begin
  update public.rides
     set driver_id = v_uid,
         status = 'accepted',
         accepted_at = now()
   where id = p_ride_id
     and status = 'requested'
     and driver_id is null
  returning * into v_row;

  if not found then
    raise exception 'This ride was just taken by another driver';
  end if;

  insert into public.ride_status_events (ride_id, changed_by, previous_status, new_status)
  values (v_row.id, v_uid, 'requested', 'accepted');

  if v_row.request_type = 'scheduled'
     and v_row.scheduled_at is not null
     and v_row.scheduled_at - now() > v_window then
    return private.driver_ride_projection(v_row);
  end if;

  update public.rides set status = 'driver_arriving'
   where id = v_row.id and driver_id = v_uid
  returning * into v_row;

  insert into public.ride_status_events (ride_id, changed_by, previous_status, new_status)
  values (v_row.id, v_uid, 'accepted', 'driver_arriving');

  return private.driver_ride_projection(v_row);
end;
$$;
revoke all on function public.driver_accept_ride(uuid) from public;
revoke all on function public.driver_accept_ride(uuid) from anon;
grant execute on function public.driver_accept_ride(uuid) to authenticated;

create or replace function public.driver_start_scheduled_pickup(p_ride_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_uid uuid := private.require_driver();
  v_row public.rides;
  v_window constant interval := interval '30 minutes';
begin
  select * into v_row from public.rides
   where id = p_ride_id and driver_id = v_uid and status = 'accepted';
  if not found then
    raise exception 'Ride not found or not in accepted state';
  end if;

  if v_row.request_type = 'scheduled'
     and v_row.scheduled_at is not null
     and v_row.scheduled_at - now() > v_window then
    raise exception 'Pickup navigation opens 30 minutes before the scheduled time';
  end if;

  update public.rides set status = 'driver_arriving'
   where id = v_row.id and driver_id = v_uid and status = 'accepted'
  returning * into v_row;
  if not found then
    raise exception 'Could not start pickup navigation';
  end if;

  insert into public.ride_status_events (ride_id, changed_by, previous_status, new_status)
  values (v_row.id, v_uid, 'accepted', 'driver_arriving');

  return private.driver_ride_projection(v_row);
end;
$$;
revoke all on function public.driver_start_scheduled_pickup(uuid) from public;
revoke all on function public.driver_start_scheduled_pickup(uuid) from anon;
grant execute on function public.driver_start_scheduled_pickup(uuid) to authenticated;

create or replace function public.driver_mark_arrived(p_ride_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_uid uuid := private.require_driver();
  v_row public.rides;
begin
  update public.rides
     set status = 'arrived', driver_arrived_at = now()
   where id = p_ride_id and driver_id = v_uid
     and status in ('accepted','driver_arriving')
  returning * into v_row;
  if not found then
    raise exception 'Cannot mark arrived in current state';
  end if;

  insert into public.ride_status_events (ride_id, changed_by, previous_status, new_status)
  values (v_row.id, v_uid, 'driver_arriving', 'arrived');

  return private.driver_ride_projection(v_row);
end;
$$;
revoke all on function public.driver_mark_arrived(uuid) from public;
revoke all on function public.driver_mark_arrived(uuid) from anon;
grant execute on function public.driver_mark_arrived(uuid) to authenticated;

create or replace function public.driver_start_trip(p_ride_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_uid uuid := private.require_driver();
  v_row public.rides;
begin
  update public.rides
     set status = 'in_progress', started_at = now()
   where id = p_ride_id and driver_id = v_uid and status = 'arrived'
  returning * into v_row;
  if not found then
    raise exception 'Mark arrived before starting the trip';
  end if;

  insert into public.ride_status_events (ride_id, changed_by, previous_status, new_status)
  values (v_row.id, v_uid, 'arrived', 'in_progress');

  return private.driver_ride_projection(v_row);
end;
$$;
revoke all on function public.driver_start_trip(uuid) from public;
revoke all on function public.driver_start_trip(uuid) from anon;
grant execute on function public.driver_start_trip(uuid) to authenticated;

create or replace function public.driver_complete_trip(
  p_ride_id uuid,
  p_final_distance_km numeric default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_uid uuid := private.require_driver();
  v_row public.rides;
  v_seconds integer;
begin
  select * into v_row from public.rides where id = p_ride_id;
  if not found or v_row.driver_id is distinct from v_uid then
    raise exception 'Not authorized';
  end if;
  if v_row.status <> 'in_progress' then
    raise exception 'Trip is not in progress';
  end if;
  if p_final_distance_km is not null
     and (p_final_distance_km <= 0 or p_final_distance_km > 2000) then
    raise exception 'Invalid final distance';
  end if;

  v_seconds := case
    when v_row.started_at is null then null
    else greatest(0, extract(epoch from (now() - v_row.started_at))::integer)
  end;

  update public.rides
     set status = 'completed',
         completed_at = now(),
         actual_duration_seconds = v_seconds,
         actual_distance_km = coalesce(p_final_distance_km, v_row.distance_km)
   where id = v_row.id and driver_id = v_uid and status = 'in_progress'
  returning * into v_row;
  if not found then
    raise exception 'Could not complete trip';
  end if;

  insert into public.ride_status_events (ride_id, changed_by, previous_status, new_status)
  values (v_row.id, v_uid, 'in_progress', 'completed');

  return private.driver_ride_projection(v_row);
end;
$$;
revoke all on function public.driver_complete_trip(uuid, numeric) from public;
revoke all on function public.driver_complete_trip(uuid, numeric) from anon;
grant execute on function public.driver_complete_trip(uuid, numeric) to authenticated;

create or replace function public.driver_cancel_ride(p_ride_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_uid uuid := private.require_driver();
  v_row public.rides;
  v_prev text;
begin
  select * into v_row from public.rides
   where id = p_ride_id and driver_id = v_uid;
  if not found then
    raise exception 'Not authorized';
  end if;
  if v_row.status in ('completed','cancelled') then
    raise exception 'Ride is already finalised';
  end if;
  v_prev := v_row.status::text;

  update public.rides set status = 'cancelled'
   where id = v_row.id and driver_id = v_uid
  returning * into v_row;

  insert into public.ride_status_events (ride_id, changed_by, previous_status, new_status)
  values (v_row.id, v_uid, v_prev::ride_status, 'cancelled');

  return private.driver_ride_projection(v_row);
end;
$$;
revoke all on function public.driver_cancel_ride(uuid) from public;
revoke all on function public.driver_cancel_ride(uuid) from anon;
grant execute on function public.driver_cancel_ride(uuid) to authenticated;

-- ---------------------------------------------------------------
-- 4. Remove direct driver SELECT on rides
-- ---------------------------------------------------------------
drop policy if exists "driver sees assigned or open rides" on public.rides;

-- ---------------------------------------------------------------
-- 5. Keep driver-involved audit trails readable via scoped helper
-- ---------------------------------------------------------------
drop policy if exists "participants read status events" on public.ride_status_events;
create policy "participants read status events"
on public.ride_status_events
for select
to authenticated
using (
  private.has_role(auth.uid(), 'admin')
  or exists (
    select 1 from public.rides r
    where r.id = ride_status_events.ride_id and r.passenger_id = auth.uid()
  )
  or private.is_ride_driver(ride_status_events.ride_id, auth.uid())
);

drop policy if exists "participants read change log" on public.ride_change_log;
create policy "participants read change log"
on public.ride_change_log
for select
to authenticated
using (
  private.has_role(auth.uid(), 'admin')
  or exists (
    select 1 from public.rides r
    where r.id = ride_change_log.ride_id and r.passenger_id = auth.uid()
  )
  or private.is_ride_driver(ride_change_log.ride_id, auth.uid())
);

drop policy if exists "assigned driver acks change log" on public.ride_change_log;
create policy "assigned driver acks change log"
on public.ride_change_log
for update
to authenticated
using (private.is_ride_driver(ride_change_log.ride_id, auth.uid()))
with check (private.is_ride_driver(ride_change_log.ride_id, auth.uid()));

-- ---------------------------------------------------------------
-- 6. Payments: passenger + admin only
-- ---------------------------------------------------------------
drop policy if exists "involved sees payment" on public.payments;
create policy "involved sees payment"
on public.payments
for select
to authenticated
using (
  auth.uid() = passenger_id
  or private.has_role(auth.uid(), 'admin')
);

-- ---------------------------------------------------------------
-- 7. Driver profile writes require the driver role
-- ---------------------------------------------------------------
drop policy if exists "drivers manage own driver profile" on public.driver_profiles;
create policy "drivers insert own driver profile"
on public.driver_profiles
for insert
to authenticated
with check (auth.uid() = user_id and private.has_role(auth.uid(), 'driver'));

create policy "drivers update own driver profile"
on public.driver_profiles
for update
to authenticated
using (auth.uid() = user_id and private.has_role(auth.uid(), 'driver'))
with check (auth.uid() = user_id and private.has_role(auth.uid(), 'driver'));

create policy "drivers delete own driver profile"
on public.driver_profiles
for delete
to authenticated
using (auth.uid() = user_id and private.has_role(auth.uid(), 'driver'));

-- ---------------------------------------------------------------
-- 8. Reload PostgREST
-- ---------------------------------------------------------------
notify pgrst, 'reload schema';
