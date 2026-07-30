import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

// The Phase 3 migration must be applied before Lovable can regenerate the
// repository-wide Database type. All fleet access is isolated here until that
// generated file is refreshed from the applied schema.
export const fleetDb = supabase as unknown as SupabaseClient;

export type VehicleOperationalStatus = "active" | "maintenance" | "out_of_service" | "retired";
export type AssignmentType = "primary" | "shift" | "temporary" | "trip_specific" | "replacement";
export type AssignmentStatus = "scheduled" | "active" | "completed" | "cancelled";
export type MaintenanceStatus =
  | "open"
  | "scheduled"
  | "in_progress"
  | "waiting_for_parts"
  | "completed"
  | "cancelled";
export type MaintenanceSeverity = "routine" | "attention" | "urgent" | "unsafe";
export type VehicleDocumentType =
  | "roadworthy"
  | "license_disc"
  | "insurance"
  | "registration"
  | "permit"
  | "other";

export type CanonicalVehicle = {
  id: string;
  vehicle_name: string;
  vehicle_type: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  license_plate: string;
  license_plate_normalized: string | null;
  vin_number: string | null;
  wheelchair_accessible: boolean;
  ramp_or_lift_available: boolean;
  passenger_capacity: number | null;
  wheelchair_capacity: number | null;
  accessibility_features: unknown;
  assigned_driver_id: string | null;
  current_odometer_km: number;
  last_service_km: number | null;
  next_service_due_km: number | null;
  service_interval_km: number;
  last_service_date: string | null;
  roadworthy_expiry_date: string | null;
  license_disc_expiry_date: string | null;
  insurance_expiry_date: string | null;
  status: VehicleOperationalStatus;
  admin_notes: string | null;
  legacy_consolidation_status: string;
  created_at: string;
  updated_at: string;
};

export type VehicleAssignment = {
  id: string;
  vehicle_id: string;
  driver_id: string;
  assignment_type: AssignmentType;
  status: AssignmentStatus;
  start_at: string;
  end_at: string | null;
  assigned_by: string | null;
  ended_by: string | null;
  assignment_reason: string | null;
  notes: string | null;
  source: string;
  created_at: string;
  updated_at: string;
};

export type VehicleDocument = {
  id: string;
  vehicle_id: string;
  document_type: VehicleDocumentType;
  document_number: string | null;
  issued_at: string | null;
  expires_at: string | null;
  storage_path: string | null;
  status: "current" | "expired" | "replaced" | "removed";
  is_current: boolean;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
};

