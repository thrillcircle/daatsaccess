CREATE OR REPLACE FUNCTION public.normalize_vehicle_registration(value text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public'
AS $function$
  SELECT NULLIF(regexp_replace(upper(trim(COALESCE(value, ''))), '[^A-Z0-9]', '', 'g'), '');
$function$;

DO $$
DECLARE
  fn record;
  is_trigger boolean;
BEGIN
  FOR fn IN
    SELECT p.oid,
           format('public.%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid)) AS sig,
           pg_get_function_result(p.oid) AS result
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', fn.sig);
    is_trigger := fn.result = 'trigger';
    IF NOT is_trigger THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', fn.sig);
    END IF;
  END LOOP;
END $$;