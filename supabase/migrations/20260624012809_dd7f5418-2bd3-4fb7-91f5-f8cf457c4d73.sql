
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ride_id uuid REFERENCES public.rides(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  body text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user_created ON public.notifications(user_id, created_at DESC);
CREATE INDEX idx_notifications_user_unread ON public.notifications(user_id) WHERE read_at IS NULL;
CREATE INDEX idx_notifications_ride_type ON public.notifications(ride_id, type);

GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own notifications"
  ON public.notifications FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users mark own notifications read"
  ON public.notifications FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

CREATE OR REPLACE FUNCTION public.short_addr(t text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN t IS NULL THEN '' WHEN length(t) > 40 THEN substr(t,1,37) || '…' ELSE t END
$$;

CREATE OR REPLACE FUNCTION public.notify_ride_created()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.request_type = 'scheduled' THEN
    INSERT INTO public.notifications(user_id, ride_id, type, title, body)
    VALUES (
      NEW.passenger_id, NEW.id, 'scheduled_created',
      'Trip scheduled',
      'Your trip to ' || public.short_addr(NEW.destination_address) ||
      ' is scheduled for ' ||
      to_char(NEW.scheduled_at AT TIME ZONE 'Africa/Johannesburg', 'Dy DD Mon HH24:MI')
    );
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_notify_ride_created
AFTER INSERT ON public.rides
FOR EACH ROW EXECUTE FUNCTION public.notify_ride_created();

CREATE OR REPLACE FUNCTION public.notify_ride_updated()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  passenger_name text;
  driver_name text;
BEGIN
  IF OLD.driver_id IS NULL AND NEW.driver_id IS NOT NULL THEN
    SELECT full_name INTO driver_name FROM public.profiles WHERE user_id = NEW.driver_id;
    INSERT INTO public.notifications(user_id, ride_id, type, title, body)
    VALUES (
      NEW.passenger_id, NEW.id, 'driver_accepted',
      COALESCE(driver_name, 'A driver') || ' accepted your trip',
      'Pickup at ' || public.short_addr(NEW.pickup_address)
    );
  END IF;

  IF OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status = 'cancelled' THEN
      SELECT full_name INTO passenger_name FROM public.profiles WHERE user_id = NEW.passenger_id;
      IF NEW.driver_id IS NOT NULL AND auth.uid() = NEW.passenger_id THEN
        INSERT INTO public.notifications(user_id, ride_id, type, title, body)
        VALUES (
          NEW.driver_id, NEW.id, 'ride_cancelled',
          COALESCE(passenger_name, 'Passenger') || ' cancelled the trip',
          public.short_addr(NEW.pickup_address) || ' → ' || public.short_addr(NEW.destination_address)
        );
      ELSIF auth.uid() = NEW.driver_id THEN
        INSERT INTO public.notifications(user_id, ride_id, type, title, body)
        VALUES (
          NEW.passenger_id, NEW.id, 'ride_cancelled',
          'Your trip was cancelled',
          public.short_addr(NEW.pickup_address) || ' → ' || public.short_addr(NEW.destination_address)
        );
      END IF;
    ELSIF NEW.status = 'completed' THEN
      INSERT INTO public.notifications(user_id, ride_id, type, title, body)
      VALUES (
        NEW.passenger_id, NEW.id, 'ride_completed',
        'Trip completed',
        'Tap to rate your driver — ' || public.short_addr(NEW.destination_address)
      );
    END IF;
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER trg_notify_ride_updated
AFTER UPDATE ON public.rides
FOR EACH ROW EXECUTE FUNCTION public.notify_ride_updated();

CREATE OR REPLACE FUNCTION public.notify_ride_edited()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.rides%ROWTYPE;
  passenger_name text;
BEGIN
  SELECT * INTO r FROM public.rides WHERE id = NEW.ride_id;
  IF r.driver_id IS NULL THEN RETURN NEW; END IF;
  SELECT full_name INTO passenger_name FROM public.profiles WHERE user_id = r.passenger_id;
  INSERT INTO public.notifications(user_id, ride_id, type, title, body)
  VALUES (
    r.driver_id, r.id, 'ride_edited',
    COALESCE(passenger_name, 'Passenger') || ' updated the trip',
    'Pickup ' || public.short_addr(r.pickup_address) || ' → ' || public.short_addr(r.destination_address)
  );
  RETURN NEW;
END $$;

CREATE TRIGGER trg_notify_ride_edited
AFTER INSERT ON public.ride_change_log
FOR EACH ROW EXECUTE FUNCTION public.notify_ride_edited();

CREATE OR REPLACE FUNCTION public.notify_review_submitted()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  passenger_name text;
BEGIN
  SELECT full_name INTO passenger_name FROM public.profiles WHERE user_id = NEW.passenger_id;
  INSERT INTO public.notifications(user_id, ride_id, type, title, body)
  VALUES (
    NEW.driver_id, NEW.ride_id, 'review_submitted',
    'New ' || NEW.rating || '-star review',
    COALESCE(passenger_name, 'A passenger') ||
    CASE WHEN NEW.comment IS NOT NULL AND length(NEW.comment) > 0
         THEN ' wrote: ' || public.short_addr(NEW.comment)
         ELSE ' rated your trip'
    END
  );
  RETURN NEW;
END $$;

CREATE TRIGGER trg_notify_review_submitted
AFTER INSERT ON public.ride_reviews
FOR EACH ROW EXECUTE FUNCTION public.notify_review_submitted();

CREATE OR REPLACE FUNCTION public.notify_approaching_scheduled_rides()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.notifications(user_id, ride_id, type, title, body)
  SELECT r.passenger_id, r.id, 'ride_approaching',
         'Your scheduled trip starts soon',
         'Pickup at ' || public.short_addr(r.pickup_address) || ' around ' ||
         to_char(r.scheduled_at AT TIME ZONE 'Africa/Johannesburg', 'HH24:MI')
  FROM public.rides r
  WHERE r.request_type = 'scheduled'
    AND r.status IN ('requested','accepted')
    AND r.scheduled_at BETWEEN now() + interval '25 minutes' AND now() + interval '35 minutes'
    AND NOT EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.ride_id = r.id AND n.type = 'ride_approaching' AND n.user_id = r.passenger_id
    );

  INSERT INTO public.notifications(user_id, ride_id, type, title, body)
  SELECT r.driver_id, r.id, 'ride_approaching',
         'Scheduled pickup in ~30 min',
         'Pickup at ' || public.short_addr(r.pickup_address)
  FROM public.rides r
  WHERE r.request_type = 'scheduled'
    AND r.status = 'accepted'
    AND r.driver_id IS NOT NULL
    AND r.scheduled_at BETWEEN now() + interval '25 minutes' AND now() + interval '35 minutes'
    AND NOT EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.ride_id = r.id AND n.type = 'ride_approaching' AND n.user_id = r.driver_id
    );
END $$;

SELECT cron.schedule(
  'notify-approaching-scheduled-rides',
  '*/5 * * * *',
  $$ SELECT public.notify_approaching_scheduled_rides(); $$
);
