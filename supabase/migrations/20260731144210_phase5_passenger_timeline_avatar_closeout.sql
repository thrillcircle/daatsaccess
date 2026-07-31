-- Phase 5 closeout: passenger_operation_timeline reads profiles.avatar_url and
-- returns it under the customer-facing key profile_photo_url. Idempotent.
CREATE OR REPLACE FUNCTION public.passenger_operation_timeline(
  p_service_booking_id uuid DEFAULT NULL,
  p_ride_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_result jsonb;
BEGIN
  IF v_actor IS NULL OR NOT private.has_role(v_actor, 'passenger'::public.app_role) THEN RAISE EXCEPTION 'Passenger role required'; END IF;
  IF p_service_booking_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.service_bookings booking
    WHERE booking.id = p_service_booking_id AND booking.booked_by_user_id = v_actor
  ) THEN RAISE EXCEPTION 'Booking not found for this passenger'; END IF;
  IF p_ride_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.rides ride WHERE ride.id = p_ride_id AND ride.passenger_id = v_actor
  ) THEN RAISE EXCEPTION 'Ride not found for this passenger'; END IF;

  SELECT COALESCE(jsonb_agg(run_payload ORDER BY planned_start_at NULLS LAST), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      run.planned_start_at,
      jsonb_strip_nulls(jsonb_build_object(
        'id', run.id,
        'run_reference', run.run_reference,
        'ride_id', run.ride_id,
        'service_booking_id', run.service_booking_id,
        'run_type', run.run_type,
        'service_type', run.service_type,
        'planned_start_at', run.planned_start_at,
        'planned_end_at', run.planned_end_at,
        'actual_start_at', run.actual_start_at,
        'actual_end_at', run.actual_end_at,
        'status', run.operational_status,
        'pickup_address', run.pickup_address,
        'destination_address', run.destination_address,
        'driver', (
          SELECT jsonb_build_object(
            'user_id', assignment.driver_user_id,
            'full_name', profile.full_name,
            'profile_photo_url', profile.avatar_url,
            'assignment_status', assignment.status
          )
          FROM public.operation_run_assignments assignment
          LEFT JOIN public.profiles profile ON profile.user_id = assignment.driver_user_id
          WHERE assignment.operation_run_id = run.id
            AND assignment.resource_type = 'driver'
            AND assignment.status IN ('assigned','acknowledged','completed')
          ORDER BY assignment.created_at DESC LIMIT 1
        ),
        'vehicle', (
          SELECT jsonb_build_object(
            'id', vehicle.id,
            'vehicle_name', vehicle.vehicle_name,
            'make', vehicle.make,
            'model', vehicle.model,
            'license_plate', vehicle.license_plate,
            'wheelchair_accessible', vehicle.wheelchair_accessible,
            'ramp_or_lift_available', vehicle.ramp_or_lift_available
          )
          FROM public.operation_run_assignments assignment
          JOIN public.vehicle_profiles vehicle ON vehicle.id = assignment.vehicle_id
          WHERE assignment.operation_run_id = run.id
            AND assignment.resource_type = 'vehicle'
            AND assignment.status IN ('assigned','acknowledged','completed')
          ORDER BY assignment.created_at DESC LIMIT 1
        ),
        'timeline', (
          SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'event_type', event.event_type,
            'reason', event.reason,
            'created_at', event.created_at
          ) ORDER BY event.created_at), '[]'::jsonb)
          FROM public.operation_run_events event
          WHERE event.operation_run_id = run.id AND event.passenger_visible
        ),
        'incident_updates', (
          SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'incident_reference', incident.incident_reference,
            'type', incident.incident_type,
            'severity', incident.severity,
            'status', incident.status,
            'summary', incident.passenger_visible_summary,
            'created_at', incident.created_at
          ) ORDER BY incident.created_at DESC), '[]'::jsonb)
          FROM public.operational_incidents incident
          WHERE incident.operation_run_id = run.id
            AND incident.passenger_visible_summary IS NOT NULL
        )
      )) AS run_payload
    FROM public.operation_runs run
    WHERE run.passenger_id = v_actor
      AND (p_service_booking_id IS NULL OR run.service_booking_id = p_service_booking_id)
      AND (p_ride_id IS NULL OR run.ride_id = p_ride_id)
      AND run.operational_status <> 'cancelled'
  ) rows;
  RETURN jsonb_build_object('operations', v_result, 'generated_at', now());
END;
$$;

REVOKE ALL ON FUNCTION public.passenger_operation_timeline(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.passenger_operation_timeline(uuid,uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';