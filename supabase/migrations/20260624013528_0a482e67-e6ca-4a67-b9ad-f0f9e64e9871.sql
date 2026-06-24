-- Phase 3 Step 9: RLS hardening. The bulk of the required policies already
-- exist from earlier phases (passenger sees own rides; driver sees assigned
-- or open requested; passenger can only review own completed rides; only
-- passenger can write to ride_reviews; profiles/contact details scoped to
-- shared rides; admin oversight via has_role; atomic claim via conditional
-- UPDATE with `driver_id IS NULL`). This migration tightens edges only.

-- 1. Tighten passenger review edits: row must still belong to the same
--    passenger AND to a completed ride. Defense in depth on top of the
--    existing INSERT check.
DROP POLICY IF EXISTS "Passengers update their own reviews" ON public.ride_reviews;
CREATE POLICY "Passengers update their own reviews"
ON public.ride_reviews
FOR UPDATE
TO authenticated
USING (auth.uid() = passenger_id)
WITH CHECK (
  auth.uid() = passenger_id
  AND EXISTS (
    SELECT 1 FROM public.rides r
    WHERE r.id = ride_reviews.ride_id
      AND r.passenger_id = auth.uid()
      AND r.driver_id = ride_reviews.driver_id
      AND r.status = 'completed'::ride_status
  )
);

-- 2. Explicit admin oversight on ride_reviews UPDATE/DELETE (read-only fix
--    where admins could already SELECT but not moderate).
DROP POLICY IF EXISTS "Admins moderate reviews" ON public.ride_reviews;
CREATE POLICY "Admins moderate reviews"
ON public.ride_reviews
FOR ALL
TO authenticated
USING (private.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));

-- 3. Admin oversight on notifications (audit/moderation visibility).
DROP POLICY IF EXISTS "Admins read all notifications" ON public.notifications;
CREATE POLICY "Admins read all notifications"
ON public.notifications
FOR SELECT
TO authenticated
USING (private.has_role(auth.uid(), 'admin'::app_role));

-- 4. Ensure ride_reviews.updated_at is maintained on edits.
DROP TRIGGER IF EXISTS trg_ride_reviews_updated_at ON public.ride_reviews;
CREATE TRIGGER trg_ride_reviews_updated_at
BEFORE UPDATE ON public.ride_reviews
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();