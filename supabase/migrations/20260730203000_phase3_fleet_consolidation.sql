-- Phase 3: canonical fleet consolidation, assignments and maintenance.
-- This migration is deliberately non-destructive. Legacy vehicle sources remain
-- available until reconciliation and live validation are complete.

CREATE OR REPLACE FUNCTION public.normalize_vehicle_registration(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT NULLIF(regexp_replace(upper(trim(COALESCE(value, ''))), '[^A-Z0-9]', '', 'g'), '');
$$;

CREATE OR REPLACE FUNCTION public.fleet_require_admin()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL OR NOT private.has_role(v_actor, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Administrator role required';
  END IF;
  RETURN v_actor;
END;
$$;

REVOKE ALL ON FUNCTION public.fleet_require_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fleet_require_admin() TO authenticated;

-- Canonical vehicle normalisation and status alignment.
ALTER TABLE public.vehicle_profiles
  ADD COLUMN IF NOT EXISTS license_plate_normalized text,
  ADD COLUMN IF NOT EXISTS accessibility_features jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS legacy_consolidation_status text NOT NULL DEFAULT 'pending';

UPDATE public.vehicle_profiles
SET status = 'maintenance'
WHERE status = 'in_maintenance';

ALTER TABLE public.vehicle_profiles
  DROP CONSTRAINT IF EXISTS vehicle_profiles_status_check;
ALTER TABLE public.vehicle_profiles
  ADD CONSTRAINT vehicle_profiles_status_check
  CHECK (status IN ('active', 'maintenance', 'out_of_service', 'retired'));

UPDATE public.vehicle_profiles
SET license_plate = upper(trim(license_plate)),
    license_plate_normalized = public.normalize_vehicle_registration(license_plate)
WHERE license_plate_normalized IS DISTINCT FROM public.normalize_vehicle_registration(license_plate)
   OR license_plate IS DISTINCT FROM upper(trim(license_plate));

CREATE INDEX IF NOT EXISTS vehicle_profiles_normalized_plate_idx
  ON public.vehicle_profiles(license_plate_normalized);
CREATE INDEX IF NOT EXISTS vehicle_profiles_status_idx
  ON public.vehicle_profiles(status);

CREATE OR REPLACE FUNCTION public.vehicle_profiles_normalize_registration()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.license_plate := upper(trim(NEW.license_plate));
  NEW.license_plate_normalized := public.normalize_vehicle_registration(NEW.license_plate);

  IF NEW.license_plate_normalized IS NULL THEN
    RAISE EXCEPTION 'Vehicle registration is required';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.vehicle_profiles existing
    WHERE existing.license_plate_normalized = NEW.license_plate_normalized
      AND existing.id <> NEW.id
  ) THEN
    RAISE EXCEPTION 'A canonical vehicle with this normalised registration already exists';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS vehicle_profiles_normalize_registration_trigger
  ON public.vehicle_profiles;
CREATE TRIGGER vehicle_profiles_normalize_registration_trigger
  BEFORE INSERT OR UPDATE OF license_plate ON public.vehicle_profiles
  FOR EACH ROW EXECUTE FUNCTION public.vehicle_profiles_normalize_registration();

-- Migration reconciliation.
CREATE TABLE IF NOT EXISTS public.vehicle_legacy_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_vehicle_id uuid NOT NULL REFERENCES public.vehicle_profiles(id) ON DELETE CASCADE,
  legacy_source text NOT NULL CHECK (legacy_source IN ('vehicle_profiles', 'fleet_vehicles', 'driver_profiles')),
  legacy_record_id text NOT NULL,
  legacy_registration text,
  match_method text NOT NULL,
  match_confidence numeric(5,2) NOT NULL DEFAULT 100 CHECK (match_confidence >= 0 AND match_confidence <= 100),
  migration_status text NOT NULL DEFAULT 'mapped' CHECK (migration_status IN ('mapped', 'review_required', 'rejected')),
  conflict_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (legacy_source, legacy_record_id)
);

CREATE TABLE IF NOT EXISTS public.fleet_consolidation_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_type text NOT NULL,
  source_table text NOT NULL,
  source_record_id text,
  registration_number text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'ignored')),
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vehicle_legacy_mappings_vehicle_idx
  ON public.vehicle_legacy_mappings(canonical_vehicle_id);
CREATE INDEX IF NOT EXISTS fleet_consolidation_issues_status_idx
  ON public.fleet_consolidation_issues(status, issue_type);

INSERT INTO public.fleet_consolidation_issues (
  issue_type, source_table, registration_number, details
)
SELECT
  'duplicate_canonical_registration',
  'vehicle_profiles',
  license_plate_normalized,
  jsonb_build_object('vehicle_ids', jsonb_agg(id), 'registrations', jsonb_agg(license_plate))
FROM public.vehicle_profiles
WHERE license_plate_normalized IS NOT NULL
GROUP BY license_plate_normalized
HAVING count(*) > 1
ON CONFLICT DO NOTHING;

INSERT INTO public.fleet_consolidation_issues (
  issue_type, source_table, registration_number, details
)
SELECT
  'duplicate_legacy_registration',
  'fleet_vehicles',
  public.normalize_vehicle_registration(registration_number),
  jsonb_build_object('fleet_vehicle_ids', jsonb_agg(id), 'registrations', jsonb_agg(registration_number))
FROM public.fleet_vehicles
WHERE public.normalize_vehicle_registration(registration_number) IS NOT NULL
GROUP BY public.normalize_vehicle_registration(registration_number)
HAVING count(*) > 1
ON CONFLICT DO NOTHING;

INSERT INTO public.vehicle_legacy_mappings (
  canonical_vehicle_id,
  legacy_source,
  legacy_record_id,
  legacy_registration,
  match_method,
  match_confidence,
  migration_status
)
SELECT
  id,
  'vehicle_profiles',
  id::text,
  license_plate,
  'canonical_source',
  100,
  CASE
    WHEN count(*) OVER (PARTITION BY license_plate_normalized) = 1 THEN 'mapped'
    ELSE 'review_required'
  END
FROM public.vehicle_profiles
ON CONFLICT (legacy_source, legacy_record_id) DO NOTHING;

-- Create canonical vehicles from unambiguous fleet_vehicles records.
WITH fleet_source AS (
  SELECT
    fv.*,
    public.normalize_vehicle_registration(fv.registration_number) AS normalized_registration,
    count(*) OVER (
      PARTITION BY public.normalize_vehicle_registration(fv.registration_number)
    ) AS registration_count
  FROM public.fleet_vehicles fv
), unique_fleet AS (
  SELECT *
  FROM fleet_source
  WHERE normalized_registration IS NOT NULL
    AND registration_count = 1
)
INSERT INTO public.vehicle_profiles (
  vehicle_name,
  vehicle_type,
  make,
  model,
  license_plate,
  license_plate_normalized,
  wheelchair_accessible,
  ramp_or_lift_available,
  passenger_capacity,
  wheelchair_capacity,
  accessibility_features,
  status,
  legacy_consolidation_status
)
SELECT
  trim(COALESCE(NULLIF(concat_ws(' ', uf.make, uf.model), ''), 'Fleet vehicle') || ' · ' || upper(trim(uf.registration_number))),
  NULL,
  uf.make,
  uf.model,
  upper(trim(uf.registration_number)),
  uf.normalized_registration,
  uf.wheelchair_capacity > 0,
  COALESCE((uf.accessibility_features ? 'ramp') OR (uf.accessibility_features ? 'lift'), false),
  uf.passenger_capacity,
  uf.wheelchair_capacity,
  uf.accessibility_features,
  uf.operational_status::text,
  'legacy_created'
FROM unique_fleet uf
WHERE NOT EXISTS (
  SELECT 1
  FROM public.vehicle_profiles vp
  WHERE vp.license_plate_normalized = uf.normalized_registration
)
ON CONFLICT (license_plate) DO NOTHING;

WITH canonical_counts AS (
  SELECT license_plate_normalized, min(id) AS canonical_vehicle_id, count(*) AS canonical_count
  FROM public.vehicle_profiles
  WHERE license_plate_normalized IS NOT NULL
  GROUP BY license_plate_normalized
)
INSERT INTO public.vehicle_legacy_mappings (
  canonical_vehicle_id,
  legacy_source,
  legacy_record_id,
  legacy_registration,
  match_method,
  match_confidence,
  migration_status
)
SELECT
  cc.canonical_vehicle_id,
  'fleet_vehicles',
  fv.id::text,
  fv.registration_number,
  'normalised_registration',
  100,
  CASE WHEN cc.canonical_count = 1 THEN 'mapped' ELSE 'review_required' END
