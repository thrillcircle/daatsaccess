import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  asRows,
  type OperationAssignment,
  type OperationRun,
  type OperationStatus,
} from "@/lib/operations";
import {
  DRIVER_TERMINAL_OPERATION_STATUSES,
  
  DRIVER_UPCOMING_ASSIGNMENT_STATUSES,
  type Ride,
} from "@/components/driver/driver-utils";

/**
 * Explicit, non-financial column list. Driver views must never read
 * estimated_price, estimate_snapshot or pricing_version_id.
 */
export const DRIVER_RIDE_COLUMNS = [
  "id",
  "status",
  "request_type",
  "scheduled_at",
  "pickup_address",
  "destination_address",
  "pickup_lat",
  "pickup_lng",
  "destination_lat",
  "destination_lng",
  "distance_km",
  "actual_distance_km",
  "actual_duration_seconds",
  "started_at",
  "completed_at",
  "created_at",
  "updated_at",
  "passenger_id",
  "vehicle_id",
  "route_version",
  "last_route_updated_at",
  "service_booking_id",
].join(", ");

export type DriverRideLite = Pick<
  Ride,
  | "id"
  | "status"
  | "request_type"
  | "scheduled_at"
  | "pickup_address"
  | "destination_address"
  | "pickup_lat"
  | "pickup_lng"
  | "destination_lat"
  | "destination_lng"
  | "distance_km"
  | "actual_distance_km"
  | "actual_duration_seconds"
  | "started_at"
  | "completed_at"
  | "created_at"
  | "updated_at"
  | "passenger_id"
  | "vehicle_id"
  | "route_version"
  | "last_route_updated_at"
  | "service_booking_id"
>;

export type DriverWorkItem = {
  key: string;
  kind: "ride" | "operation";
  reference: string;
  startAt: string | null;
  endAt: string | null;
  pickup: string | null;
  destination: string | null;
  serviceType: string;
  status: string;
  operationStatus?: OperationStatus;
  assignmentStatus?: string;
  acknowledged?: boolean;
  vehicleLabel: string | null;
  accessibility: string[];
  scheduleChanged: boolean;
  rideId: string | null;
  runId: string | null;
  distanceKm: number | null;
  durationSeconds: number | null;
};

async function loadVehicleLabels(
  fleetIds: string[],
  profileIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  await Promise.all([
    (async () => {
      if (!fleetIds.length) return;
      const { data } = await supabase
        .from("fleet_vehicles")
        .select("id, make, model, registration_number")
        .in("id", fleetIds);
      for (const v of data ?? []) {
        map.set(v.id, [v.make, v.model].filter(Boolean).join(" ") || v.registration_number);
      }
    })(),
    (async () => {
      if (!profileIds.length) return;
      const { data } = await supabase
        .from("vehicle_profiles")
        .select("id, make, model, license_plate")
        .in("id", profileIds);
      for (const v of data ?? []) {
        map.set(v.id, [v.make, v.model].filter(Boolean).join(" ") || v.license_plate);
      }
    })(),
  ]);
  return map;
}

function accessibilityFlags(run: OperationRun): string[] {
  const flags: string[] = [];
  if ((run.wheelchair_count ?? 0) > 0) flags.push(`${run.wheelchair_count} wheelchair`);
  const req = run.accessibility_requirements;
  if (Array.isArray(req)) {
    for (const r of req) if (typeof r === "string") flags.push(r);
  } else if (req && typeof req === "object") {
    for (const [k, v] of Object.entries(req as Record<string, unknown>)) {
      if (v === true) flags.push(k.replaceAll("_", " "));
    }
  }
  return flags;
}

function rideItem(r: DriverRideLite, vehicles: Map<string, string>): DriverWorkItem {
  return {
    key: `ride:${r.id}`,
    kind: "ride",
    reference: `Ride ${r.id.slice(0, 8)}`,
    startAt: r.scheduled_at ?? r.created_at,
    endAt: r.completed_at,
    pickup: r.pickup_address,
    destination: r.destination_address,
    serviceType: r.request_type === "scheduled" ? "Scheduled transport" : "Transport",
    status: r.status,
    vehicleLabel: r.vehicle_id ? (vehicles.get(r.vehicle_id) ?? "Assigned vehicle") : null,
    accessibility: [],
    scheduleChanged: (r.route_version ?? 1) > 1,
    rideId: r.id,
    runId: null,
    distanceKm: Number(r.actual_distance_km ?? r.distance_km) || null,
    durationSeconds: r.actual_duration_seconds ?? null,
  };
}

function runItem(
  run: OperationRun,
  assignment: OperationAssignment | undefined,
  vehicles: Map<string, string>,
): DriverWorkItem {
  const vehicleId = assignment?.vehicle_id ?? null;
  return {
    key: `run:${run.id}`,
    kind: "operation",
    reference: run.run_reference,
    startAt: run.planned_start_at ?? run.actual_start_at,
    endAt: run.actual_end_at ?? run.planned_end_at,
    pickup: run.pickup_address,
    destination: run.destination_address,
    serviceType: run.service_type || run.run_type,
    status: run.operational_status,
    operationStatus: run.operational_status,
    assignmentStatus: assignment?.status,
    acknowledged: assignment?.status === "acknowledged",
    vehicleLabel: vehicleId ? (vehicles.get(vehicleId) ?? "Assigned vehicle") : null,
    accessibility: accessibilityFlags(run),
    scheduleChanged:
      !!run.planned_start_at && !!run.actual_start_at && run.actual_start_at !== run.planned_start_at,
    rideId: run.ride_id,
    runId: run.id,
    distanceKm: null,
    durationSeconds: null,
  };
}

