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
  call: PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<DriverSafeRide> {
  const { data, error } = await call;
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Transition was rejected");
  return sanitizeDriverRide(data);
}

/** Start pickup navigation for a previously accepted scheduled ride. */
export const startScheduledPickup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => RideIdInput.parse(d))
  .handler(async ({ data, context }) =>
    callDriverRpc(
      context.supabase.rpc("driver_start_scheduled_pickup", { p_ride_id: data.rideId }),
    ),
  );

/** Driver confirms they've arrived at the pickup point. */
export const markArrived = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => RideIdInput.parse(d))
  .handler(async ({ data, context }) =>
    callDriverRpc(context.supabase.rpc("driver_mark_arrived", { p_ride_id: data.rideId })),
  );

/** Begin the passenger-carrying trip. */
export const startTrip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => RideIdInput.parse(d))
  .handler(async ({ data, context }) =>
    callDriverRpc(context.supabase.rpc("driver_start_trip", { p_ride_id: data.rideId })),
  );

const CompleteInput = z.object({
  rideId: z.string().uuid(),
  finalDistanceKm: z.number().positive().lte(2000).optional(),
});

/** Complete the trip. Duration and final distance are computed server-side. */
export const completeTrip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => CompleteInput.parse(d))
  .handler(async ({ data, context }) =>
    callDriverRpc(
      context.supabase.rpc("driver_complete_trip", {
        p_ride_id: data.rideId,
        p_final_distance_km: data.finalDistanceKm,
      }),
    ),
  );
