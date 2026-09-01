CREATE OR REPLACE FUNCTION private.lock_paid_requested_trip_route()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
BEGIN
  IF OLD.status = 'requested'
     AND NEW.status = 'requested'
     AND private.ride_has_confirmed_trip_payment(
       OLD.id,
       OLD.estimated_price,
       OLD.pricing_version_id
     )
     AND (
       OLD.pickup_address IS DISTINCT FROM NEW.pickup_address
       OR OLD.pickup_lat IS DISTINCT FROM NEW.pickup_lat
       OR OLD.pickup_lng IS DISTINCT FROM NEW.pickup_lng
       OR OLD.destination_address IS DISTINCT FROM NEW.destination_address
       OR OLD.destination_lat IS DISTINCT FROM NEW.destination_lat
       OR OLD.destination_lng IS DISTINCT FROM NEW.destination_lng
       OR OLD.route_stops IS DISTINCT FROM NEW.route_stops
       OR OLD.distance_km IS DISTINCT FROM NEW.distance_km
       OR OLD.estimated_price IS DISTINCT FROM NEW.estimated_price
       OR OLD.pricing_version_id IS DISTINCT FROM NEW.pricing_version_id
       OR OLD.route_version IS DISTINCT FROM NEW.route_version
     ) THEN
    RAISE EXCEPTION 'This trip is already paid. Contact support to change the route before acceptance';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.lock_paid_requested_trip_route() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.lock_paid_requested_trip_route() FROM anon;
REVOKE ALL ON FUNCTION private.lock_paid_requested_trip_route() FROM authenticated;

NOTIFY pgrst, 'reload schema';