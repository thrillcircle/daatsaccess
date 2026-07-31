-- Phase 4 completed-diff security and state closeout.

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

ALTER TABLE public.pricing_versions
  DROP CONSTRAINT IF EXISTS pricing_versions_no_published_overlap;
ALTER TABLE public.pricing_versions
  ADD CONSTRAINT pricing_versions_no_published_overlap
  EXCLUDE USING gist (
    service_code WITH =,
    currency WITH =,
    tstzrange(effective_from, COALESCE(effective_to, 'infinity'::timestamptz), '[)') WITH &&
  ) WHERE (status = 'published');

CREATE OR REPLACE FUNCTION public.protect_pricing_version_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_status text;
BEGIN
  IF TG_TABLE_NAME = 'pricing_components' THEN
    SELECT status INTO v_status
    FROM public.pricing_versions
    WHERE id = COALESCE(NEW.pricing_version_id, OLD.pricing_version_id);
    IF v_status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'Published or retired pricing components are immutable';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' AND OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'Published or retired pricing versions cannot be deleted';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('published', 'retired') THEN
    IF NEW.service_code IS DISTINCT FROM OLD.service_code
       OR NEW.version_number IS DISTINCT FROM OLD.version_number
       OR NEW.name IS DISTINCT FROM OLD.name
       OR NEW.description IS DISTINCT FROM OLD.description
       OR NEW.currency IS DISTINCT FROM OLD.currency
       OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
       OR NEW.is_mock IS DISTINCT FROM OLD.is_mock
       OR NEW.source_rule_id IS DISTINCT FROM OLD.source_rule_id
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.published_by IS DISTINCT FROM OLD.published_by
       OR NEW.published_at IS DISTINCT FROM OLD.published_at THEN
      RAISE EXCEPTION 'Published or retired pricing versions are immutable';
    END IF;
    IF OLD.status = 'retired' AND NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Retired pricing cannot be reactivated';
    END IF;
    IF OLD.status = 'published' AND NEW.status NOT IN ('published', 'retired') THEN
      RAISE EXCEPTION 'Published pricing may only be retired';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pricing_versions_immutability ON public.pricing_versions;
CREATE TRIGGER pricing_versions_immutability
  BEFORE UPDATE OR DELETE ON public.pricing_versions
  FOR EACH ROW EXECUTE FUNCTION public.protect_pricing_version_immutability();

DROP TRIGGER IF EXISTS pricing_components_immutability ON public.pricing_components;
CREATE TRIGGER pricing_components_immutability
  BEFORE INSERT OR UPDATE OR DELETE ON public.pricing_components
  FOR EACH ROW EXECUTE FUNCTION public.protect_pricing_version_immutability();

CREATE OR REPLACE FUNCTION public.protect_sent_quote_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.sent_at IS NOT NULL AND (
    NEW.booking_id IS DISTINCT FROM OLD.booking_id
    OR NEW.pricing_version_id IS DISTINCT FROM OLD.pricing_version_id
    OR NEW.revision_number IS DISTINCT FROM OLD.revision_number
    OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
    OR NEW.tax_amount IS DISTINCT FROM OLD.tax_amount
    OR NEW.total IS DISTINCT FROM OLD.total
    OR NEW.adjustments_total IS DISTINCT FROM OLD.adjustments_total
    OR NEW.margin_amount IS DISTINCT FROM OLD.margin_amount
    OR NEW.final_total IS DISTINCT FROM OLD.final_total
    OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW.deposit_required IS DISTINCT FROM OLD.deposit_required
    OR NEW.deposit_amount_snapshot IS DISTINCT FROM OLD.deposit_amount_snapshot
    OR NEW.calculation_snapshot IS DISTINCT FROM OLD.calculation_snapshot
    OR NEW.calculation_engine_version IS DISTINCT FROM OLD.calculation_engine_version
    OR NEW.admin_override_reason IS DISTINCT FROM OLD.admin_override_reason
  ) THEN
    RAISE EXCEPTION 'Sent quote calculation snapshots are immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS service_quotes_snapshot_immutability ON public.service_quotes;
CREATE TRIGGER service_quotes_snapshot_immutability
  BEFORE UPDATE ON public.service_quotes
  FOR EACH ROW EXECUTE FUNCTION public.protect_sent_quote_snapshot();

CREATE OR REPLACE FUNCTION public.protect_sent_quote_items()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_sent_at timestamptz;
BEGIN
  SELECT sent_at INTO v_sent_at
  FROM public.service_quotes
  WHERE id = COALESCE(NEW.quote_id, OLD.quote_id);
  IF v_sent_at IS NOT NULL THEN
    RAISE EXCEPTION 'Sent quote items are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS service_quote_items_immutability ON public.service_quote_items;
