
-- ============ ENUMS ============
CREATE TYPE public.service_type AS ENUM ('transport','assisted','appointment','extended_journey');
CREATE TYPE public.journey_pattern AS ENUM ('one_way','return','wait_and_return','recurring','multi_day');
CREATE TYPE public.booking_status AS ENUM ('draft','submitted','awaiting_quote','quoted','accepted','resources_assigned','active','completed','cancelled');
CREATE TYPE public.itinerary_item_type AS ENUM ('ride','waiting','appointment','accommodation','activity','other');
CREATE TYPE public.assistance_requirement_code AS ENUM (
  'boarding_assistance','wheelchair_transfer','door_to_door','facility_escort',
  'hospital_assistance','airport_assistance','elderly_assistance','luggage_assistance',
  'mobility_equipment','communication_assistance','other'
);
CREATE TYPE public.deposit_status AS ENUM ('none','pending','paid','refunded','waived');
CREATE TYPE public.quote_status AS ENUM ('draft','sent','accepted','rejected','expired');
CREATE TYPE public.assignment_status AS ENUM ('proposed','confirmed','cancelled','completed');
CREATE TYPE public.fleet_operational_status AS ENUM ('active','maintenance','out_of_service','retired');

-- ============ updated_at helper exists: public.set_updated_at() ============

