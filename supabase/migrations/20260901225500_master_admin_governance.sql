-- Access role-governance hardening.
-- Public signup remains passenger-only. Role mutation becomes RPC-only.
-- Regular admins may manage passenger/driver entitlements and statuses.
-- Only the Master Admin may grant/revoke Admin access or manage administrator accounts.

CREATE TABLE IF NOT EXISTS public.master_admin_entitlement (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE RESTRICT,
  granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.master_admin_entitlement ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.master_admin_entitlement FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.master_admin_entitlement TO service_role;

CREATE OR REPLACE FUNCTION private.is_master_admin(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
  SELECT p_user_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.master_admin_entitlement m
      WHERE m.singleton = true
        AND m.user_id = p_user_id
    )
    AND private.has_role(p_user_id, 'admin'::public.app_role);
$function$;

REVOKE ALL ON FUNCTION private.is_master_admin(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.is_master_admin(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.current_admin_capabilities()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean;
  v_is_master boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  v_is_admin := private.has_role(v_uid, 'admin'::public.app_role);
  v_is_master := private.is_master_admin(v_uid);

  RETURN jsonb_build_object(
    'is_admin', v_is_admin,
    'is_master_admin', v_is_master,
    'can_manage_admins', v_is_master,
    'can_manage_drivers', v_is_admin,
    'can_manage_passengers', v_is_admin
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.current_admin_capabilities() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_admin_capabilities() TO authenticated, service_role;

-- Direct role-table writes are removed. The auth signup trigger can still seed
-- passenger because it is SECURITY DEFINER; privileged changes go through RPCs.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.user_roles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
DROP POLICY IF EXISTS "admins insert roles" ON public.user_roles;
DROP POLICY IF EXISTS "admins update roles" ON public.user_roles;
DROP POLICY IF EXISTS "admins delete roles" ON public.user_roles;

CREATE OR REPLACE FUNCTION public.admin_list_users_v2()
RETURNS TABLE(
  user_id uuid,
  full_name text,
  phone text,
  email text,
  roles public.app_role[],
  status text,
  created_at timestamptz,
  is_master_admin boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'auth', 'pg_temp'
AS $function$
BEGIN
  IF NOT private.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    u.id,
    p.full_name,
    p.phone,
    u.email::text,
    COALESCE(
      array_agg(r.role ORDER BY r.role) FILTER (WHERE r.role IS NOT NULL),
      '{}'::public.app_role[]
    ),
    COALESCE(c.status, 'active'),
    u.created_at,
    private.is_master_admin(u.id)
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.user_id = u.id
  LEFT JOIN public.user_roles r ON r.user_id = u.id
  LEFT JOIN public.account_controls c ON c.user_id = u.id
  GROUP BY u.id, p.full_name, p.phone, u.email, c.status, u.created_at
  ORDER BY u.created_at DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_list_users_v2() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_users_v2() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_set_user_roles(
  p_user_id uuid,
  p_roles public.app_role[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_is_master boolean;
  v_target_is_master boolean;
  v_target_is_admin boolean;
  v_new_is_admin boolean;
  v_before jsonb;
  v_role public.app_role;
BEGIN
  IF v_actor IS NULL OR NOT private.has_role(v_actor, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'User not found';
  END IF;
  IF COALESCE(array_length(p_roles, 1), 0) = 0 THEN
    RAISE EXCEPTION 'At least one role is required';
  END IF;

  v_actor_is_master := private.is_master_admin(v_actor);
  v_target_is_master := private.is_master_admin(p_user_id);
  v_target_is_admin := private.has_role(p_user_id, 'admin'::public.app_role);
  v_new_is_admin := 'admin'::public.app_role = ANY(p_roles);

  IF v_target_is_master AND NOT v_actor_is_master THEN
    RAISE EXCEPTION 'Only the Master Admin can manage the Master Admin account' USING ERRCODE = '42501';
  END IF;

  IF NOT v_actor_is_master AND (v_target_is_admin OR v_new_is_admin) THEN
    RAISE EXCEPTION 'Only the Master Admin can grant, revoke, or manage administrator access' USING ERRCODE = '42501';
  END IF;

  IF v_target_is_master AND NOT v_new_is_admin THEN
    RAISE EXCEPTION 'The Master Admin must retain administrator access';
  END IF;

  SELECT COALESCE(jsonb_agg(role ORDER BY role), '[]'::jsonb)
  INTO v_before
  FROM public.user_roles
  WHERE user_id = p_user_id;

  DELETE FROM public.user_roles
  WHERE user_id = p_user_id
    AND NOT (role = ANY(p_roles));

  FOREACH v_role IN ARRAY p_roles LOOP
    INSERT INTO public.user_roles(user_id, role)
    VALUES (p_user_id, v_role)
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- Keep the legacy profile.role field aligned for display/data hygiene only.
  UPDATE public.profiles
  SET role = CASE
    WHEN 'admin'::public.app_role = ANY(p_roles) THEN 'admin'::public.app_role
    WHEN 'driver'::public.app_role = ANY(p_roles) THEN 'driver'::public.app_role
    ELSE 'passenger'::public.app_role
  END
  WHERE user_id = p_user_id;

  PERFORM public.write_system_audit(
    'user.roles_changed',
    'users',
    'user',
    p_user_id::text,
    v_before,
    to_jsonb(p_roles),
    jsonb_build_object('actor_is_master_admin', v_actor_is_master)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_set_user_roles(uuid, public.app_role[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_user_roles(uuid, public.app_role[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_set_user_status(
  p_user_id uuid,
  p_status text,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_is_master boolean;
  v_target_is_admin boolean;
  v_target_is_master boolean;
  v_before jsonb;
BEGIN
  IF v_actor IS NULL OR NOT private.has_role(v_actor, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('active', 'suspended') THEN
    RAISE EXCEPTION 'Invalid account status';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'User not found';
  END IF;
  IF p_user_id = v_actor AND p_status = 'suspended' THEN
    RAISE EXCEPTION 'You cannot suspend your own administrator account';
  END IF;

  v_actor_is_master := private.is_master_admin(v_actor);
  v_target_is_admin := private.has_role(p_user_id, 'admin'::public.app_role);
  v_target_is_master := private.is_master_admin(p_user_id);

  IF v_target_is_master THEN
    RAISE EXCEPTION 'The Master Admin account cannot be suspended';
  END IF;
  IF v_target_is_admin AND NOT v_actor_is_master THEN
    RAISE EXCEPTION 'Only the Master Admin can suspend or reactivate administrator accounts' USING ERRCODE = '42501';
  END IF;

  SELECT to_jsonb(c)
  INTO v_before
  FROM public.account_controls c
  WHERE user_id = p_user_id;

  INSERT INTO public.account_controls(user_id, status, reason, changed_by, changed_at)
  VALUES (p_user_id, p_status, NULLIF(trim(COALESCE(p_reason, '')), ''), v_actor, now())
  ON CONFLICT(user_id) DO UPDATE
  SET status = EXCLUDED.status,
      reason = EXCLUDED.reason,
      changed_by = v_actor,
      changed_at = now();

  PERFORM public.write_system_audit(
    'account.status_changed',
    'users',
    'user',
    p_user_id::text,
    v_before,
    jsonb_build_object('status', p_status, 'reason', p_reason),
    jsonb_build_object('actor_is_master_admin', v_actor_is_master)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_set_user_status(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_user_status(uuid, text, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Production account cleanup approved for the 2026-09-01 launch baseline.
-- Accounts are suspended, not deleted, so historical references remain intact.
-- ---------------------------------------------------------------------------
DO $block$
DECLARE
  v_master uuid;
BEGIN
  SELECT id INTO v_master
  FROM auth.users
  WHERE lower(email) = 'vernondyondzo@gmail.com'
  LIMIT 1;

  IF v_master IS NULL THEN
    RAISE EXCEPTION 'Master Admin account vernondyondzo@gmail.com was not found';
  END IF;

  INSERT INTO public.master_admin_entitlement(singleton, user_id, granted_by, granted_at)
  VALUES (true, v_master, v_master, now())
  ON CONFLICT(singleton) DO UPDATE
  SET user_id = EXCLUDED.user_id,
      granted_by = EXCLUDED.granted_by,
      granted_at = EXCLUDED.granted_at;

  -- Reset the five approved production/QA accounts to their intended roles.
  DELETE FROM public.user_roles
  WHERE user_id IN (
    SELECT id FROM auth.users
    WHERE lower(email) IN (
      'caroline@daats.co.za',
      'vernondyondzo@gmail.com',
      'metafluxea@gmail.com',
      'thrillcircle@gmail.com',
      'godaats@gmail.com'
    )
  );

  INSERT INTO public.user_roles(user_id, role)
  SELECT id, 'admin'::public.app_role FROM auth.users
  WHERE lower(email) IN ('caroline@daats.co.za', 'vernondyondzo@gmail.com')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.user_roles(user_id, role)
  SELECT id, 'driver'::public.app_role FROM auth.users
  WHERE lower(email) = 'metafluxea@gmail.com'
  ON CONFLICT DO NOTHING;

  INSERT INTO public.user_roles(user_id, role)
  SELECT id, 'passenger'::public.app_role FROM auth.users
  WHERE lower(email) IN ('thrillcircle@gmail.com', 'godaats@gmail.com')
  ON CONFLICT DO NOTHING;

  UPDATE public.profiles p
  SET role = CASE
    WHEN lower(u.email) IN ('caroline@daats.co.za', 'vernondyondzo@gmail.com') THEN 'admin'::public.app_role
    WHEN lower(u.email) = 'metafluxea@gmail.com' THEN 'driver'::public.app_role
    ELSE 'passenger'::public.app_role
  END
  FROM auth.users u
  WHERE p.user_id = u.id
    AND lower(u.email) IN (
      'caroline@daats.co.za',
      'vernondyondzo@gmail.com',
      'metafluxea@gmail.com',
      'thrillcircle@gmail.com',
      'godaats@gmail.com'
    );

  -- Remove the stale build-era driver profile from the Master Admin account.
  DELETE FROM public.driver_profiles WHERE user_id = v_master;

  -- Explicitly keep the approved accounts active.
  INSERT INTO public.account_controls(user_id, status, reason, changed_by, changed_at)
  SELECT id, 'active', 'Approved production account', v_master, now()
  FROM auth.users
  WHERE lower(email) IN (
    'caroline@daats.co.za',
    'vernondyondzo@gmail.com',
    'metafluxea@gmail.com',
    'thrillcircle@gmail.com',
    'godaats@gmail.com'
  )
  ON CONFLICT(user_id) DO UPDATE
  SET status = 'active',
      reason = 'Approved production account',
      changed_by = v_master,
      changed_at = now();

  -- Suspend old build/test accounts instead of deleting them.
  INSERT INTO public.account_controls(user_id, status, reason, changed_by, changed_at)
  SELECT id, 'suspended', 'Build/test account retired at production role-governance closeout', v_master, now()
  FROM auth.users
  WHERE lower(email) IN (
    'cmalatji65@gmail.com',
    'vernon@thrillcircle.tech',
    'routetest1785534664@example.com'
  )
  ON CONFLICT(user_id) DO UPDATE
  SET status = 'suspended',
      reason = 'Build/test account retired at production role-governance closeout',
      changed_by = v_master,
      changed_at = now();
END;
$block$;

NOTIFY pgrst, 'reload schema';
