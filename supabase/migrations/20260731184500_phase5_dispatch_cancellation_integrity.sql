-- Phase 5 dispatch and cancellation integrity closeout.
-- Immediate Driver assignment is authoritative through dispatch offers only.
-- Drivers cannot independently cancel a Ride outside the operation state machine.

DO $closeout$
BEGIN
  IF to_regprocedure('public.driver_accept_ride(uuid)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.driver_accept_ride(uuid) FROM PUBLIC, anon, authenticated';
  END IF;
  IF to_regprocedure('public.driver_cancel_ride(uuid)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.driver_cancel_ride(uuid) FROM PUBLIC, anon, authenticated';
  END IF;
END
$closeout$;

DROP FUNCTION IF EXISTS public.driver_accept_ride(uuid);
DROP FUNCTION IF EXISTS public.driver_cancel_ride(uuid);

-- Keep the established dispatch-offer acceptance RPC as the only immediate
-- Driver assignment entry point.
REVOKE ALL ON FUNCTION public.driver_accept_dispatch_offer(uuid, integer, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_accept_dispatch_offer(uuid, integer, text)
  TO authenticated;

-- Inline Driver ownership checks into audit policies so no private helper must
-- be executable by ordinary authenticated clients.
DROP POLICY IF EXISTS "participants read status events" ON public.ride_status_events;
CREATE POLICY "participants read status events"
ON public.ride_status_events
FOR SELECT
TO authenticated
USING (
  private.has_role(auth.uid(), 'admin')
  OR EXISTS (
    SELECT 1
    FROM public.rides ride
    WHERE ride.id = ride_status_events.ride_id
      AND ride.passenger_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1
    FROM public.rides ride
    WHERE ride.id = ride_status_events.ride_id
      AND ride.driver_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "participants read change log" ON public.ride_change_log;
CREATE POLICY "participants read change log"
ON public.ride_change_log
FOR SELECT
TO authenticated
USING (
  private.has_role(auth.uid(), 'admin')
  OR EXISTS (
    SELECT 1
    FROM public.rides ride
    WHERE ride.id = ride_change_log.ride_id
      AND ride.passenger_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1
    FROM public.rides ride
    WHERE ride.id = ride_change_log.ride_id
      AND ride.driver_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "assigned driver acks change log" ON public.ride_change_log;
CREATE POLICY "assigned driver acks change log"
ON public.ride_change_log
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.rides ride
    WHERE ride.id = ride_change_log.ride_id
      AND ride.driver_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.rides ride
    WHERE ride.id = ride_change_log.ride_id
      AND ride.driver_id = auth.uid()
  )
);

DO $closeout$
BEGIN
  IF to_regprocedure('private.is_ride_driver(uuid,uuid)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION private.is_ride_driver(uuid,uuid) FROM PUBLIC, anon, authenticated';
  END IF;
END
$closeout$;

DROP FUNCTION IF EXISTS private.is_ride_driver(uuid, uuid);

NOTIFY pgrst, 'reload schema';
