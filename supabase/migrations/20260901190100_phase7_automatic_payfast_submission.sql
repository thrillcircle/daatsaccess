-- Phase 7 automatic PayFast submission flow.
--
-- A passenger-created ride exists as `payment_pending` only so Access can create
-- a server-authoritative PayFast payment. It is NOT submitted to operations or
-- visible to administrators until trusted PayFast ITN confirms the fare.

ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz;

-- Existing rides pre-date this distinction and were already submitted.
UPDATE public.rides
SET submitted_at = COALESCE(submitted_at, created_at)
WHERE status <> 'payment_pending'::public.ride_status
  AND submitted_at IS NULL;

-- Unpaid drafts must not appear in Admin Trips. Drivers already only see open
-- `requested` rides, so this also preserves the driver financial boundary.
DROP POLICY IF EXISTS "admin sees all rides" ON public.rides;
DROP POLICY IF EXISTS "admin sees submitted rides" ON public.rides;
CREATE POLICY "admin sees submitted rides"
ON public.rides FOR SELECT TO authenticated
USING (
  private.has_role(auth.uid(), 'admin'::public.app_role)
  AND submitted_at IS NOT NULL
);

-- The old architecture blocked administrator acceptance while waiting for a
-- passenger to pay. That is deliberately removed: an unpaid ride never reaches
-- Admin in the first place. Once it is `requested`, Admin operates normally.
DROP TRIGGER IF EXISTS rides_payment_before_acceptance_trigger ON public.rides;
DROP TRIGGER IF EXISTS rides_lock_paid_requested_route_trigger ON public.rides;
DROP FUNCTION IF EXISTS private.enforce_payment_before_ride_acceptance();
DROP FUNCTION IF EXISTS private.lock_paid_requested_trip_route();

-- Scheduled drafts must not notify the passenger that a trip is scheduled until
-- PayFast has confirmed it and the request has actually been submitted.
CREATE OR REPLACE FUNCTION public.notify_ride_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.request_type = 'scheduled' AND NEW.status = 'requested' THEN
    INSERT INTO public.notifications(user_id, ride_id, type, title, body)
    VALUES (
      NEW.passenger_id,
      NEW.id,
      'scheduled_created',
      'Trip scheduled',
      'Your trip to ' || public.short_addr(NEW.destination_address) ||
      ' is scheduled for ' ||
      to_char(NEW.scheduled_at AT TIME ZONE 'Africa/Johannesburg', 'Dy DD Mon HH24:MI')
    );
  END IF;
  RETURN NEW;
END $$;

