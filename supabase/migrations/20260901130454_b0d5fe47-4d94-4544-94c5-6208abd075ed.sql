-- Admin cancellation policy.

CREATE TABLE IF NOT EXISTS public.ride_cancellation_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  cancelled_by uuid NOT NULL,
  actor_role text NOT NULL CHECK (actor_role IN ('passenger', 'admin')),
  category text NOT NULL CHECK (category IN (
    'passenger_requested',
    'passenger_pre_acceptance',
    'driver_failure',
    'accident',
    'vehicle_fault',
    'operational'
  )),
  reason text NOT NULL,
  actual_distance_km numeric(10,2) NOT NULL DEFAULT 0,
  per_km_rate numeric(12,4) NOT NULL DEFAULT 0,
  service_fee numeric(12,2) NOT NULL DEFAULT 0,
  total_amount numeric(12,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'ZAR',
  pricing_version_id uuid REFERENCES public.pricing_versions(id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ride_id)
);

GRANT SELECT ON public.ride_cancellation_charges TO authenticated;
GRANT ALL ON public.ride_cancellation_charges TO service_role;

ALTER TABLE public.ride_cancellation_charges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Passengers read own cancellation charges" ON public.ride_cancellation_charges;
CREATE POLICY "Passengers read own cancellation charges"
ON public.ride_cancellation_charges FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.rides r
  WHERE r.id = ride_cancellation_charges.ride_id AND r.passenger_id = auth.uid()
));

DROP POLICY IF EXISTS "Admins read cancellation charges" ON public.ride_cancellation_charges;
CREATE POLICY "Admins read cancellation charges"
ON public.ride_cancellation_charges FOR SELECT TO authenticated
USING (private.has_role(auth.uid(), 'admin'::app_role));

DROP TRIGGER IF EXISTS trg_ride_cancellation_charges_updated_at ON public.ride_cancellation_charges;
CREATE TRIGGER trg_ride_cancellation_charges_updated_at
BEFORE UPDATE ON public.ride_cancellation_charges
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Locked pricing lookup: prefer the ride's own estimate snapshot, then the
-- published pricing version the ride was priced against. Never invent rates.
CREATE OR REPLACE FUNCTION private.ride_locked_rates(p_ride public.rides)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE
  v_snapshot jsonb := COALESCE(p_ride.estimate_snapshot, '{}'::jsonb);
  v_per_km numeric := NULL;
  v_service_fee numeric := NULL;
  v_version uuid := p_ride.pricing_version_id;
BEGIN
  IF jsonb_typeof(v_snapshot -> 'lines') = 'array' THEN
    SELECT (line ->> 'unit_price')::numeric INTO v_per_km
    FROM jsonb_array_elements(v_snapshot -> 'lines') AS line
    WHERE line ->> 'calculation_type' = 'per_km'
    ORDER BY (line ->> 'calculation_order')::numeric NULLS LAST
    LIMIT 1;

    SELECT COALESCE(SUM((line ->> 'line_total')::numeric), 0) INTO v_service_fee
    FROM jsonb_array_elements(v_snapshot -> 'lines') AS line
    WHERE line ->> 'calculation_type' = 'flat';

    v_version := COALESCE((v_snapshot ->> 'pricing_version_id')::uuid, v_version);
  END IF;

  IF v_per_km IS NULL AND v_version IS NOT NULL THEN
    SELECT c.unit_price INTO v_per_km
    FROM public.pricing_components c
    WHERE c.pricing_version_id = v_version AND c.calculation_type = 'per_km'
    ORDER BY c.calculation_order
    LIMIT 1;
  END IF;

  IF v_service_fee IS NULL AND v_version IS NOT NULL THEN
    SELECT COALESCE(SUM(c.unit_price), 0) INTO v_service_fee
    FROM public.pricing_components c
    WHERE c.pricing_version_id = v_version AND c.calculation_type = 'flat';
  END IF;

  RETURN jsonb_build_object(
    'per_km_rate', COALESCE(v_per_km, 0),
    'service_fee', COALESCE(v_service_fee, 0),
    'pricing_version_id', v_version,
    'currency', COALESCE(v_snapshot ->> 'currency', 'ZAR')
  );
END;
$function$;

REVOKE ALL ON FUNCTION private.ride_locked_rates(public.rides) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.ride_locked_rates(public.rides) FROM anon;

