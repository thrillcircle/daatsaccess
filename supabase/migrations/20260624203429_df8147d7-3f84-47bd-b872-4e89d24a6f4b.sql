-- Admin update/delete on rides
CREATE POLICY "admin updates all rides"
ON public.rides
FOR UPDATE
TO authenticated
USING (private.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "admin deletes rides"
ON public.rides
FOR DELETE
TO authenticated
USING (private.has_role(auth.uid(), 'admin'::app_role));

-- Admin update on payments
CREATE POLICY "admin updates payments"
ON public.payments
FOR UPDATE
TO authenticated
USING (private.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));
