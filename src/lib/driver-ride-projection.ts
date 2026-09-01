/**
 * Server-authoritative Driver ride projection (Phase 5 closeout).
 *
 * Drivers no longer read `public.rides` directly. Every Driver-facing ride
 * payload — reads and mutation responses — passes through this explicit safe
 * projection so no financial field can ever reach a Driver client.
 */

/** The only ride fields a Driver may ever receive. */
export const DRIVER_SAFE_RIDE_FIELDS = [
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
  "route_stops",
  "distance_km",
  "actual_distance_km",
  "estimated_duration_seconds",
  "actual_duration_seconds",
  "accepted_at",
  "driver_arrived_at",
  "started_at",
  "completed_at",
  "created_at",
  "updated_at",
  "passenger_id",
  "driver_id",
  "vehicle_id",
  "route_version",
  "last_route_updated_at",
  "service_booking_id",
  "itinerary_item_id",
  "leg_sequence",
  "day_number",
] as const;

export type DriverSafeRideField = (typeof DRIVER_SAFE_RIDE_FIELDS)[number];

/** Keys that must never appear in a Driver-facing payload. */
export const DRIVER_PROHIBITED_RIDE_KEYS = [
  "estimated_price",
  "pricing_version_id",
  "estimate_snapshot",
  "quote_total",
  "total_amount",
  "deposit_amount",
  "deposit_status",
  "margin",
  "adjustments",
  "commission",
  "earnings",
  "payment_status",
  "amount",
  "price",
  "fare",
] as const;

export type DriverSafeRide = {
  id: string;
  status: string;
  request_type: string | null;
  scheduled_at: string | null;
  pickup_address: string;
  destination_address: string;
  pickup_lat: number;
  pickup_lng: number;
  destination_lat: number;
  destination_lng: number;
  route_stops: RideStop[];
  distance_km: number;
  actual_distance_km: number | null;
  estimated_duration_seconds: number | null;
  actual_duration_seconds: number | null;
  accepted_at: string | null;
  driver_arrived_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  passenger_id: string;
  driver_id: string | null;
  vehicle_id: string | null;
  route_version: number | null;
  last_route_updated_at: string | null;
  service_booking_id: string | null;
  itinerary_item_id: string | null;
  leg_sequence: number | null;
  day_number: number | null;
};

/**
 * Copy ONLY the allowed fields off an arbitrary payload. Anything else —
 * including any current or future financial column — is dropped.
 */
export function sanitizeDriverRide(raw: unknown): DriverSafeRide {
  const src = (raw ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of DRIVER_SAFE_RIDE_FIELDS) {
    out[key] = src[key] ?? null;
  }
  return out as unknown as DriverSafeRide;
}

export function sanitizeDriverRides(raw: unknown): DriverSafeRide[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(sanitizeDriverRide);
}

/** Test/runtime assertion helper: true when no prohibited key is present. */
export function hasNoFinancialFields(payload: unknown): boolean {
  if (payload == null || typeof payload !== "object") return true;
  if (Array.isArray(payload)) return payload.every(hasNoFinancialFields);
  const keys = Object.keys(payload as Record<string, unknown>);
  return !keys.some((k) => (DRIVER_PROHIBITED_RIDE_KEYS as readonly string[]).includes(k));
}
