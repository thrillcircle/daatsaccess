-- Phase 4B: Trip Start PIN
-- A 4-digit PIN is generated when a driver is assigned to a ride.
-- Passenger and admin can read the PIN; driver cannot.
-- Driver must enter the PIN to transition arrived -> in_progress.

-- 1. ride_pins: one PIN per ride. Driver MUST NOT read this table.
CREATE TABLE public.ride_pins (
  ride_id    uuid PRIMARY KEY REFERENCES public.rides(id) ON DELETE CASCADE,
  pin        char(4) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.ride_pins TO authenticated;
GRANT ALL    ON public.ride_pins TO service_role;

ALTER TABLE public.ride_pins ENABLE ROW LEVEL SECURITY;

-- Passenger of the ride may read their own PIN.
CREATE POLICY "passenger reads own ride pin"
  ON public.ride_pins FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.rides r
      WHERE r.id = ride_pins.ride_id
        AND r.passenger_id = auth.uid()
    )
  );

-- Admin may read all PINs.
CREATE POLICY "admin reads all ride pins"
  ON public.ride_pins FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role));

-- No INSERT/UPDATE/DELETE policy exists for non-admin users; writes are
-- performed exclusively by triggers and SECURITY DEFINER functions, which
-- bypass RLS. Drivers cannot read or modify ride_pins.


-- 2. ride_pin_attempts: audit + rate-limit log.
CREATE TABLE public.ride_pin_attempts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id      uuid NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  driver_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  success      boolean NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ride_pin_attempts_ride_idx
  ON public.ride_pin_attempts (ride_id, attempted_at DESC);

GRANT SELECT ON public.ride_pin_attempts TO authenticated;
GRANT ALL    ON public.ride_pin_attempts TO service_role;

ALTER TABLE public.ride_pin_attempts ENABLE ROW LEVEL SECURITY;

-- Driver may see their own attempts (so the UI can show remaining tries).
CREATE POLICY "driver reads own pin attempts"
  ON public.ride_pin_attempts FOR SELECT TO authenticated
  USING (driver_id = auth.uid());

-- Admin may see all attempts for support / recovery.
CREATE POLICY "admin reads all pin attempts"
  ON public.ride_pin_attempts FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role));


-- 3. Helper: generate a fresh 4-digit PIN string.
CREATE OR REPLACE FUNCTION public.generate_ride_pin()
  RETURNS char(4)
  LANGUAGE sql
  VOLATILE
  SET search_path TO 'public'
AS $$
  SELECT lpad((floor(random() * 10000))::int::text, 4, '0')::char(4);
$$;


-- 4. Trigger: when a driver is assigned to a ride, mint a PIN.
CREATE OR REPLACE FUNCTION public.mint_ride_pin()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.driver_id IS NOT NULL
     AND (OLD IS NULL OR OLD.driver_id IS DISTINCT FROM NEW.driver_id)
  THEN
    INSERT INTO public.ride_pins (ride_id, pin)
    VALUES (NEW.id, public.generate_ride_pin())
    ON CONFLICT (ride_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rides_mint_pin ON public.rides;
CREATE TRIGGER rides_mint_pin
  AFTER INSERT OR UPDATE OF driver_id ON public.rides
  FOR EACH ROW EXECUTE FUNCTION public.mint_ride_pin();

-- Back-fill: any active assigned ride without a PIN gets one.
INSERT INTO public.ride_pins (ride_id, pin)
SELECT r.id, public.generate_ride_pin()
  FROM public.rides r
  LEFT JOIN public.ride_pins p ON p.ride_id = r.id
 WHERE r.driver_id IS NOT NULL
   AND p.ride_id IS NULL;


-- 5. Verification function. SECURITY DEFINER so it can read ride_pins,
-- enforce rate limit, write the attempt log, and update the ride atomically.
--
-- Returns json: { "status": "started" | "wrong" | "locked" | "invalid",
--                 "remaining": int, "lock_seconds": int }
CREATE OR REPLACE FUNCTION public.verify_ride_start_pin(
  _ride_id uuid,
  _pin text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
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

  -- Rate-limit: count recent failures in the lock window.
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
    RETURN jsonb_build_object(
      'status','wrong',
      'remaining', GREATEST(0, max_failures - failures - 1)
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_ride_start_pin(uuid, text)
  TO authenticated;


-- 6. Admin recovery: regenerate the PIN and clear failed attempts.
CREATE OR REPLACE FUNCTION public.admin_reset_ride_pin(_ride_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
DECLARE
  actor uuid := auth.uid();
  new_pin char(4);
BEGIN
  IF actor IS NULL OR NOT private.has_role(actor, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  new_pin := public.generate_ride_pin();

  INSERT INTO public.ride_pins (ride_id, pin)
  VALUES (_ride_id, new_pin)
  ON CONFLICT (ride_id) DO UPDATE
    SET pin = excluded.pin,
        updated_at = now();

  DELETE FROM public.ride_pin_attempts
   WHERE ride_id = _ride_id AND success = false;

  RETURN jsonb_build_object('status','reset','pin', new_pin);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_reset_ride_pin(uuid) TO authenticated;
