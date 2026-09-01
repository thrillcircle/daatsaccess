-- Phase 7 payment-flow correction: passenger pays before admin acceptance.
--
-- Requested trips are now payable immediately. A trip cannot leave the requested
-- state for an accepted/active state until the trip fare has been confirmed by
-- PayFast ITN. Cancellation from requested remains allowed.

-- ---------------------------------------------------------------------------
-- 1. Canonical confirmed-payment predicate used by database gates.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.ride_has_confirmed_trip_payment(
  p_ride_id uuid,
  p_expected_amount numeric DEFAULT NULL,
  p_pricing_version_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.payments p
    WHERE p.ride_id = p_ride_id
      AND p.purpose = 'trip_fare'
      AND p.provider = 'payfast'
      AND p.status = 'paid'
      AND upper(COALESCE(p.provider_status, '')) = 'COMPLETE'
      AND p.paid_at IS NOT NULL
      AND (
        p_expected_amount IS NULL
        OR abs(p.amount - round(p_expected_amount, 2)) <= 0.01
      )
      AND (
        p_pricing_version_id IS NULL
        OR p.pricing_version_id IS NOT DISTINCT FROM p_pricing_version_id
      )
  );
$function$;

REVOKE ALL ON FUNCTION private.ride_has_confirmed_trip_payment(uuid, numeric, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.ride_has_confirmed_trip_payment(uuid, numeric, uuid) FROM anon;
REVOKE ALL ON FUNCTION private.ride_has_confirmed_trip_payment(uuid, numeric, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION private.ride_has_confirmed_trip_payment(uuid, numeric, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Database-level acceptance gate.
--    This protects every admin/UI/RPC path, including old clients.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.enforce_payment_before_ride_acceptance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
BEGIN
  IF OLD.status = 'requested'
     AND NEW.status IN ('accepted', 'driver_arriving', 'arrived', 'in_progress', 'completed')
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT private.ride_has_confirmed_trip_payment(
      NEW.id,
      NEW.estimated_price,
      NEW.pricing_version_id
    ) THEN
      RAISE EXCEPTION 'Payment must be confirmed by PayFast before this trip can be accepted';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.enforce_payment_before_ride_acceptance() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.enforce_payment_before_ride_acceptance() FROM anon;
REVOKE ALL ON FUNCTION private.enforce_payment_before_ride_acceptance() FROM authenticated;

DROP TRIGGER IF EXISTS rides_payment_before_acceptance_trigger ON public.rides;
CREATE TRIGGER rides_payment_before_acceptance_trigger
BEFORE UPDATE OF status ON public.rides
FOR EACH ROW
EXECUTE FUNCTION private.enforce_payment_before_ride_acceptance();

-- Once a requested trip has been paid, fare-affecting route details are locked
-- until admin acceptance. This prevents a passenger from paying one route/fare
-- and then editing it into a different unpaid route before acceptance.
CREATE OR REPLACE FUNCTION private.lock_paid_requested_trip_route()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
BEGIN
  IF OLD.status = 'requested'
     AND NEW.status = 'requested'
     AND private.ride_has_confirmed_trip_payment(
       OLD.id,
       OLD.estimated_price,
       OLD.pricing_version_id
     )
     AND (
       OLD.pickup_address IS DISTINCT FROM NEW.pickup_address
       OR OLD.pickup_lat IS DISTINCT FROM NEW.pickup_lat
       OR OLD.pickup_lng IS DISTINCT FROM NEW.pickup_lng
       OR OLD.destination_address IS DISTINCT FROM NEW.destination_address
       OR OLD.destination_lat IS DISTINCT FROM NEW.destination_lat
       OR OLD.destination_lng IS DISTINCT FROM NEW.destination_lng
       OR OLD.stops IS DISTINCT FROM NEW.stops
       OR OLD.distance_km IS DISTINCT FROM NEW.distance_km
       OR OLD.estimated_price IS DISTINCT FROM NEW.estimated_price
       OR OLD.pricing_version_id IS DISTINCT FROM NEW.pricing_version_id
       OR OLD.route_version IS DISTINCT FROM NEW.route_version
     ) THEN
    RAISE EXCEPTION 'This trip is already paid. Contact support to change the route before acceptance';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.lock_paid_requested_trip_route() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.lock_paid_requested_trip_route() FROM anon;
REVOKE ALL ON FUNCTION private.lock_paid_requested_trip_route() FROM authenticated;

DROP TRIGGER IF EXISTS rides_lock_paid_requested_route_trigger ON public.rides;
CREATE TRIGGER rides_lock_paid_requested_route_trigger
BEFORE UPDATE ON public.rides
FOR EACH ROW
EXECUTE FUNCTION private.lock_paid_requested_trip_route();

-- ---------------------------------------------------------------------------
-- 3. Payment intent: requested trips are payable before admin acceptance.
--    Amount remains server-authoritative from the locked ride estimate.
-- ---------------------------------------------------------------------------
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
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT private.has_role(v_actor, 'passenger'::app_role) THEN
    RAISE EXCEPTION 'Passenger role required' USING ERRCODE = '42501';
  END IF;
  IF v_environment NOT IN ('sandbox', 'live') THEN
    RAISE EXCEPTION 'Invalid payment environment';
  END IF;
  IF length(v_key) > 128 THEN
    RAISE EXCEPTION 'Idempotency key is too long';
  END IF;

  SELECT * INTO v_ride
  FROM public.rides
  WHERE id = p_ride_id
  FOR UPDATE;

  IF NOT FOUND OR v_ride.passenger_id <> v_actor THEN
    RAISE EXCEPTION 'Ride not found for this passenger' USING ERRCODE = '42501';
  END IF;

  IF v_ride.status = 'cancelled' THEN
    SELECT * INTO v_charge
    FROM public.ride_cancellation_charges
    WHERE ride_id = v_ride.id;

    IF NOT FOUND OR COALESCE(v_charge.total_amount, 0) <= 0 THEN
      RAISE EXCEPTION 'No payment is due for this cancelled trip';
    END IF;

    v_purpose := 'cancellation_charge';
    v_amount := round(v_charge.total_amount, 2);
    v_pricing_version_id := v_charge.pricing_version_id;
  ELSIF v_ride.status IN ('requested', 'accepted', 'driver_arriving', 'arrived', 'in_progress', 'completed') THEN
    v_purpose := 'trip_fare';
    v_amount := round(v_ride.estimated_price, 2);
    v_pricing_version_id := v_ride.pricing_version_id;
  ELSE
    RAISE EXCEPTION 'This trip is not payable in its current state';
  END IF;

  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'No payable amount is available for this trip';
  END IF;

  IF v_amount < 5 THEN
    RAISE EXCEPTION 'PayFast requires a minimum payment amount of R5.00';
  END IF;

  SELECT * INTO v_payment
  FROM public.payments
  WHERE passenger_id = v_actor
    AND idempotency_key = v_key
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'payment_id', v_payment.id,
      'ride_id', v_payment.ride_id,
      'merchant_payment_id', v_payment.merchant_payment_id,
      'amount', v_payment.amount,
      'currency', v_payment.currency,
      'status', v_payment.status,
      'purpose', v_payment.purpose,
      'environment', v_payment.environment,
      'idempotent', true,
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
  LIMIT 1
  FOR UPDATE;

  IF FOUND AND v_payment.status = 'paid' THEN
    IF abs(v_payment.amount - v_amount) > 0.01
       OR v_payment.pricing_version_id IS DISTINCT FROM v_pricing_version_id THEN
      RAISE EXCEPTION 'The paid amount no longer matches this trip. Contact support before continuing';
    END IF;

    RETURN jsonb_build_object(
      'payment_id', v_payment.id,
      'ride_id', v_payment.ride_id,
      'merchant_payment_id', v_payment.merchant_payment_id,
      'amount', v_payment.amount,
      'currency', v_payment.currency,
      'status', v_payment.status,
      'purpose', v_payment.purpose,
      'environment', v_payment.environment,
      'idempotent', true,
      'already_paid', true
    );
  END IF;

  IF FOUND AND v_payment.status = 'pending' AND abs(v_payment.amount - v_amount) <= 0.01
     AND v_payment.environment = v_environment
     AND v_payment.pricing_version_id IS NOT DISTINCT FROM v_pricing_version_id THEN
    RETURN jsonb_build_object(
      'payment_id', v_payment.id,
      'ride_id', v_payment.ride_id,
      'merchant_payment_id', v_payment.merchant_payment_id,
      'amount', v_payment.amount,
      'currency', v_payment.currency,
      'status', v_payment.status,
      'purpose', v_payment.purpose,
      'environment', v_payment.environment,
      'idempotent', true,
      'already_paid', false
    );
  END IF;

  IF FOUND AND v_payment.status = 'pending' THEN
    UPDATE public.payments
    SET status = 'failed',
        failed_at = now(),
        failure_reason = 'Superseded by a new authoritative payment amount, pricing version, or environment',
        metadata = metadata || jsonb_build_object('superseded_at', now())
    WHERE id = v_payment.id;
  END IF;

  v_merchant_payment_id := 'DAATS-' || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.payments (
    ride_id,
    passenger_id,
    driver_id,
    amount,
    status,
    payment_method,
    provider,
    environment,
    purpose,
    merchant_payment_id,
    currency,
    pricing_version_id,
    idempotency_key,
    metadata
  ) VALUES (
    v_ride.id,
    v_actor,
    NULL,
    v_amount,
    'pending',
    'payfast',
    'payfast',
    v_environment,
    v_purpose,
    v_merchant_payment_id,
    'ZAR',
    v_pricing_version_id,
    v_key,
    jsonb_build_object(
      'ride_status_at_intent', v_ride.status,
      'route_version', v_ride.route_version,
      'cancellation_charge_id', CASE WHEN v_charge.id IS NULL THEN NULL ELSE v_charge.id END
    )
  )
  RETURNING * INTO v_payment;

  RETURN jsonb_build_object(
    'payment_id', v_payment.id,
    'ride_id', v_payment.ride_id,
    'merchant_payment_id', v_payment.merchant_payment_id,
    'amount', v_payment.amount,
    'currency', v_payment.currency,
    'status', v_payment.status,
    'purpose', v_payment.purpose,
    'environment', v_payment.environment,
    'idempotent', false,
    'already_paid', false
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_ride_payment(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_ride_payment(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_ride_payment(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_ride_payment(uuid, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
