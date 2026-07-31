import { supabase } from "@/integrations/supabase/client";

/**
 * Phase 5 protected passenger operation workflows.
 *
 * Passengers must never write `rides.status` or `rides.scheduled_at` directly.
 * Both operations go through SECURITY DEFINER RPCs that verify ownership, lock
 * the ride and its operation run, synchronise assignments and dispatch offers,
 * and record audit events plus notifications.
 */

export type PassengerCancelResult = {
  cancelled: boolean;
  idempotent: boolean;
  ride_id: string;
  status: string;
  operation_run_id?: string | null;
};

export type PassengerRescheduleResult = {
  rescheduled: boolean;
  idempotent: boolean;
  ride_id: string;
  scheduled_at: string;
  previous_scheduled_at?: string | null;
  operation_run_id?: string | null;
};

export async function cancelPassengerRide(
  rideId: string,
  reason?: string,
  idempotencyKey?: string,
): Promise<PassengerCancelResult> {
  const { data, error } = await supabase.rpc("passenger_cancel_ride", {
    p_ride_id: rideId,
    p_reason: reason ?? "Cancelled by passenger",
    p_idempotency_key: idempotencyKey ?? `cancel:${rideId}`,
  });
  if (error) throw new Error(error.message);
  return data as unknown as PassengerCancelResult;
}

export async function reschedulePassengerRide(
  rideId: string,
  scheduledAtIso: string,
  reason?: string,
  idempotencyKey?: string,
): Promise<PassengerRescheduleResult> {
  const { data, error } = await supabase.rpc("passenger_reschedule_ride", {
    p_ride_id: rideId,
    p_scheduled_at: scheduledAtIso,
    p_reason: reason ?? "Rescheduled by passenger",
    p_idempotency_key: idempotencyKey ?? `reschedule:${rideId}:${scheduledAtIso}`,
  });
  if (error) throw new Error(error.message);
  return data as unknown as PassengerRescheduleResult;
}