async function fetchAssignedRuns(driverId: string, assignmentStatuses: readonly string[]) {
  const { data: assignmentRows } = await supabase
    .from("operation_run_assignments")
    .select("*")
    .eq("driver_user_id", driverId)
    .in("status", assignmentStatuses as string[]);
  const assignments = asRows<OperationAssignment>(assignmentRows);
  const runIds = Array.from(new Set(assignments.map((a) => a.operation_run_id)));
  if (!runIds.length) return { assignments, runs: [] as OperationRun[] };
  const { data: runRows } = await supabase.from("operation_runs").select("*").in("id", runIds);
  return { assignments, runs: asRows<OperationRun>(runRows) };
}

/** Non-terminal future work assigned to the signed-in Driver. */
export function useDriverUpcoming(driverId: string | undefined) {
  const [items, setItems] = useState<DriverWorkItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!driverId) return;
    setLoading(true);
    const [{ data: rideRows }, { assignments, runs }] = await Promise.all([
      supabase
        .from("rides")
        .select(DRIVER_RIDE_COLUMNS)
        .eq("driver_id", driverId)
        .eq("status", "accepted")
        .order("scheduled_at", { ascending: true, nullsFirst: false }),
      fetchAssignedRuns(driverId, DRIVER_UPCOMING_ASSIGNMENT_STATUSES),
    ]);
    const rides = (rideRows ?? []) as unknown as DriverRideLite[];
    const openRuns = runs.filter(
      (r) =>
        !(DRIVER_TERMINAL_OPERATION_STATUSES as readonly string[]).includes(r.operational_status),
    );
    const vehicles = await loadVehicleLabels(
      assignments.map((a) => a.vehicle_id).filter((v): v is string => !!v),
      rides.map((r) => r.vehicle_id).filter((v): v is string => !!v),
    );
    const assignmentByRun = new Map(assignments.map((a) => [a.operation_run_id, a]));
    const rideIdsInRuns = new Set(openRuns.map((r) => r.ride_id).filter(Boolean));
    const merged = [
      ...openRuns.map((r) => runItem(r, assignmentByRun.get(r.id), vehicles)),
      ...rides.filter((r) => !rideIdsInRuns.has(r.id)).map((r) => rideItem(r, vehicles)),
    ].sort(
      (a, b) => new Date(a.startAt ?? 0).getTime() - new Date(b.startAt ?? 0).getTime(),
    );
    setItems(merged);
    setLoading(false);
  }, [driverId]);

  useEffect(() => {
    void load();
    if (!driverId) return;
    const channel = supabase
      .channel(`driver-upcoming-work-${driverId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rides", filter: `driver_id=eq.${driverId}` },
        () => void load(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "operation_run_assignments",
          filter: `driver_user_id=eq.${driverId}`,
        },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [driverId, load]);

  return { items, loading, reload: load };
}

/** Terminal Driver work only. */
export function useDriverHistory(driverId: string | undefined) {
  const [items, setItems] = useState<DriverWorkItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!driverId) return;
    setLoading(true);
    const [{ data: rideRows }, { assignments, runs }] = await Promise.all([
      supabase
        .from("rides")
        .select(DRIVER_RIDE_COLUMNS)
        .eq("driver_id", driverId)
        .in("status", ["completed", "cancelled"])
        .order("completed_at", { ascending: false, nullsFirst: false })
        .limit(200),
      fetchAssignedRuns(driverId, [
        "assigned",
        "acknowledged",
        "completed",
        "released",
        "declined",
      ]),
    ]);
    const rides = (rideRows ?? []) as unknown as DriverRideLite[];
    const terminalRuns = runs.filter((r) =>
      (DRIVER_TERMINAL_OPERATION_STATUSES as readonly string[]).includes(r.operational_status),
    );
    const vehicles = await loadVehicleLabels(
      assignments.map((a) => a.vehicle_id).filter((v): v is string => !!v),
      rides.map((r) => r.vehicle_id).filter((v): v is string => !!v),
    );
    const assignmentByRun = new Map(assignments.map((a) => [a.operation_run_id, a]));
    const rideIdsInRuns = new Set(terminalRuns.map((r) => r.ride_id).filter(Boolean));
    const merged = [
      ...terminalRuns.map((r) => runItem(r, assignmentByRun.get(r.id), vehicles)),
      ...rides.filter((r) => !rideIdsInRuns.has(r.id)).map((r) => rideItem(r, vehicles)),
    ].sort(
      (a, b) =>
        new Date(b.endAt ?? b.startAt ?? 0).getTime() -
        new Date(a.endAt ?? a.startAt ?? 0).getTime(),
    );
    setItems(merged);
    setLoading(false);
  }, [driverId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { items, loading, reload: load };
}