-- Distance already travelled by the driver, from recorded actuals or the
-- driver location history for this ride.
CREATE OR REPLACE FUNCTION private.ride_travelled_distance_km(p_ride public.rides)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE
  v_km numeric;
BEGIN
  IF p_ride.actual_distance_km IS NOT NULL AND p_ride.actual_distance_km > 0 THEN
    RETURN round(p_ride.actual_distance_km, 2);
  END IF;

  IF p_ride.started_at IS NULL THEN
    RETURN 0;
  END IF;

  WITH points AS (
    SELECT lat, lng, recorded_at,
           lag(lat) OVER (ORDER BY recorded_at) AS plat,
           lag(lng) OVER (ORDER BY recorded_at) AS plng
    FROM public.driver_location_history
    WHERE ride_id = p_ride.id
  )
  SELECT COALESCE(SUM(
    2 * 6371 * asin(sqrt(
      power(sin(radians(lat - plat) / 2), 2) +
      cos(radians(plat)) * cos(radians(lat)) *
      power(sin(radians(lng - plng) / 2), 2)
    ))
  ), 0) INTO v_km
  FROM points WHERE plat IS NOT NULL;

  RETURN round(COALESCE(v_km, 0), 2);
END;
$function$;

REVOKE ALL ON FUNCTION private.ride_travelled_distance_km(public.rides) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.ride_travelled_distance_km(public.rides) FROM anon;