FROM public.fleet_vehicles fv
JOIN canonical_counts cc
  ON cc.license_plate_normalized = public.normalize_vehicle_registration(fv.registration_number)
ON CONFLICT (legacy_source, legacy_record_id) DO NOTHING;

-- Enrich missing canonical values from the unambiguous legacy fleet source.
UPDATE public.vehicle_profiles vp
SET make = COALESCE(vp.make, fv.make),
    model = COALESCE(vp.model, fv.model),
    passenger_capacity = COALESCE(vp.passenger_capacity, fv.passenger_capacity),
    wheelchair_capacity = COALESCE(vp.wheelchair_capacity, fv.wheelchair_capacity),
    wheelchair_accessible = vp.wheelchair_accessible OR fv.wheelchair_capacity > 0,
    ramp_or_lift_available = vp.ramp_or_lift_available
      OR COALESCE((fv.accessibility_features ? 'ramp') OR (fv.accessibility_features ? 'lift'), false),
    accessibility_features = CASE
      WHEN vp.accessibility_features = '[]'::jsonb THEN fv.accessibility_features
      ELSE vp.accessibility_features
    END,
    legacy_consolidation_status = CASE
      WHEN vp.legacy_consolidation_status = 'pending' THEN 'mapped'
      ELSE vp.legacy_consolidation_status
    END
FROM public.vehicle_legacy_mappings mapping
JOIN public.fleet_vehicles fv
  ON mapping.legacy_source = 'fleet_vehicles'
 AND mapping.legacy_record_id = fv.id::text
WHERE mapping.canonical_vehicle_id = vp.id
  AND mapping.migration_status = 'mapped';

-- Create canonical vehicles from unambiguous driver profile registrations that
-- did not exist in either canonical source.
WITH driver_source AS (
  SELECT
    dp.*,
    public.normalize_vehicle_registration(dp.license_plate) AS normalized_registration,
    count(*) OVER (
      PARTITION BY public.normalize_vehicle_registration(dp.license_plate)
    ) AS registration_count
  FROM public.driver_profiles dp
  WHERE dp.license_plate IS NOT NULL
), unique_driver AS (
  SELECT *
  FROM driver_source
  WHERE normalized_registration IS NOT NULL
    AND registration_count = 1
)
INSERT INTO public.vehicle_profiles (
  vehicle_name,
  vehicle_type,
  model,
  license_plate,
  license_plate_normalized,
  legacy_consolidation_status
)
SELECT
  trim(COALESCE(NULLIF(ud.vehicle_model, ''), NULLIF(ud.vehicle_type, ''), 'Driver vehicle') || ' · ' || upper(trim(ud.license_plate))),
  ud.vehicle_type,
  ud.vehicle_model,
  upper(trim(ud.license_plate)),
  ud.normalized_registration,
  'legacy_created'
FROM unique_driver ud
WHERE NOT EXISTS (
  SELECT 1
  FROM public.vehicle_profiles vp
  WHERE vp.license_plate_normalized = ud.normalized_registration
)
ON CONFLICT (license_plate) DO NOTHING;

WITH canonical_counts AS (
  SELECT license_plate_normalized, min(id) AS canonical_vehicle_id, count(*) AS canonical_count
  FROM public.vehicle_profiles
  WHERE license_plate_normalized IS NOT NULL
  GROUP BY license_plate_normalized
)
INSERT INTO public.vehicle_legacy_mappings (
  canonical_vehicle_id,
  legacy_source,
  legacy_record_id,
  legacy_registration,
  match_method,
  match_confidence,
  migration_status,
  conflict_notes
)
SELECT
  cc.canonical_vehicle_id,
  'driver_profiles',
  dp.id::text,
  dp.license_plate,
  'normalised_registration',
  CASE WHEN cc.canonical_count = 1 THEN 90 ELSE 50 END,
  CASE WHEN cc.canonical_count = 1 THEN 'mapped' ELSE 'review_required' END,
  CASE WHEN cc.canonical_count = 1 THEN NULL ELSE 'Multiple canonical vehicles share this normalised registration' END
FROM public.driver_profiles dp
JOIN canonical_counts cc
  ON cc.license_plate_normalized = public.normalize_vehicle_registration(dp.license_plate)
WHERE dp.license_plate IS NOT NULL
ON CONFLICT (legacy_source, legacy_record_id) DO NOTHING;

INSERT INTO public.fleet_consolidation_issues (
  issue_type,
  source_table,
  source_record_id,
  registration_number,
  details
)
SELECT
  'driver_vehicle_without_registration',
  'driver_profiles',
  dp.id::text,
  dp.license_plate,
  jsonb_build_object('driver_id', dp.user_id, 'vehicle_type', dp.vehicle_type, 'vehicle_model', dp.vehicle_model)
FROM public.driver_profiles dp
WHERE NULLIF(trim(COALESCE(dp.license_plate, '')), '') IS NULL
  AND (dp.vehicle_type IS NOT NULL OR dp.vehicle_model IS NOT NULL)
ON CONFLICT DO NOTHING;

-- Canonical booking and support links.
ALTER TABLE public.booking_vehicle_assignments
  ADD COLUMN IF NOT EXISTS vehicle_id uuid REFERENCES public.vehicle_profiles(id) ON DELETE SET NULL;
ALTER TABLE public.booking_vehicle_assignments
  ALTER COLUMN fleet_vehicle_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS booking_vehicle_assignments_canonical_vehicle_idx
  ON public.booking_vehicle_assignments(vehicle_id);

UPDATE public.booking_vehicle_assignments assignment
SET vehicle_id = mapping.canonical_vehicle_id
FROM public.vehicle_legacy_mappings mapping
WHERE assignment.vehicle_id IS NULL
  AND assignment.fleet_vehicle_id IS NOT NULL
  AND mapping.legacy_source = 'fleet_vehicles'
  AND mapping.legacy_record_id = assignment.fleet_vehicle_id::text
  AND mapping.migration_status = 'mapped';

ALTER TABLE public.booking_vehicle_assignments
  DROP CONSTRAINT IF EXISTS booking_vehicle_assignment_has_vehicle;
ALTER TABLE public.booking_vehicle_assignments
  ADD CONSTRAINT booking_vehicle_assignment_has_vehicle
  CHECK (vehicle_id IS NOT NULL OR fleet_vehicle_id IS NOT NULL) NOT VALID;

INSERT INTO public.fleet_consolidation_issues (
  issue_type, source_table, source_record_id, details
)
SELECT
  'unmapped_booking_vehicle_assignment',
  'booking_vehicle_assignments',
  assignment.id::text,
  jsonb_build_object(
    'booking_id', assignment.booking_id,
    'fleet_vehicle_id', assignment.fleet_vehicle_id,
    'status', assignment.status
  )
FROM public.booking_vehicle_assignments assignment
WHERE assignment.vehicle_id IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS vehicle_id uuid REFERENCES public.vehicle_profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS support_tickets_vehicle_id_idx
  ON public.support_tickets(vehicle_id);

-- Fleet operation idempotency.
CREATE TABLE IF NOT EXISTS public.fleet_operation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  operation_type text NOT NULL,
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Effective driver-to-vehicle assignment history.
CREATE TABLE IF NOT EXISTS public.vehicle_driver_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicle_profiles(id) ON DELETE RESTRICT,
  driver_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  assignment_type text NOT NULL DEFAULT 'primary'
    CHECK (assignment_type IN ('primary', 'shift', 'temporary', 'trip_specific', 'replacement')),
  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'active', 'completed', 'cancelled')),
  start_at timestamptz NOT NULL DEFAULT now(),
  end_at timestamptz,
  assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ended_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assignment_reason text,
  notes text,
  source text NOT NULL DEFAULT 'admin'
    CHECK (source IN ('admin', 'legacy_migration', 'ride_assignment', 'booking_assignment')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_at IS NULL OR end_at > start_at)
);

CREATE INDEX IF NOT EXISTS vehicle_driver_assignments_vehicle_idx
  ON public.vehicle_driver_assignments(vehicle_id, start_at, end_at);
CREATE INDEX IF NOT EXISTS vehicle_driver_assignments_driver_idx
  ON public.vehicle_driver_assignments(driver_id, start_at, end_at);
CREATE INDEX IF NOT EXISTS vehicle_driver_assignments_status_idx
  ON public.vehicle_driver_assignments(status, start_at);

DROP TRIGGER IF EXISTS set_vehicle_driver_assignments_updated_at
  ON public.vehicle_driver_assignments;
