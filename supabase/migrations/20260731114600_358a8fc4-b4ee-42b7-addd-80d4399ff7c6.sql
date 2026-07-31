-- Phase 4 passenger quote mutation response privacy.
-- Passenger workspaces already expose a restricted projection. Accept/decline
-- mutations must return the same class of customer-safe data and must never
-- return calculation snapshots, margins, internal adjustments or admin notes.

CREATE OR REPLACE FUNCTION private.passenger_quote_action_response(
  p_quote public.service_quotes,
  p_action text,
  p_success boolean,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public, private
AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    p_action, p_success,
    'reason', p_reason,
    'quote', jsonb_build_object(
      'id', p_quote.id,
      'booking_id', p_quote.booking_id,
      'quote_reference', p_quote.quote_reference,
      'status', p_quote.status::text,
      'revision_number', p_quote.revision_number,
      'currency', p_quote.currency,
      'final_total', p_quote.final_total,
      'deposit_required', p_quote.deposit_required,
      'deposit_amount', p_quote.deposit_amount_snapshot,
      'valid_until', p_quote.valid_until,
      'sent_at', p_quote.sent_at,
      'accepted_at', p_quote.accepted_at,
      'declined_at', p_quote.declined_at,
      'expired_at', p_quote.expired_at,
      'superseded_at', p_quote.superseded_at,
      'cancelled_at', p_quote.cancelled_at,
      'row_version', p_quote.row_version,
      'created_at', p_quote.created_at
    )
  ));
$$;