-- Passengers may only self-cancel before an administrator accepts the request.
CREATE OR REPLACE FUNCTION public.passenger_cancel_ride(p_ride_id uuid, p_reason text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_ride public.rides%ROWTYPE;
  v_run public.operation_runs%ROWTYPE;
  v_reason text := NULLIF(trim(COALESCE(p_reason, '')), '');
  v_dedup text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT private.has_role(v_actor, 'passenger'::app_role) THEN
    RAISE EXCEPTION 'Passenger role required';
  END IF;

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF NOT FOUND OR v_ride.passenger_id <> v_actor THEN
    RAISE EXCEPTION 'Ride not found for this passenger';
  END IF;

  IF v_ride.status = 'cancelled' THEN
    RETURN jsonb_build_object('cancelled', true, 'idempotent', true,
                              'ride_id', v_ride.id, 'status', v_ride.status);
  END IF;
  IF v_ride.status = 'completed' THEN
    RAISE EXCEPTION 'A completed trip cannot be cancelled';
  END IF;
  IF v_ride.status <> 'requested' THEN
    RAISE EXCEPTION 'This trip has already been accepted. Contact Support to cancel.';
  END IF;

  v_dedup := 'passenger-cancelled:' || v_ride.id::text;

  SELECT * INTO v_run FROM public.operation_runs
  WHERE ride_id = v_ride.id ORDER BY created_at DESC LIMIT 1 FOR UPDATE;

  PERFORM set_config('access.ride_workflow', 'passenger_rpc', true);

  UPDATE public.rides SET status = 'cancelled', updated_at = now()
  WHERE id = v_ride.id RETURNING * INTO v_ride;

  IF v_run.id IS NOT NULL THEN
    UPDATE public.operation_run_assignments
    SET status = 'released', released_at = now(),
        release_reason = COALESCE(v_reason, 'Cancelled by passenger'),
        row_version = row_version + 1, updated_at = now()
    WHERE operation_run_id = v_run.id
      AND status IN ('proposed','reserved','assigned','acknowledged');

    UPDATE public.dispatch_offers
    SET status = 'cancelled', response_reason = COALESCE(v_reason, 'Cancelled by passenger'),
        row_version = row_version + 1, updated_at = now()
    WHERE operation_run_id = v_run.id AND status = 'offered';

    IF v_run.operational_status <> 'cancelled' THEN
      UPDATE public.operation_runs
      SET operational_status = 'cancelled', planning_status = 'cancelled',
          dispatch_status = 'expired', actual_end_at = COALESCE(actual_end_at, now()),
          updated_by = v_actor, row_version = row_version + 1, updated_at = now()
      WHERE id = v_run.id RETURNING * INTO v_run;
    END IF;

    PERFORM private.operations_add_event(
      v_run.id, 'passenger_cancelled', NULL, to_jsonb(v_run), v_reason,
      jsonb_build_object('idempotency_key', p_idempotency_key, 'ride_id', v_ride.id),
      v_actor, true, true
    );
  END IF;

  PERFORM set_config('access.ride_workflow', '', true);

  INSERT INTO public.ride_change_log (
    ride_id, changed_by, change_type, previous_values, new_values, route_version
  ) VALUES (
    v_ride.id, v_actor, 'passenger_cancelled',
    jsonb_build_object('status', 'requested'),
    jsonb_build_object('status', 'cancelled', 'reason', v_reason,
                       'idempotency_key', p_idempotency_key),
    v_ride.route_version
  );

  -- Cancelling before acceptance is never charged, but is still recorded.
  INSERT INTO public.ride_cancellation_charges (
    ride_id, cancelled_by, actor_role, category, reason,
    actual_distance_km, per_km_rate, service_fee, total_amount,
    pricing_version_id, metadata
  ) VALUES (
    v_ride.id, v_actor, 'passenger', 'passenger_pre_acceptance',
    COALESCE(v_reason, 'Cancelled by passenger before acceptance'),
    0, 0, 0, 0, v_ride.pricing_version_id,
    jsonb_build_object('idempotency_key', p_idempotency_key)
  ) ON CONFLICT (ride_id) DO NOTHING;

  PERFORM private.operations_enqueue_notification(
    v_actor, 'ride_cancelled', 'Trip cancelled',
    COALESCE(v_reason, 'Your trip was cancelled.'),
    v_dedup || ':passenger', v_run.id, v_ride.id, v_ride.service_booking_id, now()
  );

  RETURN jsonb_build_object('cancelled', true, 'idempotent', false,
                            'ride_id', v_ride.id, 'status', v_ride.status,
                            'operation_run_id', v_run.id, 'charge_total', 0);
END;
$function$;

REVOKE ALL ON FUNCTION public.passenger_cancel_ride(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.passenger_cancel_ride(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.passenger_cancel_ride(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.passenger_cancel_ride(uuid, text, text) TO service_role;

-- Administrator cancellation of an accepted / en-route / in-progress trip.
CREATE OR REPLACE FUNCTION public.admin_cancel_ride(
  p_ride_id uuid,
  p_category text,
  p_reason text,
  p_actual_distance_km numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := public.operations_require_admin();
  v_ride public.rides%ROWTYPE;
  v_run public.operation_runs%ROWTYPE;
  v_reason text := NULLIF(trim(COALESCE(p_reason, '')), '');
  v_category text := lower(trim(COALESCE(p_category, '')));
  v_rates jsonb;
  v_distance numeric := 0;
  v_per_km numeric := 0;
  v_service_fee numeric := 0;
  v_total numeric := 0;
  v_charge public.ride_cancellation_charges%ROWTYPE;
  v_driver uuid;
BEGIN
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'A cancellation reason is required';
  END IF;
  IF v_category NOT IN ('passenger_requested','driver_failure','accident','vehicle_fault','operational') THEN
    RAISE EXCEPTION 'A valid cancellation category is required';
  END IF;

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ride not found';
  END IF;
  IF v_ride.status = 'completed' THEN
    RAISE EXCEPTION 'A completed trip cannot be cancelled';
  END IF;
  IF v_ride.status = 'cancelled' THEN
    SELECT * INTO v_charge FROM public.ride_cancellation_charges WHERE ride_id = v_ride.id;
    RETURN jsonb_build_object('cancelled', true, 'idempotent', true,
                              'ride_id', v_ride.id, 'status', v_ride.status,
                              'charge', to_jsonb(v_charge));
  END IF;

  v_driver := v_ride.driver_id;
  v_rates := private.ride_locked_rates(v_ride);
  v_per_km := (v_rates ->> 'per_km_rate')::numeric;
  v_service_fee := (v_rates ->> 'service_fee')::numeric;

  IF v_category = 'passenger_requested' THEN
    v_distance := GREATEST(COALESCE(p_actual_distance_km, private.ride_travelled_distance_km(v_ride)), 0);
    v_total := round((v_distance * v_per_km) + v_service_fee, 2);
  ELSE
    -- Driver failure, accident, vehicle fault and DAATS operational
    -- cancellations never charge the passenger.
    v_distance := 0;
    v_per_km := 0;
    v_service_fee := 0;
    v_total := 0;
  END IF;

  SELECT * INTO v_run FROM public.operation_runs
  WHERE ride_id = v_ride.id ORDER BY created_at DESC LIMIT 1 FOR UPDATE;

  PERFORM set_config('access.ride_workflow', 'admin_rpc', true);

  UPDATE public.rides SET status = 'cancelled', updated_at = now()
  WHERE id = v_ride.id RETURNING * INTO v_ride;

  IF v_run.id IS NOT NULL THEN
    UPDATE public.operation_run_assignments
    SET status = 'released', released_at = now(), release_reason = v_reason,
        row_version = row_version + 1, updated_at = now()
    WHERE operation_run_id = v_run.id
      AND status IN ('proposed','reserved','assigned','acknowledged');

    UPDATE public.dispatch_offers
    SET status = 'cancelled', response_reason = v_reason,
        row_version = row_version + 1, updated_at = now()
    WHERE operation_run_id = v_run.id AND status = 'offered';

    IF v_run.operational_status <> 'cancelled' THEN
      UPDATE public.operation_runs
      SET operational_status = 'cancelled', planning_status = 'cancelled',
          dispatch_status = 'expired', actual_end_at = COALESCE(actual_end_at, now()),
          updated_by = v_actor, row_version = row_version + 1, updated_at = now()
      WHERE id = v_run.id RETURNING * INTO v_run;
    END IF;

    PERFORM private.operations_add_event(
      v_run.id, 'operation_cancelled', NULL, to_jsonb(v_run), v_reason,
      jsonb_build_object('ride_id', v_ride.id, 'category', v_category,
                         'charge_total', v_total),
      v_actor, true, true
    );
  END IF;

  PERFORM set_config('access.ride_workflow', '', true);

  INSERT INTO public.ride_cancellation_charges (
    ride_id, cancelled_by, actor_role, category, reason,
    actual_distance_km, per_km_rate, service_fee, total_amount, currency,
    pricing_version_id, metadata
  ) VALUES (
    v_ride.id, v_actor, 'admin', v_category, v_reason,
    v_distance, v_per_km, v_service_fee, v_total,
    COALESCE(v_rates ->> 'currency', 'ZAR'),
    NULLIF(v_rates ->> 'pricing_version_id', '')::uuid,
    jsonb_build_object('ride_status_at_cancellation', v_ride.status,
                       'operation_run_id', v_run.id)
  )
  ON CONFLICT (ride_id) DO UPDATE
    SET cancelled_by = EXCLUDED.cancelled_by, actor_role = EXCLUDED.actor_role,
        category = EXCLUDED.category, reason = EXCLUDED.reason,
        actual_distance_km = EXCLUDED.actual_distance_km,
        per_km_rate = EXCLUDED.per_km_rate, service_fee = EXCLUDED.service_fee,
        total_amount = EXCLUDED.total_amount, updated_at = now()
  RETURNING * INTO v_charge;

  INSERT INTO public.ride_change_log (
    ride_id, changed_by, change_type, previous_values, new_values, route_version
  ) VALUES (
    v_ride.id, v_actor, 'admin_cancelled',
    jsonb_build_object('status', v_charge.metadata ->> 'ride_status_at_cancellation'),
    jsonb_build_object('status', 'cancelled', 'category', v_category,
                       'reason', v_reason, 'charge_total', v_total),
    v_ride.route_version
  );

  PERFORM private.operations_enqueue_notification(
    v_ride.passenger_id, 'ride_cancelled', 'Trip cancelled', v_reason,
    'admin-cancelled:' || v_ride.id::text || ':passenger',
    v_run.id, v_ride.id, v_ride.service_booking_id, now()
  );

  IF v_driver IS NOT NULL THEN
    PERFORM private.operations_enqueue_notification(
      v_driver, 'ride_cancelled', 'Trip cancelled by Access Operations', v_reason,
      'admin-cancelled:' || v_ride.id::text || ':driver',
      v_run.id, v_ride.id, v_ride.service_booking_id, now()
    );
  END IF;

  RETURN jsonb_build_object(
    'cancelled', true, 'idempotent', false, 'ride_id', v_ride.id,
    'status', v_ride.status, 'operation_run_id', v_run.id,
    'charge', to_jsonb(v_charge)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_cancel_ride(uuid, text, text, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_cancel_ride(uuid, text, text, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_cancel_ride(uuid, text, text, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cancel_ride(uuid, text, text, numeric) TO service_role;