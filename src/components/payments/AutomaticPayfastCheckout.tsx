import { useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { startPayfastCheckout, startRideEditPayfastCheckout } from "@/lib/payfast-checkout";

type PendingRide = {
  id: string;
  destination_address: string;
};

type PendingEdit = {
  id: string;
  ride_id: string;
  amount_due: number;
};

/**
 * Passenger checkout is part of submitting a trip/change, not an admin workflow.
 * New rides and fare-increasing edits are sent straight to PayFast. Trusted ITN
 * confirmation submits the ride or applies the staged route change.
 */
export function AutomaticPayfastCheckout() {
  const [pendingRide, setPendingRide] = useState<PendingRide | null>(null);
  const [pendingEdit, setPendingEdit] = useState<PendingEdit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const starting = useRef<string | null>(null);

  const params = typeof window === "undefined" ? null : new URLSearchParams(window.location.search);
  const paymentReturn = params?.get("payment") ?? null;
  const returnChangeId = params?.get("change") ?? null;

  const launchRide = useCallback(async (ride: PendingRide) => {
    const key = `ride:${ride.id}`;
    if (starting.current === key) return;
    starting.current = key;
    setPendingRide(ride);
    setError(null);
    try {
      const result = await startPayfastCheckout(ride.id);
      if (result === "already_paid") window.location.assign(`/app/trip/${ride.id}`);
    } catch (checkoutError) {
      starting.current = null;
      setError(
        checkoutError instanceof Error
          ? checkoutError.message
          : "Unable to open PayFast. Please try again.",
      );
    }
  }, []);

  const launchEdit = useCallback(async (edit: PendingEdit) => {
    const key = `edit:${edit.id}`;
    if (starting.current === key) return;
    starting.current = key;
    setPendingEdit(edit);
    setError(null);
    try {
      const result = await startRideEditPayfastCheckout(edit.id);
      if (result === "already_paid") window.location.assign(`/app/trip/${edit.ride_id}`);
    } catch (checkoutError) {
      starting.current = null;
      setError(
        checkoutError instanceof Error
          ? checkoutError.message
          : "Unable to open PayFast. Please try again.",
      );
    }
  }, []);

  useEffect(() => {
    let active = true;
    let rideChannel: ReturnType<typeof supabase.channel> | null = null;
    let editChannel: ReturnType<typeof supabase.channel> | null = null;
    let fallbackTimer: number | null = null;

    const refreshPending = async (userId: string) => {
      const [{ data: rideData }, { data: editData }] = await Promise.all([
        supabase
          .from("rides")
          .select("id,destination_address")
          .eq("passenger_id", userId)
          .eq("status", "payment_pending" as never)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("ride_change_requests" as never)
          .select("id,ride_id,amount_due" as never)
          .eq("passenger_id" as never, userId as never)
          .eq("status" as never, "awaiting_payment" as never)
          .order("created_at" as never, { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (!active) return;

      if (rideData) {
        const ride = rideData as unknown as PendingRide;
        setPendingRide(ride);
        if (paymentReturn !== "success" && paymentReturn !== "cancelled") {
          void launchRide(ride);
        }
      }

      if (editData) {
        const edit = editData as unknown as PendingEdit;
        setPendingEdit(edit);
        const returningFromThisEdit = returnChangeId === edit.id;
        if (
          !returningFromThisEdit &&
          paymentReturn !== "success" &&
          paymentReturn !== "cancelled"
        ) {
          void launchEdit(edit);
        }
      }
    };

    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth.user;
      if (!user || !active) return;

      await refreshPending(user.id);

      rideChannel = supabase
        .channel(`automatic-payfast-rides:${user.id}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "rides",
            filter: `passenger_id=eq.${user.id}`,
          },
          (payload) => {
            const next = payload.new as Record<string, unknown>;
            if (next.status !== "payment_pending") return;
            const ride = {
              id: String(next.id),
              destination_address: String(next.destination_address ?? "your destination"),
            };
            setPendingRide(ride);
            void launchRide(ride);
          },
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "rides",
            filter: `passenger_id=eq.${user.id}`,
          },
          (payload) => {
            const next = payload.new as Record<string, unknown>;
            if (next.status !== "payment_pending") {
              setPendingRide((current) =>
                current?.id === String(next.id) ? null : current,
              );
              starting.current = null;
            }
          },
        )
        .subscribe();

      editChannel = supabase
        .channel(`automatic-payfast-edits:${user.id}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "ride_change_requests",
            filter: `passenger_id=eq.${user.id}`,
          },
          (payload) => {
            const next = payload.new as Record<string, unknown>;
            if (next.status !== "awaiting_payment") return;
            const edit = {
              id: String(next.id),
              ride_id: String(next.ride_id),
              amount_due: Number(next.amount_due),
            };
            setPendingEdit(edit);
            void launchEdit(edit);
          },
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "ride_change_requests",
            filter: `passenger_id=eq.${user.id}`,
          },
          (payload) => {
            const next = payload.new as Record<string, unknown>;
            if (next.status !== "awaiting_payment") {
              setPendingEdit((current) =>
                current?.id === String(next.id) ? null : current,
              );
              starting.current = null;
            }
          },
        )
        .subscribe();

      // Realtime is the fast path. This small fallback poll prevents a dropped
      // websocket event from ever leaving a newly-created unpaid draft stranded.
      if (paymentReturn !== "success" && paymentReturn !== "cancelled") {
        fallbackTimer = window.setInterval(() => void refreshPending(user.id), 1500);
      }
    })();

    return () => {
      active = false;
      if (fallbackTimer != null) window.clearInterval(fallbackTimer);
      if (rideChannel) void supabase.removeChannel(rideChannel);
      if (editChannel) void supabase.removeChannel(editChannel);
    };
  }, [launchEdit, launchRide, paymentReturn, returnChangeId]);

  const cancelRideDraft = async () => {
    if (!pendingRide) return;
    setCancelling(true);
    const { error: cancelError } = await supabase.rpc(
      "passenger_cancel_unpaid_ride" as never,
      { p_ride_id: pendingRide.id } as never,
    );
    setCancelling(false);
    if (cancelError) return setError(cancelError.message);
    setPendingRide(null);
    starting.current = null;
    window.location.assign("/app/passenger");
  };

  const cancelEditDraft = async () => {
    if (!pendingEdit) return;
    setCancelling(true);
    const { error: cancelError } = await supabase.rpc(
      "passenger_cancel_ride_change_request" as never,
      { p_request_id: pendingEdit.id } as never,
    );
    setCancelling(false);
    if (cancelError) return setError(cancelError.message);
    const rideId = pendingEdit.ride_id;
    setPendingEdit(null);
    starting.current = null;
    window.location.assign(`/app/trip/${rideId}`);
  };

  const cancelledEdit =
    !!pendingEdit && paymentReturn === "cancelled" && returnChangeId === pendingEdit.id;
  const editIsStarting = !!pendingEdit && starting.current === `edit:${pendingEdit.id}`;
  const rideIsStarting = !!pendingRide && starting.current === `ride:${pendingRide.id}`;
  const showEditRecovery =
    !!pendingEdit &&
    (cancelledEdit || (!!error && starting.current?.startsWith("ride:") !== true));
  const showRideRecovery =
    !!pendingRide && !showEditRecovery && (paymentReturn === "cancelled" || !!error);
  const showOpeningEdit = editIsStarting && !showEditRecovery;
  const showOpeningRide = rideIsStarting && !showRideRecovery && !showOpeningEdit;

  if (!showEditRecovery && !showRideRecovery && !showOpeningEdit && !showOpeningRide) return null;

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-background/85 p-4 backdrop-blur-sm">
      <section className="w-full max-w-sm rounded-2xl border bg-card p-5 shadow-xl">
        {showOpeningEdit && pendingEdit ? (
          <div className="text-center">
            <LoaderCircle className="mx-auto h-7 w-7 animate-spin text-primary" />
            <h2 className="mt-3 text-lg font-semibold">Opening PayFast</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Your trip changes are waiting for the additional fare payment.
            </p>
          </div>
        ) : showOpeningRide && pendingRide ? (
          <div className="text-center">
            <LoaderCircle className="mx-auto h-7 w-7 animate-spin text-primary" />
            <h2 className="mt-3 text-lg font-semibold">Opening PayFast</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Complete payment before this trip is submitted to Access.
            </p>
          </div>
        ) : showEditRecovery && pendingEdit ? (
          <>
            <h2 className="text-lg font-semibold">Complete payment to apply trip changes</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Your edited route has not been applied. Pay the additional fare with PayFast, or
              cancel the pending edit and keep the current trip unchanged.
            </p>
            {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
            <div className="mt-4 space-y-2">
              <Button className="w-full" onClick={() => void launchEdit(pendingEdit)}>
                {starting.current === `edit:${pendingEdit.id}` ? (
                  <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Continue to PayFast
              </Button>
              <Button
                className="w-full"
                variant="outline"
                disabled={cancelling}
                onClick={() => void cancelEditDraft()}
              >
                {cancelling ? "Cancelling…" : "Cancel trip edit"}
              </Button>
            </div>
          </>
        ) : pendingRide ? (
          <>
            <h2 className="text-lg font-semibold">Complete payment to request this trip</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Your trip to {pendingRide.destination_address} has not been submitted yet. Complete
              payment with PayFast, or cancel this unpaid trip.
            </p>
            {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
            <div className="mt-4 space-y-2">
              <Button className="w-full" onClick={() => void launchRide(pendingRide)}>
                {starting.current === `ride:${pendingRide.id}` ? (
                  <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Continue to PayFast
              </Button>
              <Button
                className="w-full"
                variant="outline"
                disabled={cancelling}
                onClick={() => void cancelRideDraft()}
              >
                {cancelling ? "Cancelling…" : "Cancel trip"}
              </Button>
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}
