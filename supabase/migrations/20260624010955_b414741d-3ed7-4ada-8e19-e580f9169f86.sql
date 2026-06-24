DROP POLICY IF EXISTS "users read profiles in context" ON public.profiles;
CREATE POLICY "users read profiles in context"
  ON public.profiles FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    OR private.has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.rides r
      WHERE r.status IN ('requested','accepted','driver_arriving','arrived','in_progress','completed')
        AND (
          (r.passenger_id = auth.uid() AND r.driver_id = profiles.user_id)
          OR (r.driver_id = auth.uid() AND r.passenger_id = profiles.user_id)
        )
    )
  );

DROP POLICY IF EXISTS "driver profile visibility" ON public.driver_profiles;
CREATE POLICY "driver profile visibility"
  ON public.driver_profiles FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    OR private.has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.rides r
      WHERE r.driver_id = driver_profiles.user_id
        AND r.passenger_id = auth.uid()
        AND r.status IN ('accepted','driver_arriving','arrived','in_progress','completed')
    )
  );