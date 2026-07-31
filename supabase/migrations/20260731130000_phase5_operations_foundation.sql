-- Phase 5: canonical operational planning, resource reservations, dispatch,
-- reliability, location privacy, alerts and in-app notification delivery.
-- This migration is additive and preserves all Phase 1-4 records and flows.

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.operations_require_admin()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL OR NOT private.has_role(v_actor, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Administrator role required';
  END IF;
  RETURN v_actor;
END;
$$;

CREATE TABLE IF NOT EXISTS public.operation_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_reference text NOT NULL UNIQUE DEFAULT (
    'OP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
  ),
  service_booking_id uuid NOT NULL REFERENCES public.service_bookings(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','validation_failed','ready','published','cancelled')),
  validation_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_at timestamptz,
  published_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cancellation_reason text,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS operation_plans_one_active_booking_idx
  ON public.operation_plans(service_booking_id)
  WHERE status <> 'cancelled';
CREATE INDEX IF NOT EXISTS operation_plans_status_idx
  ON public.operation_plans(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.operation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_reference text NOT NULL UNIQUE DEFAULT (
    'RUN-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
  ),
  operation_plan_id uuid REFERENCES public.operation_plans(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('ride','service_booking','itinerary_item')),
  source_id uuid NOT NULL,
  ride_id uuid REFERENCES public.rides(id) ON DELETE SET NULL,
  service_booking_id uuid REFERENCES public.service_bookings(id) ON DELETE SET NULL,
  itinerary_item_id uuid REFERENCES public.booking_itinerary_items(id) ON DELETE SET NULL,
  passenger_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  run_type text NOT NULL CHECK (run_type IN (
    'immediate_ride','scheduled_ride','transport_leg','companion_service',
    'waiting_service','appointment_support','handover','overnight_support'
  )),
  service_type text NOT NULL,
  pickup_address text,
  pickup_lat double precision,
  pickup_lng double precision,
  destination_address text,
  destination_lat double precision,
  destination_lng double precision,
  planned_start_at timestamptz,
  planned_end_at timestamptz,
  actual_start_at timestamptz,
  actual_end_at timestamptz,
  passenger_count integer NOT NULL DEFAULT 1 CHECK (passenger_count > 0),
  wheelchair_count integer NOT NULL DEFAULT 0 CHECK (wheelchair_count >= 0),
  accessibility_requirements jsonb NOT NULL DEFAULT '[]'::jsonb,
  planning_status text NOT NULL DEFAULT 'unplanned' CHECK (planning_status IN (
    'unplanned','planning','planned','validation_failed','ready_for_dispatch','cancelled'
  )),
  dispatch_status text NOT NULL DEFAULT 'pending' CHECK (dispatch_status IN (
    'not_required','pending','offered','assigned','acknowledged','rejected','expired','manually_assigned'
  )),
  operational_status text NOT NULL DEFAULT 'scheduled' CHECK (operational_status IN (
    'scheduled','ready','dispatched','driver_en_route','driver_arrived',
    'passenger_on_board','in_service','waiting','completed','cancelled',
    'passenger_no_show','driver_no_show','failed','interrupted'
  )),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  is_verification_record boolean NOT NULL DEFAULT false,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (planned_end_at IS NULL OR planned_start_at IS NULL OR planned_end_at > planned_start_at),
  CHECK (actual_end_at IS NULL OR actual_start_at IS NULL OR actual_end_at >= actual_start_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS operation_runs_one_active_source_idx
  ON public.operation_runs(source_type, source_id)
  WHERE operational_status <> 'cancelled';
CREATE UNIQUE INDEX IF NOT EXISTS operation_runs_one_active_ride_idx
  ON public.operation_runs(ride_id)
  WHERE ride_id IS NOT NULL AND operational_status <> 'cancelled';
CREATE INDEX IF NOT EXISTS operation_runs_schedule_idx
  ON public.operation_runs(planned_start_at, operational_status);
CREATE INDEX IF NOT EXISTS operation_runs_booking_idx
  ON public.operation_runs(service_booking_id, planned_start_at);
CREATE INDEX IF NOT EXISTS operation_runs_passenger_idx
  ON public.operation_runs(passenger_id, planned_start_at DESC);
CREATE INDEX IF NOT EXISTS operation_runs_dispatch_idx
  ON public.operation_runs(dispatch_status, priority, planned_start_at);

CREATE TABLE IF NOT EXISTS public.operation_run_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_run_id uuid NOT NULL REFERENCES public.operation_runs(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  previous_state jsonb,
  new_state jsonb,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_role text,
  passenger_visible boolean NOT NULL DEFAULT false,
  driver_visible boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS operation_run_events_run_idx
  ON public.operation_run_events(operation_run_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.operation_run_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_run_id uuid NOT NULL REFERENCES public.operation_runs(id) ON DELETE CASCADE,
  resource_type text NOT NULL CHECK (resource_type IN ('driver','vehicle','companion')),
  driver_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  vehicle_id uuid REFERENCES public.vehicle_profiles(id) ON DELETE CASCADE,
  companion_id uuid REFERENCES public.companion_profiles(id) ON DELETE CASCADE,
  planned_start_at timestamptz NOT NULL,
  planned_end_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN (
    'proposed','reserved','assigned','acknowledged','declined','released','completed'
  )),
  assignment_source text NOT NULL DEFAULT 'administrator' CHECK (assignment_source IN (
    'administrator','immediate_dispatch','booking_assignment','reassignment'
  )),
  assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  acknowledgement_deadline timestamptz,
  acknowledged_at timestamptz,
  declined_at timestamptz,
  decline_reason text,
  released_at timestamptz,
  release_reason text,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (planned_end_at > planned_start_at),
  CHECK (
    (resource_type = 'driver' AND driver_user_id IS NOT NULL AND vehicle_id IS NULL AND companion_id IS NULL)
    OR (resource_type = 'vehicle' AND driver_user_id IS NULL AND vehicle_id IS NOT NULL AND companion_id IS NULL)
    OR (resource_type = 'companion' AND driver_user_id IS NULL AND vehicle_id IS NULL AND companion_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS operation_assignments_run_idx
  ON public.operation_run_assignments(operation_run_id, resource_type, status);
CREATE INDEX IF NOT EXISTS operation_assignments_driver_idx
  ON public.operation_run_assignments(driver_user_id, planned_start_at)
  WHERE driver_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS operation_assignments_vehicle_idx
  ON public.operation_run_assignments(vehicle_id, planned_start_at)
  WHERE vehicle_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS operation_assignments_companion_idx
  ON public.operation_run_assignments(companion_id, planned_start_at)
  WHERE companion_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'operation_assignments_driver_no_overlap'
  ) THEN
    ALTER TABLE public.operation_run_assignments
      ADD CONSTRAINT operation_assignments_driver_no_overlap
      EXCLUDE USING gist (
        driver_user_id WITH =,
        tstzrange(planned_start_at, planned_end_at, '[)') WITH &&
      ) WHERE (
        driver_user_id IS NOT NULL
        AND status IN ('reserved','assigned','acknowledged')
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'operation_assignments_vehicle_no_overlap'
  ) THEN
    ALTER TABLE public.operation_run_assignments
      ADD CONSTRAINT operation_assignments_vehicle_no_overlap
      EXCLUDE USING gist (
        vehicle_id WITH =,
        tstzrange(planned_start_at, planned_end_at, '[)') WITH &&
      ) WHERE (
        vehicle_id IS NOT NULL
        AND status IN ('reserved','assigned','acknowledged')
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'operation_assignments_companion_no_overlap'
  ) THEN
    ALTER TABLE public.operation_run_assignments
      ADD CONSTRAINT operation_assignments_companion_no_overlap
      EXCLUDE USING gist (
        companion_id WITH =,
        tstzrange(planned_start_at, planned_end_at, '[)') WITH &&
      ) WHERE (
        companion_id IS NOT NULL
        AND status IN ('reserved','assigned','acknowledged')
      );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.resource_availability_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_type text NOT NULL CHECK (resource_type IN ('driver','vehicle','companion')),
  driver_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  vehicle_id uuid REFERENCES public.vehicle_profiles(id) ON DELETE CASCADE,
  companion_id uuid REFERENCES public.companion_profiles(id) ON DELETE CASCADE,
  availability_type text NOT NULL CHECK (availability_type IN (
    'available','shift','time_off','temporary_unavailable','reservation','operational_block'
  )),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  timezone text NOT NULL DEFAULT 'Africa/Johannesburg',
  recurrence_rule jsonb,
  source text NOT NULL DEFAULT 'administrator',
  reason text,
  override_reason text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (
    (resource_type = 'driver' AND driver_user_id IS NOT NULL AND vehicle_id IS NULL AND companion_id IS NULL)
    OR (resource_type = 'vehicle' AND driver_user_id IS NULL AND vehicle_id IS NOT NULL AND companion_id IS NULL)
    OR (resource_type = 'companion' AND driver_user_id IS NULL AND vehicle_id IS NULL AND companion_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS resource_availability_driver_idx
  ON public.resource_availability_windows(driver_user_id, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS resource_availability_vehicle_idx
  ON public.resource_availability_windows(vehicle_id, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS resource_availability_companion_idx
  ON public.resource_availability_windows(companion_id, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS public.dispatch_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_run_id uuid NOT NULL REFERENCES public.operation_runs(id) ON DELETE CASCADE,
  ride_id uuid REFERENCES public.rides(id) ON DELETE SET NULL,
  driver_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vehicle_id uuid REFERENCES public.vehicle_profiles(id) ON DELETE SET NULL,
  dispatch_wave integer NOT NULL DEFAULT 1 CHECK (dispatch_wave > 0),
  status text NOT NULL DEFAULT 'offered' CHECK (status IN (
    'offered','accepted','declined','expired','cancelled','lost'
  )),
  offered_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  declined_at timestamptz,
  response_reason text,
  eligibility_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  suitability_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > offered_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS dispatch_offers_active_driver_run_idx
  ON public.dispatch_offers(operation_run_id, driver_user_id)
  WHERE status = 'offered';
CREATE INDEX IF NOT EXISTS dispatch_offers_driver_idx
  ON public.dispatch_offers(driver_user_id, status, expires_at);
CREATE INDEX IF NOT EXISTS dispatch_offers_run_idx
  ON public.dispatch_offers(operation_run_id, dispatch_wave, offered_at);

CREATE TABLE IF NOT EXISTS public.dispatch_offer_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_offer_id uuid NOT NULL REFERENCES public.dispatch_offers(id) ON DELETE CASCADE,
  operation_run_id uuid NOT NULL REFERENCES public.operation_runs(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  previous_state jsonb,
  new_state jsonb,
  reason text,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dispatch_offer_events_offer_idx
  ON public.dispatch_offer_events(dispatch_offer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notification_type text NOT NULL,
  title text NOT NULL,
  message text,
  ride_id uuid REFERENCES public.rides(id) ON DELETE CASCADE,
  service_booking_id uuid REFERENCES public.service_bookings(id) ON DELETE CASCADE,
  operation_run_id uuid REFERENCES public.operation_runs(id) ON DELETE CASCADE,
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  deduplication_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending','processing','delivered','retrying','failed','cancelled'
  )),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_retry_at timestamptz,
  last_error text,
  locked_at timestamptz,
  locked_by text,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notification_outbox_due_idx
  ON public.notification_outbox(status, scheduled_for, next_retry_at);
CREATE INDEX IF NOT EXISTS notification_outbox_recipient_idx
  ON public.notification_outbox(recipient_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.notification_delivery_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_outbox_id uuid NOT NULL REFERENCES public.notification_outbox(id) ON DELETE CASCADE,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  status text NOT NULL CHECK (status IN ('processing','delivered','failed')),
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  duration_ms integer CHECK (duration_ms IS NULL OR duration_ms >= 0)
);
CREATE INDEX IF NOT EXISTS notification_attempts_outbox_idx
  ON public.notification_delivery_attempts(notification_outbox_id, attempt_number DESC);

CREATE TABLE IF NOT EXISTS public.operational_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_run_id uuid REFERENCES public.operation_runs(id) ON DELETE CASCADE,
  service_booking_id uuid REFERENCES public.service_bookings(id) ON DELETE CASCADE,
  ride_id uuid REFERENCES public.rides(id) ON DELETE CASCADE,
  alert_type text NOT NULL CHECK (alert_type IN (
    'resource_conflict','no_driver','no_vehicle','no_companion',
    'acknowledgement_overdue','dispatch_exhausted','late_departure','late_arrival',
    'stale_location','vehicle_compliance','maintenance_blocker','route_change',
    'service_overrun','abandoned_run','notification_delivery_failure'
  )),
  severity text NOT NULL DEFAULT 'warning' CHECK (severity IN ('info','warning','critical')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved','dismissed')),
  title text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  deduplication_key text NOT NULL,
  acknowledged_at timestamptz,
  acknowledged_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS operational_alerts_active_dedupe_idx
  ON public.operational_alerts(deduplication_key)
  WHERE status IN ('open','acknowledged');
CREATE INDEX IF NOT EXISTS operational_alerts_status_idx
  ON public.operational_alerts(status, severity, created_at DESC);

CREATE TABLE IF NOT EXISTS public.operational_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_reference text NOT NULL UNIQUE DEFAULT (
    'INC-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
  ),
  operation_run_id uuid REFERENCES public.operation_runs(id) ON DELETE SET NULL,
  service_booking_id uuid REFERENCES public.service_bookings(id) ON DELETE SET NULL,
  ride_id uuid REFERENCES public.rides(id) ON DELETE SET NULL,
  support_ticket_id uuid REFERENCES public.support_tickets(id) ON DELETE SET NULL,
  maintenance_work_order_id uuid REFERENCES public.vehicle_maintenance_work_orders(id) ON DELETE SET NULL,
  incident_type text NOT NULL CHECK (incident_type IN (
    'delay','breakdown','driver_no_show','passenger_no_show','safety_concern',
    'accessibility_failure','medical_escalation','route_disruption',
    'service_interruption','other'
  )),
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','contained','resolved','closed')),
  title text NOT NULL,
  internal_notes text,
  passenger_visible_summary text,
  owner_admin_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reported_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  resolution_summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS operational_incidents_status_idx
  ON public.operational_incidents(status, severity, created_at DESC);
CREATE INDEX IF NOT EXISTS operational_incidents_run_idx
  ON public.operational_incidents(operation_run_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.operational_incident_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operational_incident_id uuid NOT NULL REFERENCES public.operational_incidents(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  previous_state jsonb,
  new_state jsonb,
  internal_note text,
  passenger_visible_summary text,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS incident_events_incident_idx
  ON public.operational_incident_events(operational_incident_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.operations_scheduler_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scheduler_key text NOT NULL UNIQUE,
  trigger_source text NOT NULL CHECK (trigger_source IN ('cron','admin','system')),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','succeeded','failed','partial')),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  processed_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  failure_reason text,
  duration_ms integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS operations_scheduler_runs_started_idx
  ON public.operations_scheduler_runs(started_at DESC);

CREATE TABLE IF NOT EXISTS public.operations_operation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  operation_type text NOT NULL,
  idempotency_key text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(actor_id, operation_type, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.driver_location_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  operation_run_id uuid REFERENCES public.operation_runs(id) ON DELETE CASCADE,
  ride_id uuid REFERENCES public.rides(id) ON DELETE CASCADE,
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy_meters double precision CHECK (accuracy_meters IS NULL OR accuracy_meters >= 0),
  heading double precision CHECK (heading IS NULL OR (heading >= 0 AND heading <= 360)),
  captured_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'browser',
  freshness_state text NOT NULL DEFAULT 'fresh' CHECK (freshness_state IN ('fresh','delayed','stale'))
);
CREATE INDEX IF NOT EXISTS driver_location_history_driver_idx
  ON public.driver_location_history(driver_user_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS driver_location_history_run_idx
  ON public.driver_location_history(operation_run_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS public.operation_reconciliation_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_type text NOT NULL,
  source_type text NOT NULL,
  source_id uuid,
  severity text NOT NULL DEFAULT 'warning' CHECK (severity IN ('info','warning','critical')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS operation_reconciliation_active_idx
  ON public.operation_reconciliation_issues(issue_type, source_type, source_id)
  WHERE status = 'open';

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS operation_run_id uuid REFERENCES public.operation_runs(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS operational_alert_id uuid REFERENCES public.operational_alerts(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS operational_incident_id uuid REFERENCES public.operational_incidents(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS notifications_operation_run_idx
  ON public.notifications(operation_run_id, created_at DESC);

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'operation_plans','operation_runs','operation_run_events','operation_run_assignments',
    'resource_availability_windows','dispatch_offers','dispatch_offer_events',
    'notification_outbox','notification_delivery_attempts','operational_alerts',
    'operational_incidents','operational_incident_events','operations_scheduler_runs',
    'operations_operation_requests','driver_location_history','operation_reconciliation_issues'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', v_table);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', v_table);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "Admins read operation plans" ON public.operation_plans;
CREATE POLICY "Admins read operation plans" ON public.operation_plans
  FOR SELECT TO authenticated USING (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins read operation runs" ON public.operation_runs;
CREATE POLICY "Admins read operation runs" ON public.operation_runs
  FOR SELECT TO authenticated USING (private.has_role(auth.uid(), 'admin'::public.app_role));
DROP POLICY IF EXISTS "Drivers read assigned operation runs" ON public.operation_runs;
CREATE POLICY "Drivers read assigned operation runs" ON public.operation_runs
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.operation_run_assignments assignment
      WHERE assignment.operation_run_id = operation_runs.id
        AND assignment.driver_user_id = auth.uid()
        AND assignment.status IN ('proposed','reserved','assigned','acknowledged','completed')
    )
    OR EXISTS (
      SELECT 1 FROM public.dispatch_offers offer
      WHERE offer.operation_run_id = operation_runs.id
        AND offer.driver_user_id = auth.uid()
        AND offer.status = 'offered'
        AND offer.expires_at > now()
    )
  );

DROP POLICY IF EXISTS "Admins read operation events" ON public.operation_run_events;
CREATE POLICY "Admins read operation events" ON public.operation_run_events
  FOR SELECT TO authenticated USING (private.has_role(auth.uid(), 'admin'::public.app_role));
DROP POLICY IF EXISTS "Drivers read visible operation events" ON public.operation_run_events;
CREATE POLICY "Drivers read visible operation events" ON public.operation_run_events
  FOR SELECT TO authenticated USING (
    driver_visible AND EXISTS (
      SELECT 1 FROM public.operation_run_assignments assignment
      WHERE assignment.operation_run_id = operation_run_events.operation_run_id
        AND assignment.driver_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins read operation assignments" ON public.operation_run_assignments;
CREATE POLICY "Admins read operation assignments" ON public.operation_run_assignments
  FOR SELECT TO authenticated USING (private.has_role(auth.uid(), 'admin'::public.app_role));
DROP POLICY IF EXISTS "Drivers read own operation assignments" ON public.operation_run_assignments;
CREATE POLICY "Drivers read own operation assignments" ON public.operation_run_assignments
  FOR SELECT TO authenticated USING (driver_user_id = auth.uid());

DROP POLICY IF EXISTS "Admins read availability" ON public.resource_availability_windows;
CREATE POLICY "Admins read availability" ON public.resource_availability_windows
  FOR SELECT TO authenticated USING (private.has_role(auth.uid(), 'admin'::public.app_role));
DROP POLICY IF EXISTS "Drivers read own availability" ON public.resource_availability_windows;
CREATE POLICY "Drivers read own availability" ON public.resource_availability_windows
  FOR SELECT TO authenticated USING (driver_user_id = auth.uid());

DROP POLICY IF EXISTS "Admins read dispatch offers" ON public.dispatch_offers;
CREATE POLICY "Admins read dispatch offers" ON public.dispatch_offers
  FOR SELECT TO authenticated USING (private.has_role(auth.uid(), 'admin'::public.app_role));
DROP POLICY IF EXISTS "Drivers read own dispatch offers" ON public.dispatch_offers;
CREATE POLICY "Drivers read own dispatch offers" ON public.dispatch_offers
  FOR SELECT TO authenticated USING (driver_user_id = auth.uid());

DROP POLICY IF EXISTS "Admins read dispatch offer events" ON public.dispatch_offer_events;
CREATE POLICY "Admins read dispatch offer events" ON public.dispatch_offer_events
  FOR SELECT TO authenticated USING (private.has_role(auth.uid(), 'admin'::public.app_role));
DROP POLICY IF EXISTS "Drivers read own dispatch events" ON public.dispatch_offer_events;
CREATE POLICY "Drivers read own dispatch events" ON public.dispatch_offer_events
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.dispatch_offers offer
      WHERE offer.id = dispatch_offer_events.dispatch_offer_id
        AND offer.driver_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins read notification outbox" ON public.notification_outbox;
CREATE POLICY "Admins read notification outbox" ON public.notification_outbox
  FOR SELECT TO authenticated USING (private.has_role(auth.uid(), 'admin'::public.app_role));
DROP POLICY IF EXISTS "Users read own notification outbox" ON public.notification_outbox;
CREATE POLICY "Users read own notification outbox" ON public.notification_outbox
  FOR SELECT TO authenticated USING (recipient_user_id = auth.uid());

DROP POLICY IF EXISTS "Admins read notification attempts" ON public.notification_delivery_attempts;
CREATE POLICY "Admins read notification attempts" ON public.notification_delivery_attempts
  FOR SELECT TO authenticated USING (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins read operational alerts" ON public.operational_alerts;
CREATE POLICY "Admins read operational alerts" ON public.operational_alerts
  FOR SELECT TO authenticated USING (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins read operational incidents" ON public.operational_incidents;
CREATE POLICY "Admins read operational incidents" ON public.operational_incidents
  FOR SELECT TO authenticated USING (private.has_role(auth.uid(), 'admin'::public.app_role));
DROP POLICY IF EXISTS "Drivers read assigned incidents" ON public.operational_incidents;
CREATE POLICY "Drivers read assigned incidents" ON public.operational_incidents
  FOR SELECT TO authenticated USING (
    operation_run_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.operation_run_assignments assignment
      WHERE assignment.operation_run_id = operational_incidents.operation_run_id
        AND assignment.driver_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins read operational incident events" ON public.operational_incident_events;
CREATE POLICY "Admins read operational incident events" ON public.operational_incident_events
  FOR SELECT TO authenticated USING (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins read scheduler runs" ON public.operations_scheduler_runs;
CREATE POLICY "Admins read scheduler runs" ON public.operations_scheduler_runs
  FOR SELECT TO authenticated USING (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins read operation requests" ON public.operations_operation_requests;
CREATE POLICY "Admins read operation requests" ON public.operations_operation_requests
  FOR SELECT TO authenticated USING (private.has_role(auth.uid(), 'admin'::public.app_role));
DROP POLICY IF EXISTS "Users read own operation requests" ON public.operations_operation_requests;
CREATE POLICY "Users read own operation requests" ON public.operations_operation_requests
  FOR SELECT TO authenticated USING (actor_id = auth.uid());

DROP POLICY IF EXISTS "Admins read driver location history" ON public.driver_location_history;
CREATE POLICY "Admins read driver location history" ON public.driver_location_history
  FOR SELECT TO authenticated USING (private.has_role(auth.uid(), 'admin'::public.app_role));
DROP POLICY IF EXISTS "Drivers read own location history" ON public.driver_location_history;
CREATE POLICY "Drivers read own location history" ON public.driver_location_history
  FOR SELECT TO authenticated USING (driver_user_id = auth.uid());

DROP POLICY IF EXISTS "Admins read operation reconciliation" ON public.operation_reconciliation_issues;
CREATE POLICY "Admins read operation reconciliation" ON public.operation_reconciliation_issues
  FOR SELECT TO authenticated USING (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP TRIGGER IF EXISTS operation_plans_updated_at ON public.operation_plans;
CREATE TRIGGER operation_plans_updated_at
  BEFORE UPDATE ON public.operation_plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS operation_runs_updated_at ON public.operation_runs;
CREATE TRIGGER operation_runs_updated_at
  BEFORE UPDATE ON public.operation_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS operation_assignments_updated_at ON public.operation_run_assignments;
CREATE TRIGGER operation_assignments_updated_at
  BEFORE UPDATE ON public.operation_run_assignments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS resource_availability_updated_at ON public.resource_availability_windows;
CREATE TRIGGER resource_availability_updated_at
  BEFORE UPDATE ON public.resource_availability_windows
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS dispatch_offers_updated_at ON public.dispatch_offers;
CREATE TRIGGER dispatch_offers_updated_at
  BEFORE UPDATE ON public.dispatch_offers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS notification_outbox_updated_at ON public.notification_outbox;
CREATE TRIGGER notification_outbox_updated_at
  BEFORE UPDATE ON public.notification_outbox
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS operational_alerts_updated_at ON public.operational_alerts;
CREATE TRIGGER operational_alerts_updated_at
  BEFORE UPDATE ON public.operational_alerts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS operational_incidents_updated_at ON public.operational_incidents;
CREATE TRIGGER operational_incidents_updated_at
  BEFORE UPDATE ON public.operational_incidents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS operation_reconciliation_updated_at ON public.operation_reconciliation_issues;
CREATE TRIGGER operation_reconciliation_updated_at
  BEFORE UPDATE ON public.operation_reconciliation_issues
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Existing active rides become canonical operation runs. No financial fields are copied.
INSERT INTO public.operation_runs (
  source_type, source_id, ride_id, service_booking_id, itinerary_item_id,
  passenger_id, run_type, service_type, pickup_address, pickup_lat, pickup_lng,
  destination_address, destination_lat, destination_lng, planned_start_at,
  planned_end_at, actual_start_at, actual_end_at, planning_status,
  dispatch_status, operational_status, created_at, updated_at
)
SELECT
  'ride', ride.id, ride.id, ride.service_booking_id, ride.itinerary_item_id,
  ride.passenger_id,
  CASE
    WHEN ride.request_type = 'scheduled' THEN 'scheduled_ride'
    ELSE 'immediate_ride'
  END,
  CASE WHEN ride.service_booking_id IS NULL THEN 'ride' ELSE 'transport' END,
  ride.pickup_address, ride.pickup_lat, ride.pickup_lng,
  ride.destination_address, ride.destination_lat, ride.destination_lng,
  COALESCE(ride.scheduled_at, ride.created_at),
  COALESCE(
    ride.scheduled_at + make_interval(secs => GREATEST(COALESCE(ride.estimated_duration_seconds, 3600), 900)),
    ride.created_at + interval '1 hour'
  ),
  ride.started_at, ride.completed_at,
  CASE WHEN ride.driver_id IS NULL THEN 'unplanned' ELSE 'planned' END,
  CASE WHEN ride.driver_id IS NULL THEN 'pending' ELSE 'assigned' END,
  CASE ride.status::text
    WHEN 'requested' THEN 'scheduled'
    WHEN 'accepted' THEN 'dispatched'
    WHEN 'driver_arriving' THEN 'driver_en_route'
    WHEN 'arrived' THEN 'driver_arrived'
    WHEN 'in_progress' THEN 'in_service'
    WHEN 'completed' THEN 'completed'
    WHEN 'cancelled' THEN 'cancelled'
    ELSE 'scheduled'
  END,
  ride.created_at, ride.updated_at
FROM public.rides ride
WHERE NOT EXISTS (
  SELECT 1 FROM public.operation_runs run
  WHERE run.source_type = 'ride' AND run.source_id = ride.id
)
ON CONFLICT DO NOTHING;

-- Preserve existing ride assignments as canonical run reservations where unambiguous.
INSERT INTO public.operation_run_assignments (
  operation_run_id, resource_type, driver_user_id, planned_start_at, planned_end_at,
  status, assignment_source, acknowledged_at, created_at, updated_at
)
SELECT
  run.id, 'driver', ride.driver_id, run.planned_start_at,
  COALESCE(run.planned_end_at, run.planned_start_at + interval '1 hour'),
  CASE WHEN ride.status::text IN ('accepted','driver_arriving','arrived','in_progress','completed')
       THEN 'acknowledged' ELSE 'assigned' END,
  'booking_assignment', ride.accepted_at, ride.created_at, ride.updated_at
FROM public.operation_runs run
JOIN public.rides ride ON ride.id = run.ride_id
WHERE ride.driver_id IS NOT NULL
  AND run.planned_start_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.operation_runs other_run
    JOIN public.rides other_ride ON other_ride.id = other_run.ride_id
    WHERE other_ride.driver_id = ride.driver_id
      AND other_run.id <> run.id
      AND other_run.planned_start_at IS NOT NULL
      AND tstzrange(other_run.planned_start_at, COALESCE(other_run.planned_end_at, other_run.planned_start_at + interval '1 hour'), '[)') &&
          tstzrange(run.planned_start_at, COALESCE(run.planned_end_at, run.planned_start_at + interval '1 hour'), '[)')
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.operation_run_assignments assignment
    WHERE assignment.operation_run_id = run.id
      AND assignment.resource_type = 'driver'
      AND assignment.driver_user_id = ride.driver_id
  )
ON CONFLICT DO NOTHING;

INSERT INTO public.operation_run_assignments (
  operation_run_id, resource_type, vehicle_id, planned_start_at, planned_end_at,
  status, assignment_source, created_at, updated_at
)
SELECT
  run.id, 'vehicle', ride.vehicle_id, run.planned_start_at,
  COALESCE(run.planned_end_at, run.planned_start_at + interval '1 hour'),
  'assigned', 'booking_assignment', ride.created_at, ride.updated_at
FROM public.operation_runs run
JOIN public.rides ride ON ride.id = run.ride_id
WHERE ride.vehicle_id IS NOT NULL
  AND run.planned_start_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.operation_runs other_run
    JOIN public.rides other_ride ON other_ride.id = other_run.ride_id
    WHERE other_ride.vehicle_id = ride.vehicle_id
      AND other_run.id <> run.id
      AND other_run.planned_start_at IS NOT NULL
      AND tstzrange(other_run.planned_start_at, COALESCE(other_run.planned_end_at, other_run.planned_start_at + interval '1 hour'), '[)') &&
          tstzrange(run.planned_start_at, COALESCE(run.planned_end_at, run.planned_start_at + interval '1 hour'), '[)')
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.operation_run_assignments assignment
    WHERE assignment.operation_run_id = run.id
      AND assignment.resource_type = 'vehicle'
      AND assignment.vehicle_id = ride.vehicle_id
  )
ON CONFLICT DO NOTHING;


INSERT INTO public.operation_reconciliation_issues (
  issue_type, source_type, source_id, severity, details
)
SELECT
  'overlapping_existing_driver_assignment', 'ride', ride.id, 'warning',
  jsonb_build_object('driver_id', ride.driver_id, 'run_id', run.id)
FROM public.operation_runs run
JOIN public.rides ride ON ride.id = run.ride_id
WHERE ride.driver_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.operation_runs other_run
    JOIN public.rides other_ride ON other_ride.id = other_run.ride_id
    WHERE other_ride.driver_id = ride.driver_id
      AND other_run.id <> run.id
      AND other_run.planned_start_at IS NOT NULL
      AND run.planned_start_at IS NOT NULL
      AND tstzrange(other_run.planned_start_at, COALESCE(other_run.planned_end_at, other_run.planned_start_at + interval '1 hour'), '[)') &&
          tstzrange(run.planned_start_at, COALESCE(run.planned_end_at, run.planned_start_at + interval '1 hour'), '[)')
  )
ON CONFLICT DO NOTHING;

INSERT INTO public.operation_reconciliation_issues (
  issue_type, source_type, source_id, severity, details
)
SELECT
  'overlapping_existing_vehicle_assignment', 'ride', ride.id, 'warning',
  jsonb_build_object('vehicle_id', ride.vehicle_id, 'run_id', run.id)
FROM public.operation_runs run
JOIN public.rides ride ON ride.id = run.ride_id
WHERE ride.vehicle_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.operation_runs other_run
    JOIN public.rides other_ride ON other_ride.id = other_run.ride_id
    WHERE other_ride.vehicle_id = ride.vehicle_id
      AND other_run.id <> run.id
      AND other_run.planned_start_at IS NOT NULL
      AND run.planned_start_at IS NOT NULL
      AND tstzrange(other_run.planned_start_at, COALESCE(other_run.planned_end_at, other_run.planned_start_at + interval '1 hour'), '[)') &&
          tstzrange(run.planned_start_at, COALESCE(run.planned_end_at, run.planned_start_at + interval '1 hour'), '[)')
  )
ON CONFLICT DO NOTHING;

-- Accepted specialist bookings receive a draft plan but are never auto-published.
INSERT INTO public.operation_plans (service_booking_id, status, created_at, updated_at)
SELECT booking.id, 'draft', booking.created_at, booking.updated_at
FROM public.service_bookings booking
WHERE booking.status IN ('accepted','resources_assigned','active')
  AND NOT EXISTS (
    SELECT 1 FROM public.operation_plans plan
    WHERE plan.service_booking_id = booking.id AND plan.status <> 'cancelled'
  )
ON CONFLICT DO NOTHING;

-- Flag Phase 4 verification records so they cannot silently enter real dispatch.
UPDATE public.operation_runs run
SET is_verification_record = true
FROM public.service_bookings booking
WHERE run.service_booking_id = booking.id
  AND (
    upper(COALESCE(booking.admin_notes, '')) LIKE '%PHASE 4 VERIFICATION RECORD%'
    OR upper(COALESCE(booking.metadata->>'verification_record', '')) IN ('TRUE','PHASE 4')
  );

INSERT INTO public.operation_reconciliation_issues (
  issue_type, source_type, source_id, severity, details
)
SELECT
  'verification_record', 'service_booking', booking.id, 'info',
  jsonb_build_object('booking_reference', booking.booking_reference)
FROM public.service_bookings booking
WHERE upper(COALESCE(booking.admin_notes, '')) LIKE '%PHASE 4 VERIFICATION RECORD%'
ON CONFLICT DO NOTHING;

INSERT INTO public.operation_reconciliation_issues (
  issue_type, source_type, source_id, severity, details
)
SELECT
  'ride_itinerary_missing_ride', 'itinerary_item', item.id, 'warning',
  jsonb_build_object(
    'booking_id', item.booking_id,
    'planned_start_at', item.planned_start_at,
    'title', item.title
  )
FROM public.booking_itinerary_items item
JOIN public.service_bookings booking ON booking.id = item.booking_id
WHERE item.item_type = 'ride'
  AND booking.status IN ('accepted','resources_assigned','active')
  AND NOT EXISTS (SELECT 1 FROM public.rides ride WHERE ride.itinerary_item_id = item.id)
ON CONFLICT DO NOTHING;

REVOKE INSERT, UPDATE, DELETE ON
  public.operation_plans,
  public.operation_runs,
  public.operation_run_events,
  public.operation_run_assignments,
  public.resource_availability_windows,
  public.dispatch_offers,
  public.dispatch_offer_events,
  public.notification_outbox,
  public.notification_delivery_attempts,
  public.operational_alerts,
  public.operational_incidents,
  public.operational_incident_events,
  public.operations_scheduler_runs,
  public.operations_operation_requests,
  public.driver_location_history,
  public.operation_reconciliation_issues
FROM authenticated;

REVOKE ALL ON FUNCTION public.operations_require_admin()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.operations_require_admin() TO service_role;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'operation_runs') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.operation_runs;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'operation_run_assignments') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.operation_run_assignments;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'dispatch_offers') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.dispatch_offers;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'operational_alerts') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.operational_alerts;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notification_outbox') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notification_outbox;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
