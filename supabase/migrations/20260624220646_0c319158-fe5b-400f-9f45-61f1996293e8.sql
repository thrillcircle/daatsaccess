
-- Recreate helpers in private schema (not exposed via Data API)
CREATE OR REPLACE FUNCTION private.is_booking_owner(_booking_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.service_bookings WHERE id = _booking_id AND booked_by_user_id = _user_id);
$$;

CREATE OR REPLACE FUNCTION private.is_assigned_driver_for_booking(_booking_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.booking_driver_assignments
    WHERE booking_id = _booking_id AND driver_user_id = _user_id
      AND status IN ('proposed','confirmed','completed')
  );
$$;

-- Drop policies that reference the public helpers, recreate using private versions
-- service_bookings
DROP POLICY IF EXISTS "assigned drivers read booking" ON public.service_bookings;
CREATE POLICY "assigned drivers read booking" ON public.service_bookings
  FOR SELECT TO authenticated USING (private.is_assigned_driver_for_booking(id, auth.uid()));

-- booking_travellers
DROP POLICY IF EXISTS "booker manages travellers" ON public.booking_travellers;
DROP POLICY IF EXISTS "assigned driver reads travellers" ON public.booking_travellers;
CREATE POLICY "booker manages travellers" ON public.booking_travellers
  FOR ALL TO authenticated USING (private.is_booking_owner(booking_id, auth.uid())) WITH CHECK (private.is_booking_owner(booking_id, auth.uid()));
CREATE POLICY "assigned driver reads travellers" ON public.booking_travellers
  FOR SELECT TO authenticated USING (private.is_assigned_driver_for_booking(booking_id, auth.uid()));

-- booking_assistance_requirements
DROP POLICY IF EXISTS "booker manages assistance" ON public.booking_assistance_requirements;
DROP POLICY IF EXISTS "assigned driver reads assistance" ON public.booking_assistance_requirements;
CREATE POLICY "booker manages assistance" ON public.booking_assistance_requirements
  FOR ALL TO authenticated USING (private.is_booking_owner(booking_id, auth.uid())) WITH CHECK (private.is_booking_owner(booking_id, auth.uid()));
CREATE POLICY "assigned driver reads assistance" ON public.booking_assistance_requirements
  FOR SELECT TO authenticated USING (private.is_assigned_driver_for_booking(booking_id, auth.uid()));

-- booking_itinerary_items
DROP POLICY IF EXISTS "booker manages itinerary" ON public.booking_itinerary_items;
DROP POLICY IF EXISTS "assigned driver reads itinerary" ON public.booking_itinerary_items;
CREATE POLICY "booker manages itinerary" ON public.booking_itinerary_items
  FOR ALL TO authenticated USING (private.is_booking_owner(booking_id, auth.uid())) WITH CHECK (private.is_booking_owner(booking_id, auth.uid()));
CREATE POLICY "assigned driver reads itinerary" ON public.booking_itinerary_items
  FOR SELECT TO authenticated USING (private.is_assigned_driver_for_booking(booking_id, auth.uid()));

-- fleet_vehicles
DROP POLICY IF EXISTS "users read assigned fleet vehicles" ON public.fleet_vehicles;
CREATE POLICY "users read assigned fleet vehicles" ON public.fleet_vehicles
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.booking_vehicle_assignments bva
      JOIN public.service_bookings sb ON sb.id = bva.booking_id
      WHERE bva.fleet_vehicle_id = fleet_vehicles.id
        AND (sb.booked_by_user_id = auth.uid()
             OR private.is_assigned_driver_for_booking(sb.id, auth.uid()))
    )
  );

-- booking_driver_assignments
DROP POLICY IF EXISTS "booker reads driver assignments" ON public.booking_driver_assignments;
CREATE POLICY "booker reads driver assignments" ON public.booking_driver_assignments
  FOR SELECT TO authenticated USING (private.is_booking_owner(booking_id, auth.uid()));

-- booking_companion_assignments
DROP POLICY IF EXISTS "booker reads companion assignments" ON public.booking_companion_assignments;
CREATE POLICY "booker reads companion assignments" ON public.booking_companion_assignments
  FOR SELECT TO authenticated USING (private.is_booking_owner(booking_id, auth.uid()));

-- companion_profiles
DROP POLICY IF EXISTS "booker reads assigned companions" ON public.companion_profiles;
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

-- booking_vehicle_assignments
DROP POLICY IF EXISTS "booker reads vehicle assignments" ON public.booking_vehicle_assignments;
DROP POLICY IF EXISTS "driver reads vehicle assignments" ON public.booking_vehicle_assignments;
CREATE POLICY "booker reads vehicle assignments" ON public.booking_vehicle_assignments
  FOR SELECT TO authenticated USING (private.is_booking_owner(booking_id, auth.uid()));
CREATE POLICY "driver reads vehicle assignments" ON public.booking_vehicle_assignments
  FOR SELECT TO authenticated USING (private.is_assigned_driver_for_booking(booking_id, auth.uid()));

-- service_quotes
DROP POLICY IF EXISTS "booker reads quotes" ON public.service_quotes;
CREATE POLICY "booker reads quotes" ON public.service_quotes
  FOR SELECT TO authenticated USING (private.is_booking_owner(booking_id, auth.uid()));

-- service_quote_items
DROP POLICY IF EXISTS "booker reads quote items" ON public.service_quote_items;
CREATE POLICY "booker reads quote items" ON public.service_quote_items
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.service_quotes q
            WHERE q.id = quote_id AND private.is_booking_owner(q.booking_id, auth.uid()))
  );

-- service_booking_events
DROP POLICY IF EXISTS "booker reads events" ON public.service_booking_events;
DROP POLICY IF EXISTS "assigned driver reads events" ON public.service_booking_events;
DROP POLICY IF EXISTS "booker inserts events" ON public.service_booking_events;
CREATE POLICY "booker reads events" ON public.service_booking_events
  FOR SELECT TO authenticated USING (private.is_booking_owner(booking_id, auth.uid()));
CREATE POLICY "assigned driver reads events" ON public.service_booking_events
  FOR SELECT TO authenticated USING (private.is_assigned_driver_for_booking(booking_id, auth.uid()));
CREATE POLICY "booker inserts events" ON public.service_booking_events
  FOR INSERT TO authenticated WITH CHECK (
    actor_user_id = auth.uid()
    AND (private.is_booking_owner(booking_id, auth.uid())
         OR private.is_assigned_driver_for_booking(booking_id, auth.uid()))
  );

-- Drop the now-unused public helpers
DROP FUNCTION IF EXISTS public.is_booking_owner(uuid, uuid);
DROP FUNCTION IF EXISTS public.is_assigned_driver_for_booking(uuid, uuid);
