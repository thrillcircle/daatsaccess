import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, CreditCard, LoaderCircle, ReceiptText, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { formatZAR } from "@/lib/pricing";

type Ride = Database["public"]["Tables"]["rides"]["Row"];
type LegacyPayment = Database["public"]["Tables"]["payments"]["Row"];

type PaymentRecord = LegacyPayment & {
  currency?: string | null;
  environment?: "sandbox" | "live" | null;
  merchant_payment_id?: string | null;
  paid_at?: string | null;
  provider?: string | null;
  provider_status?: string | null;
  purpose?: "trip_fare" | "cancellation_charge" | null;
};

type CheckoutResponse = {
  payment: {
    payment_id: string;
    ride_id: string;
    merchant_payment_id: string;
    amount: number | string;
    currency: string;
    status: string;
    purpose: "trip_fare" | "cancellation_charge";
    environment: "sandbox" | "live";
    idempotent: boolean;
    already_paid: boolean;
  };
  checkout_url: string | null;
  fields: Record<string, string> | null;
  mode: "sandbox" | "live";
  idempotency_key?: string;
};

const PAYABLE_STATUSES = new Set<Ride["status"]>([
  "accepted",
  "driver_arriving",
  "arrived",
  "in_progress",
  "completed",
  "cancelled",
]);

const ALLOWED_PAYFAST_CHECKOUTS = new Set([
  "https://sandbox.payfast.co.za/eng/process",
  "https://www.payfast.co.za/eng/process",
]);

function paymentStorageKey(rideId: string) {
  return `access:payfast:idempotency:${rideId}`;
}

function getIdempotencyKey(rideId: string): string {
  if (typeof window === "undefined") return crypto.randomUUID();
  const key = paymentStorageKey(rideId);
  const existing = window.sessionStorage.getItem(key);
  if (existing) return existing;
  const value = crypto.randomUUID();
  window.sessionStorage.setItem(key, value);
  return value;
}

function clearIdempotencyKey(rideId: string) {
  if (typeof window !== "undefined") {
    window.sessionStorage.removeItem(paymentStorageKey(rideId));
  }
}

function submitPayfastForm(checkoutUrl: string, fields: Record<string, string>) {
  if (!ALLOWED_PAYFAST_CHECKOUTS.has(checkoutUrl)) {
    throw new Error("Unexpected PayFast checkout address");
  }

  const form = document.createElement("form");
  form.method = "POST";
  form.action = checkoutUrl;
  form.style.display = "none";

  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }

  document.body.appendChild(form);
  form.submit();
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

    const next = data ? (data as unknown as PaymentRecord) : null;
    setPayment(next);
    if (next?.status === "paid") clearIdempotencyKey(ride.id);
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

  const startCheckout = async () => {
    if (!PAYABLE_STATUSES.has(ride.status)) return;
    setStartingCheckout(true);

    try {
      const { data, error } = await supabase.functions.invoke("payfast-create-payment", {
        body: {
          ride_id: ride.id,
          idempotency_key: getIdempotencyKey(ride.id),
        },
      });

      if (error) throw error;
      const checkout = data as CheckoutResponse;

      if (checkout.payment.already_paid || checkout.payment.status === "paid") {
        clearIdempotencyKey(ride.id);
        await reloadPayment();
        toast.success("Payment is already confirmed");
        return;
      }

      if (!checkout.checkout_url || !checkout.fields) {
        throw new Error("PayFast checkout is unavailable");
      }

      submitPayfastForm(checkout.checkout_url, checkout.fields);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to start PayFast checkout";
      toast.error(message);
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

  if (ride.status === "requested") {
    return (
      <section className="rounded-2xl border bg-card p-4">
        <PaymentHeading />
        <p className="text-sm text-muted-foreground">
          Payment becomes available after DAATS accepts your trip request.
        </p>
      </section>
    );
  }

  const paid = payment?.status === "paid";
  const refunded = payment?.status === "refunded";
  const failed = payment?.status === "failed";
  const pending = payment?.status === "pending";
  const isCancellation = payment?.purpose === "cancellation_charge" || ride.status === "cancelled";
  const displayAmount = payment?.amount != null ? Number(payment.amount) : Number(ride.estimated_price);

  return (
    <section className="rounded-2xl border bg-card p-4">
      <PaymentHeading />

      {returnState === "success" && !paid ? (
        <div className="mb-3 rounded-xl border bg-muted/40 px-3 py-2 text-sm">
          PayFast returned you to Access. We are confirming the payment securely from the PayFast
          notification before marking it paid.
        </div>
      ) : null}

      {returnState === "cancelled" && !paid ? (
        <div className="mb-3 rounded-xl border bg-muted/40 px-3 py-2 text-sm">
          PayFast checkout was not completed. You can continue the payment when ready.
        </div>
      ) : null}

      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">
              {isCancellation ? "Cancellation charge" : "Trip payment"}
            </p>
            <p className="text-xl font-semibold">
              {payment || ride.status !== "cancelled" ? formatZAR(displayAmount) : "Calculated securely"}
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
              <span>Reference</span>
              <span className="text-right font-mono">
                {(payment.merchant_payment_id ?? payment.id).slice(-12)}
              </span>
              <span>Confirmed</span>
              <span className="text-right">
                {new Date(payment.paid_at ?? payment.created_at).toLocaleString()}
              </span>
            </div>
          </div>
        ) : refunded ? (
          <p className="text-sm text-muted-foreground">
            This payment has been refunded. Refund details remain available in your payment record.
          </p>
        ) : (
          <>
            {ride.status === "cancelled" && !payment ? (
              <p className="text-sm text-muted-foreground">
                If a passenger-requested cancellation charge applies, Access will use the locked trip
                pricing and recorded driver travel distance. Operational or driver/vehicle failure
                cancellations remain R0.
              </p>
            ) : null}

            {failed ? (
              <p className="text-sm text-muted-foreground">
                The previous payment was not completed. Starting again creates or reuses a secure
                PayFast payment for the current authoritative amount.
              </p>
            ) : null}

            {pending ? (
              <p className="text-sm text-muted-foreground">
                A PayFast payment is pending. You may safely continue the same payment.
              </p>
            ) : null}

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
                    : ride.status === "cancelled"
                      ? "Check & pay cancellation charge"
                      : "Pay securely with PayFast"}
            </Button>
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
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Payment</h3>
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
