
ALTER TABLE public.service_bookings
  ADD COLUMN IF NOT EXISTS parent_booking_id uuid REFERENCES public.service_bookings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recurrence_rule jsonb;

CREATE INDEX IF NOT EXISTS idx_service_bookings_parent ON public.service_bookings(parent_booking_id);

ALTER TABLE public.booking_itinerary_items
  ADD COLUMN IF NOT EXISTS actual_start_at timestamptz,
  ADD COLUMN IF NOT EXISTS actual_end_at timestamptz,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'planned';
