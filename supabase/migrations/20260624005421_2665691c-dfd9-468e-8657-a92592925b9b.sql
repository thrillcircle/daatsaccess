-- 1. Profiles: matched participants can read each other while ride is active
DROP POLICY IF EXISTS "users read own profile" ON public.profiles;
CREATE POLICY "users read profiles in context"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id
    OR private.has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.rides r
      WHERE r.status IN ('requested','accepted','driver_arriving','arrived','in_progress')
        AND (
          (r.passenger_id = auth.uid() AND r.driver_id = profiles.user_id)
          OR (r.driver_id = auth.uid() AND r.passenger_id = profiles.user_id)
        )
    )
  );

-- 2. Ride change enforcement trigger
CREATE OR REPLACE FUNCTION public.enforce_ride_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
  is_admin boolean;
  is_driver boolean;
BEGIN
  -- Service-role or trigger-internal calls have no auth context: allow.
  IF actor IS NULL THEN
    RETURN NEW;
  END IF;

  is_admin := private.has_role(actor, 'admin'::app_role);
  IF is_admin THEN
    RETURN NEW;
  END IF;

  is_driver := private.has_role(actor, 'driver'::app_role);

  -- Driver assignment: only the driver, only on an unassigned requested ride.
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

  -- Status transitions
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

  -- Passenger field restrictions
  IF actor = OLD.passenger_id THEN
    IF OLD.passenger_id IS DISTINCT FROM NEW.passenger_id THEN
      RAISE EXCEPTION 'Cannot change passenger';
    END IF;

    -- Pickup edits: allowed only before driver arrives
    IF (OLD.pickup_lat IS DISTINCT FROM NEW.pickup_lat
        OR OLD.pickup_lng IS DISTINCT FROM NEW.pickup_lng
        OR OLD.pickup_address IS DISTINCT FROM NEW.pickup_address)
       AND OLD.status NOT IN ('requested','accepted','driver_arriving') THEN
      RAISE EXCEPTION 'Pickup cannot be changed after driver arrives';
    END IF;

    -- Destination edits: blocked once trip is completed/cancelled
    IF (OLD.destination_lat IS DISTINCT FROM NEW.destination_lat
        OR OLD.destination_lng IS DISTINCT FROM NEW.destination_lng
        OR OLD.destination_address IS DISTINCT FROM NEW.destination_address)
       AND OLD.status IN ('completed','cancelled') THEN
      RAISE EXCEPTION 'Destination cannot be changed on completed/cancelled ride';
    END IF;

    -- Passenger cannot touch driver-only timestamps or actuals
    IF OLD.accepted_at IS DISTINCT FROM NEW.accepted_at
       OR OLD.driver_arrived_at IS DISTINCT FROM NEW.driver_arrived_at
       OR OLD.started_at IS DISTINCT FROM NEW.started_at
       OR OLD.completed_at IS DISTINCT FROM NEW.completed_at
       OR OLD.actual_distance_km IS DISTINCT FROM NEW.actual_distance_km
       OR OLD.actual_duration_seconds IS DISTINCT FROM NEW.actual_duration_seconds THEN
      RAISE EXCEPTION 'Passenger cannot modify trip lifecycle fields';
    END IF;
  END IF;

  -- Driver field restrictions: drivers cannot edit ride content
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
$$;

DROP TRIGGER IF EXISTS trg_enforce_ride_changes ON public.rides;
CREATE TRIGGER trg_enforce_ride_changes
  BEFORE UPDATE ON public.rides
  FOR EACH ROW EXECUTE FUNCTION public.enforce_ride_changes();