-- ============ service_bookings ============
CREATE TABLE public.service_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_reference text NOT NULL UNIQUE DEFAULT ('SB-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10))),
  booked_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  service_type public.service_type NOT NULL,
  journey_pattern public.journey_pattern NOT NULL,
  status public.booking_status NOT NULL DEFAULT 'draft',
  start_at timestamptz,
  end_at timestamptz,
  timezone text NOT NULL DEFAULT 'Africa/Johannesburg',
  requested_companion_count integer NOT NULL DEFAULT 0 CHECK (requested_companion_count >= 0),
  passenger_notes text,
  admin_notes text,
  estimated_total numeric(10,2),
  quoted_total numeric(10,2),
  deposit_amount numeric(10,2),
  deposit_status public.deposit_status NOT NULL DEFAULT 'none',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_service_bookings_user ON public.service_bookings(booked_by_user_id);
CREATE INDEX idx_service_bookings_status ON public.service_bookings(status);
CREATE INDEX idx_service_bookings_start ON public.service_bookings(start_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_bookings TO authenticated;
GRANT ALL ON public.service_bookings TO service_role;
ALTER TABLE public.service_bookings ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_service_bookings_updated BEFORE UPDATE ON public.service_bookings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ booking_travellers ============
CREATE TABLE public.booking_travellers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.service_bookings(id) ON DELETE CASCADE,
  linked_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  full_name text NOT NULL,
  phone text,
  relationship_to_booker text,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_booking_travellers_booking ON public.booking_travellers(booking_id);
CREATE INDEX idx_booking_travellers_linked_user ON public.booking_travellers(linked_user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.booking_travellers TO authenticated;
GRANT ALL ON public.booking_travellers TO service_role;
ALTER TABLE public.booking_travellers ENABLE ROW LEVEL SECURITY;

-- ============ booking_assistance_requirements ============
CREATE TABLE public.booking_assistance_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.service_bookings(id) ON DELETE CASCADE,
  requirement_code public.assistance_requirement_code NOT NULL,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  notes text
);
CREATE INDEX idx_booking_assist_booking ON public.booking_assistance_requirements(booking_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.booking_assistance_requirements TO authenticated;
GRANT ALL ON public.booking_assistance_requirements TO service_role;
ALTER TABLE public.booking_assistance_requirements ENABLE ROW LEVEL SECURITY;

-- ============ booking_itinerary_items ============
CREATE TABLE public.booking_itinerary_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.service_bookings(id) ON DELETE CASCADE,
  day_number integer NOT NULL DEFAULT 1 CHECK (day_number > 0),
  sequence_number integer NOT NULL DEFAULT 1 CHECK (sequence_number > 0),
  item_type public.itinerary_item_type NOT NULL,
  title text,
  planned_start_at timestamptz,
  planned_end_at timestamptz,
  address text,
  latitude double precision,
  longitude double precision,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_booking_itinerary_booking ON public.booking_itinerary_items(booking_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.booking_itinerary_items TO authenticated;
GRANT ALL ON public.booking_itinerary_items TO service_role;
ALTER TABLE public.booking_itinerary_items ENABLE ROW LEVEL SECURITY;

-- ============ companion_profiles ============
CREATE TABLE public.companion_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  phone text,
  photo_url text,
  employment_status text,
  training_notes text,
  admin_approved boolean NOT NULL DEFAULT false,
  is_available boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.companion_profiles TO authenticated;
GRANT ALL ON public.companion_profiles TO service_role;
ALTER TABLE public.companion_profiles ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_companion_profiles_updated BEFORE UPDATE ON public.companion_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ fleet_vehicles ============
CREATE TABLE public.fleet_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_number text NOT NULL UNIQUE,
  make text,
  model text,
  passenger_capacity integer NOT NULL DEFAULT 4 CHECK (passenger_capacity >= 0),
  wheelchair_capacity integer NOT NULL DEFAULT 0 CHECK (wheelchair_capacity >= 0),
  accessibility_features jsonb NOT NULL DEFAULT '[]'::jsonb,
  operational_status public.fleet_operational_status NOT NULL DEFAULT 'active',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fleet_vehicles TO authenticated;
GRANT ALL ON public.fleet_vehicles TO service_role;
ALTER TABLE public.fleet_vehicles ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_fleet_vehicles_updated BEFORE UPDATE ON public.fleet_vehicles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ booking_driver_assignments ============
CREATE TABLE public.booking_driver_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.service_bookings(id) ON DELETE CASCADE,
  itinerary_item_id uuid REFERENCES public.booking_itinerary_items(id) ON DELETE SET NULL,
  driver_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status public.assignment_status NOT NULL DEFAULT 'proposed',
  assigned_at timestamptz NOT NULL DEFAULT now(),
  notes text
);
CREATE INDEX idx_booking_driver_assignments_booking ON public.booking_driver_assignments(booking_id);
CREATE INDEX idx_booking_driver_assignments_driver ON public.booking_driver_assignments(driver_user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.booking_driver_assignments TO authenticated;
GRANT ALL ON public.booking_driver_assignments TO service_role;
ALTER TABLE public.booking_driver_assignments ENABLE ROW LEVEL SECURITY;

-- ============ booking_companion_assignments ============
CREATE TABLE public.booking_companion_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.service_bookings(id) ON DELETE CASCADE,
  itinerary_item_id uuid REFERENCES public.booking_itinerary_items(id) ON DELETE SET NULL,
  companion_id uuid NOT NULL REFERENCES public.companion_profiles(id) ON DELETE CASCADE,
  status public.assignment_status NOT NULL DEFAULT 'proposed',
  assigned_at timestamptz NOT NULL DEFAULT now(),
  notes text
);
CREATE INDEX idx_booking_companion_assignments_booking ON public.booking_companion_assignments(booking_id);
CREATE INDEX idx_booking_companion_assignments_companion ON public.booking_companion_assignments(companion_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.booking_companion_assignments TO authenticated;
GRANT ALL ON public.booking_companion_assignments TO service_role;
ALTER TABLE public.booking_companion_assignments ENABLE ROW LEVEL SECURITY;

-- ============ booking_vehicle_assignments ============
CREATE TABLE public.booking_vehicle_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.service_bookings(id) ON DELETE CASCADE,
  itinerary_item_id uuid REFERENCES public.booking_itinerary_items(id) ON DELETE SET NULL,
  fleet_vehicle_id uuid NOT NULL REFERENCES public.fleet_vehicles(id) ON DELETE CASCADE,
  status public.assignment_status NOT NULL DEFAULT 'proposed',
  assigned_at timestamptz NOT NULL DEFAULT now(),
  notes text
);
CREATE INDEX idx_booking_vehicle_assignments_booking ON public.booking_vehicle_assignments(booking_id);
CREATE INDEX idx_booking_vehicle_assignments_vehicle ON public.booking_vehicle_assignments(fleet_vehicle_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.booking_vehicle_assignments TO authenticated;
GRANT ALL ON public.booking_vehicle_assignments TO service_role;
ALTER TABLE public.booking_vehicle_assignments ENABLE ROW LEVEL SECURITY;

-- ============ service_quotes ============
CREATE TABLE public.service_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.service_bookings(id) ON DELETE CASCADE,
  quote_reference text NOT NULL UNIQUE DEFAULT ('Q-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10))),
  status public.quote_status NOT NULL DEFAULT 'draft',
  subtotal numeric(10,2) NOT NULL DEFAULT 0,
  tax_amount numeric(10,2) NOT NULL DEFAULT 0,
  total numeric(10,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'ZAR',
  valid_until timestamptz,
  notes text,
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_service_quotes_booking ON public.service_quotes(booking_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_quotes TO authenticated;
GRANT ALL ON public.service_quotes TO service_role;
ALTER TABLE public.service_quotes ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_service_quotes_updated BEFORE UPDATE ON public.service_quotes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ service_quote_items ============
CREATE TABLE public.service_quote_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES public.service_quotes(id) ON DELETE CASCADE,
  label text NOT NULL,
  description text,
  quantity numeric(10,2) NOT NULL DEFAULT 1,
  unit_price numeric(10,2) NOT NULL DEFAULT 0,
  line_total numeric(10,2) NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0
);
CREATE INDEX idx_service_quote_items_quote ON public.service_quote_items(quote_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_quote_items TO authenticated;
GRANT ALL ON public.service_quote_items TO service_role;
ALTER TABLE public.service_quote_items ENABLE ROW LEVEL SECURITY;

-- ============ service_booking_events ============
CREATE TABLE public.service_booking_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.service_bookings(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_service_booking_events_booking ON public.service_booking_events(booking_id);
GRANT SELECT, INSERT ON public.service_booking_events TO authenticated;
GRANT ALL ON public.service_booking_events TO service_role;
ALTER TABLE public.service_booking_events ENABLE ROW LEVEL SECURITY;

-- ============ Extend rides ============
ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS service_booking_id uuid REFERENCES public.service_bookings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS itinerary_item_id uuid REFERENCES public.booking_itinerary_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS leg_sequence integer,
  ADD COLUMN IF NOT EXISTS day_number integer;
CREATE INDEX IF NOT EXISTS idx_rides_service_booking ON public.rides(service_booking_id);

-- ============ Security-definer helpers ============
CREATE OR REPLACE FUNCTION public.is_booking_owner(_booking_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.service_bookings WHERE id = _booking_id AND booked_by_user_id = _user_id);
$$;

CREATE OR REPLACE FUNCTION public.is_assigned_driver_for_booking(_booking_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.booking_driver_assignments
    WHERE booking_id = _booking_id AND driver_user_id = _user_id
      AND status IN ('proposed','confirmed','completed')
  );
$$;

-- ============ RLS POLICIES ============

-- service_bookings
CREATE POLICY "booker reads own bookings" ON public.service_bookings
  FOR SELECT TO authenticated USING (booked_by_user_id = auth.uid());
CREATE POLICY "booker inserts own bookings" ON public.service_bookings
  FOR INSERT TO authenticated WITH CHECK (booked_by_user_id = auth.uid());
CREATE POLICY "booker updates own bookings" ON public.service_bookings
  FOR UPDATE TO authenticated USING (booked_by_user_id = auth.uid()) WITH CHECK (booked_by_user_id = auth.uid());
CREATE POLICY "booker deletes draft bookings" ON public.service_bookings
  FOR DELETE TO authenticated USING (booked_by_user_id = auth.uid() AND status = 'draft');
CREATE POLICY "assigned drivers read booking" ON public.service_bookings
  FOR SELECT TO authenticated USING (public.is_assigned_driver_for_booking(id, auth.uid()));
CREATE POLICY "admins manage bookings" ON public.service_bookings
  FOR ALL TO authenticated USING (private.has_role(auth.uid(),'admin'::app_role)) WITH CHECK (private.has_role(auth.uid(),'admin'::app_role));

-- booking_travellers
CREATE POLICY "booker manages travellers" ON public.booking_travellers
  FOR ALL TO authenticated USING (public.is_booking_owner(booking_id, auth.uid())) WITH CHECK (public.is_booking_owner(booking_id, auth.uid()));
CREATE POLICY "linked traveller reads self" ON public.booking_travellers
  FOR SELECT TO authenticated USING (linked_user_id = auth.uid());
CREATE POLICY "assigned driver reads travellers" ON public.booking_travellers
  FOR SELECT TO authenticated USING (public.is_assigned_driver_for_booking(booking_id, auth.uid()));
CREATE POLICY "admins manage travellers" ON public.booking_travellers
  FOR ALL TO authenticated USING (private.has_role(auth.uid(),'admin'::app_role)) WITH CHECK (private.has_role(auth.uid(),'admin'::app_role));

-- booking_assistance_requirements
CREATE POLICY "booker manages assistance" ON public.booking_assistance_requirements
  FOR ALL TO authenticated USING (public.is_booking_owner(booking_id, auth.uid())) WITH CHECK (public.is_booking_owner(booking_id, auth.uid()));
CREATE POLICY "assigned driver reads assistance" ON public.booking_assistance_requirements
  FOR SELECT TO authenticated USING (public.is_assigned_driver_for_booking(booking_id, auth.uid()));
CREATE POLICY "admins manage assistance" ON public.booking_assistance_requirements
  FOR ALL TO authenticated USING (private.has_role(auth.uid(),'admin'::app_role)) WITH CHECK (private.has_role(auth.uid(),'admin'::app_role));

-- booking_itinerary_items
CREATE POLICY "booker manages itinerary" ON public.booking_itinerary_items
  FOR ALL TO authenticated USING (public.is_booking_owner(booking_id, auth.uid())) WITH CHECK (public.is_booking_owner(booking_id, auth.uid()));
CREATE POLICY "assigned driver reads itinerary" ON public.booking_itinerary_items
  FOR SELECT TO authenticated USING (public.is_assigned_driver_for_booking(booking_id, auth.uid()));
CREATE POLICY "admins manage itinerary" ON public.booking_itinerary_items
  FOR ALL TO authenticated USING (private.has_role(auth.uid(),'admin'::app_role)) WITH CHECK (private.has_role(auth.uid(),'admin'::app_role));

-- companion_profiles (private until assigned)
CREATE POLICY "admins manage companions" ON public.companion_profiles
  FOR ALL TO authenticated USING (private.has_role(auth.uid(),'admin'::app_role)) WITH CHECK (private.has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "booker reads assigned companions" ON public.companion_profiles
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.booking_companion_assignments bca
      JOIN public.service_bookings sb ON sb.id = bca.booking_id
      WHERE bca.companion_id = companion_profiles.id
        AND sb.booked_by_user_id = auth.uid()
        AND bca.status IN ('proposed','confirmed','completed')
    )
  );

-- fleet_vehicles (admins manage; assigned drivers + bookers see assigned)
CREATE POLICY "admins manage fleet_vehicles" ON public.fleet_vehicles
  FOR ALL TO authenticated USING (private.has_role(auth.uid(),'admin'::app_role)) WITH CHECK (private.has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "users read assigned fleet vehicles" ON public.fleet_vehicles
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.booking_vehicle_assignments bva
      JOIN public.service_bookings sb ON sb.id = bva.booking_id
      WHERE bva.fleet_vehicle_id = fleet_vehicles.id
        AND (sb.booked_by_user_id = auth.uid()
             OR public.is_assigned_driver_for_booking(sb.id, auth.uid()))
    )
  );

-- booking_driver_assignments
CREATE POLICY "booker reads driver assignments" ON public.booking_driver_assignments
  FOR SELECT TO authenticated USING (public.is_booking_owner(booking_id, auth.uid()));
CREATE POLICY "driver reads own assignments" ON public.booking_driver_assignments
  FOR SELECT TO authenticated USING (driver_user_id = auth.uid());
CREATE POLICY "admins manage driver assignments" ON public.booking_driver_assignments
  FOR ALL TO authenticated USING (private.has_role(auth.uid(),'admin'::app_role)) WITH CHECK (private.has_role(auth.uid(),'admin'::app_role));

-- booking_companion_assignments
CREATE POLICY "booker reads companion assignments" ON public.booking_companion_assignments
  FOR SELECT TO authenticated USING (public.is_booking_owner(booking_id, auth.uid()));
CREATE POLICY "admins manage companion assignments" ON public.booking_companion_assignments
  FOR ALL TO authenticated USING (private.has_role(auth.uid(),'admin'::app_role)) WITH CHECK (private.has_role(auth.uid(),'admin'::app_role));

-- booking_vehicle_assignments
CREATE POLICY "booker reads vehicle assignments" ON public.booking_vehicle_assignments
  FOR SELECT TO authenticated USING (public.is_booking_owner(booking_id, auth.uid()));
CREATE POLICY "driver reads vehicle assignments" ON public.booking_vehicle_assignments
  FOR SELECT TO authenticated USING (public.is_assigned_driver_for_booking(booking_id, auth.uid()));
CREATE POLICY "admins manage vehicle assignments" ON public.booking_vehicle_assignments
  FOR ALL TO authenticated USING (private.has_role(auth.uid(),'admin'::app_role)) WITH CHECK (private.has_role(auth.uid(),'admin'::app_role));

-- service_quotes (booker + admin only)
CREATE POLICY "booker reads quotes" ON public.service_quotes
  FOR SELECT TO authenticated USING (public.is_booking_owner(booking_id, auth.uid()));
CREATE POLICY "admins manage quotes" ON public.service_quotes
  FOR ALL TO authenticated USING (private.has_role(auth.uid(),'admin'::app_role)) WITH CHECK (private.has_role(auth.uid(),'admin'::app_role));

-- service_quote_items
CREATE POLICY "booker reads quote items" ON public.service_quote_items
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.service_quotes q
            WHERE q.id = quote_id AND public.is_booking_owner(q.booking_id, auth.uid()))
  );
CREATE POLICY "admins manage quote items" ON public.service_quote_items
  FOR ALL TO authenticated USING (private.has_role(auth.uid(),'admin'::app_role)) WITH CHECK (private.has_role(auth.uid(),'admin'::app_role));

-- service_booking_events
CREATE POLICY "booker reads events" ON public.service_booking_events
  FOR SELECT TO authenticated USING (public.is_booking_owner(booking_id, auth.uid()));
CREATE POLICY "assigned driver reads events" ON public.service_booking_events
  FOR SELECT TO authenticated USING (public.is_assigned_driver_for_booking(booking_id, auth.uid()));
CREATE POLICY "booker inserts events" ON public.service_booking_events
  FOR INSERT TO authenticated WITH CHECK (
    actor_user_id = auth.uid()
    AND (public.is_booking_owner(booking_id, auth.uid())
         OR public.is_assigned_driver_for_booking(booking_id, auth.uid()))
  );
CREATE POLICY "admins manage events" ON public.service_booking_events
  FOR ALL TO authenticated USING (private.has_role(auth.uid(),'admin'::app_role)) WITH CHECK (private.has_role(auth.uid(),'admin'::app_role));

-- ============ Realtime publication ============
ALTER PUBLICATION supabase_realtime ADD TABLE public.service_bookings;
ALTER PUBLICATION supabase_realtime ADD TABLE public.booking_travellers;
ALTER PUBLICATION supabase_realtime ADD TABLE public.booking_itinerary_items;
ALTER PUBLICATION supabase_realtime ADD TABLE public.booking_driver_assignments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.booking_companion_assignments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.booking_vehicle_assignments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.service_quotes;
ALTER PUBLICATION supabase_realtime ADD TABLE public.service_booking_events;
