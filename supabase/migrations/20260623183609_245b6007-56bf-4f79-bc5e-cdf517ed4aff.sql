
-- ============ ENUMS ============
CREATE TYPE public.app_role AS ENUM ('passenger', 'driver', 'admin');
CREATE TYPE public.ride_status AS ENUM ('requested','accepted','driver_arriving','in_progress','completed','cancelled');
CREATE TYPE public.payment_status AS ENUM ('pending','paid','failed','refunded');

-- ============ PROFILES ============
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  phone TEXT,
  role public.app_role NOT NULL DEFAULT 'passenger',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ============ USER_ROLES (security-critical, separate from profiles) ============
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE POLICY "users read own roles" ON public.user_roles FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- ============ DRIVER PROFILES ============
CREATE TABLE public.driver_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  vehicle_type TEXT,
  vehicle_model TEXT,
  license_plate TEXT,
  is_available BOOLEAN NOT NULL DEFAULT false,
  current_lat DOUBLE PRECISION,
  current_lng DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_profiles TO authenticated;
GRANT ALL ON public.driver_profiles TO service_role;
ALTER TABLE public.driver_profiles ENABLE ROW LEVEL SECURITY;

-- ============ RIDES ============
CREATE TABLE public.rides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  passenger_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  driver_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  pickup_address TEXT NOT NULL,
  pickup_lat DOUBLE PRECISION NOT NULL,
  pickup_lng DOUBLE PRECISION NOT NULL,
  destination_address TEXT NOT NULL,
  destination_lat DOUBLE PRECISION NOT NULL,
  destination_lng DOUBLE PRECISION NOT NULL,
  distance_km NUMERIC(10,2) NOT NULL,
  estimated_price NUMERIC(10,2) NOT NULL,
  status public.ride_status NOT NULL DEFAULT 'requested',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rides TO authenticated;
GRANT ALL ON public.rides TO service_role;
ALTER TABLE public.rides ENABLE ROW LEVEL SECURITY;

-- ============ PAYMENTS (structure only) ============
CREATE TABLE public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  passenger_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  driver_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  amount NUMERIC(10,2) NOT NULL,
  status public.payment_status NOT NULL DEFAULT 'pending',
  payment_method TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- ============ POLICIES ============
-- profiles
CREATE POLICY "users read own profile" ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "users update own profile" ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users insert own profile" ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- driver_profiles
CREATE POLICY "drivers manage own driver profile" ON public.driver_profiles FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "authenticated can view available drivers" ON public.driver_profiles FOR SELECT TO authenticated
  USING (is_available = true OR auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- rides
CREATE POLICY "passenger sees own rides" ON public.rides FOR SELECT TO authenticated
  USING (auth.uid() = passenger_id);
CREATE POLICY "driver sees assigned or open rides" ON public.rides FOR SELECT TO authenticated
  USING (
    auth.uid() = driver_id
    OR (driver_id IS NULL AND status = 'requested' AND public.has_role(auth.uid(), 'driver'))
  );
CREATE POLICY "admin sees all rides" ON public.rides FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "passenger creates ride" ON public.rides FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = passenger_id);
CREATE POLICY "passenger updates own ride" ON public.rides FOR UPDATE TO authenticated
  USING (auth.uid() = passenger_id) WITH CHECK (auth.uid() = passenger_id);
CREATE POLICY "driver updates assigned or claims open ride" ON public.rides FOR UPDATE TO authenticated
  USING (
    auth.uid() = driver_id
    OR (driver_id IS NULL AND status = 'requested' AND public.has_role(auth.uid(), 'driver'))
  )
  WITH CHECK (auth.uid() = driver_id);

-- payments
CREATE POLICY "involved sees payment" ON public.payments FOR SELECT TO authenticated
  USING (auth.uid() = passenger_id OR auth.uid() = driver_id OR public.has_role(auth.uid(), 'admin'));

-- ============ TRIGGERS ============
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER rides_set_updated_at BEFORE UPDATE ON public.rides
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- auto-create profile + default passenger role on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name, phone)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'phone')
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'passenger')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.rides;
ALTER TABLE public.rides REPLICA IDENTITY FULL;
