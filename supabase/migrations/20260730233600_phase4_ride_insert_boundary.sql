-- Preserve legitimate administrator ride-leg creation while passenger creation is
-- restricted by RLS to the server-authoritative pricing RPCs.

GRANT INSERT ON public.rides TO authenticated;

ALTER TABLE public.rides
  DROP CONSTRAINT IF EXISTS rides_distance_km_bounds;
ALTER TABLE public.rides
  ADD CONSTRAINT rides_distance_km_bounds
  CHECK (distance_km >= 0 AND distance_km <= 2000) NOT VALID;
ALTER TABLE public.rides VALIDATE CONSTRAINT rides_distance_km_bounds;
