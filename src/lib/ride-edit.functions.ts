import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { estimatePrice } from "@/lib/pricing";

type RideUpdate = Database["public"]["Tables"]["rides"]["Update"];
type Json = Database["public"]["Tables"]["ride_change_log"]["Insert"]["new_values"];

const PointSchema = z.object({
  address: z.string().min(3).max(300),
  placeId: z.string().nullable().optional(),
  lat: z.number().finite().gte(-90).lte(90),
  lng: z.number().finite().gte(-180).lte(180),
});

const EditableStatus = [
  "requested",
  "accepted",
  "driver_arriving",
  "arrived",
  "in_progress",
] as const;

const PickupEditableStatus = new Set([
  "requested",
  "accepted",
  "driver_arriving",
]);

const InputSchema = z
  .object({
    rideId: z.string().uuid(),
    pickup: PointSchema.nullable().optional(),
    destination: PointSchema.nullable().optional(),
    distanceKm: z.number().positive().lte(2000),
    durationMin: z.number().int().nonnegative().nullable().optional(),
  })
  .refine((v) => v.pickup || v.destination, {
    message: "At least one of pickup or destination is required",
  });

export type RideEditInput = z.infer<typeof InputSchema>;

/**
 * Passenger-driven edit of an active trip. Enforces status-based rules,
 * recomputes the fare server-side, increments route_version, and inserts a
 * row into ride_change_log capturing previous and new values. The driver and
 * admin see the change via Realtime on ride_change_log.
 */
export const updateRideTrip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: ride, error: rideErr } = await supabase
      .from("rides")
      .select("*")
      .eq("id", data.rideId)
      .maybeSingle();
    if (rideErr) throw new Error(rideErr.message);
    if (!ride) throw new Error("Ride not found");
    if (ride.passenger_id !== userId) throw new Error("Not authorized");
    if (!EditableStatus.includes(ride.status as (typeof EditableStatus)[number])) {
      throw new Error("Trip can no longer be edited");
    }

    const wantsPickupChange = !!data.pickup;
    const wantsDestChange = !!data.destination;

    if (wantsPickupChange && !PickupEditableStatus.has(ride.status)) {
      throw new Error("Pickup can only be changed before the driver arrives");
    }

    const newPickup = data.pickup ?? {
      address: ride.pickup_address,
      placeId: ride.pickup_place_id,
      lat: ride.pickup_lat,
      lng: ride.pickup_lng,
    };
    const newDest = data.destination ?? {
      address: ride.destination_address,
      placeId: ride.destination_place_id,
      lat: ride.destination_lat,
      lng: ride.destination_lng,
    };

    const newPrice = estimatePrice(data.distanceKm);
    const newVersion = (ride.route_version ?? 1) + 1;
    const nowIso = new Date().toISOString();

    const previousValues: Record<string, unknown> = {};
    const newValues: Record<string, unknown> = {};
    if (wantsPickupChange) {
      previousValues.pickup_address = ride.pickup_address;
      previousValues.pickup_lat = ride.pickup_lat;
      previousValues.pickup_lng = ride.pickup_lng;
      previousValues.pickup_place_id = ride.pickup_place_id;
      newValues.pickup_address = newPickup.address;
      newValues.pickup_lat = newPickup.lat;
      newValues.pickup_lng = newPickup.lng;
      newValues.pickup_place_id = newPickup.placeId ?? null;
    }
    if (wantsDestChange) {
      previousValues.destination_address = ride.destination_address;
      previousValues.destination_lat = ride.destination_lat;
      previousValues.destination_lng = ride.destination_lng;
      previousValues.destination_place_id = ride.destination_place_id;
      newValues.destination_address = newDest.address;
      newValues.destination_lat = newDest.lat;
      newValues.destination_lng = newDest.lng;
      newValues.destination_place_id = newDest.placeId ?? null;
    }
    previousValues.distance_km = ride.distance_km;
    previousValues.estimated_price = ride.estimated_price;
    previousValues.estimated_duration_seconds = ride.estimated_duration_seconds;
    newValues.distance_km = data.distanceKm;
    newValues.estimated_price = newPrice;
    newValues.estimated_duration_seconds =
      data.durationMin != null ? data.durationMin * 60 : null;

    // Update the ride row (RLS scopes this to the passenger).
    const updatePayload: RideUpdate = {
      distance_km: data.distanceKm,
      estimated_price: newPrice,
      estimated_duration_seconds:
        data.durationMin != null ? data.durationMin * 60 : null,
      route_version: newVersion,
      last_route_updated_at: nowIso,
    };
    if (wantsPickupChange) {
      updatePayload.pickup_address = newPickup.address;
      updatePayload.pickup_lat = newPickup.lat;
      updatePayload.pickup_lng = newPickup.lng;
      updatePayload.pickup_place_id = newPickup.placeId ?? null;
    }
    if (wantsDestChange) {
      updatePayload.destination_address = newDest.address;
      updatePayload.destination_lat = newDest.lat;
      updatePayload.destination_lng = newDest.lng;
      updatePayload.destination_place_id = newDest.placeId ?? null;
    }

    const { data: updated, error: updateErr } = await supabase
      .from("rides")
      .update(updatePayload)
      .eq("id", ride.id)
      .eq("route_version", ride.route_version) // optimistic lock
      .select()
      .maybeSingle();
    if (updateErr) throw new Error(updateErr.message);
    if (!updated) throw new Error("Trip was updated by someone else — please retry");

    const changeType =
      wantsPickupChange && wantsDestChange
        ? "pickup_and_destination"
        : wantsPickupChange
          ? "pickup"
          : "destination";

    const { data: logRow, error: logErr } = await supabase
      .from("ride_change_log")
      .insert({
        ride_id: ride.id,
        changed_by: userId,
        change_type: changeType,
        previous_values: previousValues as Json,
        new_values: newValues as Json,
        route_version: newVersion,
      })
      .select()
      .single();
    if (logErr) {
      throw new Error(`Ride updated but change log failed: ${logErr.message}`);
    }

    return { ride: updated, change: logRow };
  });

/**
 * Driver acknowledgement of a trip change. RLS restricts updates to the
 * assigned driver of the parent ride.
 */
export const acknowledgeRideChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ changeId: z.string().uuid() }).parse(data),
  )
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
