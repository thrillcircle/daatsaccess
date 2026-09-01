-- Phase 7.1 — PayFast payment and refund foundation.
--
-- This migration activates the existing payments structure without changing
-- ride pricing. All payable amounts are derived server-side from the ride's
-- locked estimate or the recorded cancellation charge.

-- ---------------------------------------------------------------------------
-- 1. Extend the existing payments ledger for gateway reconciliation
-- ---------------------------------------------------------------------------
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS environment text,
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'trip_fare',
  ADD COLUMN IF NOT EXISTS merchant_payment_id text,
  ADD COLUMN IF NOT EXISTS provider_payment_id text,
  ADD COLUMN IF NOT EXISTS provider_status text,
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'ZAR',
  ADD COLUMN IF NOT EXISTS pricing_version_id uuid REFERENCES public.pricing_versions(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS failed_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS failure_reason text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_provider_check') THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_provider_check CHECK (provider IN ('manual', 'payfast'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_environment_check') THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_environment_check CHECK (environment IS NULL OR environment IN ('sandbox', 'live'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_purpose_check') THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_purpose_check CHECK (purpose IN ('trip_fare', 'cancellation_charge'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_currency_check') THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_currency_check CHECK (currency = 'ZAR');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_amount_positive_check') THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_amount_positive_check CHECK (amount > 0) NOT VALID;
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS payments_merchant_payment_id_uidx
  ON public.payments (merchant_payment_id)
  WHERE merchant_payment_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_payment_id_uidx
  ON public.payments (provider, provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS payments_passenger_idempotency_uidx
  ON public.payments (passenger_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

DROP TRIGGER IF EXISTS payments_set_updated_at ON public.payments;
CREATE TRIGGER payments_set_updated_at
BEFORE UPDATE ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Payment mutations must go through protected RPCs / service-role webhook code.
REVOKE INSERT, UPDATE, DELETE ON public.payments FROM authenticated;
GRANT SELECT ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;

DROP POLICY IF EXISTS "involved sees payment" ON public.payments;
DROP POLICY IF EXISTS "admin updates payments" ON public.payments;
DROP POLICY IF EXISTS "admin inserts payments" ON public.payments;
DROP POLICY IF EXISTS "admin deletes payments" ON public.payments;
DROP POLICY IF EXISTS "passenger or admin reads payments" ON public.payments;

CREATE POLICY "passenger or admin reads payments"
ON public.payments FOR SELECT TO authenticated
USING (
  passenger_id = auth.uid()
  OR private.has_role(auth.uid(), 'admin'::app_role)
);

-- ---------------------------------------------------------------------------
-- 2. Gateway event log (server/webhook write only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_gateway_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  provider text NOT NULL CHECK (provider IN ('payfast')),
  environment text NOT NULL CHECK (environment IN ('sandbox', 'live')),
  event_key text NOT NULL,
  event_type text NOT NULL,
  provider_payment_id text,
  validation_status text NOT NULL CHECK (validation_status IN ('valid', 'invalid', 'ignored')),
  validation_checks jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, environment, event_key)
);

GRANT SELECT ON public.payment_gateway_events TO authenticated;
GRANT ALL ON public.payment_gateway_events TO service_role;
ALTER TABLE public.payment_gateway_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read payment gateway events" ON public.payment_gateway_events;
CREATE POLICY "admins read payment gateway events"
ON public.payment_gateway_events FOR SELECT TO authenticated
USING (private.has_role(auth.uid(), 'admin'::app_role));

-- ---------------------------------------------------------------------------
-- 3. Refund request ledger
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE RESTRICT,
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  amount numeric(10,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'ZAR' CHECK (currency = 'ZAR'),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'processing', 'completed', 'failed', 'cancelled')),
  provider_refund_id text,
  provider_status text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  completed_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_refunds_provider_refund_id_uidx
  ON public.payment_refunds (provider_refund_id)
  WHERE provider_refund_id IS NOT NULL;

GRANT SELECT ON public.payment_refunds TO authenticated;
GRANT ALL ON public.payment_refunds TO service_role;
ALTER TABLE public.payment_refunds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "passengers read own refunds" ON public.payment_refunds;
CREATE POLICY "passengers read own refunds"
ON public.payment_refunds FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1
  FROM public.payments p
  WHERE p.id = payment_refunds.payment_id
    AND p.passenger_id = auth.uid()
));