CREATE TRIGGER set_vehicle_driver_assignments_updated_at
  BEFORE UPDATE ON public.vehicle_driver_assignments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.enforce_vehicle_driver_assignment_overlap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_vehicle_status text;
BEGIN
  IF NEW.end_at IS NOT NULL AND NEW.end_at <= NEW.start_at THEN
    RAISE EXCEPTION 'Assignment end must be after its start';
  END IF;

  IF NEW.status NOT IN ('scheduled', 'active') THEN
    RETURN NEW;
  END IF;

  IF NOT private.has_role(NEW.driver_id, 'driver'::app_role) THEN
    RAISE EXCEPTION 'Assigned user does not have the driver role';
  END IF;

  SELECT status INTO v_vehicle_status
  FROM public.vehicle_profiles
  WHERE id = NEW.vehicle_id;

  IF v_vehicle_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Only active vehicles may be assigned';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.vehicle_driver_assignments existing
    WHERE existing.id <> NEW.id
      AND existing.status IN ('scheduled', 'active')
      AND existing.vehicle_id = NEW.vehicle_id
      AND COALESCE(existing.end_at, 'infinity'::timestamptz) > NEW.start_at
      AND COALESCE(NEW.end_at, 'infinity'::timestamptz) > existing.start_at
  ) THEN
    RAISE EXCEPTION 'Vehicle already has an overlapping assignment';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.vehicle_driver_assignments existing
    WHERE existing.id <> NEW.id
      AND existing.status IN ('scheduled', 'active')
      AND existing.driver_id = NEW.driver_id
      AND COALESCE(existing.end_at, 'infinity'::timestamptz) > NEW.start_at
      AND COALESCE(NEW.end_at, 'infinity'::timestamptz) > existing.start_at
  ) THEN
    RAISE EXCEPTION 'Driver already has an overlapping vehicle assignment';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS vehicle_driver_assignment_overlap_trigger
  ON public.vehicle_driver_assignments;
CREATE TRIGGER vehicle_driver_assignment_overlap_trigger
  BEFORE INSERT OR UPDATE ON public.vehicle_driver_assignments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_vehicle_driver_assignment_overlap();

