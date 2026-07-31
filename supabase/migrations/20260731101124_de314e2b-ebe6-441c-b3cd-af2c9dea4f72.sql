-- Phase 4: server-authoritative pricing versions and immutable quotation snapshots.
-- Existing service_pricing_rules and quote records are preserved for compatibility.

CREATE SEQUENCE IF NOT EXISTS public.pricing_quote_reference_seq START 1;

CREATE TABLE IF NOT EXISTS public.pricing_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_code text NOT NULL CHECK (service_code IN (
    'ride', 'transport', 'assisted', 'appointment', 'extended_journey'
  )),
  version_number integer NOT NULL CHECK (version_number > 0),
  name text NOT NULL,
  description text,
  currency text NOT NULL DEFAULT 'ZAR' CHECK (currency = 'ZAR'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'retired')),
  effective_from timestamptz,
  effective_to timestamptz,
  is_mock boolean NOT NULL DEFAULT true,
  source_rule_id uuid REFERENCES public.service_pricing_rules(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  published_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  published_at timestamptz,
  retired_at timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (service_code, currency, version_number),
  CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to > effective_from),
  CHECK (status <> 'published' OR effective_from IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS pricing_versions_service_status_idx
  ON public.pricing_versions(service_code, currency, status, effective_from DESC);

CREATE TABLE IF NOT EXISTS public.pricing_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pricing_version_id uuid NOT NULL REFERENCES public.pricing_versions(id) ON DELETE CASCADE,
  service_code text NOT NULL CHECK (service_code IN (
    'ride', 'transport', 'assisted', 'appointment', 'extended_journey'
  )),
  component_code text NOT NULL,
  customer_label text NOT NULL,
  internal_description text,
  calculation_type text NOT NULL CHECK (calculation_type IN (
    'flat', 'per_km', 'per_minute', 'per_hour', 'per_day', 'percentage'
  )),
  amount numeric(14,4) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  minimum_quantity numeric(14,4) NOT NULL DEFAULT 0 CHECK (minimum_quantity >= 0),
  maximum_quantity numeric(14,4) CHECK (maximum_quantity IS NULL OR maximum_quantity >= minimum_quantity),
  applicability_conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
  calculation_order integer NOT NULL DEFAULT 0,
  customer_visible boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pricing_version_id, component_code)
);

CREATE INDEX IF NOT EXISTS pricing_components_version_order_idx
  ON public.pricing_components(pricing_version_id, calculation_order, component_code);

