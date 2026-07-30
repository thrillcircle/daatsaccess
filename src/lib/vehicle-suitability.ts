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
  score: number;
  blocking: SuitabilityReason[];
  warnings: SuitabilityReason[];
  alerts: VehicleAlert[];
  suitable: boolean;
};

export function scoreVehicleForTrip(
  vehicle: VehicleProfile,
  needs: TripNeeds,
  alreadyAssignedVehicleIds: Set<string> | null = null,
): Suitability {
  const alerts = getVehicleAlerts(vehicle);
  const blocking: SuitabilityReason[] = [];
  const warnings: SuitabilityReason[] = [];

  if (vehicle.status === "out_of_service" || vehicle.status === "retired") {
    blocking.push({
      label: `Vehicle ${vehicle.status.replace(/_/g, " ")}`,
      severity: "block",
    });
  }
  if (vehicle.status === "in_maintenance") {
    warnings.push({ label: "Vehicle in maintenance", severity: "warning" });
  }

  const passengerCount = Number(needs.passengerCount ?? 0);
  if (
    passengerCount > 0 &&
    vehicle.passenger_capacity != null &&
    vehicle.passenger_capacity < passengerCount
  ) {
    blocking.push({
      label: `Capacity ${vehicle.passenger_capacity} < ${passengerCount} pax`,
      severity: "block",
    });
  }

  const wheelchairCount = Number(needs.wheelchairCount ?? 0);
  if (wheelchairCount > 0) {
    if (!vehicle.wheelchair_accessible) {
      blocking.push({ label: "Not wheelchair accessible", severity: "block" });
    } else if (
      vehicle.wheelchair_capacity != null &&
      vehicle.wheelchair_capacity < wheelchairCount
    ) {
      blocking.push({
        label: `Wheelchair capacity ${vehicle.wheelchair_capacity} < ${wheelchairCount}`,
        severity: "block",
      });
    }
  }

  if (needs.requiresRampOrLift && !vehicle.ramp_or_lift_available) {
    blocking.push({ label: "No ramp / lift", severity: "block" });
  }

  for (const alert of alerts) {
    if (alert.severity === "urgent") {
      if (/expired/i.test(alert.label)) {
        blocking.push({ label: alert.label, severity: "block" });
      } else if (/overdue/i.test(alert.label)) {
        warnings.push({ label: alert.label, severity: "warning" });
      }
    } else {
      warnings.push({ label: alert.label, severity: "warning" });
    }
  }

  if (alreadyAssignedVehicleIds?.has(vehicle.id)) {
    warnings.push({
      label: "Already assigned to another active trip",
      severity: "warning",
    });
  }

  let score = 100;
  score -= blocking.length * 1000;
  score -= warnings.length * 10;
  if (vehicle.status !== "active") score -= 5;
  if (passengerCount > 0 && vehicle.passenger_capacity != null) {
    score -= Math.max(0, vehicle.passenger_capacity - passengerCount);
  }
  if (wheelchairCount > 0 && vehicle.wheelchair_accessible) score += 5;
  if (vehicle.assigned_driver_id) score += 2;

  return {
    vehicle,
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
  _currentRideId: string | null = null,
): Suitability[] {
  return vehicles
    .map((vehicle) => scoreVehicleForTrip(vehicle, needs, alreadyAssignedVehicleIds))
    .sort((a, b) => b.score - a.score);
}