CREATE TRIGGER service_quote_items_immutability
  BEFORE INSERT OR UPDATE OR DELETE ON public.service_quote_items
  FOR EACH ROW EXECUTE FUNCTION public.protect_sent_quote_items();

CREATE OR REPLACE FUNCTION public.admin_pricing_calculate(
  p_service_code text,
  p_inputs jsonb DEFAULT '{}'::jsonb,
  p_effective_at timestamptz DEFAULT now(),
  p_pricing_version_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  PERFORM public.pricing_require_admin();
  RETURN public.pricing_calculate(
    p_service_code, p_inputs, p_effective_at, p_pricing_version_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pricing_calculate(text, jsonb, timestamptz, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pricing_resolve_version(text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pricing_calculate(text, jsonb, timestamptz, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.pricing_resolve_version(text, timestamptz)
  TO service_role;
REVOKE ALL ON FUNCTION public.admin_pricing_calculate(text, jsonb, timestamptz, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_pricing_calculate(text, jsonb, timestamptz, uuid)
  TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.admin_save_pricing_draft(
  uuid, text, text, timestamptz, boolean, jsonb, integer
);
CREATE OR REPLACE FUNCTION public.admin_save_pricing_draft(
  p_version_id uuid,
  p_name text,
  p_description text,
  p_effective_from timestamptz,
  p_effective_to timestamptz,
  p_is_mock boolean,
  p_components jsonb,
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
  v_previous jsonb;
  v_component jsonb;
BEGIN
  v_version := public.pricing_assert_draft(p_version_id, p_expected_row_version);
  IF NULLIF(trim(COALESCE(p_name, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Version name is required';
  END IF;
  IF p_effective_from IS NOT NULL AND p_effective_to IS NOT NULL
     AND p_effective_to <= p_effective_from THEN
    RAISE EXCEPTION 'Effective end must be after the start';
  END IF;
  IF jsonb_typeof(COALESCE(p_components, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Components must be an array';
  END IF;

  v_previous := jsonb_build_object(
    'version', to_jsonb(v_version),
    'components', (
      SELECT COALESCE(jsonb_agg(to_jsonb(component) ORDER BY component.calculation_order), '[]'::jsonb)
      FROM public.pricing_components component
      WHERE component.pricing_version_id = p_version_id
    )
  );

  UPDATE public.pricing_versions
  SET name = trim(p_name),
      description = NULLIF(trim(p_description), ''),
      effective_from = p_effective_from,
      effective_to = p_effective_to,
      is_mock = p_is_mock,
      row_version = row_version + 1,
      updated_at = now()
  WHERE id = p_version_id
  RETURNING * INTO v_version;

  DELETE FROM public.pricing_components WHERE pricing_version_id = p_version_id;
  FOR v_component IN
    SELECT * FROM jsonb_array_elements(COALESCE(p_components, '[]'::jsonb))
  LOOP
    IF COALESCE(v_component->>'component_code', '') = '' THEN
      RAISE EXCEPTION 'Component code is required';
    END IF;
    INSERT INTO public.pricing_components (
      pricing_version_id, service_code, component_code, customer_label,
      internal_description, calculation_type, amount, minimum_quantity,
      maximum_quantity, applicability_conditions, calculation_order,
      customer_visible, is_active
    ) VALUES (
      p_version_id,
      v_version.service_code,
      v_component->>'component_code',
      COALESCE(
        NULLIF(v_component->>'customer_label', ''),
        initcap(replace(v_component->>'component_code', '_', ' '))
      ),
      NULLIF(v_component->>'internal_description', ''),
      COALESCE(NULLIF(v_component->>'calculation_type', ''), 'flat'),
      GREATEST(0, COALESCE((v_component->>'amount')::numeric, 0)),
      GREATEST(0, COALESCE((v_component->>'minimum_quantity')::numeric, 0)),
      CASE
        WHEN v_component ? 'maximum_quantity'
          AND v_component->>'maximum_quantity' IS NOT NULL
        THEN (v_component->>'maximum_quantity')::numeric
        ELSE NULL
      END,
      COALESCE(v_component->'applicability_conditions', '{}'::jsonb),
      COALESCE((v_component->>'calculation_order')::integer, 0),
      COALESCE((v_component->>'customer_visible')::boolean, true),
      COALESCE((v_component->>'is_active')::boolean, true)
    );
  END LOOP;

  INSERT INTO public.pricing_audit_events (
    pricing_version_id, event_type, previous_value, new_value, performed_by
  ) VALUES (
    p_version_id,
    'draft_updated',
    v_previous,
    jsonb_build_object(
      'version', to_jsonb(v_version),
      'components', (
        SELECT COALESCE(jsonb_agg(to_jsonb(component) ORDER BY component.calculation_order), '[]'::jsonb)
        FROM public.pricing_components component
        WHERE component.pricing_version_id = p_version_id
      )
    ),
    v_actor
  );
  RETURN jsonb_build_object('version', to_jsonb(v_version));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_save_pricing_draft(
  uuid, text, text, timestamptz, timestamptz, boolean, jsonb, integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_save_pricing_draft(
  uuid, text, text, timestamptz, timestamptz, boolean, jsonb, integer
) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pricing_expire_due_quotes(p_booking_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quote public.service_quotes%ROWTYPE;
  v_count integer := 0;
BEGIN
  FOR v_quote IN
    SELECT * FROM public.service_quotes
    WHERE status::text = 'sent'
      AND sent_at IS NOT NULL
      AND accepted_at IS NULL
      AND declined_at IS NULL
      AND superseded_at IS NULL
      AND cancelled_at IS NULL
      AND expired_at IS NULL
      AND valid_until IS NOT NULL
      AND valid_until <= now()
      AND (p_booking_id IS NULL OR booking_id = p_booking_id)
    FOR UPDATE
  LOOP
    UPDATE public.service_quotes
    SET status = 'expired',
        expired_at = now(),
        row_version = row_version + 1,
        updated_at = now()
    WHERE id = v_quote.id;

    INSERT INTO public.quote_audit_events (
      quote_id, booking_id, event_type, previous_value, new_value, performed_by
    ) VALUES (
      v_quote.id,
      v_quote.booking_id,
      'quote_expired',
      to_jsonb(v_quote),
      jsonb_build_object('status', 'expired', 'expired_at', now()),
      NULL
    );
    v_count := v_count + 1;
  END LOOP;

  UPDATE public.service_bookings booking
  SET status = 'awaiting_quote', updated_at = now()
  WHERE (p_booking_id IS NULL OR booking.id = p_booking_id)
    AND booking.status = 'quoted'
    AND NOT EXISTS (
      SELECT 1 FROM public.service_quotes quote
      WHERE quote.booking_id = booking.id
        AND quote.status::text = 'sent'
        AND quote.accepted_at IS NULL
        AND quote.declined_at IS NULL
        AND quote.expired_at IS NULL
        AND quote.superseded_at IS NULL
        AND quote.cancelled_at IS NULL
        AND (quote.valid_until IS NULL OR quote.valid_until > now())
    );
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_expire_service_quotes()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  PERFORM public.pricing_require_admin();
  RETURN public.pricing_expire_due_quotes(NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.pricing_expire_due_quotes(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pricing_expire_due_quotes(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.admin_expire_service_quotes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_expire_service_quotes() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_quote_workspace(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_actor uuid := public.pricing_require_admin();
  v_booking public.service_bookings%ROWTYPE;
BEGIN
  PERFORM public.pricing_expire_due_quotes(p_booking_id);
  SELECT * INTO v_booking FROM public.service_bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Service booking not found'; END IF;
  RETURN jsonb_build_object(
    'booking', to_jsonb(v_booking),
    'quotes', (
      SELECT COALESCE(jsonb_agg(to_jsonb(quote) ORDER BY quote.revision_number DESC), '[]'::jsonb)
      FROM public.service_quotes quote WHERE quote.booking_id = p_booking_id
    ),
    'items', (
      SELECT COALESCE(jsonb_agg(to_jsonb(item) ORDER BY item.calculation_order, item.id), '[]'::jsonb)
      FROM public.service_quote_items item
      JOIN public.service_quotes quote ON quote.id = item.quote_id
      WHERE quote.booking_id = p_booking_id
    ),
    'audit_events', (
      SELECT COALESCE(jsonb_agg(to_jsonb(event) ORDER BY event.created_at DESC), '[]'::jsonb)
      FROM public.quote_audit_events event WHERE event.booking_id = p_booking_id
    ),
    'actor_id', v_actor
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.passenger_quote_workspace(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_booking public.service_bookings%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_booking
  FROM public.service_bookings
  WHERE id = p_booking_id AND booked_by_user_id = v_actor;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found for this passenger'; END IF;

  PERFORM public.pricing_expire_due_quotes(p_booking_id);
  SELECT * INTO v_booking FROM public.service_bookings WHERE id = p_booking_id;

  RETURN jsonb_build_object(
    'booking', jsonb_build_object(
      'id', v_booking.id,
      'booking_reference', v_booking.booking_reference,
      'service_type', v_booking.service_type::text,
      'status', v_booking.status::text,
      'start_at', v_booking.start_at,
      'quoted_total', v_booking.quoted_total,
      'deposit_amount', v_booking.deposit_amount,
      'deposit_status', v_booking.deposit_status::text
    ),
    'quotes', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', quote.id,
        'booking_id', quote.booking_id,
        'quote_reference', quote.quote_reference,
        'status', quote.status::text,
        'revision_number', quote.revision_number,
        'currency', quote.currency,
        'subtotal', quote.subtotal,
        'final_total', quote.final_total,
        'deposit_required', quote.deposit_required,
        'deposit_amount', quote.deposit_amount_snapshot,
        'valid_until', quote.valid_until,
        'sent_at', quote.sent_at,
        'accepted_at', quote.accepted_at,
        'declined_at', quote.declined_at,
        'expired_at', quote.expired_at,
        'superseded_at', quote.superseded_at,
        'cancelled_at', quote.cancelled_at,
        'row_version', quote.row_version,
        'created_at', quote.created_at
      ) ORDER BY quote.revision_number DESC), '[]'::jsonb)
      FROM public.service_quotes quote WHERE quote.booking_id = p_booking_id
    ),
    'items', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', item.id,
        'quote_id', item.quote_id,
        'component_code', item.component_code,
        'label', item.label,
        'description', item.description,
        'quantity', item.quantity,
        'unit', item.unit,
        'unit_price', item.unit_price,
        'line_subtotal', item.line_subtotal,
        'line_total', item.line_total,
        'calculation_order', item.calculation_order
      ) ORDER BY item.calculation_order, item.id), '[]'::jsonb)
      FROM public.service_quote_items item
      JOIN public.service_quotes quote ON quote.id = item.quote_id
      WHERE quote.booking_id = p_booking_id AND item.customer_visible
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_quote_deposit(
  p_quote_id uuid,
  p_required boolean,
  p_amount numeric,
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
  v_quote public.service_quotes%ROWTYPE;
  v_previous jsonb;
BEGIN
  IF NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Deposit reason is required';
  END IF;
  IF p_amount < 0 THEN RAISE EXCEPTION 'Deposit cannot be negative'; END IF;
  SELECT * INTO v_quote FROM public.service_quotes WHERE id = p_quote_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quote not found'; END IF;
  IF v_quote.status::text <> 'draft' OR v_quote.sent_at IS NOT NULL THEN
    RAISE EXCEPTION 'Only unsent draft quotes may change deposit terms';
  END IF;
  IF v_quote.row_version <> p_expected_row_version THEN
    RAISE EXCEPTION 'Quote changed since it was loaded';
  END IF;
  v_previous := to_jsonb(v_quote);
  UPDATE public.service_quotes
  SET deposit_required = p_required,
      deposit_amount_snapshot = CASE WHEN p_required THEN public.pricing_round_zar(p_amount) ELSE 0 END,
      updated_by = v_actor,
      row_version = row_version + 1,
      updated_at = now()
  WHERE id = p_quote_id
  RETURNING * INTO v_quote;
  INSERT INTO public.quote_audit_events(
    quote_id, booking_id, event_type, previous_value, new_value, reason, performed_by
  ) VALUES (
    v_quote.id, v_quote.booking_id, 'quote_deposit_updated',
    v_previous, to_jsonb(v_quote), trim(p_reason), v_actor
  );
  RETURN jsonb_build_object('quote', to_jsonb(v_quote));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_quote_deposit(uuid, boolean, numeric, text, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_quote_deposit(uuid, boolean, numeric, text, integer)
  TO authenticated, service_role;

-- Link quote-ready notifications directly to the safe role-specific quote workspace.

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS service_booking_id uuid
  REFERENCES public.service_bookings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS notifications_service_booking_idx
  ON public.notifications(service_booking_id);

CREATE OR REPLACE FUNCTION public.notify_quote_sent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_user_id uuid;
BEGIN
  IF NEW.sent_at IS NOT NULL AND OLD.sent_at IS NULL THEN
    SELECT booked_by_user_id INTO v_user_id
    FROM public.service_bookings WHERE id = NEW.booking_id;
    INSERT INTO public.notifications(
      user_id, type, title, body, service_booking_id
    ) VALUES (
      v_user_id,
      'service_quote_ready',
      'Your Access quote is ready',
      NEW.quote_reference || ' · ' || NEW.currency || ' ' || to_char(NEW.final_total, 'FM999999990.00'),
      NEW.booking_id
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS service_quotes_notify_sent ON public.service_quotes;
CREATE TRIGGER service_quotes_notify_sent
  AFTER UPDATE ON public.service_quotes
  FOR EACH ROW EXECUTE FUNCTION public.notify_quote_sent();

REVOKE ALL ON FUNCTION public.protect_pricing_version_immutability()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_sent_quote_snapshot()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_sent_quote_items()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_quote_sent()
  FROM PUBLIC, anon, authenticated;