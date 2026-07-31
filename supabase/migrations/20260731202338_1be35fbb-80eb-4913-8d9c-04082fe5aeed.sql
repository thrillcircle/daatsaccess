-- =====================================================================
-- Phase 5 passenger operation workflows
-- (also re-applies the dispatch/cancellation integrity closeout, which
--  was present in the repository but never executed on this database)
-- =====================================================================

-- ---------------------------------------------------------------------
-- A. Dispatch and cancellation integrity closeout (idempotent replay)
-- ---------------------------------------------------------------------
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

REVOKE ALL ON FUNCTION public.driver_accept_dispatch_offer(uuid, integer, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_accept_dispatch_offer(uuid, integer, text)
  TO authenticated;

DROP POLICY IF EXISTS "participants read status events" ON public.ride_status_events;
CREATE POLICY "participants read status events"
ON public.ride_status_events
FOR SELECT
TO authenticated
USING (
  private.has_role(auth.uid(), 'admin')
  OR EXISTS (
    SELECT 1 FROM public.rides ride
    WHERE ride.id = ride_status_events.ride_id AND ride.passenger_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.rides ride
    WHERE ride.id = ride_status_events.ride_id AND ride.driver_id = auth.uid()
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
    SELECT 1 FROM public.rides ride
    WHERE ride.id = ride_change_log.ride_id AND ride.passenger_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.rides ride
    WHERE ride.id = ride_change_log.ride_id AND ride.driver_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "assigned driver acks change log" ON public.ride_change_log;
CREATE POLICY "assigned driver acks change log"
ON public.ride_change_log
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.rides ride
    WHERE ride.id = ride_change_log.ride_id AND ride.driver_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.rides ride
    WHERE ride.id = ride_change_log.ride_id AND ride.driver_id = auth.uid()
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

-- ---------------------------------------------------------------------
-- B. Remove unsafe direct passenger cancellation / rescheduling
--    The protected RPCs below set a transaction-local marker so the
--    guard trigger can tell an authorised workflow apart from a direct
--    client write.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_ride_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  actor uuid := auth.uid();
  is_admin boolean;
  is_driver boolean;
  via_workflow boolean := COALESCE(current_setting('access.ride_workflow', true), '') = 'passenger_rpc';
BEGIN
  IF actor IS NULL OR via_workflow THEN
    RETURN NEW;
  END IF;

  is_admin := private.has_role(actor, 'admin'::app_role);
  IF is_admin THEN
    RETURN NEW;
  END IF;

  is_driver := private.has_role(actor, 'driver'::app_role);

  IF OLD.driver_id IS DISTINCT FROM NEW.driver_id THEN
    IF OLD.driver_id IS NOT NULL THEN
      RAISE EXCEPTION 'Ride already has an assigned driver';
    END IF;
    IF NOT is_driver THEN
      RAISE EXCEPTION 'Only drivers can accept rides';
    END IF;
    IF NEW.driver_id IS DISTINCT FROM actor THEN
      RAISE EXCEPTION 'Drivers can only claim rides for themselves';
    END IF;
    IF OLD.status <> 'requested' THEN
      RAISE EXCEPTION 'Can only accept a ride in the requested state';
    END IF;
  END IF;

  IF OLD.status IS DISTINCT FROM NEW.status THEN
    IF actor = OLD.passenger_id THEN
      -- Phase 5: passengers must use public.passenger_cancel_ride.
      RAISE EXCEPTION 'Use the protected cancellation workflow to cancel this trip';
    ELSIF actor = NEW.driver_id OR actor = OLD.driver_id THEN
      IF NOT (
        (OLD.status = 'requested'         AND NEW.status = 'accepted')
        OR (OLD.status = 'accepted'        AND NEW.status IN ('driver_arriving','cancelled'))
        OR (OLD.status = 'driver_arriving' AND NEW.status IN ('arrived','cancelled'))
        OR (OLD.status = 'arrived'         AND NEW.status IN ('in_progress','cancelled'))
        OR (OLD.status = 'in_progress'     AND NEW.status = 'completed')
      ) THEN
        RAISE EXCEPTION 'Invalid driver status transition from % to %', OLD.status, NEW.status;
      END IF;
    ELSE
      RAISE EXCEPTION 'Not authorised to change ride status';
    END IF;
  END IF;

  IF actor = OLD.passenger_id THEN
    IF OLD.passenger_id IS DISTINCT FROM NEW.passenger_id THEN
      RAISE EXCEPTION 'Cannot change passenger';
    END IF;
    IF OLD.scheduled_at IS DISTINCT FROM NEW.scheduled_at THEN
      -- Phase 5: passengers must use public.passenger_reschedule_ride.
      RAISE EXCEPTION 'Use the protected rescheduling workflow to change this trip time';
    END IF;
    IF OLD.vehicle_id IS DISTINCT FROM NEW.vehicle_id THEN
      RAISE EXCEPTION 'Passenger cannot assign a vehicle';
    END IF;

    IF (OLD.pickup_lat IS DISTINCT FROM NEW.pickup_lat
        OR OLD.pickup_lng IS DISTINCT FROM NEW.pickup_lng
        OR OLD.pickup_address IS DISTINCT FROM NEW.pickup_address)
       AND OLD.status NOT IN ('requested','accepted','driver_arriving') THEN
      RAISE EXCEPTION 'Pickup cannot be changed after driver arrives';
    END IF;

    IF (OLD.destination_lat IS DISTINCT FROM NEW.destination_lat
        OR OLD.destination_lng IS DISTINCT FROM NEW.destination_lng
        OR OLD.destination_address IS DISTINCT FROM NEW.destination_address)
       AND OLD.status IN ('completed','cancelled') THEN
      RAISE EXCEPTION 'Destination cannot be changed on completed/cancelled ride';
    END IF;

    IF OLD.accepted_at IS DISTINCT FROM NEW.accepted_at
       OR OLD.driver_arrived_at IS DISTINCT FROM NEW.driver_arrived_at
       OR OLD.started_at IS DISTINCT FROM NEW.started_at
       OR OLD.completed_at IS DISTINCT FROM NEW.completed_at
       OR OLD.actual_distance_km IS DISTINCT FROM NEW.actual_distance_km
       OR OLD.actual_duration_seconds IS DISTINCT FROM NEW.actual_duration_seconds THEN
      RAISE EXCEPTION 'Passenger cannot modify trip lifecycle fields';
    END IF;
  END IF;

  IF actor = NEW.driver_id AND actor <> OLD.passenger_id THEN
    IF OLD.pickup_lat IS DISTINCT FROM NEW.pickup_lat
       OR OLD.pickup_lng IS DISTINCT FROM NEW.pickup_lng
       OR OLD.pickup_address IS DISTINCT FROM NEW.pickup_address
       OR OLD.destination_lat IS DISTINCT FROM NEW.destination_lat
       OR OLD.destination_lng IS DISTINCT FROM NEW.destination_lng
       OR OLD.destination_address IS DISTINCT FROM NEW.destination_address
       OR OLD.estimated_price IS DISTINCT FROM NEW.estimated_price
       OR OLD.distance_km IS DISTINCT FROM NEW.distance_km
       OR OLD.passenger_id IS DISTINCT FROM NEW.passenger_id
       OR OLD.route_version IS DISTINCT FROM NEW.route_version THEN
      RAISE EXCEPTION 'Driver cannot modify ride content';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------
-- C. Protected passenger cancellation
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.passenger_cancel_ride(
  p_ride_id uuid,
  p_reason text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_ride public.rides%ROWTYPE;
  v_run public.operation_runs%ROWTYPE;
  v_reason text := NULLIF(trim(COALESCE(p_reason, '')), '');
  v_driver uuid;
  v_dedup text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT private.has_role(v_actor, 'passenger'::app_role) THEN
    RAISE EXCEPTION 'Passenger role required';
  END IF;

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF NOT FOUND OR v_ride.passenger_id <> v_actor THEN
    RAISE EXCEPTION 'Ride not found for this passenger';
  END IF;

  -- Idempotency: repeating the request returns the same outcome.
  IF v_ride.status = 'cancelled' THEN
    RETURN jsonb_build_object(
      'cancelled', true, 'idempotent', true,
      'ride_id', v_ride.id, 'status', v_ride.status
    );
  END IF;
  IF v_ride.status = 'completed' THEN
    RAISE EXCEPTION 'A completed trip cannot be cancelled';
  END IF;
  IF v_ride.status IN ('in_progress') THEN
    RAISE EXCEPTION 'A trip in progress can only be stopped by contacting support';
  END IF;

  v_driver := v_ride.driver_id;
  v_dedup := 'passenger-cancelled:' || v_ride.id::text;

  SELECT * INTO v_run
  FROM public.operation_runs
  WHERE ride_id = v_ride.id
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  PERFORM set_config('access.ride_workflow', 'passenger_rpc', true);

  UPDATE public.rides
  SET status = 'cancelled', updated_at = now()
  WHERE id = v_ride.id
  RETURNING * INTO v_ride;

  IF v_run.id IS NOT NULL THEN
    UPDATE public.operation_run_assignments
    SET status = 'released', released_at = now(),
        release_reason = COALESCE(v_reason, 'Cancelled by passenger'),
        row_version = row_version + 1, updated_at = now()
    WHERE operation_run_id = v_run.id
      AND status IN ('proposed','reserved','assigned','acknowledged');

    UPDATE public.dispatch_offers
    SET status = 'cancelled',
        response_reason = COALESCE(v_reason, 'Cancelled by passenger'),
        row_version = row_version + 1, updated_at = now()
    WHERE operation_run_id = v_run.id AND status = 'offered';

    IF v_run.operational_status <> 'cancelled' THEN
      UPDATE public.operation_runs
      SET operational_status = 'cancelled',
          planning_status = 'cancelled',
          dispatch_status = 'expired',
          actual_end_at = COALESCE(actual_end_at, now()),
          updated_by = v_actor,
          row_version = row_version + 1,
          updated_at = now()
      WHERE id = v_run.id
      RETURNING * INTO v_run;
    END IF;

    PERFORM private.operations_add_event(
      v_run.id, 'passenger_cancelled', NULL, to_jsonb(v_run),
      v_reason,
      jsonb_build_object('idempotency_key', p_idempotency_key, 'ride_id', v_ride.id),
      v_actor, true, true
    );
  END IF;

  PERFORM set_config('access.ride_workflow', '', true);

  INSERT INTO public.ride_change_log (
    ride_id, changed_by, change_type, previous_values, new_values, route_version
  ) VALUES (
    v_ride.id, v_actor, 'passenger_cancelled',
    jsonb_build_object('status', 'active'),
    jsonb_build_object('status', 'cancelled', 'reason', v_reason,
                       'idempotency_key', p_idempotency_key),
    v_ride.route_version
  );

  PERFORM private.operations_enqueue_notification(
    v_actor, 'ride_cancelled', 'Trip cancelled',
    COALESCE(v_reason, 'Your trip was cancelled.'),
    v_dedup || ':passenger', v_run.id, v_ride.id, v_ride.service_booking_id, now()
  );

  IF v_driver IS NOT NULL THEN
    PERFORM private.operations_enqueue_notification(
      v_driver, 'ride_cancelled', 'Trip cancelled by passenger',
      COALESCE(v_reason, 'The passenger cancelled this trip.'),
      v_dedup || ':driver', v_run.id, v_ride.id, v_ride.service_booking_id, now()
    );
  END IF;

  RETURN jsonb_build_object(
    'cancelled', true, 'idempotent', false,
    'ride_id', v_ride.id, 'status', v_ride.status,
    'operation_run_id', v_run.id
  );
END;
$function$;

-- ---------------------------------------------------------------------
-- D. Protected passenger rescheduling
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.passenger_reschedule_ride(
  p_ride_id uuid,
  p_scheduled_at timestamptz,
  p_reason text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_ride public.rides%ROWTYPE;
  v_run public.operation_runs%ROWTYPE;
  v_reason text := NULLIF(trim(COALESCE(p_reason, '')), '');
  v_previous timestamptz;
  v_shift interval;
  v_blocked integer;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT private.has_role(v_actor, 'passenger'::app_role) THEN
    RAISE EXCEPTION 'Passenger role required';
  END IF;
  IF p_scheduled_at IS NULL THEN
    RAISE EXCEPTION 'A new pickup time is required';
  END IF;
  IF p_scheduled_at < now() + interval '1 hour' THEN
    RAISE EXCEPTION 'Scheduled trips must be at least one hour in the future';
  END IF;

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF NOT FOUND OR v_ride.passenger_id <> v_actor THEN
    RAISE EXCEPTION 'Ride not found for this passenger';
  END IF;

  IF v_ride.request_type <> 'scheduled' OR v_ride.scheduled_at IS NULL THEN
    RAISE EXCEPTION 'Only scheduled trips can be rescheduled';
  END IF;
  IF v_ride.status <> 'requested' THEN
    RAISE EXCEPTION 'This trip can no longer be rescheduled';
  END IF;
  IF v_ride.driver_id IS NOT NULL THEN
    RAISE EXCEPTION 'This trip has an assigned driver and can no longer be rescheduled';
  END IF;

  -- Idempotency: the same target time is a no-op.
  IF v_ride.scheduled_at = p_scheduled_at THEN
    RETURN jsonb_build_object(
      'rescheduled', true, 'idempotent', true,
      'ride_id', v_ride.id, 'scheduled_at', v_ride.scheduled_at
    );
  END IF;

  SELECT * INTO v_run
  FROM public.operation_runs
  WHERE ride_id = v_ride.id
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_run.id IS NOT NULL THEN
    IF v_run.planning_status NOT IN ('unplanned', 'planning')
       OR v_run.dispatch_status NOT IN ('not_required', 'pending')
       OR v_run.operational_status NOT IN ('scheduled', 'ready') THEN
      RAISE EXCEPTION 'Planning or dispatch has already started for this trip';
    END IF;

    SELECT count(*) INTO v_blocked
    FROM public.operation_run_assignments
    WHERE operation_run_id = v_run.id
      AND status IN ('proposed','reserved','assigned','acknowledged');
    IF v_blocked > 0 THEN
      RAISE EXCEPTION 'Resources are already assigned to this trip';
    END IF;

    SELECT count(*) INTO v_blocked
    FROM public.dispatch_offers
    WHERE operation_run_id = v_run.id AND status IN ('offered','accepted');
    IF v_blocked > 0 THEN
      RAISE EXCEPTION 'This trip has already been offered to a driver';
    END IF;
  END IF;

  v_previous := v_ride.scheduled_at;

  PERFORM set_config('access.ride_workflow', 'passenger_rpc', true);

  UPDATE public.rides
  SET scheduled_at = p_scheduled_at, updated_at = now()
  WHERE id = v_ride.id
  RETURNING * INTO v_ride;

  IF v_run.id IS NOT NULL THEN
    v_shift := p_scheduled_at - COALESCE(v_run.planned_start_at, v_previous);
    UPDATE public.operation_runs
    SET planned_start_at = p_scheduled_at,
        planned_end_at = CASE
          WHEN planned_end_at IS NULL THEN NULL
          ELSE planned_end_at + v_shift
        END,
        updated_by = v_actor,
        row_version = row_version + 1,
        updated_at = now()
    WHERE id = v_run.id
    RETURNING * INTO v_run;

    PERFORM private.operations_add_event(
      v_run.id, 'passenger_rescheduled',
      jsonb_build_object('scheduled_at', v_previous),
      jsonb_build_object('scheduled_at', p_scheduled_at),
      v_reason,
      jsonb_build_object('idempotency_key', p_idempotency_key, 'ride_id', v_ride.id),
      v_actor, true, true
    );
  END IF;

  PERFORM set_config('access.ride_workflow', '', true);

  INSERT INTO public.ride_change_log (
    ride_id, changed_by, change_type, previous_values, new_values, route_version
  ) VALUES (
    v_ride.id, v_actor, 'passenger_rescheduled',
    jsonb_build_object('scheduled_at', v_previous),
    jsonb_build_object('scheduled_at', p_scheduled_at, 'reason', v_reason,
                       'idempotency_key', p_idempotency_key),
    v_ride.route_version
  );

  PERFORM private.operations_enqueue_notification(
    v_actor, 'ride_rescheduled', 'Trip rescheduled',
    'Your trip is now scheduled for ' || to_char(p_scheduled_at, 'YYYY-MM-DD HH24:MI'),
    'passenger-rescheduled:' || v_ride.id::text || ':' || extract(epoch from p_scheduled_at)::bigint::text,
    v_run.id, v_ride.id, v_ride.service_booking_id, now()
  );

  RETURN jsonb_build_object(
    'rescheduled', true, 'idempotent', false,
    'ride_id', v_ride.id, 'scheduled_at', v_ride.scheduled_at,
    'previous_scheduled_at', v_previous,
    'operation_run_id', v_run.id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.passenger_cancel_ride(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.passenger_cancel_ride(uuid, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.passenger_reschedule_ride(uuid, timestamptz, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.passenger_reschedule_ride(uuid, timestamptz, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';