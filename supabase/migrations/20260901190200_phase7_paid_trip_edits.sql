-- Phase 7 automatic payment for passenger trip edits.
--
-- Fare-affecting edits are staged first. If the locked-price recalculation is
-- higher than the current paid fare, the change is not applied until trusted
-- PayFast ITN confirms the additional amount. Driver notifications are emitted
-- only after the route change is actually applied.

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_purpose_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_purpose_check
  CHECK (purpose IN ('trip_fare', 'trip_adjustment', 'cancellation_charge'));

CREATE TABLE IF NOT EXISTS public.ride_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  passenger_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expected_route_version integer NOT NULL CHECK (expected_route_version > 0),
  proposed_pickup jsonb NOT NULL,
  proposed_destination jsonb NOT NULL,
  proposed_stops jsonb NOT NULL DEFAULT '[]'::jsonb,
  proposed_distance_km numeric(10,2) NOT NULL CHECK (proposed_distance_km > 0),
  proposed_duration_seconds integer,
  previous_total numeric(10,2) NOT NULL CHECK (previous_total >= 0),
  proposed_total numeric(10,2) NOT NULL CHECK (proposed_total >= 0),
  amount_due numeric(10,2) NOT NULL CHECK (amount_due >= 0),
  pricing_version_id uuid REFERENCES public.pricing_versions(id) ON DELETE RESTRICT,
  estimate_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  change_type text NOT NULL,
  status text NOT NULL DEFAULT 'awaiting_payment'
    CHECK (status IN ('awaiting_payment','applying','applied','cancelled','failed')),
  payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  failure_reason text,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ride_change_requests_one_open_uidx
  ON public.ride_change_requests(ride_id)
  WHERE status IN ('awaiting_payment','applying');
CREATE INDEX IF NOT EXISTS ride_change_requests_passenger_created_idx
  ON public.ride_change_requests(passenger_id, created_at DESC);

DROP TRIGGER IF EXISTS ride_change_requests_set_updated_at ON public.ride_change_requests;
CREATE TRIGGER ride_change_requests_set_updated_at
BEFORE UPDATE ON public.ride_change_requests
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.ride_change_requests ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.ride_change_requests TO authenticated;
GRANT ALL ON public.ride_change_requests TO service_role;
REVOKE INSERT, UPDATE, DELETE ON public.ride_change_requests FROM authenticated;

DROP POLICY IF EXISTS "passengers read own ride change requests" ON public.ride_change_requests;
CREATE POLICY "passengers read own ride change requests"
ON public.ride_change_requests FOR SELECT TO authenticated
USING (passenger_id = auth.uid());

DROP POLICY IF EXISTS "admins read ride change requests" ON public.ride_change_requests;
CREATE POLICY "admins read ride change requests"
ON public.ride_change_requests FOR SELECT TO authenticated
USING (private.has_role(auth.uid(), 'admin'::app_role));

