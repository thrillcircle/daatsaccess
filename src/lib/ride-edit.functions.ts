import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { rpcNullable, type JsonValue } from "@/lib/pricing-api";

const PointSchema = z.object({
  address: z.string().min(3).max(300),
  placeId: z.string().nullable().optional(),
  lat: z.number().finite().gte(-90).lte(90),
  lng: z.number().finite().gte(-180).lte(180),
});

const InputSchema = z
  .object({
    rideId: z.string().uuid(),
    pickup: PointSchema.nullable().optional(),
    destination: PointSchema.nullable().optional(),
    distanceKm: z.number().positive().lte(2000),
    durationMin: z.number().int().nonnegative().nullable().optional(),
  })
  .refine((value) => value.pickup || value.destination, {
    message: "At least one of pickup or destination is required",
  });

export type RideEditInput = z.infer<typeof InputSchema>;

/**
 * Passenger-driven edit of an active trip. The database validates ownership and
 * state, resolves the original trip's effective published pricing version,
 * recalculates the estimate, updates the ride and writes the change log in one
 * transaction.
 */
export const updateRideTrip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { data: ride, error: rideError } = await context.supabase
      .from("rides")
      .select("id,passenger_id,route_version")
      .eq("id", data.rideId)
      .maybeSingle();
    if (rideError) throw new Error(rideError.message);
    if (!ride || ride.passenger_id !== context.userId) throw new Error("Not authorized");

    const { data: result, error } = await context.supabase.rpc("passenger_update_priced_ride_route", {
      p_ride_id: data.rideId,
      p_pickup: rpcNullable(data.pickup as unknown as JsonValue),
      p_destination: rpcNullable(data.destination as unknown as JsonValue),
      p_distance_km: data.distanceKm,
      p_duration_seconds: rpcNullable(data.durationMin != null ? data.durationMin * 60 : null),
      p_expected_route_version: ride.route_version ?? 1,
    });
    if (error) throw new Error(error.message);
    return result;
  });

/**
 * Driver acknowledgement of a trip change. RLS restricts updates to the
 * assigned driver of the parent ride.
 */
export const acknowledgeRideChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ changeId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("ride_change_log")
      .update({ acknowledged_by_driver_at: new Date().toISOString() })
      .eq("id", data.changeId)
      .is("acknowledged_by_driver_at", null)
      .select()
      .maybeSingle();
    if (error) throw new Error(error.message);
    return row;
  });
