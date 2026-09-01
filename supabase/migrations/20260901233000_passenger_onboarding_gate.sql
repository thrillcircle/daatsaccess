-- Passenger onboarding gate.
-- Public passenger accounts must complete identity/contact details, a saved address,
-- travel/assistance preferences, an emergency contact and notification preferences
-- before creating new rides or service bookings.

ALTER TABLE public.passenger_preferences
  ADD COLUMN IF NOT EXISTS preferences_confirmed_at timestamptz;

ALTER TABLE public.user_notification_preferences
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

-- Improve OAuth-created passenger profiles by accepting the common provider name fields.
-- Phone is deliberately not guessed: Google/Apple passengers enter it during onboarding.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_name text;
  v_phone text;
BEGIN
  v_name := COALESCE(
    NULLIF(trim(NEW.raw_user_meta_data->>'full_name'), ''),
    NULLIF(trim(NEW.raw_user_meta_data->>'name'), ''),
    NULLIF(
      trim(concat_ws(' ', NEW.raw_user_meta_data->>'given_name', NEW.raw_user_meta_data->>'family_name')),
      ''
    )
  );
  v_phone := NULLIF(trim(NEW.raw_user_meta_data->>'phone'), '');

  INSERT INTO public.profiles (user_id, full_name, phone)
  VALUES (NEW.id, v_name, v_phone)
  ON CONFLICT (user_id) DO UPDATE
  SET full_name = COALESCE(NULLIF(public.profiles.full_name, ''), EXCLUDED.full_name),
      phone = COALESCE(NULLIF(public.profiles.phone, ''), EXCLUDED.phone);

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'passenger'::public.app_role)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.passenger_onboarding_snapshot_for(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_address public.passenger_saved_addresses%ROWTYPE;
  v_preferences public.passenger_preferences%ROWTYPE;
  v_notifications public.user_notification_preferences%ROWTYPE;
  v_email text;
  v_missing text[] := ARRAY[]::text[];
  v_complete boolean;
  v_name_ok boolean := false;
  v_phone_ok boolean := false;
  v_email_ok boolean := false;
  v_address_ok boolean := false;
  v_travel_ok boolean := false;
  v_emergency_ok boolean := false;
  v_notifications_ok boolean := false;
BEGIN
  SELECT p.* INTO v_profile
  FROM public.profiles p
  WHERE p.user_id = p_user_id;

  SELECT u.email::text INTO v_email
  FROM auth.users u
  WHERE u.id = p_user_id;

  SELECT a.* INTO v_address
  FROM public.passenger_saved_addresses a
  WHERE a.passenger_id = p_user_id
  ORDER BY a.is_default DESC, a.created_at ASC
  LIMIT 1;

  SELECT p.* INTO v_preferences
  FROM public.passenger_preferences p
  WHERE p.passenger_id = p_user_id;

  SELECT n.* INTO v_notifications
  FROM public.user_notification_preferences n
  WHERE n.user_id = p_user_id;

  v_name_ok := NULLIF(trim(COALESCE(v_profile.full_name, '')), '') IS NOT NULL
    AND char_length(trim(v_profile.full_name)) BETWEEN 2 AND 80;
  v_phone_ok := COALESCE(v_profile.phone, '') ~ '^\+?[0-9 ()-]{7,20}$';
  v_email_ok := NULLIF(trim(COALESCE(v_email, '')), '') IS NOT NULL;
  v_address_ok := v_address.id IS NOT NULL
    AND NULLIF(trim(COALESCE(v_address.formatted_address, '')), '') IS NOT NULL
    AND v_address.latitude BETWEEN -90 AND 90
    AND v_address.longitude BETWEEN -180 AND 180;
  v_travel_ok := v_preferences.passenger_id IS NOT NULL
    AND v_preferences.preferences_confirmed_at IS NOT NULL;
  v_emergency_ok := v_preferences.passenger_id IS NOT NULL
    AND NULLIF(trim(COALESCE(v_preferences.emergency_contact_name, '')), '') IS NOT NULL
    AND COALESCE(v_preferences.emergency_contact_phone, '') ~ '^\+?[0-9 ()-]{7,20}$'
    AND NULLIF(trim(COALESCE(v_preferences.emergency_contact_relationship, '')), '') IS NOT NULL;
  v_notifications_ok := v_notifications.user_id IS NOT NULL
    AND v_notifications.confirmed_at IS NOT NULL;

  IF NOT v_name_ok THEN v_missing := array_append(v_missing, 'full_name'); END IF;
  IF NOT v_phone_ok THEN v_missing := array_append(v_missing, 'phone'); END IF;
  IF NOT v_email_ok THEN v_missing := array_append(v_missing, 'email'); END IF;
  IF NOT v_address_ok THEN v_missing := array_append(v_missing, 'saved_address'); END IF;
  IF NOT v_travel_ok THEN v_missing := array_append(v_missing, 'travel_preferences'); END IF;
  IF NOT v_emergency_ok THEN v_missing := array_append(v_missing, 'emergency_contact'); END IF;
  IF NOT v_notifications_ok THEN v_missing := array_append(v_missing, 'notification_preferences'); END IF;

  v_complete := COALESCE(array_length(v_missing, 1), 0) = 0;

  RETURN jsonb_build_object(
    'complete', v_complete,
    'missing', to_jsonb(v_missing),
    'completion_percent', round(
      100.0 * (
        (CASE WHEN v_name_ok THEN 1 ELSE 0 END) +
        (CASE WHEN v_phone_ok THEN 1 ELSE 0 END) +
        (CASE WHEN v_email_ok THEN 1 ELSE 0 END) +
        (CASE WHEN v_address_ok THEN 1 ELSE 0 END) +
        (CASE WHEN v_travel_ok THEN 1 ELSE 0 END) +
        (CASE WHEN v_emergency_ok THEN 1 ELSE 0 END) +
        (CASE WHEN v_notifications_ok THEN 1 ELSE 0 END)
      ) / 7.0
    )::integer,
    'profile', jsonb_build_object(
      'full_name', v_profile.full_name,
      'phone', v_profile.phone,
      'email', v_email
    ),
    'saved_address', CASE
      WHEN v_address.id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'id', v_address.id,
        'label', v_address.label,
        'formatted_address', v_address.formatted_address,
        'place_id', v_address.place_id,
        'latitude', v_address.latitude,
        'longitude', v_address.longitude,
        'is_default', v_address.is_default
      )
    END,
    'preferences', CASE
      WHEN v_preferences.passenger_id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'preferred_contact_method', v_preferences.preferred_contact_method,
        'wheelchair_user', v_preferences.wheelchair_user,
        'mobility_device_notes', v_preferences.mobility_device_notes,
        'communication_support_notes', v_preferences.communication_support_notes,
        'general_assistance_notes', v_preferences.general_assistance_notes,
        'emergency_contact_name', v_preferences.emergency_contact_name,
        'emergency_contact_phone', v_preferences.emergency_contact_phone,
        'emergency_contact_relationship', v_preferences.emergency_contact_relationship,
        'preferences_confirmed_at', v_preferences.preferences_confirmed_at
      )
    END,
    'notifications', CASE
      WHEN v_notifications.user_id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'in_app', v_notifications.in_app,
        'push', v_notifications.push,
        'sms', v_notifications.sms,
        'whatsapp', v_notifications.whatsapp,
        'email', v_notifications.email,
        'confirmed_at', v_notifications.confirmed_at
      )
    END
  );
