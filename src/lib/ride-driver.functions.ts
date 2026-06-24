import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const RideIdInput = z.object({ rideId: z.string().uuid() });

/**
 * Atomically claim a `requested` ride for the current driver.
 * The conditional update (status=requested AND driver_id IS NULL) guarantees
 * only one driver wins. We then advance to `driver_arriving` so the pickup
 * navigation phase begins immediately. Both transitions are logged.
 */
export const acceptRide = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RideIdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const nowIso = new Date().toISOString();

    // Atomic claim — only succeeds if still requested + unassigned.
    const { data: claimed, error: claimErr } = await supabase
      .from("rides")
      .update({ driver_id: userId, status: "accepted", accepted_at: nowIso })
      .eq("id", data.rideId)
      .eq("status", "requested")
      .is("driver_id", null)
      .select()
      .maybeSingle();
    if (claimErr) throw new Error(claimErr.message);
    if (!claimed) throw new Error("This ride was just taken by another driver");

    await supabase.from("ride_status_events").insert({
      ride_id: claimed.id,
      changed_by: userId,
      previous_status: "requested",
      new_status: "accepted",
    });

    // For scheduled rides that are still more than 30 minutes away, keep
    // status at "accepted" so the driver doesn't enter pickup navigation
    // early. The driver advances via startScheduledPickup when pickup nears.
    const PICKUP_WINDOW_MS = 30 * 60 * 1000;
    const scheduledFuture =
      claimed.request_type === "scheduled" &&
      claimed.scheduled_at != null &&
      new Date(claimed.scheduled_at).getTime() - Date.now() > PICKUP_WINDOW_MS;
    if (scheduledFuture) {
      return claimed;
    }

    // Advance straight to driver_arriving (pickup phase).
    const { data: arriving, error: advErr } = await supabase
      .from("rides")
      .update({ status: "driver_arriving" })
      .eq("id", claimed.id)
      .eq("driver_id", userId)
      .select()
      .maybeSingle();
    if (advErr) throw new Error(advErr.message);

    if (arriving) {
      await supabase.from("ride_status_events").insert({
        ride_id: claimed.id,
        changed_by: userId,
        previous_status: "accepted",
        new_status: "driver_arriving",
      });
    }
    return arriving ?? claimed;
  });

/**
 * Manually start pickup navigation for a previously accepted scheduled ride.
 * Allowed only when the pickup time is within the 30-minute pickup window.
 */
export const startScheduledPickup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RideIdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const PICKUP_WINDOW_MS = 30 * 60 * 1000;

    const { data: existing, error: getErr } = await supabase
      .from("rides")
      .select("*")
      .eq("id", data.rideId)
      .eq("driver_id", userId)
      .eq("status", "accepted")
      .maybeSingle();
    if (getErr) throw new Error(getErr.message);
    if (!existing) throw new Error("Ride not found or not in accepted state");
    if (
      existing.request_type === "scheduled" &&
      existing.scheduled_at != null &&
      new Date(existing.scheduled_at).getTime() - Date.now() > PICKUP_WINDOW_MS
    ) {
      throw new Error("Pickup navigation opens 30 minutes before the scheduled time");
    }

    const { data: arriving, error: advErr } = await supabase
      .from("rides")
      .update({ status: "driver_arriving" })
      .eq("id", existing.id)
      .eq("driver_id", userId)
      .eq("status", "accepted")
      .select()
      .maybeSingle();
    if (advErr) throw new Error(advErr.message);
    if (!arriving) throw new Error("Could not start pickup navigation");

    await supabase.from("ride_status_events").insert({
      ride_id: arriving.id,
      changed_by: userId,
      previous_status: "accepted",
      new_status: "driver_arriving",
    });
    return arriving;
  });

/**
 * Driver confirms they've arrived at the pickup point.
 */
export const markArrived = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RideIdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("rides")
      .update({ status: "arrived", driver_arrived_at: new Date().toISOString() })
      .eq("id", data.rideId)
      .eq("driver_id", userId)
      .in("status", ["accepted", "driver_arriving"])
      .select()
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Cannot mark arrived in current state");
    await supabase.from("ride_status_events").insert({
      ride_id: row.id,
      changed_by: userId,
      previous_status: "driver_arriving",
      new_status: "arrived",
    });
    return row;
  });

/**
 * Begin the passenger-carrying trip.
 */
export const startTrip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RideIdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const nowIso = new Date().toISOString();
    const { data: row, error } = await supabase
      .from("rides")
      .update({ status: "in_progress", started_at: nowIso })
      .eq("id", data.rideId)
      .eq("driver_id", userId)
      .eq("status", "arrived")
      .select()
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Mark arrived before starting the trip");
    await supabase.from("ride_status_events").insert({
      ride_id: row.id,
      changed_by: userId,
      previous_status: "arrived",
      new_status: "in_progress",
    });
    return row;
  });

const CompleteInput = z.object({
  rideId: z.string().uuid(),
  finalDistanceKm: z.number().positive().lte(2000).optional(),
});

/**
 * Complete the trip. Computes actual_duration_seconds from started_at and
 * persists the final distance if the driver supplied a measured value.
 */
export const completeTrip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CompleteInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: ride, error: rErr } = await supabase
      .from("rides")
      .select("*")
      .eq("id", data.rideId)
      .maybeSingle();
    if (rErr) throw new Error(rErr.message);
    if (!ride || ride.driver_id !== userId) throw new Error("Not authorized");
    if (ride.status !== "in_progress") throw new Error("Trip is not in progress");

    const completedAt = new Date();
    const startedAt = ride.started_at ? new Date(ride.started_at) : null;
    const actualSeconds = startedAt
      ? Math.max(0, Math.round((completedAt.getTime() - startedAt.getTime()) / 1000))
      : null;

    const { data: row, error } = await supabase
      .from("rides")
      .update({
        status: "completed",
        completed_at: completedAt.toISOString(),
        actual_duration_seconds: actualSeconds,
        actual_distance_km: data.finalDistanceKm ?? ride.distance_km,
      })
      .eq("id", ride.id)
      .eq("driver_id", userId)
      .eq("status", "in_progress")
      .select()
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Could not complete trip");
    await supabase.from("ride_status_events").insert({
      ride_id: row.id,
      changed_by: userId,
      previous_status: "in_progress",
      new_status: "completed",
    });
    return row;
  });
