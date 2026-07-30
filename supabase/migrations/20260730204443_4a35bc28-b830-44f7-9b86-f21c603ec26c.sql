-- Phase 3 final privilege gate.
-- 20260730202734 granted EXECUTE on every non-trigger SECURITY DEFINER function
-- to `authenticated`, exposing internal mutation helpers to ordinary passengers
-- and drivers. Keep intended RPCs; lock internal helpers to service_role.
-- Internal calls from inside protected SECURITY DEFINER RPCs are unaffected.

DO $$
DECLARE fn record;
BEGIN
  FOR fn IN SELECT format('public.%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid)) AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prosecdef AND pg_get_function_result(p.oid)='trigger'
  LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn.sig); END LOOP;
END $$;

DO $$
DECLARE sig text; helpers text[] := ARRAY[
  'public.refresh_vehicle_assignment_compatibility(uuid, uuid)',
  'public.fleet_require_admin()',
  'public.vehicle_has_expired_mandatory_document(uuid, text, date)',
  'public.notify_approaching_scheduled_rides()'];
BEGIN
  FOREACH sig IN ARRAY helpers LOOP
    IF to_regprocedure(sig) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', sig);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', sig);
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE fn record;
BEGIN
  FOR fn IN SELECT format('public.%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid)) AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prosecdef AND pg_get_function_result(p.oid) <> 'trigger'
      AND (p.proname LIKE 'admin\_%' OR p.proname LIKE 'support\_%'
           OR p.proname IN ('verify_ride_start_pin','driver_current_vehicle_document_status'))
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', fn.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', fn.sig);
  END LOOP;
END $$;