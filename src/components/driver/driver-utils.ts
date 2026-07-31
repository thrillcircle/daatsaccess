import type { Database } from "@/integrations/supabase/types";

export type Ride = Database["public"]["Tables"]["rides"]["Row"];
export type DriverProfile = Database["public"]["Tables"]["driver_profiles"]["Row"];

export const PICKUP_WINDOW_MS = 30 * 60 * 1000;

export const isFarFutureScheduled = (r: Pick<Ride, "request_type" | "scheduled_at">) =>
  r.request_type === "scheduled" &&
  r.scheduled_at != null &&
  new Date(r.scheduled_at).getTime() - Date.now() > PICKUP_WINDOW_MS;

export function mapsNavUrl(lat: number, lng: number) {
  return `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${lat},${lng}`;
}

export function openMapsNav(lat: number, lng: number): Window | null {
  // Called synchronously inside the click handler to satisfy popup-blockers.
  return typeof window !== "undefined"
    ? window.open(mapsNavUrl(lat, lng), "_blank", "noopener,noreferrer")
    : null;
}

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function clockIn(minutes: number) {
  const d = new Date(Date.now() + minutes * 60_000);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function timeAgo(iso: string) {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

export function formatJoburg(iso: string): string {
  return new Date(iso).toLocaleString("en-ZA", {
    timeZone: "Africa/Johannesburg",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Operational statuses that represent finished (terminal) Driver work. */
export const DRIVER_TERMINAL_OPERATION_STATUSES = [
  "completed",
  "cancelled",
  "passenger_no_show",
  "driver_no_show",
  "failed",
] as const;

/** Operational statuses that represent future / not-yet-finished Driver work. */
export const DRIVER_UPCOMING_OPERATION_STATUSES = [
  "scheduled",
  "ready",
  "dispatched",
] as const;

/** Assignment statuses that are still live for the Driver. */
export const DRIVER_UPCOMING_ASSIGNMENT_STATUSES = [
  "proposed",
  "reserved",
  "assigned",
  "acknowledged",
] as const;

export const DRIVER_UPCOMING_RIDE_STATUSES = ["accepted"] as const;

export const DRIVER_TERMINAL_RIDE_STATUSES = ["completed", "cancelled"] as const;

export type DayBucket = "today" | "tomorrow" | "later";

export function dayBucket(iso: string | null, now = Date.now()): DayBucket {
  if (!iso) return "later";
  const d = new Date(iso);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const dayMs = 24 * 60 * 60 * 1000;
  const diffDays = Math.floor((d.getTime() - start.getTime()) / dayMs);
  if (diffDays <= 0) return "today";
  if (diffDays === 1) return "tomorrow";
  return "later";
}
