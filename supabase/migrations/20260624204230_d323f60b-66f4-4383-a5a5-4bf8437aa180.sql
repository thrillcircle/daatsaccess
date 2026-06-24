
CREATE TABLE IF NOT EXISTS public.vehicle_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_name text NOT NULL,
  vehicle_type text,
  make text,
  model text,
  year integer,
  license_plate text UNIQUE NOT NULL,
  vin_number text,
  wheelchair_accessible boolean NOT NULL DEFAULT false,
  ramp_or_lift_available boolean NOT NULL DEFAULT false,
  passenger_capacity integer,
  wheelchair_capacity integer,
  assigned_driver_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  current_odometer_km numeric NOT NULL DEFAULT 0,
  last_service_km numeric,
  next_service_due_km numeric,
  service_interval_km numeric NOT NULL DEFAULT 10000,
  last_service_date date,
  roadworthy_expiry_date date,
  license_disc_expiry_date date,
  insurance_expiry_date date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','in_maintenance','out_of_service','retired')),
  admin_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_profiles TO authenticated;
GRANT ALL ON public.vehicle_profiles TO service_role;

ALTER TABLE public.vehicle_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view vehicles"
  ON public.vehicle_profiles FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can insert vehicles"
  ON public.vehicle_profiles FOR INSERT TO authenticated
  WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update vehicles"
  ON public.vehicle_profiles FOR UPDATE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete vehicles"
  ON public.vehicle_profiles FOR DELETE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER set_vehicle_profiles_updated_at
  BEFORE UPDATE ON public.vehicle_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
