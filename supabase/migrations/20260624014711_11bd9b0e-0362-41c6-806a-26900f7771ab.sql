-- Prevent passengers from changing their role or user_id via direct profile updates.
-- Admins (and trigger-internal service-role contexts) remain unrestricted.
CREATE OR REPLACE FUNCTION public.enforce_profile_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  actor uuid := auth.uid();
BEGIN
  IF actor IS NULL THEN
    RETURN NEW;
  END IF;
  IF private.has_role(actor, 'admin'::app_role) THEN
    RETURN NEW;
  END IF;
  IF OLD.user_id IS DISTINCT FROM NEW.user_id THEN
    RAISE EXCEPTION 'Cannot change profile owner';
  END IF;
  IF OLD.role IS DISTINCT FROM NEW.role THEN
    RAISE EXCEPTION 'Cannot change profile role';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_profile_changes ON public.profiles;
CREATE TRIGGER trg_enforce_profile_changes
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.enforce_profile_changes();

REVOKE EXECUTE ON FUNCTION public.enforce_profile_changes() FROM PUBLIC, anon, authenticated;