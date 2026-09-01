-- Multi-stop trip editing: validated ordered stops on rides.

ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS route_stops jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE OR REPLACE FUNCTION private.normalize_route_stops(p_stops jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  v_out jsonb := '[]'::jsonb;
  v_stop jsonb;
  v_address text;
  v_lat double precision;
  v_lng double precision;
  v_index integer := 0;
BEGIN
  IF p_stops IS NULL OR jsonb_typeof(p_stops) = 'null' THEN
    RETURN '[]'::jsonb;
  END IF;
  IF jsonb_typeof(p_stops) <> 'array' THEN
    RAISE EXCEPTION 'Stops must be an ordered list';
  END IF;
  IF jsonb_array_length(p_stops) > 5 THEN
    RAISE EXCEPTION 'A trip can have at most 5 stops';
  END IF;

  FOR v_stop IN SELECT value FROM jsonb_array_elements(p_stops) LOOP
    v_address := NULLIF(trim(COALESCE(v_stop ->> 'address', '')), '');
    IF v_address IS NULL OR length(v_address) < 3 OR length(v_address) > 300 THEN
      RAISE EXCEPTION 'Every stop needs a valid address';
    END IF;
    BEGIN
      v_lat := (v_stop ->> 'lat')::double precision;
      v_lng := (v_stop ->> 'lng')::double precision;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'Every stop needs valid coordinates';
    END;
    IF v_lat IS NULL OR v_lng IS NULL
       OR v_lat < -90 OR v_lat > 90 OR v_lng < -180 OR v_lng > 180 THEN
      RAISE EXCEPTION 'Every stop needs valid coordinates';
    END IF;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'sequence', v_index,
      'address', v_address,
      'lat', v_lat,
      'lng', v_lng,
      'placeId', NULLIF(trim(COALESCE(v_stop ->> 'placeId', '')), '')
    ));
    v_index := v_index + 1;
  END LOOP;

  RETURN v_out;
END;
$function$;

