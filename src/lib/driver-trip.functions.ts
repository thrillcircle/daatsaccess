import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type PassengerDetails = {
  userId: string;
  fullName: string | null;
  phone: string | null;
  avatarUrl: string | null;
};

/**
 * Returns the matched passenger's contact details for a ride the caller is
 * the assigned driver on. Hidden once the ride is completed or cancelled.
 */
export const getRidePassengerDetails = createServerFn({ method: "GET" })
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
    if (!ride || ride.driver_id !== userId) {
      throw new Error("Not authorized for this ride");
    }
    if (!["accepted", "driver_arriving", "arrived", "in_progress"].includes(ride.status)) {
      return null;
    }

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("full_name, phone, avatar_url")
      .eq("user_id", ride.passenger_id)
      .maybeSingle();

    let avatarUrl: string | null = null;
    const path = profile?.avatar_url ?? null;
    if (path) {
      const { data: signed } = await supabaseAdmin.storage
        .from("avatars")
        .createSignedUrl(path, 60 * 30);
      avatarUrl = signed?.signedUrl ?? null;
    }

    const details: PassengerDetails = {
      userId: ride.passenger_id,
      fullName: profile?.full_name ?? null,
      phone: profile?.phone ?? null,
      avatarUrl,
    };
    return details;
  });
