
-- Revoke EXECUTE from public roles on all SECURITY DEFINER functions in public schema.
-- Trigger and helper functions don't need to be callable via the Data API.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_ride_created() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_ride_updated() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_review_submitted() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_ride_edited() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_approaching_scheduled_rides() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_profile_changes() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_ride_changes() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mint_ride_pin() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.generate_ride_pin() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.short_addr(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;

-- Intentional RPC entry points: revoke from anon + PUBLIC, keep authenticated.
-- Authorization is enforced inside each function body (admin role check / driver assignment check).
REVOKE EXECUTE ON FUNCTION public.verify_ride_start_pin(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_reset_ride_pin(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_view_ride_pin(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_acknowledge_pin_alert(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.verify_ride_start_pin(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_ride_pin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_view_ride_pin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_acknowledge_pin_alert(uuid) TO authenticated;
