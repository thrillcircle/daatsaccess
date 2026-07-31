import { supabase } from "@/integrations/supabase/client";
import {
  sanitizeDriverRide,
  sanitizeDriverRides,
  type DriverSafeRide,
} from "@/lib/driver-ride-projection";

export type DriverRideScope = "all" | "active" | "upcoming" | "history";

/**
 * Read Driver work through the protected database projection.
 * `public.rides` is no longer directly readable by Drivers.
 */
export async function fetchDriverRides(
  scope: DriverRideScope,
  limit = 200,
): Promise<DriverSafeRide[]> {
  const { data, error } = await supabase.rpc("driver_rides", {
    p_scope: scope,
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  return sanitizeDriverRides(data);
}

export async function fetchDriverRide(rideId: string): Promise<DriverSafeRide | null> {
  const { data, error } = await supabase.rpc("driver_ride", { p_ride_id: rideId });
  if (error) throw new Error(error.message);
  return data ? sanitizeDriverRide(data) : null;
}

export async function cancelDriverRide(rideId: string): Promise<DriverSafeRide> {
  const { data, error } = await supabase.rpc("driver_cancel_ride", { p_ride_id: rideId });
  if (error) throw new Error(error.message);
  return sanitizeDriverRide(data);
}
