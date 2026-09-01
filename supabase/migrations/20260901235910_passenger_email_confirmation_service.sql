-- Service-role helpers for the runtime email confirmation endpoint.
-- Raw verification codes never enter PostgreSQL: the server stores only an HMAC digest.

CREATE OR REPLACE FUNCTION public.service_begin_passenger_email_challenge(
  p_user_id uuid,
  p_email text,
  p_challenge_id uuid,
  p_code_hash text,
  p_expires_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_current public.passenger_email_confirmations%ROWTYPE;
  v_now timestamptz := now();
  v_retry integer := 0;
BEGIN
  IF p_user_id IS NULL OR NULLIF(trim(COALESCE(p_email, '')), '') IS NULL THEN
    RAISE EXCEPTION 'User and email are required';
  END IF;
  IF NOT private.has_role(p_user_id, 'passenger'::public.app_role) THEN
    RAISE EXCEPTION 'Passenger access required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM auth.users u
    WHERE u.id = p_user_id AND lower(u.email::text) = lower(trim(p_email))
  ) THEN
    RAISE EXCEPTION 'Account email mismatch' USING ERRCODE = '42501';
  END IF;
  IF p_expires_at <= v_now OR p_expires_at > v_now + interval '20 minutes' THEN
    RAISE EXCEPTION 'Invalid confirmation expiry';
  END IF;
  IF NULLIF(p_code_hash, '') IS NULL THEN
    RAISE EXCEPTION 'Confirmation digest is required';
  END IF;

  SELECT * INTO v_current
  FROM public.passenger_email_confirmations
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF v_current.confirmed_at IS NOT NULL
     AND lower(v_current.email) = lower(trim(p_email)) THEN
    RETURN jsonb_build_object('accepted', false, 'already_confirmed', true, 'retry_after_seconds', 0);
  END IF;

  IF v_current.last_sent_at IS NOT NULL
     AND v_current.last_sent_at > v_now - interval '60 seconds' THEN
    v_retry := GREATEST(
      1,
      ceil(extract(epoch FROM ((v_current.last_sent_at + interval '60 seconds') - v_now)))::integer
    );
    RETURN jsonb_build_object('accepted', false, 'already_confirmed', false, 'retry_after_seconds', v_retry);
  END IF;

  INSERT INTO public.passenger_email_confirmations(
    user_id, email, confirmed_at, confirmed_via, challenge_id, code_hash,
    code_expires_at, attempt_count, last_sent_at, created_at, updated_at
  ) VALUES (
    p_user_id, lower(trim(p_email)), NULL, NULL, p_challenge_id, p_code_hash,
    p_expires_at, 0, v_now, v_now, v_now
  )
  ON CONFLICT(user_id) DO UPDATE SET
    email = EXCLUDED.email,
    confirmed_at = CASE
      WHEN lower(public.passenger_email_confirmations.email) = lower(EXCLUDED.email)
      THEN public.passenger_email_confirmations.confirmed_at
      ELSE NULL
    END,
    confirmed_via = CASE
      WHEN lower(public.passenger_email_confirmations.email) = lower(EXCLUDED.email)
      THEN public.passenger_email_confirmations.confirmed_via
      ELSE NULL
    END,
    challenge_id = EXCLUDED.challenge_id,
    code_hash = EXCLUDED.code_hash,
    code_expires_at = EXCLUDED.code_expires_at,
    attempt_count = 0,
    last_sent_at = v_now,
    updated_at = v_now;

  RETURN jsonb_build_object('accepted', true, 'already_confirmed', false, 'retry_after_seconds', 0);
END;
$function$;

REVOKE ALL ON FUNCTION public.service_begin_passenger_email_challenge(
  uuid,text,uuid,text,timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_begin_passenger_email_challenge(
  uuid,text,uuid,text,timestamptz
) TO service_role;

CREATE OR REPLACE FUNCTION public.service_abort_passenger_email_challenge(
  p_user_id uuid,
  p_challenge_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  UPDATE public.passenger_email_confirmations
  SET challenge_id = NULL,
      code_hash = NULL,
      code_expires_at = NULL,
      last_sent_at = NULL,
      updated_at = now()
  WHERE user_id = p_user_id
    AND challenge_id = p_challenge_id
    AND confirmed_at IS NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.service_abort_passenger_email_challenge(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_abort_passenger_email_challenge(uuid,uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.service_verify_passenger_email_challenge(
  p_user_id uuid,
  p_email text,
  p_code_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_row public.passenger_email_confirmations%ROWTYPE;
  v_before_complete boolean;
  v_after jsonb;
BEGIN
  SELECT * INTO v_row
  FROM public.passenger_email_confirmations
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF v_row.user_id IS NULL OR lower(v_row.email) <> lower(trim(COALESCE(p_email, ''))) THEN
    RETURN jsonb_build_object('verified', false, 'reason', 'no_challenge', 'attempts_remaining', 0);
  END IF;
  IF v_row.confirmed_at IS NOT NULL THEN
    RETURN jsonb_build_object('verified', true, 'reason', 'already_confirmed', 'attempts_remaining', 5);
  END IF;
  IF v_row.code_expires_at IS NULL OR v_row.code_expires_at <= now() THEN
    RETURN jsonb_build_object('verified', false, 'reason', 'expired', 'attempts_remaining', 0);
  END IF;
  IF v_row.attempt_count >= 5 THEN
    RETURN jsonb_build_object('verified', false, 'reason', 'too_many_attempts', 'attempts_remaining', 0);
  END IF;

  IF v_row.code_hash IS DISTINCT FROM p_code_hash THEN
    UPDATE public.passenger_email_confirmations
    SET attempt_count = attempt_count + 1,
        updated_at = now()
    WHERE user_id = p_user_id;
    RETURN jsonb_build_object(
      'verified', false,
      'reason', 'invalid_code',
      'attempts_remaining', GREATEST(0, 4 - v_row.attempt_count)
    );
  END IF;

  v_before_complete := private.passenger_onboarding_complete(p_user_id);

  UPDATE public.passenger_email_confirmations
  SET confirmed_at = now(),
      confirmed_via = 'email_code',
      challenge_id = NULL,
      code_hash = NULL,
      code_expires_at = NULL,
      attempt_count = 0,
      updated_at = now()
  WHERE user_id = p_user_id;

  v_after := private.passenger_onboarding_snapshot_for(p_user_id);

  IF NOT v_before_complete AND COALESCE((v_after->>'complete')::boolean, false) THEN
    PERFORM public.write_system_audit(
      'passenger.onboarding_completed',
      'passenger_onboarding',
      'user',
      p_user_id::text,
      NULL,
      jsonb_build_object('complete', true),
      jsonb_build_object('required_steps', 3, 'confirmation_method', 'email_code')
    );

    INSERT INTO public.notifications(user_id, type, title, body)
    VALUES (
      p_user_id,
      'passenger_onboarding_completed',
      'Your Access account is ready',
      'Your email has been confirmed. You can now book Access rides and services.'
    );
  END IF;

  RETURN jsonb_build_object('verified', true, 'reason', 'confirmed', 'attempts_remaining', 5);
END;
$function$;

REVOKE ALL ON FUNCTION public.service_verify_passenger_email_challenge(uuid,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_verify_passenger_email_challenge(uuid,text,text)
  TO service_role;
