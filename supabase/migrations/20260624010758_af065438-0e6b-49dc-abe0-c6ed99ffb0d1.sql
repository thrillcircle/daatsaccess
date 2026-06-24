ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS request_type text NOT NULL DEFAULT 'now',
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rides_request_type_check') THEN
    ALTER TABLE public.rides ADD CONSTRAINT rides_request_type_check
      CHECK (request_type IN ('now','scheduled'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_rides_completed_at ON public.rides (completed_at);
CREATE INDEX IF NOT EXISTS idx_rides_scheduled_at ON public.rides (scheduled_at);
CREATE INDEX IF NOT EXISTS idx_rides_passenger_id ON public.rides (passenger_id);
CREATE INDEX IF NOT EXISTS idx_rides_driver_id ON public.rides (driver_id);

CREATE TABLE IF NOT EXISTS public.ride_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  passenger_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text NULL CHECK (comment IS NULL OR char_length(comment) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NULL,
  CONSTRAINT ride_reviews_ride_passenger_unique UNIQUE (ride_id, passenger_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ride_reviews TO authenticated;
GRANT ALL ON public.ride_reviews TO service_role;

ALTER TABLE public.ride_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Passengers insert their own reviews"
  ON public.ride_reviews FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = passenger_id
    AND EXISTS (
      SELECT 1 FROM public.rides r
      WHERE r.id = ride_id
        AND r.passenger_id = auth.uid()
        AND r.driver_id = ride_reviews.driver_id
        AND r.status = 'completed'
    )
  );

CREATE POLICY "Passengers update their own reviews"
  ON public.ride_reviews FOR UPDATE TO authenticated
  USING (auth.uid() = passenger_id)
  WITH CHECK (auth.uid() = passenger_id);

CREATE POLICY "Participants and admins read reviews"
  ON public.ride_reviews FOR SELECT TO authenticated
  USING (
    auth.uid() = passenger_id
    OR auth.uid() = driver_id
    OR private.has_role(auth.uid(), 'admin'::app_role)
  );

CREATE POLICY "Passengers delete their own reviews"
  ON public.ride_reviews FOR DELETE TO authenticated
  USING (auth.uid() = passenger_id);

CREATE INDEX IF NOT EXISTS idx_ride_reviews_passenger_id ON public.ride_reviews (passenger_id);
CREATE INDEX IF NOT EXISTS idx_ride_reviews_driver_id ON public.ride_reviews (driver_id);
CREATE INDEX IF NOT EXISTS idx_ride_reviews_ride_id ON public.ride_reviews (ride_id);

CREATE TRIGGER ride_reviews_set_updated_at
  BEFORE UPDATE ON public.ride_reviews
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
