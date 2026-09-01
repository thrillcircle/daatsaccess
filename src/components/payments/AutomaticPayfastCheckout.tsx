import { useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { startPayfastCheckout } from "@/lib/payfast-checkout";

type PendingRide = {
  id: string;
  destination_address: string;
};

/**
 * Passenger checkout is part of submitting a ride, not an admin workflow.
 * Any passenger-created `payment_pending` ride is sent straight to PayFast.
 * A trusted PayFast ITN later promotes it to `requested`.
 */
export function AutomaticPayfastCheckout() {
  const [pendingRide, setPendingRide] = useState<PendingRide | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const startingRide = useRef<string | null>(null);

  const paymentReturn =
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("payment");

  const launch = useCallback(async (ride: PendingRide) => {
    if (startingRide.current === ride.id) return;
    startingRide.current = ride.id;
    setPendingRide(ride);
    setError(null);
    try {
      const result = await startPayfastCheckout(ride.id);
      if (result === "already_paid") {
        window.location.assign(`/app/trip/${ride.id}`);
      }
      // Normal checkout submits a PayFast form and leaves this page.
    } catch (checkoutError) {
      startingRide.current = null;
      setError(
        checkoutError instanceof Error
          ? checkoutError.message
          : "Unable to open PayFast. Please try again.",
      );
    }
  }, []);

  useEffect(() => {
    let active = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth.user;
      if (!user || !active) return;

      const { data } = await supabase
        .from("rides")
        .select("id,destination_address")
        .eq("passenger_id", user.id)
        .eq("status", "payment_pending" as never)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data && active) {
        const ride = data as unknown as PendingRide;
        setPendingRide(ride);
        // A PayFast return must remain on Trip Details. Do not immediately send
        // the passenger back to checkout while ITN is being confirmed or after
        // they deliberately cancelled PayFast.
        if (paymentReturn !== "success" && paymentReturn !== "cancelled") {
          void launch(ride);
        }
      }

      channel = supabase
        .channel(`automatic-payfast:${user.id}`)
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
            void launch(ride);
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
            if (pendingRide?.id === String(next.id) && next.status !== "payment_pending") {
              setPendingRide(null);
              setError(null);
              startingRide.current = null;
            }
          },
        )
        .subscribe();
    })();

    return () => {
      active = false;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [launch, paymentReturn, pendingRide?.id]);

  const cancelDraft = async () => {
    if (!pendingRide) return;
    setCancelling(true);
    const { error: cancelError } = await supabase.rpc(
      "passenger_cancel_unpaid_ride" as never,
      { p_ride_id: pendingRide.id } as never,
    );
    setCancelling(false);
    if (cancelError) {
      setError(cancelError.message);
      return;
    }
    setPendingRide(null);
    startingRide.current = null;
    window.location.assign("/app/passenger");
  };

  // During the normal outbound redirect there is nothing extra to show. The
  // blocking recovery panel is only for PayFast cancellation or checkout errors.
  if (!pendingRide || (paymentReturn !== "cancelled" && !error)) return null;

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-background/85 p-4 backdrop-blur-sm">
      <section className="w-full max-w-sm rounded-2xl border bg-card p-5 shadow-xl">
        <h2 className="text-lg font-semibold">Complete payment to request this trip</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Your trip to {pendingRide.destination_address} has not been submitted yet. Complete
          payment with PayFast, or cancel this unpaid trip.
        </p>
        {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
        <div className="mt-4 space-y-2">
          <Button className="w-full" onClick={() => void launch(pendingRide)}>
            {startingRide.current === pendingRide.id ? (
              <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Continue to PayFast
          </Button>
          <Button
            className="w-full"
            variant="outline"
            disabled={cancelling}
            onClick={() => void cancelDraft()}
          >
            {cancelling ? "Cancelling…" : "Cancel trip"}
          </Button>
        </div>
      </section>
    </div>
  );
}
