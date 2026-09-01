CREATE OR REPLACE FUNCTION private.normalize_route_stops(p_stops jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'private', 'pg_temp'
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

REVOKE ALL ON FUNCTION public.enforce_ride_route_stops() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_ride_route_stops() FROM anon;
REVOKE ALL ON FUNCTION public.enforce_ride_route_stops() FROM authenticated;