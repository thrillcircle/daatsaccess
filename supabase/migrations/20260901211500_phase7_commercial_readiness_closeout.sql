-- Phase 7 commercial-readiness closeout.
-- Extends existing payments, support, notification, audit and settings foundations.
-- Does not create a second pricing engine and does not expose financial data to drivers.

-- ---------------------------------------------------------------------------
-- 1. Prepaid cancellation settlement + refund processing
-- ---------------------------------------------------------------------------
ALTER TABLE public.payment_refunds
  ADD COLUMN IF NOT EXISTS automatic boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS settlement_type text,
  ADD COLUMN IF NOT EXISTS action_required_reason text;

ALTER TABLE public.payment_refunds DROP CONSTRAINT IF EXISTS payment_refunds_status_check;
ALTER TABLE public.payment_refunds
  ADD CONSTRAINT payment_refunds_status_check
  CHECK (status IN ('requested','processing','completed','failed','cancelled','action_required'));

ALTER TABLE public.payment_refunds DROP CONSTRAINT IF EXISTS payment_refunds_settlement_type_check;
ALTER TABLE public.payment_refunds
  ADD CONSTRAINT payment_refunds_settlement_type_check
  CHECK (settlement_type IS NULL OR settlement_type IN ('manual','cancellation_settlement'));

CREATE UNIQUE INDEX IF NOT EXISTS payment_refunds_cancellation_allocation_uidx
  ON public.payment_refunds(payment_id, ((metadata->>'cancellation_charge_id')))
  WHERE settlement_type = 'cancellation_settlement' AND status <> 'cancelled';

CREATE OR REPLACE FUNCTION private.queue_cancellation_settlement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $function$
DECLARE
  v_ride public.rides%ROWTYPE;
  v_payment public.payments%ROWTYPE;
  v_prepaid numeric(12,2) := 0;
  v_refund_target numeric(12,2) := 0;
  v_remaining numeric(12,2) := 0;
  v_reserved numeric(12,2);
  v_available numeric(12,2);
  v_alloc numeric(12,2);
  v_run_id uuid;
BEGIN
  SELECT * INTO v_ride FROM public.rides WHERE id = NEW.ride_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT COALESCE(SUM(p.amount),0)
    INTO v_prepaid
  FROM public.payments p
  WHERE p.ride_id = NEW.ride_id
    AND p.passenger_id = v_ride.passenger_id
    AND p.provider = 'payfast'
    AND p.status IN ('paid','refunded')
    AND p.purpose IN ('trip_fare','trip_adjustment');

  SELECT COALESCE(SUM(r.amount),0)
    INTO v_reserved
  FROM public.payment_refunds r
  JOIN public.payments p ON p.id = r.payment_id
  WHERE p.ride_id = NEW.ride_id
    AND r.status IN ('requested','processing','completed','action_required')
    AND r.settlement_type = 'cancellation_settlement';

  v_refund_target := GREATEST(round(v_prepaid - COALESCE(NEW.total_amount,0), 2), 0);
  v_remaining := GREATEST(v_refund_target - v_reserved, 0);

  IF v_remaining > 0 THEN
    FOR v_payment IN
      SELECT p.*
      FROM public.payments p
      WHERE p.ride_id = NEW.ride_id
        AND p.passenger_id = v_ride.passenger_id
        AND p.provider = 'payfast'
        AND p.status IN ('paid','refunded')
        AND p.purpose IN ('trip_adjustment','trip_fare')
      ORDER BY CASE WHEN p.purpose='trip_adjustment' THEN 0 ELSE 1 END, p.created_at DESC
      FOR UPDATE
    LOOP
      SELECT GREATEST(
        v_payment.amount - COALESCE(SUM(r.amount) FILTER (
          WHERE r.status IN ('requested','processing','completed','action_required')
        ),0), 0
      )
      INTO v_available
      FROM public.payment_refunds r
      WHERE r.payment_id = v_payment.id;

      v_alloc := LEAST(v_available, v_remaining);
      IF v_alloc > 0 THEN
        INSERT INTO public.payment_refunds(
          payment_id, requested_by, amount, reason, status, automatic,
          settlement_type, metadata
        ) VALUES (
          v_payment.id,
          NEW.cancelled_by,
          v_alloc,
          CASE
            WHEN COALESCE(NEW.total_amount,0) = 0 THEN 'Automatic refund after no-charge trip cancellation'
            ELSE 'Automatic refund of prepaid fare balance after cancellation settlement'
          END,
          'requested',
          true,
          'cancellation_settlement',
          jsonb_build_object(
            'ride_id', NEW.ride_id,
            'cancellation_charge_id', NEW.id,
            'cancellation_charge', NEW.total_amount,
            'prepaid_total', v_prepaid,
            'settlement_refund_target', v_refund_target,
            'automatic', true
          )
        ) ON CONFLICT DO NOTHING;
        v_remaining := GREATEST(v_remaining - v_alloc, 0);
      END IF;
      EXIT WHEN v_remaining <= 0;
    END LOOP;
  END IF;

  SELECT id INTO v_run_id
  FROM public.operation_runs
  WHERE ride_id = NEW.ride_id
  ORDER BY created_at DESC LIMIT 1;

  IF v_refund_target > 0 THEN
    PERFORM private.operations_enqueue_notification(
      v_ride.passenger_id,
      'refund_queued',
      'Refund being prepared',
      'Your unused prepaid trip balance is being prepared for refund.',
      'refund-queued:' || NEW.id::text,
      v_run_id, NEW.ride_id, v_ride.service_booking_id, now()
    );
  ELSIF COALESCE(NEW.total_amount,0) > v_prepaid THEN
    PERFORM private.operations_enqueue_notification(
      v_ride.passenger_id,
      'cancellation_balance_due',
      'Cancellation balance due',
      'Your prepaid fare has been applied to the cancellation charge. An additional balance remains.',
      'cancellation-balance:' || NEW.id::text,
      v_run_id, NEW.ride_id, v_ride.service_booking_id, now()
    );
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.queue_cancellation_settlement() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_queue_cancellation_settlement ON public.ride_cancellation_charges;
CREATE TRIGGER trg_queue_cancellation_settlement
AFTER INSERT OR UPDATE OF total_amount ON public.ride_cancellation_charges
FOR EACH ROW EXECUTE FUNCTION private.queue_cancellation_settlement();

