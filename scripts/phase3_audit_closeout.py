from __future__ import annotations

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    (ROOT / path).write_text(content, encoding="utf-8")


def replace_exact(path: str, old: str, new: str, expected: int = 1) -> None:
    content = read(path)
    count = content.count(old)
    if count != expected:
        raise RuntimeError(f"{path}: expected {expected} exact match(es), found {count}")
    write(path, content.replace(old, new))


# Effective assignments are time-based. A scheduled assignment becomes effective
# when its start time arrives; no background status-flip job is required.
replace_exact(
    "src/lib/fleet.ts",
    '  if (assignment.status !== "active") return false;',
    '  if (!["scheduled", "active"].includes(assignment.status)) return false;',
)
replace_exact(
    "src/lib/fleet.ts",
    '''export type FleetConsolidationIssue = {
  id: string;
''',
    '''export type FleetConsolidationIssue = {
  id: string;
  canonical_vehicle_id: string | null;
''',
)
replace_exact(
    "src/lib/fleet.test.ts",
    '''  it("resolves an active effective assignment inside its time range", () => {
    expect(isAssignmentEffective(assignment(), new Date("2026-07-30T12:00:00.000Z"))).toBe(true);
    expect(
      isAssignmentEffective(
        assignment({ end_at: "2026-07-30T10:00:00.000Z" }),
        new Date("2026-07-30T12:00:00.000Z"),
      ),
    ).toBe(false);
    expect(
      isAssignmentEffective(
        assignment({ status: "scheduled" }),
        new Date("2026-07-30T12:00:00.000Z"),
      ),
    ).toBe(false);
  });
''',
    '''  it("resolves scheduled or active assignments by effective time", () => {
    const at = new Date("2026-07-30T12:00:00.000Z");

    expect(isAssignmentEffective(assignment(), at)).toBe(true);
    expect(
      isAssignmentEffective(assignment({ end_at: "2026-07-30T10:00:00.000Z" }), at),
    ).toBe(false);
    expect(isAssignmentEffective(assignment({ status: "scheduled" }), at)).toBe(true);
    expect(
      isAssignmentEffective(
        assignment({ status: "scheduled", start_at: "2026-07-31T08:00:00.000Z" }),
        at,
      ),
    ).toBe(false);
    expect(isAssignmentEffective(assignment({ status: "cancelled" }), at)).toBe(false);
  });
''',
)

replace_exact(
    "src/components/profile/DriverProfileSections.tsx",
    '          .eq("status", "active")',
    '          .in("status", ["scheduled", "active"])',
)

replace_exact(
    "src/components/fleet/AdminEndVehicleAssignmentDialog.tsx",
    'import { fleetDb, type VehicleAssignment } from "@/lib/fleet";',
    'import { fleetDb, isAssignmentEffective, type VehicleAssignment } from "@/lib/fleet";',
)
replace_exact(
    "src/components/fleet/AdminEndVehicleAssignmentDialog.tsx",
    '''  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
''',
    '''  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const effective = isAssignmentEffective(assignment);
''',
)
replace_exact(
    "src/components/fleet/AdminEndVehicleAssignmentDialog.tsx",
    '    toast.success(assignment.status === "scheduled" ? "Assignment cancelled" : "Assignment ended");',
    '    toast.success(effective ? "Assignment ended" : "Assignment cancelled");',
)
replace_exact(
    "src/components/fleet/AdminEndVehicleAssignmentDialog.tsx",
    '{assignment.status === "scheduled" ? "Cancel assignment" : "End assignment"}',
    '{effective ? "End assignment" : "Cancel assignment"}',
)
replace_exact(
    "src/components/fleet/AdminEndVehicleAssignmentDialog.tsx",
    '''            {assignment.status === "scheduled"
              ? "Cancel scheduled assignment"
              : "End active assignment"}''',
    '''            {effective ? "End active assignment" : "Cancel scheduled assignment"}''',
)

replace_exact(
    "src/routes/app.admin.driver-assignments.tsx",
    "{ASSIGNMENT_STATUS_LABEL[assignment.status]}",
    '{isAssignmentEffective(assignment) ? "Active" : ASSIGNMENT_STATUS_LABEL[assignment.status]}',
)

