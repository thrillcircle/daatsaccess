CREATE TABLE public.admin_trip_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  admin_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  note text NOT NULL CHECK (length(note) BETWEEN 1 AND 2000),
  is_emergency boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.admin_trip_notes TO authenticated;
GRANT ALL ON public.admin_trip_notes TO service_role;

ALTER TABLE public.admin_trip_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read trip notes"
  ON public.admin_trip_notes FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "admins add trip notes"
  ON public.admin_trip_notes FOR INSERT TO authenticated
  WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role) AND admin_id = auth.uid());

CREATE INDEX admin_trip_notes_ride_idx
  ON public.admin_trip_notes (ride_id, created_at DESC);

ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_trip_notes;
