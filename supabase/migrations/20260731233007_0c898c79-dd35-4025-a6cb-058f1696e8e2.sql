grant select on public.system_audit_events, public.account_controls, public.app_settings, public.driver_vehicle_shifts to authenticated;
grant all on public.system_audit_events, public.account_controls, public.app_settings, public.driver_vehicle_shifts to service_role;

revoke all on function public.admin_list_users() from public, anon;
revoke all on function public.current_account_status() from public, anon;
revoke all on function public.admin_set_user_status(uuid,text,text) from public, anon;
revoke all on function public.admin_set_user_roles(uuid,public.app_role[]) from public, anon;
revoke all on function public.admin_update_setting(text,jsonb) from public, anon;
revoke all on function public.admin_list_settings() from public, anon;
revoke all on function public.admin_list_audit_events(integer) from public, anon;
revoke all on function public.driver_start_vehicle_shift(uuid,numeric,jsonb,text) from public, anon;
revoke all on function public.driver_end_vehicle_shift(uuid,numeric,jsonb,text,text) from public, anon;
revoke all on function public.driver_shift_dashboard() from public, anon;
revoke all on function public.admin_list_vehicle_shifts() from public, anon;

grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.current_account_status() to authenticated;
grant execute on function public.admin_set_user_status(uuid,text,text) to authenticated;
grant execute on function public.admin_set_user_roles(uuid,public.app_role[]) to authenticated;
grant execute on function public.admin_update_setting(text,jsonb) to authenticated;
grant execute on function public.admin_list_settings() to authenticated;
grant execute on function public.admin_list_audit_events(integer) to authenticated;
grant execute on function public.driver_start_vehicle_shift(uuid,numeric,jsonb,text) to authenticated;
grant execute on function public.driver_end_vehicle_shift(uuid,numeric,jsonb,text,text) to authenticated;
grant execute on function public.driver_shift_dashboard() to authenticated;
grant execute on function public.admin_list_vehicle_shifts() to authenticated;