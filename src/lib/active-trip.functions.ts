import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type DriverDetails = {
  userId: string;
  fullName: string | null;
  phone: string | null;
  avatarUrl: string | null;
  vehicleType: string | null;
  vehicleModel: string | null;
  licensePlate: string | null;
  avgRating: number | null;
};

/**
 * Returns the assigned driver's contact + vehicle details for a ride the
 * caller is the passenger on. Uses the service role to read across
 * `profiles` / `driver_profiles` while strictly authorizing on:
 *   - caller is passenger of this ride
 *   - ride is in an active status
 * Avatar is returned as a short-lived signed URL from the private bucket.
 */
export const getRideDriverDetails = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((data) => z.object({ rideId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { rideId } = data;
    const { userId } = context;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: ride, error: rideErr } = await supabaseAdmin
      .from("rides")
      .select("id, passenger_id, driver_id, status")
      .eq("id", rideId)
      .maybeSingle();
    if (rideErr) throw new Error(rideErr.message);
    if (!ride || ride.passenger_id !== userId) {
      throw new Error("Not authorized for this ride");
    }
    if (
      !ride.driver_id ||
      !["accepted", "driver_arriving", "arrived", "in_progress"].includes(ride.status)
    ) {
      return null;
    }

    const driverId = ride.driver_id;
    const [profileRes, driverRes, ratingRes] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("full_name, phone, avatar_url")
        .eq("user_id", driverId)
        .maybeSingle(),
      supabaseAdmin
        .from("driver_profiles")
        .select("vehicle_type, vehicle_model, license_plate")
        .eq("user_id", driverId)
        .maybeSingle(),
      supabaseAdmin.from("ride_ratings").select("rating").eq("driver_id", driverId),
    ]);

    let avatarUrl: string | null = null;
    const path = profileRes.data?.avatar_url ?? null;
    if (path) {
      const { data: signed } = await supabaseAdmin.storage
        .from("avatars")
        .createSignedUrl(path, 60 * 30);
      avatarUrl = signed?.signedUrl ?? null;
    }

    const ratings = (ratingRes.data ?? []) as { rating: number }[];
    const avgRating = ratings.length
      ? ratings.reduce((s, r) => s + Number(r.rating), 0) / ratings.length
      : null;

    const details: DriverDetails = {
      userId: driverId,
      fullName: profileRes.data?.full_name ?? null,
      phone: profileRes.data?.phone ?? null,
      avatarUrl,
      vehicleType: driverRes.data?.vehicle_type ?? null,
      vehicleModel: driverRes.data?.vehicle_model ?? null,
      licensePlate: driverRes.data?.license_plate ?? null,
      avgRating,
    };
    return details;
  });
