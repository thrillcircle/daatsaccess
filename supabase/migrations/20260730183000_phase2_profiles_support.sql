-- Phase 2: passenger profile extensions and support operations.
-- Adds saved addresses, passenger preferences, support tickets/messages/events,
-- protected support RPCs, RLS, realtime publication, and support notifications.

CREATE SEQUENCE IF NOT EXISTS public.support_ticket_reference_seq START 1;

CREATE TABLE IF NOT EXISTS public.passenger_saved_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  passenger_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label text NOT NULL DEFAULT 'Home' CHECK (label IN ('Home','Work','Medical Facility','Family','Other')),
  formatted_address text NOT NULL,
  place_id text,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS passenger_saved_addresses_one_default
  ON public.passenger_saved_addresses(passenger_id)
  WHERE is_default;
CREATE INDEX IF NOT EXISTS passenger_saved_addresses_passenger_idx
  ON public.passenger_saved_addresses(passenger_id);

CREATE TABLE IF NOT EXISTS public.passenger_preferences (
  passenger_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  preferred_contact_method text NOT NULL DEFAULT 'in_app'
    CHECK (preferred_contact_method IN ('in_app','phone','email')),
  wheelchair_user boolean NOT NULL DEFAULT false,
  mobility_device_notes text,
  communication_support_notes text,
  general_assistance_notes text,
  emergency_contact_name text,
  emergency_contact_phone text,
  emergency_contact_relationship text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_reference text NOT NULL UNIQUE DEFAULT (
    'ACC-SUP-' || lpad(nextval('public.support_ticket_reference_seq')::text, 6, '0')
  ),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  requester_role text NOT NULL CHECK (requester_role IN ('passenger','driver','admin')),
  passenger_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  driver_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_admin_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ride_id uuid REFERENCES public.rides(id) ON DELETE SET NULL,
  service_booking_id uuid REFERENCES public.service_bookings(id) ON DELETE SET NULL,
  category text NOT NULL CHECK (category IN (
    'trip_issue','scheduled_trip','service_booking','quote_question','driver_issue',
    'vehicle_issue','account_profile','accessibility_assistance','complaint',
    'lost_property','other'
  )),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN (
    'open','triage','assigned','waiting_for_user','in_progress','resolved','closed'
  )),
  subject text NOT NULL CHECK (char_length(subject) BETWEEN 3 AND 160),
  description text NOT NULL CHECK (char_length(description) BETWEEN 3 AND 5000),
  resolution_summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  closed_at timestamptz
);

CREATE INDEX IF NOT EXISTS support_tickets_created_by_idx ON public.support_tickets(created_by);
CREATE INDEX IF NOT EXISTS support_tickets_passenger_idx ON public.support_tickets(passenger_id);
CREATE INDEX IF NOT EXISTS support_tickets_driver_idx ON public.support_tickets(driver_id);
CREATE INDEX IF NOT EXISTS support_tickets_assigned_idx ON public.support_tickets(assigned_admin_id);
CREATE INDEX IF NOT EXISTS support_tickets_status_priority_idx ON public.support_tickets(status, priority);
CREATE INDEX IF NOT EXISTS support_tickets_ride_idx ON public.support_tickets(ride_id);
CREATE INDEX IF NOT EXISTS support_tickets_booking_idx ON public.support_tickets(service_booking_id);

CREATE TABLE IF NOT EXISTS public.support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  sender_role text NOT NULL CHECK (sender_role IN ('passenger','driver','admin')),
  message text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 5000),
  is_internal_note boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_messages_ticket_idx
  ON public.support_messages(ticket_id, created_at);