export type MaintenanceWorkOrder = {
  id: string;
  vehicle_id: string;
  support_ticket_id: string | null;
  work_order_reference: string;
  maintenance_type: string;
  severity: MaintenanceSeverity;
  status: MaintenanceStatus;
  reported_at: string;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  odometer_at_report: number | null;
  odometer_at_completion: number | null;
  service_provider: string | null;
  description: string;
  diagnosis: string | null;
  work_performed: string | null;
  outcome: string | null;
  next_service_due_date: string | null;
  next_service_due_km: number | null;
  estimated_cost: number | null;
  actual_cost: number | null;
  reported_by: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type FleetConsolidationIssue = {
  id: string;
  issue_type: string;
  source_table: string;
  source_record_id: string | null;
  registration_number: string | null;
  details: unknown;
  status: "open" | "resolved" | "ignored";
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
};

export type VehicleOdometerEvent = {
  id: string;
  vehicle_id: string;
  odometer_km: number;
  source: string;
  ride_id: string | null;
  work_order_id: string | null;
  recorded_by: string | null;
  recorded_at: string;
  notes: string | null;
};

export type VehicleStatusEvent = {
  id: string;
  vehicle_id: string;
  previous_status: string | null;
  new_status: VehicleOperationalStatus;
  reason: string;
  work_order_id: string | null;
  performed_by: string | null;
  created_at: string;
};

export type DocumentState = "valid" | "expiring" | "expired" | "missing";
export type ServiceState = "current" | "due_soon" | "overdue" | "unknown";

export const VEHICLE_STATUS_LABEL: Record<VehicleOperationalStatus, string> = {
  active: "Active",
  maintenance: "Maintenance",
  out_of_service: "Out of service",
  retired: "Retired",
};

export const ASSIGNMENT_STATUS_LABEL: Record<AssignmentStatus, string> = {
  scheduled: "Scheduled",
  active: "Active",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const MAINTENANCE_STATUS_LABEL: Record<MaintenanceStatus, string> = {
  open: "Open",
  scheduled: "Scheduled",
  in_progress: "In progress",
  waiting_for_parts: "Waiting for parts",
  completed: "Completed",
  cancelled: "Cancelled",
};

export function normalizeRegistration(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function isAssignmentEffective(
  assignment: Pick<VehicleAssignment, "status" | "start_at" | "end_at">,
  at = new Date(),
): boolean {
  if (assignment.status !== "active") return false;
  const start = new Date(assignment.start_at).getTime();
  const end = assignment.end_at ? new Date(assignment.end_at).getTime() : Number.POSITIVE_INFINITY;
  const timestamp = at.getTime();
  return start <= timestamp && timestamp < end;
}

export function documentState(
  expiresAt: string | null | undefined,
  at = new Date(),
  warningDays = 30,
): DocumentState {
  if (!expiresAt) return "missing";
  const expiry = new Date(`${expiresAt}T23:59:59`).getTime();
  const now = at.getTime();
  if (expiry < now) return "expired";
  if (expiry <= now + warningDays * 86_400_000) return "expiring";
  return "valid";
}

export function vehicleDocumentSummary(
  vehicle: Pick<
    CanonicalVehicle,
    "roadworthy_expiry_date" | "license_disc_expiry_date" | "insurance_expiry_date"
  >,
  documents: VehicleDocument[] = [],
  at = new Date(),
): Record<"roadworthy" | "license_disc" | "insurance", DocumentState> {
  const current = (type: VehicleDocumentType) =>
    documents.find((document) => document.document_type === type && document.is_current);

  return {
    roadworthy: documentState(current("roadworthy")?.expires_at ?? vehicle.roadworthy_expiry_date, at),
    license_disc: documentState(
      current("license_disc")?.expires_at ?? vehicle.license_disc_expiry_date,
      at,
    ),
    insurance: documentState(current("insurance")?.expires_at ?? vehicle.insurance_expiry_date, at),
  };
}

export function serviceState(
  vehicle: Pick<
    CanonicalVehicle,
    "current_odometer_km" | "next_service_due_km" | "service_interval_km" | "last_service_km"
  >,
  dueSoonKm = 1_000,
): ServiceState {
  const current = Number(vehicle.current_odometer_km ?? 0);
  const due = vehicle.next_service_due_km == null ? null : Number(vehicle.next_service_due_km);
  if (due != null) {
    if (current >= due) return "overdue";
    if (due - current <= dueSoonKm) return "due_soon";
    return "current";
  }

  const last = vehicle.last_service_km == null ? null : Number(vehicle.last_service_km);
  const interval = Number(vehicle.service_interval_km ?? 0);
  if (last == null || interval <= 0) return "unknown";
  const inferredDue = last + interval;
  if (current >= inferredDue) return "overdue";
  if (inferredDue - current <= dueSoonKm) return "due_soon";
  return "current";
}

export function vehicleDisplayName(vehicle: Pick<CanonicalVehicle, "vehicle_name" | "license_plate">) {
  return `${vehicle.vehicle_name} · ${vehicle.license_plate}`;
}

export function accessibilityLabels(vehicle: CanonicalVehicle): string[] {
  const labels: string[] = [];
  if (vehicle.wheelchair_accessible) labels.push("Wheelchair accessible");
  if (vehicle.ramp_or_lift_available) labels.push("Ramp or lift");
  if (Number(vehicle.wheelchair_capacity ?? 0) > 0) {
    labels.push(`${vehicle.wheelchair_capacity} wheelchair space${vehicle.wheelchair_capacity === 1 ? "" : "s"}`);
  }
  if (Array.isArray(vehicle.accessibility_features)) {
    for (const feature of vehicle.accessibility_features) {
      if (typeof feature === "string" && !labels.includes(feature)) labels.push(feature);
    }
  }
  return labels;
}