CREATE TABLE IF NOT EXISTS public.pricing_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pricing_version_id uuid REFERENCES public.pricing_versions(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  previous_value jsonb,
  new_value jsonb,
  reason text,
  performed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.quote_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid REFERENCES public.service_quotes(id) ON DELETE SET NULL,
  booking_id uuid REFERENCES public.service_bookings(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  previous_value jsonb,
  new_value jsonb,
  reason text,
  performed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pricing_operation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  operation_type text NOT NULL,
  idempotency_key text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (actor_id, operation_type, idempotency_key)
);

ALTER TABLE public.service_quotes
  ADD COLUMN IF NOT EXISTS pricing_version_id uuid REFERENCES public.pricing_versions(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS revision_number integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS adjustments_total numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS margin_amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS final_total numeric(12,2),
  ADD COLUMN IF NOT EXISTS deposit_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deposit_amount_snapshot numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS declined_at timestamptz,
  ADD COLUMN IF NOT EXISTS expired_at timestamptz,
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS superseded_by_quote_id uuid REFERENCES public.service_quotes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS calculation_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS calculation_engine_version text NOT NULL DEFAULT 'phase4-v1',
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS row_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS admin_override_reason text;

ALTER TABLE public.service_quotes
  DROP CONSTRAINT IF EXISTS service_quotes_booking_revision_unique;
ALTER TABLE public.service_quotes
  ADD CONSTRAINT service_quotes_booking_revision_unique UNIQUE (booking_id, revision_number);

UPDATE public.service_quotes
SET final_total = COALESCE(final_total, total),
    calculation_snapshot = CASE
      WHEN calculation_snapshot = '{}'::jsonb THEN jsonb_build_object(
        'legacy_quote', true,
        'subtotal', subtotal,
        'tax_amount', tax_amount,
        'total', total,
        'currency', currency
      )
      ELSE calculation_snapshot
    END;

ALTER TABLE public.service_quote_items
  ADD COLUMN IF NOT EXISTS component_code text,
  ADD COLUMN IF NOT EXISTS unit text,
  ADD COLUMN IF NOT EXISTS line_subtotal numeric(12,2),
  ADD COLUMN IF NOT EXISTS adjustment numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS source_pricing_component_id uuid REFERENCES public.pricing_components(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS calculation_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS customer_visible boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS internal_explanation text;

UPDATE public.service_quote_items
SET component_code = COALESCE(component_code, 'legacy_item'),
    unit = COALESCE(unit, 'unit'),
    line_subtotal = COALESCE(line_subtotal, line_total),
    calculation_order = CASE WHEN calculation_order = 0 THEN sort_order ELSE calculation_order END;

CREATE UNIQUE INDEX IF NOT EXISTS service_quotes_one_actionable_sent_idx
  ON public.service_quotes(booking_id)
  WHERE status = 'sent'::public.quote_status AND accepted_at IS NULL AND declined_at IS NULL
    AND expired_at IS NULL AND superseded_at IS NULL AND cancelled_at IS NULL;

CREATE OR REPLACE FUNCTION public.pricing_require_admin()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT private.has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Administrator role required';
  END IF;
  RETURN v_uid;
END;
$$;

CREATE OR REPLACE FUNCTION public.pricing_round_zar(p_amount numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$ SELECT round(COALESCE(p_amount, 0), 2); $$;

CREATE OR REPLACE FUNCTION public.pricing_assert_draft(p_version_id uuid, p_expected_row_version integer DEFAULT NULL)
RETURNS public.pricing_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE v_version public.pricing_versions%ROWTYPE;
BEGIN
  PERFORM public.pricing_require_admin();
  SELECT * INTO v_version FROM public.pricing_versions WHERE id = p_version_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pricing version not found'; END IF;
  IF v_version.status <> 'draft' THEN RAISE EXCEPTION 'Published or retired pricing is immutable'; END IF;
  IF p_expected_row_version IS NOT NULL AND v_version.row_version <> p_expected_row_version THEN
    RAISE EXCEPTION 'Pricing version changed since it was loaded';
  END IF;
  RETURN v_version;
END;
$$;

CREATE OR REPLACE FUNCTION public.pricing_resolve_version(
  p_service_code text,
  p_effective_at timestamptz DEFAULT now()
)
RETURNS public.pricing_versions
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_version public.pricing_versions%ROWTYPE;
BEGIN
  IF p_service_code NOT IN ('ride', 'transport', 'assisted', 'appointment', 'extended_journey') THEN
    RAISE EXCEPTION 'Unsupported service code';
  END IF;
  SELECT * INTO v_version
  FROM public.pricing_versions
  WHERE service_code = p_service_code
    AND currency = 'ZAR'
    AND status = 'published'
    AND effective_from <= COALESCE(p_effective_at, now())
    AND (effective_to IS NULL OR effective_to > COALESCE(p_effective_at, now()))
  ORDER BY effective_from DESC, version_number DESC
  LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'No published pricing version is available for %', p_service_code; END IF;
  RETURN v_version;
END;
$$;

CREATE OR REPLACE FUNCTION public.pricing_calculate(
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
DECLARE
  v_uid uuid := auth.uid();
  v_version public.pricing_versions%ROWTYPE;
  v_component public.pricing_components%ROWTYPE;
  v_quantity numeric;
  v_line_subtotal numeric;
  v_line_total numeric;
  v_running numeric := 0;
  v_margin numeric := 0;
  v_lines jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_is_admin boolean := false;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  v_is_admin := private.has_role(v_uid, 'admin'::app_role);

  IF p_pricing_version_id IS NOT NULL THEN
    SELECT * INTO v_version FROM public.pricing_versions WHERE id = p_pricing_version_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Pricing version not found'; END IF;
    IF v_version.service_code <> p_service_code THEN RAISE EXCEPTION 'Pricing version service mismatch'; END IF;
    IF v_version.status <> 'published' AND NOT v_is_admin THEN
      RAISE EXCEPTION 'Only administrators may preview draft pricing';
    END IF;
  ELSE
    v_version := public.pricing_resolve_version(p_service_code, p_effective_at);
  END IF;

  IF p_service_code IN ('ride', 'transport', 'assisted', 'appointment', 'extended_journey')
     AND NOT (p_inputs ? 'distance_km') THEN
    v_warnings := v_warnings || jsonb_build_array('Route distance is required');
  END IF;
  IF p_service_code IN ('assisted', 'appointment') AND NOT (p_inputs ? 'companion_hours') THEN
    v_warnings := v_warnings || jsonb_build_array('Companion hours are required');
  END IF;
  IF p_service_code = 'appointment' AND NOT (p_inputs ? 'waiting_hours') THEN
    v_warnings := v_warnings || jsonb_build_array('Waiting duration is required');
  END IF;
  IF p_service_code = 'extended_journey' AND NOT (p_inputs ? 'journey_days') THEN
    v_warnings := v_warnings || jsonb_build_array('Number of journey days is required');
  END IF;

  FOR v_component IN
    SELECT * FROM public.pricing_components
    WHERE pricing_version_id = v_version.id AND is_active
    ORDER BY calculation_order, component_code
  LOOP
    v_quantity := CASE v_component.component_code
      WHEN 'base_fare' THEN 1
      WHEN 'distance' THEN GREATEST(0, COALESCE((p_inputs->>'distance_km')::numeric, 0))
      WHEN 'companion_hours' THEN GREATEST(v_component.minimum_quantity, COALESCE((p_inputs->>'companion_hours')::numeric, 0))
      WHEN 'waiting_hours' THEN GREATEST(v_component.minimum_quantity, COALESCE((p_inputs->>'waiting_hours')::numeric, 0))
      WHEN 'specialist_vehicle' THEN CASE WHEN COALESCE((p_inputs->>'specialist_vehicle_required')::boolean, false) THEN 1 ELSE 0 END
      WHEN 'vehicle_days' THEN GREATEST(v_component.minimum_quantity, COALESCE((p_inputs->>'journey_days')::numeric, 0))
      WHEN 'driver_days' THEN GREATEST(v_component.minimum_quantity, COALESCE((p_inputs->>'journey_days')::numeric, 0))
      WHEN 'driver_overnights' THEN GREATEST(v_component.minimum_quantity, COALESCE((p_inputs->>'driver_overnights')::numeric, 0))
      WHEN 'companion_days' THEN GREATEST(v_component.minimum_quantity, COALESCE((p_inputs->>'companion_days')::numeric, 0))
      ELSE GREATEST(v_component.minimum_quantity, COALESCE((p_inputs->>v_component.component_code)::numeric, 0))
    END;

    IF v_component.maximum_quantity IS NOT NULL THEN
      v_quantity := LEAST(v_quantity, v_component.maximum_quantity);
    END IF;

    IF v_component.calculation_type = 'percentage' THEN
      v_line_subtotal := public.pricing_round_zar(v_running * v_component.amount / 100);
      v_margin := v_margin + v_line_subtotal;
    ELSE
      v_line_subtotal := public.pricing_round_zar(v_component.amount * v_quantity);
    END IF;
    v_line_total := v_line_subtotal;
    v_running := public.pricing_round_zar(v_running + v_line_total);

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'component_id', v_component.id,
      'component_code', v_component.component_code,
      'label', v_component.customer_label,
      'calculation_type', v_component.calculation_type,
      'quantity', v_quantity,
      'unit', CASE v_component.calculation_type
        WHEN 'per_km' THEN 'km'
        WHEN 'per_minute' THEN 'minute'
        WHEN 'per_hour' THEN 'hour'
        WHEN 'per_day' THEN 'day'
        WHEN 'percentage' THEN 'percent'
        ELSE 'unit'
      END,
      'unit_price', v_component.amount,
      'line_subtotal', v_line_subtotal,
      'adjustment', 0,
      'line_total', v_line_total,
      'customer_visible', v_component.customer_visible,
      'calculation_order', v_component.calculation_order
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'engine_version', 'phase4-v1',
    'calculated_at', now(),
    'pricing_version_id', v_version.id,
    'pricing_version_number', v_version.version_number,
    'service_code', p_service_code,
    'currency', v_version.currency,
    'is_mock', v_version.is_mock,
    'inputs', COALESCE(p_inputs, '{}'::jsonb),
    'warnings', v_warnings,
    'lines', v_lines,
    'subtotal', public.pricing_round_zar(v_running - v_margin),
    'margin_amount', public.pricing_round_zar(v_margin),
    'adjustments_total', 0,
    'total', public.pricing_round_zar(v_running)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_create_pricing_draft(
  p_service_code text,
  p_clone_from_version_id uuid DEFAULT NULL,
  p_name text DEFAULT NULL,
  p_effective_from timestamptz DEFAULT NULL,
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
  v_source public.pricing_versions%ROWTYPE;
  v_version public.pricing_versions%ROWTYPE;
BEGIN
  IF p_service_code NOT IN ('ride', 'transport', 'assisted', 'appointment', 'extended_journey') THEN
    RAISE EXCEPTION 'Unsupported service code';
  END IF;
  IF p_idempotency_key IS NOT NULL THEN
    SELECT result INTO v_existing FROM public.pricing_operation_requests
    WHERE actor_id = v_actor AND operation_type = 'create_pricing_draft' AND idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_existing; END IF;
  END IF;

  IF p_clone_from_version_id IS NOT NULL THEN
    SELECT * INTO v_source FROM public.pricing_versions WHERE id = p_clone_from_version_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Source pricing version not found'; END IF;
    IF v_source.service_code <> p_service_code THEN RAISE EXCEPTION 'Source service mismatch'; END IF;
  END IF;

  INSERT INTO public.pricing_versions (
    service_code, version_number, name, description, currency, status,
    effective_from, is_mock, created_by
  ) VALUES (
    p_service_code,
    COALESCE((SELECT max(version_number) + 1 FROM public.pricing_versions WHERE service_code = p_service_code AND currency = 'ZAR'), 1),
    COALESCE(NULLIF(trim(p_name), ''), initcap(replace(p_service_code, '_', ' ')) || ' draft'),
    CASE WHEN p_clone_from_version_id IS NULL THEN NULL ELSE 'Cloned from version ' || v_source.version_number END,
    'ZAR', 'draft', p_effective_from,
    COALESCE(v_source.is_mock, p_service_code NOT IN ('ride', 'transport')),
    v_actor
  ) RETURNING * INTO v_version;

  IF p_clone_from_version_id IS NOT NULL THEN
    INSERT INTO public.pricing_components (
      pricing_version_id, service_code, component_code, customer_label,
      internal_description, calculation_type, amount, minimum_quantity,
      maximum_quantity, applicability_conditions, calculation_order,
      customer_visible, is_active
    )
    SELECT v_version.id, service_code, component_code, customer_label,
      internal_description, calculation_type, amount, minimum_quantity,
      maximum_quantity, applicability_conditions, calculation_order,
      customer_visible, is_active
    FROM public.pricing_components WHERE pricing_version_id = p_clone_from_version_id;
  END IF;

  INSERT INTO public.pricing_audit_events (
    pricing_version_id, event_type, new_value, performed_by
  ) VALUES (v_version.id, 'draft_created', to_jsonb(v_version), v_actor);

  v_existing := jsonb_build_object('version', to_jsonb(v_version));
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.pricing_operation_requests(actor_id, operation_type, idempotency_key, result)
    VALUES (v_actor, 'create_pricing_draft', p_idempotency_key, v_existing)
    ON CONFLICT (actor_id, operation_type, idempotency_key) DO NOTHING;
  END IF;
  RETURN v_existing;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_save_pricing_draft(
  p_version_id uuid,
  p_name text,
  p_description text,
  p_effective_from timestamptz,
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
  IF NULLIF(trim(COALESCE(p_name, '')), '') IS NULL THEN RAISE EXCEPTION 'Version name is required'; END IF;
  IF jsonb_typeof(COALESCE(p_components, '[]'::jsonb)) <> 'array' THEN RAISE EXCEPTION 'Components must be an array'; END IF;
  v_previous := jsonb_build_object(
    'version', to_jsonb(v_version),
    'components', (SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.calculation_order), '[]'::jsonb)
                   FROM public.pricing_components c WHERE c.pricing_version_id = p_version_id)
  );

  UPDATE public.pricing_versions
  SET name = trim(p_name), description = NULLIF(trim(p_description), ''),
      effective_from = p_effective_from, is_mock = p_is_mock,
      row_version = row_version + 1, updated_at = now()
  WHERE id = p_version_id RETURNING * INTO v_version;

  DELETE FROM public.pricing_components WHERE pricing_version_id = p_version_id;
  FOR v_component IN SELECT * FROM jsonb_array_elements(COALESCE(p_components, '[]'::jsonb))
  LOOP
    IF COALESCE(v_component->>'component_code', '') = '' THEN RAISE EXCEPTION 'Component code is required'; END IF;
    INSERT INTO public.pricing_components (
      pricing_version_id, service_code, component_code, customer_label,
      internal_description, calculation_type, amount, minimum_quantity,
      maximum_quantity, applicability_conditions, calculation_order,
      customer_visible, is_active
    ) VALUES (
      p_version_id, v_version.service_code, v_component->>'component_code',
      COALESCE(NULLIF(v_component->>'customer_label', ''), initcap(replace(v_component->>'component_code', '_', ' '))),
      NULLIF(v_component->>'internal_description', ''),
      COALESCE(NULLIF(v_component->>'calculation_type', ''), 'flat'),
      GREATEST(0, COALESCE((v_component->>'amount')::numeric, 0)),
      GREATEST(0, COALESCE((v_component->>'minimum_quantity')::numeric, 0)),
      CASE WHEN v_component ? 'maximum_quantity' AND v_component->>'maximum_quantity' IS NOT NULL
        THEN (v_component->>'maximum_quantity')::numeric ELSE NULL END,
      COALESCE(v_component->'applicability_conditions', '{}'::jsonb),
      COALESCE((v_component->>'calculation_order')::integer, 0),
      COALESCE((v_component->>'customer_visible')::boolean, true),
      COALESCE((v_component->>'is_active')::boolean, true)
    );
  END LOOP;

  INSERT INTO public.pricing_audit_events (
    pricing_version_id, event_type, previous_value, new_value, performed_by
  ) VALUES (
    p_version_id, 'draft_updated', v_previous,
    jsonb_build_object(
      'version', to_jsonb(v_version),
      'components', (SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.calculation_order), '[]'::jsonb)
                     FROM public.pricing_components c WHERE c.pricing_version_id = p_version_id)
    ), v_actor
  );
  RETURN jsonb_build_object('version', to_jsonb(v_version));
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
BEGIN
  v_version := public.pricing_assert_draft(p_version_id, p_expected_row_version);
  IF lower(trim(COALESCE(p_confirmation, ''))) <> 'publish' THEN
    RAISE EXCEPTION 'Type PUBLISH to confirm';
  END IF;
  IF v_version.effective_from IS NULL THEN RAISE EXCEPTION 'Effective date is required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pricing_components WHERE pricing_version_id = p_version_id AND is_active) THEN
    RAISE EXCEPTION 'At least one active component is required';
  END IF;
  IF v_version.is_mock THEN RAISE EXCEPTION 'Mock pricing cannot be published'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.pricing_versions existing
    WHERE existing.id <> p_version_id
      AND existing.service_code = v_version.service_code
      AND existing.currency = v_version.currency
      AND existing.status = 'published'
      AND tstzrange(existing.effective_from, existing.effective_to, '[)')
          && tstzrange(v_version.effective_from, v_version.effective_to, '[)')
  ) THEN RAISE EXCEPTION 'Published pricing date range overlaps another version'; END IF;

  v_previous := to_jsonb(v_version);
  UPDATE public.pricing_versions
  SET status = 'published', published_by = v_actor, published_at = now(),
      row_version = row_version + 1, updated_at = now()
  WHERE id = p_version_id RETURNING * INTO v_version;

  INSERT INTO public.pricing_audit_events (
    pricing_version_id, event_type, previous_value, new_value, performed_by
  ) VALUES (p_version_id, 'version_published', v_previous, to_jsonb(v_version), v_actor);
  RETURN jsonb_build_object('version', to_jsonb(v_version));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_retire_pricing_version(
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
  v_previous jsonb;
BEGIN
  IF NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN RAISE EXCEPTION 'Retirement reason is required'; END IF;
  SELECT * INTO v_version FROM public.pricing_versions WHERE id = p_version_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pricing version not found'; END IF;
  IF v_version.status <> 'published' THEN RAISE EXCEPTION 'Only published pricing may be retired'; END IF;
  IF v_version.row_version <> p_expected_row_version THEN RAISE EXCEPTION 'Pricing version changed since it was loaded'; END IF;
  v_previous := to_jsonb(v_version);
  UPDATE public.pricing_versions
  SET status = 'retired', effective_to = COALESCE(effective_to, now()), retired_at = now(),
      row_version = row_version + 1, updated_at = now()
  WHERE id = p_version_id RETURNING * INTO v_version;
  INSERT INTO public.pricing_audit_events (
    pricing_version_id, event_type, previous_value, new_value, reason, performed_by
  ) VALUES (p_version_id, 'version_retired', v_previous, to_jsonb(v_version), trim(p_reason), v_actor);
  RETURN jsonb_build_object('version', to_jsonb(v_version));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_generate_service_quote(
  p_booking_id uuid,
  p_inputs jsonb,
  p_valid_until timestamptz,
  p_expected_booking_status text DEFAULT NULL,
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
  v_booking public.service_bookings%ROWTYPE;
  v_snapshot jsonb;
  v_quote public.service_quotes%ROWTYPE;
  v_line jsonb;
  v_revision integer;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    SELECT result INTO v_existing FROM public.pricing_operation_requests
    WHERE actor_id = v_actor AND operation_type = 'generate_service_quote' AND idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_existing; END IF;
  END IF;

  SELECT * INTO v_booking FROM public.service_bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Service booking not found'; END IF;
  IF p_expected_booking_status IS NOT NULL AND v_booking.status::text <> p_expected_booking_status THEN
    RAISE EXCEPTION 'Booking changed since it was loaded';
  END IF;
  IF v_booking.status::text IN ('accepted', 'resources_assigned', 'active', 'completed', 'cancelled') THEN
    RAISE EXCEPTION 'Booking state does not allow a new quote';
  END IF;

  v_snapshot := public.pricing_calculate(
    v_booking.service_type::text,
    COALESCE(p_inputs, '{}'::jsonb),
    COALESCE(v_booking.start_at, now()),
    NULL
  );
  IF jsonb_array_length(COALESCE(v_snapshot->'warnings', '[]'::jsonb)) > 0 THEN
    RAISE EXCEPTION 'Required pricing inputs are missing: %', v_snapshot->'warnings';
  END IF;

  SELECT COALESCE(max(revision_number), 0) + 1 INTO v_revision
  FROM public.service_quotes WHERE booking_id = p_booking_id;

  INSERT INTO public.service_quotes (
    booking_id, quote_reference, status, pricing_version_id, revision_number,
    subtotal, tax_amount, total, adjustments_total, margin_amount, final_total,
    currency, valid_until, created_by_user_id, updated_by,
    calculation_snapshot, calculation_engine_version, row_version
  ) VALUES (
    p_booking_id,
    'ACC-Q-' || lpad(nextval('public.pricing_quote_reference_seq')::text, 6, '0'),
    'draft',
    (v_snapshot->>'pricing_version_id')::uuid,
    v_revision,
    (v_snapshot->>'subtotal')::numeric,
    0,
    (v_snapshot->>'total')::numeric,
    0,
    (v_snapshot->>'margin_amount')::numeric,
    (v_snapshot->>'total')::numeric,
    COALESCE(v_snapshot->>'currency', 'ZAR'),
    p_valid_until,
    v_actor, v_actor,
    v_snapshot, COALESCE(v_snapshot->>'engine_version', 'phase4-v1'), 1
  ) RETURNING * INTO v_quote;

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_snapshot->'lines')
  LOOP
    INSERT INTO public.service_quote_items (
      quote_id, component_code, label, description, quantity, unit, unit_price,
      line_subtotal, adjustment, line_total, source_pricing_component_id,
      calculation_order, sort_order, customer_visible, internal_explanation
    ) VALUES (
      v_quote.id, v_line->>'component_code', v_line->>'label', NULL,
      COALESCE((v_line->>'quantity')::numeric, 0), v_line->>'unit',
      COALESCE((v_line->>'unit_price')::numeric, 0),
      COALESCE((v_line->>'line_subtotal')::numeric, 0), 0,
      COALESCE((v_line->>'line_total')::numeric, 0),
      NULLIF(v_line->>'component_id', '')::uuid,
      COALESCE((v_line->>'calculation_order')::integer, 0),
      COALESCE((v_line->>'calculation_order')::integer, 0),
      COALESCE((v_line->>'customer_visible')::boolean, true), NULL
    );
  END LOOP;

  UPDATE public.service_bookings
  SET estimated_total = v_quote.final_total, updated_at = now()
  WHERE id = p_booking_id;

  INSERT INTO public.quote_audit_events(
    quote_id, booking_id, event_type, new_value, performed_by
  ) VALUES (v_quote.id, p_booking_id, 'quote_generated', to_jsonb(v_quote), v_actor);

  v_existing := jsonb_build_object('quote', to_jsonb(v_quote), 'snapshot', v_snapshot);
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.pricing_operation_requests(actor_id, operation_type, idempotency_key, result)
    VALUES (v_actor, 'generate_service_quote', p_idempotency_key, v_existing)
    ON CONFLICT (actor_id, operation_type, idempotency_key) DO NOTHING;
  END IF;
  RETURN v_existing;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_apply_quote_override(
  p_quote_id uuid,
  p_adjustment numeric,
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
  IF NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN RAISE EXCEPTION 'Override reason is required'; END IF;
  SELECT * INTO v_quote FROM public.service_quotes WHERE id = p_quote_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quote not found'; END IF;
  IF v_quote.status::text <> 'draft' OR v_quote.sent_at IS NOT NULL THEN RAISE EXCEPTION 'Only unsent draft quotes may be overridden'; END IF;
  IF v_quote.row_version <> p_expected_row_version THEN RAISE EXCEPTION 'Quote changed since it was loaded'; END IF;
  v_previous := to_jsonb(v_quote);
  UPDATE public.service_quotes
  SET adjustments_total = public.pricing_round_zar(p_adjustment),
      final_total = public.pricing_round_zar(subtotal + margin_amount + p_adjustment),
      total = public.pricing_round_zar(subtotal + margin_amount + p_adjustment),
      admin_override_reason = trim(p_reason), updated_by = v_actor,
      calculation_snapshot = calculation_snapshot || jsonb_build_object(
        'admin_override', jsonb_build_object(
          'original_total', COALESCE(final_total, total),
          'adjustment', public.pricing_round_zar(p_adjustment),
          'reason', trim(p_reason),
          'performed_by', v_actor,
          'performed_at', now()
        )
      ),
      row_version = row_version + 1, updated_at = now()
  WHERE id = p_quote_id RETURNING * INTO v_quote;
  INSERT INTO public.quote_audit_events(
    quote_id, booking_id, event_type, previous_value, new_value, reason, performed_by
  ) VALUES (v_quote.id, v_quote.booking_id, 'admin_override_applied', v_previous, to_jsonb(v_quote), trim(p_reason), v_actor);
  RETURN jsonb_build_object('quote', to_jsonb(v_quote));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_send_service_quote(
  p_quote_id uuid,
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
  v_previous jsonb;
  v_old public.service_quotes%ROWTYPE;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    SELECT result INTO v_existing FROM public.pricing_operation_requests
    WHERE actor_id = v_actor AND operation_type = 'send_service_quote' AND idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_existing; END IF;
  END IF;
  SELECT * INTO v_quote FROM public.service_quotes WHERE id = p_quote_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quote not found'; END IF;
  IF v_quote.status::text <> 'draft' OR v_quote.sent_at IS NOT NULL THEN RAISE EXCEPTION 'Only an unsent draft quote may be sent'; END IF;
  IF v_quote.row_version <> p_expected_row_version THEN RAISE EXCEPTION 'Quote changed since it was loaded'; END IF;
  IF p_valid_until IS NULL OR p_valid_until <= now() THEN RAISE EXCEPTION 'Quote validity must be in the future'; END IF;
  v_previous := to_jsonb(v_quote);

  FOR v_old IN
    SELECT * FROM public.service_quotes
    WHERE booking_id = v_quote.booking_id AND id <> v_quote.id
      AND status::text = 'sent' AND accepted_at IS NULL AND declined_at IS NULL
      AND expired_at IS NULL AND superseded_at IS NULL AND cancelled_at IS NULL
    FOR UPDATE
  LOOP
    UPDATE public.service_quotes
    SET superseded_at = now(), superseded_by_quote_id = v_quote.id,
        updated_by = v_actor, row_version = row_version + 1, updated_at = now()
    WHERE id = v_old.id;
    INSERT INTO public.quote_audit_events(
      quote_id, booking_id, event_type, previous_value, new_value, performed_by
    ) VALUES (
      v_old.id, v_old.booking_id, 'quote_superseded', to_jsonb(v_old),
      jsonb_build_object('superseded_by_quote_id', v_quote.id), v_actor
    );
  END LOOP;

  UPDATE public.service_quotes
  SET status = 'sent', valid_until = p_valid_until, sent_at = now(), updated_by = v_actor,
      row_version = row_version + 1, updated_at = now()
  WHERE id = p_quote_id RETURNING * INTO v_quote;

  UPDATE public.service_bookings
  SET status = 'quoted', quoted_total = v_quote.final_total,
      deposit_amount = CASE WHEN v_quote.deposit_required THEN v_quote.deposit_amount_snapshot ELSE deposit_amount END,
      updated_at = now()
  WHERE id = v_quote.booking_id;

  INSERT INTO public.quote_audit_events(
    quote_id, booking_id, event_type, previous_value, new_value, performed_by
  ) VALUES (v_quote.id, v_quote.booking_id, 'quote_sent', v_previous, to_jsonb(v_quote), v_actor);

  v_existing := jsonb_build_object('quote', to_jsonb(v_quote));
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.pricing_operation_requests(actor_id, operation_type, idempotency_key, result)
    VALUES (v_actor, 'send_service_quote', p_idempotency_key, v_existing)
    ON CONFLICT (actor_id, operation_type, idempotency_key) DO NOTHING;
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
    SELECT result INTO v_existing FROM public.pricing_operation_requests
    WHERE actor_id = v_actor AND operation_type = 'accept_service_quote' AND idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_existing; END IF;
  END IF;
  SELECT quote.* INTO v_quote
  FROM public.service_quotes quote
  JOIN public.service_bookings booking ON booking.id = quote.booking_id
  WHERE quote.id = p_quote_id AND booking.booked_by_user_id = v_actor
  FOR UPDATE OF quote;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quote not found for this passenger'; END IF;
  IF v_quote.accepted_at IS NOT NULL THEN RETURN jsonb_build_object('quote', to_jsonb(v_quote)); END IF;
  IF v_quote.status::text <> 'sent' OR v_quote.sent_at IS NULL THEN RAISE EXCEPTION 'Quote is not available for acceptance'; END IF;
  IF v_quote.declined_at IS NOT NULL OR v_quote.expired_at IS NOT NULL OR v_quote.superseded_at IS NOT NULL OR v_quote.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Quote is no longer actionable';
  END IF;
  IF v_quote.valid_until IS NOT NULL AND v_quote.valid_until <= now() THEN
    UPDATE public.service_quotes SET expired_at = now(), row_version = row_version + 1, updated_at = now() WHERE id = p_quote_id;
    RAISE EXCEPTION 'Quote has expired';
  END IF;
  IF v_quote.row_version <> p_expected_row_version THEN RAISE EXCEPTION 'Quote changed since it was loaded'; END IF;
  v_previous := to_jsonb(v_quote);
  UPDATE public.service_quotes
  SET status = 'accepted', accepted_at = now(), updated_by = v_actor,
      row_version = row_version + 1, updated_at = now()
  WHERE id = p_quote_id RETURNING * INTO v_quote;
  UPDATE public.service_bookings
  SET status = 'accepted', quoted_total = v_quote.final_total, updated_at = now()
  WHERE id = v_quote.booking_id;
  INSERT INTO public.quote_audit_events(
    quote_id, booking_id, event_type, previous_value, new_value, performed_by
  ) VALUES (v_quote.id, v_quote.booking_id, 'quote_accepted', v_previous, to_jsonb(v_quote), v_actor);
  v_existing := jsonb_build_object('quote', to_jsonb(v_quote));
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.pricing_operation_requests(actor_id, operation_type, idempotency_key, result)
    VALUES (v_actor, 'accept_service_quote', p_idempotency_key, v_existing)
    ON CONFLICT (actor_id, operation_type, idempotency_key) DO NOTHING;
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
  WHERE quote.id = p_quote_id AND booking.booked_by_user_id = v_actor
  FOR UPDATE OF quote;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quote not found for this passenger'; END IF;
  IF v_quote.status::text <> 'sent' OR v_quote.accepted_at IS NOT NULL OR v_quote.superseded_at IS NOT NULL THEN
    RAISE EXCEPTION 'Quote is not available for decline';
  END IF;
  IF v_quote.row_version <> p_expected_row_version THEN RAISE EXCEPTION 'Quote changed since it was loaded'; END IF;
  v_previous := to_jsonb(v_quote);
  UPDATE public.service_quotes
  SET status = 'rejected', declined_at = now(), updated_by = v_actor,
      row_version = row_version + 1, updated_at = now()
  WHERE id = p_quote_id RETURNING * INTO v_quote;
  UPDATE public.service_bookings SET status = 'awaiting_quote', updated_at = now() WHERE id = v_quote.booking_id;
  INSERT INTO public.quote_audit_events(
    quote_id, booking_id, event_type, previous_value, new_value, reason, performed_by
  ) VALUES (v_quote.id, v_quote.booking_id, 'quote_declined', v_previous, to_jsonb(v_quote), NULLIF(trim(p_reason), ''), v_actor);
  RETURN jsonb_build_object('quote', to_jsonb(v_quote));
END;
$$;

-- Migrate the five mutable legacy rules into version 1 records.
INSERT INTO public.pricing_versions (
  service_code, version_number, name, description, currency, status,
  effective_from, is_mock, source_rule_id
)
SELECT
  legacy.service_type, 1,
  initcap(replace(legacy.service_type, '_', ' ')) || ' version 1',
  CASE WHEN legacy.is_mock THEN 'Migrated mock draft from Phase 1' ELSE 'Confirmed Phase 1 pricing' END,
  legacy.currency,
  CASE WHEN legacy.service_type IN ('ride', 'transport') AND NOT legacy.is_mock THEN 'published' ELSE 'draft' END,
  legacy.effective_from,
  legacy.is_mock,
  legacy.id
FROM public.service_pricing_rules legacy
WHERE NOT EXISTS (
  SELECT 1 FROM public.pricing_versions existing
  WHERE existing.service_code = legacy.service_type
    AND existing.currency = legacy.currency
    AND existing.version_number = 1
)
ON CONFLICT (service_code, currency, version_number) DO NOTHING;

INSERT INTO public.pricing_components (
  pricing_version_id, service_code, component_code, customer_label,
  calculation_type, amount, minimum_quantity, calculation_order,
  customer_visible, is_active
)
SELECT version.id, version.service_code, component.component_code, component.customer_label,
       component.calculation_type, component.amount, component.minimum_quantity,
       component.calculation_order, component.customer_visible, component.amount > 0
FROM public.pricing_versions version
JOIN public.service_pricing_rules legacy ON legacy.id = version.source_rule_id
CROSS JOIN LATERAL (
  VALUES
    ('base_fare', 'Base fare', 'flat', legacy.base_fare, 1::numeric, 10, true),
    ('distance', 'Distance', 'per_km', legacy.per_km_rate, 0::numeric, 20, true),
    ('transport_minutes', 'Transport time', 'per_minute', legacy.per_minute_rate, 0::numeric, 30, true),
    ('companion_hours', 'Companion assistance', 'per_hour', legacy.companion_hourly_rate, legacy.companion_minimum_hours, 40, true),
    ('waiting_hours', 'Waiting time', 'per_hour', legacy.waiting_hourly_rate, 0::numeric, 50, true),
    ('specialist_vehicle', 'Specialist vehicle', 'flat', legacy.specialist_vehicle_fee, 0::numeric, 60, true),
    ('vehicle_days', 'Vehicle days', 'per_day', legacy.vehicle_daily_rate, 0::numeric, 70, true),
    ('driver_days', 'Driver days', 'per_day', legacy.driver_daily_rate, 0::numeric, 80, true),
    ('driver_overnights', 'Driver overnight', 'flat', legacy.driver_overnight_rate, 0::numeric, 90, true),
    ('companion_days', 'Companion days', 'per_day', legacy.companion_daily_rate, 0::numeric, 100, true),
    ('platform_margin', 'Platform margin', 'percentage', legacy.platform_margin_percent, 0::numeric, 110, false)
) AS component(component_code, customer_label, calculation_type, amount, minimum_quantity, calculation_order, customer_visible)
WHERE NOT EXISTS (
  SELECT 1 FROM public.pricing_components existing
  WHERE existing.pricing_version_id = version.id
    AND existing.component_code = component.component_code
)
ON CONFLICT (pricing_version_id, component_code) DO NOTHING;

UPDATE public.pricing_versions
SET published_at = COALESCE(published_at, created_at)
WHERE status = 'published' AND published_at IS NULL;

-- Protect published versions and quote snapshots from direct client mutation.
ALTER TABLE public.pricing_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_operation_requests ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.pricing_versions, public.pricing_components,
  public.pricing_audit_events, public.quote_audit_events TO authenticated;
GRANT ALL ON public.pricing_versions, public.pricing_components,
  public.pricing_audit_events, public.quote_audit_events,
  public.pricing_operation_requests TO service_role;

DROP POLICY IF EXISTS "Admins read pricing versions" ON public.pricing_versions;
CREATE POLICY "Admins read pricing versions" ON public.pricing_versions
  FOR SELECT TO authenticated USING (private.has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS "Admins read pricing components" ON public.pricing_components;
CREATE POLICY "Admins read pricing components" ON public.pricing_components
  FOR SELECT TO authenticated USING (private.has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS "Admins read pricing audit" ON public.pricing_audit_events;
CREATE POLICY "Admins read pricing audit" ON public.pricing_audit_events
  FOR SELECT TO authenticated USING (private.has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS "Admins read quote audit" ON public.quote_audit_events;
CREATE POLICY "Admins read quote audit" ON public.quote_audit_events
  FOR SELECT TO authenticated USING (private.has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS "No direct pricing request access" ON public.pricing_operation_requests;
CREATE POLICY "No direct pricing request access" ON public.pricing_operation_requests
  FOR SELECT TO authenticated USING (false);

-- Replace direct write policies for quotes with protected RPC-only transitions.
DROP POLICY IF EXISTS "admins manage quotes" ON public.service_quotes;
DROP POLICY IF EXISTS "Admins manage quotes" ON public.service_quotes;
DROP POLICY IF EXISTS "admins manage quote items" ON public.service_quote_items;
DROP POLICY IF EXISTS "Admins manage quote items" ON public.service_quote_items;

DROP POLICY IF EXISTS "Admins read all quotes" ON public.service_quotes;
CREATE POLICY "Admins read all quotes" ON public.service_quotes
  FOR SELECT TO authenticated USING (private.has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS "Booker reads own quotes" ON public.service_quotes;
CREATE POLICY "Booker reads own quotes" ON public.service_quotes
  FOR SELECT TO authenticated USING (private.is_booking_owner(booking_id, auth.uid()));

DROP POLICY IF EXISTS "Admins read all quote items" ON public.service_quote_items;
CREATE POLICY "Admins read all quote items" ON public.service_quote_items
  FOR SELECT TO authenticated USING (private.has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS "Booker reads customer quote items" ON public.service_quote_items;
CREATE POLICY "Booker reads customer quote items" ON public.service_quote_items
  FOR SELECT TO authenticated USING (
    customer_visible
    AND EXISTS (
      SELECT 1 FROM public.service_quotes quote
      WHERE quote.id = service_quote_items.quote_id
        AND private.is_booking_owner(quote.booking_id, auth.uid())
    )
  );

REVOKE INSERT, UPDATE, DELETE ON public.pricing_versions, public.pricing_components,
  public.pricing_audit_events, public.quote_audit_events, public.pricing_operation_requests,
  public.service_quotes, public.service_quote_items FROM authenticated;

REVOKE ALL ON FUNCTION public.pricing_require_admin() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pricing_assert_draft(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pricing_round_zar(numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pricing_resolve_version(text, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pricing_calculate(text, jsonb, timestamptz, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_create_pricing_draft(text, uuid, text, timestamptz, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_save_pricing_draft(uuid, text, text, timestamptz, boolean, jsonb, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_publish_pricing_version(uuid, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_retire_pricing_version(uuid, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_generate_service_quote(uuid, jsonb, timestamptz, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_apply_quote_override(uuid, numeric, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_send_service_quote(uuid, timestamptz, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.passenger_accept_service_quote(uuid, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.passenger_decline_service_quote(uuid, integer, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.pricing_round_zar(numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pricing_resolve_version(text, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pricing_calculate(text, jsonb, timestamptz, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_create_pricing_draft(text, uuid, text, timestamptz, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_save_pricing_draft(uuid, text, text, timestamptz, boolean, jsonb, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_publish_pricing_version(uuid, integer, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_retire_pricing_version(uuid, text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_generate_service_quote(uuid, jsonb, timestamptz, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_apply_quote_override(uuid, numeric, text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_send_service_quote(uuid, timestamptz, integer, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.passenger_accept_service_quote(uuid, integer, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.passenger_decline_service_quote(uuid, integer, text) TO authenticated, service_role;

DROP TRIGGER IF EXISTS pricing_versions_updated_at ON public.pricing_versions;
CREATE TRIGGER pricing_versions_updated_at BEFORE UPDATE ON public.pricing_versions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS pricing_components_updated_at ON public.pricing_components;
CREATE TRIGGER pricing_components_updated_at BEFORE UPDATE ON public.pricing_components
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.pricing_versions IS
  'Versioned pricing. Published records are immutable and resolved by service start time.';
COMMENT ON TABLE public.pricing_components IS
  'Ordered deterministic pricing components used only by server-authoritative calculation RPCs.';
COMMENT ON COLUMN public.service_quotes.calculation_snapshot IS
  'Immutable rate, quantity, rounding and engine snapshot captured when the quote was generated.';