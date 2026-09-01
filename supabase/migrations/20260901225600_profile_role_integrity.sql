-- Keep the legacy profiles.role field aligned with authoritative user_roles.
-- Authorization never trusts this field, but clients must not be able to make
-- their profile display an elevated role through an ordinary profile update.

CREATE OR REPLACE FUNCTION public.enforce_profile_role_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF current_user NOT IN ('postgres', 'service_role') THEN
      NEW.role := 'passenger'::public.app_role;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role
     AND current_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'Profile role is managed by Access administrators' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_profile_role_integrity() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS profiles_role_integrity_trigger ON public.profiles;
CREATE TRIGGER profiles_role_integrity_trigger
BEFORE INSERT OR UPDATE OF role ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.enforce_profile_role_integrity();

-- Remove table-level role mutation bypasses completely. user_roles remains the
-- sole source of authorization and is already RPC-only after the governance migration.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON public.user_roles FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
