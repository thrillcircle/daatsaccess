
-- Move has_role to private schema to prevent PostgREST exposure
CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;

REVOKE EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO authenticated, service_role;

-- Recreate all policies referencing public.has_role to use private.has_role
DROP POLICY IF EXISTS "users read own roles" ON public.user_roles;
CREATE POLICY "users read own roles" ON public.user_roles FOR SELECT TO authenticated
  USING ((auth.uid() = user_id) OR private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "users read own profile" ON public.profiles;
CREATE POLICY "users read own profile" ON public.profiles FOR SELECT TO authenticated
  USING ((auth.uid() = user_id) OR private.has_role(auth.uid(), 'admin'::public.app_role));

-- Fix driver_profiles location exposure: restrict to self, admin, or passenger with active ride
DROP POLICY IF EXISTS "authenticated can view available drivers" ON public.driver_profiles;
DROP POLICY IF EXISTS "driver profile visibility" ON public.driver_profiles;
CREATE POLICY "driver profile visibility" ON public.driver_profiles FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    OR private.has_role(auth.uid(), 'admin'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.rides r
      WHERE r.driver_id = driver_profiles.user_id
        AND r.passenger_id = auth.uid()
        AND r.status IN ('accepted'::public.ride_status,'driver_arriving'::public.ride_status,'in_progress'::public.ride_status)
    )
  );

DROP POLICY IF EXISTS "driver sees assigned or open rides" ON public.rides;
CREATE POLICY "driver sees assigned or open rides" ON public.rides FOR SELECT TO authenticated
  USING ((auth.uid() = driver_id) OR ((driver_id IS NULL) AND (status = 'requested'::public.ride_status) AND private.has_role(auth.uid(), 'driver'::public.app_role)));

DROP POLICY IF EXISTS "admin sees all rides" ON public.rides;
CREATE POLICY "admin sees all rides" ON public.rides FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "driver updates assigned or claims open ride" ON public.rides;
CREATE POLICY "driver updates assigned or claims open ride" ON public.rides FOR UPDATE TO authenticated
  USING ((auth.uid() = driver_id) OR ((driver_id IS NULL) AND (status = 'requested'::public.ride_status) AND private.has_role(auth.uid(), 'driver'::public.app_role)))
  WITH CHECK (auth.uid() = driver_id);

DROP POLICY IF EXISTS "involved sees payment" ON public.payments;
CREATE POLICY "involved sees payment" ON public.payments FOR SELECT TO authenticated
  USING ((auth.uid() = passenger_id) OR (auth.uid() = driver_id) OR private.has_role(auth.uid(), 'admin'::public.app_role));

-- Drop now-unused public.has_role to remove the executable SECURITY DEFINER from exposed schema
DROP FUNCTION IF EXISTS public.has_role(uuid, public.app_role);

-- Add explicit write policies on user_roles restricting writes to admins only
DROP POLICY IF EXISTS "admins insert roles" ON public.user_roles;
CREATE POLICY "admins insert roles" ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));
DROP POLICY IF EXISTS "admins update roles" ON public.user_roles;
CREATE POLICY "admins update roles" ON public.user_roles FOR UPDATE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));
DROP POLICY IF EXISTS "admins delete roles" ON public.user_roles;
CREATE POLICY "admins delete roles" ON public.user_roles FOR DELETE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role));
