DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'ride_status' AND e.enumlabel = 'arrived'
  ) THEN
    ALTER TYPE public.ride_status ADD VALUE 'arrived' BEFORE 'in_progress';
  END IF;
END $$;