CREATE OR REPLACE FUNCTION public.refresh_vehicle_assignment_compatibility(
  p_vehicle_id uuid,
  p_driver_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver_id uuid;
BEGIN
  SELECT assignment.driver_id
  INTO v_driver_id
  FROM public.vehicle_driver_assignments assignment
  WHERE assignment.vehicle_id = p_vehicle_id
    AND assignment.status = 'active'
    AND assignment.start_at <= now()
    AND (assignment.end_at IS NULL OR assignment.end_at > now())
  ORDER BY assignment.start_at DESC
  LIMIT 1;

  UPDATE public.vehicle_profiles
  SET assigned_driver_id = v_driver_id
  WHERE id = p_vehicle_id;

  IF v_driver_id IS NOT NULL THEN
    UPDATE public.driver_profiles driver
    SET vehicle_type = vehicle.vehicle_type,
        vehicle_model = COALESCE(vehicle.model, vehicle.vehicle_name),
        license_plate = vehicle.license_plate
    FROM public.vehicle_profiles vehicle
    WHERE vehicle.id = p_vehicle_id
      AND driver.user_id = v_driver_id;
  END IF;

  IF p_driver_id IS NOT NULL
     AND p_driver_id IS DISTINCT FROM v_driver_id
     AND NOT EXISTS (
       SELECT 1
       FROM public.vehicle_driver_assignments assignment
       WHERE assignment.driver_id = p_driver_id
         AND assignment.status = 'active'
         AND assignment.start_at <= now()
         AND (assignment.end_at IS NULL OR assignment.end_at > now())
     ) THEN
    UPDATE public.driver_profiles
    SET vehicle_type = NULL,
        vehicle_model = NULL,
        license_plate = NULL
    WHERE user_id = p_driver_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.vehicle_assignment_compatibility_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_vehicle_assignment_compatibility(OLD.vehicle_id, OLD.driver_id);
    RETURN OLD;
  END IF;

  PERFORM public.refresh_vehicle_assignment_compatibility(NEW.vehicle_id, NEW.driver_id);

  IF TG_OP = 'UPDATE' AND OLD.vehicle_id IS DISTINCT FROM NEW.vehicle_id THEN
    PERFORM public.refresh_vehicle_assignment_compatibility(OLD.vehicle_id, OLD.driver_id);
  ELSIF TG_OP = 'UPDATE' AND OLD.driver_id IS DISTINCT FROM NEW.driver_id THEN
    PERFORM public.refresh_vehicle_assignment_compatibility(OLD.vehicle_id, OLD.driver_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS vehicle_assignment_compatibility_after_change
  ON public.vehicle_driver_assignments;
CREATE TRIGGER vehicle_assignment_compatibility_after_change
  AFTER INSERT OR UPDATE OR DELETE ON public.vehicle_driver_assignments
  FOR EACH ROW EXECUTE FUNCTION public.vehicle_assignment_compatibility_trigger();

-- Backfill only unambiguous legacy assignments. Historical accuracy is limited
-- to the migration timestamp and is recorded as such.
INSERT INTO public.vehicle_driver_assignments (
  vehicle_id,
  driver_id,
  assignment_type,
  status,
  start_at,
  assignment_reason,
  notes,
  source
)
SELECT
  vehicle.id,
  vehicle.assigned_driver_id,
  'primary',
  'active',
  now(),
  'Legacy assigned_driver_id backfill',
  'Backfilled during Phase 3; historical start time was not available.',
  'legacy_migration'
FROM public.vehicle_profiles vehicle
WHERE vehicle.assigned_driver_id IS NOT NULL
  AND vehicle.status = 'active'
  AND NOT EXISTS (
    SELECT 1
    FROM public.vehicle_driver_assignments assignment
    WHERE assignment.vehicle_id = vehicle.id
      AND assignment.status IN ('scheduled', 'active')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.vehicle_driver_assignments assignment
    WHERE assignment.driver_id = vehicle.assigned_driver_id
      AND assignment.status IN ('scheduled', 'active')
  )
ON CONFLICT DO NOTHING;

WITH unambiguous_driver_vehicle AS (
  SELECT
    mapping.canonical_vehicle_id,
    driver.user_id AS driver_id,
    count(*) OVER (PARTITION BY driver.user_id) AS driver_match_count,
    count(*) OVER (PARTITION BY mapping.canonical_vehicle_id) AS vehicle_match_count
  FROM public.driver_profiles driver
  JOIN public.vehicle_legacy_mappings mapping
    ON mapping.legacy_source = 'driver_profiles'
   AND mapping.legacy_record_id = driver.id::text
   AND mapping.migration_status = 'mapped'
)
INSERT INTO public.vehicle_driver_assignments (
  vehicle_id,
  driver_id,
  assignment_type,
  status,
  start_at,
  assignment_reason,
  notes,
  source
)
SELECT
  candidate.canonical_vehicle_id,
  candidate.driver_id,
  'primary',
  'active',
  now(),
  'Legacy driver profile registration backfill',
  'Backfilled during Phase 3; historical start time was not available.',
  'legacy_migration'
FROM unambiguous_driver_vehicle candidate
JOIN public.vehicle_profiles vehicle ON vehicle.id = candidate.canonical_vehicle_id
WHERE candidate.driver_match_count = 1
  AND candidate.vehicle_match_count = 1
  AND vehicle.status = 'active'
  AND NOT EXISTS (
    SELECT 1
    FROM public.vehicle_driver_assignments assignment
    WHERE assignment.driver_id = candidate.driver_id
      AND assignment.status IN ('scheduled', 'active')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.vehicle_driver_assignments assignment
    WHERE assignment.vehicle_id = candidate.canonical_vehicle_id
      AND assignment.status IN ('scheduled', 'active')
  )
ON CONFLICT DO NOTHING;

-- Documents and compliance.
CREATE TABLE IF NOT EXISTS public.vehicle_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicle_profiles(id) ON DELETE CASCADE,
  document_type text NOT NULL CHECK (document_type IN ('roadworthy', 'license_disc', 'insurance', 'registration', 'permit', 'other')),
  document_number text,
  issued_at date,
  expires_at date,
  storage_path text,
  status text NOT NULL DEFAULT 'current' CHECK (status IN ('current', 'expired', 'replaced', 'removed')),
  is_current boolean NOT NULL DEFAULT true,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS vehicle_documents_one_current_type_idx
  ON public.vehicle_documents(vehicle_id, document_type)
  WHERE is_current AND status = 'current';
CREATE INDEX IF NOT EXISTS vehicle_documents_expiry_idx
  ON public.vehicle_documents(expires_at) WHERE is_current;
DROP TRIGGER IF EXISTS set_vehicle_documents_updated_at ON public.vehicle_documents;
CREATE TRIGGER set_vehicle_documents_updated_at
  BEFORE UPDATE ON public.vehicle_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Maintenance work orders.
CREATE TABLE IF NOT EXISTS public.vehicle_maintenance_work_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicle_profiles(id) ON DELETE RESTRICT,
  support_ticket_id uuid REFERENCES public.support_tickets(id) ON DELETE SET NULL,
  work_order_reference text NOT NULL UNIQUE DEFAULT ('MWO-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  maintenance_type text NOT NULL CHECK (maintenance_type IN ('scheduled_service', 'repair', 'inspection', 'tyres', 'brakes', 'accessibility_equipment', 'ramp_or_lift', 'electrical', 'bodywork', 'roadworthy', 'other')),
  severity text NOT NULL DEFAULT 'routine' CHECK (severity IN ('routine', 'attention', 'urgent', 'unsafe')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'scheduled', 'in_progress', 'waiting_for_parts', 'completed', 'cancelled')),
  reported_at timestamptz NOT NULL DEFAULT now(),
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  odometer_at_report numeric,
  odometer_at_completion numeric,
  service_provider text,
  description text NOT NULL,
  diagnosis text,
  work_performed text,
  outcome text,
  next_service_due_date date,
  next_service_due_km numeric,
  estimated_cost numeric(12,2),
  actual_cost numeric(12,2),
  reported_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vehicle_maintenance_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid NOT NULL REFERENCES public.vehicle_maintenance_work_orders(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  previous_value jsonb,
  new_value jsonb,
  performed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vehicle_maintenance_work_orders_vehicle_idx
  ON public.vehicle_maintenance_work_orders(vehicle_id, status);
CREATE INDEX IF NOT EXISTS vehicle_maintenance_work_orders_status_idx
  ON public.vehicle_maintenance_work_orders(status, severity, scheduled_at);
DROP TRIGGER IF EXISTS set_vehicle_maintenance_work_orders_updated_at
  ON public.vehicle_maintenance_work_orders;
CREATE TRIGGER set_vehicle_maintenance_work_orders_updated_at
  BEFORE UPDATE ON public.vehicle_maintenance_work_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Odometer and status history.
CREATE TABLE IF NOT EXISTS public.vehicle_odometer_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicle_profiles(id) ON DELETE CASCADE,
  odometer_km numeric NOT NULL CHECK (odometer_km >= 0),
  source text NOT NULL CHECK (source IN ('admin', 'ride_completion', 'maintenance', 'correction', 'legacy_migration')),
  ride_id uuid REFERENCES public.rides(id) ON DELETE SET NULL,
  work_order_id uuid REFERENCES public.vehicle_maintenance_work_orders(id) ON DELETE SET NULL,
  recorded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  notes text
);

CREATE TABLE IF NOT EXISTS public.vehicle_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicle_profiles(id) ON DELETE CASCADE,
  previous_status text,
  new_status text NOT NULL CHECK (new_status IN ('active', 'maintenance', 'out_of_service', 'retired')),
  reason text NOT NULL,
  work_order_id uuid REFERENCES public.vehicle_maintenance_work_orders(id) ON DELETE SET NULL,
  performed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vehicle_odometer_events_vehicle_idx
  ON public.vehicle_odometer_events(vehicle_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS vehicle_status_events_vehicle_idx
  ON public.vehicle_status_events(vehicle_id, created_at DESC);

INSERT INTO public.vehicle_odometer_events (
  vehicle_id, odometer_km, source, notes
)
SELECT
  id,
  current_odometer_km,
  'legacy_migration',
  'Initial Phase 3 odometer baseline.'
FROM public.vehicle_profiles vehicle
WHERE NOT EXISTS (
  SELECT 1 FROM public.vehicle_odometer_events event WHERE event.vehicle_id = vehicle.id
);

INSERT INTO public.vehicle_status_events (
  vehicle_id, previous_status, new_status, reason
)
SELECT
  id,
  NULL,
  status,
  'Initial Phase 3 status baseline.'
FROM public.vehicle_profiles vehicle
WHERE NOT EXISTS (
  SELECT 1 FROM public.vehicle_status_events event WHERE event.vehicle_id = vehicle.id
);

-- Protected operations.
CREATE OR REPLACE FUNCTION public.admin_create_vehicle(
  p_vehicle_name text,
  p_license_plate text,
  p_vehicle_type text DEFAULT NULL,
  p_make text DEFAULT NULL,
  p_model text DEFAULT NULL,
  p_year integer DEFAULT NULL,
  p_vin_number text DEFAULT NULL,
  p_passenger_capacity integer DEFAULT NULL,
  p_wheelchair_accessible boolean DEFAULT false,
  p_wheelchair_capacity integer DEFAULT NULL,
  p_ramp_or_lift_available boolean DEFAULT false,
  p_accessibility_features jsonb DEFAULT '[]'::jsonb,
  p_service_interval_km numeric DEFAULT 10000,
  p_admin_notes text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_actor uuid := public.fleet_require_admin();
  v_vehicle public.vehicle_profiles%ROWTYPE;
  v_result jsonb;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    SELECT result INTO v_result
    FROM public.fleet_operation_requests
    WHERE idempotency_key = p_idempotency_key
      AND operation_type = 'create_vehicle'
      AND actor_id = v_actor;
    IF v_result IS NOT NULL THEN RETURN v_result; END IF;
  END IF;

  INSERT INTO public.vehicle_profiles (
    vehicle_name,
    vehicle_type,
    make,
    model,
    year,
    license_plate,
    vin_number,
    passenger_capacity,
    wheelchair_accessible,
    wheelchair_capacity,
    ramp_or_lift_available,
    accessibility_features,
    service_interval_km,
    admin_notes,
    status,
    legacy_consolidation_status
  ) VALUES (
    trim(p_vehicle_name),
    NULLIF(trim(p_vehicle_type), ''),
    NULLIF(trim(p_make), ''),
    NULLIF(trim(p_model), ''),
    p_year,
    p_license_plate,
    NULLIF(trim(p_vin_number), ''),
    p_passenger_capacity,
    p_wheelchair_accessible,
    p_wheelchair_capacity,
    p_ramp_or_lift_available,
    COALESCE(p_accessibility_features, '[]'::jsonb),
    COALESCE(p_service_interval_km, 10000),
    NULLIF(trim(p_admin_notes), ''),
    'active',
    'canonical'
  ) RETURNING * INTO v_vehicle;

  INSERT INTO public.vehicle_status_events (
    vehicle_id, previous_status, new_status, reason, performed_by
  ) VALUES (
    v_vehicle.id, NULL, 'active', 'Vehicle created', v_actor
  );

  v_result := to_jsonb(v_vehicle);
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.fleet_operation_requests (
      idempotency_key, operation_type, actor_id, result
    ) VALUES (
      p_idempotency_key, 'create_vehicle', v_actor, v_result
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_vehicle(
  p_vehicle_id uuid,
  p_expected_updated_at timestamptz DEFAULT NULL,
  p_vehicle_name text DEFAULT NULL,
  p_vehicle_type text DEFAULT NULL,
  p_make text DEFAULT NULL,
  p_model text DEFAULT NULL,
  p_year integer DEFAULT NULL,
  p_vin_number text DEFAULT NULL,
  p_license_plate text DEFAULT NULL,
  p_passenger_capacity integer DEFAULT NULL,
  p_wheelchair_accessible boolean DEFAULT NULL,
  p_wheelchair_capacity integer DEFAULT NULL,
  p_ramp_or_lift_available boolean DEFAULT NULL,
  p_accessibility_features jsonb DEFAULT NULL,
  p_service_interval_km numeric DEFAULT NULL,
  p_admin_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_actor uuid := public.fleet_require_admin();
  v_vehicle public.vehicle_profiles%ROWTYPE;
BEGIN
  SELECT * INTO v_vehicle
  FROM public.vehicle_profiles
  WHERE id = p_vehicle_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Vehicle not found'; END IF;
  IF p_expected_updated_at IS NOT NULL AND v_vehicle.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Vehicle changed since it was loaded';
  END IF;

  UPDATE public.vehicle_profiles
  SET vehicle_name = COALESCE(NULLIF(trim(p_vehicle_name), ''), vehicle_name),
      vehicle_type = CASE WHEN p_vehicle_type IS NULL THEN vehicle_type ELSE NULLIF(trim(p_vehicle_type), '') END,
      make = CASE WHEN p_make IS NULL THEN make ELSE NULLIF(trim(p_make), '') END,
      model = CASE WHEN p_model IS NULL THEN model ELSE NULLIF(trim(p_model), '') END,
      year = COALESCE(p_year, year),
      vin_number = CASE WHEN p_vin_number IS NULL THEN vin_number ELSE NULLIF(trim(p_vin_number), '') END,
      license_plate = COALESCE(NULLIF(trim(p_license_plate), ''), license_plate),
      passenger_capacity = COALESCE(p_passenger_capacity, passenger_capacity),
      wheelchair_accessible = COALESCE(p_wheelchair_accessible, wheelchair_accessible),
      wheelchair_capacity = COALESCE(p_wheelchair_capacity, wheelchair_capacity),
      ramp_or_lift_available = COALESCE(p_ramp_or_lift_available, ramp_or_lift_available),
      accessibility_features = COALESCE(p_accessibility_features, accessibility_features),
      service_interval_km = COALESCE(p_service_interval_km, service_interval_km),
      admin_notes = CASE WHEN p_admin_notes IS NULL THEN admin_notes ELSE NULLIF(trim(p_admin_notes), '') END,
      legacy_consolidation_status = 'canonical'
  WHERE id = p_vehicle_id
  RETURNING * INTO v_vehicle;

  RETURN to_jsonb(v_vehicle) || jsonb_build_object('updated_by', v_actor);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_change_vehicle_status(
  p_vehicle_id uuid,
  p_new_status text,
  p_reason text,
  p_expected_status text DEFAULT NULL,
  p_work_order_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_actor uuid := public.fleet_require_admin();
  v_vehicle public.vehicle_profiles%ROWTYPE;
BEGIN
  IF p_new_status NOT IN ('active', 'maintenance', 'out_of_service', 'retired') THEN
    RAISE EXCEPTION 'Invalid vehicle status';
  END IF;
  IF NULLIF(trim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A status-change reason is required';
  END IF;

  SELECT * INTO v_vehicle
  FROM public.vehicle_profiles
  WHERE id = p_vehicle_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Vehicle not found'; END IF;
  IF p_expected_status IS NOT NULL AND v_vehicle.status IS DISTINCT FROM p_expected_status THEN
    RAISE EXCEPTION 'Vehicle status changed since it was loaded';
  END IF;

  IF p_new_status <> 'active' AND EXISTS (
    SELECT 1
    FROM public.vehicle_driver_assignments assignment
    WHERE assignment.vehicle_id = p_vehicle_id
      AND assignment.status IN ('scheduled', 'active')
      AND (assignment.end_at IS NULL OR assignment.end_at > now())
  ) THEN
    UPDATE public.vehicle_driver_assignments
    SET status = CASE WHEN start_at > now() THEN 'cancelled' ELSE 'completed' END,
        end_at = COALESCE(end_at, now()),
        ended_by = v_actor,
        notes = concat_ws(E'\n', notes, 'Ended automatically because vehicle status changed to ' || p_new_status)
    WHERE vehicle_id = p_vehicle_id
      AND status IN ('scheduled', 'active')
      AND (end_at IS NULL OR end_at > now());
  END IF;

  UPDATE public.vehicle_profiles
  SET status = p_new_status
  WHERE id = p_vehicle_id
  RETURNING * INTO v_vehicle;

  INSERT INTO public.vehicle_status_events (
    vehicle_id, previous_status, new_status, reason, work_order_id, performed_by
  ) VALUES (
    p_vehicle_id, v_vehicle.status, p_new_status, trim(p_reason), p_work_order_id, v_actor
  );

  RETURN to_jsonb(v_vehicle);
END;
$$;

-- Correct the previous-status event value after the row update above.
CREATE OR REPLACE FUNCTION public.admin_change_vehicle_status(
  p_vehicle_id uuid,
  p_new_status text,
  p_reason text,
  p_expected_status text DEFAULT NULL,
  p_work_order_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_actor uuid := public.fleet_require_admin();
  v_vehicle public.vehicle_profiles%ROWTYPE;
  v_previous_status text;
BEGIN
  IF p_new_status NOT IN ('active', 'maintenance', 'out_of_service', 'retired') THEN
    RAISE EXCEPTION 'Invalid vehicle status';
  END IF;
  IF NULLIF(trim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A status-change reason is required';
  END IF;

  SELECT * INTO v_vehicle
  FROM public.vehicle_profiles
  WHERE id = p_vehicle_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Vehicle not found'; END IF;
  v_previous_status := v_vehicle.status;
  IF p_expected_status IS NOT NULL AND v_previous_status IS DISTINCT FROM p_expected_status THEN
    RAISE EXCEPTION 'Vehicle status changed since it was loaded';
  END IF;

  IF p_new_status <> 'active' AND EXISTS (
    SELECT 1
    FROM public.vehicle_driver_assignments assignment
    WHERE assignment.vehicle_id = p_vehicle_id
      AND assignment.status IN ('scheduled', 'active')
      AND (assignment.end_at IS NULL OR assignment.end_at > now())
  ) THEN
    UPDATE public.vehicle_driver_assignments
    SET status = CASE WHEN start_at > now() THEN 'cancelled' ELSE 'completed' END,
        end_at = COALESCE(end_at, now()),
        ended_by = v_actor,
        notes = concat_ws(E'\n', notes, 'Ended automatically because vehicle status changed to ' || p_new_status)
    WHERE vehicle_id = p_vehicle_id
      AND status IN ('scheduled', 'active')
      AND (end_at IS NULL OR end_at > now());
  END IF;

  UPDATE public.vehicle_profiles
  SET status = p_new_status
  WHERE id = p_vehicle_id
  RETURNING * INTO v_vehicle;

  IF v_previous_status IS DISTINCT FROM p_new_status THEN
    INSERT INTO public.vehicle_status_events (
      vehicle_id, previous_status, new_status, reason, work_order_id, performed_by
    ) VALUES (
      p_vehicle_id, v_previous_status, p_new_status, trim(p_reason), p_work_order_id, v_actor
    );
  END IF;

  RETURN to_jsonb(v_vehicle);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_assign_driver_vehicle(
  p_vehicle_id uuid,
  p_driver_id uuid,
  p_assignment_type text DEFAULT 'primary',
  p_start_at timestamptz DEFAULT now(),
  p_end_at timestamptz DEFAULT NULL,
  p_assignment_reason text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_source text DEFAULT 'admin',
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_actor uuid := public.fleet_require_admin();
  v_assignment public.vehicle_driver_assignments%ROWTYPE;
  v_result jsonb;
  v_status text;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    SELECT result INTO v_result
    FROM public.fleet_operation_requests
    WHERE idempotency_key = p_idempotency_key
      AND operation_type = 'assign_driver_vehicle'
      AND actor_id = v_actor;
    IF v_result IS NOT NULL THEN RETURN v_result; END IF;
  END IF;

  SELECT status INTO v_status
  FROM public.vehicle_profiles
  WHERE id = p_vehicle_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Vehicle not found'; END IF;
  IF v_status <> 'active' THEN RAISE EXCEPTION 'Vehicle is not active'; END IF;

  INSERT INTO public.vehicle_driver_assignments (
    vehicle_id,
    driver_id,
    assignment_type,
    status,
    start_at,
    end_at,
    assigned_by,
    assignment_reason,
    notes,
    source
  ) VALUES (
    p_vehicle_id,
    p_driver_id,
    p_assignment_type,
    CASE WHEN p_start_at <= now() THEN 'active' ELSE 'scheduled' END,
    p_start_at,
    p_end_at,
    v_actor,
    NULLIF(trim(p_assignment_reason), ''),
    NULLIF(trim(p_notes), ''),
    p_source
  ) RETURNING * INTO v_assignment;

  v_result := to_jsonb(v_assignment);
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.fleet_operation_requests (
      idempotency_key, operation_type, actor_id, result
    ) VALUES (
      p_idempotency_key, 'assign_driver_vehicle', v_actor, v_result
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_end_vehicle_assignment(
  p_assignment_id uuid,
  p_reason text,
  p_expected_status text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_actor uuid := public.fleet_require_admin();
  v_assignment public.vehicle_driver_assignments%ROWTYPE;
BEGIN
  SELECT * INTO v_assignment
  FROM public.vehicle_driver_assignments
  WHERE id = p_assignment_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Assignment not found'; END IF;
  IF p_expected_status IS NOT NULL AND v_assignment.status IS DISTINCT FROM p_expected_status THEN
    RAISE EXCEPTION 'Assignment changed since it was loaded';
  END IF;
  IF v_assignment.status IN ('completed', 'cancelled') THEN
    RETURN to_jsonb(v_assignment);
  END IF;

  UPDATE public.vehicle_driver_assignments
  SET status = CASE WHEN start_at > now() THEN 'cancelled' ELSE 'completed' END,
      end_at = COALESCE(end_at, now()),
      ended_by = v_actor,
      notes = concat_ws(E'\n', notes, NULLIF(trim(p_reason), ''))
  WHERE id = p_assignment_id
  RETURNING * INTO v_assignment;

  RETURN to_jsonb(v_assignment);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_record_vehicle_odometer(
  p_vehicle_id uuid,
  p_odometer_km numeric,
  p_source text DEFAULT 'admin',
  p_ride_id uuid DEFAULT NULL,
  p_work_order_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_allow_correction boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_actor uuid := public.fleet_require_admin();
  v_vehicle public.vehicle_profiles%ROWTYPE;
  v_event public.vehicle_odometer_events%ROWTYPE;
BEGIN
  SELECT * INTO v_vehicle
  FROM public.vehicle_profiles
  WHERE id = p_vehicle_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Vehicle not found'; END IF;

  IF p_odometer_km < v_vehicle.current_odometer_km AND NOT p_allow_correction THEN
    RAISE EXCEPTION 'Odometer values may not decrease';
  END IF;
  IF p_odometer_km < v_vehicle.current_odometer_km
     AND NULLIF(trim(COALESCE(p_notes, '')), '') IS NULL THEN
    RAISE EXCEPTION 'An odometer correction reason is required';
  END IF;

  INSERT INTO public.vehicle_odometer_events (
    vehicle_id,
    odometer_km,
    source,
    ride_id,
    work_order_id,
    recorded_by,
    notes
  ) VALUES (
    p_vehicle_id,
    p_odometer_km,
    CASE WHEN p_odometer_km < v_vehicle.current_odometer_km THEN 'correction' ELSE p_source END,
    p_ride_id,
    p_work_order_id,
    v_actor,
    NULLIF(trim(p_notes), '')
  ) RETURNING * INTO v_event;

  UPDATE public.vehicle_profiles
  SET current_odometer_km = p_odometer_km
  WHERE id = p_vehicle_id;

  RETURN to_jsonb(v_event);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_open_maintenance_work_order(
  p_vehicle_id uuid,
  p_maintenance_type text,
  p_severity text,
  p_description text,
  p_scheduled_at timestamptz DEFAULT NULL,
  p_odometer_at_report numeric DEFAULT NULL,
  p_service_provider text DEFAULT NULL,
  p_support_ticket_id uuid DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_actor uuid := public.fleet_require_admin();
  v_order public.vehicle_maintenance_work_orders%ROWTYPE;
  v_result jsonb;
  v_vehicle_status text;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    SELECT result INTO v_result
    FROM public.fleet_operation_requests
    WHERE idempotency_key = p_idempotency_key
      AND operation_type = 'open_maintenance'
      AND actor_id = v_actor;
    IF v_result IS NOT NULL THEN RETURN v_result; END IF;
  END IF;

  SELECT status INTO v_vehicle_status
  FROM public.vehicle_profiles
  WHERE id = p_vehicle_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Vehicle not found'; END IF;

  INSERT INTO public.vehicle_maintenance_work_orders (
    vehicle_id,
    support_ticket_id,
    maintenance_type,
    severity,
    status,
    scheduled_at,
    odometer_at_report,
    service_provider,
    description,
    reported_by,
    created_by,
    updated_by
  ) VALUES (
    p_vehicle_id,
    p_support_ticket_id,
    p_maintenance_type,
    p_severity,
    CASE WHEN p_scheduled_at IS NULL THEN 'open' ELSE 'scheduled' END,
    p_scheduled_at,
    COALESCE(p_odometer_at_report, (SELECT current_odometer_km FROM public.vehicle_profiles WHERE id = p_vehicle_id)),
    NULLIF(trim(p_service_provider), ''),
    trim(p_description),
    v_actor,
    v_actor,
    v_actor
  ) RETURNING * INTO v_order;

  INSERT INTO public.vehicle_maintenance_events (
    work_order_id, event_type, new_value, performed_by
  ) VALUES (
    v_order.id, 'created', to_jsonb(v_order), v_actor
  );

  IF p_severity IN ('urgent', 'unsafe') AND v_vehicle_status <> 'out_of_service' THEN
    PERFORM public.admin_change_vehicle_status(
      p_vehicle_id,
      'out_of_service',
      'Urgent or unsafe maintenance work order ' || v_order.work_order_reference,
      v_vehicle_status,
      v_order.id
    );
  END IF;

  v_result := to_jsonb(v_order);
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.fleet_operation_requests (
      idempotency_key, operation_type, actor_id, result
    ) VALUES (
      p_idempotency_key, 'open_maintenance', v_actor, v_result
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_transition_maintenance_work_order(
  p_work_order_id uuid,
  p_new_status text,
  p_expected_status text DEFAULT NULL,
  p_diagnosis text DEFAULT NULL,
  p_work_performed text DEFAULT NULL,
  p_outcome text DEFAULT NULL,
  p_odometer_at_completion numeric DEFAULT NULL,
  p_next_service_due_date date DEFAULT NULL,
  p_next_service_due_km numeric DEFAULT NULL,
  p_actual_cost numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_actor uuid := public.fleet_require_admin();
  v_order public.vehicle_maintenance_work_orders%ROWTYPE;
  v_previous jsonb;
  v_vehicle_status text;
BEGIN
  IF p_new_status NOT IN ('open', 'scheduled', 'in_progress', 'waiting_for_parts', 'completed', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid work-order status';
  END IF;

  SELECT * INTO v_order
  FROM public.vehicle_maintenance_work_orders
  WHERE id = p_work_order_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Work order not found'; END IF;
  IF p_expected_status IS NOT NULL AND v_order.status IS DISTINCT FROM p_expected_status THEN
    RAISE EXCEPTION 'Work order changed since it was loaded';
  END IF;
  v_previous := to_jsonb(v_order);

  IF p_new_status = 'completed'
     AND (NULLIF(trim(COALESCE(p_work_performed, v_order.work_performed, '')), '') IS NULL
       OR NULLIF(trim(COALESCE(p_outcome, v_order.outcome, '')), '') IS NULL) THEN
    RAISE EXCEPTION 'Work performed and outcome are required to complete maintenance';
  END IF;

  UPDATE public.vehicle_maintenance_work_orders
  SET status = p_new_status,
      started_at = CASE WHEN p_new_status = 'in_progress' THEN COALESCE(started_at, now()) ELSE started_at END,
      completed_at = CASE WHEN p_new_status = 'completed' THEN COALESCE(completed_at, now()) ELSE completed_at END,
      cancelled_at = CASE WHEN p_new_status = 'cancelled' THEN COALESCE(cancelled_at, now()) ELSE cancelled_at END,
      diagnosis = COALESCE(NULLIF(trim(p_diagnosis), ''), diagnosis),
      work_performed = COALESCE(NULLIF(trim(p_work_performed), ''), work_performed),
      outcome = COALESCE(NULLIF(trim(p_outcome), ''), outcome),
      odometer_at_completion = COALESCE(p_odometer_at_completion, odometer_at_completion),
      next_service_due_date = COALESCE(p_next_service_due_date, next_service_due_date),
      next_service_due_km = COALESCE(p_next_service_due_km, next_service_due_km),
      actual_cost = COALESCE(p_actual_cost, actual_cost),
      updated_by = v_actor
  WHERE id = p_work_order_id
  RETURNING * INTO v_order;

  INSERT INTO public.vehicle_maintenance_events (
    work_order_id, event_type, previous_value, new_value, performed_by
  ) VALUES (
    p_work_order_id, 'status_changed', v_previous, to_jsonb(v_order), v_actor
  );

  SELECT status INTO v_vehicle_status
  FROM public.vehicle_profiles
  WHERE id = v_order.vehicle_id
  FOR UPDATE;

  IF p_new_status = 'in_progress' AND v_vehicle_status <> 'maintenance' THEN
    PERFORM public.admin_change_vehicle_status(
      v_order.vehicle_id,
      'maintenance',
      'Maintenance started for ' || v_order.work_order_reference,
      v_vehicle_status,
      v_order.id
    );
  ELSIF p_new_status = 'completed' THEN
    IF v_order.odometer_at_completion IS NOT NULL THEN
      PERFORM public.admin_record_vehicle_odometer(
        v_order.vehicle_id,
        v_order.odometer_at_completion,
        'maintenance',
        NULL,
        v_order.id,
        'Maintenance completion ' || v_order.work_order_reference,
        false
      );
    END IF;

    UPDATE public.vehicle_profiles
    SET last_service_date = COALESCE(v_order.completed_at::date, current_date),
        last_service_km = COALESCE(v_order.odometer_at_completion, current_odometer_km),
        next_service_due_km = COALESCE(v_order.next_service_due_km, next_service_due_km)
    WHERE id = v_order.vehicle_id
      AND v_order.maintenance_type = 'scheduled_service';

    SELECT status INTO v_vehicle_status
    FROM public.vehicle_profiles
    WHERE id = v_order.vehicle_id;
    IF v_vehicle_status IN ('maintenance', 'out_of_service') THEN
      PERFORM public.admin_change_vehicle_status(
        v_order.vehicle_id,
        'active',
        'Maintenance completed for ' || v_order.work_order_reference,
        v_vehicle_status,
        v_order.id
      );
    END IF;
  END IF;

  RETURN to_jsonb(v_order);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_assign_ride_resources(
  p_ride_id uuid,
  p_driver_id uuid,
  p_vehicle_id uuid,
  p_expected_status public.ride_status DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_actor uuid := public.fleet_require_admin();
  v_ride public.rides%ROWTYPE;
  v_vehicle public.vehicle_profiles%ROWTYPE;
  v_result jsonb;
  v_assignment_start timestamptz;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    SELECT result INTO v_result
    FROM public.fleet_operation_requests
    WHERE idempotency_key = p_idempotency_key
      AND operation_type = 'assign_ride_resources'
      AND actor_id = v_actor;
    IF v_result IS NOT NULL THEN RETURN v_result; END IF;
  END IF;

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ride not found'; END IF;
  IF v_ride.status IN ('completed', 'cancelled') THEN RAISE EXCEPTION 'Ride cannot be reassigned'; END IF;
  IF p_expected_status IS NOT NULL AND v_ride.status IS DISTINCT FROM p_expected_status THEN
    RAISE EXCEPTION 'Ride status changed since it was loaded';
  END IF;
  IF NOT private.has_role(p_driver_id, 'driver'::app_role) THEN
    RAISE EXCEPTION 'Selected user is not a driver';
  END IF;

  SELECT * INTO v_vehicle FROM public.vehicle_profiles WHERE id = p_vehicle_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Vehicle not found'; END IF;
  IF v_vehicle.status <> 'active' THEN RAISE EXCEPTION 'Vehicle is not active'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.rides ride
    WHERE ride.id <> p_ride_id
      AND ride.status IN ('accepted', 'driver_arriving', 'arrived', 'in_progress')
      AND (ride.driver_id = p_driver_id OR ride.vehicle_id = p_vehicle_id)
  ) THEN
    RAISE EXCEPTION 'Driver or vehicle is already assigned to another active ride';
  END IF;

  v_assignment_start := COALESCE(v_ride.scheduled_at, now());
  IF NOT EXISTS (
    SELECT 1
    FROM public.vehicle_driver_assignments assignment
    WHERE assignment.vehicle_id = p_vehicle_id
      AND assignment.driver_id = p_driver_id
      AND assignment.status IN ('scheduled', 'active')
      AND assignment.start_at <= v_assignment_start
      AND (assignment.end_at IS NULL OR assignment.end_at > v_assignment_start)
  ) THEN
    PERFORM public.admin_assign_driver_vehicle(
      p_vehicle_id,
      p_driver_id,
      'trip_specific',
      v_assignment_start,
      v_assignment_start + interval '12 hours',
      'Ride resource assignment',
      'Created for ride ' || p_ride_id::text,
      'ride_assignment',
      CASE WHEN p_idempotency_key IS NULL THEN NULL ELSE p_idempotency_key || ':assignment' END
    );
  END IF;

  UPDATE public.rides
  SET driver_id = p_driver_id,
      vehicle_id = p_vehicle_id
  WHERE id = p_ride_id
  RETURNING * INTO v_ride;

  v_result := to_jsonb(v_ride);
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.fleet_operation_requests (
      idempotency_key, operation_type, actor_id, result
    ) VALUES (
      p_idempotency_key, 'assign_ride_resources', v_actor, v_result
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_assign_booking_vehicle(
  p_booking_id uuid,
  p_vehicle_id uuid,
  p_itinerary_item_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_actor uuid := public.fleet_require_admin();
  v_assignment public.booking_vehicle_assignments%ROWTYPE;
  v_result jsonb;
  v_vehicle_status text;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    SELECT result INTO v_result
    FROM public.fleet_operation_requests
    WHERE idempotency_key = p_idempotency_key
      AND operation_type = 'assign_booking_vehicle'
      AND actor_id = v_actor;
    IF v_result IS NOT NULL THEN RETURN v_result; END IF;
  END IF;

  PERFORM 1 FROM public.service_bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Service booking not found'; END IF;
  SELECT status INTO v_vehicle_status FROM public.vehicle_profiles WHERE id = p_vehicle_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Vehicle not found'; END IF;
  IF v_vehicle_status <> 'active' THEN RAISE EXCEPTION 'Vehicle is not active'; END IF;

  SELECT * INTO v_assignment
  FROM public.booking_vehicle_assignments
  WHERE booking_id = p_booking_id
    AND itinerary_item_id IS NOT DISTINCT FROM p_itinerary_item_id
    AND status IN ('proposed', 'confirmed')
  ORDER BY assigned_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.booking_vehicle_assignments
    SET vehicle_id = p_vehicle_id,
        status = 'confirmed',
        notes = NULLIF(trim(p_notes), '')
    WHERE id = v_assignment.id
    RETURNING * INTO v_assignment;
  ELSE
    INSERT INTO public.booking_vehicle_assignments (
      booking_id, itinerary_item_id, vehicle_id, fleet_vehicle_id, status, notes
    ) VALUES (
      p_booking_id, p_itinerary_item_id, p_vehicle_id, NULL, 'confirmed', NULLIF(trim(p_notes), '')
    ) RETURNING * INTO v_assignment;
  END IF;

  v_result := to_jsonb(v_assignment);
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.fleet_operation_requests (
      idempotency_key, operation_type, actor_id, result
    ) VALUES (
      p_idempotency_key, 'assign_booking_vehicle', v_actor, v_result
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_convert_support_ticket_to_maintenance(
  p_ticket_id uuid,
  p_maintenance_type text,
  p_severity text,
  p_description text DEFAULT NULL,
  p_scheduled_at timestamptz DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_actor uuid := public.fleet_require_admin();
  v_ticket public.support_tickets%ROWTYPE;
  v_result jsonb;
BEGIN
  SELECT * INTO v_ticket
  FROM public.support_tickets
  WHERE id = p_ticket_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Support ticket not found'; END IF;
  IF v_ticket.vehicle_id IS NULL THEN RAISE EXCEPTION 'Support ticket is not linked to a canonical vehicle'; END IF;

  v_result := public.admin_open_maintenance_work_order(
    v_ticket.vehicle_id,
    p_maintenance_type,
    p_severity,
    COALESCE(NULLIF(trim(p_description), ''), v_ticket.description),
    p_scheduled_at,
    NULL,
    NULL,
    p_ticket_id,
    p_idempotency_key
  );

  INSERT INTO public.support_ticket_events (
    ticket_id, event_type, previous_value, new_value, performed_by
  ) VALUES (
    p_ticket_id,
    'maintenance_work_order_created',
    NULL,
    v_result,
    v_actor
  );

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_fleet_consolidation_report()
RETURNS TABLE(metric text, value bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  PERFORM public.fleet_require_admin();
  RETURN QUERY
  SELECT 'canonical_vehicles', count(*)::bigint FROM public.vehicle_profiles
  UNION ALL
  SELECT 'legacy_fleet_vehicles', count(*)::bigint FROM public.fleet_vehicles
  UNION ALL
  SELECT 'legacy_driver_vehicle_rows', count(*)::bigint FROM public.driver_profiles
    WHERE vehicle_type IS NOT NULL OR vehicle_model IS NOT NULL OR license_plate IS NOT NULL
  UNION ALL
  SELECT 'legacy_mappings', count(*)::bigint FROM public.vehicle_legacy_mappings
  UNION ALL
  SELECT 'open_consolidation_issues', count(*)::bigint FROM public.fleet_consolidation_issues WHERE status = 'open'
  UNION ALL
  SELECT 'duplicate_normalised_registrations', count(*)::bigint
    FROM (
      SELECT license_plate_normalized
      FROM public.vehicle_profiles
      WHERE license_plate_normalized IS NOT NULL
      GROUP BY license_plate_normalized
      HAVING count(*) > 1
    ) duplicates
  UNION ALL
  SELECT 'unmapped_booking_assignments', count(*)::bigint
    FROM public.booking_vehicle_assignments WHERE vehicle_id IS NULL
  UNION ALL
  SELECT 'active_rides_without_vehicle', count(*)::bigint
    FROM public.rides
    WHERE status IN ('accepted', 'driver_arriving', 'arrived', 'in_progress')
      AND vehicle_id IS NULL
  UNION ALL
  SELECT 'drivers_without_effective_assignment', count(*)::bigint
    FROM public.user_roles roles
    WHERE roles.role = 'driver'
      AND NOT EXISTS (
        SELECT 1
        FROM public.vehicle_driver_assignments assignment
        WHERE assignment.driver_id = roles.user_id
          AND assignment.status = 'active'
          AND assignment.start_at <= now()
          AND (assignment.end_at IS NULL OR assignment.end_at > now())
      );
END;
$$;

-- One-way legacy compatibility for booking assignments.
CREATE OR REPLACE FUNCTION public.booking_vehicle_assignment_fill_canonical()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.vehicle_id IS NULL AND NEW.fleet_vehicle_id IS NOT NULL THEN
    SELECT mapping.canonical_vehicle_id
    INTO NEW.vehicle_id
    FROM public.vehicle_legacy_mappings mapping
    WHERE mapping.legacy_source = 'fleet_vehicles'
      AND mapping.legacy_record_id = NEW.fleet_vehicle_id::text
      AND mapping.migration_status = 'mapped'
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS booking_vehicle_assignment_fill_canonical_trigger
  ON public.booking_vehicle_assignments;
CREATE TRIGGER booking_vehicle_assignment_fill_canonical_trigger
  BEFORE INSERT OR UPDATE OF fleet_vehicle_id, vehicle_id
  ON public.booking_vehicle_assignments
  FOR EACH ROW EXECUTE FUNCTION public.booking_vehicle_assignment_fill_canonical();

-- Access control. Direct fleet writes are replaced by protected operations.
REVOKE INSERT, UPDATE, DELETE ON public.vehicle_profiles FROM authenticated;
GRANT SELECT ON public.vehicle_profiles TO authenticated;

ALTER TABLE public.vehicle_legacy_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fleet_consolidation_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fleet_operation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_driver_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_maintenance_work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_maintenance_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_odometer_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_status_events ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.vehicle_legacy_mappings TO authenticated;
GRANT SELECT ON public.fleet_consolidation_issues TO authenticated;
GRANT SELECT ON public.fleet_operation_requests TO authenticated;
GRANT SELECT ON public.vehicle_driver_assignments TO authenticated;
GRANT SELECT ON public.vehicle_documents TO authenticated;
GRANT SELECT ON public.vehicle_maintenance_work_orders TO authenticated;
GRANT SELECT ON public.vehicle_maintenance_events TO authenticated;
GRANT SELECT ON public.vehicle_odometer_events TO authenticated;
GRANT SELECT ON public.vehicle_status_events TO authenticated;
GRANT ALL ON public.vehicle_legacy_mappings, public.fleet_consolidation_issues,
  public.fleet_operation_requests, public.vehicle_driver_assignments,
  public.vehicle_documents, public.vehicle_maintenance_work_orders,
  public.vehicle_maintenance_events, public.vehicle_odometer_events,
  public.vehicle_status_events TO service_role;

CREATE POLICY "Admins read fleet mappings" ON public.vehicle_legacy_mappings
  FOR SELECT TO authenticated USING (private.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins read fleet issues" ON public.fleet_consolidation_issues
  FOR SELECT TO authenticated USING (private.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins read fleet operation requests" ON public.fleet_operation_requests
  FOR SELECT TO authenticated USING (private.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins read all vehicle assignments" ON public.vehicle_driver_assignments
  FOR SELECT TO authenticated USING (private.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Drivers read own vehicle assignments" ON public.vehicle_driver_assignments
  FOR SELECT TO authenticated USING (driver_id = auth.uid());
CREATE POLICY "Admins read vehicle documents" ON public.vehicle_documents
  FOR SELECT TO authenticated USING (private.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Drivers read assigned vehicle document status" ON public.vehicle_documents
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1
      FROM public.vehicle_driver_assignments assignment
      WHERE assignment.vehicle_id = vehicle_documents.vehicle_id
        AND assignment.driver_id = auth.uid()
        AND assignment.status = 'active'
        AND assignment.start_at <= now()
        AND (assignment.end_at IS NULL OR assignment.end_at > now())
    )
  );
CREATE POLICY "Admins read maintenance work orders" ON public.vehicle_maintenance_work_orders
  FOR SELECT TO authenticated USING (private.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins read maintenance events" ON public.vehicle_maintenance_events
  FOR SELECT TO authenticated USING (private.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins read odometer events" ON public.vehicle_odometer_events
  FOR SELECT TO authenticated USING (private.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins read vehicle status events" ON public.vehicle_status_events
  FOR SELECT TO authenticated USING (private.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Drivers read assigned canonical vehicle" ON public.vehicle_profiles;
CREATE POLICY "Drivers read assigned canonical vehicle" ON public.vehicle_profiles
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1
      FROM public.vehicle_driver_assignments assignment
      WHERE assignment.vehicle_id = vehicle_profiles.id
        AND assignment.driver_id = auth.uid()
        AND assignment.status = 'active'
        AND assignment.start_at <= now()
        AND (assignment.end_at IS NULL OR assignment.end_at > now())
    )
  );

DROP POLICY IF EXISTS "Passengers read ride vehicle" ON public.vehicle_profiles;
CREATE POLICY "Passengers read ride vehicle" ON public.vehicle_profiles
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1
      FROM public.rides ride
      WHERE ride.vehicle_id = vehicle_profiles.id
        AND ride.passenger_id = auth.uid()
        AND ride.status IN ('accepted', 'driver_arriving', 'arrived', 'in_progress', 'completed')
    )
  );

REVOKE INSERT, UPDATE, DELETE ON public.vehicle_driver_assignments FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.vehicle_documents FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.vehicle_maintenance_work_orders FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.vehicle_maintenance_events FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.vehicle_odometer_events FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.vehicle_status_events FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.vehicle_legacy_mappings FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.fleet_consolidation_issues FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.fleet_operation_requests FROM authenticated;

GRANT EXECUTE ON FUNCTION public.admin_create_vehicle(
  text, text, text, text, text, integer, text, integer, boolean, integer, boolean, jsonb, numeric, text, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_vehicle(
  uuid, timestamptz, text, text, text, text, integer, text, text, integer, boolean, integer, boolean, jsonb, numeric, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_change_vehicle_status(uuid, text, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_assign_driver_vehicle(uuid, uuid, text, timestamptz, timestamptz, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_end_vehicle_assignment(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_record_vehicle_odometer(uuid, numeric, text, uuid, uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_open_maintenance_work_order(uuid, text, text, text, timestamptz, numeric, text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_transition_maintenance_work_order(uuid, text, text, text, text, text, numeric, date, numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_assign_ride_resources(uuid, uuid, uuid, public.ride_status, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_assign_booking_vehicle(uuid, uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_convert_support_ticket_to_maintenance(uuid, text, text, text, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_fleet_consolidation_report() TO authenticated;

COMMENT ON TABLE public.vehicle_profiles IS
  'Canonical Access vehicle master. Legacy fleet_vehicles and driver_profiles vehicle fields are compatibility-only after Phase 3.';
COMMENT ON TABLE public.fleet_vehicles IS
  'Legacy service-booking vehicle source retained temporarily for Phase 3 reconciliation. New application writes must use vehicle_profiles.';
COMMENT ON COLUMN public.driver_profiles.vehicle_type IS
  'Legacy compatibility field maintained from canonical effective assignments. Do not write directly.';
COMMENT ON COLUMN public.driver_profiles.vehicle_model IS
  'Legacy compatibility field maintained from canonical effective assignments. Do not write directly.';
COMMENT ON COLUMN public.driver_profiles.license_plate IS
  'Legacy compatibility field maintained from canonical effective assignments. Do not write directly.';
COMMENT ON COLUMN public.booking_vehicle_assignments.fleet_vehicle_id IS
  'Legacy compatibility reference retained until all assignments have canonical vehicle_id values.';
COMMENT ON COLUMN public.booking_vehicle_assignments.vehicle_id IS
  'Canonical vehicle assignment reference to vehicle_profiles.';
