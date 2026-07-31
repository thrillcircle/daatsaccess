-- Phase 4 final integrity hardening.

CREATE OR REPLACE FUNCTION public.sync_service_quote_lifecycle_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.status := CASE
    WHEN NEW.accepted_at IS NOT NULL THEN 'accepted'::public.quote_status
    WHEN NEW.cancelled_at IS NOT NULL THEN 'cancelled'::public.quote_status
    WHEN NEW.superseded_at IS NOT NULL THEN 'superseded'::public.quote_status
    WHEN NEW.expired_at IS NOT NULL THEN 'expired'::public.quote_status
    WHEN NEW.declined_at IS NOT NULL THEN 'declined'::public.quote_status
    WHEN NEW.sent_at IS NOT NULL THEN 'sent'::public.quote_status
    ELSE 'draft'::public.quote_status
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS service_quotes_sync_lifecycle ON public.service_quotes;
CREATE TRIGGER service_quotes_sync_lifecycle
  BEFORE INSERT OR UPDATE ON public.service_quotes
  FOR EACH ROW EXECUTE FUNCTION public.sync_service_quote_lifecycle_status();

UPDATE public.service_quotes
SET status = CASE
  WHEN accepted_at IS NOT NULL THEN 'accepted'::public.quote_status
  WHEN cancelled_at IS NOT NULL THEN 'cancelled'::public.quote_status
  WHEN superseded_at IS NOT NULL THEN 'superseded'::public.quote_status
  WHEN expired_at IS NOT NULL THEN 'expired'::public.quote_status
  WHEN declined_at IS NOT NULL THEN 'declined'::public.quote_status
  WHEN sent_at IS NOT NULL THEN 'sent'::public.quote_status
  ELSE 'draft'::public.quote_status
END
WHERE status::text IS DISTINCT FROM CASE
  WHEN accepted_at IS NOT NULL THEN 'accepted'
  WHEN cancelled_at IS NOT NULL THEN 'cancelled'
  WHEN superseded_at IS NOT NULL THEN 'superseded'
  WHEN expired_at IS NOT NULL THEN 'expired'
  WHEN declined_at IS NOT NULL THEN 'declined'
  WHEN sent_at IS NOT NULL THEN 'sent'
  ELSE 'draft'
END;

ALTER TABLE public.service_quotes
  DROP CONSTRAINT IF EXISTS service_quotes_final_total_nonnegative;
ALTER TABLE public.service_quotes
  ADD CONSTRAINT service_quotes_final_total_nonnegative
  CHECK (final_total IS NULL OR final_total >= 0) NOT VALID;

ALTER TABLE public.service_quotes
  DROP CONSTRAINT IF EXISTS service_quotes_deposit_within_total;
ALTER TABLE public.service_quotes
  ADD CONSTRAINT service_quotes_deposit_within_total
  CHECK (
    deposit_amount_snapshot >= 0
    AND (
      NOT deposit_required
      OR final_total IS NULL
      OR deposit_amount_snapshot <= final_total
    )
  ) NOT VALID;

ALTER TABLE public.service_quotes
  DROP CONSTRAINT IF EXISTS service_quotes_validity_after_send;
ALTER TABLE public.service_quotes
  ADD CONSTRAINT service_quotes_validity_after_send
  CHECK (sent_at IS NULL OR valid_until IS NULL OR valid_until > sent_at) NOT VALID;

DROP TRIGGER IF EXISTS rides_protect_authoritative_pricing ON public.rides;
DROP TRIGGER IF EXISTS bookings_protect_authoritative_pricing ON public.service_bookings;

-- Phase 4 final client boundary.
-- Authenticated administrators must use protected pricing/quote RPCs just like
-- passengers. Only database-owned or service-role execution may change the
-- authoritative estimate, quote and deposit fields guarded by this trigger.
-- SECURITY INVOKER is essential: direct client writes run as `authenticated`,
-- while writes performed inside protected SECURITY DEFINER RPCs run as the
-- database function owner.

CREATE OR REPLACE FUNCTION public.protect_authoritative_pricing_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, private
AS $$
DECLARE
  v_database_execution boolean := current_user IN (
    'postgres', 'service_role', 'supabase_admin', 'supabase_auth_admin'
  );
