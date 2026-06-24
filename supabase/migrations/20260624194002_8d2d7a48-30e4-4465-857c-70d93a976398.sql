
-- 1. Audit log table for admin PIN access
CREATE TABLE public.pin_access_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ride_id uuid NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('pin_viewed','alert_acknowledged')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pin_access_audit_ride_idx ON public.pin_access_audit(ride_id, created_at DESC);
CREATE INDEX pin_access_audit_admin_idx ON public.pin_access_audit(admin_id, created_at DESC);

GRANT SELECT ON public.pin_access_audit TO authenticated;
GRANT ALL ON public.pin_access_audit TO service_role;

ALTER TABLE public.pin_access_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read pin audit"
  ON public.pin_access_audit
  FOR SELECT
  TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role));

-- No INSERT/UPDATE/DELETE policies: rows are only written by SECURITY DEFINER funcs.

-- 2. Admin: reveal PIN (with audit)
CREATE OR REPLACE FUNCTION public.admin_view_ride_pin(_ride_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
  r public.rides%ROWTYPE;
  pax_name text;
  drv_name text;
  stored_pin char(4);
BEGIN
  IF actor IS NULL OR NOT private.has_role(actor, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO r FROM public.rides WHERE id = _ride_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ride not found';
  END IF;

  SELECT pin INTO stored_pin FROM public.ride_pins WHERE ride_id = _ride_id;
  IF stored_pin IS NULL THEN
    RAISE EXCEPTION 'No PIN for this ride';
  END IF;

  SELECT full_name INTO pax_name FROM public.profiles WHERE user_id = r.passenger_id;
  IF r.driver_id IS NOT NULL THEN
    SELECT full_name INTO drv_name FROM public.profiles WHERE user_id = r.driver_id;
  END IF;

  INSERT INTO public.pin_access_audit (admin_id, ride_id, action)
  VALUES (actor, _ride_id, 'pin_viewed');

  RETURN jsonb_build_object(
    'pin', stored_pin,
    'ride_id', r.id,
    'status', r.status,
    'passenger_name', pax_name,
    'driver_name', drv_name
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_view_ride_pin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_view_ride_pin(uuid) TO authenticated;

-- 3. Admin: acknowledge a 5th-attempt alert (does NOT unlock or change PIN)
CREATE OR REPLACE FUNCTION public.admin_acknowledge_pin_alert(_ride_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
  updated_count int;
BEGIN
  IF actor IS NULL OR NOT private.has_role(actor, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE public.notifications
     SET read_at = now()
   WHERE user_id = actor
     AND ride_id = _ride_id
     AND type = 'pin_failed_attempt_limit'
     AND read_at IS NULL;
  GET DIAGNOSTICS updated_count = ROW_COUNT;

  INSERT INTO public.pin_access_audit (admin_id, ride_id, action)
  VALUES (actor, _ride_id, 'alert_acknowledged');

  RETURN jsonb_build_object('acknowledged', updated_count);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_acknowledge_pin_alert(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_acknowledge_pin_alert(uuid) TO authenticated;

-- 4. Update verify_ride_start_pin to fan out admin alerts on the 5th failure
CREATE OR REPLACE FUNCTION public.verify_ride_start_pin(_ride_id uuid, _pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor        uuid := auth.uid();
  r            public.rides%ROWTYPE;
  stored_pin   char(4);
  failures     int;
  latest_fail  timestamptz;
  lock_window  constant interval := interval '15 minutes';
  max_failures constant int := 5;
  now_ts       timestamptz := now();
  pax_name     text;
  drv_name     text;
  expiry_ts    timestamptz;
BEGIN
  IF actor IS NULL THEN
    RETURN jsonb_build_object('status','invalid','reason','unauthenticated');
  END IF;

  SELECT * INTO r FROM public.rides WHERE id = _ride_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','invalid','reason','ride_not_found');
  END IF;
  IF r.driver_id IS DISTINCT FROM actor THEN
    RETURN jsonb_build_object('status','invalid','reason','not_assigned_driver');
  END IF;
  IF r.status <> 'arrived' THEN
    RETURN jsonb_build_object('status','invalid','reason','wrong_status');
  END IF;

  SELECT count(*), max(attempted_at)
    INTO failures, latest_fail
    FROM public.ride_pin_attempts
   WHERE ride_id   = _ride_id
     AND driver_id = actor
     AND success   = false
     AND attempted_at > now_ts - lock_window;

  IF failures >= max_failures THEN
    RETURN jsonb_build_object(
      'status','locked',
      'lock_seconds',
        GREATEST(0, EXTRACT(EPOCH FROM (latest_fail + lock_window - now_ts))::int)
    );
  END IF;

  SELECT pin INTO stored_pin FROM public.ride_pins WHERE ride_id = _ride_id;
  IF stored_pin IS NULL THEN
    RETURN jsonb_build_object('status','invalid','reason','no_pin');
  END IF;

  IF stored_pin = lpad(_pin, 4, '0') THEN
    INSERT INTO public.ride_pin_attempts (ride_id, driver_id, success)
    VALUES (_ride_id, actor, true);

    UPDATE public.rides
       SET status = 'in_progress',
           started_at = now_ts
     WHERE id = _ride_id
       AND driver_id = actor
       AND status = 'arrived';

    INSERT INTO public.ride_status_events
      (ride_id, changed_by, previous_status, new_status)
    VALUES (_ride_id, actor, 'arrived', 'in_progress');

    RETURN jsonb_build_object('status','started');
  ELSE
    INSERT INTO public.ride_pin_attempts (ride_id, driver_id, success)
    VALUES (_ride_id, actor, false);

    -- 5th failure → fan out a single high-priority alert per admin.
    -- failures is the count BEFORE this insert; this insert makes it the 5th.
    IF failures + 1 >= max_failures THEN
      expiry_ts := now_ts + lock_window;
      SELECT full_name INTO pax_name FROM public.profiles WHERE user_id = r.passenger_id;
      SELECT full_name INTO drv_name FROM public.profiles WHERE user_id = actor;

      -- Dedup: skip if any admin already has an alert for this ride within the lock window
      IF NOT EXISTS (
        SELECT 1 FROM public.notifications n
         WHERE n.ride_id = _ride_id
           AND n.type = 'pin_failed_attempt_limit'
           AND n.created_at > now_ts - lock_window
      ) THEN
        INSERT INTO public.notifications (user_id, ride_id, type, title, body)
        SELECT ur.user_id, _ride_id, 'pin_failed_attempt_limit',
               'PIN lockout: driver hit 5 failed attempts',
               'Ride ' || substr(_ride_id::text, 1, 8)
               || ' · passenger ' || COALESCE(pax_name, '—')
               || ' · driver ' || COALESCE(drv_name, '—')
               || ' · pickup ' || public.short_addr(r.pickup_address)
               || ' · status ' || r.status::text
               || ' · 5 failed attempts'
               || ' · latest ' || to_char(now_ts AT TIME ZONE 'Africa/Johannesburg', 'HH24:MI')
               || ' · locked until ' || to_char(expiry_ts AT TIME ZONE 'Africa/Johannesburg', 'HH24:MI')
          FROM public.user_roles ur
         WHERE ur.role = 'admin'::app_role;
      END IF;

      RETURN jsonb_build_object(
        'status','locked',
        'lock_seconds', EXTRACT(EPOCH FROM lock_window)::int
      );
    END IF;

    RETURN jsonb_build_object(
      'status','wrong',
      'remaining', GREATEST(0, max_failures - failures - 1)
    );
  END IF;
END;
$$;

-- 5. Realtime on ride_pin_attempts for live admin dashboard updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.ride_pin_attempts;
