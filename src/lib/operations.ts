import { supabase } from "@/integrations/supabase/client";

/**
 * Typed client used by the Phase 5 operations UI. The generated Database types
 * now include the operational schema, so no casting bridge is required.
 */
export const operationsDb = supabase;

export type OperationStatus =
  | "scheduled"
  | "ready"
  | "dispatched"
  | "driver_en_route"
  | "driver_arrived"
  | "passenger_on_board"
  | "in_service"
  | "waiting"
  | "completed"
  | "cancelled"
  | "passenger_no_show"
  | "driver_no_show"
  | "failed"
  | "interrupted";

export type DispatchStatus =
  | "not_required"
  | "pending"
  | "offered"
  | "assigned"
  | "acknowledged"
  | "rejected"
  | "expired"
  | "manually_assigned";

export type PlanningStatus =
  | "unplanned"
  | "planning"
  | "planned"
  | "validation_failed"
  | "ready_for_dispatch"
  | "cancelled";

export type OperationRun = {
  id: string;
  run_reference: string;
  operation_plan_id: string | null;
  source_type: "ride" | "service_booking" | "itinerary_item";
  source_id: string;
  ride_id: string | null;
  service_booking_id: string | null;
  itinerary_item_id: string | null;
  passenger_id: string;
  run_type: string;
  service_type: string;
  pickup_address: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  destination_address: string | null;
  destination_lat: number | null;
  destination_lng: number | null;
  planned_start_at: string | null;
  planned_end_at: string | null;
  actual_start_at: string | null;
  actual_end_at: string | null;
  passenger_count: number;
  wheelchair_count: number;
  accessibility_requirements: unknown;
  planning_status: PlanningStatus;
  dispatch_status: DispatchStatus;
  operational_status: OperationStatus;
  priority: "low" | "normal" | "high" | "urgent";
  is_verification_record: boolean;
  row_version: number;
  created_at: string;
  updated_at: string;
};