CREATE TABLE IF NOT EXISTS public.support_ticket_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  previous_value jsonb,
  new_value jsonb,
  performed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_ticket_events_ticket_idx
  ON public.support_ticket_events(ticket_id, created_at);

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS support_ticket_id uuid
  REFERENCES public.support_tickets(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS notifications_support_ticket_idx
  ON public.notifications(support_ticket_id);

CREATE OR REPLACE FUNCTION public.set_single_default_passenger_address()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_default THEN
    UPDATE public.passenger_saved_addresses
       SET is_default = false,
           updated_at = now()
     WHERE passenger_id = NEW.passenger_id
       AND id <> NEW.id
       AND is_default;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS passenger_saved_addresses_single_default
  ON public.passenger_saved_addresses;
CREATE TRIGGER passenger_saved_addresses_single_default
  BEFORE INSERT OR UPDATE OF is_default
  ON public.passenger_saved_addresses
  FOR EACH ROW EXECUTE FUNCTION public.set_single_default_passenger_address();

DROP TRIGGER IF EXISTS passenger_saved_addresses_updated_at
  ON public.passenger_saved_addresses;
CREATE TRIGGER passenger_saved_addresses_updated_at
  BEFORE UPDATE ON public.passenger_saved_addresses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS passenger_preferences_updated_at
  ON public.passenger_preferences;
CREATE TRIGGER passenger_preferences_updated_at
  BEFORE UPDATE ON public.passenger_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS support_tickets_updated_at
  ON public.support_tickets;
CREATE TRIGGER support_tickets_updated_at
  BEFORE UPDATE ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.passenger_saved_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.passenger_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_ticket_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Passengers manage own saved addresses" ON public.passenger_saved_addresses;
CREATE POLICY "Passengers manage own saved addresses"
  ON public.passenger_saved_addresses
  FOR ALL TO authenticated
  USING (passenger_id = auth.uid())
  WITH CHECK (passenger_id = auth.uid());

DROP POLICY IF EXISTS "Admins view saved addresses" ON public.passenger_saved_addresses;
CREATE POLICY "Admins view saved addresses"
  ON public.passenger_saved_addresses
  FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Passengers manage own preferences" ON public.passenger_preferences;
CREATE POLICY "Passengers manage own preferences"
  ON public.passenger_preferences
  FOR ALL TO authenticated
  USING (passenger_id = auth.uid())
  WITH CHECK (passenger_id = auth.uid());

DROP POLICY IF EXISTS "Admins view passenger preferences" ON public.passenger_preferences;
CREATE POLICY "Admins view passenger preferences"
  ON public.passenger_preferences
  FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Support participants view tickets" ON public.support_tickets;
CREATE POLICY "Support participants view tickets"
  ON public.support_tickets
  FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR passenger_id = auth.uid()
    OR driver_id = auth.uid()
    OR private.has_role(auth.uid(), 'admin'::app_role)
  );

DROP POLICY IF EXISTS "Users create own support tickets" ON public.support_tickets;
CREATE POLICY "Users create own support tickets"
  ON public.support_tickets
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND (
      passenger_id = auth.uid()
      OR driver_id = auth.uid()
      OR private.has_role(auth.uid(), 'admin'::app_role)
    )
  );

