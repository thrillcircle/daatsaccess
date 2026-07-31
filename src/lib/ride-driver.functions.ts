import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { sanitizeDriverRide, type DriverSafeRide } from "@/lib/driver-ride-projection";

const RideIdInput = z.object({ rideId: z.string().uuid() });

/**
 * All Driver ride transitions run through protected SECURITY DEFINER database
 * operations that return an explicit safe projection. The response is
 * sanitized again here so no financial field can ever reach a Driver client.
 */
async function callDriverRpc(
  supabase: {
    rpc: (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
  },
  fn: string,
  args: Record<string, unknown>,
): Promise<DriverSafeRide> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Transition was rejected");
  return sanitizeDriverRide(data);
}

/** Atomically claim a `requested` ride for the current driver. */
export const acceptRide = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RideIdInput.parse(d))
  .handler(async ({ data, context }) =>
    callDriverRpc(context.supabase, "driver_accept_ride", { p_ride_id: data.rideId }),
  );

/** Start pickup navigation for a previously accepted scheduled ride. */
export const startScheduledPickup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RideIdInput.parse(d))
  .handler(async ({ data, context }) =>
    callDriverRpc(context.supabase, "driver_start_scheduled_pickup", {
      p_ride_id: data.rideId,
    }),
  );

/** Driver confirms they've arrived at the pickup point. */
export const markArrived = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RideIdInput.parse(d))
  .handler(async ({ data, context }) =>
    callDriverRpc(context.supabase, "driver_mark_arrived", { p_ride_id: data.rideId }),
  );

/** Begin the passenger-carrying trip. */
export const startTrip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RideIdInput.parse(d))
  .handler(async ({ data, context }) =>
    callDriverRpc(context.supabase, "driver_start_trip", { p_ride_id: data.rideId }),
  );

const CompleteInput = z.object({
  rideId: z.string().uuid(),
  finalDistanceKm: z.number().positive().lte(2000).optional(),
});

/** Complete the trip. Duration and final distance are computed server-side. */
export const completeTrip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CompleteInput.parse(d))
  .handler(async ({ data, context }) =>
    callDriverRpc(context.supabase, "driver_complete_trip", {
      p_ride_id: data.rideId,
      p_final_distance_km: data.finalDistanceKm ?? null,
    }),
  );