# Admin Trips must use canonical vehicle records only. Driver profile vehicle
# fields remain compatibility-only and are not an operational fallback.
replace_exact(
    "src/routes/app.admin.trips.tsx",
    '''type Vehicle = {
  user_id: string;
  vehicle_model: string | null;
  license_plate: string | null;
  vehicle_type: string | null;
  is_available: boolean;
};''',
    '''type DriverAvailability = {
  user_id: string;
  is_available: boolean;
};''',
)
replace_exact(
    "src/routes/app.admin.trips.tsx",
    "const [vehicles, setVehicles] = useState<Map<string, Vehicle>>(new Map());",
    "const [vehicles, setVehicles] = useState<Map<string, DriverAvailability>>(new Map());",
)
replace_exact(
    "src/routes/app.admin.trips.tsx",
    '.select("user_id, vehicle_model, license_plate, vehicle_type, is_available")',
    '.select("user_id, is_available")',
)
replace_exact(
    "src/routes/app.admin.trips.tsx",
    "setVehicles(new Map(((vs ?? []) as Vehicle[]).map((v) => [v.user_id, v])));",
    "setVehicles(new Map(((vs ?? []) as DriverAvailability[]).map((v) => [v.user_id, v])));",
)
replace_exact(
    "src/routes/app.admin.trips.tsx",
    '''            const fm = new Map<string, FleetVehicle>();
            for (const r of list) {
              if (!r.vehicle_id) continue;
              const v = (fvs ?? []).find((x) => x.id === r.vehicle_id);
              if (v) fm.set(r.id, v as FleetVehicle);
            }
            setFleetVehicles(fm);''',
    '''            setFleetVehicles(
              new Map(
                ((fvs ?? []) as FleetVehicle[]).map((vehicle) => [vehicle.id, vehicle]),
              ),
            );''',
)
replace_exact(
    "src/routes/app.admin.trips.tsx",
    'fleetVehicle={fleetVehicles.get(r.id) ?? null}',
    'fleetVehicle={r.vehicle_id ? (fleetVehicles.get(r.vehicle_id) ?? null) : null}',
)
replace_exact(
    "src/routes/app.admin.trips.tsx",
    'placeholder="Search name, phone, ride ID, plate, pickup or destination"',
    'placeholder="Search name, phone, ride ID, pickup or destination"',
)
replace_exact(
    "src/routes/app.admin.trips.tsx",
    '''  const fleetAlerts = fleetVehicle ? getVehicleAlerts(fleetVehicle) : [];
  const vehicleModel = fleetVehicle
    ? `${fleetVehicle.vehicle_name ?? ""} ${fleetVehicle.model ?? ""}`.trim() ||
      (fleetVehicle.vehicle_name ?? "—")
    : (vehicle?.vehicle_model ?? null);
  const vehicleType = fleetVehicle?.vehicle_type ?? vehicle?.vehicle_type ?? null;
  const vehiclePlate = fleetVehicle?.license_plate ?? vehicle?.license_plate ?? null;
  const vehicleAssignmentStatus: "fleet" | "driver" | "unassigned" = fleetVehicle
    ? "fleet"
    : vehicle && (vehicle.vehicle_model || vehicle.license_plate)
      ? "driver"
      : "unassigned";
  const driverAvailability: "available" | "offline" | "none" = vehicle
''',
    '''  const fleetAlerts = fleetVehicle ? getVehicleAlerts(fleetVehicle) : [];
  const vehicleModel = fleetVehicle
    ? `${fleetVehicle.vehicle_name ?? ""} ${fleetVehicle.model ?? ""}`.trim() ||
      (fleetVehicle.vehicle_name ?? "—")
    : null;
  const vehicleType = fleetVehicle?.vehicle_type ?? null;
  const vehiclePlate = fleetVehicle?.license_plate ?? null;
  const driverAvailability: "available" | "offline" | "none" = vehicle
''',
)
replace_exact(
    "src/routes/app.admin.trips.tsx",
    '''            {vehicleAssignmentStatus === "fleet" ? (
              <Badge className="bg-sky-500/15 text-sky-700 dark:text-sky-300">Fleet vehicle</Badge>
            ) : vehicleAssignmentStatus === "driver" ? (
              <Badge variant="outline">Driver's vehicle</Badge>
            ) : (
              <Badge
                variant="outline"
                className="border-amber-500/40 text-amber-700 dark:text-amber-300"
              >
                Unassigned
              </Badge>
            )}''',
    '''            {fleetVehicle ? (
              <Badge className="bg-sky-500/15 text-sky-700 dark:text-sky-300">
                Canonical vehicle
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="border-amber-500/40 text-amber-700 dark:text-amber-300"
              >
                Unassigned
              </Badge>
            )}''',
)
replace_exact(
    "src/routes/app.admin.trips.tsx",
    "  vehicle: Vehicle | null;",
    "  vehicle: DriverAvailability | null;",
    expected=2,
)
replace_exact(
    "src/routes/app.admin.trips.tsx",
    '''type DriverOption = {
  user_id: string;
  full_name: string | null;
  vehicle_model: string | null;
  license_plate: string | null;
  is_available: boolean;
};''',
    '''type DriverOption = {
  user_id: string;
  full_name: string | null;
  is_available: boolean;
};''',
)
replace_exact(
    "src/routes/app.admin.trips.tsx",
    '''      const [{ data: profs }, { data: vs }] = await Promise.all([
        supabase.from("profiles").select("user_id, full_name").in("user_id", ids),
        supabase
          .from("driver_profiles")
          .select("user_id, vehicle_model, license_plate, is_available")
          .in("user_id", ids),
      ]);
      const vMap = new Map(
        (
          (vs ?? []) as {
            user_id: string;
            vehicle_model: string | null;
            license_plate: string | null;
            is_available: boolean;
          }[]
        ).map((v) => [v.user_id, v]),
      );
      const opts: DriverOption[] = (
        (profs ?? []) as { user_id: string; full_name: string | null }[]
      ).map((p) => ({
        user_id: p.user_id,
        full_name: p.full_name,
        vehicle_model: vMap.get(p.user_id)?.vehicle_model ?? null,
        license_plate: vMap.get(p.user_id)?.license_plate ?? null,
        is_available: vMap.get(p.user_id)?.is_available ?? false,
      }));''',
    '''      const [{ data: profs }, { data: availabilityRows }] = await Promise.all([
        supabase.from("profiles").select("user_id, full_name").in("user_id", ids),
        supabase.from("driver_profiles").select("user_id, is_available").in("user_id", ids),
      ]);
      const availability = new Map(
        ((availabilityRows ?? []) as DriverAvailability[]).map((row) => [
          row.user_id,
          row.is_available,
        ]),
      );
      const opts: DriverOption[] = (
        (profs ?? []) as { user_id: string; full_name: string | null }[]
      ).map((profile) => ({
        user_id: profile.user_id,
        full_name: profile.full_name,
        is_available: availability.get(profile.user_id) ?? false,
      }));''',
)
replace_exact(
    "src/routes/app.admin.trips.tsx",
    '''            {vehicle && (vehicle.vehicle_model || vehicle.license_plate) && (
              <p className="mt-0.5 flex items-center gap-1 text-muted-foreground">
                <Car className="h-3 w-3" />{" "}
                {[vehicle.vehicle_model, vehicle.license_plate].filter(Boolean).join(" · ")}
              </p>
            )}''',
    '''            {fleetVehicle ? (
              <p className="mt-0.5 flex items-center gap-1 text-muted-foreground">
                <Car className="h-3 w-3" /> {fleetVehicle.vehicle_name} ·{" "}
                {fleetVehicle.license_plate}
              </p>
            ) : null}''',
)

