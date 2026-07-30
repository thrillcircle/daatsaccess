-- Phase 3 hardening for atomic resource assignment and maintenance transitions.

CREATE OR REPLACE FUNCTION public.vehicle_has_expired_mandatory_document(
  p_vehicle_id uuid,
  p_document_type text,
  p_legacy_expiry date
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT document.expires_at < current_date
      FROM public.vehicle_documents document
      WHERE document.vehicle_id = p_vehicle_id
        AND document.document_type = p_document_type
        AND document.is_current
        AND document.status = 'current'
      ORDER BY document.created_at DESC
      LIMIT 1
    ),
    p_legacy_expiry < current_date,
    false
  );
$$;

REVOKE ALL ON FUNCTION public.vehicle_has_expired_mandatory_document(uuid, text, date) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.admin_assign_ride_resources(
  p_ride_id uuid,
  p_driver_id uuid,
  p_vehicle_id uuid,
  p_expected_status public.ride_status DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_actor uuid := public.fleet_require_admin();
  v_ride public.rides%ROWTYPE;
  v_vehicle public.vehicle_profiles%ROWTYPE;
  v_result jsonb;
  v_assignment_start timestamptz;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    SELECT request.result
      INTO v_result
      FROM public.fleet_operation_requests request
     WHERE request.idempotency_key = p_idempotency_key
       AND request.operation_type = 'assign_ride_resources'
       AND request.actor_id = v_actor;
    IF v_result IS NOT NULL THEN RETURN v_result; END IF;
  END IF;

  SELECT * INTO v_ride
    FROM public.rides
   WHERE id = p_ride_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ride not found'; END IF;
  IF v_ride.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Ride cannot be reassigned';
  END IF;
  IF p_expected_status IS NOT NULL AND v_ride.status IS DISTINCT FROM p_expected_status THEN
    RAISE EXCEPTION 'Ride status changed since it was loaded';
  END IF;
  IF NOT private.has_role(p_driver_id, 'driver'::app_role) THEN
    RAISE EXCEPTION 'Selected user is not a driver';
  END IF;

  SELECT * INTO v_vehicle
    FROM public.vehicle_profiles
   WHERE id = p_vehicle_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Vehicle not found'; END IF;
  IF v_vehicle.status <> 'active' THEN
    RAISE EXCEPTION 'Only active vehicles may be assigned';
  END IF;

  IF public.vehicle_has_expired_mandatory_document(
       p_vehicle_id, 'roadworthy', v_vehicle.roadworthy_expiry_date
     ) THEN
    RAISE EXCEPTION 'Vehicle roadworthy document has expired';
  END IF;
  IF public.vehicle_has_expired_mandatory_document(
       p_vehicle_id, 'license_disc', v_vehicle.license_disc_expiry_date
     ) THEN
    RAISE EXCEPTION 'Vehicle licence disc has expired';
  END IF;
  IF public.vehicle_has_expired_mandatory_document(
       p_vehicle_id, 'insurance', v_vehicle.insurance_expiry_date
     ) THEN
    RAISE EXCEPTION 'Vehicle insurance has expired';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.rides ride
     WHERE ride.id <> p_ride_id
       AND ride.status IN ('accepted', 'driver_arriving', 'arrived', 'in_progress')
       AND (ride.driver_id = p_driver_id OR ride.vehicle_id = p_vehicle_id)
  ) THEN
    RAISE EXCEPTION 'Driver or vehicle is already assigned to another active ride';
  END IF;

  v_assignment_start := COALESCE(v_ride.scheduled_at, now());
  IF NOT EXISTS (
    SELECT 1
      FROM public.vehicle_driver_assignments assignment
     WHERE assignment.vehicle_id = p_vehicle_id
       AND assignment.driver_id = p_driver_id
       AND assignment.status IN ('scheduled', 'active')
       AND assignment.start_at <= v_assignment_start
       AND (assignment.end_at IS NULL OR assignment.end_at > v_assignment_start)
  ) THEN
    PERFORM public.admin_assign_driver_vehicle(
      p_vehicle_id,
      p_driver_id,
      'trip_specific',
      v_assignment_start,
      v_assignment_start + interval '12 hours',
      'Ride resource assignment',
      'Created for ride ' || p_ride_id::text,
      'ride_assignment',
      CASE WHEN p_idempotency_key IS NULL THEN NULL ELSE p_idempotency_key || ':assignment' END
    );
  END IF;

  UPDATE public.rides
     SET driver_id = p_driver_id,
         vehicle_id = p_vehicle_id,
         status = CASE WHEN status = 'requested' THEN 'accepted'::public.ride_status ELSE status END,
         accepted_at = CASE
           WHEN status = 'requested' THEN COALESCE(accepted_at, now())
           ELSE accepted_at
         END
   WHERE id = p_ride_id
   RETURNING * INTO v_ride;

  v_result := to_jsonb(v_ride);
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.fleet_operation_requests (
      idempotency_key, operation_type, actor_id, result
    ) VALUES (
      p_idempotency_key, 'assign_ride_resources', v_actor, v_result
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_assign_booking_vehicle(
  p_booking_id uuid,
  p_vehicle_id uuid,
  p_itinerary_item_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_actor uuid := public.fleet_require_admin();
  v_assignment public.booking_vehicle_assignments%ROWTYPE;
  v_result jsonb;
  v_vehicle public.vehicle_profiles%ROWTYPE;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    SELECT request.result
      INTO v_result
      FROM public.fleet_operation_requests request
     WHERE request.idempotency_key = p_idempotency_key
       AND request.operation_type = 'assign_booking_vehicle'
       AND request.actor_id = v_actor;
    IF v_result IS NOT NULL THEN RETURN v_result; END IF;
  END IF;

  PERFORM 1 FROM public.service_bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Service booking not found'; END IF;

  SELECT * INTO v_vehicle
    FROM public.vehicle_profiles
   WHERE id = p_vehicle_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Vehicle not found'; END IF;
  IF v_vehicle.status <> 'active' THEN
    RAISE EXCEPTION 'Only active vehicles may be assigned';
  END IF;

  IF public.vehicle_has_expired_mandatory_document(
       p_vehicle_id, 'roadworthy', v_vehicle.roadworthy_expiry_date
     ) OR public.vehicle_has_expired_mandatory_document(
       p_vehicle_id, 'license_disc', v_vehicle.license_disc_expiry_date
     ) OR public.vehicle_has_expired_mandatory_document(
       p_vehicle_id, 'insurance', v_vehicle.insurance_expiry_date
     ) THEN
    RAISE EXCEPTION 'Vehicle has an expired mandatory document';
  END IF;

  SELECT * INTO v_assignment
    FROM public.booking_vehicle_assignments assignment
   WHERE assignment.booking_id = p_booking_id
     AND assignment.itinerary_item_id IS NOT DISTINCT FROM p_itinerary_item_id
     AND assignment.status IN ('proposed', 'confirmed')
   ORDER BY assignment.assigned_at DESC
   LIMIT 1
   FOR UPDATE;

  IF FOUND THEN
    UPDATE public.booking_vehicle_assignments
       SET vehicle_id = p_vehicle_id,
           status = 'confirmed',
           notes = NULLIF(trim(p_notes), '')
     WHERE id = v_assignment.id
     RETURNING * INTO v_assignment;
  ELSE
    INSERT INTO public.booking_vehicle_assignments (
      booking_id, itinerary_item_id, vehicle_id, fleet_vehicle_id, status, notes
    ) VALUES (
      p_booking_id, p_itinerary_item_id, p_vehicle_id, NULL, 'confirmed', NULLIF(trim(p_notes), '')
    ) RETURNING * INTO v_assignment;
  END IF;

  v_result := to_jsonb(v_assignment);
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.fleet_operation_requests (
      idempotency_key, operation_type, actor_id, result
    ) VALUES (
      p_idempotency_key, 'assign_booking_vehicle', v_actor, v_result
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_maintenance_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.status = 'open' AND NEW.status IN ('scheduled', 'in_progress', 'cancelled')) OR
    (OLD.status = 'scheduled' AND NEW.status IN ('in_progress', 'cancelled')) OR
    (OLD.status = 'in_progress' AND NEW.status IN ('waiting_for_parts', 'completed', 'cancelled')) OR
    (OLD.status = 'waiting_for_parts' AND NEW.status IN ('in_progress', 'cancelled'))
  ) THEN
    RAISE EXCEPTION 'Invalid maintenance transition from % to %', OLD.status, NEW.status;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS vehicle_maintenance_status_transition_trigger
  ON public.vehicle_maintenance_work_orders;
CREATE TRIGGER vehicle_maintenance_status_transition_trigger
  BEFORE UPDATE OF status ON public.vehicle_maintenance_work_orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_maintenance_status_transition();

GRANT EXECUTE ON FUNCTION public.admin_assign_ride_resources(
  uuid, uuid, uuid, public.ride_status, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_assign_booking_vehicle(
  uuid, uuid, uuid, text, text
) TO authenticated;
