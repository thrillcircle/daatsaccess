/**
 * Pure, side-effect-free ride business rules.
 *
 * Mirrors the server triggers in `enforce_ride_changes` and the editable-
 * status set used by `updateRideTrip`. Kept dependency-free so it can be
 * exercised by the automated test suite without touching Supabase.
 */

export type RideStatus =
  | "requested"
  | "accepted"
  | "driver_arriving"
  | "arrived"
  | "in_progress"
  | "completed"
  | "cancelled";

export const TERMINAL_STATUSES: ReadonlySet<RideStatus> = new Set([
  "completed",
  "cancelled",
]);

export const EDITABLE_STATUSES: ReadonlySet<RideStatus> = new Set([
  "requested",
  "accepted",
  "driver_arriving",
  "arrived",
  "in_progress",
]);

export const PICKUP_EDITABLE_STATUSES: ReadonlySet<RideStatus> = new Set([
  "requested",
  "accepted",
  "driver_arriving",
]);

/** Driver-side allowed status transitions (lifecycle). */
const DRIVER_TRANSITIONS: Record<RideStatus, ReadonlyArray<RideStatus>> = {
  requested: ["accepted"],
  accepted: ["driver_arriving", "cancelled"],
  driver_arriving: ["arrived", "cancelled"],
  arrived: ["in_progress", "cancelled"],
  in_progress: ["completed"],
  completed: [],
  cancelled: [],
};

export function isDriverTransitionAllowed(
  from: RideStatus,
  to: RideStatus,
): boolean {
  return DRIVER_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isPassengerTransitionAllowed(
  from: RideStatus,
  to: RideStatus,
): boolean {
  // Passenger may only cancel, and never from a terminal status.
  if (TERMINAL_STATUSES.has(from)) return false;
  return to === "cancelled";
}

export function isTripEditable(
  status: RideStatus,
  field: "pickup" | "destination",
): boolean {
  if (!EDITABLE_STATUSES.has(status)) return false;
  if (field === "pickup") return PICKUP_EDITABLE_STATUSES.has(status);
  return true;
}

export function isImmutableAfterCompletion(status: RideStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/**
 * Schedule validation: a scheduled pickup must lie at least
 * `minLeadMs` in the future (default 60 seconds), matching the UI rule in
 * `app.passenger.tsx`.
 */
export function isValidScheduleTime(
  scheduledAt: Date | string | null | undefined,
  now: Date = new Date(),
  minLeadMs = 60_000,
): boolean {
  if (scheduledAt == null) return false;
  const d = scheduledAt instanceof Date ? scheduledAt : new Date(scheduledAt);
  if (Number.isNaN(d.getTime())) return false;
  return d.getTime() - now.getTime() >= minLeadMs;
}
