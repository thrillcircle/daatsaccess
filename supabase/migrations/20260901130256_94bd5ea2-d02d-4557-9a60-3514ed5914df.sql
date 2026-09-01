-- Driver trip lifecycle repair.
--
-- Production defect: pressing "I've arrived at pickup" while the ride is in
-- `accepted` raised `Invalid driver status transition from accepted to arrived`.
-- `public.driver_mark_arrived` is SECURITY DEFINER but `auth.uid()` is still the
-- driver, so `public.enforce_ride_changes` evaluated the jump as a direct driver
-- write and rejected it.
--
-- Fix: the trigger now honours a `driver_rpc` workflow guard, and the protected
-- RPC performs the internal accepted -> driver_arriving -> arrived transition
-- atomically while synchronising the ride, the operation run, driver
-- assignments, audit events and notifications. The Driver interface keeps a
-- single "I've arrived at pickup" button.

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
  via_workflow boolean := COALESCE(current_setting('access.ride_workflow', true), '')
                          IN ('passenger_rpc', 'driver_rpc', 'admin_rpc');
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
      RAISE EXCEPTION 'Use the protected cancellation workflow to cancel this trip';
    ELSIF actor = NEW.driver_id OR actor = OLD.driver_id THEN
      IF NOT (
        (OLD.status = 'requested'         AND NEW.status = 'accepted')
        OR (OLD.status = 'accepted'        AND NEW.status IN ('driver_arriving','arrived','cancelled'))
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

CREATE OR REPLACE FUNCTION public.driver_mark_arrived(p_ride_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := private.require_driver();
  v_row public.rides%ROWTYPE;
  v_previous public.ride_status;
  v_run public.operation_runs%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.rides
  WHERE id = p_ride_id AND driver_id = v_uid
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ride not found for this driver';
  END IF;

  -- Idempotent: repeating the arrival action returns the current projection.
  IF v_row.status = 'arrived' THEN
    RETURN private.driver_ride_projection(v_row);
  END IF;
  IF v_row.status NOT IN ('accepted', 'driver_arriving') THEN
    RAISE EXCEPTION 'Cannot mark arrived in current state';
  END IF;

  v_previous := v_row.status;
  PERFORM set_config('access.ride_workflow', 'driver_rpc', true);

  -- Internal transition: accepted -> driver_arriving happens server-side so the
  -- Driver interface only ever needs one arrival button.
  IF v_previous = 'accepted' THEN
    UPDATE public.rides
    SET status = 'driver_arriving', updated_at = now()
    WHERE id = v_row.id
    RETURNING * INTO v_row;

    INSERT INTO public.ride_status_events (ride_id, changed_by, previous_status, new_status)
    VALUES (v_row.id, v_uid, 'accepted', 'driver_arriving');
  END IF;

  UPDATE public.rides
  SET status = 'arrived',
      driver_arrived_at = COALESCE(driver_arrived_at, now()),
      updated_at = now()
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  INSERT INTO public.ride_status_events (ride_id, changed_by, previous_status, new_status)
  VALUES (v_row.id, v_uid, 'driver_arriving', 'arrived');

  PERFORM set_config('access.ride_workflow', '', true);

  SELECT * INTO v_run
  FROM public.operation_runs
  WHERE ride_id = v_row.id
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_run.id IS NOT NULL THEN
    UPDATE public.operation_run_assignments
    SET status = 'acknowledged',
        acknowledged_at = COALESCE(acknowledged_at, now()),
        row_version = row_version + 1,
        updated_at = now()
    WHERE operation_run_id = v_run.id
      AND driver_user_id = v_uid
      AND status = 'assigned';

    IF v_run.operational_status IS DISTINCT FROM 'driver_arrived' THEN
      UPDATE public.operation_runs
      SET operational_status = 'driver_arrived',
          updated_by = v_uid,
          row_version = row_version + 1,
          updated_at = now()
      WHERE id = v_run.id
      RETURNING * INTO v_run;
    END IF;

    PERFORM private.operations_add_event(
      v_run.id, 'driver_arrived', NULL, to_jsonb(v_run),
      'Driver marked arrival at pickup',
      jsonb_build_object('ride_id', v_row.id, 'previous_ride_status', v_previous),
      v_uid, true, true
    );
  END IF;

  PERFORM private.operations_enqueue_notification(
    v_row.passenger_id,
    'operation_driver_arrived',
    'Your Driver has arrived',
    'Your assigned Driver is waiting at the pickup point.',
    'driver-arrived:' || v_row.id::text,
    v_run.id, v_row.id, v_row.service_booking_id, now()
  );

  RETURN private.driver_ride_projection(v_row);
END;
$function$;

REVOKE ALL ON FUNCTION public.driver_mark_arrived(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.driver_mark_arrived(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.driver_mark_arrived(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_mark_arrived(uuid) TO service_role;