
-- Phase 5D: Access Extended Journey additive schema

-- 1) Extended journey details bag on service_bookings
ALTER TABLE public.service_bookings
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 2) Role on driver assignments (primary or relief)
ALTER TABLE public.booking_driver_assignments
  ADD COLUMN IF NOT EXISTS assignment_role text NOT NULL DEFAULT 'primary'
  CHECK (assignment_role IN ('primary', 'relief'));

-- Remove old uniqueness if any prevented relief drivers; ensure unique (booking, driver, role, item)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'booking_driver_assignments_unique_role'
  ) THEN
    CREATE UNIQUE INDEX booking_driver_assignments_unique_role
      ON public.booking_driver_assignments (booking_id, driver_user_id, assignment_role, COALESCE(itinerary_item_id::text, ''));
  END IF;
END $$;

-- 3) Realtime publication for booking tables (idempotent)
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'service_bookings',
    'booking_itinerary_items',
    'booking_driver_assignments',
    'booking_vehicle_assignments',
    'booking_companion_assignments',
    'service_quotes',
    'service_quote_items',
    'service_booking_events'
  ]
  LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    EXCEPTION WHEN duplicate_object THEN
      -- already in publication
      NULL;
    END;
  END LOOP;
END $$;
