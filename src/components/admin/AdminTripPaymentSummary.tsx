import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Clock3, CreditCard, XCircle } from "lucide-react";
import { useAuth, useUserRoles } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { formatZAR } from "@/lib/pricing";

type LegacyPayment = Database["public"]["Tables"]["payments"]["Row"];

type PaymentRecord = LegacyPayment & {
  environment?: "sandbox" | "live" | null;
  merchant_payment_id?: string | null;
  paid_at?: string | null;
  provider?: string | null;
  provider_payment_id?: string | null;
  provider_status?: string | null;
  purpose?: "trip_fare" | "cancellation_charge" | null;
};

export function AdminTripPaymentSummary({ rideId }: { rideId: string }) {
  const { user } = useAuth();
  const { roles, loading: rolesLoading } = useUserRoles(user?.id);
  const isAdmin = !!roles?.includes("admin");
  const [payment, setPayment] = useState<PaymentRecord | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("payments")
      .select("*")
      .eq("ride_id", rideId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error) setPayment(data ? (data as unknown as PaymentRecord) : null);
    setLoading(false);
  }, [isAdmin, rideId]);

  useEffect(() => {
    if (!isAdmin) return;
    void reload();
    const channel = supabase
      .channel(`admin-trip-payment:${rideId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payments", filter: `ride_id=eq.${rideId}` },
        () => void reload(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [isAdmin, reload, rideId]);

  if (rolesLoading || !isAdmin) return null;

  const confirmed =
    payment?.status === "paid" &&
    payment.provider === "payfast" &&
    payment.provider_status?.toUpperCase() === "COMPLETE" &&
    !!payment.paid_at;

  return (
    <section className="rounded-2xl border bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <CreditCard className="h-4 w-4" />
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Payment confirmation — Admin
        </h3>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading payment confirmation…</p>
      ) : !payment ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Clock3 className="h-4 w-4" /> Awaiting passenger payment
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            This trip cannot be accepted until PayFast confirms the trip payment.
          </p>
        </div>
      ) : confirmed ? (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <CheckCircle2 className="h-4 w-4" /> PayFast payment confirmed
            </div>
            <span className="text-sm font-semibold">{formatZAR(Number(payment.amount))}</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
            <span className="text-muted-foreground">Access reference</span>
            <span className="break-all text-right font-mono">
              {payment.merchant_payment_id ?? payment.id}
            </span>
            <span className="text-muted-foreground">PayFast reference</span>
            <span className="break-all text-right font-mono">
              {payment.provider_payment_id ?? "Not supplied"}
            </span>
            <span className="text-muted-foreground">PayFast status</span>
            <span className="text-right font-medium">{payment.provider_status ?? "COMPLETE"}</span>
            <span className="text-muted-foreground">Environment</span>
            <span className="text-right capitalize">{payment.environment ?? "—"}</span>
            <span className="text-muted-foreground">Confirmed at</span>
            <span className="text-right">
              {new Date(payment.paid_at ?? payment.created_at).toLocaleString()}
            </span>
          </div>
          <p className="mt-3 text-xs font-medium">This trip is eligible for admin acceptance.</p>
        </div>
      ) : payment.status === "failed" ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <XCircle className="h-4 w-4" /> Payment failed
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Admin acceptance remains locked until the passenger completes a confirmed payment.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Clock3 className="h-4 w-4" /> Payment {payment.status}
            </div>
            <span className="text-sm font-semibold">{formatZAR(Number(payment.amount))}</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            PayFast has not yet produced a confirmed COMPLETE payment. Admin acceptance remains
            locked.
          </p>
          {payment.merchant_payment_id ? (
            <p className="mt-2 break-all text-xs font-mono text-muted-foreground">
              Access reference: {payment.merchant_payment_id}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
