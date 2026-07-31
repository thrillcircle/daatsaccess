import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const VerifyInput = z.object({
  rideId: z.string().uuid(),
  pin: z.string().regex(/^\d{4}$/),
});

export type VerifyPinResult =
  | { status: "started" }
  | { status: "wrong"; remaining: number }
  | { status: "locked"; lock_seconds: number }
  | { status: "invalid"; reason?: string };

/**
 * Driver-side: verify the 4-digit PIN given by the passenger and, on success,
 * transition the ride from `arrived` to `in_progress`. All authorization,
 * rate limiting, and audit logging happens inside the database function
 * `public.verify_ride_start_pin`.
 */
export const verifyStartTripPin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => VerifyInput.parse(d))
  .handler(async ({ data, context }): Promise<VerifyPinResult> => {
    const { data: result, error } = await context.supabase.rpc("verify_ride_start_pin", {
      _ride_id: data.rideId,
      _pin: data.pin,
    });
    if (error) throw new Error(error.message);
    return result as VerifyPinResult;
  });

/**
 * Admin-only: regenerate the PIN and clear failed attempts. Database function
 * `public.admin_reset_ride_pin` enforces the admin role.
 */
export const adminResetRidePin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ rideId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("admin_reset_ride_pin", {
      _ride_id: data.rideId,
    });
    if (error) throw new Error(error.message);
    return result as { status: "reset"; pin: string };
  });

export type AdminViewPinResult = {
  pin: string;
  ride_id: string;
  status: string;
  passenger_name: string | null;
  driver_name: string | null;
};

/**
 * Admin-only: reveal the 4-digit PIN for an active ride and write a
 * `pin_viewed` audit entry. Enforced inside `public.admin_view_ride_pin`.
 */
export const adminViewRidePin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ rideId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<AdminViewPinResult> => {
    const { data: result, error } = await context.supabase.rpc("admin_view_ride_pin", {
      _ride_id: data.rideId,
    });
    if (error) throw new Error(error.message);
    return result as AdminViewPinResult;
  });

/**
 * Admin-only: acknowledge any open 5th-attempt PIN alerts for a ride.
 * Marks the admin's own `pin_failed_attempt_limit` notifications read and
 * writes an `alert_acknowledged` audit row. Does NOT unlock verification
 * or change the PIN.
 */
export const adminAcknowledgePinAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ rideId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("admin_acknowledge_pin_alert", {
      _ride_id: data.rideId,
    });
    if (error) throw new Error(error.message);
    return result as { acknowledged: number };
  });
