
ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS vehicle_id uuid NULL
  REFERENCES public.vehicle_profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS rides_vehicle_id_idx ON public.rides(vehicle_id);

-- Tighten enforce_ride_changes so passengers can't modify the new vehicle_id
-- field. Admins (handled at top of function) keep full control; drivers may
-- set/clear it on their own ride.
CREATE OR REPLACE FUNCTION public.enforce_ride_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  actor uuid := auth.uid();
  is_admin boolean;
  is_driver boolean;
BEGIN
  IF actor IS NULL THEN
    RETURN NEW;
  END IF;

  is_admin := private.has_role(actor, 'admin'::app_role);
  IF is_admin THEN
    RETURN NEW;
  END IF;

  is_driver := private.has_role(actor, 'driver'::app_role);

  IF OLD.driver_id IS DISTINCT FROM NEW.driver_id THEN
    IF OLD.driver_id IS NOT NULL THEN
      RAISE EXCEPTION 'Ride already has an assigned driver';
    END IF;
    IF NOT is_driver THEN
      RAISE EXCEPTION 'Only drivers can accept rides';
    END IF;
    IF NEW.driver_id IS DISTINCT FROM actor THEN
      RAISE EXCEPTION 'Drivers can only claim rides for themselves';
    END IF;
    IF OLD.status <> 'requested' THEN
      RAISE EXCEPTION 'Can only accept a ride in the requested state';
    END IF;
  END IF;

  IF OLD.status IS DISTINCT FROM NEW.status THEN
    IF actor = OLD.passenger_id THEN
      IF NEW.status <> 'cancelled' THEN
        RAISE EXCEPTION 'Passenger may only cancel a ride';
      END IF;
      IF OLD.status IN ('completed','cancelled') THEN
        RAISE EXCEPTION 'Cannot change a completed or cancelled ride';
      END IF;
    ELSIF actor = NEW.driver_id OR actor = OLD.driver_id THEN
      IF NOT (
        (OLD.status = 'requested'        AND NEW.status = 'accepted')
        OR (OLD.status = 'accepted'        AND NEW.status IN ('driver_arriving','cancelled'))
        OR (OLD.status = 'driver_arriving' AND NEW.status IN ('arrived','cancelled'))
        OR (OLD.status = 'arrived'         AND NEW.status IN ('in_progress','cancelled'))
        OR (OLD.status = 'in_progress'     AND NEW.status = 'completed')
      ) THEN
        RAISE EXCEPTION 'Invalid driver status transition from % to %', OLD.status, NEW.status;
      END IF;
    ELSE
      RAISE EXCEPTION 'Not authorised to change ride status';
    END IF;
  END IF;

  IF actor = OLD.passenger_id THEN
    IF OLD.passenger_id IS DISTINCT FROM NEW.passenger_id THEN
      RAISE EXCEPTION 'Cannot change passenger';
    END IF;
    IF OLD.vehicle_id IS DISTINCT FROM NEW.vehicle_id THEN
      RAISE EXCEPTION 'Passenger cannot assign a vehicle';
    END IF;

    IF (OLD.pickup_lat IS DISTINCT FROM NEW.pickup_lat
        OR OLD.pickup_lng IS DISTINCT FROM NEW.pickup_lng
        OR OLD.pickup_address IS DISTINCT FROM NEW.pickup_address)
       AND OLD.status NOT IN ('requested','accepted','driver_arriving') THEN
      RAISE EXCEPTION 'Pickup cannot be changed after driver arrives';
    END IF;

    IF (OLD.destination_lat IS DISTINCT FROM NEW.destination_lat
        OR OLD.destination_lng IS DISTINCT FROM NEW.destination_lng
        OR OLD.destination_address IS DISTINCT FROM NEW.destination_address)
       AND OLD.status IN ('completed','cancelled') THEN
      RAISE EXCEPTION 'Destination cannot be changed on completed/cancelled ride';
    END IF;

    IF OLD.accepted_at IS DISTINCT FROM NEW.accepted_at
       OR OLD.driver_arrived_at IS DISTINCT FROM NEW.driver_arrived_at
       OR OLD.started_at IS DISTINCT FROM NEW.started_at
       OR OLD.completed_at IS DISTINCT FROM NEW.completed_at
       OR OLD.actual_distance_km IS DISTINCT FROM NEW.actual_distance_km
       OR OLD.actual_duration_seconds IS DISTINCT FROM NEW.actual_duration_seconds THEN
      RAISE EXCEPTION 'Passenger cannot modify trip lifecycle fields';
    END IF;
  END IF;

  IF actor = NEW.driver_id AND actor <> OLD.passenger_id THEN
    IF OLD.pickup_lat IS DISTINCT FROM NEW.pickup_lat
       OR OLD.pickup_lng IS DISTINCT FROM NEW.pickup_lng
       OR OLD.pickup_address IS DISTINCT FROM NEW.pickup_address
       OR OLD.destination_lat IS DISTINCT FROM NEW.destination_lat
       OR OLD.destination_lng IS DISTINCT FROM NEW.destination_lng
       OR OLD.destination_address IS DISTINCT FROM NEW.destination_address
       OR OLD.estimated_price IS DISTINCT FROM NEW.estimated_price
       OR OLD.distance_km IS DISTINCT FROM NEW.distance_km
       OR OLD.passenger_id IS DISTINCT FROM NEW.passenger_id
       OR OLD.route_version IS DISTINCT FROM NEW.route_version THEN
      RAISE EXCEPTION 'Driver cannot modify ride content';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