BEGIN
  IF v_database_execution THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'rides' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.estimated_price IS NOT NULL
         OR NEW.pricing_version_id IS NOT NULL
         OR COALESCE(NEW.estimate_snapshot, '{}'::jsonb) <> '{}'::jsonb THEN
        RAISE EXCEPTION 'Ride estimates must be created by the protected pricing operation';
      END IF;
    ELSIF NEW.estimated_price IS DISTINCT FROM OLD.estimated_price
       OR NEW.pricing_version_id IS DISTINCT FROM OLD.pricing_version_id
       OR NEW.estimate_snapshot IS DISTINCT FROM OLD.estimate_snapshot THEN
      RAISE EXCEPTION 'Ride pricing fields are server-authoritative';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'service_bookings' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.estimated_total IS NOT NULL
         OR NEW.quoted_total IS NOT NULL
         OR NEW.pricing_version_id IS NOT NULL
         OR COALESCE(NEW.estimate_snapshot, '{}'::jsonb) <> '{}'::jsonb
         OR NEW.deposit_amount IS NOT NULL
         OR NEW.deposit_status::text <> 'none' THEN
        RAISE EXCEPTION 'Booking financial fields must be created by a protected operation';
      END IF;
    ELSE
      IF NEW.estimated_total IS DISTINCT FROM OLD.estimated_total
         OR NEW.quoted_total IS DISTINCT FROM OLD.quoted_total
         OR NEW.pricing_version_id IS DISTINCT FROM OLD.pricing_version_id
         OR NEW.estimate_snapshot IS DISTINCT FROM OLD.estimate_snapshot
         OR NEW.deposit_amount IS DISTINCT FROM OLD.deposit_amount
         OR NEW.deposit_status IS DISTINCT FROM OLD.deposit_status THEN
        RAISE EXCEPTION 'Booking pricing and deposit fields are server-authoritative';
      END IF;
      IF NEW.status IS DISTINCT FROM OLD.status
         AND NEW.status::text IN ('quoted', 'accepted') THEN
        RAISE EXCEPTION 'Quoted and accepted booking states require protected quote operations';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER rides_protect_authoritative_pricing
  BEFORE INSERT OR UPDATE ON public.rides
  FOR EACH ROW EXECUTE FUNCTION public.protect_authoritative_pricing_fields();

CREATE TRIGGER bookings_protect_authoritative_pricing
  BEFORE INSERT OR UPDATE ON public.service_bookings
  FOR EACH ROW EXECUTE FUNCTION public.protect_authoritative_pricing_fields();

DROP POLICY IF EXISTS "Admins can insert service pricing" ON public.service_pricing_rules;
DROP POLICY IF EXISTS "Admins can update service pricing" ON public.service_pricing_rules;
DROP POLICY IF EXISTS "Admins can delete service pricing" ON public.service_pricing_rules;
REVOKE INSERT, UPDATE, DELETE ON public.service_pricing_rules FROM authenticated;

