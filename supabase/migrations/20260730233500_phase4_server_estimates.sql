-- Phase 4: authoritative Ride and Access Transport estimates.
-- Browsers submit route facts, not totals. The database resolves the effective
-- published version, calculates the fare, stores a snapshot and writes atomically.

ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS pricing_version_id uuid REFERENCES public.pricing_versions(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS estimate_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.service_bookings
  ADD COLUMN IF NOT EXISTS pricing_version_id uuid REFERENCES public.pricing_versions(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS estimate_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS rides_pricing_version_idx ON public.rides(pricing_version_id);
CREATE INDEX IF NOT EXISTS service_bookings_pricing_version_idx ON public.service_bookings(pricing_version_id);

CREATE OR REPLACE FUNCTION public.passenger_pricing_estimate(
  p_service_code text,
  p_distance_km numeric,
  p_effective_at timestamptz DEFAULT now(),
  p_additional_inputs jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_snapshot jsonb;
  v_lines jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_service_code NOT IN ('ride', 'transport') THEN
    RAISE EXCEPTION 'Immediate estimates are available only for Ride and Access Transport';
  END IF;
  IF p_distance_km IS NULL OR p_distance_km < 0 OR p_distance_km > 2000 THEN
    RAISE EXCEPTION 'A valid route distance is required';
  END IF;

  v_snapshot := public.pricing_calculate(
    p_service_code,
    COALESCE(p_additional_inputs, '{}'::jsonb)
      || jsonb_build_object('distance_km', p_distance_km),
    COALESCE(p_effective_at, now()),
    NULL
  );

  SELECT COALESCE(jsonb_agg(line ORDER BY (line->>'calculation_order')::integer), '[]'::jsonb)
  INTO v_lines
  FROM jsonb_array_elements(COALESCE(v_snapshot->'lines', '[]'::jsonb)) line
  WHERE COALESCE((line->>'customer_visible')::boolean, false);

  RETURN jsonb_build_object(
    'engine_version', v_snapshot->>'engine_version',
    'calculated_at', v_snapshot->>'calculated_at',
    'pricing_version_id', v_snapshot->>'pricing_version_id',
    'pricing_version_number', (v_snapshot->>'pricing_version_number')::integer,
    'service_code', p_service_code,
    'currency', v_snapshot->>'currency',
    'distance_km', p_distance_km,
    'warnings', COALESCE(v_snapshot->'warnings', '[]'::jsonb),
    'lines', v_lines,
    'total', (v_snapshot->>'total')::numeric
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.passenger_create_priced_ride(
  p_pickup_address text,
  p_pickup_lat double precision,
  p_pickup_lng double precision,
  p_pickup_place_id text,
  p_destination_address text,
  p_destination_lat double precision,
  p_destination_lng double precision,
  p_destination_place_id text,
  p_distance_km numeric,
  p_duration_seconds integer,
  p_request_type text,
  p_scheduled_at timestamptz,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_effective_at timestamptz;
  v_estimate jsonb;
  v_ride public.rides%ROWTYPE;
  v_existing jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT private.has_role(v_actor, 'passenger'::app_role) THEN
    RAISE EXCEPTION 'Passenger role required';
  END IF;
  IF p_request_type NOT IN ('now', 'scheduled') THEN RAISE EXCEPTION 'Invalid request type'; END IF;
  IF p_request_type = 'scheduled' AND (p_scheduled_at IS NULL OR p_scheduled_at <= now()) THEN
    RAISE EXCEPTION 'Scheduled pickup must be in the future';
  END IF;
  IF NULLIF(trim(COALESCE(p_pickup_address, '')), '') IS NULL
     OR NULLIF(trim(COALESCE(p_destination_address, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Pickup and destination are required';
  END IF;
  IF p_duration_seconds IS NOT NULL AND p_duration_seconds < 0 THEN
    RAISE EXCEPTION 'Duration cannot be negative';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT result INTO v_existing
    FROM public.pricing_operation_requests
    WHERE actor_id = v_actor
      AND operation_type = 'create_priced_ride'
      AND idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_existing; END IF;
  END IF;

  v_effective_at := CASE WHEN p_request_type = 'scheduled' THEN p_scheduled_at ELSE now() END;
  v_estimate := public.pricing_calculate(
    'ride',
    jsonb_build_object('distance_km', p_distance_km),
    v_effective_at,
    NULL
  );

  INSERT INTO public.rides (
    passenger_id,
    pickup_address, pickup_lat, pickup_lng, pickup_place_id,
    destination_address, destination_lat, destination_lng, destination_place_id,
    distance_km, estimated_price, estimated_duration_seconds,
    request_type, scheduled_at, pricing_version_id, estimate_snapshot
  ) VALUES (
    v_actor,
    trim(p_pickup_address), p_pickup_lat, p_pickup_lng, NULLIF(trim(p_pickup_place_id), ''),
    trim(p_destination_address), p_destination_lat, p_destination_lng,
    NULLIF(trim(p_destination_place_id), ''),
    p_distance_km, (v_estimate->>'total')::numeric, p_duration_seconds,
    p_request_type, CASE WHEN p_request_type = 'scheduled' THEN p_scheduled_at ELSE NULL END,
    (v_estimate->>'pricing_version_id')::uuid, v_estimate
  ) RETURNING * INTO v_ride;

  v_existing := jsonb_build_object('ride', to_jsonb(v_ride), 'estimate', v_estimate);
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.pricing_operation_requests(actor_id, operation_type, idempotency_key, result)
    VALUES (v_actor, 'create_priced_ride', p_idempotency_key, v_existing)
    ON CONFLICT (actor_id, operation_type, idempotency_key) DO NOTHING;
  END IF;
  RETURN v_existing;
END;
$$;

CREATE OR REPLACE FUNCTION public.passenger_create_transport_booking(
  p_pickup_address text,
  p_pickup_lat double precision,
  p_pickup_lng double precision,
  p_pickup_place_id text,
  p_destination_address text,
  p_destination_lat double precision,
  p_destination_lng double precision,
  p_destination_place_id text,
  p_distance_km numeric,
  p_duration_seconds integer,
  p_request_type text,
  p_scheduled_at timestamptz,
  p_traveller_is_self boolean,
  p_traveller_name text,
  p_traveller_phone text,
  p_relationship text,
  p_assistance_codes text[] DEFAULT ARRAY[]::text[],
  p_passenger_notes text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_start_at timestamptz;
  v_estimate jsonb;
  v_booking public.service_bookings%ROWTYPE;
  v_ride public.rides%ROWTYPE;
  v_code text;
  v_existing jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT private.has_role(v_actor, 'passenger'::app_role) THEN RAISE EXCEPTION 'Passenger role required'; END IF;
  IF p_request_type NOT IN ('now', 'scheduled') THEN RAISE EXCEPTION 'Invalid request type'; END IF;
  IF p_request_type = 'scheduled' AND (p_scheduled_at IS NULL OR p_scheduled_at <= now()) THEN
    RAISE EXCEPTION 'Scheduled pickup must be in the future';
  END IF;
  IF NULLIF(trim(COALESCE(p_traveller_name, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Traveller name is required';
  END IF;
  IF NULLIF(trim(COALESCE(p_pickup_address, '')), '') IS NULL
     OR NULLIF(trim(COALESCE(p_destination_address, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Pickup and destination are required';
  END IF;
  IF p_duration_seconds IS NOT NULL AND p_duration_seconds < 0 THEN
    RAISE EXCEPTION 'Duration cannot be negative';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT result INTO v_existing
    FROM public.pricing_operation_requests
    WHERE actor_id = v_actor
      AND operation_type = 'create_transport_booking'
      AND idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_existing; END IF;
  END IF;

  FOREACH v_code IN ARRAY COALESCE(p_assistance_codes, ARRAY[]::text[])
  LOOP
    IF v_code NOT IN (
      'boarding_assistance','wheelchair_transfer','door_to_door','facility_escort',
      'hospital_assistance','airport_assistance','elderly_assistance','luggage_assistance',
      'mobility_equipment','communication_assistance','other'
    ) THEN RAISE EXCEPTION 'Invalid assistance requirement: %', v_code; END IF;
  END LOOP;

  v_start_at := CASE WHEN p_request_type = 'scheduled' THEN p_scheduled_at ELSE now() END;
  v_estimate := public.pricing_calculate(
    'transport',
    jsonb_build_object('distance_km', p_distance_km),
    v_start_at,
    NULL
  );

  INSERT INTO public.service_bookings (
    booked_by_user_id, service_type, journey_pattern, status, start_at,
    requested_companion_count, passenger_notes, estimated_total,
    pricing_version_id, estimate_snapshot
  ) VALUES (
    v_actor, 'transport', 'one_way', 'submitted', v_start_at,
    0, NULLIF(trim(p_passenger_notes), ''), (v_estimate->>'total')::numeric,
    (v_estimate->>'pricing_version_id')::uuid, v_estimate
  ) RETURNING * INTO v_booking;

  INSERT INTO public.booking_travellers (
    booking_id, linked_user_id, full_name, phone, relationship_to_booker, is_primary
  ) VALUES (
    v_booking.id,
    CASE WHEN p_traveller_is_self THEN v_actor ELSE NULL END,
    trim(p_traveller_name), NULLIF(trim(p_traveller_phone), ''),
    CASE WHEN p_traveller_is_self THEN 'self' ELSE NULLIF(trim(p_relationship), '') END,
    true
  );

  FOREACH v_code IN ARRAY COALESCE(p_assistance_codes, ARRAY[]::text[])
  LOOP
    INSERT INTO public.booking_assistance_requirements(booking_id, requirement_code, quantity)
    VALUES (v_booking.id, v_code::public.assistance_requirement_code, 1);
  END LOOP;

  INSERT INTO public.rides (
    passenger_id,
    pickup_address, pickup_lat, pickup_lng, pickup_place_id,
    destination_address, destination_lat, destination_lng, destination_place_id,
    distance_km, estimated_price, estimated_duration_seconds,
    request_type, scheduled_at, service_booking_id, leg_sequence, day_number,
    pricing_version_id, estimate_snapshot
  ) VALUES (
    v_actor,
    trim(p_pickup_address), p_pickup_lat, p_pickup_lng, NULLIF(trim(p_pickup_place_id), ''),
    trim(p_destination_address), p_destination_lat, p_destination_lng,
    NULLIF(trim(p_destination_place_id), ''),
    p_distance_km, (v_estimate->>'total')::numeric, p_duration_seconds,
    p_request_type, CASE WHEN p_request_type = 'scheduled' THEN p_scheduled_at ELSE NULL END,
    v_booking.id, 1, 1,
    (v_estimate->>'pricing_version_id')::uuid, v_estimate
  ) RETURNING * INTO v_ride;

  INSERT INTO public.service_booking_events(
    booking_id, actor_user_id, event_type, payload
  ) VALUES (
    v_booking.id, v_actor, 'booking_created',
    jsonb_build_object(
      'ride_id', v_ride.id,
      'service_type', 'transport',
      'pricing_version_id', v_estimate->>'pricing_version_id',
      'estimated_total', v_estimate->>'total'
    )
  );

  v_existing := jsonb_build_object(
    'booking', to_jsonb(v_booking),
    'ride', to_jsonb(v_ride),
    'estimate', v_estimate
  );
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.pricing_operation_requests(actor_id, operation_type, idempotency_key, result)
    VALUES (v_actor, 'create_transport_booking', p_idempotency_key, v_existing)
    ON CONFLICT (actor_id, operation_type, idempotency_key) DO NOTHING;
  END IF;
  RETURN v_existing;
END;
$$;

CREATE OR REPLACE FUNCTION public.passenger_update_priced_ride_route(
  p_ride_id uuid,
  p_pickup jsonb,
  p_destination jsonb,
  p_distance_km numeric,
  p_duration_seconds integer,
  p_expected_route_version integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_ride public.rides%ROWTYPE;
  v_previous jsonb;
  v_new_values jsonb;
  v_estimate jsonb;
  v_change_type text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF NOT FOUND OR v_ride.passenger_id <> v_actor THEN RAISE EXCEPTION 'Ride not found for this passenger'; END IF;
  IF v_ride.status::text NOT IN ('requested','accepted','driver_arriving','arrived','in_progress') THEN
    RAISE EXCEPTION 'Trip can no longer be edited';
  END IF;
  IF v_ride.route_version <> p_expected_route_version THEN RAISE EXCEPTION 'Trip changed since it was loaded'; END IF;
  IF p_pickup IS NOT NULL AND v_ride.status::text NOT IN ('requested','accepted','driver_arriving') THEN
    RAISE EXCEPTION 'Pickup can only be changed before the driver arrives';
  END IF;

  v_estimate := public.pricing_calculate(
    'ride', jsonb_build_object('distance_km', p_distance_km),
    COALESCE(v_ride.scheduled_at, v_ride.created_at), NULL
  );
  v_previous := jsonb_build_object(
    'pickup_address', v_ride.pickup_address,
    'pickup_lat', v_ride.pickup_lat,
    'pickup_lng', v_ride.pickup_lng,
    'pickup_place_id', v_ride.pickup_place_id,
    'destination_address', v_ride.destination_address,
    'destination_lat', v_ride.destination_lat,
    'destination_lng', v_ride.destination_lng,
    'destination_place_id', v_ride.destination_place_id,
    'distance_km', v_ride.distance_km,
    'estimated_price', v_ride.estimated_price,
    'estimated_duration_seconds', v_ride.estimated_duration_seconds,
    'pricing_version_id', v_ride.pricing_version_id
  );

  UPDATE public.rides
  SET pickup_address = CASE WHEN p_pickup IS NULL THEN pickup_address ELSE trim(p_pickup->>'address') END,
      pickup_lat = CASE WHEN p_pickup IS NULL THEN pickup_lat ELSE (p_pickup->>'lat')::double precision END,
      pickup_lng = CASE WHEN p_pickup IS NULL THEN pickup_lng ELSE (p_pickup->>'lng')::double precision END,
      pickup_place_id = CASE WHEN p_pickup IS NULL THEN pickup_place_id ELSE NULLIF(trim(p_pickup->>'placeId'), '') END,
      destination_address = CASE WHEN p_destination IS NULL THEN destination_address ELSE trim(p_destination->>'address') END,
      destination_lat = CASE WHEN p_destination IS NULL THEN destination_lat ELSE (p_destination->>'lat')::double precision END,
      destination_lng = CASE WHEN p_destination IS NULL THEN destination_lng ELSE (p_destination->>'lng')::double precision END,
      destination_place_id = CASE WHEN p_destination IS NULL THEN destination_place_id ELSE NULLIF(trim(p_destination->>'placeId'), '') END,
      distance_km = p_distance_km,
      estimated_price = (v_estimate->>'total')::numeric,
      estimated_duration_seconds = p_duration_seconds,
      pricing_version_id = (v_estimate->>'pricing_version_id')::uuid,
      estimate_snapshot = v_estimate,
      route_version = route_version + 1,
      last_route_updated_at = now()
  WHERE id = p_ride_id
  RETURNING * INTO v_ride;

  v_new_values := jsonb_build_object(
    'pickup_address', v_ride.pickup_address,
    'pickup_lat', v_ride.pickup_lat,
    'pickup_lng', v_ride.pickup_lng,
    'pickup_place_id', v_ride.pickup_place_id,
    'destination_address', v_ride.destination_address,
    'destination_lat', v_ride.destination_lat,
    'destination_lng', v_ride.destination_lng,
    'destination_place_id', v_ride.destination_place_id,
    'distance_km', v_ride.distance_km,
    'estimated_price', v_ride.estimated_price,
    'estimated_duration_seconds', v_ride.estimated_duration_seconds,
    'pricing_version_id', v_ride.pricing_version_id
  );
  v_change_type := CASE
    WHEN p_pickup IS NOT NULL AND p_destination IS NOT NULL THEN 'pickup_and_destination'
    WHEN p_pickup IS NOT NULL THEN 'pickup'
    ELSE 'destination'
  END;

  INSERT INTO public.ride_change_log(
    ride_id, changed_by, change_type, previous_values, new_values, route_version
  ) VALUES (
    v_ride.id, v_actor, v_change_type, v_previous, v_new_values, v_ride.route_version
  );

  RETURN jsonb_build_object('ride', to_jsonb(v_ride), 'estimate', v_estimate);
END;
$$;

-- Passenger ride creation must use the protected calculation functions.
DROP POLICY IF EXISTS "passenger creates ride" ON public.rides;
DROP POLICY IF EXISTS "Passenger creates ride" ON public.rides;
DROP POLICY IF EXISTS "Admins insert rides" ON public.rides;
CREATE POLICY "Admins insert rides" ON public.rides
  FOR INSERT TO authenticated
  WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));

REVOKE INSERT ON public.rides FROM authenticated;
REVOKE ALL ON FUNCTION public.passenger_pricing_estimate(text, numeric, timestamptz, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.passenger_create_priced_ride(text, double precision, double precision, text, text, double precision, double precision, text, numeric, integer, text, timestamptz, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.passenger_create_transport_booking(text, double precision, double precision, text, text, double precision, double precision, text, numeric, integer, text, timestamptz, boolean, text, text, text, text[], text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.passenger_update_priced_ride_route(uuid, jsonb, jsonb, numeric, integer, integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.passenger_pricing_estimate(text, numeric, timestamptz, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.passenger_create_priced_ride(text, double precision, double precision, text, text, double precision, double precision, text, numeric, integer, text, timestamptz, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.passenger_create_transport_booking(text, double precision, double precision, text, text, double precision, double precision, text, numeric, integer, text, timestamptz, boolean, text, text, text, text[], text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.passenger_update_priced_ride_route(uuid, jsonb, jsonb, numeric, integer, integer) TO authenticated, service_role;
