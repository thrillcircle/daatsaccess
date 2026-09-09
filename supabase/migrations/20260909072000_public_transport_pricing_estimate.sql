-- Public homepage estimates use the same published Access Transport pricing
-- engine as authenticated passenger bookings. Only customer-visible lines and
-- the final total are returned; pricing administration remains protected.
CREATE OR REPLACE FUNCTION public.public_transport_pricing_estimate(
  p_distance_km numeric,
  p_effective_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_snapshot jsonb;
  v_lines jsonb;
BEGIN
  IF p_distance_km IS NULL OR p_distance_km < 0 OR p_distance_km > 2000 THEN
    RAISE EXCEPTION 'A valid route distance is required';
  END IF;

  v_snapshot := public.pricing_calculate(
    'transport',
    jsonb_build_object('distance_km', p_distance_km),
    COALESCE(p_effective_at, now()),
    NULL
  );

  SELECT COALESCE(
    jsonb_agg(line ORDER BY (line->>'calculation_order')::integer),
    '[]'::jsonb
  )
  INTO v_lines
  FROM jsonb_array_elements(COALESCE(v_snapshot->'lines', '[]'::jsonb)) line
  WHERE COALESCE((line->>'customer_visible')::boolean, false);

  RETURN jsonb_build_object(
    'engine_version', v_snapshot->>'engine_version',
    'calculated_at', v_snapshot->>'calculated_at',
    'pricing_version_id', v_snapshot->>'pricing_version_id',
    'pricing_version_number', (v_snapshot->>'pricing_version_number')::integer,
    'service_code', 'transport',
    'currency', v_snapshot->>'currency',
    'distance_km', p_distance_km,
    'warnings', COALESCE(v_snapshot->'warnings', '[]'::jsonb),
    'lines', v_lines,
    'total', (v_snapshot->>'total')::numeric
  );
END;
$$;

REVOKE ALL ON FUNCTION public.public_transport_pricing_estimate(numeric, timestamptz)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_transport_pricing_estimate(numeric, timestamptz)
  TO anon, authenticated, service_role;