DROP POLICY IF EXISTS "admins read refunds" ON public.payment_refunds;
CREATE POLICY "admins read refunds"
ON public.payment_refunds FOR SELECT TO authenticated
USING (private.has_role(auth.uid(), 'admin'::app_role));

DROP TRIGGER IF EXISTS payment_refunds_set_updated_at ON public.payment_refunds;
CREATE TRIGGER payment_refunds_set_updated_at
BEFORE UPDATE ON public.payment_refunds
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Passenger payment intent: amount is always derived by the database
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

  IF v_ride.status = 'requested' THEN
    RAISE EXCEPTION 'This trip must be accepted before payment can be made';
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
  ELSIF v_ride.status IN ('accepted', 'driver_arriving', 'arrived', 'in_progress', 'completed') THEN
    v_purpose := 'trip_fare';
    v_amount := round(v_ride.estimated_price, 2);
    v_pricing_version_id := v_ride.pricing_version_id;
  ELSE
    RAISE EXCEPTION 'This trip is not payable in its current state';
  END IF;

  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'No payable amount is available for this trip';
  END IF;

  -- PayFast currently requires a minimum transaction amount of ZAR 5.00.
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

  -- Serialize attempts for the same ride/purpose to prevent duplicate active
  -- intents from concurrent tabs or retries.
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
     AND v_payment.environment = v_environment THEN
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
        failure_reason = 'Superseded by a new authoritative payment amount or environment',
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

