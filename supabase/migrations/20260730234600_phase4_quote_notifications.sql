-- Link quote-ready notifications directly to the safe role-specific quote workspace.

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS service_booking_id uuid
  REFERENCES public.service_bookings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS notifications_service_booking_idx
  ON public.notifications(service_booking_id);

CREATE OR REPLACE FUNCTION public.notify_quote_sent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_user_id uuid;
BEGIN
  IF NEW.sent_at IS NOT NULL AND OLD.sent_at IS NULL THEN
    SELECT booked_by_user_id INTO v_user_id
    FROM public.service_bookings WHERE id = NEW.booking_id;
    INSERT INTO public.notifications(
      user_id, type, title, body, service_booking_id
    ) VALUES (
      v_user_id,
      'service_quote_ready',
      'Your Access quote is ready',
      NEW.quote_reference || ' · ' || NEW.currency || ' ' || to_char(NEW.final_total, 'FM999999990.00'),
      NEW.booking_id
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_quote_sent()
  FROM PUBLIC, anon, authenticated;