CREATE OR REPLACE FUNCTION private.apply_ride_change_request(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE
  v_request public.ride_change_requests%ROWTYPE;
  v_ride public.rides%ROWTYPE;
  v_previous jsonb;
  v_new_values jsonb;
  v_run_id uuid;
BEGIN
  SELECT * INTO v_request
  FROM public.ride_change_requests
  WHERE id = p_request_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Trip edit request not found'; END IF;
  IF v_request.status = 'applied' THEN
    SELECT * INTO v_ride FROM public.rides WHERE id = v_request.ride_id;
    RETURN jsonb_build_object('ride', to_jsonb(v_ride), 'change_request', to_jsonb(v_request), 'idempotent', true);
  END IF;
  IF v_request.status NOT IN ('awaiting_payment','applying') THEN
    RAISE EXCEPTION 'Trip edit request cannot be applied in its current state';
  END IF;

  SELECT * INTO v_ride FROM public.rides WHERE id = v_request.ride_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Trip no longer exists'; END IF;
  IF v_ride.route_version <> v_request.expected_route_version THEN
    UPDATE public.ride_change_requests
    SET status = 'failed', failure_reason = 'Trip changed before the paid edit could be applied'
    WHERE id = v_request.id;
    RAISE EXCEPTION 'Trip changed before this edit could be applied';
  END IF;
  IF v_ride.status::text NOT IN ('requested','accepted','driver_arriving','arrived','in_progress') THEN
    UPDATE public.ride_change_requests
    SET status = 'failed', failure_reason = 'Trip state no longer permits editing'
    WHERE id = v_request.id;
    RAISE EXCEPTION 'Trip can no longer be edited';
  END IF;

  v_previous := jsonb_build_object(
    'pickup_address', v_ride.pickup_address,
    'pickup_lat', v_ride.pickup_lat,
    'pickup_lng', v_ride.pickup_lng,
    'pickup_place_id', v_ride.pickup_place_id,
    'destination_address', v_ride.destination_address,
    'destination_lat', v_ride.destination_lat,
    'destination_lng', v_ride.destination_lng,
    'destination_place_id', v_ride.destination_place_id,
    'route_stops', COALESCE(v_ride.route_stops, '[]'::jsonb),
    'distance_km', v_ride.distance_km,
    'estimated_price', v_ride.estimated_price,
    'estimated_duration_seconds', v_ride.estimated_duration_seconds,
    'pricing_version_id', v_ride.pricing_version_id
  );

  UPDATE public.ride_change_requests SET status = 'applying' WHERE id = v_request.id;
  PERFORM set_config('access.ride_workflow', 'passenger_rpc', true);

  UPDATE public.rides
  SET pickup_address = trim(v_request.proposed_pickup->>'address'),
      pickup_lat = (v_request.proposed_pickup->>'lat')::double precision,
      pickup_lng = (v_request.proposed_pickup->>'lng')::double precision,
      pickup_place_id = NULLIF(trim(COALESCE(v_request.proposed_pickup->>'placeId','')), ''),
      destination_address = trim(v_request.proposed_destination->>'address'),
      destination_lat = (v_request.proposed_destination->>'lat')::double precision,
      destination_lng = (v_request.proposed_destination->>'lng')::double precision,
      destination_place_id = NULLIF(trim(COALESCE(v_request.proposed_destination->>'placeId','')), ''),
      route_stops = v_request.proposed_stops,
      distance_km = v_request.proposed_distance_km,
      estimated_price = v_request.proposed_total,
      estimated_duration_seconds = v_request.proposed_duration_seconds,
      pricing_version_id = v_request.pricing_version_id,
      estimate_snapshot = v_request.estimate_snapshot,
      route_version = route_version + 1,
      last_route_updated_at = now(),
      updated_at = now()
  WHERE id = v_ride.id
  RETURNING * INTO v_ride;

  PERFORM set_config('access.ride_workflow', '', true);

  v_new_values := jsonb_build_object(
    'pickup_address', v_ride.pickup_address,
    'pickup_lat', v_ride.pickup_lat,
    'pickup_lng', v_ride.pickup_lng,
    'pickup_place_id', v_ride.pickup_place_id,
    'destination_address', v_ride.destination_address,
    'destination_lat', v_ride.destination_lat,
    'destination_lng', v_ride.destination_lng,
    'destination_place_id', v_ride.destination_place_id,
    'route_stops', v_ride.route_stops,
    'distance_km', v_ride.distance_km,
    'estimated_price', v_ride.estimated_price,
    'estimated_duration_seconds', v_ride.estimated_duration_seconds,
    'pricing_version_id', v_ride.pricing_version_id
  );

  INSERT INTO public.ride_change_log(
    ride_id, changed_by, change_type, previous_values, new_values, route_version
  ) VALUES (
    v_ride.id, v_request.passenger_id, v_request.change_type,
    v_previous, v_new_values, v_ride.route_version
  );

  UPDATE public.ride_change_requests
  SET status = 'applied', applied_at = now(), failure_reason = NULL
  WHERE id = v_request.id
  RETURNING * INTO v_request;

  IF v_ride.driver_id IS NOT NULL THEN
    SELECT id INTO v_run_id
    FROM public.operation_runs
    WHERE ride_id = v_ride.id
    ORDER BY created_at DESC LIMIT 1;

    PERFORM private.operations_enqueue_notification(
      v_ride.driver_id,
      'ride_route_updated',
      'Trip route updated',
      'The passenger updated this trip''s route. Review the stops before you drive.',
      'route-updated:' || v_ride.id::text || ':' || v_ride.route_version::text,
      v_run_id,
      v_ride.id,
      v_ride.service_booking_id,
      now()
    );
  END IF;

  INSERT INTO public.notifications(user_id, ride_id, type, title, body)
  VALUES (
    v_ride.passenger_id, v_ride.id, 'ride_edit_applied', 'Trip updated',
    'Your trip changes have been applied.'
  );

  RETURN jsonb_build_object('ride', to_jsonb(v_ride), 'change_request', to_jsonb(v_request), 'idempotent', false);
END;
$function$;

REVOKE ALL ON FUNCTION private.apply_ride_change_request(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.apply_ride_change_request(uuid) TO service_role;

-- Keep the existing public RPC name so the current edit dialog continues to use
-- the same protected endpoint, but stage the authoritative edit instead of
-- applying a fare increase before payment.
CREATE OR REPLACE FUNCTION public.passenger_update_priced_ride_route(
  p_ride_id uuid,
  p_pickup jsonb,
  p_destination jsonb,
  p_distance_km numeric,
  p_duration_seconds integer,
  p_expected_route_version integer,
  p_stops jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_ride public.rides%ROWTYPE;
  v_estimate jsonb;
  v_stops jsonb;
  v_pickup jsonb;
  v_destination jsonb;
  v_stops_changed boolean;
  v_change_type text;
  v_previous_total numeric(10,2);
  v_proposed_total numeric(10,2);
  v_amount_due numeric(10,2);
  v_request public.ride_change_requests%ROWTYPE;
  v_apply jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT private.has_role(v_actor, 'passenger'::app_role) THEN RAISE EXCEPTION 'Passenger role required'; END IF;
  IF p_distance_km IS NULL OR p_distance_km <= 0 OR p_distance_km > 2000 THEN RAISE EXCEPTION 'Invalid trip distance'; END IF;
  IF p_duration_seconds IS NOT NULL AND p_duration_seconds < 0 THEN RAISE EXCEPTION 'Invalid trip duration'; END IF;

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF NOT FOUND OR v_ride.passenger_id <> v_actor THEN RAISE EXCEPTION 'Ride not found for this passenger'; END IF;
  IF v_ride.status::text NOT IN ('requested','accepted','driver_arriving','arrived','in_progress') THEN
    RAISE EXCEPTION 'Trip can no longer be edited';
  END IF;
  IF v_ride.route_version <> p_expected_route_version THEN RAISE EXCEPTION 'Trip changed since it was loaded'; END IF;
  IF p_pickup IS NOT NULL AND v_ride.status::text NOT IN ('requested','accepted','driver_arriving') THEN
    RAISE EXCEPTION 'Pickup can only be changed before the driver arrives';
  END IF;

  v_pickup := COALESCE(
    p_pickup,
    jsonb_build_object('address', v_ride.pickup_address, 'lat', v_ride.pickup_lat,
      'lng', v_ride.pickup_lng, 'placeId', v_ride.pickup_place_id)
  );
  v_destination := COALESCE(
    p_destination,
    jsonb_build_object('address', v_ride.destination_address, 'lat', v_ride.destination_lat,
      'lng', v_ride.destination_lng, 'placeId', v_ride.destination_place_id)
  );

  IF NULLIF(trim(COALESCE(v_pickup->>'address','')), '') IS NULL
     OR (v_pickup->>'lat')::double precision NOT BETWEEN -90 AND 90
     OR (v_pickup->>'lng')::double precision NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'Invalid pickup';
  END IF;
  IF NULLIF(trim(COALESCE(v_destination->>'address','')), '') IS NULL
     OR (v_destination->>'lat')::double precision NOT BETWEEN -90 AND 90
     OR (v_destination->>'lng')::double precision NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'Invalid destination';
  END IF;

  v_stops := CASE WHEN p_stops IS NULL
    THEN COALESCE(v_ride.route_stops, '[]'::jsonb)
    ELSE private.normalize_route_stops(p_stops)
  END;
  v_stops_changed := v_stops IS DISTINCT FROM COALESCE(v_ride.route_stops, '[]'::jsonb);
  IF p_pickup IS NULL AND p_destination IS NULL AND NOT v_stops_changed THEN
    RAISE EXCEPTION 'Nothing to update on this trip';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.ride_change_requests
    WHERE ride_id = v_ride.id AND status IN ('awaiting_payment','applying')
  ) THEN
    RAISE EXCEPTION 'Finish or cancel the current trip edit before making another change';
  END IF;

  v_estimate := public.pricing_calculate(
    'ride', jsonb_build_object('distance_km', p_distance_km),
    COALESCE(v_ride.scheduled_at, v_ride.created_at), v_ride.pricing_version_id
  );
  v_previous_total := round(v_ride.estimated_price, 2);
  v_proposed_total := round((v_estimate->>'total')::numeric, 2);
  v_amount_due := greatest(v_proposed_total - v_previous_total, 0);

  v_change_type := CASE
    WHEN p_pickup IS NOT NULL AND p_destination IS NOT NULL THEN 'pickup_and_destination'
    WHEN p_pickup IS NOT NULL THEN 'pickup'
    WHEN p_destination IS NOT NULL THEN 'destination'
    ELSE 'stops'
  END;
  IF v_stops_changed AND v_change_type <> 'stops' THEN v_change_type := v_change_type || '_and_stops'; END IF;

  INSERT INTO public.ride_change_requests(
    ride_id, passenger_id, expected_route_version,
    proposed_pickup, proposed_destination, proposed_stops,
    proposed_distance_km, proposed_duration_seconds,
    previous_total, proposed_total, amount_due,
    pricing_version_id, estimate_snapshot, change_type,
    status
  ) VALUES (
    v_ride.id, v_actor, v_ride.route_version,
    v_pickup, v_destination, v_stops,
    p_distance_km, p_duration_seconds,
    v_previous_total, v_proposed_total, v_amount_due,
    (v_estimate->>'pricing_version_id')::uuid, v_estimate, v_change_type,
    CASE WHEN v_amount_due > 0.01 THEN 'awaiting_payment' ELSE 'applying' END
  ) RETURNING * INTO v_request;

  IF v_amount_due <= 0.01 THEN
    v_apply := private.apply_ride_change_request(v_request.id);
    RETURN v_apply || jsonb_build_object('requires_payment', false, 'amount_due', 0);
  END IF;

  RETURN jsonb_build_object(
    'ride', to_jsonb(v_ride),
    'estimate', v_estimate,
    'change_request', to_jsonb(v_request),
    'requires_payment', true,
    'amount_due', v_amount_due
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.passenger_update_priced_ride_route(uuid, jsonb, jsonb, numeric, integer, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.passenger_update_priced_ride_route(uuid, jsonb, jsonb, numeric, integer, integer, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_ride_change_payment(
  p_change_request_id uuid,
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
  v_request public.ride_change_requests%ROWTYPE;
  v_payment public.payments%ROWTYPE;
  v_environment text := lower(trim(COALESCE(p_environment, 'sandbox')));
  v_key text := COALESCE(NULLIF(trim(COALESCE(p_idempotency_key, '')), ''), gen_random_uuid()::text);
  v_merchant_payment_id text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT private.has_role(v_actor, 'passenger'::app_role) THEN RAISE EXCEPTION 'Passenger role required'; END IF;
  IF v_environment NOT IN ('sandbox','live') THEN RAISE EXCEPTION 'Invalid payment environment'; END IF;

  SELECT * INTO v_request
  FROM public.ride_change_requests
  WHERE id = p_change_request_id
  FOR UPDATE;
  IF NOT FOUND OR v_request.passenger_id <> v_actor THEN RAISE EXCEPTION 'Trip edit not found for this passenger'; END IF;
  IF v_request.status = 'applied' THEN RAISE EXCEPTION 'This trip edit has already been applied'; END IF;
  IF v_request.status <> 'awaiting_payment' THEN RAISE EXCEPTION 'This trip edit is not awaiting payment'; END IF;
  IF v_request.amount_due < 5 THEN RAISE EXCEPTION 'PayFast requires a minimum payment amount of R5.00'; END IF;

  SELECT * INTO v_payment
  FROM public.payments
  WHERE passenger_id = v_actor AND idempotency_key = v_key
  ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'payment_id', v_payment.id, 'ride_id', v_payment.ride_id,
      'merchant_payment_id', v_payment.merchant_payment_id,
      'amount', v_payment.amount, 'currency', v_payment.currency,
      'status', v_payment.status, 'purpose', v_payment.purpose,
      'environment', v_payment.environment, 'idempotent', true,
      'already_paid', v_payment.status = 'paid'
    );
  END IF;

  SELECT * INTO v_payment
  FROM public.payments
  WHERE ride_id = v_request.ride_id
    AND passenger_id = v_actor
    AND purpose = 'trip_adjustment'
    AND status IN ('pending','paid')
    AND cancelled_at IS NULL
    AND metadata->>'ride_change_request_id' = v_request.id::text
  ORDER BY (status = 'paid') DESC, created_at DESC
  LIMIT 1 FOR UPDATE;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'payment_id', v_payment.id, 'ride_id', v_payment.ride_id,
      'merchant_payment_id', v_payment.merchant_payment_id,
      'amount', v_payment.amount, 'currency', v_payment.currency,
      'status', v_payment.status, 'purpose', v_payment.purpose,
      'environment', v_payment.environment, 'idempotent', true,
      'already_paid', v_payment.status = 'paid'
    );
  END IF;

  v_merchant_payment_id := 'DAATS-EDIT-' || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO public.payments(
    ride_id, passenger_id, amount, status, payment_method,
    provider, environment, purpose, merchant_payment_id, currency,
    pricing_version_id, idempotency_key, metadata
  ) VALUES (
    v_request.ride_id, v_actor, v_request.amount_due, 'pending', 'payfast',
    'payfast', v_environment, 'trip_adjustment', v_merchant_payment_id, 'ZAR',
    v_request.pricing_version_id, v_key,
    jsonb_build_object(
      'ride_change_request_id', v_request.id,
      'expected_route_version', v_request.expected_route_version,
      'proposed_total', v_request.proposed_total
    )
  ) RETURNING * INTO v_payment;

  UPDATE public.ride_change_requests SET payment_id = v_payment.id WHERE id = v_request.id;

  RETURN jsonb_build_object(
    'payment_id', v_payment.id, 'ride_id', v_payment.ride_id,
    'merchant_payment_id', v_payment.merchant_payment_id,
    'amount', v_payment.amount, 'currency', v_payment.currency,
    'status', v_payment.status, 'purpose', v_payment.purpose,
    'environment', v_payment.environment, 'idempotent', false, 'already_paid', false
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_ride_change_payment(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_ride_change_payment(uuid, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.apply_paid_trip_edit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE
  v_request_id uuid;
  v_request public.ride_change_requests%ROWTYPE;
BEGIN
  IF NEW.purpose <> 'trip_adjustment'
     OR NEW.provider <> 'payfast'
     OR NEW.status <> 'paid'
     OR upper(COALESCE(NEW.provider_status,'')) <> 'COMPLETE'
     OR NEW.paid_at IS NULL THEN
    RETURN NEW;
  END IF;

  v_request_id := NULLIF(NEW.metadata->>'ride_change_request_id','')::uuid;
  IF v_request_id IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO v_request
  FROM public.ride_change_requests
  WHERE id = v_request_id
  FOR UPDATE;
  IF NOT FOUND OR v_request.status = 'applied' THEN RETURN NEW; END IF;
  IF v_request.status <> 'awaiting_payment' THEN RETURN NEW; END IF;
  IF v_request.payment_id IS DISTINCT FROM NEW.id
     OR abs(v_request.amount_due - NEW.amount) > 0.01 THEN
    RAISE EXCEPTION 'Paid trip edit does not match the staged change';
  END IF;

  PERFORM private.apply_ride_change_request(v_request.id);
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.apply_paid_trip_edit() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS payments_apply_paid_trip_edit ON public.payments;
CREATE TRIGGER payments_apply_paid_trip_edit
AFTER UPDATE OF status, provider_status, paid_at ON public.payments
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.provider_status IS DISTINCT FROM NEW.provider_status)
EXECUTE FUNCTION private.apply_paid_trip_edit();

CREATE OR REPLACE FUNCTION public.passenger_cancel_ride_change_request(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_request public.ride_change_requests%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_request FROM public.ride_change_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.passenger_id <> v_actor THEN RAISE EXCEPTION 'Trip edit not found'; END IF;
  IF v_request.status = 'cancelled' THEN RETURN jsonb_build_object('cancelled', true, 'idempotent', true); END IF;
  IF v_request.status <> 'awaiting_payment' THEN RAISE EXCEPTION 'This trip edit can no longer be cancelled'; END IF;

  UPDATE public.payments
  SET status = 'failed', failed_at = now(), cancelled_at = now(), failure_reason = 'Passenger cancelled trip edit checkout'
  WHERE id = v_request.payment_id AND status = 'pending';
  UPDATE public.ride_change_requests SET status = 'cancelled' WHERE id = v_request.id;
  RETURN jsonb_build_object('cancelled', true, 'idempotent', false, 'ride_id', v_request.ride_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.passenger_cancel_ride_change_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.passenger_cancel_ride_change_request(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
