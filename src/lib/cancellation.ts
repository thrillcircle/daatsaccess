/**
 * Pure cancellation-policy rules, mirroring `public.passenger_cancel_ride` and
 * `public.admin_cancel_ride`. Dependency-free so the automated suite can
 * exercise them without touching the backend.
 */

import type { RideStatus } from "@/lib/ride-rules";

export const CANCELLATION_CATEGORIES = [
  { value: "passenger_requested", label: "Passenger requested", charges: true },
  { value: "driver_failure", label: "Driver failure / no-show", charges: false },
  { value: "accident", label: "Accident", charges: false },
  { value: "vehicle_fault", label: "Vehicle fault", charges: false },
  { value: "operational", label: "DAATS operational", charges: false },
] as const;

export type CancellationCategory = (typeof CANCELLATION_CATEGORIES)[number]["value"];

export function categoryCharges(category: CancellationCategory): boolean {
  return CANCELLATION_CATEGORIES.find((c) => c.value === category)?.charges ?? false;
}

/** A passenger may only self-cancel while the request is still unaccepted. */
export function canPassengerCancel(status: RideStatus): boolean {
  return status === "requested";
}

/** Administrators may cancel anything that is not already finished. */
export function canAdminCancel(status: RideStatus): boolean {
  return status !== "completed" && status !== "cancelled";
}

export type LockedRates = {
  /** Locked per-kilometre rate from the trip's pricing snapshot. */
  perKmRate: number;
  /** Locked flat service/base fee from the trip's pricing snapshot. */
  serviceFee: number;
};

export type CancellationCharge = {
  actualDistanceKm: number;
  perKmRate: number;
  serviceFee: number;
  total: number;
};

/**
 * Passenger-requested cancellations pay for the distance already travelled at
 * the trip's locked kilometre rate plus the locked service fee. Every other
 * category (driver failure, accident, vehicle fault, DAATS operational)
 * charges the passenger R0.
 */
export function computeCancellationCharge(
  category: CancellationCategory,
  actualDistanceKm: number,
  rates: LockedRates,
): CancellationCharge {
  if (!categoryCharges(category)) {
    return { actualDistanceKm: 0, perKmRate: 0, serviceFee: 0, total: 0 };
  }
  const distance = Math.max(0, actualDistanceKm || 0);
  const total = Math.round((distance * rates.perKmRate + rates.serviceFee) * 100) / 100;
  return {
    actualDistanceKm: distance,
    perKmRate: rates.perKmRate,
    serviceFee: rates.serviceFee,
    total,
  };
}

type SnapshotLine = {
  calculation_type?: string;
  unit_price?: number | string;
  line_total?: number | string;
  calculation_order?: number;
};

/** Read the locked rates off a ride's stored estimate snapshot. Never guesses. */
export function lockedRatesFromSnapshot(snapshot: unknown): LockedRates {
  const lines = ((snapshot ?? {}) as { lines?: SnapshotLine[] }).lines;
  if (!Array.isArray(lines)) return { perKmRate: 0, serviceFee: 0 };
  const perKm = lines
    .filter((l) => l.calculation_type === "per_km")
    .sort((a, b) => (a.calculation_order ?? 0) - (b.calculation_order ?? 0))[0];
  const serviceFee = lines
    .filter((l) => l.calculation_type === "flat")
    .reduce((sum, l) => sum + Number(l.line_total ?? 0), 0);
  return { perKmRate: Number(perKm?.unit_price ?? 0), serviceFee };
}