DROP POLICY IF EXISTS "Support participants view public messages" ON public.support_messages;
CREATE POLICY "Support participants view public messages"
  ON public.support_messages
  FOR SELECT TO authenticated
  USING (
    private.has_role(auth.uid(), 'admin'::app_role)
    OR (
      NOT is_internal_note
      AND EXISTS (
        SELECT 1 FROM public.support_tickets t
         WHERE t.id = ticket_id
           AND (t.created_by = auth.uid() OR t.passenger_id = auth.uid() OR t.driver_id = auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS "Admins view support events" ON public.support_ticket_events;
CREATE POLICY "Admins view support events"
  ON public.support_ticket_events
  FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role));

CREATE OR REPLACE FUNCTION public.support_create_ticket(
  p_requester_role text,
  p_category text,
  p_subject text,
  p_description text,
  p_priority text DEFAULT 'normal',
  p_ride_id uuid DEFAULT NULL,
  p_service_booking_id uuid DEFAULT NULL,
  p_passenger_id uuid DEFAULT NULL,
  p_driver_id uuid DEFAULT NULL
)
RETURNS public.support_tickets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text := lower(trim(coalesce(p_requester_role, '')));
  v_priority text := lower(trim(coalesce(p_priority, 'normal')));
  v_ticket public.support_tickets;
  v_is_admin boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  v_is_admin := private.has_role(v_uid, 'admin'::app_role);

  IF v_role NOT IN ('passenger','driver','admin') THEN
    RAISE EXCEPTION 'Invalid requester role';
  END IF;
  IF v_role = 'passenger' AND NOT private.has_role(v_uid, 'passenger'::app_role) AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Passenger role required';
  END IF;
  IF v_role = 'driver' AND NOT private.has_role(v_uid, 'driver'::app_role) AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Driver role required';
  END IF;
  IF v_role = 'admin' AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Admin role required';
  END IF;

  IF p_category NOT IN (
    'trip_issue','scheduled_trip','service_booking','quote_question','driver_issue',
    'vehicle_issue','account_profile','accessibility_assistance','complaint',
    'lost_property','other'
  ) THEN RAISE EXCEPTION 'Invalid support category'; END IF;

  IF v_is_admin THEN
    IF v_priority NOT IN ('low','normal','high','urgent') THEN v_priority := 'normal'; END IF;
  ELSE
    IF v_priority NOT IN ('normal','high') THEN v_priority := 'normal'; END IF;
    IF lower(coalesce(p_subject,'') || ' ' || coalesce(p_description,''))
       ~ '(immediate danger|unsafe|stranded|assault|emergency|threat|medical crisis)' THEN
      v_priority := 'urgent';
    END IF;
  END IF;

  IF p_ride_id IS NOT NULL AND NOT v_is_admin AND NOT EXISTS (
    SELECT 1 FROM public.rides r
     WHERE r.id = p_ride_id
       AND (r.passenger_id = v_uid OR r.driver_id = v_uid)
  ) THEN RAISE EXCEPTION 'You cannot link this trip'; END IF;

  IF p_service_booking_id IS NOT NULL AND NOT v_is_admin AND NOT EXISTS (
    SELECT 1 FROM public.service_bookings b
     WHERE b.id = p_service_booking_id
       AND b.booked_by_user_id = v_uid
  ) THEN RAISE EXCEPTION 'You cannot link this booking'; END IF;

  INSERT INTO public.support_tickets (
    created_by, requester_role, passenger_id, driver_id, ride_id,
    service_booking_id, category, priority, subject, description
  ) VALUES (
    v_uid,
    v_role,
    CASE WHEN v_role = 'passenger' THEN coalesce(p_passenger_id, v_uid)
         WHEN v_is_admin THEN p_passenger_id ELSE NULL END,
    CASE WHEN v_role = 'driver' THEN coalesce(p_driver_id, v_uid)
         WHEN v_is_admin THEN p_driver_id ELSE NULL END,
    p_ride_id,
    p_service_booking_id,
    p_category,
    v_priority,
    trim(p_subject),
    trim(p_description)
  ) RETURNING * INTO v_ticket;

  INSERT INTO public.support_ticket_events (
    ticket_id, event_type, new_value, performed_by
  ) VALUES (
    v_ticket.id, 'ticket_created',
    jsonb_build_object('status', v_ticket.status, 'priority', v_ticket.priority), v_uid
  );

  INSERT INTO public.notifications (user_id, type, title, body, ride_id, support_ticket_id)
  VALUES (
    v_uid, 'support_ticket_created', 'Support ticket created',
    v_ticket.ticket_reference || ' · ' || v_ticket.subject,
    v_ticket.ride_id, v_ticket.id
  );

  INSERT INTO public.notifications (user_id, type, title, body, ride_id, support_ticket_id)
  SELECT ur.user_id,
         CASE WHEN v_ticket.priority = 'urgent' THEN 'support_urgent' ELSE 'support_new' END,
         CASE WHEN v_ticket.priority = 'urgent' THEN 'Urgent support ticket' ELSE 'New support ticket' END,
         v_ticket.ticket_reference || ' · ' || v_ticket.subject,
         v_ticket.ride_id,
         v_ticket.id
    FROM public.user_roles ur
   WHERE ur.role = 'admin'::app_role
     AND ur.user_id <> v_uid;

  RETURN v_ticket;
END;
$$;

CREATE OR REPLACE FUNCTION public.support_add_message(
  p_ticket_id uuid,
  p_message text,
  p_is_internal_note boolean DEFAULT false
)
RETURNS public.support_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ticket public.support_tickets;
  v_message public.support_messages;
  v_is_admin boolean;
  v_role text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_ticket FROM public.support_tickets WHERE id = p_ticket_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Support ticket not found'; END IF;

  v_is_admin := private.has_role(v_uid, 'admin'::app_role);
  IF NOT v_is_admin AND v_ticket.created_by <> v_uid
     AND coalesce(v_ticket.passenger_id, '00000000-0000-0000-0000-000000000000'::uuid) <> v_uid
     AND coalesce(v_ticket.driver_id, '00000000-0000-0000-0000-000000000000'::uuid) <> v_uid THEN
    RAISE EXCEPTION 'You cannot access this support ticket';
  END IF;
  IF p_is_internal_note AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Internal notes are admin-only';
  END IF;
  IF v_ticket.status = 'closed' AND NOT v_is_admin THEN
    RAISE EXCEPTION 'This ticket is closed';
  END IF;
  IF char_length(trim(coalesce(p_message,''))) < 1 THEN
    RAISE EXCEPTION 'Message is required';
  END IF;

  IF v_is_admin THEN v_role := 'admin';
  ELSIF v_ticket.driver_id = v_uid THEN v_role := 'driver';
  ELSE v_role := 'passenger';
  END IF;

  INSERT INTO public.support_messages (
    ticket_id, sender_id, sender_role, message, is_internal_note
  ) VALUES (
    p_ticket_id, v_uid, v_role, trim(p_message), p_is_internal_note
  ) RETURNING * INTO v_message;

  UPDATE public.support_tickets SET updated_at = now() WHERE id = p_ticket_id;
  INSERT INTO public.support_ticket_events (
    ticket_id, event_type, new_value, performed_by
  ) VALUES (
    p_ticket_id,
    CASE WHEN p_is_internal_note THEN 'internal_note_added' ELSE 'message_added' END,
    jsonb_build_object('sender_role', v_role), v_uid
  );

  IF NOT p_is_internal_note THEN
    IF v_is_admin THEN
      IF v_ticket.created_by <> v_uid THEN
        INSERT INTO public.notifications (user_id, type, title, body, ride_id, support_ticket_id)
        VALUES (
          v_ticket.created_by, 'support_reply', 'Access Support replied',
          v_ticket.ticket_reference || ' · ' || left(trim(p_message), 140),
          v_ticket.ride_id, v_ticket.id
        );
      END IF;
    ELSIF v_ticket.assigned_admin_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, body, ride_id, support_ticket_id)
      VALUES (
        v_ticket.assigned_admin_id, 'support_user_reply', 'New support reply',
        v_ticket.ticket_reference || ' · ' || left(trim(p_message), 140),
        v_ticket.ride_id, v_ticket.id
      );
    ELSE
      INSERT INTO public.notifications (user_id, type, title, body, ride_id, support_ticket_id)
      SELECT ur.user_id, 'support_user_reply', 'New support reply',
             v_ticket.ticket_reference || ' · ' || left(trim(p_message), 140),
             v_ticket.ride_id, v_ticket.id
        FROM public.user_roles ur
       WHERE ur.role = 'admin'::app_role;
    END IF;
  END IF;

  RETURN v_message;
END;
$$;

CREATE OR REPLACE FUNCTION public.support_admin_update_ticket(
  p_ticket_id uuid,
  p_status text DEFAULT NULL,
  p_priority text DEFAULT NULL,
  p_assigned_admin_id uuid DEFAULT NULL,
  p_resolution_summary text DEFAULT NULL
)
RETURNS public.support_tickets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_old public.support_tickets;
  v_new public.support_tickets;
  v_status text;
  v_priority text;
  v_assigned uuid;
BEGIN
  IF v_uid IS NULL OR NOT private.has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Admin role required';
  END IF;

  SELECT * INTO v_old FROM public.support_tickets WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Support ticket not found'; END IF;

  v_status := coalesce(lower(trim(p_status)), v_old.status);
  v_priority := coalesce(lower(trim(p_priority)), v_old.priority);
  v_assigned := coalesce(p_assigned_admin_id, v_old.assigned_admin_id);

  IF v_status NOT IN ('open','triage','assigned','waiting_for_user','in_progress','resolved','closed') THEN
    RAISE EXCEPTION 'Invalid support status';
  END IF;
  IF v_priority NOT IN ('low','normal','high','urgent') THEN
    RAISE EXCEPTION 'Invalid support priority';
  END IF;
  IF v_assigned IS NOT NULL AND NOT private.has_role(v_assigned, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Assigned user must be an administrator';
  END IF;

  IF v_status <> v_old.status THEN
    IF NOT (
      (v_old.status = 'open' AND v_status IN ('triage','assigned','in_progress','waiting_for_user','resolved','closed')) OR
      (v_old.status = 'triage' AND v_status IN ('assigned','in_progress','waiting_for_user','resolved','closed','open')) OR
      (v_old.status = 'assigned' AND v_status IN ('in_progress','waiting_for_user','resolved','closed','triage')) OR
      (v_old.status = 'waiting_for_user' AND v_status IN ('in_progress','resolved','closed','assigned')) OR
      (v_old.status = 'in_progress' AND v_status IN ('waiting_for_user','resolved','closed','assigned')) OR
      (v_old.status = 'resolved' AND v_status IN ('closed','open','in_progress')) OR
      (v_old.status = 'closed' AND v_status = 'open')
    ) THEN RAISE EXCEPTION 'Invalid support status transition'; END IF;
  END IF;

  UPDATE public.support_tickets
     SET status = v_status,
         priority = v_priority,
         assigned_admin_id = v_assigned,
         resolution_summary = CASE
           WHEN p_resolution_summary IS NOT NULL THEN nullif(trim(p_resolution_summary),'')
           ELSE resolution_summary
         END,
         resolved_at = CASE
           WHEN v_status = 'resolved' AND v_old.status <> 'resolved' THEN now()
           WHEN v_status <> 'resolved' THEN NULL
           ELSE resolved_at
         END,
         closed_at = CASE
           WHEN v_status = 'closed' AND v_old.status <> 'closed' THEN now()
           WHEN v_status <> 'closed' THEN NULL
           ELSE closed_at
         END,
         updated_at = now()
   WHERE id = p_ticket_id
   RETURNING * INTO v_new;

  IF v_old.status IS DISTINCT FROM v_new.status THEN
    INSERT INTO public.support_ticket_events(ticket_id,event_type,previous_value,new_value,performed_by)
    VALUES (p_ticket_id,'status_changed',to_jsonb(v_old.status),to_jsonb(v_new.status),v_uid);
  END IF;
  IF v_old.priority IS DISTINCT FROM v_new.priority THEN
    INSERT INTO public.support_ticket_events(ticket_id,event_type,previous_value,new_value,performed_by)
    VALUES (p_ticket_id,'priority_changed',to_jsonb(v_old.priority),to_jsonb(v_new.priority),v_uid);
  END IF;
  IF v_old.assigned_admin_id IS DISTINCT FROM v_new.assigned_admin_id THEN
    INSERT INTO public.support_ticket_events(ticket_id,event_type,previous_value,new_value,performed_by)
    VALUES (p_ticket_id,'assignment_changed',to_jsonb(v_old.assigned_admin_id),to_jsonb(v_new.assigned_admin_id),v_uid);
  END IF;

  IF v_new.created_by <> v_uid THEN
    INSERT INTO public.notifications (user_id,type,title,body,ride_id,support_ticket_id)
    VALUES (
      v_new.created_by,
      'support_status_changed',
      'Support ticket updated',
      v_new.ticket_reference || ' is now ' || replace(v_new.status,'_',' '),
      v_new.ride_id,
      v_new.id
    );
  END IF;

  RETURN v_new;
END;
$$;

REVOKE ALL ON FUNCTION public.support_create_ticket(text,text,text,text,text,uuid,uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.support_add_message(uuid,text,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.support_admin_update_ticket(uuid,text,text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.support_create_ticket(text,text,text,text,text,uuid,uuid,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.support_add_message(uuid,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.support_admin_update_ticket(uuid,text,text,uuid,text) TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.passenger_saved_addresses TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.passenger_preferences TO authenticated;
GRANT SELECT ON public.support_tickets TO authenticated;
GRANT SELECT ON public.support_messages TO authenticated;
GRANT SELECT ON public.support_ticket_events TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.support_ticket_reference_seq TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'support_tickets'
  ) THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.support_tickets; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'support_messages'
  ) THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.support_messages; END IF;
END;
$$;

COMMENT ON TABLE public.passenger_saved_addresses IS
  'Passenger-managed saved pickup addresses. Admin read access is operational and privacy-sensitive.';
COMMENT ON TABLE public.passenger_preferences IS
  'Passenger accessibility and communication preferences; not a medical diagnosis record.';
COMMENT ON TABLE public.support_tickets IS
  'Role-protected support workflow for passengers, drivers, and administrators.';