REVOKE ALL ON FUNCTION private.passenger_quote_action_response(
  public.service_quotes, text, boolean, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.passenger_quote_action_response(
  public.service_quotes, text, boolean, text
) TO service_role;

CREATE OR REPLACE FUNCTION public.passenger_accept_service_quote(
  p_quote_id uuid,
  p_expected_row_version integer,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_existing jsonb;
  v_quote public.service_quotes%ROWTYPE;
  v_previous jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT result INTO v_existing
    FROM public.pricing_operation_requests
    WHERE actor_id = v_actor
      AND operation_type = 'accept_service_quote'
      AND idempotency_key = p_idempotency_key;

    IF FOUND THEN
      SELECT quote.* INTO v_quote
      FROM public.service_quotes quote
      JOIN public.service_bookings booking ON booking.id = quote.booking_id
      WHERE quote.id = NULLIF(v_existing #>> '{quote,id}', '')::uuid
        AND booking.booked_by_user_id = v_actor;

      IF FOUND THEN
        RETURN private.passenger_quote_action_response(
          v_quote,
          'accepted',
          COALESCE((v_existing->>'accepted')::boolean, v_quote.accepted_at IS NOT NULL),
          v_existing->>'reason'
        );
      END IF;
    END IF;
  END IF;

  SELECT quote.* INTO v_quote
  FROM public.service_quotes quote
  JOIN public.service_bookings booking ON booking.id = quote.booking_id
  WHERE quote.id = p_quote_id
    AND booking.booked_by_user_id = v_actor
  FOR UPDATE OF quote;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quote not found for this passenger'; END IF;

  IF v_quote.accepted_at IS NOT NULL THEN
    RETURN private.passenger_quote_action_response(v_quote, 'accepted', true);
  END IF;
  IF v_quote.row_version <> p_expected_row_version THEN
    RAISE EXCEPTION 'Quote changed since it was loaded';
  END IF;

  IF v_quote.valid_until IS NOT NULL AND v_quote.valid_until <= now() THEN
    v_previous := to_jsonb(v_quote);
    UPDATE public.service_quotes
    SET expired_at = COALESCE(expired_at, now()),
        row_version = row_version + 1,
        updated_at = now()
    WHERE id = p_quote_id
    RETURNING * INTO v_quote;

    UPDATE public.service_bookings
    SET status = 'awaiting_quote', updated_at = now()
    WHERE id = v_quote.booking_id AND status = 'quoted';

    INSERT INTO public.quote_audit_events (
      quote_id, booking_id, event_type, previous_value, new_value, performed_by
    ) VALUES (
      v_quote.id, v_quote.booking_id, 'quote_expired',
      v_previous, to_jsonb(v_quote), v_actor
    );

    RETURN private.passenger_quote_action_response(
      v_quote, 'accepted', false, 'expired'
    );
  END IF;

  IF v_quote.status::text <> 'sent'
     OR v_quote.sent_at IS NULL
     OR v_quote.declined_at IS NOT NULL
     OR v_quote.expired_at IS NOT NULL
     OR v_quote.superseded_at IS NOT NULL
     OR v_quote.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Quote is no longer available for acceptance';
  END IF;

  v_previous := to_jsonb(v_quote);
  UPDATE public.service_quotes
  SET accepted_at = now(),
      updated_by = v_actor,
      row_version = row_version + 1,
      updated_at = now()
  WHERE id = p_quote_id
  RETURNING * INTO v_quote;

  UPDATE public.service_bookings
  SET status = 'accepted',
      quoted_total = v_quote.final_total,
      updated_at = now()
  WHERE id = v_quote.booking_id;

  INSERT INTO public.quote_audit_events (
    quote_id, booking_id, event_type, previous_value, new_value, performed_by
  ) VALUES (
    v_quote.id, v_quote.booking_id, 'quote_accepted',
    v_previous, to_jsonb(v_quote), v_actor
  );

  v_existing := private.passenger_quote_action_response(v_quote, 'accepted', true);
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.pricing_operation_requests(
      actor_id, operation_type, idempotency_key, result
    ) VALUES (
      v_actor, 'accept_service_quote', p_idempotency_key, v_existing
    ) ON CONFLICT (actor_id, operation_type, idempotency_key)
      DO UPDATE SET result = EXCLUDED.result;
  END IF;
  RETURN v_existing;
END;
$$;

CREATE OR REPLACE FUNCTION public.passenger_decline_service_quote(
  p_quote_id uuid,
  p_expected_row_version integer,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_quote public.service_quotes%ROWTYPE;
  v_previous jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT quote.* INTO v_quote
  FROM public.service_quotes quote
  JOIN public.service_bookings booking ON booking.id = quote.booking_id
  WHERE quote.id = p_quote_id
    AND booking.booked_by_user_id = v_actor
  FOR UPDATE OF quote;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quote not found for this passenger'; END IF;
  IF v_quote.row_version <> p_expected_row_version THEN
    RAISE EXCEPTION 'Quote changed since it was loaded';
  END IF;

  IF v_quote.valid_until IS NOT NULL AND v_quote.valid_until <= now() THEN
    v_previous := to_jsonb(v_quote);
    UPDATE public.service_quotes
    SET expired_at = COALESCE(expired_at, now()),
        row_version = row_version + 1,
        updated_at = now()
    WHERE id = p_quote_id
    RETURNING * INTO v_quote;

    UPDATE public.service_bookings
    SET status = 'awaiting_quote', updated_at = now()
    WHERE id = v_quote.booking_id AND status = 'quoted';

    INSERT INTO public.quote_audit_events (
      quote_id, booking_id, event_type, previous_value, new_value, performed_by
    ) VALUES (
      v_quote.id, v_quote.booking_id, 'quote_expired',
      v_previous, to_jsonb(v_quote), v_actor
    );

    RETURN private.passenger_quote_action_response(
      v_quote, 'declined', false, 'expired'
    );
  END IF;

  IF v_quote.status::text <> 'sent'
     OR v_quote.accepted_at IS NOT NULL
     OR v_quote.superseded_at IS NOT NULL
     OR v_quote.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Quote is not available for decline';
  END IF;

  v_previous := to_jsonb(v_quote);
  UPDATE public.service_quotes
  SET declined_at = now(),
      updated_by = v_actor,
      row_version = row_version + 1,
      updated_at = now()
  WHERE id = p_quote_id
  RETURNING * INTO v_quote;

  UPDATE public.service_bookings
  SET status = 'awaiting_quote', updated_at = now()
  WHERE id = v_quote.booking_id;

  INSERT INTO public.quote_audit_events (
    quote_id, booking_id, event_type, previous_value, new_value, reason, performed_by
  ) VALUES (
    v_quote.id, v_quote.booking_id, 'quote_declined',
    v_previous, to_jsonb(v_quote), NULLIF(trim(p_reason), ''), v_actor
  );

  RETURN private.passenger_quote_action_response(v_quote, 'declined', true);
END;
$$;

-- Replace previously persisted accept-idempotency payloads with the safe
-- projection so replaying an old key cannot disclose the original full row.
UPDATE public.pricing_operation_requests request
SET result = private.passenger_quote_action_response(
  quote,
  'accepted',
  COALESCE((request.result->>'accepted')::boolean, quote.accepted_at IS NOT NULL),
  request.result->>'reason'
)
FROM public.service_quotes quote
WHERE request.operation_type = 'accept_service_quote'
  AND request.result #>> '{quote,id}' = quote.id::text;

REVOKE ALL ON FUNCTION public.passenger_accept_service_quote(uuid, integer, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.passenger_decline_service_quote(uuid, integer, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.passenger_accept_service_quote(uuid, integer, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.passenger_decline_service_quote(uuid, integer, text)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';