END;
$function$;

REVOKE ALL ON FUNCTION private.passenger_onboarding_snapshot_for(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.passenger_onboarding_snapshot_for(uuid) TO service_role;

CREATE OR REPLACE FUNCTION private.passenger_onboarding_complete(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'auth', 'pg_temp'
AS $function$
  SELECT COALESCE(
    (private.passenger_onboarding_snapshot_for(p_user_id)->>'complete')::boolean,
    false
  );
$function$;

REVOKE ALL ON FUNCTION private.passenger_onboarding_complete(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.passenger_onboarding_complete(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.passenger_onboarding_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT private.has_role(v_uid, 'passenger'::public.app_role) THEN
    RAISE EXCEPTION 'Passenger access required' USING ERRCODE = '42501';
  END IF;

  RETURN private.passenger_onboarding_snapshot_for(v_uid);
END;
$function$;

REVOKE ALL ON FUNCTION public.passenger_onboarding_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.passenger_onboarding_status() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.passenger_complete_onboarding(
  p_full_name text,
  p_phone text,
  p_saved_address_id uuid,
  p_address_label text,
  p_formatted_address text,
  p_place_id text,
  p_latitude double precision,
  p_longitude double precision,
  p_preferred_contact_method text,
  p_wheelchair_user boolean,
  p_mobility_device_notes text,
  p_communication_support_notes text,
  p_general_assistance_notes text,
  p_emergency_contact_name text,
  p_emergency_contact_phone text,
  p_emergency_contact_relationship text,
  p_push boolean,
  p_sms boolean,
  p_whatsapp boolean,
  p_email boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_name text := trim(COALESCE(p_full_name, ''));
  v_phone text := trim(COALESCE(p_phone, ''));
  v_address text := trim(COALESCE(p_formatted_address, ''));
  v_emergency_name text := trim(COALESCE(p_emergency_contact_name, ''));
  v_emergency_phone text := trim(COALESCE(p_emergency_contact_phone, ''));
  v_emergency_relationship text := trim(COALESCE(p_emergency_contact_relationship, ''));
  v_snapshot jsonb;
  v_address_id uuid;
  v_before_complete boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT private.has_role(v_uid, 'passenger'::public.app_role) THEN
    RAISE EXCEPTION 'Passenger access required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_uid AND NULLIF(trim(email::text), '') IS NOT NULL) THEN
    RAISE EXCEPTION 'An email address is required before onboarding can be completed';
  END IF;
  IF char_length(v_name) NOT BETWEEN 2 AND 80 THEN
    RAISE EXCEPTION 'Enter your full name';
  END IF;
  IF v_phone !~ '^\+?[0-9 ()-]{7,20}$' THEN
    RAISE EXCEPTION 'Enter a valid phone number';
  END IF;
  IF p_address_label NOT IN ('Home','Work','Medical Facility','Family','Other') THEN
    RAISE EXCEPTION 'Choose a valid saved-address label';
  END IF;
  IF char_length(v_address) < 5 OR p_latitude NOT BETWEEN -90 AND 90 OR p_longitude NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'Choose a complete saved address from address search';
  END IF;
  IF p_preferred_contact_method NOT IN ('in_app','phone','email') THEN
    RAISE EXCEPTION 'Choose a valid preferred contact method';
  END IF;
  IF char_length(v_emergency_name) < 2 THEN
    RAISE EXCEPTION 'Enter your emergency contact name';
  END IF;
  IF v_emergency_phone !~ '^\+?[0-9 ()-]{7,20}$' THEN
    RAISE EXCEPTION 'Enter a valid emergency contact phone number';
  END IF;
  IF char_length(v_emergency_relationship) < 2 THEN
    RAISE EXCEPTION 'Enter your relationship to the emergency contact';
  END IF;

  v_before_complete := private.passenger_onboarding_complete(v_uid);

  INSERT INTO public.profiles(user_id, full_name, phone)
  VALUES (v_uid, v_name, v_phone)
  ON CONFLICT(user_id) DO UPDATE
  SET full_name = EXCLUDED.full_name,
      phone = EXCLUDED.phone;

  UPDATE public.passenger_saved_addresses
  SET is_default = false,
      updated_at = now()
  WHERE passenger_id = v_uid
    AND is_default;

  IF p_saved_address_id IS NOT NULL THEN
    UPDATE public.passenger_saved_addresses
    SET label = p_address_label,
        formatted_address = v_address,
        place_id = NULLIF(trim(COALESCE(p_place_id, '')), ''),
        latitude = p_latitude,
        longitude = p_longitude,
        is_default = true,
        updated_at = now()
    WHERE id = p_saved_address_id
      AND passenger_id = v_uid
    RETURNING id INTO v_address_id;
  END IF;

  IF v_address_id IS NULL THEN
    INSERT INTO public.passenger_saved_addresses(
      passenger_id, label, formatted_address, place_id, latitude, longitude, is_default
    ) VALUES (
      v_uid,
      p_address_label,
      v_address,
      NULLIF(trim(COALESCE(p_place_id, '')), ''),
      p_latitude,
      p_longitude,
      true
    )
    RETURNING id INTO v_address_id;
  END IF;

  INSERT INTO public.passenger_preferences(
    passenger_id,
    preferred_contact_method,
    wheelchair_user,
    mobility_device_notes,
    communication_support_notes,
    general_assistance_notes,
    emergency_contact_name,
    emergency_contact_phone,
    emergency_contact_relationship,
    preferences_confirmed_at,
    updated_at
  ) VALUES (
    v_uid,
    p_preferred_contact_method,
    COALESCE(p_wheelchair_user, false),
    NULLIF(trim(COALESCE(p_mobility_device_notes, '')), ''),
    NULLIF(trim(COALESCE(p_communication_support_notes, '')), ''),
    NULLIF(trim(COALESCE(p_general_assistance_notes, '')), ''),
    v_emergency_name,
    v_emergency_phone,
    v_emergency_relationship,
    now(),
    now()
  )
  ON CONFLICT(passenger_id) DO UPDATE
  SET preferred_contact_method = EXCLUDED.preferred_contact_method,
      wheelchair_user = EXCLUDED.wheelchair_user,
      mobility_device_notes = EXCLUDED.mobility_device_notes,
      communication_support_notes = EXCLUDED.communication_support_notes,
      general_assistance_notes = EXCLUDED.general_assistance_notes,
      emergency_contact_name = EXCLUDED.emergency_contact_name,
      emergency_contact_phone = EXCLUDED.emergency_contact_phone,
      emergency_contact_relationship = EXCLUDED.emergency_contact_relationship,
      preferences_confirmed_at = now(),
      updated_at = now();

  INSERT INTO public.user_notification_preferences(
    user_id, in_app, push, sms, whatsapp, email, confirmed_at, updated_at
  ) VALUES (
    v_uid,
    true,
    COALESCE(p_push, false),
    COALESCE(p_sms, false),
    COALESCE(p_whatsapp, false),
    COALESCE(p_email, false),
    now(),
    now()
  )
  ON CONFLICT(user_id) DO UPDATE
  SET in_app = true,
      push = EXCLUDED.push,
      sms = EXCLUDED.sms,
      whatsapp = EXCLUDED.whatsapp,
      email = EXCLUDED.email,
      confirmed_at = now(),
      updated_at = now();

  v_snapshot := private.passenger_onboarding_snapshot_for(v_uid);
  IF COALESCE((v_snapshot->>'complete')::boolean, false) = false THEN
    RAISE EXCEPTION 'Passenger onboarding is still incomplete';
  END IF;

  IF NOT v_before_complete THEN
    PERFORM public.write_system_audit(
      'passenger.onboarding_completed',
      'passenger_onboarding',
      'user',
      v_uid::text,
      NULL,
      jsonb_build_object('complete', true),
      jsonb_build_object('saved_address_id', v_address_id)
    );

    INSERT INTO public.notifications(user_id, type, title, body)
    VALUES (
      v_uid,
      'passenger_onboarding_completed',
      'Your Access profile is ready',
      'Your passenger profile is complete. You can now request and book Access services.'
    );
  END IF;

  RETURN v_snapshot;
END;
$function$;

REVOKE ALL ON FUNCTION public.passenger_complete_onboarding(
  text,text,uuid,text,text,text,double precision,double precision,text,boolean,
  text,text,text,text,text,text,boolean,boolean,boolean,boolean
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.passenger_complete_onboarding(
  text,text,uuid,text,text,text,double precision,double precision,text,boolean,
  text,text,text,text,text,text,boolean,boolean,boolean,boolean
) TO authenticated, service_role;

-- Saving notification preferences anywhere in Profile also records explicit confirmation.
CREATE OR REPLACE FUNCTION public.update_notification_preferences(
  p_push boolean,
  p_sms boolean,
  p_whatsapp boolean,
  p_email boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_pref public.user_notification_preferences%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  INSERT INTO public.user_notification_preferences(
    user_id, in_app, push, sms, whatsapp, email, confirmed_at, updated_at
  )
  VALUES(v_uid, true, p_push, p_sms, p_whatsapp, p_email, now(), now())
  ON CONFLICT(user_id) DO UPDATE SET
    in_app = true,
    push = EXCLUDED.push,
    sms = EXCLUDED.sms,
    whatsapp = EXCLUDED.whatsapp,
    email = EXCLUDED.email,
    confirmed_at = now(),
    updated_at = now()
  RETURNING * INTO v_pref;

  RETURN to_jsonb(v_pref);
END;
$function$;

REVOKE ALL ON FUNCTION public.update_notification_preferences(boolean,boolean,boolean,boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_notification_preferences(boolean,boolean,boolean,boolean)
  TO authenticated, service_role;

-- Database-level backstop: passengers cannot bypass onboarding by calling a booking
-- RPC or table endpoint directly. Admin/service-role operational creation remains allowed.
CREATE OR REPLACE FUNCTION public.enforce_passenger_onboarding_before_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_booking_user uuid;
BEGIN
  IF v_actor IS NULL THEN
    RETURN NEW;
  END IF;

  IF private.has_role(v_actor, 'admin'::public.app_role) THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'rides' THEN
    v_booking_user := NEW.passenger_id;
  ELSIF TG_TABLE_NAME = 'service_bookings' THEN
    v_booking_user := NEW.booked_by_user_id;
  ELSE
    RETURN NEW;
  END IF;

  IF v_booking_user = v_actor
     AND private.has_role(v_actor, 'passenger'::public.app_role)
     AND NOT private.passenger_onboarding_complete(v_actor) THEN
    RAISE EXCEPTION 'Complete your Access passenger profile before booking'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_passenger_onboarding_before_booking()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS rides_require_passenger_onboarding ON public.rides;
CREATE TRIGGER rides_require_passenger_onboarding
BEFORE INSERT ON public.rides
FOR EACH ROW EXECUTE FUNCTION public.enforce_passenger_onboarding_before_booking();

DROP TRIGGER IF EXISTS service_bookings_require_passenger_onboarding ON public.service_bookings;
CREATE TRIGGER service_bookings_require_passenger_onboarding
BEFORE INSERT ON public.service_bookings
FOR EACH ROW EXECUTE FUNCTION public.enforce_passenger_onboarding_before_booking();

NOTIFY pgrst, 'reload schema';