-- Passenger ride creation now creates an internal payment draft. Pricing remains
-- entirely server-authoritative and continues to use the published/versioned
-- pricing engine already used by Access.
CREATE OR REPLACE FUNCTION public.passenger_create_priced_ride(
  p_pickup_address text,
  p_pickup_lat double precision,
  p_pickup_lng double precision,
  p_pickup_place_id text,
  p_destination_address text,
  p_destination_lat double precision,
  p_destination_lng double precision,
  p_destination_place_id text,
  p_distance_km numeric,
  p_duration_seconds integer,
  p_request_type text,
  p_scheduled_at timestamptz,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_effective_at timestamptz;
  v_estimate jsonb;
  v_ride public.rides%ROWTYPE;
  v_existing jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT private.has_role(v_actor, 'passenger'::app_role) THEN
    RAISE EXCEPTION 'Passenger role required';
  END IF;
  IF p_request_type NOT IN ('now', 'scheduled') THEN RAISE EXCEPTION 'Invalid request type'; END IF;
  IF p_request_type = 'scheduled' AND (p_scheduled_at IS NULL OR p_scheduled_at <= now()) THEN
    RAISE EXCEPTION 'Scheduled pickup must be in the future';
  END IF;
  IF NULLIF(trim(COALESCE(p_pickup_address, '')), '') IS NULL
     OR NULLIF(trim(COALESCE(p_destination_address, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Pickup and destination are required';
  END IF;
  IF p_duration_seconds IS NOT NULL AND p_duration_seconds < 0 THEN
    RAISE EXCEPTION 'Duration cannot be negative';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT result INTO v_existing
    FROM public.pricing_operation_requests
    WHERE actor_id = v_actor
      AND operation_type = 'create_priced_ride'
      AND idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_existing; END IF;
  END IF;

  v_effective_at := CASE WHEN p_request_type = 'scheduled' THEN p_scheduled_at ELSE now() END;
  v_estimate := public.pricing_calculate(
    'ride',
    jsonb_build_object('distance_km', p_distance_km),
    v_effective_at,
    NULL
  );

  INSERT INTO public.rides (
    passenger_id,
    pickup_address, pickup_lat, pickup_lng, pickup_place_id,
    destination_address, destination_lat, destination_lng, destination_place_id,
    distance_km, estimated_price, estimated_duration_seconds,
    request_type, scheduled_at, pricing_version_id, estimate_snapshot,
    status, submitted_at
  ) VALUES (
    v_actor,
    trim(p_pickup_address), p_pickup_lat, p_pickup_lng, NULLIF(trim(p_pickup_place_id), ''),
    trim(p_destination_address), p_destination_lat, p_destination_lng,
    NULLIF(trim(p_destination_place_id), ''),
    p_distance_km, (v_estimate->>'total')::numeric, p_duration_seconds,
    p_request_type,
    CASE WHEN p_request_type = 'scheduled' THEN p_scheduled_at ELSE NULL END,
    (v_estimate->>'pricing_version_id')::uuid,
    v_estimate,
    'payment_pending'::public.ride_status,
    NULL
  ) RETURNING * INTO v_ride;

  v_existing := jsonb_build_object('ride', to_jsonb(v_ride), 'estimate', v_estimate);
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.pricing_operation_requests(actor_id, operation_type, idempotency_key, result)
    VALUES (v_actor, 'create_priced_ride', p_idempotency_key, v_existing)
    ON CONFLICT (actor_id, operation_type, idempotency_key) DO NOTHING;
  END IF;
  RETURN v_existing;
END;
$$;

REVOKE ALL ON FUNCTION public.passenger_create_priced_ride(
  text, double precision, double precision, text,
  text, double precision, double precision, text,
  numeric, integer, text, timestamptz, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.passenger_create_priced_ride(
  text, double precision, double precision, text,
  text, double precision, double precision, text,
  numeric, integer, text, timestamptz, text
) TO authenticated;

-- Requested rides from the old build remain payable for recovery, but all new
-- passenger rides use payment_pending and become requested only after ITN.
CREATE OR REPLACE FUNCTION public.create_ride_payment(
  p_ride_id uuid,
  p_environment text DEFAULT 'sandbox',
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
  v_charge public.ride_cancellation_charges%ROWTYPE;
  v_payment public.payments%ROWTYPE;
  v_amount numeric(10,2);
  v_purpose text;
  v_pricing_version_id uuid;
  v_environment text := lower(trim(COALESCE(p_environment, 'sandbox')));
  v_key text := COALESCE(NULLIF(trim(COALESCE(p_idempotency_key, '')), ''), gen_random_uuid()::text);
  v_merchant_payment_id text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  IF NOT private.has_role(v_actor, 'passenger'::app_role) THEN
    RAISE EXCEPTION 'Passenger role required' USING ERRCODE = '42501';
  END IF;
  IF v_environment NOT IN ('sandbox', 'live') THEN RAISE EXCEPTION 'Invalid payment environment'; END IF;
  IF length(v_key) > 128 THEN RAISE EXCEPTION 'Idempotency key is too long'; END IF;

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF NOT FOUND OR v_ride.passenger_id <> v_actor THEN
    RAISE EXCEPTION 'Ride not found for this passenger' USING ERRCODE = '42501';
  END IF;

  IF v_ride.status = 'cancelled' THEN
    SELECT * INTO v_charge FROM public.ride_cancellation_charges WHERE ride_id = v_ride.id;
    IF NOT FOUND OR COALESCE(v_charge.total_amount, 0) <= 0 THEN
      RAISE EXCEPTION 'No payment is due for this cancelled trip';
    END IF;
    v_purpose := 'cancellation_charge';
    v_amount := round(v_charge.total_amount, 2);
    v_pricing_version_id := v_charge.pricing_version_id;
  ELSIF v_ride.status IN (
    'payment_pending'::public.ride_status,
    'requested'::public.ride_status,
    'accepted'::public.ride_status,
    'driver_arriving'::public.ride_status,
    'arrived'::public.ride_status,
    'in_progress'::public.ride_status,
    'completed'::public.ride_status
  ) THEN
    v_purpose := 'trip_fare';
    v_amount := round(v_ride.estimated_price, 2);
    v_pricing_version_id := v_ride.pricing_version_id;
  ELSE
    RAISE EXCEPTION 'This trip is not payable in its current state';
  END IF;

  IF v_amount IS NULL OR v_amount <= 0 THEN RAISE EXCEPTION 'No payable amount is available for this trip'; END IF;
  IF v_amount < 5 THEN RAISE EXCEPTION 'PayFast requires a minimum payment amount of R5.00'; END IF;

  SELECT * INTO v_payment
  FROM public.payments
  WHERE passenger_id = v_actor AND idempotency_key = v_key
  ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'payment_id', v_payment.id, 'ride_id', v_payment.ride_id,
      'merchant_payment_id', v_payment.merchant_payment_id,
      'amount', v_payment.amount, 'currency', v_payment.currency,
      'status', v_payment.status, 'purpose', v_payment.purpose,
      'environment', v_payment.environment, 'idempotent', true,
      'already_paid', v_payment.status = 'paid'
    );
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('ride-payment:' || v_ride.id::text || ':' || v_purpose, 0));

  SELECT * INTO v_payment
  FROM public.payments
  WHERE ride_id = v_ride.id
    AND passenger_id = v_actor
    AND purpose = v_purpose
    AND status IN ('pending', 'paid')
    AND cancelled_at IS NULL
  ORDER BY (status = 'paid') DESC, created_at DESC
  LIMIT 1 FOR UPDATE;

  IF FOUND AND v_payment.status = 'paid' THEN
    IF abs(v_payment.amount - v_amount) > 0.01
       OR v_payment.pricing_version_id IS DISTINCT FROM v_pricing_version_id THEN
      RAISE EXCEPTION 'The paid amount no longer matches this trip. Contact support before continuing';
    END IF;
    RETURN jsonb_build_object(
      'payment_id', v_payment.id, 'ride_id', v_payment.ride_id,
      'merchant_payment_id', v_payment.merchant_payment_id,
      'amount', v_payment.amount, 'currency', v_payment.currency,
      'status', v_payment.status, 'purpose', v_payment.purpose,
      'environment', v_payment.environment, 'idempotent', true, 'already_paid', true
    );
  END IF;

  IF FOUND AND v_payment.status = 'pending'
     AND abs(v_payment.amount - v_amount) <= 0.01
     AND v_payment.environment = v_environment
     AND v_payment.pricing_version_id IS NOT DISTINCT FROM v_pricing_version_id THEN
    RETURN jsonb_build_object(
      'payment_id', v_payment.id, 'ride_id', v_payment.ride_id,
      'merchant_payment_id', v_payment.merchant_payment_id,
      'amount', v_payment.amount, 'currency', v_payment.currency,
      'status', v_payment.status, 'purpose', v_payment.purpose,
      'environment', v_payment.environment, 'idempotent', true, 'already_paid', false
    );
  END IF;

  IF FOUND AND v_payment.status = 'pending' THEN
    UPDATE public.payments
    SET status = 'failed', failed_at = now(), cancelled_at = now(),
        failure_reason = 'Superseded by a new authoritative payment amount, pricing version, or environment',
        metadata = metadata || jsonb_build_object('superseded_at', now())
    WHERE id = v_payment.id;
  END IF;

  v_merchant_payment_id := 'DAATS-' || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO public.payments (
    ride_id, passenger_id, driver_id, amount, status, payment_method,
    provider, environment, purpose, merchant_payment_id, currency,
    pricing_version_id, idempotency_key, metadata
  ) VALUES (
    v_ride.id, v_actor, NULL, v_amount, 'pending', 'payfast',
    'payfast', v_environment, v_purpose, v_merchant_payment_id, 'ZAR',
    v_pricing_version_id, v_key,
    jsonb_build_object('ride_status_at_intent', v_ride.status, 'route_version', v_ride.route_version)
  ) RETURNING * INTO v_payment;

  RETURN jsonb_build_object(
    'payment_id', v_payment.id, 'ride_id', v_payment.ride_id,
    'merchant_payment_id', v_payment.merchant_payment_id,
    'amount', v_payment.amount, 'currency', v_payment.currency,
    'status', v_payment.status, 'purpose', v_payment.purpose,
    'environment', v_payment.environment, 'idempotent', false, 'already_paid', false
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_ride_payment(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_ride_payment(uuid, text, text) TO authenticated, service_role;

-- Trusted PayFast reconciliation is the only normal path that promotes a new
-- passenger ride into the operational Requested state.
CREATE OR REPLACE FUNCTION private.submit_paid_pending_ride()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE
  v_ride public.rides%ROWTYPE;
BEGIN
  IF NEW.purpose <> 'trip_fare'
     OR NEW.provider <> 'payfast'
     OR NEW.status <> 'paid'
     OR upper(COALESCE(NEW.provider_status, '')) <> 'COMPLETE'
     OR NEW.paid_at IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_ride FROM public.rides WHERE id = NEW.ride_id FOR UPDATE;
  IF NOT FOUND OR v_ride.status <> 'payment_pending'::public.ride_status THEN
    RETURN NEW;
  END IF;

  IF abs(NEW.amount - round(v_ride.estimated_price, 2)) > 0.01
     OR NEW.pricing_version_id IS DISTINCT FROM v_ride.pricing_version_id THEN
    RAISE EXCEPTION 'Confirmed payment does not match the pending trip';
  END IF;

  UPDATE public.rides
  SET status = 'requested'::public.ride_status,
      submitted_at = now(),
      updated_at = now()
  WHERE id = v_ride.id
  RETURNING * INTO v_ride;

  INSERT INTO public.ride_status_events(ride_id, previous_status, new_status, changed_by)
  VALUES (v_ride.id, 'payment_pending', 'requested', v_ride.passenger_id);

  INSERT INTO public.notifications(user_id, ride_id, type, title, body)
  VALUES (
    v_ride.passenger_id,
    v_ride.id,
    'payment_confirmed_trip_submitted',
    CASE WHEN v_ride.request_type = 'scheduled' THEN 'Trip scheduled' ELSE 'Trip requested' END,
    CASE
      WHEN v_ride.request_type = 'scheduled' THEN
        'Payment confirmed. Your trip to ' || public.short_addr(v_ride.destination_address) ||
        ' is scheduled for ' ||
        to_char(v_ride.scheduled_at AT TIME ZONE 'Africa/Johannesburg', 'Dy DD Mon HH24:MI') || '.'
      ELSE
        'Payment confirmed. Your trip request has been submitted.'
    END
  );

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.submit_paid_pending_ride() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS payments_submit_paid_pending_ride ON public.payments;
CREATE TRIGGER payments_submit_paid_pending_ride
AFTER UPDATE OF status, provider_status, paid_at ON public.payments
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.provider_status IS DISTINCT FROM NEW.provider_status)
EXECUTE FUNCTION private.submit_paid_pending_ride();

-- Recovery/cancel action for a passenger who leaves PayFast without paying.
CREATE OR REPLACE FUNCTION public.passenger_cancel_unpaid_ride(p_ride_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_ride public.rides%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT private.has_role(v_actor, 'passenger'::app_role) THEN RAISE EXCEPTION 'Passenger role required'; END IF;

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF NOT FOUND OR v_ride.passenger_id <> v_actor THEN RAISE EXCEPTION 'Ride not found for this passenger'; END IF;
  IF v_ride.status = 'cancelled' THEN
    RETURN jsonb_build_object('cancelled', true, 'idempotent', true, 'ride_id', v_ride.id);
  END IF;
  IF v_ride.status <> 'payment_pending'::public.ride_status THEN
    RAISE EXCEPTION 'This payment draft can no longer be cancelled here';
  END IF;

  UPDATE public.payments
  SET status = 'failed', failed_at = now(), cancelled_at = now(),
      failure_reason = 'Passenger cancelled before completing checkout'
  WHERE ride_id = v_ride.id AND status = 'pending';

  PERFORM set_config('access.ride_workflow', 'passenger_rpc', true);
  UPDATE public.rides SET status = 'cancelled', updated_at = now() WHERE id = v_ride.id RETURNING * INTO v_ride;
  PERFORM set_config('access.ride_workflow', '', true);

  INSERT INTO public.ride_status_events(ride_id, previous_status, new_status, changed_by)
  VALUES (v_ride.id, 'payment_pending', 'cancelled', v_actor);

  RETURN jsonb_build_object('cancelled', true, 'idempotent', false, 'ride_id', v_ride.id);
END;
$function$;

REVOKE ALL ON FUNCTION public.passenger_cancel_unpaid_ride(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.passenger_cancel_unpaid_ride(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
