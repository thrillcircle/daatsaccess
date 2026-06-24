-- Internal helpers: only the database (trigger / SECURITY DEFINER callers) needs these.
REVOKE EXECUTE ON FUNCTION public.generate_ride_pin() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mint_ride_pin()      FROM PUBLIC, anon, authenticated;

-- Public-facing SECURITY DEFINER entry points: keep authenticated, deny anon.
REVOKE EXECUTE ON FUNCTION public.verify_ride_start_pin(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_reset_ride_pin(uuid)        FROM PUBLIC, anon;
