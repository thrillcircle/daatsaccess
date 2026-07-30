DROP POLICY IF EXISTS "Users create own support tickets" ON public.support_tickets;
REVOKE INSERT, UPDATE, DELETE ON public.support_tickets FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.support_messages FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.support_ticket_events FROM authenticated;

CREATE OR REPLACE FUNCTION public.notify_admin_originated_support_participant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_participant uuid;
BEGIN
  IF NEW.passenger_id IS NOT NULL AND NEW.passenger_id <> NEW.created_by THEN
    v_participant := NEW.passenger_id;
  ELSIF NEW.driver_id IS NOT NULL AND NEW.driver_id <> NEW.created_by THEN
    v_participant := NEW.driver_id;
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (
    user_id,
    type,
    title,
    body,
    ride_id,
    support_ticket_id
  ) VALUES (
    v_participant,
    'support_ticket_created_for_user',
    'Access Support opened a case',
    NEW.ticket_reference || ' · ' || NEW.subject,
    NEW.ride_id,
    NEW.id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS support_admin_originated_participant_notification
  ON public.support_tickets;
CREATE TRIGGER support_admin_originated_participant_notification
  AFTER INSERT ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.notify_admin_originated_support_participant();

REVOKE ALL ON FUNCTION public.notify_admin_originated_support_participant() FROM PUBLIC;

COMMENT ON FUNCTION public.notify_admin_originated_support_participant() IS
  'Notifies the passenger or driver when Access administration opens a support case for them.';