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

NOTIFY pgrst, 'reload schema';