CREATE OR REPLACE FUNCTION public.pricing_validate_version_internal(p_version_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_version public.pricing_versions%ROWTYPE;
  v_required text[];
  v_code text;
  v_errors jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_version
  FROM public.pricing_versions
  WHERE id = p_version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pricing version not found'; END IF;

  IF v_version.effective_from IS NULL THEN
    v_errors := v_errors || jsonb_build_array('An effective start date is required');
  END IF;
  IF v_version.effective_to IS NOT NULL
     AND v_version.effective_from IS NOT NULL
     AND v_version.effective_to <= v_version.effective_from THEN
    v_errors := v_errors || jsonb_build_array('The effective end must be after the start');
  END IF;
  IF v_version.is_mock THEN
    v_errors := v_errors || jsonb_build_array('Mock pricing must be approved before publication');
  END IF;

  v_required := CASE v_version.service_code
    WHEN 'ride' THEN ARRAY['base_fare', 'distance']
    WHEN 'transport' THEN ARRAY['base_fare', 'distance']
    WHEN 'assisted' THEN ARRAY[
      'base_fare', 'distance', 'companion_hours', 'specialist_vehicle', 'platform_margin'
    ]
    WHEN 'appointment' THEN ARRAY[
      'base_fare', 'distance', 'companion_hours', 'waiting_hours',
      'specialist_vehicle', 'platform_margin'
    ]
    WHEN 'extended_journey' THEN ARRAY[
      'base_fare', 'distance', 'specialist_vehicle', 'vehicle_days',
      'driver_days', 'driver_overnights', 'companion_days', 'platform_margin'
    ]
    ELSE ARRAY[]::text[]
  END;

  FOREACH v_code IN ARRAY v_required
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.pricing_components component
      WHERE component.pricing_version_id = p_version_id
        AND component.component_code = v_code
        AND component.is_active
    ) THEN
      v_errors := v_errors || jsonb_build_array('Missing active component: ' || v_code);
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM public.pricing_components component
    WHERE component.pricing_version_id = p_version_id
      AND component.is_active
      AND component.customer_visible
  ) THEN
    v_errors := v_errors || jsonb_build_array('At least one customer-visible component is required');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.pricing_components component
    WHERE component.pricing_version_id = p_version_id
      AND component.is_active
      AND component.amount = 0
  ) THEN
    v_warnings := v_warnings || jsonb_build_array(
      'One or more active components have a zero rate'
    );
  END IF;

  IF v_version.effective_from IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.pricing_versions existing
    WHERE existing.id <> p_version_id
      AND existing.service_code = v_version.service_code
      AND existing.currency = v_version.currency
      AND existing.status = 'published'
      AND tstzrange(
        existing.effective_from,
        COALESCE(existing.effective_to, 'infinity'::timestamptz),
        '[)'
      ) && tstzrange(
        v_version.effective_from,
        COALESCE(v_version.effective_to, 'infinity'::timestamptz),
        '[)'
      )
  ) THEN
    v_errors := v_errors || jsonb_build_array(
      'The effective window overlaps an existing published version'
    );
  END IF;

  RETURN jsonb_build_object(
    'pricing_version_id', p_version_id,
    'is_valid', jsonb_array_length(v_errors) = 0,
    'errors', v_errors,
    'warnings', v_warnings,
    'required_components', to_jsonb(v_required)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_validate_pricing_version(p_version_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  PERFORM public.pricing_require_admin();
  RETURN public.pricing_validate_version_internal(p_version_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_publish_pricing_version(
  p_version_id uuid,
  p_expected_row_version integer,
  p_confirmation text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_actor uuid := public.pricing_require_admin();
  v_version public.pricing_versions%ROWTYPE;
  v_previous jsonb;
  v_validation jsonb;
BEGIN
  v_version := public.pricing_assert_draft(p_version_id, p_expected_row_version);
  IF lower(trim(COALESCE(p_confirmation, ''))) <> 'publish' THEN
    RAISE EXCEPTION 'Type PUBLISH to confirm';
  END IF;

  v_validation := public.pricing_validate_version_internal(p_version_id);
  IF NOT COALESCE((v_validation->>'is_valid')::boolean, false) THEN
    RAISE EXCEPTION 'Pricing validation failed: %', v_validation->'errors';
  END IF;

  v_previous := to_jsonb(v_version);
  UPDATE public.pricing_versions
  SET status = 'published',
      published_by = v_actor,
      published_at = now(),
      row_version = row_version + 1,
      updated_at = now()
  WHERE id = p_version_id
  RETURNING * INTO v_version;

  INSERT INTO public.pricing_audit_events (
    pricing_version_id, event_type, previous_value, new_value, performed_by
  ) VALUES (
    p_version_id,
    'version_published',
    v_previous,
    jsonb_build_object('version', to_jsonb(v_version), 'validation', v_validation),
    v_actor
  );
  RETURN jsonb_build_object('version', to_jsonb(v_version), 'validation', v_validation);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_pricing_draft(
  p_version_id uuid,
  p_reason text,
  p_expected_row_version integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_actor uuid := public.pricing_require_admin();
  v_version public.pricing_versions%ROWTYPE;
BEGIN
  v_version := public.pricing_assert_draft(p_version_id, p_expected_row_version);
  IF NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A deletion reason is required';
  END IF;

  INSERT INTO public.pricing_audit_events (
    pricing_version_id, event_type, previous_value, reason, performed_by
  ) VALUES (
    p_version_id, 'draft_deleted', to_jsonb(v_version), trim(p_reason), v_actor
  );

  DELETE FROM public.pricing_versions WHERE id = p_version_id;
  RETURN jsonb_build_object('deleted', true, 'version_id', p_version_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_recalculate_service_quote(
  p_quote_id uuid,
  p_inputs jsonb,
  p_valid_until timestamptz,
  p_expected_row_version integer,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_actor uuid := public.pricing_require_admin();
  v_existing jsonb;
  v_quote public.service_quotes%ROWTYPE;
  v_booking public.service_bookings%ROWTYPE;
  v_previous jsonb;
  v_snapshot jsonb;
  v_line jsonb;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    SELECT result INTO v_existing
    FROM public.pricing_operation_requests
    WHERE actor_id = v_actor
      AND operation_type = 'recalculate_service_quote'
      AND idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_existing; END IF;
  END IF;

  SELECT * INTO v_quote
  FROM public.service_quotes
  WHERE id = p_quote_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quote not found'; END IF;
  IF v_quote.status::text <> 'draft' OR v_quote.sent_at IS NOT NULL THEN
    RAISE EXCEPTION 'Only an unsent draft quote may be recalculated';
  END IF;
  IF v_quote.row_version <> p_expected_row_version THEN
    RAISE EXCEPTION 'Quote changed since it was loaded';
  END IF;

  SELECT * INTO v_booking
  FROM public.service_bookings
  WHERE id = v_quote.booking_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Service booking not found'; END IF;

  v_snapshot := public.pricing_calculate(
    v_booking.service_type::text,
    COALESCE(p_inputs, '{}'::jsonb),
    COALESCE(v_booking.start_at, now()),
    v_quote.pricing_version_id
  );
  IF jsonb_array_length(COALESCE(v_snapshot->'warnings', '[]'::jsonb)) > 0 THEN
    RAISE EXCEPTION 'Required pricing inputs are missing: %', v_snapshot->'warnings';
  END IF;

  v_previous := to_jsonb(v_quote);
  DELETE FROM public.service_quote_items WHERE quote_id = p_quote_id;

  UPDATE public.service_quotes
  SET subtotal = (v_snapshot->>'subtotal')::numeric,
      tax_amount = 0,
      adjustments_total = 0,
      margin_amount = (v_snapshot->>'margin_amount')::numeric,
      final_total = (v_snapshot->>'total')::numeric,
      total = (v_snapshot->>'total')::numeric,
      valid_until = p_valid_until,
      calculation_snapshot = v_snapshot,
      calculation_engine_version = COALESCE(
        v_snapshot->>'engine_version', 'phase4-v1'
      ),
      admin_override_reason = NULL,
      updated_by = v_actor,
      row_version = row_version + 1,
      updated_at = now()
  WHERE id = p_quote_id
  RETURNING * INTO v_quote;

  FOR v_line IN
    SELECT * FROM jsonb_array_elements(v_snapshot->'lines')
  LOOP
    INSERT INTO public.service_quote_items (
      quote_id, component_code, label, description, quantity, unit, unit_price,
      line_subtotal, adjustment, line_total, source_pricing_component_id,
      calculation_order, sort_order, customer_visible, internal_explanation
    ) VALUES (
      v_quote.id,
      v_line->>'component_code',
      v_line->>'label',
      NULL,
      COALESCE((v_line->>'quantity')::numeric, 0),
      v_line->>'unit',
      COALESCE((v_line->>'unit_price')::numeric, 0),
      COALESCE((v_line->>'line_subtotal')::numeric, 0),
      0,
      COALESCE((v_line->>'line_total')::numeric, 0),
      NULLIF(v_line->>'component_id', '')::uuid,
      COALESCE((v_line->>'calculation_order')::integer, 0),
      COALESCE((v_line->>'calculation_order')::integer, 0),
      COALESCE((v_line->>'customer_visible')::boolean, true),
      NULL
    );
  END LOOP;

  UPDATE public.service_bookings
  SET estimated_total = v_quote.final_total, updated_at = now()
  WHERE id = v_quote.booking_id;

  INSERT INTO public.quote_audit_events (
    quote_id, booking_id, event_type, previous_value, new_value, performed_by
  ) VALUES (
    v_quote.id,
    v_quote.booking_id,
    'quote_recalculated',
    v_previous,
    to_jsonb(v_quote),
    v_actor
  );

  v_existing := jsonb_build_object('quote', to_jsonb(v_quote), 'snapshot', v_snapshot);
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.pricing_operation_requests(
      actor_id, operation_type, idempotency_key, result
    ) VALUES (
      v_actor, 'recalculate_service_quote', p_idempotency_key, v_existing
    ) ON CONFLICT (actor_id, operation_type, idempotency_key) DO NOTHING;
  END IF;
  RETURN v_existing;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_cancel_service_quote(
  p_quote_id uuid,
  p_reason text,
  p_expected_row_version integer,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_actor uuid := public.pricing_require_admin();
  v_existing jsonb;
  v_quote public.service_quotes%ROWTYPE;
  v_previous jsonb;
BEGIN
  IF NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A cancellation reason is required';
  END IF;
  IF p_idempotency_key IS NOT NULL THEN
    SELECT result INTO v_existing
    FROM public.pricing_operation_requests
    WHERE actor_id = v_actor
      AND operation_type = 'cancel_service_quote'
      AND idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_existing; END IF;
  END IF;

  SELECT * INTO v_quote
  FROM public.service_quotes
  WHERE id = p_quote_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quote not found'; END IF;
  IF v_quote.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'An accepted quote cannot be cancelled';
  END IF;
  IF v_quote.cancelled_at IS NOT NULL THEN
    RETURN jsonb_build_object('quote', to_jsonb(v_quote));
  END IF;
  IF v_quote.row_version <> p_expected_row_version THEN
    RAISE EXCEPTION 'Quote changed since it was loaded';
  END IF;

  v_previous := to_jsonb(v_quote);
  UPDATE public.service_quotes
  SET cancelled_at = now(),
      updated_by = v_actor,
      row_version = row_version + 1,
      updated_at = now()
  WHERE id = p_quote_id
  RETURNING * INTO v_quote;

  UPDATE public.service_bookings booking
  SET status = 'awaiting_quote', updated_at = now()
  WHERE booking.id = v_quote.booking_id
    AND booking.status = 'quoted'
    AND NOT EXISTS (
      SELECT 1 FROM public.service_quotes quote
      WHERE quote.booking_id = booking.id
        AND quote.id <> v_quote.id
        AND quote.status::text = 'sent'
        AND quote.valid_until > now()
    );

  INSERT INTO public.quote_audit_events (
    quote_id, booking_id, event_type, previous_value, new_value, reason, performed_by
  ) VALUES (
    v_quote.id,
    v_quote.booking_id,
    'quote_cancelled',
    v_previous,
    to_jsonb(v_quote),
    trim(p_reason),
    v_actor
  );

  v_existing := jsonb_build_object('quote', to_jsonb(v_quote));
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.pricing_operation_requests(
      actor_id, operation_type, idempotency_key, result
    ) VALUES (
      v_actor, 'cancel_service_quote', p_idempotency_key, v_existing
    ) ON CONFLICT (actor_id, operation_type, idempotency_key) DO NOTHING;
  END IF;
  RETURN v_existing;
END;
$$;

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
    IF FOUND THEN RETURN v_existing; END IF;
  END IF;

  SELECT quote.* INTO v_quote
  FROM public.service_quotes quote
  JOIN public.service_bookings booking ON booking.id = quote.booking_id
  WHERE quote.id = p_quote_id
    AND booking.booked_by_user_id = v_actor
  FOR UPDATE OF quote;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quote not found for this passenger'; END IF;
  IF v_quote.accepted_at IS NOT NULL THEN
    RETURN jsonb_build_object('quote', to_jsonb(v_quote), 'accepted', true);
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
    RETURN jsonb_build_object(
      'quote', to_jsonb(v_quote), 'accepted', false, 'reason', 'expired'
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

  v_existing := jsonb_build_object('quote', to_jsonb(v_quote), 'accepted', true);
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.pricing_operation_requests(
      actor_id, operation_type, idempotency_key, result
    ) VALUES (
      v_actor, 'accept_service_quote', p_idempotency_key, v_existing
    ) ON CONFLICT (actor_id, operation_type, idempotency_key) DO NOTHING;
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
    RETURN jsonb_build_object(
      'quote', to_jsonb(v_quote), 'declined', false, 'reason', 'expired'
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
  RETURN jsonb_build_object('quote', to_jsonb(v_quote), 'declined', true);
END;
$$;

REVOKE ALL ON FUNCTION public.sync_service_quote_lifecycle_status()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_authoritative_pricing_fields()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.protect_authoritative_pricing_fields()
  TO service_role;
REVOKE ALL ON FUNCTION public.pricing_validate_version_internal(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pricing_validate_version_internal(uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.admin_validate_pricing_version(uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_delete_pricing_draft(uuid, text, integer)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_recalculate_service_quote(uuid, jsonb, timestamptz, integer, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_cancel_service_quote(uuid, text, integer, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.passenger_accept_service_quote(uuid, integer, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.passenger_decline_service_quote(uuid, integer, text)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_validate_pricing_version(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_pricing_draft(uuid, text, integer)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_recalculate_service_quote(uuid, jsonb, timestamptz, integer, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_cancel_service_quote(uuid, text, integer, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.passenger_accept_service_quote(uuid, integer, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.passenger_decline_service_quote(uuid, integer, text)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';