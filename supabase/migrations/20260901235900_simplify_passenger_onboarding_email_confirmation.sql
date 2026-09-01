-- Simplify passenger onboarding to the minimum information Access needs before a new booking:
-- 1) personal details (full name, phone and authenticated email),
-- 2) one validated primary saved address, and
-- 3) proof that the passenger controls the account email.
-- Travel/assistance, emergency contact and notification preferences remain optional Profile data.

CREATE TABLE IF NOT EXISTS public.passenger_email_confirmations (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  confirmed_at timestamptz,
  confirmed_via text,
  challenge_id uuid,
  code_hash text,
  code_expires_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  last_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT passenger_email_confirmations_method_check
    CHECK (confirmed_via IS NULL OR confirmed_via IN ('email_code','oauth_google','oauth_apple')),
  CONSTRAINT passenger_email_confirmations_attempt_check CHECK (attempt_count >= 0)
);

ALTER TABLE public.passenger_email_confirmations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.passenger_email_confirmations FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.passenger_email_confirmations TO service_role;

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
  v_email text;
  v_confirmation public.passenger_email_confirmations%ROWTYPE;
  v_oauth_provider text;
  v_missing text[] := ARRAY[]::text[];
  v_name_ok boolean := false;
  v_phone_ok boolean := false;
  v_email_ok boolean := false;
  v_personal_ok boolean := false;
  v_address_ok boolean := false;
  v_confirmation_ok boolean := false;
  v_complete boolean := false;
  v_confirmation_method text;
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

  SELECT c.* INTO v_confirmation
  FROM public.passenger_email_confirmations c
  WHERE c.user_id = p_user_id
    AND lower(c.email) = lower(COALESCE(v_email, ''));

  -- Google and Apple already verify ownership of the email presented to Access.
  SELECT i.provider INTO v_oauth_provider
  FROM auth.identities i
  WHERE i.user_id = p_user_id
    AND i.provider IN ('google','apple')
    AND lower(COALESCE(i.identity_data->>'email', v_email, '')) = lower(COALESCE(v_email, ''))
  ORDER BY CASE i.provider WHEN 'google' THEN 1 ELSE 2 END
  LIMIT 1;

  v_name_ok := NULLIF(trim(COALESCE(v_profile.full_name, '')), '') IS NOT NULL
    AND char_length(trim(v_profile.full_name)) BETWEEN 2 AND 80;
  v_phone_ok := COALESCE(v_profile.phone, '') ~ '^\+?[0-9 ()-]{7,20}$';
  v_email_ok := NULLIF(trim(COALESCE(v_email, '')), '') IS NOT NULL;
  v_personal_ok := v_name_ok AND v_phone_ok AND v_email_ok;
  v_address_ok := v_address.id IS NOT NULL
    AND NULLIF(trim(COALESCE(v_address.formatted_address, '')), '') IS NOT NULL
    AND v_address.latitude BETWEEN -90 AND 90
    AND v_address.longitude BETWEEN -180 AND 180;

  IF v_oauth_provider = 'google' THEN
    v_confirmation_ok := true;
    v_confirmation_method := 'oauth_google';
  ELSIF v_oauth_provider = 'apple' THEN
    v_confirmation_ok := true;
    v_confirmation_method := 'oauth_apple';
  ELSIF v_confirmation.confirmed_at IS NOT NULL THEN
    v_confirmation_ok := true;
    v_confirmation_method := COALESCE(v_confirmation.confirmed_via, 'email_code');
  END IF;

  IF NOT v_name_ok THEN v_missing := array_append(v_missing, 'full_name'); END IF;
  IF NOT v_phone_ok THEN v_missing := array_append(v_missing, 'phone'); END IF;
  IF NOT v_email_ok THEN v_missing := array_append(v_missing, 'email'); END IF;
  IF NOT v_address_ok THEN v_missing := array_append(v_missing, 'saved_address'); END IF;
  IF NOT v_confirmation_ok THEN v_missing := array_append(v_missing, 'email_confirmation'); END IF;

  v_complete := v_personal_ok AND v_address_ok AND v_confirmation_ok;

  RETURN jsonb_build_object(
    'complete', v_complete,
    'missing', to_jsonb(v_missing),
    'completion_percent', round(
      100.0 * (
        (CASE WHEN v_personal_ok THEN 1 ELSE 0 END) +
        (CASE WHEN v_address_ok THEN 1 ELSE 0 END) +
        (CASE WHEN v_confirmation_ok THEN 1 ELSE 0 END)
      ) / 3.0
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
    'email_confirmation', jsonb_build_object(
      'confirmed', v_confirmation_ok,
      'confirmed_at', CASE
        WHEN v_oauth_provider IS NOT NULL THEN NULL
        ELSE v_confirmation.confirmed_at
      END,
      'method', v_confirmation_method,
      'last_sent_at', v_confirmation.last_sent_at
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION private.passenger_onboarding_snapshot_for(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.passenger_onboarding_snapshot_for(uuid) TO service_role;

-- Remove the former long onboarding RPC so assistance, emergency-contact and notification
-- arguments cannot remain a hidden prerequisite through an overloaded signature.
DROP FUNCTION IF EXISTS public.passenger_complete_onboarding(
  text,text,uuid,text,text,text,double precision,double precision,text,boolean,text,text,text,text,text,text,boolean,boolean,boolean,boolean
);

CREATE OR REPLACE FUNCTION public.passenger_complete_onboarding(
  p_full_name text,
  p_phone text,
  p_saved_address_id uuid,
  p_address_label text,
  p_formatted_address text,
  p_place_id text,
  p_latitude double precision,
  p_longitude double precision
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
  IF NOT EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = v_uid AND NULLIF(trim(email::text), '') IS NOT NULL
  ) THEN
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
  IF char_length(v_address) < 5
     OR p_latitude NOT BETWEEN -90 AND 90
     OR p_longitude NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'Choose a complete saved address from address search';
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

  v_snapshot := private.passenger_onboarding_snapshot_for(v_uid);

  IF NOT v_before_complete AND COALESCE((v_snapshot->>'complete')::boolean, false) THEN
    PERFORM public.write_system_audit(
      'passenger.onboarding_completed',
      'passenger_onboarding',
      'user',
      v_uid::text,
      NULL,
      jsonb_build_object('complete', true),
      jsonb_build_object('saved_address_id', v_address_id, 'required_steps', 3)
    );

    INSERT INTO public.notifications(user_id, type, title, body)
    VALUES (
      v_uid,
      'passenger_onboarding_completed',
      'Your Access account is ready',
      'Your account details, primary address and email confirmation are complete. You can now book Access services.'
    );
  END IF;

  RETURN v_snapshot;
END;
$function$;

REVOKE ALL ON FUNCTION public.passenger_complete_onboarding(
  text,text,uuid,text,text,text,double precision,double precision
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.passenger_complete_onboarding(
  text,text,uuid,text,text,text,double precision,double precision
) TO authenticated, service_role;

-- Keep the booking backstop unchanged: it now evaluates the simplified three-step snapshot.
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
