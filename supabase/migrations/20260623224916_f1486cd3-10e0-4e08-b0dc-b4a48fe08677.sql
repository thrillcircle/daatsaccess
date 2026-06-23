-- profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url text;

-- driver_profiles
ALTER TABLE public.driver_profiles
  ADD COLUMN IF NOT EXISTS location_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS heading numeric,
  ADD COLUMN IF NOT EXISTS location_accuracy numeric;

CREATE INDEX IF NOT EXISTS driver_profiles_available_idx
  ON public.driver_profiles(is_available) WHERE is_available = true;

-- rides
ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS pickup_place_id text,
  ADD COLUMN IF NOT EXISTS destination_place_id text,
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS driver_arrived_at timestamptz,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS estimated_duration_seconds integer,
  ADD COLUMN IF NOT EXISTS actual_duration_seconds integer,
  ADD COLUMN IF NOT EXISTS actual_distance_km numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS route_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_route_updated_at timestamptz;

CREATE INDEX IF NOT EXISTS rides_active_status_idx
  ON public.rides(status)
  WHERE status IN ('requested','accepted','driver_arriving','arrived','in_progress');

-- ride_live_locations
CREATE TABLE IF NOT EXISTS public.ride_live_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_role text NOT NULL CHECK (user_role IN ('passenger','driver')),
  latitude numeric NOT NULL,
  longitude numeric NOT NULL,
  heading numeric,
  accuracy numeric,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ride_id, user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ride_live_locations TO authenticated;
GRANT ALL ON public.ride_live_locations TO service_role;
ALTER TABLE public.ride_live_locations ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS ride_live_locations_ride_idx ON public.ride_live_locations(ride_id);
CREATE INDEX IF NOT EXISTS ride_live_locations_updated_idx ON public.ride_live_locations(updated_at DESC);

CREATE POLICY "participants read live locations"
  ON public.ride_live_locations FOR SELECT
  TO authenticated
  USING (
    private.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.rides r
      WHERE r.id = ride_live_locations.ride_id
        AND (r.passenger_id = auth.uid() OR r.driver_id = auth.uid())
        AND r.status IN ('requested','accepted','driver_arriving','arrived','in_progress')
    )
  );

CREATE POLICY "self insert live location"
  ON public.ride_live_locations FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.rides r
      WHERE r.id = ride_live_locations.ride_id
        AND r.status IN ('requested','accepted','driver_arriving','arrived','in_progress')
        AND (
          (user_role = 'passenger' AND r.passenger_id = auth.uid())
          OR (user_role = 'driver' AND r.driver_id = auth.uid())
        )
    )
  );

CREATE POLICY "self update live location"
  ON public.ride_live_locations FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.rides r
      WHERE r.id = ride_live_locations.ride_id
        AND (
          (user_role = 'passenger' AND r.passenger_id = auth.uid())
          OR (user_role = 'driver' AND r.driver_id = auth.uid())
        )
    )
  );

CREATE POLICY "self delete live location"
  ON public.ride_live_locations FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- ride_change_log
CREATE TABLE IF NOT EXISTS public.ride_change_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  changed_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  change_type text NOT NULL,
  previous_values jsonb,
  new_values jsonb,
  route_version integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_by_driver_at timestamptz
);

GRANT SELECT, INSERT, UPDATE ON public.ride_change_log TO authenticated;
GRANT ALL ON public.ride_change_log TO service_role;
ALTER TABLE public.ride_change_log ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS ride_change_log_ride_idx ON public.ride_change_log(ride_id, created_at DESC);

CREATE POLICY "participants read change log"
  ON public.ride_change_log FOR SELECT
  TO authenticated
  USING (
    private.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.rides r
      WHERE r.id = ride_change_log.ride_id
        AND (r.passenger_id = auth.uid() OR r.driver_id = auth.uid())
    )
  );

CREATE POLICY "passenger inserts change log on own ride"
  ON public.ride_change_log FOR INSERT
  TO authenticated
  WITH CHECK (
    changed_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.rides r
      WHERE r.id = ride_change_log.ride_id
        AND r.passenger_id = auth.uid()
    )
  );

CREATE POLICY "assigned driver acks change log"
  ON public.ride_change_log FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.rides r
      WHERE r.id = ride_change_log.ride_id
        AND r.driver_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.rides r
      WHERE r.id = ride_change_log.ride_id
        AND r.driver_id = auth.uid()
    )
  );

-- ride_status_events
CREATE TABLE IF NOT EXISTS public.ride_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  previous_status text,
  new_status text NOT NULL,
  changed_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.ride_status_events TO authenticated;
GRANT ALL ON public.ride_status_events TO service_role;
ALTER TABLE public.ride_status_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS ride_status_events_ride_idx
  ON public.ride_status_events(ride_id, created_at DESC);

CREATE POLICY "participants read status events"
  ON public.ride_status_events FOR SELECT
  TO authenticated
  USING (
    private.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.rides r
      WHERE r.id = ride_status_events.ride_id
        AND (r.passenger_id = auth.uid() OR r.driver_id = auth.uid())
    )
  );

CREATE POLICY "participants insert status events"
  ON public.ride_status_events FOR INSERT
  TO authenticated
  WITH CHECK (
    changed_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.rides r
      WHERE r.id = ride_status_events.ride_id
        AND (r.passenger_id = auth.uid() OR r.driver_id = auth.uid())
    )
  );

-- ride_ratings
CREATE TABLE IF NOT EXISTS public.ride_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid NOT NULL UNIQUE REFERENCES public.rides(id) ON DELETE CASCADE,
  passenger_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.ride_ratings TO authenticated;
GRANT ALL ON public.ride_ratings TO service_role;
ALTER TABLE public.ride_ratings ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS ride_ratings_driver_idx ON public.ride_ratings(driver_id);

CREATE POLICY "participants read ratings"
  ON public.ride_ratings FOR SELECT
  TO authenticated
  USING (
    private.has_role(auth.uid(), 'admin')
    OR passenger_id = auth.uid()
    OR driver_id = auth.uid()
  );

CREATE POLICY "passenger rates own completed ride"
  ON public.ride_ratings FOR INSERT
  TO authenticated
  WITH CHECK (
    passenger_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.rides r
      WHERE r.id = ride_ratings.ride_id
        AND r.passenger_id = auth.uid()
        AND r.driver_id = ride_ratings.driver_id
        AND r.status = 'completed'
    )
  );

-- aggregate helper
CREATE OR REPLACE FUNCTION public.driver_avg_rating(driver_user_id uuid)
RETURNS TABLE (avg numeric, count integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(ROUND(AVG(rating)::numeric, 2), 0) AS avg,
    COUNT(*)::int AS count
  FROM public.ride_ratings
  WHERE driver_id = driver_user_id;
$$;

REVOKE EXECUTE ON FUNCTION public.driver_avg_rating(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_avg_rating(uuid) TO authenticated, service_role;

-- Realtime publication
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ride_live_locations;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ride_change_log;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ride_status_events;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;