# Passenger booking cards should show a canonical booking-level assignment even
# before the first ride leg has been created.
replace_exact(
    "src/routes/app.passenger.bookings.tsx",
    '''        const vIds = Array.from(
          new Set(
            ((rr.data ?? []) as Ride[])
              .map((ride) => ride.vehicle_id)
              .filter((value): value is string => !!value),
          ),
        );''',
    '''        const vIds = Array.from(
          new Set([
            ...((vr.data ?? []) as VehicleAssign[])
              .map((assignment) => assignment.vehicle_id)
              .filter((value): value is string => !!value),
            ...((rr.data ?? []) as Ride[])
              .map((ride) => ride.vehicle_id)
              .filter((value): value is string => !!value),
          ]),
        );''',
)
replace_exact(
    "src/routes/app.passenger.bookings.tsx",
    '''            const dAssign = driverAssigns.find((x) => x.booking_id === b.id);
            const cAssigns = companionAssigns.filter((x) => x.booking_id === b.id);
            const ride = rides.find((r) => r.service_booking_id === b.id);
''',
    '''            const dAssign = driverAssigns.find((x) => x.booking_id === b.id);
            const vAssign = vehicleAssigns.find((x) => x.booking_id === b.id);
            const cAssigns = companionAssigns.filter((x) => x.booking_id === b.id);
            const ride = rides.find((r) => r.service_booking_id === b.id);
''',
)
replace_exact(
    "src/routes/app.passenger.bookings.tsx",
    '''            const veh = ride?.vehicle_id
              ? fleetVehicles.find((vehicle) => vehicle.id === ride.vehicle_id)
              : null;''',
    '''            const assignedVehicleId = ride?.vehicle_id ?? vAssign?.vehicle_id ?? null;
            const veh = assignedVehicleId
              ? fleetVehicles.find((vehicle) => vehicle.id === assignedVehicleId)
              : null;''',
)