REVOKE ALL ON FUNCTION private.normalize_route_stops(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.normalize_route_stops(jsonb) FROM anon;

-- Defence in depth: reject malformed stops written by any path.
CREATE OR REPLACE FUNCTION public.enforce_ride_route_stops()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
BEGIN
  NEW.route_stops := private.normalize_route_stops(NEW.route_stops);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_enforce_ride_route_stops ON public.rides;
CREATE TRIGGER trg_enforce_ride_route_stops
BEFORE INSERT OR UPDATE OF route_stops ON public.rides
FOR EACH ROW EXECUTE FUNCTION public.enforce_ride_route_stops();

-- Driver-safe projection gains the ordered stops, still with no financial data.
CREATE OR REPLACE FUNCTION private.driver_ride_projection(r public.rides)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
  select jsonb_build_object(
    'id', r.id,
    'status', r.status,
    'request_type', r.request_type,
    'scheduled_at', r.scheduled_at,
    'pickup_address', r.pickup_address,
    'destination_address', r.destination_address,
    'pickup_lat', r.pickup_lat,
    'pickup_lng', r.pickup_lng,
    'destination_lat', r.destination_lat,
    'destination_lng', r.destination_lng,
    'route_stops', COALESCE(r.route_stops, '[]'::jsonb),
    'distance_km', r.distance_km,
    'actual_distance_km', r.actual_distance_km,
    'estimated_duration_seconds', r.estimated_duration_seconds,
    'actual_duration_seconds', r.actual_duration_seconds,
    'accepted_at', r.accepted_at,
    'driver_arrived_at', r.driver_arrived_at,
    'started_at', r.started_at,
    'completed_at', r.completed_at,
    'created_at', r.created_at,
    'updated_at', r.updated_at,
    'passenger_id', r.passenger_id,
    'driver_id', r.driver_id,
    'vehicle_id', r.vehicle_id,
    'route_version', r.route_version,
    'last_route_updated_at', r.last_route_updated_at,
    'service_booking_id', r.service_booking_id,
    'itinerary_item_id', r.itinerary_item_id,
    'leg_sequence', r.leg_sequence,
    'day_number', r.day_number
  );
$function$;

DROP FUNCTION IF EXISTS public.passenger_update_priced_ride_route(uuid, jsonb, jsonb, numeric, integer, integer);

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
  v_previous jsonb;
  v_new_values jsonb;
  v_estimate jsonb;
  v_change_type text;
  v_stops jsonb;
  v_stops_changed boolean;
  v_run_id uuid;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_distance_km IS NULL OR p_distance_km <= 0 OR p_distance_km > 2000 THEN
    RAISE EXCEPTION 'Invalid trip distance';
  END IF;

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF NOT FOUND OR v_ride.passenger_id <> v_actor THEN
    RAISE EXCEPTION 'Ride not found for this passenger';
  END IF;
  IF v_ride.status::text NOT IN ('requested','accepted','driver_arriving','arrived','in_progress') THEN
    RAISE EXCEPTION 'Trip can no longer be edited';
  END IF;
  IF v_ride.route_version <> p_expected_route_version THEN
    RAISE EXCEPTION 'Trip changed since it was loaded';
  END IF;
  IF p_pickup IS NOT NULL AND v_ride.status::text NOT IN ('requested','accepted','driver_arriving') THEN
    RAISE EXCEPTION 'Pickup can only be changed before the driver arrives';
  END IF;

  v_stops := CASE WHEN p_stops IS NULL
                  THEN COALESCE(v_ride.route_stops, '[]'::jsonb)
                  ELSE private.normalize_route_stops(p_stops) END;
  v_stops_changed := v_stops IS DISTINCT FROM COALESCE(v_ride.route_stops, '[]'::jsonb);

  IF p_pickup IS NULL AND p_destination IS NULL AND NOT v_stops_changed THEN
    RAISE EXCEPTION 'Nothing to update on this trip';
  END IF;

  -- Server-authoritative repricing on the trip's locked pricing version.
  v_estimate := public.pricing_calculate(
    'ride', jsonb_build_object('distance_km', p_distance_km),
    COALESCE(v_ride.scheduled_at, v_ride.created_at), v_ride.pricing_version_id
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
    'route_stops', COALESCE(v_ride.route_stops, '[]'::jsonb),
    'distance_km', v_ride.distance_km,
    'estimated_price', v_ride.estimated_price,
    'estimated_duration_seconds', v_ride.estimated_duration_seconds,
    'pricing_version_id', v_ride.pricing_version_id
  );

  PERFORM set_config('access.ride_workflow', 'passenger_rpc', true);

  UPDATE public.rides
  SET pickup_address = CASE WHEN p_pickup IS NULL THEN pickup_address ELSE trim(p_pickup->>'address') END,
      pickup_lat = CASE WHEN p_pickup IS NULL THEN pickup_lat ELSE (p_pickup->>'lat')::double precision END,
      pickup_lng = CASE WHEN p_pickup IS NULL THEN pickup_lng ELSE (p_pickup->>'lng')::double precision END,
      pickup_place_id = CASE WHEN p_pickup IS NULL THEN pickup_place_id ELSE NULLIF(trim(p_pickup->>'placeId'), '') END,
      destination_address = CASE WHEN p_destination IS NULL THEN destination_address ELSE trim(p_destination->>'address') END,
      destination_lat = CASE WHEN p_destination IS NULL THEN destination_lat ELSE (p_destination->>'lat')::double precision END,
      destination_lng = CASE WHEN p_destination IS NULL THEN destination_lng ELSE (p_destination->>'lng')::double precision END,
      destination_place_id = CASE WHEN p_destination IS NULL THEN destination_place_id ELSE NULLIF(trim(p_destination->>'placeId'), '') END,
      route_stops = v_stops,
      distance_km = p_distance_km,
      estimated_price = (v_estimate->>'total')::numeric,
      estimated_duration_seconds = p_duration_seconds,
      pricing_version_id = (v_estimate->>'pricing_version_id')::uuid,
      estimate_snapshot = v_estimate,
      route_version = route_version + 1,
      last_route_updated_at = now(),
      updated_at = now()
  WHERE id = p_ride_id
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

  v_change_type := CASE
    WHEN p_pickup IS NOT NULL AND p_destination IS NOT NULL THEN 'pickup_and_destination'
    WHEN p_pickup IS NOT NULL THEN 'pickup'
    WHEN p_destination IS NOT NULL THEN 'destination'
    ELSE 'stops'
  END;
  IF v_stops_changed AND v_change_type <> 'stops' THEN
    v_change_type := v_change_type || '_and_stops';
  END IF;

  INSERT INTO public.ride_change_log(
    ride_id, changed_by, change_type, previous_values, new_values, route_version
  ) VALUES (
    v_ride.id, v_actor, v_change_type, v_previous, v_new_values, v_ride.route_version
  );

  IF v_ride.driver_id IS NOT NULL THEN
    SELECT id INTO v_run_id FROM public.operation_runs
    WHERE ride_id = v_ride.id ORDER BY created_at DESC LIMIT 1;

    PERFORM private.operations_enqueue_notification(
      v_ride.driver_id, 'ride_route_updated', 'Trip route updated',
      'The passenger updated this trip''s route. Review the stops before you drive.',
      'route-updated:' || v_ride.id::text || ':' || v_ride.route_version::text,
      v_run_id, v_ride.id, v_ride.service_booking_id, now()
    );
  END IF;

  RETURN jsonb_build_object('ride', to_jsonb(v_ride), 'estimate', v_estimate);
END;
$function$;

REVOKE ALL ON FUNCTION public.passenger_update_priced_ride_route(uuid, jsonb, jsonb, numeric, integer, integer, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.passenger_update_priced_ride_route(uuid, jsonb, jsonb, numeric, integer, integer, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.passenger_update_priced_ride_route(uuid, jsonb, jsonb, numeric, integer, integer, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.passenger_update_priced_ride_route(uuid, jsonb, jsonb, numeric, integer, integer, jsonb) TO service_role;