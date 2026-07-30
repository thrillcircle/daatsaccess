-- Phase 2 support hardening.
-- Enforces participant identity at the table boundary, protects resolved tickets,
-- and requires an administrative resolution before resolving or closing a case.

CREATE OR REPLACE FUNCTION public.enforce_support_ticket_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  v_is_admin := private.has_role(v_uid, 'admin'::app_role);
  IF v_is_admin THEN
    RETURN NEW;
  END IF;

  NEW.created_by := v_uid;

  IF NEW.requester_role = 'passenger' THEN
    IF NOT private.has_role(v_uid, 'passenger'::app_role) THEN
      RAISE EXCEPTION 'Passenger role required';
    END IF;
    NEW.passenger_id := v_uid;
    NEW.driver_id := NULL;
  ELSIF NEW.requester_role = 'driver' THEN
    IF NOT private.has_role(v_uid, 'driver'::app_role) THEN
      RAISE EXCEPTION 'Driver role required';
    END IF;
    NEW.driver_id := v_uid;
    NEW.passenger_id := NULL;
  ELSE
    RAISE EXCEPTION 'Only administrators may create administrator-originated tickets';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS support_ticket_identity_guard ON public.support_tickets;
CREATE TRIGGER support_ticket_identity_guard
  BEFORE INSERT ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.enforce_support_ticket_identity();

CREATE OR REPLACE FUNCTION public.enforce_support_ticket_resolution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF NEW.status IN ('resolved', 'closed')
     AND nullif(trim(coalesce(NEW.resolution_summary, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A resolution summary is required before resolving or closing a support ticket';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS support_ticket_resolution_guard ON public.support_tickets;
CREATE TRIGGER support_ticket_resolution_guard
  BEFORE UPDATE OF status, resolution_summary ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.enforce_support_ticket_resolution();

CREATE OR REPLACE FUNCTION public.enforce_support_message_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_status text;
  v_is_admin boolean;
BEGIN
  v_is_admin := private.has_role(NEW.sender_id, 'admin'::app_role);

  IF NEW.is_internal_note AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Internal notes are admin-only';
  END IF;

  SELECT status INTO v_status
    FROM public.support_tickets
   WHERE id = NEW.ticket_id;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Support ticket not found';
  END IF;

  IF v_status IN ('resolved', 'closed') AND NOT v_is_admin THEN
    RAISE EXCEPTION 'This ticket is resolved or closed. Create a new ticket if more help is needed';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS support_message_state_guard ON public.support_messages;
CREATE TRIGGER support_message_state_guard
  BEFORE INSERT ON public.support_messages
  FOR EACH ROW EXECUTE FUNCTION public.enforce_support_message_state();

REVOKE ALL ON FUNCTION public.enforce_support_ticket_identity() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_support_ticket_resolution() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_support_message_state() FROM PUBLIC;

COMMENT ON FUNCTION public.enforce_support_ticket_identity() IS
  'Prevents non-admin callers from nominating another passenger or driver identity.';
COMMENT ON FUNCTION public.enforce_support_ticket_resolution() IS
  'Requires a resolution summary before a support ticket can be resolved or closed.';
COMMENT ON FUNCTION public.enforce_support_message_state() IS
  'Prevents non-admin replies to resolved/closed tickets and protects internal notes.';
