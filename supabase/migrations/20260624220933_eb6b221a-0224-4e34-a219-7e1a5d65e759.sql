
CREATE POLICY "admin creates rides" ON public.rides
  FOR INSERT TO authenticated
  WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));