replace_exact(
    "src/routes/app.admin.vehicle-profiles.$vehicleId.tsx",
    '''          .eq("status", "open")
          .or(`source_record_id.eq.${vehicleId},registration_number.eq.${vehicleId}`)
          .order("created_at", { ascending: false }),''',
    '''          .eq("status", "open")
          .eq("canonical_vehicle_id", vehicleId)
          .order("created_at", { ascending: false }),''',
)

migration = r'''-- Phase 3 completed-diff audit closeout.
-- This migration keeps effective assignments time-based and hardens maintenance,
-- document, reconciliation and reactivation behavior before Phase 4.

ALTER TABLE public.fleet_consolidation_issues
  ADD COLUMN IF NOT EXISTS canonical_vehicle_id uuid
  REFERENCES public.vehicle_profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS fleet_consolidation_issues_vehicle_idx
  ON public.fleet_consolidation_issues(canonical_vehicle_id, status);

WITH unique_vehicle AS (
  SELECT license_plate_normalized, min(id) AS vehicle_id
  FROM public.vehicle_profiles
  WHERE license_plate_normalized IS NOT NULL
  GROUP BY license_plate_normalized
  HAVING count(*) = 1
)
UPDATE public.fleet_consolidation_issues issue
SET canonical_vehicle_id = unique_vehicle.vehicle_id
FROM unique_vehicle
WHERE issue.canonical_vehicle_id IS NULL
  AND public.normalize_vehicle_registration(issue.registration_number)
      = unique_vehicle.license_plate_normalized;

UPDATE public.fleet_consolidation_issues issue
SET canonical_vehicle_id = ticket.vehicle_id
FROM public.support_tickets ticket
WHERE issue.canonical_vehicle_id IS NULL
  AND issue.source_table = 'support_tickets'
  AND issue.source_record_id = ticket.id::text
  AND ticket.vehicle_id IS NOT NULL;

UPDATE public.fleet_consolidation_issues issue
SET canonical_vehicle_id = assignment.vehicle_id
FROM public.booking_vehicle_assignments assignment
WHERE issue.canonical_vehicle_id IS NULL
  AND issue.source_table = 'booking_vehicle_assignments'
  AND issue.source_record_id = assignment.id::text
  AND assignment.vehicle_id IS NOT NULL;

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY vehicle_id, document_type
      ORDER BY created_at DESC, id DESC
    ) AS position
  FROM public.vehicle_documents
  WHERE is_current
)
UPDATE public.vehicle_documents document
SET is_current = false,
    status = CASE
      WHEN document.status IN ('current', 'expired') THEN 'replaced'
      ELSE document.status
    END,
    updated_at = now()
FROM ranked
WHERE ranked.id = document.id
  AND ranked.position > 1;

DROP INDEX IF EXISTS public.vehicle_documents_one_current_type_idx;
CREATE UNIQUE INDEX vehicle_documents_one_current_type_idx
  ON public.vehicle_documents(vehicle_id, document_type)
  WHERE is_current;

CREATE OR REPLACE FUNCTION public.driver_current_vehicle_document_status()
RETURNS TABLE (
  vehicle_id uuid,
  document_type text,
  expires_at date,
  status text,
  is_current boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    document.vehicle_id,
    document.document_type,
    document.expires_at,
    document.status,
    document.is_current
  FROM public.vehicle_documents document
  JOIN public.vehicle_driver_assignments assignment
    ON assignment.vehicle_id = document.vehicle_id
  WHERE assignment.driver_id = auth.uid()
    AND assignment.status IN ('scheduled', 'active')
    AND assignment.start_at <= now()
    AND (assignment.end_at IS NULL OR assignment.end_at > now())
    AND document.is_current;
$$;

REVOKE ALL ON FUNCTION public.driver_current_vehicle_document_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.driver_current_vehicle_document_status() TO authenticated;

DROP POLICY IF EXISTS "Drivers read assigned canonical vehicle" ON public.vehicle_profiles;
CREATE POLICY "Drivers read assigned canonical vehicle" ON public.vehicle_profiles
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1
      FROM public.vehicle_driver_assignments assignment
      WHERE assignment.vehicle_id = vehicle_profiles.id
        AND assignment.driver_id = auth.uid()
        AND assignment.status IN ('scheduled', 'active')
        AND assignment.start_at <= now()
        AND (assignment.end_at IS NULL OR assignment.end_at > now())
    )
  );

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
  IF NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required to end or cancel an assignment';
  END IF;

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
      end_at = CASE WHEN start_at > now() THEN end_at ELSE now() END,
      ended_by = v_actor,
      notes = concat_ws(E'\n', notes, trim(p_reason))
  WHERE id = p_assignment_id
  RETURNING * INTO v_assignment;

  RETURN to_jsonb(v_assignment);
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
  v_previous_status text;
BEGIN
  IF p_new_status NOT IN ('active', 'maintenance', 'out_of_service', 'retired') THEN
    RAISE EXCEPTION 'Invalid vehicle status';
  END IF;
  IF NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN
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

  IF p_new_status = 'active' THEN
    IF EXISTS (
      SELECT 1
      FROM public.vehicle_maintenance_work_orders work_order
      WHERE work_order.vehicle_id = p_vehicle_id
        AND work_order.status NOT IN ('completed', 'cancelled')
        AND work_order.severity IN ('urgent', 'unsafe')
    ) THEN
      RAISE EXCEPTION 'Vehicle has unresolved urgent or unsafe maintenance';
    END IF;

    IF public.vehicle_has_expired_mandatory_document(
         p_vehicle_id, 'roadworthy', v_vehicle.roadworthy_expiry_date
       ) OR public.vehicle_has_expired_mandatory_document(
         p_vehicle_id, 'license_disc', v_vehicle.license_disc_expiry_date
       ) OR public.vehicle_has_expired_mandatory_document(
         p_vehicle_id, 'insurance', v_vehicle.insurance_expiry_date
       ) THEN
      RAISE EXCEPTION 'Vehicle has an expired mandatory document';
    END IF;
  END IF;

  IF p_new_status <> 'active' THEN
    UPDATE public.vehicle_driver_assignments
    SET status = CASE WHEN start_at > now() THEN 'cancelled' ELSE 'completed' END,
        end_at = CASE WHEN start_at > now() THEN end_at ELSE now() END,
        ended_by = v_actor,
        notes = concat_ws(
          E'\n',
          notes,
          'Ended automatically because vehicle status changed to ' || p_new_status
        )
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
      vehicle_id,
      previous_status,
      new_status,
      reason,
      work_order_id,
      performed_by
    ) VALUES (
      p_vehicle_id,
      v_previous_status,
      p_new_status,
      trim(p_reason),
      p_work_order_id,
      v_actor
    );
  END IF;

  RETURN to_jsonb(v_vehicle);
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
  v_vehicle public.vehicle_profiles%ROWTYPE;
  v_can_reactivate boolean := false;
BEGIN
  IF p_new_status NOT IN (
    'open', 'scheduled', 'in_progress', 'waiting_for_parts', 'completed', 'cancelled'
  ) THEN
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

  IF p_new_status = 'completed' THEN
    IF NULLIF(trim(COALESCE(p_work_performed, v_order.work_performed, '')), '') IS NULL
       OR NULLIF(trim(COALESCE(p_outcome, v_order.outcome, '')), '') IS NULL THEN
      RAISE EXCEPTION 'Work performed and outcome are required to complete maintenance';
    END IF;

    IF COALESCE(p_odometer_at_completion, v_order.odometer_at_completion) IS NULL THEN
      RAISE EXCEPTION 'Completion odometer is required';
    END IF;

    IF v_order.maintenance_type = 'scheduled_service'
       AND COALESCE(p_next_service_due_date, v_order.next_service_due_date) IS NULL
       AND COALESCE(p_next_service_due_km, v_order.next_service_due_km) IS NULL THEN
      RAISE EXCEPTION 'Next service date or odometer is required for scheduled service';
    END IF;
  END IF;

  v_previous := to_jsonb(v_order);

  UPDATE public.vehicle_maintenance_work_orders
  SET status = p_new_status,
      started_at = CASE
        WHEN p_new_status = 'in_progress' THEN COALESCE(started_at, now())
        ELSE started_at
      END,
      completed_at = CASE
        WHEN p_new_status = 'completed' THEN COALESCE(completed_at, now())
        ELSE completed_at
      END,
      cancelled_at = CASE
        WHEN p_new_status = 'cancelled' THEN COALESCE(cancelled_at, now())
        ELSE cancelled_at
      END,
      diagnosis = COALESCE(NULLIF(trim(p_diagnosis), ''), diagnosis),
      work_performed = COALESCE(NULLIF(trim(p_work_performed), ''), work_performed),
      outcome = COALESCE(NULLIF(trim(p_outcome), ''), outcome),
      odometer_at_completion = COALESCE(
        p_odometer_at_completion,
        odometer_at_completion
      ),
      next_service_due_date = COALESCE(
        p_next_service_due_date,
        next_service_due_date
      ),
      next_service_due_km = COALESCE(
        p_next_service_due_km,
        next_service_due_km
      ),
      actual_cost = COALESCE(p_actual_cost, actual_cost),
      updated_by = v_actor
  WHERE id = p_work_order_id
  RETURNING * INTO v_order;

  INSERT INTO public.vehicle_maintenance_events (
    work_order_id,
    event_type,
    previous_value,
    new_value,
    performed_by
  ) VALUES (
    p_work_order_id,
    'status_changed',
    v_previous,
    to_jsonb(v_order),
    v_actor
  );

  SELECT * INTO v_vehicle
  FROM public.vehicle_profiles
  WHERE id = v_order.vehicle_id
  FOR UPDATE;

  IF p_new_status = 'in_progress' AND v_vehicle.status = 'active' THEN
    PERFORM public.admin_change_vehicle_status(
      v_order.vehicle_id,
      'maintenance',
      'Maintenance started for ' || v_order.work_order_reference,
      v_vehicle.status,
      v_order.id
    );
  ELSIF p_new_status = 'completed' THEN
    PERFORM public.admin_record_vehicle_odometer(
      v_order.vehicle_id,
      v_order.odometer_at_completion,
      'maintenance',
      NULL,
      v_order.id,
      'Maintenance completion ' || v_order.work_order_reference,
      false
    );

    IF v_order.maintenance_type = 'scheduled_service' THEN
      UPDATE public.vehicle_profiles
      SET last_service_date = COALESCE(v_order.completed_at::date, current_date),
          last_service_km = v_order.odometer_at_completion,
          next_service_due_km = COALESCE(
            v_order.next_service_due_km,
            next_service_due_km
          )
      WHERE id = v_order.vehicle_id;
    END IF;

    SELECT * INTO v_vehicle
    FROM public.vehicle_profiles
    WHERE id = v_order.vehicle_id
    FOR UPDATE;

    v_can_reactivate :=
      (
        v_vehicle.status = 'maintenance'
        OR (
          v_vehicle.status = 'out_of_service'
          AND EXISTS (
            SELECT 1
            FROM public.vehicle_status_events status_event
            WHERE status_event.vehicle_id = v_order.vehicle_id
              AND status_event.work_order_id = v_order.id
              AND status_event.new_status = 'out_of_service'
          )
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.vehicle_maintenance_work_orders other
        WHERE other.vehicle_id = v_order.vehicle_id
          AND other.id <> v_order.id
          AND other.status NOT IN ('completed', 'cancelled')
          AND (
            other.severity IN ('urgent', 'unsafe')
            OR other.status IN ('in_progress', 'waiting_for_parts')
          )
      )
      AND NOT public.vehicle_has_expired_mandatory_document(
        v_order.vehicle_id,
        'roadworthy',
        v_vehicle.roadworthy_expiry_date
      )
      AND NOT public.vehicle_has_expired_mandatory_document(
        v_order.vehicle_id,
        'license_disc',
        v_vehicle.license_disc_expiry_date
      )
      AND NOT public.vehicle_has_expired_mandatory_document(
        v_order.vehicle_id,
        'insurance',
        v_vehicle.insurance_expiry_date
      );

    IF v_can_reactivate THEN
      PERFORM public.admin_change_vehicle_status(
        v_order.vehicle_id,
        'active',
        'Maintenance completed for ' || v_order.work_order_reference,
        v_vehicle.status,
        v_order.id
      );
    END IF;
  END IF;

  RETURN to_jsonb(v_order);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_end_vehicle_assignment(uuid, text, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_change_vehicle_status(uuid, text, text, text, uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_transition_maintenance_work_order(
  uuid, text, text, text, text, text, numeric, date, numeric, numeric
) TO authenticated;
'''

