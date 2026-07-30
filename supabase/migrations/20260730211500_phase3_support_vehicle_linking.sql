-- Phase 3 support integration: vehicle issues resolve to the canonical vehicle.

CREATE OR REPLACE FUNCTION public.support_create_ticket(
  p_requester_role text,
  p_category text,
  p_subject text,
  p_description text,
  p_priority text DEFAULT 'normal',
  p_ride_id uuid DEFAULT NULL,
  p_service_booking_id uuid DEFAULT NULL,
  p_passenger_id uuid DEFAULT NULL,
  p_driver_id uuid DEFAULT NULL
)
RETURNS public.support_tickets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text := lower(trim(coalesce(p_requester_role, ''));
  v_priority text := lower(trim(coalesce(p_priority, 'normal'));
  v_ticket public.support_tickets;
  v_is_admin boolean;
  v_driver_id uuid;
  v_vehicle_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  v_is_admin := private.has_role(v_uid, 'admin'::app_role);

  IF v_role NOT IN ('passenger','driver','admin') THEN
    RAISE EXCEPTION 'Invalid requester role';
  END IF;
  IF v_role = 'passenger' AND NOT private.has_role(v_uid, 'passenger'::app_role) AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Passenger role required';
  END IF;
  IF v_role = 'driver' AND NOT private.has_role(v_uid, 'driver'::app_role) AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Driver role required';
  END IF;
  IF v_role = 'admin' AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Admin role required';
  END IF;

  IF p_category NOT IN (
    'trip_issue','scheduled_trip','service_booking','quote_question','driver_issue',
    'vehicle_issue','account_profile','accessibility_assistance','complaint',
    'lost_property','other'
  ) THEN RAISE EXCEPTION 'Invalid support category'; END IF;

  IF v_is_admin THEN
    IF v_priority NOT IN ('low','normal','high','urgent') THEN v_priority := 'normal'; END IF;
  ELSE
    IF v_priority NOT IN ('normal','high') THEN v_priority := 'normal'; END IF;
    IF lower(coalesce(p_subject,'') || ' ' || coalesce(p_description,''))
       ~ '(immediate danger|unsafe|stranded|assault|emergency|threat|medical crisis)' THEN
      v_priority := 'urgent';
    END IF;
  END IF;

  IF p_ride_id IS NOT NULL AND NOT v_is_admin AND NOT EXISTS (
    SELECT 1 FROM public.rides r
     WHERE r.id = p_ride_id
       AND (r.passenger_id = v_uid OR r.driver_id = v_uid)
  ) THEN RAISE EXCEPTION 'You cannot link this trip'; END IF;

  IF p_service_booking_id IS NOT NULL AND NOT v_is_admin AND NOT EXISTS (
    SELECT 1 FROM public.service_bookings b
     WHERE b.id = p_service_booking_id
       AND b.booked_by_user_id = v_uid
  ) THEN RAISE EXCEPTION 'You cannot link this booking'; END IF;

  v_driver_id := CASE
    WHEN v_role = 'driver' THEN coalesce(p_driver_id, v_uid)
    WHEN v_is_admin THEN p_driver_id
    ELSE NULL
  END;

  IF p_ride_id IS NOT NULL THEN
    SELECT ride.vehicle_id INTO v_vehicle_id
    FROM public.rides ride
    WHERE ride.id = p_ride_id;
  END IF;

  IF v_vehicle_id IS NULL AND p_category = 'vehicle_issue' AND v_driver_id IS NOT NULL THEN
    SELECT assignment.vehicle_id
      INTO v_vehicle_id
      FROM public.vehicle_driver_assignments assignment
     WHERE assignment.driver_id = v_driver_id
       AND assignment.status = 'active'
       AND assignment.start_at <= now()
       AND (assignment.end_at IS NULL OR assignment.end_at > now())
     ORDER BY assignment.start_at DESC
     LIMIT 1;
  END IF;

  INSERT INTO public.support_tickets (
    created_by, requester_role, passenger_id, driver_id, ride_id,
    service_booking_id, vehicle_id, category, priority, subject, description
  ) VALUES (
    v_uid,
    v_role,
    CASE WHEN v_role = 'passenger' THEN coalesce(p_passenger_id, v_uid)
         WHEN v_is_admin THEN p_passenger_id ELSE NULL END,
    v_driver_id,
    p_ride_id,
    p_service_booking_id,
    v_vehicle_id,
    p_category,
    v_priority,
    trim(p_subject),
    trim(p_description)
  ) RETURNING * INTO v_ticket;

  INSERT INTO public.support_ticket_events (
    ticket_id, event_type, new_value, performed_by
  ) VALUES (
    v_ticket.id, 'ticket_created',
    jsonb_build_object(
      'status', v_ticket.status,
      'priority', v_ticket.priority,
      'vehicle_id', v_ticket.vehicle_id
    ),
    v_uid
  );

  INSERT INTO public.notifications (user_id, type, title, body, ride_id, support_ticket_id)
  VALUES (
    v_uid, 'support_ticket_created', 'Support ticket created',
    v_ticket.ticket_reference || ' · ' || v_ticket.subject,
    v_ticket.ride_id, v_ticket.id
  );

  INSERT INTO public.notifications (user_id, type, title, body, ride_id, support_ticket_id)
  SELECT ur.user_id,
         CASE WHEN v_ticket.priority = 'urgent' THEN 'support_urgent' ELSE 'support_new' END,
         CASE WHEN v_ticket.priority = 'urgent' THEN 'Urgent support ticket' ELSE 'New support ticket' END,
         v_ticket.ticket_reference || ' · ' || v_ticket.subject,
         v_ticket.ride_id,
         v_ticket.id
    FROM public.user_roles ur
   WHERE ur.role = 'admin'::app_role
     AND ur.user_id <> v_uid;

  RETURN v_ticket;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_link_support_vehicle(
  p_ticket_id uuid,
  p_vehicle_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_actor uuid := public.fleet_require_admin();
  v_ticket public.support_tickets%ROWTYPE;
  v_previous_vehicle uuid;
BEGIN
  IF NULLIF(trim(coalesce(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required to change the support vehicle link';
  END IF;

  PERFORM 1 FROM public.vehicle_profiles WHERE id = p_vehicle_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Canonical vehicle not found'; END IF;

  SELECT * INTO v_ticket
  FROM public.support_tickets
  WHERE id = p_ticket_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Support ticket not found'; END IF;
  v_previous_vehicle := v_ticket.vehicle_id;

  UPDATE public.support_tickets
  SET vehicle_id = p_vehicle_id,
      updated_at = now()
  WHERE id = p_ticket_id
  RETURNING * INTO v_ticket;

  INSERT INTO public.support_ticket_events (
    ticket_id, event_type, previous_value, new_value, performed_by
  ) VALUES (
    p_ticket_id,
    'vehicle_link_changed',
    jsonb_build_object('vehicle_id', v_previous_vehicle),
    jsonb_build_object('vehicle_id', p_vehicle_id, 'reason', trim(p_reason)),
    v_actor
  );

  RETURN to_jsonb(v_ticket);
END;
$$;

-- Backfill deterministic links from existing ride-linked tickets.
UPDATE public.support_tickets ticket
SET vehicle_id = ride.vehicle_id
FROM public.rides ride
WHERE ticket.vehicle_id IS NULL
  AND ticket.ride_id = ride.id
  AND ride.vehicle_id IS NOT NULL;

-- Backfill driver vehicle issues only where one effective assignment exists.
WITH effective_assignments AS (
  SELECT
    assignment.driver_id,
    min(assignment.vehicle_id) AS vehicle_id,
    count(*) AS assignment_count
  FROM public.vehicle_driver_assignments assignment
  WHERE assignment.status = 'active'
    AND assignment.start_at <= now()
    AND (assignment.end_at IS NULL OR assignment.end_at > now())
  GROUP BY assignment.driver_id
)
UPDATE public.support_tickets ticket
SET vehicle_id = effective.vehicle_id
FROM effective_assignments effective
WHERE ticket.vehicle_id IS NULL
  AND ticket.category = 'vehicle_issue'
  AND ticket.driver_id = effective.driver_id
  AND effective.assignment_count = 1;

INSERT INTO public.fleet_consolidation_issues (
  issue_type,
  source_table,
  source_record_id,
  details
)
SELECT
  'unlinked_vehicle_support_ticket',
  'support_tickets',
  ticket.id::text,
  jsonb_build_object(
    'ticket_reference', ticket.ticket_reference,
    'driver_id', ticket.driver_id,
    'ride_id', ticket.ride_id,
    'subject', ticket.subject
  )
FROM public.support_tickets ticket
WHERE ticket.category = 'vehicle_issue'
  AND ticket.vehicle_id IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.fleet_consolidation_issues issue
    WHERE issue.issue_type = 'unlinked_vehicle_support_ticket'
      AND issue.source_record_id = ticket.id::text
      AND issue.status = 'open'
  );

REVOKE ALL ON FUNCTION public.admin_link_support_vehicle(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_link_support_vehicle(uuid, uuid, text) TO authenticated;
