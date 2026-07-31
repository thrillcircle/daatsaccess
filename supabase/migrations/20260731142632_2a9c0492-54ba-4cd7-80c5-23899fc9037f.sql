-- Phase 5 protected planning, assignment, dispatch and role-safe operation APIs.

CREATE OR REPLACE FUNCTION private.operations_actor_role(p_actor uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT CASE
    WHEN p_actor IS NULL THEN 'system'
    WHEN private.has_role(p_actor, 'admin'::public.app_role) THEN 'admin'
    WHEN private.has_role(p_actor, 'driver'::public.app_role) THEN 'driver'
    WHEN private.has_role(p_actor, 'passenger'::public.app_role) THEN 'passenger'
    ELSE 'authenticated'
  END
$$;

CREATE OR REPLACE FUNCTION private.operations_add_event(
  p_run_id uuid,
  p_event_type text,
  p_previous jsonb DEFAULT NULL,
  p_new jsonb DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_actor uuid DEFAULT NULL,
  p_passenger_visible boolean DEFAULT false,
  p_driver_visible boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.operation_run_events (
    operation_run_id, event_type, previous_state, new_state, reason, metadata,
    actor_id, actor_role, passenger_visible, driver_visible
  ) VALUES (
    p_run_id, p_event_type, p_previous, p_new, NULLIF(trim(p_reason), ''),
    COALESCE(p_metadata, '{}'::jsonb), p_actor,
    private.operations_actor_role(p_actor), p_passenger_visible, p_driver_visible
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION private.operations_enqueue_notification(
  p_recipient uuid,
  p_type text,
  p_title text,
  p_message text,
  p_deduplication_key text,
  p_run_id uuid DEFAULT NULL,
  p_ride_id uuid DEFAULT NULL,
  p_booking_id uuid DEFAULT NULL,
  p_scheduled_for timestamptz DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.notification_outbox (
    recipient_user_id, notification_type, title, message, deduplication_key,
    operation_run_id, ride_id, service_booking_id, scheduled_for
  ) VALUES (
    p_recipient, p_type, p_title, p_message, p_deduplication_key,
    p_run_id, p_ride_id, p_booking_id, COALESCE(p_scheduled_for, now())
  )
  ON CONFLICT (deduplication_key) DO UPDATE
    SET scheduled_for = LEAST(public.notification_outbox.scheduled_for, EXCLUDED.scheduled_for),
        updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION private.operations_run_response(p_run public.operation_runs)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id', p_run.id,
    'run_reference', p_run.run_reference,
    'ride_id', p_run.ride_id,
    'service_booking_id', p_run.service_booking_id,
    'itinerary_item_id', p_run.itinerary_item_id,
    'run_type', p_run.run_type,
    'service_type', p_run.service_type,
    'planned_start_at', p_run.planned_start_at,
    'planned_end_at', p_run.planned_end_at,
    'actual_start_at', p_run.actual_start_at,
    'actual_end_at', p_run.actual_end_at,
    'planning_status', p_run.planning_status,
    'dispatch_status', p_run.dispatch_status,
    'operational_status', p_run.operational_status,
    'priority', p_run.priority,
    'row_version', p_run.row_version
  )
$$;

CREATE OR REPLACE FUNCTION public.admin_plan_service_booking(
  p_booking_id uuid,
  p_include_verification boolean DEFAULT false,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_actor uuid := public.operations_require_admin();
  v_booking public.service_bookings%ROWTYPE;
  v_plan public.operation_plans%ROWTYPE;
  v_existing jsonb;
  v_is_verification boolean;
  v_count integer;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    SELECT result INTO v_existing
    FROM public.operations_operation_requests
    WHERE actor_id = v_actor
      AND operation_type = 'plan_service_booking'
      AND idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_existing; END IF;
  END IF;

  SELECT * INTO v_booking
  FROM public.service_bookings
  WHERE id = p_booking_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Service booking not found'; END IF;
  IF v_booking.status NOT IN ('accepted','resources_assigned','active') THEN
    RAISE EXCEPTION 'Only accepted or active bookings can be planned';
  END IF;

  v_is_verification :=
    upper(COALESCE(v_booking.admin_notes, '')) LIKE '%PHASE 4 VERIFICATION RECORD%'
    OR upper(COALESCE(v_booking.metadata->>'verification_record', '')) IN ('TRUE','PHASE 4');
  IF v_is_verification AND NOT p_include_verification THEN
    RAISE EXCEPTION 'Verification records require explicit inclusion';
  END IF;

  SELECT * INTO v_plan
  FROM public.operation_plans
  WHERE service_booking_id = p_booking_id AND status <> 'cancelled'
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.operation_plans (
      service_booking_id, status, created_by, updated_by
    ) VALUES (
      p_booking_id, 'draft', v_actor, v_actor
    ) RETURNING * INTO v_plan;
  ELSIF v_plan.status = 'published' THEN
    RAISE EXCEPTION 'Published plans cannot be regenerated in place';
  ELSE
    UPDATE public.operation_plans
    SET status = 'draft', validation_snapshot = '{}'::jsonb,
        updated_by = v_actor, row_version = row_version + 1
    WHERE id = v_plan.id
    RETURNING * INTO v_plan;
  END IF;

  UPDATE public.operation_runs
  SET operation_plan_id = v_plan.id,
      planning_status = CASE
        WHEN planning_status = 'cancelled' THEN planning_status ELSE 'planning' END,
      is_verification_record = v_is_verification,
      updated_by = v_actor,
      row_version = row_version + 1
  WHERE service_booking_id = p_booking_id
    AND operational_status <> 'cancelled';

  -- Non-ride itinerary work becomes a run. Ride items must have a priced ride.
  INSERT INTO public.operation_runs (
    operation_plan_id, source_type, source_id, service_booking_id, itinerary_item_id,
    passenger_id, run_type, service_type, pickup_address, destination_address,
    destination_lat, destination_lng, planned_start_at, planned_end_at,
    passenger_count, wheelchair_count, accessibility_requirements,
    planning_status, dispatch_status, operational_status, is_verification_record,
    created_by, updated_by
  )
  SELECT
    v_plan.id, 'itinerary_item', item.id, v_booking.id, item.id,
    v_booking.booked_by_user_id,
    CASE item.item_type::text
      WHEN 'waiting' THEN 'waiting_service'
      WHEN 'appointment' THEN 'appointment_support'
      WHEN 'accommodation' THEN 'overnight_support'
      WHEN 'activity' THEN 'companion_service'
      ELSE 'companion_service'
    END,
    v_booking.service_type::text,
    item.address, item.address, item.latitude, item.longitude,
    COALESCE(item.planned_start_at, v_booking.start_at),
    COALESCE(
      item.planned_end_at,
      item.planned_start_at + CASE
        WHEN item.item_type::text = 'waiting' THEN interval '1 hour'
        ELSE interval '2 hours'
      END,
      v_booking.end_at,
      v_booking.start_at + interval '2 hours'
    ),
    GREATEST(1, COALESCE((
      SELECT count(*)::integer FROM public.booking_travellers traveller
      WHERE traveller.booking_id = v_booking.id
    ), 0)),
    COALESCE((
      SELECT sum(requirement.quantity)::integer
      FROM public.booking_assistance_requirements requirement
      WHERE requirement.booking_id = v_booking.id
        AND requirement.requirement_code::text IN ('wheelchair_transfer','mobility_equipment')
    ), 0),
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'code', requirement.requirement_code::text,
        'quantity', requirement.quantity,
        'notes', requirement.notes
      ))
      FROM public.booking_assistance_requirements requirement
      WHERE requirement.booking_id = v_booking.id
    ), '[]'::jsonb),
    'planning', 'not_required', 'scheduled', v_is_verification,
    v_actor, v_actor
  FROM public.booking_itinerary_items item
  WHERE item.booking_id = v_booking.id
    AND item.item_type::text <> 'ride'
  ON CONFLICT DO NOTHING;

  -- A booking without itinerary or linked rides receives one schedulable support run.
  IF NOT EXISTS (
    SELECT 1 FROM public.operation_runs run
    WHERE run.service_booking_id = v_booking.id AND run.operational_status <> 'cancelled'
  ) THEN
    INSERT INTO public.operation_runs (
      operation_plan_id, source_type, source_id, service_booking_id, passenger_id,
      run_type, service_type, planned_start_at, planned_end_at, passenger_count,
      wheelchair_count, accessibility_requirements, planning_status,
      dispatch_status, operational_status, is_verification_record,
      created_by, updated_by
    ) VALUES (
      v_plan.id, 'service_booking', v_booking.id, v_booking.id,
      v_booking.booked_by_user_id,
      CASE v_booking.service_type::text
        WHEN 'appointment' THEN 'appointment_support'
        WHEN 'extended_journey' THEN 'overnight_support'
        ELSE 'companion_service'
      END,
      v_booking.service_type::text, v_booking.start_at,
      COALESCE(v_booking.end_at, v_booking.start_at + interval '2 hours'),
      GREATEST(1, COALESCE((SELECT count(*)::integer FROM public.booking_travellers t WHERE t.booking_id = v_booking.id), 0)),
      COALESCE((SELECT sum(r.quantity)::integer FROM public.booking_assistance_requirements r
        WHERE r.booking_id = v_booking.id AND r.requirement_code::text IN ('wheelchair_transfer','mobility_equipment')), 0),
      COALESCE((SELECT jsonb_agg(jsonb_build_object('code', r.requirement_code::text, 'quantity', r.quantity, 'notes', r.notes))
        FROM public.booking_assistance_requirements r WHERE r.booking_id = v_booking.id), '[]'::jsonb),
      'planning', 'not_required', 'scheduled', v_is_verification, v_actor, v_actor
    ) ON CONFLICT DO NOTHING;
  END IF;

  UPDATE public.operation_runs
  SET planning_status = 'planned', updated_by = v_actor, row_version = row_version + 1
  WHERE operation_plan_id = v_plan.id
    AND planning_status = 'planning';

  SELECT count(*) INTO v_count
  FROM public.operation_runs WHERE operation_plan_id = v_plan.id AND operational_status <> 'cancelled';

  v_existing := jsonb_build_object(
    'plan_id', v_plan.id,
    'plan_reference', v_plan.plan_reference,
    'status', v_plan.status,
    'run_count', v_count,
    'verification_record', v_is_verification
  );

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.operations_operation_requests(actor_id, operation_type, idempotency_key, result)
    VALUES (v_actor, 'plan_service_booking', p_idempotency_key, v_existing)
    ON CONFLICT (actor_id, operation_type, idempotency_key) DO NOTHING;
  END IF;
  RETURN v_existing;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_validate_operation_plan(p_plan_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_actor uuid := public.operations_require_admin();
  v_plan public.operation_plans%ROWTYPE;
  v_blockers jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_plan FROM public.operation_plans WHERE id = p_plan_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Operation plan not found'; END IF;

  SELECT COALESCE(jsonb_agg(item), '[]'::jsonb) INTO v_blockers
  FROM (
    SELECT jsonb_build_object('code','no_runs','message','The plan has no operation runs') item
    WHERE NOT EXISTS (
      SELECT 1 FROM public.operation_runs run
      WHERE run.operation_plan_id = p_plan_id AND run.operational_status <> 'cancelled'
    )
    UNION ALL
    SELECT jsonb_build_object('code','verification_record','run_id',run.id,'message','Verification records cannot be published for live dispatch')
    FROM public.operation_runs run
    WHERE run.operation_plan_id = p_plan_id AND run.is_verification_record
    UNION ALL
    SELECT jsonb_build_object('code','missing_time_window','run_id',run.id,'message','A complete operation time window is required')
    FROM public.operation_runs run
    WHERE run.operation_plan_id = p_plan_id
      AND run.operational_status <> 'cancelled'
      AND (run.planned_start_at IS NULL OR run.planned_end_at IS NULL OR run.planned_end_at <= run.planned_start_at)
    UNION ALL
    SELECT jsonb_build_object('code','missing_ride','run_id',run.id,'message','Transport work requires a linked priced ride')
    FROM public.operation_runs run
    WHERE run.operation_plan_id = p_plan_id
      AND run.run_type IN ('immediate_ride','scheduled_ride','transport_leg')
      AND run.ride_id IS NULL
    UNION ALL
    SELECT jsonb_build_object('code','missing_driver','run_id',run.id,'message','A Driver must be assigned')
    FROM public.operation_runs run
    WHERE run.operation_plan_id = p_plan_id
      AND run.run_type IN ('scheduled_ride','transport_leg')
      AND NOT EXISTS (
        SELECT 1 FROM public.operation_run_assignments assignment
        WHERE assignment.operation_run_id = run.id
          AND assignment.resource_type = 'driver'
          AND assignment.status IN ('reserved','assigned','acknowledged')
      )
    UNION ALL
    SELECT jsonb_build_object('code','missing_vehicle','run_id',run.id,'message','A vehicle must be assigned')
    FROM public.operation_runs run
    WHERE run.operation_plan_id = p_plan_id
      AND run.run_type IN ('scheduled_ride','transport_leg')
      AND NOT EXISTS (
        SELECT 1 FROM public.operation_run_assignments assignment
        WHERE assignment.operation_run_id = run.id
          AND assignment.resource_type = 'vehicle'
          AND assignment.status IN ('reserved','assigned','acknowledged')
      )
    UNION ALL
    SELECT jsonb_build_object('code','missing_companion','run_id',run.id,'message','A companion must be assigned')
    FROM public.operation_runs run
    JOIN public.service_bookings booking ON booking.id = run.service_booking_id
    WHERE run.operation_plan_id = p_plan_id
      AND (booking.requested_companion_count > 0 OR run.run_type IN ('companion_service','appointment_support','overnight_support'))
      AND NOT EXISTS (
        SELECT 1 FROM public.operation_run_assignments assignment
        WHERE assignment.operation_run_id = run.id
          AND assignment.resource_type = 'companion'
          AND assignment.status IN ('reserved','assigned','acknowledged')
      )
    UNION ALL
    SELECT jsonb_build_object('code','vehicle_unavailable','run_id',run.id,'vehicle_id',vehicle.id,'message','Assigned vehicle is not operational')
    FROM public.operation_runs run
    JOIN public.operation_run_assignments assignment ON assignment.operation_run_id = run.id
      AND assignment.resource_type = 'vehicle'
      AND assignment.status IN ('reserved','assigned','acknowledged')
    JOIN public.vehicle_profiles vehicle ON vehicle.id = assignment.vehicle_id
    WHERE run.operation_plan_id = p_plan_id AND vehicle.status <> 'active'
    UNION ALL
    SELECT jsonb_build_object('code','vehicle_document_expired','run_id',run.id,'vehicle_id',assignment.vehicle_id,'message','Mandatory vehicle documents are expired')
    FROM public.operation_runs run
    JOIN public.operation_run_assignments assignment ON assignment.operation_run_id = run.id
      AND assignment.resource_type = 'vehicle'
      AND assignment.status IN ('reserved','assigned','acknowledged')
    WHERE run.operation_plan_id = p_plan_id
      AND public.vehicle_has_expired_mandatory_document(
        assignment.vehicle_id, run.service_type, COALESCE(run.planned_start_at::date, CURRENT_DATE)
      )
    UNION ALL
    SELECT jsonb_build_object('code','vehicle_maintenance_block','run_id',run.id,'vehicle_id',assignment.vehicle_id,'message','Open maintenance blocks this vehicle')
    FROM public.operation_runs run
    JOIN public.operation_run_assignments assignment ON assignment.operation_run_id = run.id
      AND assignment.resource_type = 'vehicle'
      AND assignment.status IN ('reserved','assigned','acknowledged')
    WHERE run.operation_plan_id = p_plan_id
      AND EXISTS (
        SELECT 1 FROM public.vehicle_maintenance_work_orders work_order
        WHERE work_order.vehicle_id = assignment.vehicle_id
          AND work_order.status IN ('open','scheduled','in_progress')
          AND work_order.severity IN ('urgent','unsafe','critical','high')
      )
    UNION ALL
    SELECT jsonb_build_object('code','vehicle_capacity','run_id',run.id,'vehicle_id',vehicle.id,'message','Vehicle capacity does not match the run')
    FROM public.operation_runs run
    JOIN public.operation_run_assignments assignment ON assignment.operation_run_id = run.id
      AND assignment.resource_type = 'vehicle'
      AND assignment.status IN ('reserved','assigned','acknowledged')
    JOIN public.vehicle_profiles vehicle ON vehicle.id = assignment.vehicle_id
    WHERE run.operation_plan_id = p_plan_id
      AND (
        COALESCE(vehicle.passenger_capacity,0) < run.passenger_count
        OR COALESCE(vehicle.wheelchair_capacity,0) < run.wheelchair_count
      )
  ) blocker_rows;

  SELECT COALESCE(jsonb_agg(item), '[]'::jsonb) INTO v_warnings
  FROM (
    SELECT jsonb_build_object('code','short_preparation','run_id',run.id,'message','Operation starts within two hours') item
    FROM public.operation_runs run
    WHERE run.operation_plan_id = p_plan_id
      AND run.planned_start_at BETWEEN now() AND now() + interval '2 hours'
    UNION ALL
    SELECT jsonb_build_object('code','unacknowledged','run_id',assignment.operation_run_id,'message','A Driver assignment is awaiting acknowledgement')
    FROM public.operation_run_assignments assignment
    JOIN public.operation_runs run ON run.id = assignment.operation_run_id
    WHERE run.operation_plan_id = p_plan_id
      AND assignment.resource_type = 'driver'
      AND assignment.status IN ('reserved','assigned')
    UNION ALL
    SELECT jsonb_build_object('code','stale_driver_location','run_id',run.id,'message','Assigned Driver location is stale')
    FROM public.operation_runs run
    JOIN public.operation_run_assignments assignment ON assignment.operation_run_id = run.id
      AND assignment.resource_type = 'driver'
      AND assignment.status IN ('reserved','assigned','acknowledged')
    LEFT JOIN public.driver_profiles driver ON driver.user_id = assignment.driver_user_id
    WHERE run.operation_plan_id = p_plan_id
      AND (driver.location_updated_at IS NULL OR driver.location_updated_at < now() - interval '15 minutes')
  ) warning_rows;

  RETURN jsonb_build_object(
    'plan_id', p_plan_id,
    'is_valid', jsonb_array_length(v_blockers) = 0,
    'blockers', v_blockers,
    'warnings', v_warnings,
    'validated_by', v_actor,
    'validated_at', now()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_publish_operation_plan(
  p_plan_id uuid,
  p_expected_row_version integer,
  p_confirmation text,
  p_warning_override_reason text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_actor uuid := public.operations_require_admin();
  v_plan public.operation_plans%ROWTYPE;
  v_validation jsonb;
  v_existing jsonb;
  v_booking public.service_bookings%ROWTYPE;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    SELECT result INTO v_existing FROM public.operations_operation_requests
    WHERE actor_id = v_actor AND operation_type = 'publish_operation_plan'
      AND idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_existing; END IF;
  END IF;

  SELECT * INTO v_plan FROM public.operation_plans WHERE id = p_plan_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Operation plan not found'; END IF;
  IF v_plan.status = 'published' THEN
    RETURN jsonb_build_object('plan_id', v_plan.id, 'status', 'published', 'row_version', v_plan.row_version);
  END IF;
  IF v_plan.status = 'cancelled' THEN RAISE EXCEPTION 'Cancelled plans cannot be published'; END IF;
  IF v_plan.row_version <> p_expected_row_version THEN RAISE EXCEPTION 'Plan changed since it was loaded'; END IF;
  IF lower(trim(COALESCE(p_confirmation,''))) <> 'publish' THEN RAISE EXCEPTION 'Type PUBLISH to confirm'; END IF;

  v_validation := public.admin_validate_operation_plan(p_plan_id);
  IF NOT COALESCE((v_validation->>'is_valid')::boolean, false) THEN
    UPDATE public.operation_plans
    SET status = 'validation_failed', validation_snapshot = v_validation,
        updated_by = v_actor, row_version = row_version + 1
    WHERE id = p_plan_id;
    RAISE EXCEPTION 'Operation plan validation failed: %', v_validation->'blockers';
  END IF;
  IF jsonb_array_length(v_validation->'warnings') > 0
     AND NULLIF(trim(COALESCE(p_warning_override_reason,'')), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required to publish a plan with warnings';
  END IF;

  UPDATE public.operation_plans
  SET status = 'published', validation_snapshot = v_validation,
      published_at = now(), published_by = v_actor, updated_by = v_actor,
      row_version = row_version + 1
  WHERE id = p_plan_id
  RETURNING * INTO v_plan;

  UPDATE public.operation_runs
  SET planning_status = CASE
        WHEN run_type IN ('immediate_ride','scheduled_ride','transport_leg') THEN 'ready_for_dispatch'
        ELSE 'planned'
      END,
      operational_status = CASE WHEN operational_status = 'scheduled' THEN 'ready' ELSE operational_status END,
      updated_by = v_actor,
      row_version = row_version + 1
  WHERE operation_plan_id = p_plan_id AND operational_status <> 'cancelled';

  SELECT * INTO v_booking FROM public.service_bookings WHERE id = v_plan.service_booking_id;
  UPDATE public.service_bookings
  SET status = CASE WHEN status = 'accepted' THEN 'resources_assigned' ELSE status END,
      updated_at = now()
  WHERE id = v_plan.service_booking_id;

  PERFORM private.operations_enqueue_notification(
    v_booking.booked_by_user_id,
    'service_scheduled',
    'Your service has been scheduled',
    'Your Access service plan is ready. Open the app for the latest schedule.',
    'operation-plan-published:' || p_plan_id::text,
    NULL, NULL, v_plan.service_booking_id, now()
  );

  v_existing := jsonb_build_object(
    'plan_id', v_plan.id, 'status', v_plan.status,
    'row_version', v_plan.row_version, 'validation', v_validation
  );
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.operations_operation_requests(actor_id, operation_type, idempotency_key, result)
    VALUES (v_actor, 'publish_operation_plan', p_idempotency_key, v_existing)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN v_existing;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_assign_operation_resource(
  p_run_id uuid,
  p_resource_type text,
  p_resource_id uuid,
  p_expected_run_version integer,
  p_assignment_source text DEFAULT 'administrator',
  p_reason text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_actor uuid := public.operations_require_admin();
  v_run public.operation_runs%ROWTYPE;
  v_assignment public.operation_run_assignments%ROWTYPE;
  v_existing jsonb;
  v_deadline timestamptz;
BEGIN
  IF p_resource_type NOT IN ('driver','vehicle','companion') THEN RAISE EXCEPTION 'Invalid resource type'; END IF;
  IF p_assignment_source NOT IN ('administrator','immediate_dispatch','booking_assignment','reassignment') THEN
    RAISE EXCEPTION 'Invalid assignment source';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT result INTO v_existing FROM public.operations_operation_requests
    WHERE actor_id = v_actor AND operation_type = 'assign_operation_resource'
      AND idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_existing; END IF;
  END IF;

  SELECT * INTO v_run FROM public.operation_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Operation run not found'; END IF;
  IF v_run.row_version <> p_expected_run_version THEN RAISE EXCEPTION 'Operation changed since it was loaded'; END IF;
  IF v_run.operational_status IN ('completed','cancelled','failed') THEN RAISE EXCEPTION 'Closed operations cannot be assigned'; END IF;
  IF v_run.planned_start_at IS NULL OR v_run.planned_end_at IS NULL THEN RAISE EXCEPTION 'A complete run time window is required'; END IF;

  IF p_resource_type = 'driver' THEN
    IF NOT private.has_role(p_resource_id, 'driver'::public.app_role) THEN RAISE EXCEPTION 'Selected user is not a Driver'; END IF;
    IF EXISTS (
      SELECT 1 FROM public.resource_availability_windows availability
      WHERE availability.driver_user_id = p_resource_id
        AND availability.availability_type IN ('time_off','temporary_unavailable','operational_block')
        AND tstzrange(availability.starts_at, availability.ends_at, '[)') &&
            tstzrange(v_run.planned_start_at, v_run.planned_end_at, '[)')
    ) THEN RAISE EXCEPTION 'Driver is unavailable for this operation window'; END IF;
  ELSIF p_resource_type = 'vehicle' THEN
    IF NOT EXISTS (SELECT 1 FROM public.vehicle_profiles vehicle WHERE vehicle.id = p_resource_id AND vehicle.status = 'active') THEN
      RAISE EXCEPTION 'Vehicle is not active';
    END IF;
    IF public.vehicle_has_expired_mandatory_document(p_resource_id, v_run.service_type, v_run.planned_start_at::date) THEN
      RAISE EXCEPTION 'Vehicle has expired mandatory documents';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.vehicle_maintenance_work_orders work_order
      WHERE work_order.vehicle_id = p_resource_id
        AND work_order.status IN ('open','scheduled','in_progress')
        AND work_order.severity IN ('urgent','unsafe','critical','high')
    ) THEN RAISE EXCEPTION 'Vehicle is blocked by maintenance'; END IF;
    IF EXISTS (
      SELECT 1 FROM public.resource_availability_windows availability
      WHERE availability.vehicle_id = p_resource_id
        AND availability.availability_type IN ('temporary_unavailable','reservation','operational_block')
        AND tstzrange(availability.starts_at, availability.ends_at, '[)') &&
            tstzrange(v_run.planned_start_at, v_run.planned_end_at, '[)')
    ) THEN RAISE EXCEPTION 'Vehicle is unavailable for this operation window'; END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM public.companion_profiles companion
      WHERE companion.id = p_resource_id AND companion.admin_approved AND companion.is_available
    ) THEN RAISE EXCEPTION 'Companion is not approved or available'; END IF;
    IF EXISTS (
      SELECT 1 FROM public.resource_availability_windows availability
      WHERE availability.companion_id = p_resource_id
        AND availability.availability_type IN ('time_off','temporary_unavailable','operational_block')
        AND tstzrange(availability.starts_at, availability.ends_at, '[)') &&
            tstzrange(v_run.planned_start_at, v_run.planned_end_at, '[)')
    ) THEN RAISE EXCEPTION 'Companion is unavailable for this operation window'; END IF;
  END IF;

  UPDATE public.operation_run_assignments
  SET status = 'released', released_at = now(), release_reason = COALESCE(NULLIF(trim(p_reason), ''), 'Replaced by administrator'),
      row_version = row_version + 1, updated_at = now()
  WHERE operation_run_id = p_run_id
    AND resource_type = p_resource_type
    AND status IN ('proposed','reserved','assigned','acknowledged');

  v_deadline := CASE
    WHEN p_resource_type <> 'driver' THEN NULL
    WHEN v_run.planned_start_at > now() + interval '30 minutes'
      THEN LEAST(v_run.planned_start_at - interval '30 minutes', now() + interval '24 hours')
    ELSE now() + interval '10 minutes'
  END;

  INSERT INTO public.operation_run_assignments (
    operation_run_id, resource_type, driver_user_id, vehicle_id, companion_id,
    planned_start_at, planned_end_at, status, assignment_source, assigned_by,
    acknowledgement_deadline
  ) VALUES (
    p_run_id, p_resource_type,
    CASE WHEN p_resource_type = 'driver' THEN p_resource_id END,
    CASE WHEN p_resource_type = 'vehicle' THEN p_resource_id END,
    CASE WHEN p_resource_type = 'companion' THEN p_resource_id END,
    v_run.planned_start_at, v_run.planned_end_at, 'assigned', p_assignment_source,
    v_actor, v_deadline
  ) RETURNING * INTO v_assignment;

  UPDATE public.operation_runs
  SET planning_status = 'planned',
      dispatch_status = CASE
        WHEN p_resource_type = 'driver' AND p_assignment_source = 'reassignment' THEN 'manually_assigned'
        WHEN p_resource_type = 'driver' THEN 'assigned'
        ELSE dispatch_status
      END,
      updated_by = v_actor, row_version = row_version + 1
  WHERE id = p_run_id
  RETURNING * INTO v_run;

  IF p_resource_type = 'driver' THEN
    UPDATE public.rides
    SET driver_id = p_resource_id,
        accepted_at = COALESCE(accepted_at, now()),
        status = CASE WHEN status = 'requested' THEN 'accepted'::public.ride_status ELSE status END,
        updated_at = now()
    WHERE id = v_run.ride_id;
    IF v_run.service_booking_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.booking_driver_assignments b
      WHERE b.booking_id = v_run.service_booking_id
        AND b.driver_user_id = p_resource_id
        AND b.status IN ('proposed','confirmed')
        AND (b.itinerary_item_id IS NOT DISTINCT FROM v_run.itinerary_item_id)
    ) THEN
      INSERT INTO public.booking_driver_assignments(
        booking_id, itinerary_item_id, driver_user_id, status, assignment_role, notes
      ) VALUES (
        v_run.service_booking_id, v_run.itinerary_item_id, p_resource_id,
        'confirmed', 'primary', 'Phase 5 operation assignment'
      );
    END IF;
    PERFORM private.operations_enqueue_notification(
      p_resource_id, 'scheduled_assignment', 'New Access assignment',
      'A service has been assigned to you. Please acknowledge it in the Driver app.',
      'operation-assigned-driver:' || v_assignment.id::text,
      v_run.id, v_run.ride_id, v_run.service_booking_id, now()
    );
  ELSIF p_resource_type = 'vehicle' THEN
    UPDATE public.rides SET vehicle_id = p_resource_id, updated_at = now() WHERE id = v_run.ride_id;
    IF v_run.service_booking_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.booking_vehicle_assignments b
      WHERE b.booking_id = v_run.service_booking_id
        AND b.vehicle_id = p_resource_id
        AND b.status IN ('proposed','confirmed')
        AND (b.itinerary_item_id IS NOT DISTINCT FROM v_run.itinerary_item_id)
    ) THEN
      INSERT INTO public.booking_vehicle_assignments(
        booking_id, itinerary_item_id, vehicle_id, status, notes
      ) VALUES (
        v_run.service_booking_id, v_run.itinerary_item_id, p_resource_id,
        'confirmed', 'Phase 5 operation assignment'
      );
    END IF;
  ELSE
    IF v_run.service_booking_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.booking_companion_assignments b
      WHERE b.booking_id = v_run.service_booking_id
        AND b.companion_id = p_resource_id
        AND b.status IN ('proposed','confirmed')
        AND (b.itinerary_item_id IS NOT DISTINCT FROM v_run.itinerary_item_id)
    ) THEN
      INSERT INTO public.booking_companion_assignments(
        booking_id, itinerary_item_id, companion_id, status, notes
      ) VALUES (
        v_run.service_booking_id, v_run.itinerary_item_id, p_resource_id,
        'confirmed', 'Phase 5 operation assignment'
      );
    END IF;
  END IF;

  PERFORM private.operations_add_event(
    v_run.id, 'resource_assigned', NULL,
    jsonb_build_object('assignment_id', v_assignment.id, 'resource_type', p_resource_type, 'resource_id', p_resource_id),
    p_reason, '{}'::jsonb, v_actor, false, p_resource_type = 'driver'
  );

  v_existing := jsonb_build_object(
    'run', private.operations_run_response(v_run),
    'assignment_id', v_assignment.id,
    'resource_type', p_resource_type,
    'resource_id', p_resource_id,
    'assignment_status', v_assignment.status
  );
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.operations_operation_requests(actor_id, operation_type, idempotency_key, result)
    VALUES (v_actor, 'assign_operation_resource', p_idempotency_key, v_existing)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN v_existing;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_release_operation_resource(
  p_assignment_id uuid,
  p_expected_assignment_version integer,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_actor uuid := public.operations_require_admin();
  v_assignment public.operation_run_assignments%ROWTYPE;
  v_run public.operation_runs%ROWTYPE;
BEGIN
  IF NULLIF(trim(COALESCE(p_reason,'')), '') IS NULL THEN RAISE EXCEPTION 'A release reason is required'; END IF;
  SELECT * INTO v_assignment FROM public.operation_run_assignments WHERE id = p_assignment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Assignment not found'; END IF;
  IF v_assignment.row_version <> p_expected_assignment_version THEN RAISE EXCEPTION 'Assignment changed since it was loaded'; END IF;
  IF v_assignment.status IN ('released','declined','completed') THEN
    RETURN jsonb_build_object('assignment_id', v_assignment.id, 'status', v_assignment.status);
  END IF;

  UPDATE public.operation_run_assignments
  SET status = 'released', released_at = now(), release_reason = trim(p_reason),
      row_version = row_version + 1, updated_at = now()
  WHERE id = p_assignment_id RETURNING * INTO v_assignment;

  SELECT * INTO v_run FROM public.operation_runs WHERE id = v_assignment.operation_run_id FOR UPDATE;
  IF v_assignment.resource_type = 'driver' THEN
    UPDATE public.operation_runs
    SET dispatch_status = 'pending', updated_by = v_actor, row_version = row_version + 1
    WHERE id = v_run.id RETURNING * INTO v_run;
    UPDATE public.rides
    SET driver_id = NULL,
        status = CASE WHEN status = 'accepted' THEN 'requested'::public.ride_status ELSE status END,
        accepted_at = CASE WHEN status = 'accepted' THEN NULL ELSE accepted_at END,
        updated_at = now()
    WHERE id = v_run.ride_id AND status IN ('requested','accepted');
  ELSIF v_assignment.resource_type = 'vehicle' THEN
    UPDATE public.rides SET vehicle_id = NULL, updated_at = now()
    WHERE id = v_run.ride_id AND status IN ('requested','accepted');
  END IF;

  PERFORM private.operations_add_event(
    v_run.id, 'resource_released', to_jsonb(v_assignment),
    jsonb_build_object('assignment_id', v_assignment.id, 'status', v_assignment.status),
    p_reason, '{}'::jsonb, v_actor, false, true
  );
  RETURN jsonb_build_object(
    'assignment_id', v_assignment.id, 'status', v_assignment.status,
    'run', private.operations_run_response(v_run)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_reassign_operation_resource(
  p_assignment_id uuid,
  p_new_resource_id uuid,
  p_expected_assignment_version integer,
  p_reason text,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_actor uuid := public.operations_require_admin();
  v_assignment public.operation_run_assignments%ROWTYPE;
  v_run public.operation_runs%ROWTYPE;
  v_result jsonb;
BEGIN
  IF NULLIF(trim(COALESCE(p_reason,'')), '') IS NULL THEN RAISE EXCEPTION 'A reassignment reason is required'; END IF;
  SELECT * INTO v_assignment FROM public.operation_run_assignments WHERE id = p_assignment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Assignment not found'; END IF;
  IF v_assignment.row_version <> p_expected_assignment_version THEN RAISE EXCEPTION 'Assignment changed since it was loaded'; END IF;
  SELECT * INTO v_run FROM public.operation_runs WHERE id = v_assignment.operation_run_id FOR UPDATE;

  UPDATE public.operation_run_assignments
  SET status = 'released', released_at = now(), release_reason = trim(p_reason),
      row_version = row_version + 1, updated_at = now()
  WHERE id = p_assignment_id;

  v_result := public.admin_assign_operation_resource(
    v_run.id, v_assignment.resource_type, p_new_resource_id, v_run.row_version,
    'reassignment', p_reason, p_idempotency_key
  );
  RETURN v_result || jsonb_build_object('previous_assignment_id', p_assignment_id, 'reassigned_by', v_actor);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_dispatch_operation(
  p_run_id uuid,
  p_expected_run_version integer,
  p_candidate_limit integer DEFAULT 5,
  p_offer_minutes integer DEFAULT 2,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_actor uuid := public.operations_require_admin();
  v_run public.operation_runs%ROWTYPE;
  v_existing jsonb;
  v_wave integer;
  v_count integer := 0;
  v_candidate record;
  v_offer public.dispatch_offers%ROWTYPE;
BEGIN
  IF p_candidate_limit < 1 OR p_candidate_limit > 20 THEN RAISE EXCEPTION 'Candidate limit must be between 1 and 20'; END IF;
  IF p_offer_minutes < 1 OR p_offer_minutes > 15 THEN RAISE EXCEPTION 'Offer duration must be between 1 and 15 minutes'; END IF;
  IF p_idempotency_key IS NOT NULL THEN
    SELECT result INTO v_existing FROM public.operations_operation_requests
    WHERE actor_id = v_actor AND operation_type = 'dispatch_operation'
      AND idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_existing; END IF;
  END IF;

  SELECT * INTO v_run FROM public.operation_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Operation run not found'; END IF;
  IF v_run.row_version <> p_expected_run_version THEN RAISE EXCEPTION 'Operation changed since it was loaded'; END IF;
  IF v_run.run_type NOT IN ('immediate_ride','scheduled_ride','transport_leg') THEN RAISE EXCEPTION 'This run does not require Driver dispatch'; END IF;
  IF v_run.ride_id IS NULL THEN RAISE EXCEPTION 'Dispatch requires a linked ride'; END IF;
  IF v_run.is_verification_record THEN RAISE EXCEPTION 'Verification records cannot be dispatched'; END IF;
  IF v_run.operational_status IN ('completed','cancelled','failed') THEN RAISE EXCEPTION 'Closed operations cannot be dispatched'; END IF;
  IF v_run.dispatch_status IN ('assigned','acknowledged','manually_assigned') THEN
    RETURN jsonb_build_object('run', private.operations_run_response(v_run), 'offer_count', 0, 'already_assigned', true);
  END IF;

  UPDATE public.dispatch_offers
  SET status = 'expired', response_reason = 'Superseded by a new dispatch wave',
      row_version = row_version + 1, updated_at = now()
  WHERE operation_run_id = p_run_id AND status = 'offered';

  SELECT COALESCE(max(dispatch_wave), 0) + 1 INTO v_wave
  FROM public.dispatch_offers WHERE operation_run_id = p_run_id;

  FOR v_candidate IN
    SELECT
      driver.user_id AS driver_id,
      assignment.vehicle_id,
      driver.current_lat,
      driver.current_lng,
      driver.location_updated_at
    FROM public.driver_profiles driver
    JOIN public.vehicle_driver_assignments assignment
      ON assignment.driver_id = driver.user_id
     AND assignment.status = 'active'
     AND assignment.start_at <= now()
     AND (assignment.end_at IS NULL OR assignment.end_at > now())
    JOIN public.vehicle_profiles vehicle ON vehicle.id = assignment.vehicle_id
    WHERE driver.is_available
      AND private.has_role(driver.user_id, 'driver'::public.app_role)
      AND vehicle.status = 'active'
      AND NOT public.vehicle_has_expired_mandatory_document(
        vehicle.id, v_run.service_type, COALESCE(v_run.planned_start_at::date, CURRENT_DATE)
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.vehicle_maintenance_work_orders work_order
        WHERE work_order.vehicle_id = vehicle.id
          AND work_order.status IN ('open','scheduled','in_progress')
          AND work_order.severity IN ('urgent','unsafe','critical','high')
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.operation_run_assignments busy
        WHERE busy.driver_user_id = driver.user_id
          AND busy.status IN ('reserved','assigned','acknowledged')
          AND tstzrange(busy.planned_start_at, busy.planned_end_at, '[)') &&
              tstzrange(COALESCE(v_run.planned_start_at, now()), COALESCE(v_run.planned_end_at, now() + interval '1 hour'), '[)')
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.operation_run_assignments busy
        WHERE busy.vehicle_id = vehicle.id
          AND busy.status IN ('reserved','assigned','acknowledged')
          AND tstzrange(busy.planned_start_at, busy.planned_end_at, '[)') &&
              tstzrange(COALESCE(v_run.planned_start_at, now()), COALESCE(v_run.planned_end_at, now() + interval '1 hour'), '[)')
      )
    ORDER BY
      CASE WHEN driver.location_updated_at >= now() - interval '10 minutes' THEN 0 ELSE 1 END,
      CASE
        WHEN driver.current_lat IS NOT NULL AND driver.current_lng IS NOT NULL
          AND v_run.pickup_lat IS NOT NULL AND v_run.pickup_lng IS NOT NULL
        THEN power(driver.current_lat - v_run.pickup_lat, 2) + power(driver.current_lng - v_run.pickup_lng, 2)
        ELSE 999999
      END,
      driver.location_updated_at DESC NULLS LAST
    LIMIT p_candidate_limit
  LOOP
    INSERT INTO public.dispatch_offers (
      operation_run_id, ride_id, driver_user_id, vehicle_id, dispatch_wave,
      offered_at, expires_at, eligibility_snapshot, suitability_snapshot
    ) VALUES (
      v_run.id, v_run.ride_id, v_candidate.driver_id, v_candidate.vehicle_id, v_wave,
      now(), now() + make_interval(mins => p_offer_minutes),
      jsonb_build_object(
        'online', true,
        'location_updated_at', v_candidate.location_updated_at,
        'checked_at', now()
      ),
      jsonb_build_object('vehicle_id', v_candidate.vehicle_id, 'service_type', v_run.service_type)
    ) RETURNING * INTO v_offer;
    v_count := v_count + 1;

    INSERT INTO public.dispatch_offer_events (
      dispatch_offer_id, operation_run_id, event_type, new_state, actor_id
    ) VALUES (v_offer.id, v_run.id, 'offered', to_jsonb(v_offer), v_actor);

    PERFORM private.operations_enqueue_notification(
      v_candidate.driver_id, 'dispatch_offer', 'New ride offer',
      'A new Access ride offer is available for a limited time.',
      'dispatch-offer:' || v_offer.id::text,
      v_run.id, v_run.ride_id, v_run.service_booking_id, now()
    );
  END LOOP;

  IF v_count = 0 THEN
    INSERT INTO public.operational_alerts (
      operation_run_id, service_booking_id, ride_id, alert_type, severity,
      title, details, deduplication_key
    ) VALUES (
      v_run.id, v_run.service_booking_id, v_run.ride_id, 'no_driver', 'critical',
      'No eligible Driver found',
      jsonb_build_object('run_reference', v_run.run_reference, 'checked_at', now()),
      'no-driver:' || v_run.id::text
    ) ON CONFLICT DO NOTHING;
  END IF;

  UPDATE public.operation_runs
  SET dispatch_status = CASE WHEN v_count > 0 THEN 'offered' ELSE 'pending' END,
      operational_status = CASE WHEN v_count > 0 THEN 'dispatched' ELSE operational_status END,
      updated_by = v_actor, row_version = row_version + 1
  WHERE id = v_run.id RETURNING * INTO v_run;

  PERFORM private.operations_add_event(
    v_run.id, 'dispatch_wave_created', NULL,
    jsonb_build_object('wave', v_wave, 'offer_count', v_count),
    NULL, '{}'::jsonb, v_actor, false, true
  );

  v_existing := jsonb_build_object(
    'run', private.operations_run_response(v_run), 'dispatch_wave', v_wave, 'offer_count', v_count
  );
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.operations_operation_requests(actor_id, operation_type, idempotency_key, result)
    VALUES (v_actor, 'dispatch_operation', p_idempotency_key, v_existing)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN v_existing;
END;
$$;

CREATE OR REPLACE FUNCTION public.driver_accept_dispatch_offer(
  p_offer_id uuid,
  p_expected_offer_version integer,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_offer public.dispatch_offers%ROWTYPE;
  v_run public.operation_runs%ROWTYPE;
  v_existing jsonb;
  v_driver_assignment public.operation_run_assignments%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR NOT private.has_role(v_actor, 'driver'::public.app_role) THEN RAISE EXCEPTION 'Driver role required'; END IF;
  IF p_idempotency_key IS NOT NULL THEN
    SELECT result INTO v_existing FROM public.operations_operation_requests
    WHERE actor_id = v_actor AND operation_type = 'accept_dispatch_offer'
      AND idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_existing; END IF;
  END IF;

  SELECT * INTO v_offer FROM public.dispatch_offers
  WHERE id = p_offer_id AND driver_user_id = v_actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Dispatch offer not found'; END IF;
  SELECT * INTO v_run FROM public.operation_runs WHERE id = v_offer.operation_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Operation run not found'; END IF;

  IF v_run.dispatch_status IN ('assigned','acknowledged','manually_assigned') THEN
    UPDATE public.dispatch_offers
    SET status = CASE WHEN status = 'offered' THEN 'lost' ELSE status END,
        response_reason = COALESCE(response_reason, 'Another Driver accepted first'),
        row_version = row_version + 1, updated_at = now()
    WHERE id = v_offer.id RETURNING * INTO v_offer;
    RETURN jsonb_build_object('accepted', false, 'reason', 'already_assigned', 'offer_id', v_offer.id);
  END IF;
  IF v_offer.row_version <> p_expected_offer_version THEN RAISE EXCEPTION 'Offer changed since it was loaded'; END IF;
  IF v_offer.status <> 'offered' THEN RAISE EXCEPTION 'Offer is not available'; END IF;
  IF v_offer.expires_at <= now() THEN
    UPDATE public.dispatch_offers SET status = 'expired', response_reason = 'Offer expired',
      row_version = row_version + 1, updated_at = now() WHERE id = v_offer.id;
    RETURN jsonb_build_object('accepted', false, 'reason', 'expired', 'offer_id', v_offer.id);
  END IF;

  INSERT INTO public.operation_run_assignments (
    operation_run_id, resource_type, driver_user_id, planned_start_at, planned_end_at,
    status, assignment_source, assigned_by, acknowledgement_deadline, acknowledged_at
  ) VALUES (
    v_run.id, 'driver', v_actor,
    COALESCE(v_run.planned_start_at, now()), COALESCE(v_run.planned_end_at, now() + interval '1 hour'),
    'acknowledged', 'immediate_dispatch', v_actor, now(), now()
  ) RETURNING * INTO v_driver_assignment;

  IF v_offer.vehicle_id IS NOT NULL THEN
    INSERT INTO public.operation_run_assignments (
      operation_run_id, resource_type, vehicle_id, planned_start_at, planned_end_at,
      status, assignment_source, assigned_by, acknowledged_at
    ) VALUES (
      v_run.id, 'vehicle', v_offer.vehicle_id,
      COALESCE(v_run.planned_start_at, now()), COALESCE(v_run.planned_end_at, now() + interval '1 hour'),
      'acknowledged', 'immediate_dispatch', v_actor, now()
    );
  END IF;

  UPDATE public.dispatch_offers
  SET status = 'accepted', accepted_at = now(), row_version = row_version + 1, updated_at = now()
  WHERE id = v_offer.id RETURNING * INTO v_offer;
  UPDATE public.dispatch_offers
  SET status = 'lost', response_reason = 'Another Driver accepted first',
      row_version = row_version + 1, updated_at = now()
  WHERE operation_run_id = v_run.id AND id <> v_offer.id AND status = 'offered';

  UPDATE public.operation_runs
  SET dispatch_status = 'acknowledged', operational_status = 'dispatched',
      planning_status = 'ready_for_dispatch', updated_by = v_actor,
      row_version = row_version + 1
  WHERE id = v_run.id RETURNING * INTO v_run;

  UPDATE public.rides
  SET driver_id = v_actor, vehicle_id = COALESCE(v_offer.vehicle_id, vehicle_id),
      status = CASE WHEN status = 'requested' THEN 'accepted'::public.ride_status ELSE status END,
      accepted_at = COALESCE(accepted_at, now()), updated_at = now()
  WHERE id = v_run.ride_id;

  INSERT INTO public.dispatch_offer_events(
    dispatch_offer_id, operation_run_id, event_type, new_state, actor_id
  ) VALUES (v_offer.id, v_run.id, 'accepted', to_jsonb(v_offer), v_actor);
  PERFORM private.operations_add_event(
    v_run.id, 'dispatch_accepted', NULL,
    jsonb_build_object('offer_id', v_offer.id, 'driver_id', v_actor, 'vehicle_id', v_offer.vehicle_id),
    NULL, '{}'::jsonb, v_actor, true, true
  );
  PERFORM private.operations_enqueue_notification(
    v_run.passenger_id, 'driver_assigned', 'Driver assigned',
    'A Driver has accepted your Access service.',
    'driver-assigned:' || v_run.id::text,
    v_run.id, v_run.ride_id, v_run.service_booking_id, now()
  );

  v_existing := jsonb_build_object(
    'accepted', true, 'offer_id', v_offer.id,
    'assignment_id', v_driver_assignment.id,
    'run', private.operations_run_response(v_run)
  );
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.operations_operation_requests(actor_id, operation_type, idempotency_key, result)
    VALUES (v_actor, 'accept_dispatch_offer', p_idempotency_key, v_existing)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN v_existing;
END;
$$;

CREATE OR REPLACE FUNCTION public.driver_decline_dispatch_offer(
  p_offer_id uuid,
  p_expected_offer_version integer,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_offer public.dispatch_offers%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR NOT private.has_role(v_actor, 'driver'::public.app_role) THEN RAISE EXCEPTION 'Driver role required'; END IF;
  SELECT * INTO v_offer FROM public.dispatch_offers
  WHERE id = p_offer_id AND driver_user_id = v_actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Dispatch offer not found'; END IF;
  IF v_offer.status <> 'offered' THEN RETURN jsonb_build_object('declined', v_offer.status = 'declined', 'status', v_offer.status); END IF;
  IF v_offer.row_version <> p_expected_offer_version THEN RAISE EXCEPTION 'Offer changed since it was loaded'; END IF;
  UPDATE public.dispatch_offers
  SET status = 'declined', declined_at = now(), response_reason = NULLIF(trim(p_reason), ''),
      row_version = row_version + 1, updated_at = now()
  WHERE id = v_offer.id RETURNING * INTO v_offer;
  INSERT INTO public.dispatch_offer_events(
    dispatch_offer_id, operation_run_id, event_type, new_state, reason, actor_id
  ) VALUES (v_offer.id, v_offer.operation_run_id, 'declined', to_jsonb(v_offer), p_reason, v_actor);
  RETURN jsonb_build_object('declined', true, 'offer_id', v_offer.id, 'status', v_offer.status);
END;
$$;

CREATE OR REPLACE FUNCTION public.driver_acknowledge_operation(
  p_assignment_id uuid,
  p_expected_assignment_version integer,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_assignment public.operation_run_assignments%ROWTYPE;
  v_run public.operation_runs%ROWTYPE;
  v_existing jsonb;
BEGIN
  IF v_actor IS NULL OR NOT private.has_role(v_actor, 'driver'::public.app_role) THEN RAISE EXCEPTION 'Driver role required'; END IF;
  IF p_idempotency_key IS NOT NULL THEN
    SELECT result INTO v_existing FROM public.operations_operation_requests
    WHERE actor_id = v_actor AND operation_type = 'acknowledge_operation'
      AND idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_existing; END IF;
  END IF;
  SELECT * INTO v_assignment FROM public.operation_run_assignments
  WHERE id = p_assignment_id AND driver_user_id = v_actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Driver assignment not found'; END IF;
  IF v_assignment.status = 'acknowledged' THEN
    RETURN jsonb_build_object('acknowledged', true, 'assignment_id', v_assignment.id, 'row_version', v_assignment.row_version);
  END IF;
  IF v_assignment.row_version <> p_expected_assignment_version THEN RAISE EXCEPTION 'Assignment changed since it was loaded'; END IF;
  IF v_assignment.status NOT IN ('reserved','assigned') THEN RAISE EXCEPTION 'Assignment cannot be acknowledged'; END IF;

  UPDATE public.operation_run_assignments
  SET status = 'acknowledged', acknowledged_at = now(),
      row_version = row_version + 1, updated_at = now()
  WHERE id = v_assignment.id RETURNING * INTO v_assignment;
  UPDATE public.operation_runs
  SET dispatch_status = 'acknowledged', updated_by = v_actor, row_version = row_version + 1
  WHERE id = v_assignment.operation_run_id RETURNING * INTO v_run;
  PERFORM private.operations_add_event(v_run.id, 'driver_acknowledged', NULL,
    jsonb_build_object('assignment_id', v_assignment.id), NULL, '{}'::jsonb, v_actor, false, true);
  v_existing := jsonb_build_object(
    'acknowledged', true, 'assignment_id', v_assignment.id,
    'assignment_row_version', v_assignment.row_version,
    'run', private.operations_run_response(v_run)
  );
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.operations_operation_requests(actor_id, operation_type, idempotency_key, result)
    VALUES (v_actor, 'acknowledge_operation', p_idempotency_key, v_existing) ON CONFLICT DO NOTHING;
  END IF;
  RETURN v_existing;
END;
$$;

CREATE OR REPLACE FUNCTION public.driver_decline_operation(
  p_assignment_id uuid,
  p_expected_assignment_version integer,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_assignment public.operation_run_assignments%ROWTYPE;
  v_run public.operation_runs%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR NOT private.has_role(v_actor, 'driver'::public.app_role) THEN RAISE EXCEPTION 'Driver role required'; END IF;
  IF NULLIF(trim(COALESCE(p_reason,'')), '') IS NULL THEN RAISE EXCEPTION 'A decline reason is required'; END IF;
  SELECT * INTO v_assignment FROM public.operation_run_assignments
  WHERE id = p_assignment_id AND driver_user_id = v_actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Driver assignment not found'; END IF;
  IF v_assignment.row_version <> p_expected_assignment_version THEN RAISE EXCEPTION 'Assignment changed since it was loaded'; END IF;
  IF v_assignment.status NOT IN ('proposed','reserved','assigned') THEN RAISE EXCEPTION 'Assignment cannot be declined'; END IF;
  UPDATE public.operation_run_assignments
  SET status = 'declined', declined_at = now(), decline_reason = trim(p_reason),
      row_version = row_version + 1, updated_at = now()
  WHERE id = v_assignment.id RETURNING * INTO v_assignment;
  UPDATE public.operation_runs
  SET dispatch_status = 'rejected', updated_by = v_actor, row_version = row_version + 1
  WHERE id = v_assignment.operation_run_id RETURNING * INTO v_run;
  INSERT INTO public.operational_alerts(
    operation_run_id, service_booking_id, ride_id, alert_type, severity, title, details, deduplication_key
  ) VALUES (
    v_run.id, v_run.service_booking_id, v_run.ride_id, 'acknowledgement_overdue', 'warning',
    'Driver declined an assignment', jsonb_build_object('driver_id', v_actor, 'reason', trim(p_reason)),
    'driver-declined:' || v_assignment.id::text
  ) ON CONFLICT DO NOTHING;
  PERFORM private.operations_add_event(v_run.id, 'driver_declined', NULL,
    jsonb_build_object('assignment_id', v_assignment.id), p_reason, '{}'::jsonb, v_actor, false, true);
  RETURN jsonb_build_object('declined', true, 'assignment_id', v_assignment.id, 'run', private.operations_run_response(v_run));
END;
$$;

CREATE OR REPLACE FUNCTION public.driver_update_location(
  p_latitude double precision,
  p_longitude double precision,
  p_captured_at timestamptz,
  p_accuracy double precision DEFAULT NULL,
  p_heading double precision DEFAULT NULL,
  p_operation_run_id uuid DEFAULT NULL,
  p_source text DEFAULT 'browser'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_driver public.driver_profiles%ROWTYPE;
  v_run public.operation_runs%ROWTYPE;
  v_latest timestamptz;
  v_state text;
BEGIN
  IF v_actor IS NULL OR NOT private.has_role(v_actor, 'driver'::public.app_role) THEN RAISE EXCEPTION 'Driver role required'; END IF;
  IF p_latitude NOT BETWEEN -90 AND 90 OR p_longitude NOT BETWEEN -180 AND 180 THEN RAISE EXCEPTION 'Invalid coordinates'; END IF;
  IF p_accuracy IS NOT NULL AND (p_accuracy < 0 OR p_accuracy > 10000) THEN RAISE EXCEPTION 'Invalid location accuracy'; END IF;
  IF p_heading IS NOT NULL AND (p_heading < 0 OR p_heading > 360) THEN RAISE EXCEPTION 'Invalid heading'; END IF;
  IF p_captured_at > now() + interval '2 minutes' OR p_captured_at < now() - interval '30 minutes' THEN
    RAISE EXCEPTION 'Location timestamp is outside the accepted window';
  END IF;

  SELECT * INTO v_driver FROM public.driver_profiles WHERE user_id = v_actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Driver profile not found'; END IF;

  IF p_operation_run_id IS NOT NULL THEN
    SELECT run.* INTO v_run
    FROM public.operation_runs run
    JOIN public.operation_run_assignments assignment ON assignment.operation_run_id = run.id
    WHERE run.id = p_operation_run_id
      AND assignment.driver_user_id = v_actor
      AND assignment.status IN ('reserved','assigned','acknowledged')
      AND run.operational_status NOT IN ('completed','cancelled','failed')
    LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'Driver is not assigned to this active operation'; END IF;
  ELSIF NOT v_driver.is_available AND NOT EXISTS (
    SELECT 1
    FROM public.operation_run_assignments assignment
    JOIN public.operation_runs run ON run.id = assignment.operation_run_id
    WHERE assignment.driver_user_id = v_actor
      AND assignment.status IN ('reserved','assigned','acknowledged')
      AND run.operational_status NOT IN ('completed','cancelled','failed')
      AND run.planned_start_at <= now() + interval '2 hours'
  ) THEN
    RAISE EXCEPTION 'Location updates require online status or an active near-term operation';
  END IF;

  SELECT max(received_at) INTO v_latest FROM public.driver_location_history WHERE driver_user_id = v_actor;
  IF v_latest IS NOT NULL AND v_latest > now() - interval '8 seconds' THEN
    RETURN jsonb_build_object('accepted', false, 'reason', 'rate_limited', 'next_allowed_at', v_latest + interval '8 seconds');
  END IF;

  v_state := CASE
    WHEN p_captured_at >= now() - interval '2 minutes' THEN 'fresh'
    WHEN p_captured_at >= now() - interval '10 minutes' THEN 'delayed'
    ELSE 'stale'
  END;

  INSERT INTO public.driver_location_history(
    driver_user_id, operation_run_id, ride_id, latitude, longitude,
    accuracy_meters, heading, captured_at, source, freshness_state
  ) VALUES (
    v_actor, v_run.id, v_run.ride_id, p_latitude, p_longitude,
    p_accuracy, p_heading, p_captured_at, COALESCE(NULLIF(trim(p_source),''),'browser'), v_state
  );

  UPDATE public.driver_profiles
  SET current_lat = p_latitude, current_lng = p_longitude,
      location_accuracy = p_accuracy, heading = p_heading,
      location_updated_at = p_captured_at
  WHERE user_id = v_actor;

  IF v_run.ride_id IS NOT NULL THEN
    INSERT INTO public.ride_live_locations(
      ride_id, user_id, user_role, latitude, longitude, accuracy, heading, updated_at
    ) VALUES (
      v_run.ride_id, v_actor, 'driver', p_latitude, p_longitude, p_accuracy, p_heading, p_captured_at
    ) ON CONFLICT (ride_id, user_id) DO UPDATE SET
      latitude = EXCLUDED.latitude,
      longitude = EXCLUDED.longitude,
      accuracy = EXCLUDED.accuracy,
      heading = EXCLUDED.heading,
      updated_at = EXCLUDED.updated_at;
  END IF;

  RETURN jsonb_build_object(
    'accepted', true, 'captured_at', p_captured_at,
    'received_at', now(), 'freshness_state', v_state,
    'operation_run_id', v_run.id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.driver_transition_operation(
  p_run_id uuid,
  p_target_status text,
  p_expected_run_version integer,
  p_reason text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_run public.operation_runs%ROWTYPE;
  v_previous jsonb;
  v_existing jsonb;
  v_allowed boolean := false;
  v_ride_status public.ride_status;
BEGIN
  IF v_actor IS NULL OR NOT private.has_role(v_actor, 'driver'::public.app_role) THEN RAISE EXCEPTION 'Driver role required'; END IF;
  IF p_idempotency_key IS NOT NULL THEN
    SELECT result INTO v_existing FROM public.operations_operation_requests
    WHERE actor_id = v_actor AND operation_type = 'transition_operation'
      AND idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_existing; END IF;
  END IF;

  SELECT run.* INTO v_run
  FROM public.operation_runs run
  WHERE run.id = p_run_id
    AND EXISTS (
      SELECT 1 FROM public.operation_run_assignments assignment
      WHERE assignment.operation_run_id = run.id
        AND assignment.driver_user_id = v_actor
        AND assignment.status IN ('assigned','acknowledged')
    )
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Assigned operation not found'; END IF;
  IF v_run.row_version <> p_expected_run_version THEN RAISE EXCEPTION 'Operation changed since it was loaded'; END IF;

  v_allowed := CASE v_run.operational_status
    WHEN 'scheduled' THEN p_target_status IN ('ready','driver_en_route')
    WHEN 'ready' THEN p_target_status IN ('driver_en_route','cancelled')
    WHEN 'dispatched' THEN p_target_status IN ('driver_en_route')
    WHEN 'driver_en_route' THEN p_target_status IN ('driver_arrived','interrupted')
    WHEN 'driver_arrived' THEN p_target_status IN ('passenger_on_board','in_service','passenger_no_show','interrupted')
    WHEN 'passenger_on_board' THEN p_target_status IN ('in_service','interrupted')
    WHEN 'in_service' THEN p_target_status IN ('waiting','completed','interrupted')
    WHEN 'waiting' THEN p_target_status IN ('in_service','completed','interrupted')
    WHEN 'interrupted' THEN p_target_status IN ('in_service','cancelled','failed')
    ELSE false
  END;
  IF NOT v_allowed THEN RAISE EXCEPTION 'Invalid operation transition from % to %', v_run.operational_status, p_target_status; END IF;

  IF p_target_status IN ('passenger_on_board','in_service') AND v_run.ride_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.rides ride WHERE ride.id = v_run.ride_id AND ride.status = 'in_progress') THEN
    RAISE EXCEPTION 'Verify the ride start PIN before starting transport service';
  END IF;

  v_previous := to_jsonb(v_run);
  UPDATE public.operation_runs
  SET operational_status = p_target_status,
      actual_start_at = CASE WHEN p_target_status IN ('passenger_on_board','in_service') THEN COALESCE(actual_start_at, now()) ELSE actual_start_at END,
      actual_end_at = CASE WHEN p_target_status IN ('completed','cancelled','failed','passenger_no_show','driver_no_show') THEN COALESCE(actual_end_at, now()) ELSE actual_end_at END,
      updated_by = v_actor, row_version = row_version + 1
  WHERE id = v_run.id RETURNING * INTO v_run;

  IF v_run.ride_id IS NOT NULL THEN
    v_ride_status := CASE p_target_status
      WHEN 'driver_en_route' THEN 'driver_arriving'::public.ride_status
      WHEN 'driver_arrived' THEN 'arrived'::public.ride_status
      WHEN 'passenger_on_board' THEN 'in_progress'::public.ride_status
      WHEN 'in_service' THEN 'in_progress'::public.ride_status
      WHEN 'waiting' THEN 'in_progress'::public.ride_status
      WHEN 'completed' THEN 'completed'::public.ride_status
      WHEN 'cancelled' THEN 'cancelled'::public.ride_status
      ELSE NULL
    END;
    IF v_ride_status IS NOT NULL THEN
      UPDATE public.rides
      SET status = v_ride_status,
          driver_arrived_at = CASE WHEN v_ride_status = 'arrived' THEN COALESCE(driver_arrived_at, now()) ELSE driver_arrived_at END,
          started_at = CASE WHEN v_ride_status = 'in_progress' THEN COALESCE(started_at, now()) ELSE started_at END,
          completed_at = CASE WHEN v_ride_status = 'completed' THEN COALESCE(completed_at, now()) ELSE completed_at END,
          updated_at = now()
      WHERE id = v_run.ride_id;
    END IF;
  END IF;

  PERFORM private.operations_add_event(
    v_run.id, 'status_transition', v_previous, to_jsonb(v_run), p_reason,
    '{}'::jsonb, v_actor, true, true
  );

  IF p_target_status IN ('driver_en_route','driver_arrived','completed','cancelled','interrupted') THEN
    PERFORM private.operations_enqueue_notification(
      v_run.passenger_id,
      'operation_' || p_target_status,
      CASE p_target_status
        WHEN 'driver_en_route' THEN 'Your Driver is on the way'
        WHEN 'driver_arrived' THEN 'Your Driver has arrived'
        WHEN 'completed' THEN 'Service completed'
        WHEN 'cancelled' THEN 'Service cancelled'
        ELSE 'Service update'
      END,
      CASE p_target_status
        WHEN 'driver_en_route' THEN 'Your assigned Driver is travelling to the pickup point.'
        WHEN 'driver_arrived' THEN 'Your assigned Driver is waiting at the pickup point.'
        WHEN 'completed' THEN 'Your Access service has been completed.'
        WHEN 'cancelled' THEN 'Your Access service has been cancelled.'
        ELSE 'Your service has been interrupted. The operations team has been alerted.'
      END,
      'operation-status:' || v_run.id::text || ':' || p_target_status,
      v_run.id, v_run.ride_id, v_run.service_booking_id, now()
    );
  END IF;

  v_existing := jsonb_build_object('transitioned', true, 'run', private.operations_run_response(v_run));
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.operations_operation_requests(actor_id, operation_type, idempotency_key, result)
    VALUES (v_actor, 'transition_operation', p_idempotency_key, v_existing) ON CONFLICT DO NOTHING;
  END IF;
  RETURN v_existing;
END;
$$;

CREATE OR REPLACE FUNCTION public.driver_report_no_show(
  p_run_id uuid,
  p_expected_run_version integer,
  p_details text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_result jsonb;
  v_run public.operation_runs%ROWTYPE;
BEGIN
  IF NULLIF(trim(COALESCE(p_details,'')), '') IS NULL THEN RAISE EXCEPTION 'No-show details are required'; END IF;
  v_result := public.driver_transition_operation(
    p_run_id, 'passenger_no_show', p_expected_run_version, p_details,
    'no-show:' || p_run_id::text || ':' || v_actor::text
  );
  SELECT * INTO v_run FROM public.operation_runs WHERE id = p_run_id;
  INSERT INTO public.operational_incidents(
    operation_run_id, service_booking_id, ride_id, incident_type, severity,
    title, internal_notes, passenger_visible_summary, reported_by
  ) VALUES (
    v_run.id, v_run.service_booking_id, v_run.ride_id, 'passenger_no_show', 'medium',
    'Passenger no-show', trim(p_details),
    'The Driver could not complete pickup. Operations will follow up.', v_actor
  );
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.driver_report_incident(
  p_run_id uuid,
  p_incident_type text,
  p_severity text,
  p_title text,
  p_internal_notes text,
  p_passenger_visible_summary text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_run public.operation_runs%ROWTYPE;
  v_incident public.operational_incidents%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR NOT private.has_role(v_actor, 'driver'::public.app_role) THEN RAISE EXCEPTION 'Driver role required'; END IF;
  IF p_incident_type NOT IN ('delay','breakdown','driver_no_show','passenger_no_show','safety_concern','accessibility_failure','medical_escalation','route_disruption','service_interruption','other') THEN RAISE EXCEPTION 'Invalid incident type'; END IF;
  IF p_severity NOT IN ('low','medium','high','critical') THEN RAISE EXCEPTION 'Invalid incident severity'; END IF;
  SELECT run.* INTO v_run FROM public.operation_runs run
  WHERE run.id = p_run_id AND EXISTS (
    SELECT 1 FROM public.operation_run_assignments assignment
    WHERE assignment.operation_run_id = run.id AND assignment.driver_user_id = v_actor
      AND assignment.status IN ('assigned','acknowledged')
  );
  IF NOT FOUND THEN RAISE EXCEPTION 'Assigned operation not found'; END IF;
  INSERT INTO public.operational_incidents(
    operation_run_id, service_booking_id, ride_id, incident_type, severity,
    title, internal_notes, passenger_visible_summary, reported_by
  ) VALUES (
    v_run.id, v_run.service_booking_id, v_run.ride_id, p_incident_type, p_severity,
    trim(p_title), trim(p_internal_notes), NULLIF(trim(p_passenger_visible_summary), ''), v_actor
  ) RETURNING * INTO v_incident;
  INSERT INTO public.operational_incident_events(
    operational_incident_id, event_type, new_state, internal_note,
    passenger_visible_summary, actor_id
  ) VALUES (
    v_incident.id, 'reported', to_jsonb(v_incident), v_incident.internal_notes,
    v_incident.passenger_visible_summary, v_actor
  );
  PERFORM private.operations_add_event(
    v_run.id, 'incident_reported', NULL,
    jsonb_build_object('incident_id', v_incident.id, 'type', v_incident.incident_type, 'severity', v_incident.severity),
    NULL, '{}'::jsonb, v_actor, v_incident.passenger_visible_summary IS NOT NULL, true
  );
  RETURN jsonb_build_object(
    'incident_id', v_incident.id, 'incident_reference', v_incident.incident_reference,
    'status', v_incident.status
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_create_operational_incident(
  p_run_id uuid,
  p_incident_type text,
  p_severity text,
  p_title text,
  p_internal_notes text DEFAULT NULL,
  p_passenger_visible_summary text DEFAULT NULL,
  p_support_ticket_id uuid DEFAULT NULL,
  p_maintenance_work_order_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_actor uuid := public.operations_require_admin();
  v_run public.operation_runs%ROWTYPE;
  v_incident public.operational_incidents%ROWTYPE;
BEGIN
  IF p_incident_type NOT IN ('delay','breakdown','driver_no_show','passenger_no_show','safety_concern','accessibility_failure','medical_escalation','route_disruption','service_interruption','other') THEN RAISE EXCEPTION 'Invalid incident type'; END IF;
  IF p_severity NOT IN ('low','medium','high','critical') THEN RAISE EXCEPTION 'Invalid incident severity'; END IF;
  SELECT * INTO v_run FROM public.operation_runs WHERE id = p_run_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Operation run not found'; END IF;
  INSERT INTO public.operational_incidents(
    operation_run_id, service_booking_id, ride_id, support_ticket_id,
    maintenance_work_order_id, incident_type, severity, title, internal_notes,
    passenger_visible_summary, owner_admin_id, reported_by
  ) VALUES (
    v_run.id, v_run.service_booking_id, v_run.ride_id, p_support_ticket_id,
    p_maintenance_work_order_id, p_incident_type, p_severity, trim(p_title),
    NULLIF(trim(p_internal_notes), ''), NULLIF(trim(p_passenger_visible_summary), ''),
    v_actor, v_actor
  ) RETURNING * INTO v_incident;
  INSERT INTO public.operational_incident_events(
    operational_incident_id, event_type, new_state, internal_note,
    passenger_visible_summary, actor_id
  ) VALUES (
    v_incident.id, 'created', to_jsonb(v_incident), v_incident.internal_notes,
    v_incident.passenger_visible_summary, v_actor
  );
  RETURN jsonb_build_object('incident_id', v_incident.id, 'incident_reference', v_incident.incident_reference, 'status', v_incident.status);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_resolve_operational_alert(
  p_alert_id uuid,
  p_resolution_note text,
  p_dismiss boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_actor uuid := public.operations_require_admin();
  v_alert public.operational_alerts%ROWTYPE;
BEGIN
  IF NULLIF(trim(COALESCE(p_resolution_note,'')), '') IS NULL THEN RAISE EXCEPTION 'A resolution note is required'; END IF;
  UPDATE public.operational_alerts
  SET status = CASE WHEN p_dismiss THEN 'dismissed' ELSE 'resolved' END,
      resolved_at = now(), resolved_by = v_actor,
      resolution_note = trim(p_resolution_note), updated_at = now()
  WHERE id = p_alert_id AND status IN ('open','acknowledged')
  RETURNING * INTO v_alert;
  IF NOT FOUND THEN RAISE EXCEPTION 'Open alert not found'; END IF;
  RETURN jsonb_build_object('alert_id', v_alert.id, 'status', v_alert.status, 'resolved_at', v_alert.resolved_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_cancel_operation(
  p_run_id uuid,
  p_expected_run_version integer,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_actor uuid := public.operations_require_admin();
  v_run public.operation_runs%ROWTYPE;
BEGIN
  IF NULLIF(trim(COALESCE(p_reason,'')), '') IS NULL THEN RAISE EXCEPTION 'A cancellation reason is required'; END IF;
  SELECT * INTO v_run FROM public.operation_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Operation run not found'; END IF;
  IF v_run.row_version <> p_expected_run_version THEN RAISE EXCEPTION 'Operation changed since it was loaded'; END IF;
  IF v_run.operational_status = 'completed' THEN RAISE EXCEPTION 'Completed operations cannot be cancelled'; END IF;
  IF v_run.operational_status = 'cancelled' THEN RETURN jsonb_build_object('cancelled', true, 'run', private.operations_run_response(v_run)); END IF;

  UPDATE public.operation_runs
  SET operational_status = 'cancelled', planning_status = 'cancelled',
      dispatch_status = 'expired', actual_end_at = COALESCE(actual_end_at, now()),
      updated_by = v_actor, row_version = row_version + 1
  WHERE id = p_run_id RETURNING * INTO v_run;
  UPDATE public.operation_run_assignments
  SET status = 'released', released_at = now(), release_reason = trim(p_reason),
      row_version = row_version + 1, updated_at = now()
  WHERE operation_run_id = p_run_id AND status IN ('proposed','reserved','assigned','acknowledged');
  UPDATE public.dispatch_offers
  SET status = 'cancelled', response_reason = trim(p_reason),
      row_version = row_version + 1, updated_at = now()
  WHERE operation_run_id = p_run_id AND status = 'offered';
  UPDATE public.rides SET status = 'cancelled', updated_at = now() WHERE id = v_run.ride_id AND status <> 'completed';
  PERFORM private.operations_add_event(v_run.id, 'operation_cancelled', NULL, to_jsonb(v_run), p_reason, '{}'::jsonb, v_actor, true, true);
  PERFORM private.operations_enqueue_notification(
    v_run.passenger_id, 'operation_cancelled', 'Service cancelled', trim(p_reason),
    'operation-cancelled:' || v_run.id::text, v_run.id, v_run.ride_id, v_run.service_booking_id, now()
  );
  RETURN jsonb_build_object('cancelled', true, 'run', private.operations_run_response(v_run));
END;
$$;

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

CREATE OR REPLACE FUNCTION public.passenger_active_driver_location(p_operation_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_run public.operation_runs%ROWTYPE;
  v_location public.driver_location_history%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR NOT private.has_role(v_actor, 'passenger'::public.app_role) THEN RAISE EXCEPTION 'Passenger role required'; END IF;
  SELECT * INTO v_run FROM public.operation_runs
  WHERE id = p_operation_run_id AND passenger_id = v_actor;
  IF NOT FOUND THEN RAISE EXCEPTION 'Operation not found for this passenger'; END IF;
  IF v_run.dispatch_status NOT IN ('assigned','acknowledged','manually_assigned')
     OR v_run.operational_status NOT IN ('dispatched','driver_en_route','driver_arrived','passenger_on_board','in_service','waiting') THEN
    RETURN jsonb_build_object('available', false, 'reason', 'location_not_available');
  END IF;
  SELECT location.* INTO v_location
  FROM public.driver_location_history location
  JOIN public.operation_run_assignments assignment
    ON assignment.operation_run_id = v_run.id
   AND assignment.driver_user_id = location.driver_user_id
   AND assignment.status IN ('assigned','acknowledged')
  WHERE location.operation_run_id = v_run.id
    AND location.captured_at >= now() - interval '15 minutes'
  ORDER BY location.captured_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('available', false, 'reason', 'location_stale'); END IF;
  RETURN jsonb_build_object(
    'available', true,
    'latitude', v_location.latitude,
    'longitude', v_location.longitude,
    'accuracy', v_location.accuracy_meters,
    'heading', v_location.heading,
    'captured_at', v_location.captured_at,
    'freshness_state', v_location.freshness_state
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.passenger_report_operation_issue(
  p_operation_run_id uuid,
  p_subject text,
  p_description text,
  p_priority text DEFAULT 'normal'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_run public.operation_runs%ROWTYPE;
  v_ticket public.support_tickets;
BEGIN
  IF v_actor IS NULL OR NOT private.has_role(v_actor, 'passenger'::public.app_role) THEN RAISE EXCEPTION 'Passenger role required'; END IF;
  SELECT * INTO v_run FROM public.operation_runs WHERE id = p_operation_run_id AND passenger_id = v_actor;
  IF NOT FOUND THEN RAISE EXCEPTION 'Operation not found for this passenger'; END IF;
  v_ticket := public.support_create_ticket(
    'passenger', 'trip_issue', p_subject, p_description, p_priority,
    v_run.ride_id, v_run.service_booking_id, v_actor, NULL
  );
  RETURN jsonb_build_object('ticket_id', v_ticket.id, 'ticket_reference', v_ticket.ticket_reference);
END;
$$;

REVOKE ALL ON FUNCTION private.operations_actor_role(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.operations_add_event(uuid,text,jsonb,jsonb,text,jsonb,uuid,boolean,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.operations_enqueue_notification(uuid,text,text,text,text,uuid,uuid,uuid,timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.operations_run_response(public.operation_runs) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.operations_actor_role(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION private.operations_add_event(uuid,text,jsonb,jsonb,text,jsonb,uuid,boolean,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION private.operations_enqueue_notification(uuid,text,text,text,text,uuid,uuid,uuid,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION private.operations_run_response(public.operation_runs) TO service_role;

DO $$
DECLARE
  v_signature text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.admin_plan_service_booking(uuid,boolean,text)',
    'public.admin_validate_operation_plan(uuid)',
    'public.admin_publish_operation_plan(uuid,integer,text,text,text)',
    'public.admin_assign_operation_resource(uuid,text,uuid,integer,text,text,text)',
    'public.admin_release_operation_resource(uuid,integer,text)',
    'public.admin_reassign_operation_resource(uuid,uuid,integer,text,text)',
    'public.admin_dispatch_operation(uuid,integer,integer,integer,text)',
    'public.admin_create_operational_incident(uuid,text,text,text,text,text,uuid,uuid)',
    'public.admin_resolve_operational_alert(uuid,text,boolean)',
    'public.admin_cancel_operation(uuid,integer,text)',
    'public.driver_accept_dispatch_offer(uuid,integer,text)',
    'public.driver_decline_dispatch_offer(uuid,integer,text)',
    'public.driver_acknowledge_operation(uuid,integer,text)',
    'public.driver_decline_operation(uuid,integer,text)',
    'public.driver_update_location(double precision,double precision,timestamptz,double precision,double precision,uuid,text)',
    'public.driver_transition_operation(uuid,text,integer,text,text)',
    'public.driver_report_no_show(uuid,integer,text)',
    'public.driver_report_incident(uuid,text,text,text,text,text)',
    'public.passenger_operation_timeline(uuid,uuid)',
    'public.passenger_active_driver_location(uuid)',
    'public.passenger_report_operation_issue(uuid,text,text,text)'
  ] LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION ' || v_signature || ' FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION ' || v_signature || ' TO authenticated, service_role';
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';