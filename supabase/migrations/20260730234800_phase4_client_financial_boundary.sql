-- Phase 4 final client boundary.
-- Authenticated administrators must use protected pricing/quote RPCs just like
-- passengers. Only database-owned or service-role execution may change the
-- authoritative estimate, quote and deposit fields guarded by this trigger.

CREATE OR REPLACE FUNCTION public.protect_authoritative_pricing_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_database_execution boolean := current_user IN (
    'postgres', 'service_role', 'supabase_admin', 'supabase_auth_admin'
  );
BEGIN
  IF v_database_execution THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'rides' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.estimated_price IS NOT NULL
         OR NEW.pricing_version_id IS NOT NULL
         OR COALESCE(NEW.estimate_snapshot, '{}'::jsonb) <> '{}'::jsonb THEN
        RAISE EXCEPTION 'Ride estimates must be created by the protected pricing operation';
      END IF;
    ELSIF NEW.estimated_price IS DISTINCT FROM OLD.estimated_price
       OR NEW.pricing_version_id IS DISTINCT FROM OLD.pricing_version_id
       OR NEW.estimate_snapshot IS DISTINCT FROM OLD.estimate_snapshot THEN
      RAISE EXCEPTION 'Ride pricing fields are server-authoritative';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'service_bookings' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.estimated_total IS NOT NULL
         OR NEW.quoted_total IS NOT NULL
         OR NEW.pricing_version_id IS NOT NULL
         OR COALESCE(NEW.estimate_snapshot, '{}'::jsonb) <> '{}'::jsonb
         OR NEW.deposit_amount IS NOT NULL
         OR NEW.deposit_status::text <> 'none' THEN
        RAISE EXCEPTION 'Booking financial fields must be created by a protected operation';
      END IF;
    ELSE
      IF NEW.estimated_total IS DISTINCT FROM OLD.estimated_total
         OR NEW.quoted_total IS DISTINCT FROM OLD.quoted_total
         OR NEW.pricing_version_id IS DISTINCT FROM OLD.pricing_version_id
         OR NEW.estimate_snapshot IS DISTINCT FROM OLD.estimate_snapshot
         OR NEW.deposit_amount IS DISTINCT FROM OLD.deposit_amount
         OR NEW.deposit_status IS DISTINCT FROM OLD.deposit_status THEN
        RAISE EXCEPTION 'Booking pricing and deposit fields are server-authoritative';
      END IF;
      IF NEW.status IS DISTINCT FROM OLD.status
         AND NEW.status::text IN ('quoted', 'accepted') THEN
        RAISE EXCEPTION 'Quoted and accepted booking states require protected quote operations';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_authoritative_pricing_fields()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.protect_authoritative_pricing_fields()
  TO service_role;