CREATE OR REPLACE FUNCTION public.prepare_payment_refund(p_refund_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_refund public.payment_refunds%ROWTYPE;
  v_payment public.payments%ROWTYPE;
  v_is_admin boolean;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  v_is_admin := private.has_role(v_actor, 'admin'::app_role);

  SELECT * INTO v_refund FROM public.payment_refunds WHERE id=p_refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Refund request not found'; END IF;
  SELECT * INTO v_payment FROM public.payments WHERE id=v_refund.payment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;

  IF NOT v_is_admin AND NOT (
    v_refund.automatic
    AND v_payment.passenger_id = v_actor
    AND private.has_role(v_actor, 'passenger'::app_role)
  ) THEN
    RAISE EXCEPTION 'You cannot process this refund' USING ERRCODE='42501';
  END IF;

  IF v_payment.provider <> 'payfast' OR v_payment.provider_payment_id IS NULL THEN
    RAISE EXCEPTION 'This refund does not have a confirmed PayFast transaction';
  END IF;
  IF v_refund.status = 'completed' THEN
    RETURN jsonb_build_object('already_completed',true,'refund',to_jsonb(v_refund));
  END IF;
  IF v_refund.status NOT IN ('requested','failed','action_required') THEN
    RAISE EXCEPTION 'Refund is already being processed';
  END IF;

  UPDATE public.payment_refunds
    SET status='processing', failed_at=NULL, failure_reason=NULL,
        action_required_reason=NULL, updated_at=now()
  WHERE id=v_refund.id
  RETURNING * INTO v_refund;

  RETURN jsonb_build_object(
    'already_completed', false,
    'refund_id', v_refund.id,
    'payment_id', v_payment.id,
    'passenger_id', v_payment.passenger_id,
    'ride_id', v_payment.ride_id,
    'amount', v_refund.amount,
    'reason', v_refund.reason,
    'provider_payment_id', v_payment.provider_payment_id,
    'environment', v_payment.environment,
    'merchant_payment_id', v_payment.merchant_payment_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.prepare_payment_refund(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prepare_payment_refund(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.finalize_payment_refund(
  p_refund_id uuid,
  p_outcome text,
  p_provider_refund_id text DEFAULT NULL,
  p_provider_status text DEFAULT NULL,
  p_failure_reason text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $function$
DECLARE
  v_refund public.payment_refunds%ROWTYPE;
  v_payment public.payments%ROWTYPE;
  v_completed numeric(12,2);
  v_outcome text := lower(trim(COALESCE(p_outcome,'')));
  v_run_id uuid;
BEGIN
  IF current_user NOT IN ('service_role','postgres') THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE='42501';
  END IF;
  IF v_outcome NOT IN ('completed','failed','action_required') THEN
    RAISE EXCEPTION 'Invalid refund outcome';
  END IF;

  SELECT * INTO v_refund FROM public.payment_refunds WHERE id=p_refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Refund request not found'; END IF;
  SELECT * INTO v_payment FROM public.payments WHERE id=v_refund.payment_id FOR UPDATE;

  IF v_refund.status='completed' THEN RETURN to_jsonb(v_refund); END IF;

  UPDATE public.payment_refunds
  SET status=v_outcome,
      provider_refund_id=COALESCE(NULLIF(trim(p_provider_refund_id),''),provider_refund_id),
      provider_status=COALESCE(NULLIF(trim(p_provider_status),''),provider_status),
      metadata=metadata || COALESCE(p_metadata,'{}'::jsonb),
      completed_at=CASE WHEN v_outcome='completed' THEN now() ELSE completed_at END,
      failed_at=CASE WHEN v_outcome='failed' THEN now() ELSE NULL END,
      failure_reason=CASE WHEN v_outcome='failed' THEN NULLIF(trim(p_failure_reason),'') ELSE NULL END,
      action_required_reason=CASE WHEN v_outcome='action_required' THEN NULLIF(trim(p_failure_reason),'') ELSE NULL END,
      updated_at=now()
  WHERE id=v_refund.id
  RETURNING * INTO v_refund;

  IF v_outcome='completed' THEN
    SELECT COALESCE(SUM(amount),0) INTO v_completed
    FROM public.payment_refunds
    WHERE payment_id=v_payment.id AND status='completed';
    IF v_completed >= v_payment.amount - 0.01 THEN
      UPDATE public.payments SET status='refunded', updated_at=now() WHERE id=v_payment.id;
    END IF;

    SELECT id INTO v_run_id FROM public.operation_runs
      WHERE ride_id=v_payment.ride_id ORDER BY created_at DESC LIMIT 1;
    PERFORM private.operations_enqueue_notification(
      v_payment.passenger_id,
      'refund_processed',
      'Refund processed',
      'Your Access refund has been processed by PayFast.',
      'refund-completed:' || v_refund.id::text,
      v_run_id, v_payment.ride_id, NULL, now()
    );
  END IF;

  RETURN to_jsonb(v_refund);
END;
$function$;

REVOKE ALL ON FUNCTION public.finalize_payment_refund(uuid,text,text,text,text,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_payment_refund(uuid,text,text,text,text,jsonb)
  TO service_role;

-- Net additional cancellation payments against already-paid trip fare/adjustments.
CREATE OR REPLACE FUNCTION public.create_ride_payment(
  p_ride_id uuid,
  p_environment text DEFAULT 'sandbox',
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_ride public.rides%ROWTYPE;
  v_charge public.ride_cancellation_charges%ROWTYPE;
  v_payment public.payments%ROWTYPE;
  v_amount numeric(10,2);
  v_purpose text;
  v_pricing_version_id uuid;
  v_environment text := lower(trim(COALESCE(p_environment,'sandbox')));
  v_key text := COALESCE(NULLIF(trim(COALESCE(p_idempotency_key,'')),''),gen_random_uuid()::text);
  v_merchant_payment_id text;
  v_prepaid numeric(12,2) := 0;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  IF NOT private.has_role(v_actor,'passenger'::app_role) THEN
    RAISE EXCEPTION 'Passenger role required' USING ERRCODE='42501';
  END IF;
  IF v_environment NOT IN ('sandbox','live') THEN RAISE EXCEPTION 'Invalid payment environment'; END IF;
  IF length(v_key)>128 THEN RAISE EXCEPTION 'Idempotency key is too long'; END IF;

  SELECT * INTO v_ride FROM public.rides WHERE id=p_ride_id FOR UPDATE;
  IF NOT FOUND OR v_ride.passenger_id<>v_actor THEN
    RAISE EXCEPTION 'Ride not found for this passenger' USING ERRCODE='42501';
  END IF;

  IF v_ride.status='cancelled' THEN
    SELECT * INTO v_charge FROM public.ride_cancellation_charges WHERE ride_id=v_ride.id;
    IF NOT FOUND OR COALESCE(v_charge.total_amount,0)<=0 THEN
      RAISE EXCEPTION 'No additional payment is due for this cancelled trip';
    END IF;
    SELECT COALESCE(SUM(amount),0) INTO v_prepaid
    FROM public.payments
    WHERE ride_id=v_ride.id AND passenger_id=v_actor
      AND provider='payfast' AND status IN ('paid','refunded')
      AND purpose IN ('trip_fare','trip_adjustment');

    v_purpose := 'cancellation_charge';
    v_amount := round(GREATEST(v_charge.total_amount-v_prepaid,0),2);
    v_pricing_version_id := v_charge.pricing_version_id;
    IF v_amount<=0 THEN
      RAISE EXCEPTION 'Your prepaid fare already covers this cancellation settlement';
    END IF;
  ELSIF v_ride.status IN (
    'payment_pending'::public.ride_status,'requested'::public.ride_status,
    'accepted'::public.ride_status,'driver_arriving'::public.ride_status,
    'arrived'::public.ride_status,'in_progress'::public.ride_status,'completed'::public.ride_status
  ) THEN
    v_purpose := 'trip_fare';
    v_amount := round(v_ride.estimated_price,2);
    v_pricing_version_id := v_ride.pricing_version_id;
  ELSE
    RAISE EXCEPTION 'This trip is not payable in its current state';
  END IF;

  IF v_amount IS NULL OR v_amount<=0 THEN RAISE EXCEPTION 'No payable amount is available for this trip'; END IF;
  IF v_amount<5 THEN RAISE EXCEPTION 'PayFast requires a minimum payment amount of R5.00'; END IF;

  SELECT * INTO v_payment FROM public.payments
  WHERE passenger_id=v_actor AND idempotency_key=v_key
  ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'payment_id',v_payment.id,'ride_id',v_payment.ride_id,
      'merchant_payment_id',v_payment.merchant_payment_id,'amount',v_payment.amount,
      'currency',v_payment.currency,'status',v_payment.status,'purpose',v_payment.purpose,
      'environment',v_payment.environment,'idempotent',true,'already_paid',v_payment.status='paid'
    );
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('ride-payment:'||v_ride.id::text||':'||v_purpose,0));
  SELECT * INTO v_payment FROM public.payments
  WHERE ride_id=v_ride.id AND passenger_id=v_actor AND purpose=v_purpose
    AND status IN ('pending','paid') AND cancelled_at IS NULL
  ORDER BY (status='paid') DESC, created_at DESC LIMIT 1 FOR UPDATE;

  IF FOUND AND v_payment.status='paid' THEN
    IF abs(v_payment.amount-v_amount)>0.01 OR v_payment.pricing_version_id IS DISTINCT FROM v_pricing_version_id THEN
      RAISE EXCEPTION 'The paid amount no longer matches this settlement. Contact support before continuing';
    END IF;
    RETURN jsonb_build_object(
      'payment_id',v_payment.id,'ride_id',v_payment.ride_id,
      'merchant_payment_id',v_payment.merchant_payment_id,'amount',v_payment.amount,
      'currency',v_payment.currency,'status',v_payment.status,'purpose',v_payment.purpose,
      'environment',v_payment.environment,'idempotent',true,'already_paid',true
    );
  END IF;

  IF FOUND AND v_payment.status='pending'
     AND abs(v_payment.amount-v_amount)<=0.01
     AND v_payment.environment=v_environment
     AND v_payment.pricing_version_id IS NOT DISTINCT FROM v_pricing_version_id THEN
    RETURN jsonb_build_object(
      'payment_id',v_payment.id,'ride_id',v_payment.ride_id,
      'merchant_payment_id',v_payment.merchant_payment_id,'amount',v_payment.amount,
      'currency',v_payment.currency,'status',v_payment.status,'purpose',v_payment.purpose,
      'environment',v_payment.environment,'idempotent',true,'already_paid',false
    );
  END IF;

  IF FOUND AND v_payment.status='pending' THEN
    UPDATE public.payments SET status='failed',failed_at=now(),cancelled_at=now(),
      failure_reason='Superseded by a new authoritative settlement amount, pricing version, or environment',
      metadata=metadata||jsonb_build_object('superseded_at',now())
    WHERE id=v_payment.id;
  END IF;

  v_merchant_payment_id := 'DAATS-'||replace(gen_random_uuid()::text,'-','');
  INSERT INTO public.payments(
    ride_id,passenger_id,driver_id,amount,status,payment_method,provider,environment,purpose,
    merchant_payment_id,currency,pricing_version_id,idempotency_key,metadata
  ) VALUES (
    v_ride.id,v_actor,NULL,v_amount,'pending','payfast','payfast',v_environment,v_purpose,
    v_merchant_payment_id,'ZAR',v_pricing_version_id,v_key,
    jsonb_build_object(
      'ride_status_at_intent',v_ride.status,'route_version',v_ride.route_version,
      'cancellation_charge_id',CASE WHEN v_charge.id IS NULL THEN NULL ELSE v_charge.id END,
      'prepaid_applied',v_prepaid
    )
  ) RETURNING * INTO v_payment;

  RETURN jsonb_build_object(
    'payment_id',v_payment.id,'ride_id',v_payment.ride_id,
    'merchant_payment_id',v_payment.merchant_payment_id,'amount',v_payment.amount,
    'currency',v_payment.currency,'status',v_payment.status,'purpose',v_payment.purpose,
    'environment',v_payment.environment,'idempotent',false,'already_paid',false
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_ride_payment(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_ride_payment(uuid,text,text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Safety / SOS
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.safety_incident_reference_seq START 100001;

CREATE TABLE IF NOT EXISTS public.safety_incidents(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_reference text NOT NULL UNIQUE DEFAULT (
    'ACC-SOS-' || lpad(nextval('public.safety_incident_reference_seq')::text,6,'0')
  ),
  reported_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  reporter_role text NOT NULL CHECK (reporter_role IN ('passenger','driver')),
  passenger_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  driver_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ride_id uuid NOT NULL REFERENCES public.rides(id) ON DELETE RESTRICT,
  vehicle_id uuid REFERENCES public.vehicle_profiles(id) ON DELETE SET NULL,
  category text NOT NULL CHECK (category IN (
    'medical_emergency','driver_concern','vehicle_problem','accident','unsafe_situation',
    'passenger_medical_emergency','vehicle_breakdown','safety_security',
    'unable_to_continue','other_emergency'
  )),
  severity text NOT NULL DEFAULT 'critical' CHECK (severity IN ('high','critical')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','responding','resolved','closed')),
  latitude double precision,
  longitude double precision,
  accuracy_m numeric(10,2),
  description text,
  assigned_admin_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  response_notes text,
  resolution_summary text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.safety_incident_events(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES public.safety_incidents(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  previous_value jsonb,
  new_value jsonb,
  performed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS safety_incidents_status_created_idx ON public.safety_incidents(status,created_at DESC);
CREATE INDEX IF NOT EXISTS safety_incidents_ride_idx ON public.safety_incidents(ride_id,created_at DESC);

ALTER TABLE public.safety_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.safety_incident_events ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.safety_incidents, public.safety_incident_events TO authenticated;
GRANT ALL ON public.safety_incidents, public.safety_incident_events TO service_role;

DROP POLICY IF EXISTS "participants and admins read safety incidents" ON public.safety_incidents;
CREATE POLICY "participants and admins read safety incidents"
ON public.safety_incidents FOR SELECT TO authenticated
USING (
  reported_by=auth.uid() OR passenger_id=auth.uid() OR driver_id=auth.uid()
  OR private.has_role(auth.uid(),'admin'::app_role)
);

DROP POLICY IF EXISTS "participants and admins read safety incident events" ON public.safety_incident_events;
CREATE POLICY "participants and admins read safety incident events"
ON public.safety_incident_events FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.safety_incidents i
  WHERE i.id=safety_incident_events.incident_id
    AND (i.reported_by=auth.uid() OR i.passenger_id=auth.uid() OR i.driver_id=auth.uid()
         OR private.has_role(auth.uid(),'admin'::app_role))
));

DROP TRIGGER IF EXISTS safety_incidents_set_updated_at ON public.safety_incidents;
CREATE TRIGGER safety_incidents_set_updated_at BEFORE UPDATE ON public.safety_incidents
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.report_safety_incident(
  p_ride_id uuid,
  p_category text,
  p_latitude double precision DEFAULT NULL,
  p_longitude double precision DEFAULT NULL,
  p_accuracy_m numeric DEFAULT NULL,
  p_description text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $function$
DECLARE
  v_actor uuid:=auth.uid();
  v_ride public.rides%ROWTYPE;
  v_role text;
  v_category text:=lower(trim(COALESCE(p_category,'')));
  v_incident public.safety_incidents%ROWTYPE;
  v_admin record;
  v_run_id uuid;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_ride FROM public.rides WHERE id=p_ride_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Trip not found'; END IF;

  IF v_ride.passenger_id=v_actor AND private.has_role(v_actor,'passenger'::app_role) THEN
    v_role:='passenger';
  ELSIF v_ride.driver_id=v_actor AND private.has_role(v_actor,'driver'::app_role) THEN
    v_role:='driver';
  ELSE
    RAISE EXCEPTION 'You are not an active participant on this trip' USING ERRCODE='42501';
  END IF;

  IF v_ride.status NOT IN ('accepted','driver_arriving','arrived','in_progress') THEN
    RAISE EXCEPTION 'SOS is available only during an active assigned trip';
  END IF;
  IF v_category NOT IN (
    'medical_emergency','driver_concern','vehicle_problem','accident','unsafe_situation',
    'passenger_medical_emergency','vehicle_breakdown','safety_security',
    'unable_to_continue','other_emergency'
  ) THEN RAISE EXCEPTION 'Invalid safety category'; END IF;
  IF p_latitude IS NOT NULL AND (p_latitude < -90 OR p_latitude > 90) THEN RAISE EXCEPTION 'Invalid latitude'; END IF;
  IF p_longitude IS NOT NULL AND (p_longitude < -180 OR p_longitude > 180) THEN RAISE EXCEPTION 'Invalid longitude'; END IF;

  INSERT INTO public.safety_incidents(
    reported_by,reporter_role,passenger_id,driver_id,ride_id,vehicle_id,category,severity,
    latitude,longitude,accuracy_m,description
  ) VALUES (
    v_actor,v_role,v_ride.passenger_id,v_ride.driver_id,v_ride.id,v_ride.vehicle_id,v_category,
    CASE WHEN v_category IN ('medical_emergency','passenger_medical_emergency','accident','safety_security','unsafe_situation')
      THEN 'critical' ELSE 'high' END,
    p_latitude,p_longitude,p_accuracy_m,NULLIF(trim(COALESCE(p_description,'')),'')
  ) RETURNING * INTO v_incident;

  INSERT INTO public.safety_incident_events(incident_id,event_type,new_value,performed_by)
  VALUES(v_incident.id,'reported',to_jsonb(v_incident),v_actor);

  SELECT id INTO v_run_id FROM public.operation_runs
  WHERE ride_id=v_ride.id ORDER BY created_at DESC LIMIT 1;

  FOR v_admin IN SELECT user_id FROM public.user_roles WHERE role='admin'::app_role LOOP
    PERFORM private.operations_enqueue_notification(
      v_admin.user_id,
      'safety_sos',
      'SOS · '||v_incident.incident_reference,
      'An active trip participant reported a safety emergency.',
      'sos:'||v_incident.id::text||':'||v_admin.user_id::text,
      v_run_id,v_ride.id,v_ride.service_booking_id,now()
    );
  END LOOP;

  PERFORM public.write_system_audit(
    'safety.incident_reported','safety','safety_incident',v_incident.id::text,NULL,
    jsonb_build_object('rideId',v_ride.id,'category',v_category,'severity',v_incident.severity),
    jsonb_build_object('reporterRole',v_role)
  );

  RETURN jsonb_build_object(
    'id',v_incident.id,'reference',v_incident.incident_reference,
    'status',v_incident.status,'severity',v_incident.severity
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.report_safety_incident(uuid,text,double precision,double precision,numeric,text)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_safety_incident(uuid,text,double precision,double precision,numeric,text)
TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_update_safety_incident(
  p_incident_id uuid,
  p_status text,
  p_response_notes text DEFAULT NULL,
  p_resolution_summary text DEFAULT NULL,
  p_assign_to_self boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $function$
DECLARE
  v_actor uuid:=auth.uid();
  v_before public.safety_incidents%ROWTYPE;
  v_after public.safety_incidents%ROWTYPE;
  v_status text:=lower(trim(COALESCE(p_status,'')));
BEGIN
  IF v_actor IS NULL OR NOT private.has_role(v_actor,'admin'::app_role) THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';
  END IF;
  IF v_status NOT IN ('open','acknowledged','responding','resolved','closed') THEN
    RAISE EXCEPTION 'Invalid safety status';
  END IF;
  SELECT * INTO v_before FROM public.safety_incidents WHERE id=p_incident_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Safety incident not found'; END IF;
  IF v_status IN ('resolved','closed') AND NULLIF(trim(COALESCE(p_resolution_summary,'')),'') IS NULL
     AND NULLIF(trim(COALESCE(v_before.resolution_summary,'')),'') IS NULL THEN
    RAISE EXCEPTION 'A resolution summary is required';
  END IF;

  UPDATE public.safety_incidents
  SET status=v_status,
      assigned_admin_id=CASE WHEN p_assign_to_self THEN v_actor ELSE assigned_admin_id END,
      response_notes=COALESCE(NULLIF(trim(COALESCE(p_response_notes,'')),''),response_notes),
      resolution_summary=COALESCE(NULLIF(trim(COALESCE(p_resolution_summary,'')),''),resolution_summary),
      resolved_at=CASE WHEN v_status IN ('resolved','closed') THEN COALESCE(resolved_at,now()) ELSE NULL END,
      updated_at=now()
  WHERE id=p_incident_id RETURNING * INTO v_after;

  INSERT INTO public.safety_incident_events(incident_id,event_type,previous_value,new_value,performed_by)
  VALUES(p_incident_id,'admin_updated',to_jsonb(v_before),to_jsonb(v_after),v_actor);

  PERFORM public.write_system_audit(
    'safety.incident_updated','safety','safety_incident',p_incident_id::text,
    to_jsonb(v_before),to_jsonb(v_after),'{}'::jsonb
  );

  RETURN to_jsonb(v_after);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_update_safety_incident(uuid,text,text,text,boolean)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_safety_incident(uuid,text,text,text,boolean)
TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_safety_incidents(p_limit integer DEFAULT 250)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $function$
DECLARE v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT private.has_role(auth.uid(),'admin'::app_role) THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';
  END IF;
  SELECT COALESCE(jsonb_agg(row_data ORDER BY created_at DESC),'[]'::jsonb)
  INTO v_result
  FROM (
    SELECT i.created_at,
      to_jsonb(i) || jsonb_build_object(
        'reporter_name', reporter.full_name,
        'passenger_name', passenger.full_name,
        'driver_name', driver.full_name,
        'vehicle_name', vehicle.vehicle_name,
        'license_plate', vehicle.license_plate
      ) AS row_data
    FROM public.safety_incidents i
    LEFT JOIN public.profiles reporter ON reporter.user_id=i.reported_by
    LEFT JOIN public.profiles passenger ON passenger.user_id=i.passenger_id
    LEFT JOIN public.profiles driver ON driver.user_id=i.driver_id
    LEFT JOIN public.vehicle_profiles vehicle ON vehicle.id=i.vehicle_id
    ORDER BY i.created_at DESC
    LIMIT LEAST(GREATEST(p_limit,1),1000)
  ) x;
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_list_safety_incidents(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_safety_incidents(integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Multi-channel notification architecture.
-- Existing notification_outbox remains authoritative; external providers are
-- enabled only when their global channel is enabled and a provider is configured.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_notification_preferences(
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  in_app boolean NOT NULL DEFAULT true,
  push boolean NOT NULL DEFAULT true,
  sms boolean NOT NULL DEFAULT false,
  whatsapp boolean NOT NULL DEFAULT false,
  email boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.user_notification_preferences ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.user_notification_preferences TO authenticated;
GRANT ALL ON public.user_notification_preferences TO service_role;
DROP POLICY IF EXISTS "users read own notification preferences" ON public.user_notification_preferences;
CREATE POLICY "users read own notification preferences" ON public.user_notification_preferences
FOR SELECT TO authenticated USING(user_id=auth.uid() OR private.has_role(auth.uid(),'admin'::app_role));

CREATE TABLE IF NOT EXISTS public.notification_channel_deliveries(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_outbox_id uuid NOT NULL REFERENCES public.notification_outbox(id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK(channel IN ('in_app','push','sms','whatsapp','email')),
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','delivered','failed','skipped','action_required')),
  provider text,
  provider_message_id text,
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(notification_outbox_id,channel)
);
ALTER TABLE public.notification_channel_deliveries ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.notification_channel_deliveries TO authenticated;
GRANT ALL ON public.notification_channel_deliveries TO service_role;
DROP POLICY IF EXISTS "admins read channel deliveries" ON public.notification_channel_deliveries;
CREATE POLICY "admins read channel deliveries" ON public.notification_channel_deliveries
FOR SELECT TO authenticated USING(private.has_role(auth.uid(),'admin'::app_role));

CREATE OR REPLACE FUNCTION private.plan_notification_channels()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $function$
DECLARE
  v_pref public.user_notification_preferences%ROWTYPE;
  v_global jsonb;
  v_channel text;
  v_enabled boolean;
BEGIN
  SELECT * INTO v_pref FROM public.user_notification_preferences WHERE user_id=NEW.recipient_user_id;
  SELECT value INTO v_global FROM public.app_settings WHERE key='notifications.preferences';

  FOREACH v_channel IN ARRAY ARRAY['in_app','push','sms','whatsapp','email'] LOOP
    v_enabled := CASE v_channel
      WHEN 'in_app' THEN true
      WHEN 'push' THEN COALESCE(v_pref.push,true) AND COALESCE((v_global->>'push')::boolean,true)
      WHEN 'sms' THEN COALESCE(v_pref.sms,false) AND COALESCE((v_global->>'sms')::boolean,false)
      WHEN 'whatsapp' THEN COALESCE(v_pref.whatsapp,false) AND COALESCE((v_global->>'whatsapp')::boolean,false)
      WHEN 'email' THEN COALESCE(v_pref.email,true) AND COALESCE((v_global->>'email')::boolean,true)
      ELSE false END;

    INSERT INTO public.notification_channel_deliveries(
      notification_outbox_id,recipient_user_id,channel,status,provider,last_error
    ) VALUES (
      NEW.id,NEW.recipient_user_id,v_channel,
      CASE
        WHEN NOT v_enabled THEN 'skipped'
        WHEN v_channel='in_app' THEN 'queued'
        ELSE 'action_required'
      END,
      CASE WHEN v_channel='in_app' THEN 'access' ELSE NULL END,
      CASE WHEN v_enabled AND v_channel<>'in_app'
        THEN 'External provider is not configured for this channel'
        ELSE NULL END
    ) ON CONFLICT(notification_outbox_id,channel) DO NOTHING;
  END LOOP;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.plan_notification_channels() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_plan_notification_channels ON public.notification_outbox;
CREATE TRIGGER trg_plan_notification_channels
AFTER INSERT ON public.notification_outbox
FOR EACH ROW EXECUTE FUNCTION private.plan_notification_channels();

CREATE OR REPLACE FUNCTION public.get_notification_preferences()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $function$
DECLARE v_uid uuid:=auth.uid(); v_pref public.user_notification_preferences%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  INSERT INTO public.user_notification_preferences(user_id) VALUES(v_uid)
  ON CONFLICT(user_id) DO NOTHING;
  SELECT * INTO v_pref FROM public.user_notification_preferences WHERE user_id=v_uid;
  RETURN to_jsonb(v_pref);
END;
$function$;
REVOKE ALL ON FUNCTION public.get_notification_preferences() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_notification_preferences() TO authenticated;

CREATE OR REPLACE FUNCTION public.update_notification_preferences(
  p_push boolean,p_sms boolean,p_whatsapp boolean,p_email boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $function$
DECLARE v_uid uuid:=auth.uid(); v_pref public.user_notification_preferences%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  INSERT INTO public.user_notification_preferences(user_id,push,sms,whatsapp,email,updated_at)
  VALUES(v_uid,p_push,p_sms,p_whatsapp,p_email,now())
  ON CONFLICT(user_id) DO UPDATE SET
    push=excluded.push,sms=excluded.sms,whatsapp=excluded.whatsapp,email=excluded.email,updated_at=now()
  RETURNING * INTO v_pref;
  RETURN to_jsonb(v_pref);
END;
$function$;
REVOKE ALL ON FUNCTION public.update_notification_preferences(boolean,boolean,boolean,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_notification_preferences(boolean,boolean,boolean,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION private.sync_in_app_channel_delivery()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
BEGIN
  IF NEW.status='delivered' AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.notification_channel_deliveries
    SET status='delivered',provider='access',delivered_at=COALESCE(NEW.delivered_at,now()),
        updated_at=now()
    WHERE notification_outbox_id=NEW.id AND channel='in_app';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.sync_in_app_channel_delivery() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_sync_in_app_channel_delivery ON public.notification_outbox;
CREATE TRIGGER trg_sync_in_app_channel_delivery
AFTER UPDATE OF status ON public.notification_outbox
FOR EACH ROW EXECUTE FUNCTION private.sync_in_app_channel_delivery();

-- ---------------------------------------------------------------------------
-- 4. POPIA / legal policy versioning and privacy requests
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.policy_documents(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_type text NOT NULL CHECK(policy_type IN ('privacy','terms','cancellation','transport_terms')),
  version text NOT NULL,
  title text NOT NULL,
  content text,
  document_url text,
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','retired')),
  effective_at timestamptz,
  published_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(policy_type,version)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_published_policy_per_type
ON public.policy_documents(policy_type) WHERE status='published';

CREATE TABLE IF NOT EXISTS public.policy_acceptances(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  policy_document_id uuid NOT NULL REFERENCES public.policy_documents(id) ON DELETE RESTRICT,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'app',
  UNIQUE(user_id,policy_document_id)
);

CREATE TABLE IF NOT EXISTS public.privacy_requests(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  request_type text NOT NULL CHECK(request_type IN ('data_export','account_deletion')),
  status text NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','in_progress','completed','rejected','cancelled')),
  assigned_admin_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  user_note text,
  admin_note text,
  resolution_summary text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_privacy_request_per_type
ON public.privacy_requests(user_id,request_type)
WHERE status IN ('requested','in_progress');

ALTER TABLE public.policy_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policy_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.privacy_requests ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.policy_documents,public.policy_acceptances,public.privacy_requests TO authenticated;
GRANT ALL ON public.policy_documents,public.policy_acceptances,public.privacy_requests TO service_role;

DROP POLICY IF EXISTS "users read published policies and admins all" ON public.policy_documents;
CREATE POLICY "users read published policies and admins all" ON public.policy_documents
FOR SELECT TO authenticated USING(status='published' OR private.has_role(auth.uid(),'admin'::app_role));
DROP POLICY IF EXISTS "users read own policy acceptance" ON public.policy_acceptances;
CREATE POLICY "users read own policy acceptance" ON public.policy_acceptances
FOR SELECT TO authenticated USING(user_id=auth.uid() OR private.has_role(auth.uid(),'admin'::app_role));
DROP POLICY IF EXISTS "users read own privacy requests" ON public.privacy_requests;
CREATE POLICY "users read own privacy requests" ON public.privacy_requests
FOR SELECT TO authenticated USING(user_id=auth.uid() OR private.has_role(auth.uid(),'admin'::app_role));

CREATE OR REPLACE FUNCTION public.user_compliance_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $function$
DECLARE v_uid uuid:=auth.uid(); v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT jsonb_build_object(
    'policies',COALESCE((
      SELECT jsonb_agg(
        to_jsonb(p) || jsonb_build_object(
          'accepted_at',(SELECT a.accepted_at FROM public.policy_acceptances a
            WHERE a.user_id=v_uid AND a.policy_document_id=p.id)
        ) ORDER BY p.policy_type
      )
      FROM public.policy_documents p WHERE p.status='published'
    ),'[]'::jsonb),
    'privacy_requests',COALESCE((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC)
      FROM public.privacy_requests r WHERE r.user_id=v_uid
    ),'[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.user_compliance_snapshot() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_compliance_snapshot() TO authenticated;

CREATE OR REPLACE FUNCTION public.user_accept_policy(p_policy_document_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $function$
DECLARE v_uid uuid:=auth.uid(); v_policy public.policy_documents%ROWTYPE; v_accept public.policy_acceptances%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_policy FROM public.policy_documents
  WHERE id=p_policy_document_id AND status='published' AND (effective_at IS NULL OR effective_at<=now());
  IF NOT FOUND THEN RAISE EXCEPTION 'Published policy not found'; END IF;
  INSERT INTO public.policy_acceptances(user_id,policy_document_id)
  VALUES(v_uid,v_policy.id)
  ON CONFLICT(user_id,policy_document_id) DO UPDATE SET accepted_at=public.policy_acceptances.accepted_at
  RETURNING * INTO v_accept;
  RETURN to_jsonb(v_accept);
END;
$function$;
REVOKE ALL ON FUNCTION public.user_accept_policy(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_accept_policy(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.user_submit_privacy_request(p_request_type text,p_user_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $function$
DECLARE v_uid uuid:=auth.uid(); v_type text:=lower(trim(COALESCE(p_request_type,''))); v_request public.privacy_requests%ROWTYPE; v_admin record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF v_type NOT IN ('data_export','account_deletion') THEN RAISE EXCEPTION 'Invalid privacy request type'; END IF;
  INSERT INTO public.privacy_requests(user_id,request_type,user_note)
  VALUES(v_uid,v_type,NULLIF(trim(COALESCE(p_user_note,'')),''))
  ON CONFLICT(user_id,request_type) WHERE status IN ('requested','in_progress')
  DO UPDATE SET user_note=COALESCE(EXCLUDED.user_note,public.privacy_requests.user_note),updated_at=now()
  RETURNING * INTO v_request;

  FOR v_admin IN SELECT user_id FROM public.user_roles WHERE role='admin'::app_role LOOP
    PERFORM private.operations_enqueue_notification(
      v_admin.user_id,'privacy_request','New privacy request',
      'A user submitted an Access privacy request.',
      'privacy:'||v_request.id::text||':'||v_admin.user_id::text,NULL,NULL,NULL,now()
    );
  END LOOP;
  RETURN to_jsonb(v_request);
END;
$function$;
REVOKE ALL ON FUNCTION public.user_submit_privacy_request(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_submit_privacy_request(text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_privacy_requests(p_limit integer DEFAULT 250)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $function$
DECLARE v jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT private.has_role(auth.uid(),'admin'::app_role) THEN
    RAISE EXCEPTION 'Administrator access required';
  END IF;
  SELECT COALESCE(jsonb_agg(
    to_jsonb(r)||jsonb_build_object('full_name',p.full_name,'phone',p.phone)
    ORDER BY r.created_at DESC
  ),'[]'::jsonb) INTO v
  FROM (SELECT * FROM public.privacy_requests ORDER BY created_at DESC LIMIT LEAST(GREATEST(p_limit,1),1000)) r
  LEFT JOIN public.profiles p ON p.user_id=r.user_id;
  RETURN v;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_list_privacy_requests(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_privacy_requests(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_update_privacy_request(
  p_request_id uuid,p_status text,p_admin_note text DEFAULT NULL,p_resolution_summary text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $function$
DECLARE v_actor uuid:=auth.uid(); v_before public.privacy_requests%ROWTYPE; v_after public.privacy_requests%ROWTYPE;
  v_status text:=lower(trim(COALESCE(p_status,'')));
BEGIN
  IF v_actor IS NULL OR NOT private.has_role(v_actor,'admin'::app_role) THEN
    RAISE EXCEPTION 'Administrator access required';
  END IF;
  IF v_status NOT IN ('requested','in_progress','completed','rejected','cancelled') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  SELECT * INTO v_before FROM public.privacy_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Privacy request not found'; END IF;
  IF v_status IN ('completed','rejected') AND NULLIF(trim(COALESCE(p_resolution_summary,'')),'') IS NULL
     AND NULLIF(trim(COALESCE(v_before.resolution_summary,'')),'') IS NULL THEN
    RAISE EXCEPTION 'Resolution summary required';
  END IF;
  UPDATE public.privacy_requests SET status=v_status,assigned_admin_id=COALESCE(assigned_admin_id,v_actor),
    admin_note=COALESCE(NULLIF(trim(COALESCE(p_admin_note,'')),''),admin_note),
    resolution_summary=COALESCE(NULLIF(trim(COALESCE(p_resolution_summary,'')),''),resolution_summary),
    completed_at=CASE WHEN v_status='completed' THEN COALESCE(completed_at,now()) ELSE completed_at END,
    updated_at=now()
  WHERE id=p_request_id RETURNING * INTO v_after;
  PERFORM public.write_system_audit('privacy.request_updated','privacy','privacy_request',p_request_id::text,
    to_jsonb(v_before),to_jsonb(v_after),'{}'::jsonb);
  RETURN to_jsonb(v_after);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_update_privacy_request(uuid,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_privacy_request(uuid,text,text,text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Support cases / disputes
-- ---------------------------------------------------------------------------
ALTER TABLE public.support_tickets DROP CONSTRAINT IF EXISTS support_tickets_category_check;
ALTER TABLE public.support_tickets ADD CONSTRAINT support_tickets_category_check CHECK(category IN (
  'trip_issue','scheduled_trip','service_booking','quote_question','driver_issue','vehicle_issue',
  'account_profile','accessibility_assistance','complaint','lost_property','payment_dispute',
  'cancellation_dispute','passenger_complaint','safety_incident','other'
));
ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS case_severity text NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS decision_type text,
  ADD COLUMN IF NOT EXISTS decision_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS escalated_at timestamptz,
  ADD COLUMN IF NOT EXISTS safety_incident_id uuid REFERENCES public.safety_incidents(id) ON DELETE SET NULL;

ALTER TABLE public.support_tickets DROP CONSTRAINT IF EXISTS support_tickets_case_severity_check;
ALTER TABLE public.support_tickets ADD CONSTRAINT support_tickets_case_severity_check
CHECK(case_severity IN ('low','normal','high','critical'));
ALTER TABLE public.support_tickets DROP CONSTRAINT IF EXISTS support_tickets_decision_type_check;
ALTER TABLE public.support_tickets ADD CONSTRAINT support_tickets_decision_type_check
CHECK(decision_type IS NULL OR decision_type IN ('refund','charge','no_adjustment','operational_resolution','other'));

CREATE OR REPLACE FUNCTION public.support_create_ticket(
  p_requester_role text,p_category text,p_subject text,p_description text,
  p_priority text DEFAULT 'normal',p_ride_id uuid DEFAULT NULL,p_service_booking_id uuid DEFAULT NULL,
  p_passenger_id uuid DEFAULT NULL,p_driver_id uuid DEFAULT NULL
)
RETURNS public.support_tickets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $function$
DECLARE
  v_uid uuid:=auth.uid(); v_role text:=lower(trim(COALESCE(p_requester_role,'')));
  v_priority text:=lower(trim(COALESCE(p_priority,'normal'))); v_ticket public.support_tickets;
  v_is_admin boolean; v_driver_id uuid; v_vehicle_id uuid; v_severity text:='normal';
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  v_is_admin:=private.has_role(v_uid,'admin'::app_role);
  IF v_role NOT IN ('passenger','driver','admin') THEN RAISE EXCEPTION 'Invalid requester role'; END IF;
  IF v_role='passenger' AND NOT private.has_role(v_uid,'passenger'::app_role) AND NOT v_is_admin THEN RAISE EXCEPTION 'Passenger role required'; END IF;
  IF v_role='driver' AND NOT private.has_role(v_uid,'driver'::app_role) AND NOT v_is_admin THEN RAISE EXCEPTION 'Driver role required'; END IF;
  IF v_role='admin' AND NOT v_is_admin THEN RAISE EXCEPTION 'Admin role required'; END IF;

  IF p_category NOT IN (
    'trip_issue','scheduled_trip','service_booking','quote_question','driver_issue','vehicle_issue',
    'account_profile','accessibility_assistance','complaint','lost_property','payment_dispute',
    'cancellation_dispute','passenger_complaint','safety_incident','other'
  ) THEN RAISE EXCEPTION 'Invalid support category'; END IF;

  IF v_is_admin THEN
    IF v_priority NOT IN ('low','normal','high','urgent') THEN v_priority:='normal'; END IF;
  ELSE
    IF v_priority NOT IN ('normal','high') THEN v_priority:='normal'; END IF;
    IF lower(COALESCE(p_subject,'')||' '||COALESCE(p_description,''))
      ~ '(immediate danger|unsafe|stranded|assault|emergency|threat|medical crisis)' THEN v_priority:='urgent'; END IF;
  END IF;
  IF v_priority='urgent' OR p_category='safety_incident' THEN v_severity:='critical';
  ELSIF v_priority='high' THEN v_severity:='high'; END IF;

  IF p_ride_id IS NOT NULL AND NOT v_is_admin AND NOT EXISTS(
    SELECT 1 FROM public.rides r WHERE r.id=p_ride_id AND (r.passenger_id=v_uid OR r.driver_id=v_uid)
  ) THEN RAISE EXCEPTION 'You cannot link this trip'; END IF;
  IF p_service_booking_id IS NOT NULL AND NOT v_is_admin AND NOT EXISTS(
    SELECT 1 FROM public.service_bookings b WHERE b.id=p_service_booking_id AND b.booked_by_user_id=v_uid
  ) THEN RAISE EXCEPTION 'You cannot link this booking'; END IF;

  v_driver_id:=CASE WHEN v_role='driver' THEN COALESCE(p_driver_id,v_uid)
    WHEN v_is_admin THEN p_driver_id ELSE NULL END;
  IF p_ride_id IS NOT NULL THEN SELECT vehicle_id INTO v_vehicle_id FROM public.rides WHERE id=p_ride_id; END IF;
  IF v_vehicle_id IS NULL AND p_category='vehicle_issue' AND v_driver_id IS NOT NULL THEN
    SELECT vehicle_id INTO v_vehicle_id FROM public.vehicle_driver_assignments
    WHERE driver_id=v_driver_id AND status='active' AND start_at<=now() AND (end_at IS NULL OR end_at>now())
    ORDER BY start_at DESC LIMIT 1;
  END IF;

  INSERT INTO public.support_tickets(
    created_by,requester_role,passenger_id,driver_id,ride_id,service_booking_id,vehicle_id,
    category,priority,case_severity,subject,description,escalated_at
  ) VALUES (
    v_uid,v_role,
    CASE WHEN v_role='passenger' THEN COALESCE(p_passenger_id,v_uid) WHEN v_is_admin THEN p_passenger_id ELSE NULL END,
    v_driver_id,p_ride_id,p_service_booking_id,v_vehicle_id,p_category,v_priority,v_severity,
    trim(p_subject),trim(p_description),
    CASE WHEN v_priority='urgent' OR p_category IN ('payment_dispute','cancellation_dispute','safety_incident') THEN now() ELSE NULL END
  ) RETURNING * INTO v_ticket;

  INSERT INTO public.support_ticket_events(ticket_id,event_type,new_value,performed_by)
  VALUES(v_ticket.id,'ticket_created',jsonb_build_object('status',v_ticket.status,'priority',v_ticket.priority,
    'case_severity',v_ticket.case_severity,'vehicle_id',v_ticket.vehicle_id),v_uid);

  INSERT INTO public.notifications(user_id,type,title,body,ride_id,support_ticket_id)
  VALUES(v_uid,'support_ticket_created','Support ticket created',
    v_ticket.ticket_reference||' · '||v_ticket.subject,v_ticket.ride_id,v_ticket.id);

  INSERT INTO public.notifications(user_id,type,title,body,ride_id,support_ticket_id)
  SELECT ur.user_id,
    CASE WHEN v_ticket.priority='urgent' THEN 'support_urgent' ELSE 'support_new' END,
    CASE WHEN v_ticket.priority='urgent' THEN 'Urgent support ticket' ELSE 'New support ticket' END,
    v_ticket.ticket_reference||' · '||v_ticket.subject,v_ticket.ride_id,v_ticket.id
  FROM public.user_roles ur WHERE ur.role='admin'::app_role AND ur.user_id<>v_uid;
  RETURN v_ticket;
END;
$function$;

REVOKE ALL ON FUNCTION public.support_create_ticket(text,text,text,text,text,uuid,uuid,uuid,uuid)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_create_ticket(text,text,text,text,text,uuid,uuid,uuid,uuid)
TO authenticated;

CREATE OR REPLACE FUNCTION public.support_admin_update_case_metadata(
  p_ticket_id uuid,p_case_severity text,p_decision_type text DEFAULT NULL,
  p_decision_amount numeric DEFAULT NULL,p_evidence jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $function$
DECLARE v_actor uuid:=auth.uid(); v_before public.support_tickets%ROWTYPE; v_after public.support_tickets%ROWTYPE;
  v_severity text:=lower(trim(COALESCE(p_case_severity,'normal'))); v_decision text:=NULLIF(lower(trim(COALESCE(p_decision_type,''))),'');
BEGIN
  IF v_actor IS NULL OR NOT private.has_role(v_actor,'admin'::app_role) THEN RAISE EXCEPTION 'Administrator access required'; END IF;
  IF v_severity NOT IN ('low','normal','high','critical') THEN RAISE EXCEPTION 'Invalid case severity'; END IF;
  IF v_decision IS NOT NULL AND v_decision NOT IN ('refund','charge','no_adjustment','operational_resolution','other') THEN
    RAISE EXCEPTION 'Invalid case decision'; END IF;
  IF p_decision_amount IS NOT NULL AND p_decision_amount<0 THEN RAISE EXCEPTION 'Decision amount cannot be negative'; END IF;
  SELECT * INTO v_before FROM public.support_tickets WHERE id=p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Support ticket not found'; END IF;

  UPDATE public.support_tickets
  SET case_severity=v_severity,decision_type=v_decision,decision_amount=p_decision_amount,
      evidence=COALESCE(p_evidence,evidence),
      escalated_at=CASE WHEN v_severity IN ('high','critical') THEN COALESCE(escalated_at,now()) ELSE escalated_at END,
      updated_at=now()
  WHERE id=p_ticket_id RETURNING * INTO v_after;

  INSERT INTO public.support_ticket_events(ticket_id,event_type,previous_value,new_value,performed_by)
  VALUES(p_ticket_id,'case_metadata_updated',
    jsonb_build_object('case_severity',v_before.case_severity,'decision_type',v_before.decision_type,'decision_amount',v_before.decision_amount),
    jsonb_build_object('case_severity',v_after.case_severity,'decision_type',v_after.decision_type,'decision_amount',v_after.decision_amount),
    v_actor);
  PERFORM public.write_system_audit('support.case_metadata_updated','support','support_ticket',p_ticket_id::text,
    to_jsonb(v_before),to_jsonb(v_after),'{}'::jsonb);
  RETURN to_jsonb(v_after);
END;
$function$;
REVOKE ALL ON FUNCTION public.support_admin_update_case_metadata(uuid,text,text,numeric,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_admin_update_case_metadata(uuid,text,text,numeric,jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Future-capable driver payout architecture (admin-only; no driver access)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.driver_payouts(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  ride_id uuid REFERENCES public.rides(id) ON DELETE SET NULL,
  period_start date,
  period_end date,
  amount numeric(12,2) NOT NULL CHECK(amount>=0),
  currency text NOT NULL DEFAULT 'ZAR' CHECK(currency='ZAR'),
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','processing','paid','void')),
  compensation_model text,
  calculation_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.driver_payouts ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.driver_payouts TO authenticated;
GRANT ALL ON public.driver_payouts TO service_role;
DROP POLICY IF EXISTS "admins only read driver payouts" ON public.driver_payouts;
CREATE POLICY "admins only read driver payouts" ON public.driver_payouts
FOR SELECT TO authenticated USING(private.has_role(auth.uid(),'admin'::app_role));
REVOKE INSERT,UPDATE,DELETE ON public.driver_payouts FROM authenticated;

-- ---------------------------------------------------------------------------
-- 7. Commercial monitoring snapshot
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_commercial_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $function$
DECLARE v_today date:=CURRENT_DATE; v jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT private.has_role(auth.uid(),'admin'::app_role) THEN
    RAISE EXCEPTION 'Administrator access required';
  END IF;
  SELECT jsonb_build_object(
    'generated_at',now(),
    'operations',jsonb_build_object(
      'trips_today',(SELECT count(*) FROM public.rides WHERE created_at::date=v_today),
      'requested',(SELECT count(*) FROM public.rides WHERE status='requested'),
      'accepted',(SELECT count(*) FROM public.rides WHERE status IN ('accepted','driver_arriving','arrived')),
      'in_progress',(SELECT count(*) FROM public.rides WHERE status='in_progress'),
      'completed_today',(SELECT count(*) FROM public.rides WHERE status='completed' AND completed_at::date=v_today),
      'cancelled_today',(SELECT count(*) FROM public.rides WHERE status='cancelled' AND updated_at::date=v_today)
    ),
    'payments',jsonb_build_object(
      'collected_today',(SELECT COALESCE(SUM(amount),0) FROM public.payments WHERE status IN ('paid','refunded') AND paid_at::date=v_today),
      'pending',(SELECT count(*) FROM public.payments WHERE status='pending'),
      'failed_today',(SELECT count(*) FROM public.payments WHERE status='failed' AND failed_at::date=v_today),
      'refunds_requested',(SELECT count(*) FROM public.payment_refunds WHERE status IN ('requested','processing','action_required')),
      'refunds_completed_today',(SELECT count(*) FROM public.payment_refunds WHERE status='completed' AND completed_at::date=v_today),
      'cancellation_charges_today',(SELECT COALESCE(SUM(total_amount),0) FROM public.ride_cancellation_charges WHERE created_at::date=v_today)
    ),
    'system',jsonb_build_object(
      'notification_failures',(SELECT count(*) FROM public.notification_outbox WHERE status='failed'),
      'external_channels_action_required',(SELECT count(*) FROM public.notification_channel_deliveries WHERE status='action_required'),
      'open_safety_incidents',(SELECT count(*) FROM public.safety_incidents WHERE status NOT IN ('resolved','closed')),
      'urgent_support_cases',(SELECT count(*) FROM public.support_tickets WHERE priority='urgent' AND status NOT IN ('resolved','closed')),
      'open_privacy_requests',(SELECT count(*) FROM public.privacy_requests WHERE status IN ('requested','in_progress')),
      'scheduler_failures_24h',(SELECT count(*) FROM public.operations_scheduler_runs WHERE status='failed' AND started_at>=now()-interval '24 hours'),
      'unresolved_operational_alerts',(SELECT count(*) FROM public.operational_alerts WHERE resolved_at IS NULL)
    )
  ) INTO v;
  RETURN v;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_commercial_snapshot() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_commercial_snapshot() TO authenticated;

INSERT INTO public.app_settings(key,value,category,description)
VALUES
 ('notifications.providers','{"push":{"configured":false},"sms":{"configured":false},"whatsapp":{"configured":false},"email":{"configured":false}}','notifications','External notification provider readiness. Secrets are never stored here.'),
 ('privacy.requestSla','{"dataExportDays":30,"accountDeletionDays":30}','privacy','Internal POPIA request handling targets.'),
 ('safety.sos','{"pressHoldMs":1200,"enabled":true}','safety','SOS interaction and availability settings.')
ON CONFLICT(key) DO NOTHING;

NOTIFY pgrst,'reload schema';