export type OperationPlan = {
  id: string;
  plan_reference: string;
  service_booking_id: string;
  status: "draft" | "validation_failed" | "ready" | "published" | "cancelled";
  validation_snapshot: unknown;
  row_version: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

export type OperationAssignment = {
  id: string;
  operation_run_id: string;
  resource_type: "driver" | "vehicle" | "companion";
  driver_user_id: string | null;
  vehicle_id: string | null;
  companion_id: string | null;
  planned_start_at: string;
  planned_end_at: string;
  status:
    | "proposed"
    | "reserved"
    | "assigned"
    | "acknowledged"
    | "declined"
    | "released"
    | "completed";
  assignment_source: string;
  acknowledgement_deadline: string | null;
  acknowledged_at: string | null;
  declined_at: string | null;
  decline_reason: string | null;
  released_at: string | null;
  release_reason: string | null;
  row_version: number;
  created_at: string;
  updated_at: string;
};

export type DispatchOffer = {
  id: string;
  operation_run_id: string;
  ride_id: string | null;
  driver_user_id: string;
  vehicle_id: string | null;
  dispatch_wave: number;
  status: "offered" | "accepted" | "declined" | "expired" | "cancelled" | "lost";
  offered_at: string;
  expires_at: string;
  accepted_at: string | null;
  declined_at: string | null;
  response_reason: string | null;
  row_version: number;
};

export type OperationalAlert = {
  id: string;
  operation_run_id: string | null;
  alert_type: string;
  severity: "info" | "warning" | "critical";
  status: "open" | "acknowledged" | "resolved" | "dismissed";
  title: string;
  details: unknown;
  created_at: string;
  updated_at: string;
};

export type OperationalIncident = {
  id: string;
  incident_reference: string;
  operation_run_id: string | null;
  incident_type: string;
  severity: "low" | "medium" | "high" | "critical";
  status: "open" | "investigating" | "contained" | "resolved" | "closed";
  title: string;
  internal_notes: string | null;
  passenger_visible_summary: string | null;
  created_at: string;
  updated_at: string;
};

export type PassengerOperation = {
  id: string;
  run_reference: string;
  ride_id?: string | null;
  service_booking_id?: string | null;
  run_type: string;
  service_type: string;
  planned_start_at: string | null;
  planned_end_at: string | null;
  actual_start_at: string | null;
  actual_end_at: string | null;
  status: OperationStatus;
  pickup_address: string | null;
  destination_address: string | null;
  driver?: {
    user_id: string;
    full_name: string | null;
    profile_photo_url: string | null;
    assignment_status: string;
  } | null;
  vehicle?: {
    id: string;
    vehicle_name: string;
    make: string | null;
    model: string | null;
    license_plate: string;
    wheelchair_accessible: boolean;
    ramp_or_lift_available: boolean;
  } | null;
  timeline?: Array<{ event_type: string; reason: string | null; created_at: string }>;
  incident_updates?: Array<{
    incident_reference: string;
    type: string;
    severity: string;
    status: string;
    summary: string;
    created_at: string;
  }>;
};

export const OPERATION_STATUS_LABEL: Record<OperationStatus, string> = {
  scheduled: "Scheduled",
  ready: "Ready",
  dispatched: "Dispatched",
  driver_en_route: "Driver en route",
  driver_arrived: "Driver arrived",
  passenger_on_board: "Passenger on board",
  in_service: "In service",
  waiting: "Waiting",
  completed: "Completed",
  cancelled: "Cancelled",
  passenger_no_show: "Passenger no-show",
  driver_no_show: "Driver no-show",
  failed: "Failed",
  interrupted: "Interrupted",
};

export const DISPATCH_STATUS_LABEL: Record<DispatchStatus, string> = {
  not_required: "Not required",
  pending: "Pending",
  offered: "Offers sent",
  assigned: "Assigned",
  acknowledged: "Acknowledged",
  rejected: "Rejected",
  expired: "Offers expired",
  manually_assigned: "Manually assigned",
};

export function formatOperationTime(value: string | null, options?: Intl.DateTimeFormatOptions) {
  if (!value) return "Not scheduled";
  return new Date(value).toLocaleString("en-ZA", {
    timeZone: "Africa/Johannesburg",
    dateStyle: "medium",
    timeStyle: "short",
    ...options,
  });
}

export function locationFreshness(value: string | null | undefined, now = Date.now()) {
  if (!value) return { state: "unavailable" as const, minutes: null };
  const minutes = Math.max(0, (now - new Date(value).getTime()) / 60_000);
  if (minutes <= 5) return { state: "fresh" as const, minutes };
  if (minutes <= 15) return { state: "delayed" as const, minutes };
  return { state: "stale" as const, minutes };
}

export function nextDriverActions(status: OperationStatus): OperationStatus[] {
  const transitions: Partial<Record<OperationStatus, OperationStatus[]>> = {
    scheduled: ["ready", "driver_en_route"],
    ready: ["driver_en_route"],
    dispatched: ["driver_en_route"],
    driver_en_route: ["driver_arrived", "interrupted"],
    driver_arrived: ["passenger_on_board", "in_service", "passenger_no_show", "interrupted"],
    passenger_on_board: ["in_service", "interrupted"],
    in_service: ["waiting", "completed", "interrupted"],
    waiting: ["in_service", "completed", "interrupted"],
    interrupted: ["in_service", "failed"],
  };
  return transitions[status] ?? [];
}

export function operationStatusVariant(status: OperationStatus) {
  if (["completed"].includes(status)) return "default" as const;
  if (["cancelled", "failed", "driver_no_show", "passenger_no_show"].includes(status)) {
    return "destructive" as const;
  }
  if (
    ["driver_en_route", "driver_arrived", "passenger_on_board", "in_service", "waiting"].includes(
      status,
    )
  ) {
    return "secondary" as const;
  }
  return "outline" as const;
}

export function asRows<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}
