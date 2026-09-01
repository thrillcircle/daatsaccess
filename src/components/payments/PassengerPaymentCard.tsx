import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, CreditCard, LoaderCircle, ReceiptText, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import {
  clearPayfastIdempotencyKey,
  clearRideEditPayfastIdempotencyKey,
  startPayfastCheckout,
} from "@/lib/payfast-checkout";
import { formatZAR } from "@/lib/pricing";

type Ride = Database["public"]["Tables"]["rides"]["Row"];
type LegacyPayment = Database["public"]["Tables"]["payments"]["Row"];

type PaymentRecord = LegacyPayment & {
  currency?: string | null;
  environment?: "sandbox" | "live" | null;
  merchant_payment_id?: string | null;
  paid_at?: string | null;
  provider?: string | null;
  provider_payment_id?: string | null;
  provider_status?: string | null;
  purpose?: "trip_fare" | "trip_adjustment" | "cancellation_charge" | null;
};

function paymentLabel(payment: PaymentRecord | null, ride: Ride) {
  if (payment?.purpose === "trip_adjustment") return "Trip edit payment";
  if (payment?.purpose === "cancellation_charge" || ride.status === "cancelled") {
    return "Cancellation charge";
  }
  return "Trip payment";
}

export function PassengerPaymentCard({ ride }: { ride: Ride }) {
  const [payment, setPayment] = useState<PaymentRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [startingCheckout, setStartingCheckout] = useState(false);
  const [returnState, setReturnState] = useState<"success" | "cancelled" | null>(null);

  const reloadPayment = useCallback(async () => {
    const { data, error } = await supabase
      .from("payments")
      .select("*")
      .eq("ride_id", ride.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("Unable to load payment", error);
      setLoading(false);
      return;
    }

    setPayment(data ? (data as unknown as PaymentRecord) : null);
    setLoading(false);
  }, [ride.id]);

  useEffect(() => {
    void reloadPayment();

    if (typeof window !== "undefined") {
      const result = new URLSearchParams(window.location.search).get("payment");
      if (result === "success" || result === "cancelled") setReturnState(result);
    }

    const channel = supabase
      .channel(`passenger-payment:${ride.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payments", filter: `ride_id=eq.${ride.id}` },
        () => void reloadPayment(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [reloadPayment, ride.id]);

  // PayFast returns before its trusted ITN can finish. Realtime is the primary
  // update path; this poll is a short fallback so the passenger never needs to
  // leave Trip Details or press refresh while the secure confirmation arrives.
  useEffect(() => {
    if (returnState !== "success" || payment?.status === "paid") return;
    let attempts = 0;
    void reloadPayment();
    const timer = window.setInterval(() => {
      attempts += 1;
      void reloadPayment();
      if (attempts >= 30) window.clearInterval(timer);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [payment?.status, reloadPayment, returnState]);

  // Once the trusted payment row is paid, the database triggers have already
  // submitted the trip or applied the staged edit in the same transaction.
  // Reload the clean Trip Details URL so route/status data is also current.
  useEffect(() => {
    if (returnState !== "success" || payment?.status !== "paid" || typeof window === "undefined") {
      return;
    }

    const url = new URL(window.location.href);
    const changeId = url.searchParams.get("change");
    if (changeId) clearRideEditPayfastIdempotencyKey(changeId);
    else clearPayfastIdempotencyKey(ride.id);

    url.searchParams.delete("payment");
    url.searchParams.delete("change");
    window.location.replace(`${url.pathname}${url.search}${url.hash}`);
  }, [payment?.status, returnState, ride.id]);

  const startCheckout = async () => {
    setStartingCheckout(true);
    try {
      const result = await startPayfastCheckout(ride.id);
      if (result === "already_paid") {
        await reloadPayment();
        toast.success("Payment is already confirmed");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to start PayFast checkout");
      setStartingCheckout(false);
    }
  };

  if (loading) {
    return (
      <section className="rounded-2xl border bg-card p-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="h-4 w-4 animate-spin" /> Loading payment…
        </div>
      </section>
    );
  }

  const paid = payment?.status === "paid";
  const refunded = payment?.status === "refunded";
  const failed = payment?.status === "failed";
  const pending = payment?.status === "pending";
  const pendingEditPayment = payment?.purpose === "trip_adjustment" && pending;
  const rideStatus = ride.status as string;
  const unpaidDraft = rideStatus === "payment_pending";
  const legacyUnpaidRequest =
    rideStatus === "requested" && !paid && payment?.purpose !== "trip_adjustment";
  const cancelled = rideStatus === "cancelled";
  const canStartRideCheckout =
    !pendingEditPayment &&
    !paid &&
    !refunded &&
    (unpaidDraft || legacyUnpaidRequest || cancelled || payment?.purpose === "cancellation_charge");
  const displayAmount =
    payment?.amount != null ? Number(payment.amount) : Number(ride.estimated_price);

  return (
    <section className="rounded-2xl border bg-card p-4">
      <PaymentHeading />

      {returnState === "success" && !paid ? (
        <div className="mb-3 flex items-start gap-2 rounded-xl border bg-muted/40 px-3 py-2 text-sm">
          <LoaderCircle className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
          <span>
            PayFast returned you to this trip. We are confirming the payment securely from the
            PayFast notification. This page will update automatically.
          </span>
        </div>
      ) : null}

      {returnState === "cancelled" && !paid ? (
        <div className="mb-3 rounded-xl border bg-muted/40 px-3 py-2 text-sm">
          PayFast checkout was not completed. Your trip or pending edit has not been changed.
        </div>
      ) : null}

      {unpaidDraft ? (
        <div className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
          This trip has not been submitted yet. Complete the PayFast payment to request it.
        </div>
      ) : null}

      {rideStatus === "requested" && payment?.purpose === "trip_fare" && paid ? (
        <div className="mb-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm">
          Payment confirmed. Your trip request has been submitted to Access.
        </div>
      ) : null}

      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">{paymentLabel(payment, ride)}</p>
            <p className="text-xl font-semibold">
              {payment || !cancelled ? formatZAR(displayAmount) : "Calculated securely"}
            </p>
          </div>
          <PaymentStatus status={payment?.status ?? null} />
        </div>

        {paid ? (
          <div className="rounded-xl border bg-muted/30 p-3 text-sm">
            <div className="flex items-center gap-2 font-medium">
              <CheckCircle2 className="h-4 w-4" /> Payment confirmed
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <span>Method</span>
              <span className="text-right">PayFast</span>
              <span>Access reference</span>
              <span className="break-all text-right font-mono">
                {payment.merchant_payment_id ?? payment.id}
              </span>
              {payment.provider_payment_id ? (
                <>
                  <span>PayFast reference</span>
                  <span className="break-all text-right font-mono">
                    {payment.provider_payment_id}
                  </span>
                </>
              ) : null}
              <span>Confirmed</span>
              <span className="text-right">
                {new Date(payment.paid_at ?? payment.created_at).toLocaleString()}
              </span>
            </div>
          </div>
        ) : refunded ? (
          <p className="text-sm text-muted-foreground">
            This payment has been refunded. The payment record remains available for your history.
          </p>
        ) : pendingEditPayment ? (
          <p className="text-sm text-muted-foreground">
            Your edited route is waiting for its additional PayFast payment. The current trip stays
            unchanged until PayFast confirms it.
          </p>
        ) : (
          <>
            {cancelled && !payment ? (
              <p className="text-sm text-muted-foreground">
                If a passenger-requested cancellation charge applies, Access calculates it from the
                locked trip pricing and recorded driver travel. Operational or driver/vehicle
                failure cancellations remain R0.
              </p>
            ) : null}

            {failed ? (
              <p className="text-sm text-muted-foreground">
                The previous PayFast payment was not completed. You can safely try again.
              </p>
            ) : null}

            {pending ? (
              <p className="text-sm text-muted-foreground">
                A PayFast payment is pending. You can safely continue the same payment.
              </p>
            ) : null}

            {canStartRideCheckout ? (
              <Button className="w-full" onClick={startCheckout} disabled={startingCheckout}>
                {startingCheckout ? (
                  <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                ) : pending || failed ? (
                  <RotateCcw className="mr-2 h-4 w-4" />
                ) : (
                  <CreditCard className="mr-2 h-4 w-4" />
                )}
                {startingCheckout
                  ? "Opening PayFast…"
                  : pending
                    ? "Continue with PayFast"
                    : failed
                      ? "Try PayFast again"
                      : cancelled
                        ? "Check & pay cancellation charge"
                        : "Continue to PayFast"}
              </Button>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

function PaymentHeading() {
  return (
    <div className="mb-3 flex items-center gap-2">
      <ReceiptText className="h-4 w-4" />
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Payment
      </h3>
    </div>
  );
}

function PaymentStatus({ status }: { status: string | null }) {
  const label = status ? status.charAt(0).toUpperCase() + status.slice(1) : "Not started";
  return (
    <span className="shrink-0 rounded-full border px-2 py-1 text-xs font-medium text-muted-foreground">
      {label}
    </span>
  );
}
