import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type LiveLocationState = {
  status: "idle" | "starting" | "watching" | "denied" | "unavailable" | "error";
  lat?: number;
  lng?: number;
  heading?: number | null;
  accuracy?: number;
  updatedAt?: number;
  error?: string;
};

type Options = {
  /** Watch the user's GPS while `enabled` is true. */
  enabled: boolean;
  /** Identify the writer so the right rows are upserted. */
  userId: string | undefined;
  role: "driver" | "passenger";
  /** When set, also upsert into `ride_live_locations` for this ride. */
  rideId?: string | null;
  /** When true (driver only), also update `driver_profiles.current_lat/lng`. */
  updateDriverProfile?: boolean;
  /** Minimum ms between server upserts. Default 10s. */
  throttleMs?: number;
  /** Minimum meters of movement before an early update. Default 25m. */
  minDistanceMeters?: number;
};

function haversineMeters(a: [number, number], b: [number, number]) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Watches the device's GPS while `enabled` is true, and throttles updates to
 * Supabase. Writes the latest fix to `driver_profiles` (for drivers) and/or
 * `ride_live_locations` (for either role with an active ride).
 *
 * Designed as a single chokepoint so the network layer can later be swapped
 * for Supabase Broadcast without touching call sites.
 */
export function useLiveLocation(opts: Options): LiveLocationState {
  const {
    enabled,
    userId,
    role,
    rideId,
    updateDriverProfile,
    throttleMs = 10_000,
    minDistanceMeters = 25,
  } = opts;

  const [state, setState] = useState<LiveLocationState>({ status: "idle" });
  const lastSentAtRef = useRef(0);
  const lastSentPosRef = useRef<[number, number] | null>(null);
  const inflightRef = useRef(false);

  useEffect(() => {
    if (!enabled || !userId) {
      setState({ status: "idle" });
      return;
    }
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setState({ status: "unavailable", error: "Geolocation not supported" });
      return;
    }

    setState((s) => ({ ...s, status: "starting" }));

    const watchId = navigator.geolocation.watchPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng, accuracy, heading } = pos.coords;
        setState({
          status: "watching",
          lat,
          lng,
          accuracy,
          heading: heading ?? null,
          updatedAt: Date.now(),
        });

        const now = Date.now();
        const movedFar =
          lastSentPosRef.current
            ? haversineMeters(lastSentPosRef.current, [lat, lng]) >= minDistanceMeters
            : true;
        const timeReady = now - lastSentAtRef.current >= throttleMs;
        if (!(movedFar || timeReady) || inflightRef.current) return;

        inflightRef.current = true;
        try {
          const writes: Promise<unknown>[] = [];
          if (updateDriverProfile && role === "driver") {
            writes.push(
              Promise.resolve(
                supabase
                  .from("driver_profiles")
                  .update({
                    current_lat: lat,
                    current_lng: lng,
                    heading: heading ?? null,
                    location_accuracy: accuracy ?? null,
                    location_updated_at: new Date().toISOString(),
                  })
                  .eq("user_id", userId),
              ),
            );
          }
          if (rideId) {
            writes.push(
              Promise.resolve(
                supabase.from("ride_live_locations").upsert(
                  {
                    ride_id: rideId,
                    user_id: userId,
                    user_role: role,
                    latitude: lat,
                    longitude: lng,
                    heading: heading ?? null,
                    accuracy: accuracy ?? null,
                    updated_at: new Date().toISOString(),
                  },
                  { onConflict: "ride_id,user_id" },
                ),
              ),
            );
          }
          await Promise.all(writes);
          lastSentAtRef.current = now;
          lastSentPosRef.current = [lat, lng];
        } catch (err) {
          console.warn("live-location write failed", err);
        } finally {
          inflightRef.current = false;
        }
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setState({ status: "denied", error: "Location permission denied" });
        } else {
          setState({ status: "error", error: err.message });
        }
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15_000 },
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [enabled, userId, role, rideId, updateDriverProfile, throttleMs, minDistanceMeters]);

  return state;
}
