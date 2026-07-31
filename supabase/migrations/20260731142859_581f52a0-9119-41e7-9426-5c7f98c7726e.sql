-- Phase 5 reliable scheduler, conflict detection and notification outbox delivery.
-- The worker is callable manually and may be registered with pg_cron when available.

CREATE OR REPLACE FUNCTION public.operations_expire_dispatch_offers()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_offer record;
  v_count integer := 0;
BEGIN
  FOR v_offer IN
    UPDATE public.dispatch_offers offer
    SET status = 'expired', response_reason = COALESCE(response_reason, 'Offer expired'),
        row_version = row_version + 1, updated_at = now()
    WHERE offer.status = 'offered' AND offer.expires_at <= now()
    RETURNING offer.*
  LOOP
    v_count := v_count + 1;
    INSERT INTO public.dispatch_offer_events(
      dispatch_offer_id, operation_run_id, event_type, new_state, reason
    ) VALUES (
      v_offer.id, v_offer.operation_run_id, 'expired', to_jsonb(v_offer), v_offer.response_reason
    );
  END LOOP;

  UPDATE public.operation_runs run
  SET dispatch_status = 'expired', updated_at = now(), row_version = row_version + 1
  WHERE run.dispatch_status = 'offered'
    AND NOT EXISTS (
      SELECT 1 FROM public.dispatch_offers offer
      WHERE offer.operation_run_id = run.id AND offer.status = 'offered' AND offer.expires_at > now()
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.operation_run_assignments assignment
      WHERE assignment.operation_run_id = run.id
        AND assignment.resource_type = 'driver'
        AND assignment.status IN ('assigned','acknowledged')
    );

  INSERT INTO public.operational_alerts(
    operation_run_id, service_booking_id, ride_id, alert_type, severity,
    title, details, deduplication_key
  )
  SELECT
    run.id, run.service_booking_id, run.ride_id, 'dispatch_exhausted', 'critical',
    'Dispatch offers expired without acceptance',
    jsonb_build_object('run_reference', run.run_reference, 'detected_at', now()),
    'dispatch-exhausted:' || run.id::text
  FROM public.operation_runs run
  WHERE run.dispatch_status = 'expired'
    AND run.operational_status NOT IN ('completed','cancelled','failed')
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object('expired_offers', v_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.operations_create_due_notifications()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_passenger integer := 0;
  v_driver integer := 0;
BEGIN
  INSERT INTO public.notification_outbox(
    recipient_user_id, notification_type, title, message, ride_id,
    service_booking_id, operation_run_id, scheduled_for, deduplication_key
  )
  SELECT
    run.passenger_id,
    CASE WHEN run.planned_start_at <= now() + interval '2 hours' THEN 'service_reminder_2h' ELSE 'service_reminder_24h' END,
    CASE WHEN run.planned_start_at <= now() + interval '2 hours' THEN 'Your service starts soon' ELSE 'Upcoming Access service' END,
    CASE WHEN run.planned_start_at <= now() + interval '2 hours'
      THEN 'Your Access service is scheduled to start within two hours.'
      ELSE 'Your Access service is scheduled for tomorrow.' END,
    run.ride_id, run.service_booking_id, run.id, now(),
    'passenger-reminder:' || run.id::text || ':' ||
      CASE WHEN run.planned_start_at <= now() + interval '2 hours' THEN '2h' ELSE '24h' END
  FROM public.operation_runs run
  WHERE run.operational_status IN ('scheduled','ready','dispatched')
    AND (
      run.planned_start_at BETWEEN now() + interval '23 hours 30 minutes' AND now() + interval '24 hours 30 minutes'
      OR run.planned_start_at BETWEEN now() + interval '1 hour 45 minutes' AND now() + interval '2 hours 15 minutes'
    )
  ON CONFLICT (deduplication_key) DO NOTHING;
  GET DIAGNOSTICS v_passenger = ROW_COUNT;

  INSERT INTO public.notification_outbox(
    recipient_user_id, notification_type, title, message, ride_id,
    service_booking_id, operation_run_id, scheduled_for, deduplication_key
  )
  SELECT
    assignment.driver_user_id,
    CASE WHEN assignment.acknowledgement_deadline <= now() + interval '15 minutes'
      THEN 'acknowledgement_reminder' ELSE 'upcoming_run' END,
    CASE WHEN assignment.acknowledgement_deadline <= now() + interval '15 minutes'
      THEN 'Please acknowledge your assignment' ELSE 'Upcoming Access assignment' END,
    CASE WHEN assignment.acknowledgement_deadline <= now() + interval '15 minutes'
      THEN 'Your acknowledgement deadline is approaching.'
      ELSE 'Your assigned service starts within two hours.' END,
    run.ride_id, run.service_booking_id, run.id, now(),
    'driver-reminder:' || assignment.id::text || ':' ||
      CASE WHEN assignment.acknowledgement_deadline <= now() + interval '15 minutes' THEN 'ack' ELSE '2h' END
  FROM public.operation_run_assignments assignment
  JOIN public.operation_runs run ON run.id = assignment.operation_run_id
  WHERE assignment.resource_type = 'driver'
    AND assignment.status IN ('reserved','assigned','acknowledged')
    AND run.operational_status NOT IN ('completed','cancelled','failed')
    AND (
      (assignment.status IN ('reserved','assigned') AND assignment.acknowledgement_deadline BETWEEN now() AND now() + interval '15 minutes')
      OR run.planned_start_at BETWEEN now() + interval '1 hour 45 minutes' AND now() + interval '2 hours 15 minutes'
    )
  ON CONFLICT (deduplication_key) DO NOTHING;
  GET DIAGNOSTICS v_driver = ROW_COUNT;

  RETURN jsonb_build_object('passenger_notifications', v_passenger, 'driver_notifications', v_driver);
END;
$$;

CREATE OR REPLACE FUNCTION public.operations_detect_conflicts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  INSERT INTO public.operational_alerts(
    operation_run_id, alert_type, severity, title, details, deduplication_key
  )
  SELECT
    later.operation_run_id, 'resource_conflict', 'critical',
    'Overlapping operation assignments detected',
    jsonb_build_object(
      'resource_type', later.resource_type,
      'assignment_id', later.id,
      'conflicting_assignment_id', earlier.id,
      'window', jsonb_build_array(later.planned_start_at, later.planned_end_at)
    ),
    'assignment-conflict:' || LEAST(later.id::text, earlier.id::text) || ':' || GREATEST(later.id::text, earlier.id::text)
  FROM public.operation_run_assignments later
  JOIN public.operation_run_assignments earlier
    ON earlier.id < later.id
   AND earlier.resource_type = later.resource_type
   AND earlier.status IN ('reserved','assigned','acknowledged')
   AND later.status IN ('reserved','assigned','acknowledged')
   AND tstzrange(earlier.planned_start_at, earlier.planned_end_at, '[)') &&
       tstzrange(later.planned_start_at, later.planned_end_at, '[)')
   AND (
     (later.resource_type = 'driver' AND earlier.driver_user_id = later.driver_user_id)
     OR (later.resource_type = 'vehicle' AND earlier.vehicle_id = later.vehicle_id)
     OR (later.resource_type = 'companion' AND earlier.companion_id = later.companion_id)
   )
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('conflicts_created', v_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.operations_detect_reliability_alerts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_ack integer := 0;
  v_late integer := 0;
  v_stale integer := 0;
  v_abandoned integer := 0;
  v_vehicle integer := 0;
BEGIN
  INSERT INTO public.operational_alerts(
    operation_run_id, service_booking_id, ride_id, alert_type, severity,
    title, details, deduplication_key
  )
  SELECT
    run.id, run.service_booking_id, run.ride_id, 'acknowledgement_overdue', 'critical',
    'Driver acknowledgement is overdue',
    jsonb_build_object('assignment_id', assignment.id, 'driver_id', assignment.driver_user_id, 'deadline', assignment.acknowledgement_deadline),
    'ack-overdue:' || assignment.id::text
  FROM public.operation_run_assignments assignment
  JOIN public.operation_runs run ON run.id = assignment.operation_run_id
  WHERE assignment.resource_type = 'driver'
    AND assignment.status IN ('reserved','assigned')
    AND assignment.acknowledgement_deadline IS NOT NULL
    AND assignment.acknowledgement_deadline < now()
    AND run.operational_status NOT IN ('completed','cancelled','failed')
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_ack = ROW_COUNT;

  INSERT INTO public.operational_alerts(
    operation_run_id, service_booking_id, ride_id, alert_type, severity,
    title, details, deduplication_key
  )
  SELECT
    run.id, run.service_booking_id, run.ride_id, 'late_departure', 'warning',
    'Operation has not departed on time',
    jsonb_build_object('planned_start_at', run.planned_start_at, 'status', run.operational_status),
    'late-departure:' || run.id::text
  FROM public.operation_runs run
  WHERE run.planned_start_at < now() - interval '15 minutes'
    AND run.operational_status IN ('scheduled','ready','dispatched')
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_late = ROW_COUNT;

  INSERT INTO public.operational_alerts(
    operation_run_id, service_booking_id, ride_id, alert_type, severity,
    title, details, deduplication_key
  )
  SELECT
    run.id, run.service_booking_id, run.ride_id, 'stale_location', 'warning',
    'Driver location is stale',
    jsonb_build_object('driver_id', assignment.driver_user_id, 'location_updated_at', driver.location_updated_at),
    'stale-location:' || run.id::text
  FROM public.operation_runs run
  JOIN public.operation_run_assignments assignment
    ON assignment.operation_run_id = run.id
   AND assignment.resource_type = 'driver'
   AND assignment.status IN ('assigned','acknowledged')
  LEFT JOIN public.driver_profiles driver ON driver.user_id = assignment.driver_user_id
  WHERE run.operational_status IN ('dispatched','driver_en_route','driver_arrived','passenger_on_board','in_service','waiting')
    AND (driver.location_updated_at IS NULL OR driver.location_updated_at < now() - interval '15 minutes')
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_stale = ROW_COUNT;

  INSERT INTO public.operational_alerts(
    operation_run_id, service_booking_id, ride_id, alert_type, severity,
    title, details, deduplication_key
  )
  SELECT
    run.id, run.service_booking_id, run.ride_id, 'abandoned_run', 'critical',
    'Operation appears abandoned',
    jsonb_build_object('actual_start_at', run.actual_start_at, 'status', run.operational_status),
    'abandoned-run:' || run.id::text
  FROM public.operation_runs run
  WHERE run.actual_start_at < now() - interval '8 hours'
    AND run.operational_status IN ('passenger_on_board','in_service','waiting','interrupted')
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_abandoned = ROW_COUNT;

  INSERT INTO public.operational_alerts(
    operation_run_id, service_booking_id, ride_id, alert_type, severity,
    title, details, deduplication_key
  )
  SELECT
    run.id, run.service_booking_id, run.ride_id,
    CASE WHEN vehicle.status <> 'active' THEN 'vehicle_compliance' ELSE 'maintenance_blocker' END,
    'critical',
    CASE WHEN vehicle.status <> 'active' THEN 'Assigned vehicle is not active' ELSE 'Assigned vehicle is blocked by maintenance or documents' END,
    jsonb_build_object('vehicle_id', vehicle.id, 'vehicle_status', vehicle.status),
    'vehicle-blocker:' || run.id::text || ':' || vehicle.id::text
  FROM public.operation_runs run
  JOIN public.operation_run_assignments assignment
    ON assignment.operation_run_id = run.id
   AND assignment.resource_type = 'vehicle'
   AND assignment.status IN ('reserved','assigned','acknowledged')
  JOIN public.vehicle_profiles vehicle ON vehicle.id = assignment.vehicle_id
  WHERE run.operational_status NOT IN ('completed','cancelled','failed')
    AND (
      vehicle.status <> 'active'
      OR public.vehicle_has_expired_mandatory_document(vehicle.id, run.service_type, COALESCE(run.planned_start_at::date, CURRENT_DATE))
      OR EXISTS (
        SELECT 1 FROM public.vehicle_maintenance_work_orders work_order
        WHERE work_order.vehicle_id = vehicle.id
          AND work_order.status IN ('open','scheduled','in_progress')
          AND work_order.severity IN ('urgent','unsafe','critical','high')
      )
    )
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_vehicle = ROW_COUNT;

  RETURN jsonb_build_object(
    'acknowledgement_overdue', v_ack,
    'late_departure', v_late,
    'stale_location', v_stale,
    'abandoned_runs', v_abandoned,
    'vehicle_blockers', v_vehicle
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.operations_deliver_notification_outbox(p_limit integer DEFAULT 100)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item public.notification_outbox%ROWTYPE;
  v_attempt integer;
  v_delivered integer := 0;
  v_failed integer := 0;
  v_started timestamptz;
BEGIN
  IF p_limit < 1 OR p_limit > 500 THEN RAISE EXCEPTION 'Delivery limit must be between 1 and 500'; END IF;

  FOR v_item IN
    SELECT *
    FROM public.notification_outbox outbox
    WHERE outbox.status IN ('pending','retrying')
      AND outbox.scheduled_for <= now()
      AND (outbox.next_retry_at IS NULL OR outbox.next_retry_at <= now())
    ORDER BY outbox.scheduled_for, outbox.created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    v_started := clock_timestamp();
    v_attempt := v_item.attempt_count + 1;
    UPDATE public.notification_outbox
    SET status = 'processing', locked_at = now(), locked_by = 'operations_scheduler',
        attempt_count = v_attempt, updated_at = now()
    WHERE id = v_item.id;

    INSERT INTO public.notification_delivery_attempts(
      notification_outbox_id, attempt_number, status, started_at
    ) VALUES (v_item.id, v_attempt, 'processing', v_started);

    BEGIN
      INSERT INTO public.notifications(
        user_id, ride_id, service_booking_id, operation_run_id,
        type, title, body
      ) VALUES (
        v_item.recipient_user_id, v_item.ride_id, v_item.service_booking_id,
        v_item.operation_run_id, v_item.notification_type, v_item.title, v_item.message
      );

      UPDATE public.notification_outbox
      SET status = 'delivered', delivered_at = now(), last_error = NULL,
          locked_at = NULL, locked_by = NULL, next_retry_at = NULL, updated_at = now()
      WHERE id = v_item.id;
      UPDATE public.notification_delivery_attempts
      SET status = 'delivered', completed_at = now(),
          duration_ms = GREATEST(0, (extract(epoch FROM (clock_timestamp() - v_started)) * 1000)::integer)
      WHERE notification_outbox_id = v_item.id AND attempt_number = v_attempt;
      v_delivered := v_delivered + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.notification_outbox
      SET status = CASE WHEN v_attempt >= 5 THEN 'failed' ELSE 'retrying' END,
          last_error = SQLERRM,
          next_retry_at = CASE WHEN v_attempt >= 5 THEN NULL ELSE now() + make_interval(mins => LEAST(60, power(2, v_attempt)::integer)) END,
          locked_at = NULL, locked_by = NULL, updated_at = now()
      WHERE id = v_item.id;
      UPDATE public.notification_delivery_attempts
      SET status = 'failed', error_message = SQLERRM, completed_at = now(),
          duration_ms = GREATEST(0, (extract(epoch FROM (clock_timestamp() - v_started)) * 1000)::integer)
      WHERE notification_outbox_id = v_item.id AND attempt_number = v_attempt;
      v_failed := v_failed + 1;
    END;
  END LOOP;

  INSERT INTO public.operational_alerts(
    alert_type, severity, title, details, deduplication_key
  )
  SELECT
    'notification_delivery_failure', 'warning', 'Notification delivery failed repeatedly',
    jsonb_build_object('outbox_id', outbox.id, 'recipient_user_id', outbox.recipient_user_id, 'last_error', outbox.last_error),
    'notification-failed:' || outbox.id::text
  FROM public.notification_outbox outbox
  WHERE outbox.status = 'failed'
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object('delivered', v_delivered, 'failed', v_failed);
END;
$$;

CREATE OR REPLACE FUNCTION public.operations_scheduler_tick(
  p_trigger_source text DEFAULT 'system',
  p_scheduler_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_key text := COALESCE(NULLIF(trim(p_scheduler_key), ''),
    'operations:' || to_char(date_trunc('minute', now()), 'YYYYMMDDHH24MI'));
  v_run public.operations_scheduler_runs%ROWTYPE;
  v_result jsonb := '{}'::jsonb;
  v_started timestamptz := clock_timestamp();
BEGIN
  IF p_trigger_source NOT IN ('cron','admin','system') THEN RAISE EXCEPTION 'Invalid scheduler trigger source'; END IF;
  INSERT INTO public.operations_scheduler_runs(scheduler_key, trigger_source, status)
  VALUES (v_key, p_trigger_source, 'running')
  ON CONFLICT (scheduler_key) DO NOTHING
  RETURNING * INTO v_run;
  IF NOT FOUND THEN
    SELECT * INTO v_run FROM public.operations_scheduler_runs WHERE scheduler_key = v_key;
    RETURN jsonb_build_object('deduplicated', true, 'scheduler_run_id', v_run.id, 'status', v_run.status, 'result', v_run.processed_counts);
  END IF;

  BEGIN
    UPDATE public.operation_runs
    SET operational_status = 'ready', row_version = row_version + 1, updated_at = now()
    WHERE operational_status = 'scheduled'
      AND planned_start_at BETWEEN now() AND now() + interval '2 hours'
      AND EXISTS (
        SELECT 1 FROM public.operation_run_assignments assignment
        WHERE assignment.operation_run_id = operation_runs.id
          AND assignment.status IN ('assigned','acknowledged')
      );

    v_result := v_result || jsonb_build_object('dispatch', public.operations_expire_dispatch_offers());
    v_result := v_result || jsonb_build_object('notifications_created', public.operations_create_due_notifications());
    v_result := v_result || jsonb_build_object('conflicts', public.operations_detect_conflicts());
    v_result := v_result || jsonb_build_object('alerts', public.operations_detect_reliability_alerts());
    v_result := v_result || jsonb_build_object('notifications_delivered', public.operations_deliver_notification_outbox(100));

    IF to_regprocedure('public.pricing_expire_due_quotes()') IS NOT NULL THEN
      v_result := v_result || jsonb_build_object('quotes', public.pricing_expire_due_quotes());
    END IF;

    DELETE FROM public.driver_location_history WHERE captured_at < now() - interval '30 days';
    DELETE FROM public.ride_live_locations live
    USING public.rides ride
    WHERE live.ride_id = ride.id
      AND ride.status IN ('completed','cancelled')
      AND live.updated_at < now() - interval '1 hour';

    UPDATE public.operations_scheduler_runs
    SET status = 'succeeded', completed_at = now(), processed_counts = v_result,
        duration_ms = GREATEST(0, (extract(epoch FROM (clock_timestamp() - v_started)) * 1000)::integer)
    WHERE id = v_run.id;
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.operations_scheduler_runs
    SET status = 'failed', completed_at = now(), processed_counts = v_result,
        failure_reason = SQLERRM,
        duration_ms = GREATEST(0, (extract(epoch FROM (clock_timestamp() - v_started)) * 1000)::integer)
    WHERE id = v_run.id;
    RAISE;
  END;

  RETURN jsonb_build_object('deduplicated', false, 'scheduler_run_id', v_run.id, 'status', 'succeeded', 'result', v_result);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_run_operations_scheduler(p_idempotency_key text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_actor uuid := public.operations_require_admin();
  v_key text := COALESCE(NULLIF(trim(p_idempotency_key), ''), gen_random_uuid()::text);
BEGIN
  RETURN public.operations_scheduler_tick('admin', 'admin:' || v_actor::text || ':' || v_key);
END;
$$;

REVOKE ALL ON FUNCTION public.operations_expire_dispatch_offers() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.operations_create_due_notifications() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.operations_detect_conflicts() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.operations_detect_reliability_alerts() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.operations_deliver_notification_outbox(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.operations_scheduler_tick(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.operations_expire_dispatch_offers() TO service_role;
GRANT EXECUTE ON FUNCTION public.operations_create_due_notifications() TO service_role;
GRANT EXECUTE ON FUNCTION public.operations_detect_conflicts() TO service_role;
GRANT EXECUTE ON FUNCTION public.operations_detect_reliability_alerts() TO service_role;
GRANT EXECUTE ON FUNCTION public.operations_deliver_notification_outbox(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.operations_scheduler_tick(text,text) TO service_role;
REVOKE ALL ON FUNCTION public.admin_run_operations_scheduler(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_run_operations_scheduler(text) TO authenticated, service_role;

-- Register the worker only when pg_cron is truly available. Empty-database replay
-- remains valid in environments where the extension is intentionally absent.
DO $$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL
     AND to_regprocedure('cron.schedule(text,text,text)') IS NOT NULL THEN
    BEGIN
      PERFORM cron.unschedule('access-operations-scheduler');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    PERFORM cron.schedule(
      'access-operations-scheduler',
      '* * * * *',
      'SELECT public.operations_scheduler_tick(''cron'', NULL);'
    );
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';