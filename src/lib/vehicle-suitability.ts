import type { Database } from "@/integrations/supabase/types";
import { getVehicleAlerts, type VehicleAlert } from "@/lib/vehicle-alerts";

export type VehicleProfile = Database["public"]["Tables"]["vehicle_profiles"]["Row"];

export type TripNeeds = {
  passengerCount?: number | null;
  wheelchairCount?: number | null;
  requiresRampOrLift?: boolean | null;
};

export type SuitabilityReason = {
  label: string;
  severity: "block" | "warning";
};

export type Suitability = {
  vehicle: VehicleProfile;
  score: number; // higher = better. negative = unsuitable.
  blocking: SuitabilityReason[]; // hard mismatches (status, capacity, accessibility, expired docs)
  warnings: SuitabilityReason[]; // soft warnings (service due, doc expiring, already assigned)
  alerts: VehicleAlert[]; // raw maintenance/document alerts for display
  suitable: boolean; // no blocking reasons
};

export function scoreVehicleForTrip(
  v: VehicleProfile,
  needs: TripNeeds,
  alreadyAssignedRideIds: Set<string> | null = null,
  myRideId: string | null = null,
): Suitability {
  const alerts = getVehicleAlerts(v);
  const blocking: SuitabilityReason[] = [];
  const warnings: SuitabilityReason[] = [];

  // Status hard rules
  if (v.status === "out_of_service" || v.status === "retired") {
    blocking.push({ label: `Vehicle ${v.status.replace(/_/g, " ")}`, severity: "block" });
  }
  if (v.status === "in_maintenance") {
    warnings.push({ label: "Vehicle in maintenance", severity: "warning" });
  }

  // Capacity rules
  const pax = Number(needs.passengerCount ?? 0);
  if (pax > 0 && v.passenger_capacity != null && v.passenger_capacity < pax) {
    blocking.push({
      label: `Capacity ${v.passenger_capacity} < ${pax} pax`,
      severity: "block",
    });
  }

  const wc = Number(needs.wheelchairCount ?? 0);
  if (wc > 0) {
    if (!v.wheelchair_accessible) {
      blocking.push({ label: "Not wheelchair accessible", severity: "block" });
    } else if (v.wheelchair_capacity != null && v.wheelchair_capacity < wc) {
      blocking.push({
        label: `Wheelchair capacity ${v.wheelchair_capacity} < ${wc}`,
        severity: "block",
      });
    }
  }

  if (needs.requiresRampOrLift && !v.ramp_or_lift_available) {
    blocking.push({ label: "No ramp / lift", severity: "block" });
  }

  // Documents — expired blocks, expiring warns (alerts already encode the date logic).
  for (const a of alerts) {
    if (a.severity === "urgent") {
      // Expired roadworthy / insurance are hard blocks; expired license is a block too.
      if (/expired/i.test(a.label)) {
        blocking.push({ label: a.label, severity: "block" });
      } else if (/overdue/i.test(a.label)) {
        warnings.push({ label: a.label, severity: "warning" });
      }
    } else {
      warnings.push({ label: a.label, severity: "warning" });
    }
  }

  // Already assigned to a different active ride
  if (alreadyAssignedRideIds && alreadyAssignedRideIds.has(v.id) && !(myRideId && myRideId in {})) {
    warnings.push({ label: "Already assigned to another active trip", severity: "warning" });
  }

  // Scoring: prefer available vehicles with closest capacity match and no warnings.
  let score = 100;
  score -= blocking.length * 1000; // unsuitable
  score -= warnings.length * 10;
  if (v.status !== "active") score -= 5;
  // Prefer tighter capacity fit (don't send a 14-seater for 1 pax if a 4-seater is free).
  if (pax > 0 && v.passenger_capacity != null) {
    score -= Math.max(0, v.passenger_capacity - pax);
  }
  // Prefer dedicated wheelchair vehicles when wc>0
  if (wc > 0 && v.wheelchair_accessible) score += 5;
  // Prefer vehicles with an assigned driver (less coordination)
  if (v.assigned_driver_id) score += 2;

  return {
    vehicle: v,
    score,
    blocking,
    warnings,
    alerts,
    suitable: blocking.length === 0,
  };
}

export function rankVehiclesForTrip(
  vehicles: VehicleProfile[],
  needs: TripNeeds,
  alreadyAssignedVehicleIds: Set<string> | null = null,
  myRideId: string | null = null,
): Suitability[] {
  return vehicles
    .map((v) => scoreVehicleForTrip(v, needs, alreadyAssignedVehicleIds, myRideId))
    .sort((a, b) => b.score - a.score);
}