migration_path = ROOT / "supabase/migrations/20260730224500_phase3_audit_closeout.sql"
if migration_path.exists():
    raise RuntimeError(f"{migration_path}: migration already exists")
migration_path.write_text(migration, encoding="utf-8")

changed_source = [
    "src/components/fleet/AdminEndVehicleAssignmentDialog.tsx",
    "src/components/fleet/AdminMaintenanceActions.tsx",
    "src/components/fleet/AdminVehicleRecordActions.tsx",
    "src/components/profile/DriverProfileSections.tsx",
    "src/components/support/AdminSupportVehicleActions.tsx",
    "src/routes/app.admin.bookings.tsx",
    "src/routes/app.admin.driver-assignments.tsx",
    "src/routes/app.admin.fleet.tsx",
    "src/routes/app.admin.maintenance.tsx",
    "src/routes/app.admin.trips.tsx",
    "src/routes/app.admin.vehicle-profiles.$vehicleId.tsx",
    "src/routes/app.admin.vehicle-profiles.tsx",
    "src/routes/app.passenger.bookings.tsx",
]

for relative in changed_source:
    source = read(relative)
    for table in ("fleet_vehicles", "vehicle_profiles", "vehicle_driver_assignments"):
        mutation = re.compile(
            rf'\.from\(["\']{table}["\']\).*?\.(insert|update|delete|upsert)\s*\(',
            re.DOTALL,
        )
        if mutation.search(source):
            raise RuntimeError(f"{relative}: direct mutation of {table} bypasses protected fleet RPCs")

trips = read("src/routes/app.admin.trips.tsx")
for forbidden in ("vehicle_model", 'select("user_id, vehicle_model', "Driver's vehicle"):
    if forbidden in trips:
        raise RuntimeError(f"src/routes/app.admin.trips.tsx: legacy operational fallback remains: {forbidden}")

print("Phase 3 audit closeout patch and prohibited-write audit completed.")
