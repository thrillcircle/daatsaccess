DROP VIEW IF EXISTS public.booking_companion_directory;

CREATE OR REPLACE FUNCTION public.my_booking_companions()
RETURNS TABLE (id uuid, full_name text, photo_url text, is_available boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.full_name, c.photo_url, c.is_available
  FROM public.companion_profiles c
  WHERE auth.uid() IS NOT NULL
    AND (
      private.has_role(auth.uid(), 'admin'::app_role)
      OR EXISTS (
        SELECT 1
        FROM public.booking_companion_assignments bca
        JOIN public.service_bookings sb ON sb.id = bca.booking_id
        WHERE bca.companion_id = c.id
          AND sb.booked_by_user_id = auth.uid()
          AND bca.status = ANY (ARRAY['proposed'::assignment_status,'confirmed'::assignment_status,'completed'::assignment_status])
      )
    )
$$;

REVOKE ALL ON FUNCTION public.my_booking_companions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_booking_companions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_booking_companions() TO service_role;