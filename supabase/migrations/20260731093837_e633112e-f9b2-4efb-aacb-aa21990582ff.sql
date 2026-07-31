-- 1. Companion profiles: remove broad booker read of all columns
DROP POLICY IF EXISTS "booker reads assigned companions" ON public.companion_profiles;

-- Limited directory view: only coordination-safe columns, scoped to the caller
CREATE OR REPLACE VIEW public.booking_companion_directory
WITH (security_invoker = false) AS
SELECT c.id,
       c.full_name,
       c.photo_url,
       c.is_available
FROM public.companion_profiles c
WHERE private.has_role(auth.uid(), 'admin'::app_role)
   OR EXISTS (
        SELECT 1
        FROM public.booking_companion_assignments bca
        JOIN public.service_bookings sb ON sb.id = bca.booking_id
        WHERE bca.companion_id = c.id
          AND sb.booked_by_user_id = auth.uid()
          AND bca.status = ANY (ARRAY['proposed'::assignment_status,'confirmed'::assignment_status,'completed'::assignment_status])
      );

REVOKE ALL ON public.booking_companion_directory FROM PUBLIC, anon;
GRANT SELECT ON public.booking_companion_directory TO authenticated;
GRANT SELECT ON public.booking_companion_directory TO service_role;

-- 2. Ride PINs: make the write lockdown explicit rather than implicit
REVOKE INSERT, UPDATE, DELETE ON public.ride_pins FROM authenticated, anon;

DROP POLICY IF EXISTS "no direct pin writes" ON public.ride_pins;
CREATE POLICY "no direct pin writes"
  ON public.ride_pins
  AS RESTRICTIVE
  FOR ALL
  TO authenticated, anon
  USING (true)
  WITH CHECK (false);