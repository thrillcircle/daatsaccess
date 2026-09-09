-- The pricing engine remains non-executable by anon. This change permits the
-- tightly-scoped public estimate wrapper to calculate only the currently
-- published version when no user session exists. Draft-version previews still
-- require authentication and admin access.
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
  IF v_uid IS NOT NULL THEN
    v_is_admin := private.has_role(v_uid, 'admin'::app_role);
  ELSIF p_pricing_version_id IS NOT NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

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

REVOKE ALL ON FUNCTION public.pricing_calculate(text, jsonb, timestamptz, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_calculate(text, jsonb, timestamptz, uuid)
  TO authenticated, service_role;