-- ---------------------------------------------------------------------------
-- 5. PayFast ITN reconciliation. Only service_role may call this function.
--    The Edge Function performs PayFast signature/source/server validation;
--    this function independently re-checks the expected amount and state.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_payfast_itn(
  p_event_key text,
  p_environment text,
  p_merchant_payment_id text,
  p_provider_payment_id text,
  p_provider_status text,
  p_amount_gross numeric,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE
  v_payment public.payments%ROWTYPE;
  v_event_id uuid;
  v_status text := upper(trim(COALESCE(p_provider_status, '')));
  v_environment text := lower(trim(COALESCE(p_environment, '')));
  v_run_id uuid;
BEGIN
  IF current_user NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(trim(COALESCE(p_event_key, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Gateway event key is required';
  END IF;
  IF v_environment NOT IN ('sandbox', 'live') THEN
    RAISE EXCEPTION 'Invalid payment environment';
  END IF;

  SELECT * INTO v_payment
  FROM public.payments
  WHERE merchant_payment_id = p_merchant_payment_id
    AND provider = 'payfast'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown merchant payment reference';
  END IF;
  IF v_payment.environment IS DISTINCT FROM v_environment THEN
    RAISE EXCEPTION 'Payment environment mismatch';
  END IF;
  IF p_amount_gross IS NULL OR abs(v_payment.amount - p_amount_gross) > 0.01 THEN
    RAISE EXCEPTION 'Payment amount mismatch';
  END IF;

  INSERT INTO public.payment_gateway_events (
    payment_id,
    provider,
    environment,
    event_key,
    event_type,
    provider_payment_id,
    validation_status,
    validation_checks,
    payload
  ) VALUES (
    v_payment.id,
    'payfast',
    v_environment,
    p_event_key,
    'itn',
    NULLIF(trim(COALESCE(p_provider_payment_id, '')), ''),
    'valid',
    jsonb_build_object('signature', true, 'source', true, 'amount', true, 'server_confirmation', true),
    COALESCE(p_payload, '{}'::jsonb)
  )
  ON CONFLICT (provider, environment, event_key) DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NULL THEN
    RETURN jsonb_build_object(
      'processed', true,
      'idempotent', true,
      'payment_id', v_payment.id,
      'status', v_payment.status
    );
  END IF;

  -- A superseded / already-failed intent must never be resurrected by a late ITN.
  IF v_payment.status NOT IN ('pending', 'paid') THEN
    UPDATE public.payment_gateway_events
    SET validation_status = 'ignored',
        validation_checks = validation_checks || jsonb_build_object('payment_state_allowed', false)
    WHERE id = v_event_id;

    RETURN jsonb_build_object(
      'processed', false,
      'ignored', true,
      'payment_id', v_payment.id,
      'status', v_payment.status
    );
  END IF;

  IF v_status = 'COMPLETE' THEN
    UPDATE public.payments
    SET status = 'paid',
        payment_method = 'payfast',
        provider_payment_id = COALESCE(NULLIF(trim(COALESCE(p_provider_payment_id, '')), ''), provider_payment_id),
        provider_status = v_status,
        paid_at = COALESCE(paid_at, now()),
        failed_at = NULL,
        failure_reason = NULL
    WHERE id = v_payment.id
    RETURNING * INTO v_payment;
  ELSIF v_status = 'FAILED' THEN
    IF v_payment.status = 'pending' THEN
      UPDATE public.payments
      SET status = 'failed',
          provider_payment_id = COALESCE(NULLIF(trim(COALESCE(p_provider_payment_id, '')), ''), provider_payment_id),
          provider_status = v_status,
          failed_at = now(),
          failure_reason = COALESCE(NULLIF(p_payload ->> 'reason', ''), 'PayFast reported a failed payment')
      WHERE id = v_payment.id
      RETURNING * INTO v_payment;
    END IF;
  ELSE
    UPDATE public.payments
    SET provider_payment_id = COALESCE(NULLIF(trim(COALESCE(p_provider_payment_id, '')), ''), provider_payment_id),
        provider_status = v_status
    WHERE id = v_payment.id
    RETURNING * INTO v_payment;
  END IF;

  SELECT id INTO v_run_id
  FROM public.operation_runs
  WHERE ride_id = v_payment.ride_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_status = 'COMPLETE' THEN
    PERFORM private.operations_enqueue_notification(
      v_payment.passenger_id,
      'payment_received',
      'Payment received',
      'Your Access payment has been confirmed.',
      'payment-received:' || v_payment.id::text,
      v_run_id,
      v_payment.ride_id,
      NULL,
      now()
    );
  ELSIF v_status = 'FAILED' THEN
    PERFORM private.operations_enqueue_notification(
      v_payment.passenger_id,
      'payment_failed',
      'Payment failed',
      'Your Access payment was not completed. Please try again.',
      'payment-failed:' || v_payment.id::text,
      v_run_id,
      v_payment.ride_id,
      NULL,
      now()
    );
  END IF;

  RETURN jsonb_build_object(
    'processed', true,
    'idempotent', false,
    'payment_id', v_payment.id,
    'status', v_payment.status,
    'provider_status', v_payment.provider_status
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.process_payfast_itn(text, text, text, text, text, numeric, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_payfast_itn(text, text, text, text, text, numeric, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.process_payfast_itn(text, text, text, text, text, numeric, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.process_payfast_itn(text, text, text, text, text, numeric, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Administrator refund requests. Provider execution is handled server-side
--    in the next payment slice; this ledger reserves the refundable amount.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_request_payment_refund(
  p_payment_id uuid,
  p_reason text,
  p_amount numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := public.operations_require_admin();
  v_payment public.payments%ROWTYPE;
  v_refund public.payment_refunds%ROWTYPE;
  v_reserved numeric(10,2);
  v_available numeric(10,2);
  v_amount numeric(10,2);
  v_reason text := NULLIF(trim(COALESCE(p_reason, '')), '');
BEGIN
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'A refund reason is required';
  END IF;

  SELECT * INTO v_payment
  FROM public.payments
  WHERE id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;
  IF v_payment.status <> 'paid' THEN
    RAISE EXCEPTION 'Only paid payments can be refunded';
  END IF;

  SELECT COALESCE(SUM(amount), 0)
  INTO v_reserved
  FROM public.payment_refunds
  WHERE payment_id = v_payment.id
    AND status IN ('requested', 'processing', 'completed');

  v_available := round(GREATEST(v_payment.amount - v_reserved, 0), 2);
  v_amount := round(COALESCE(p_amount, v_available), 2);

  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'No refundable amount remains';
  END IF;
  IF v_amount > v_available THEN
    RAISE EXCEPTION 'Refund amount exceeds the available balance';
  END IF;

  INSERT INTO public.payment_refunds (
    payment_id,
    requested_by,
    amount,
    currency,
    reason,
    status,
    metadata
  ) VALUES (
    v_payment.id,
    v_actor,
    v_amount,
    v_payment.currency,
    v_reason,
    'requested',
    jsonb_build_object('provider', v_payment.provider, 'environment', v_payment.environment)
  )
  RETURNING * INTO v_refund;

  RETURN jsonb_build_object(
    'refund_id', v_refund.id,
    'payment_id', v_refund.payment_id,
    'amount', v_refund.amount,
    'currency', v_refund.currency,
    'status', v_refund.status,
    'remaining_refundable', round(v_available - v_amount, 2)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_request_payment_refund(uuid, text, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_request_payment_refund(uuid, text, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_request_payment_refund(uuid, text, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_request_payment_refund(uuid, text, numeric) TO service_role;

NOTIFY pgrst, 'reload schema';