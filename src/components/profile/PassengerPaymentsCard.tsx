import { useEffect, useState } from "react";
import { CreditCard, ExternalLink, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatZAR } from "@/lib/pricing";

type PaymentRow = {
  id: string;
  ride_id: string;
  amount: number;
  status: string;
  provider: string | null;
  purpose: string | null;
  created_at: string;
};

export function PassengerPaymentsCard({ userId }: { userId: string }) {
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("payments")
        .select("id,ride_id,amount,status,provider,purpose,created_at")
        .eq("passenger_id", userId)
        .order("created_at", { ascending: false })
        .limit(5);
      if (!active) return;
      setPayments((data ?? []) as unknown as PaymentRow[]);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [userId]);

  return (
    <section className="rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)]">
      <div className="flex items-start gap-3">
        <CreditCard className="mt-0.5 h-5 w-5 text-primary" />
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">Payments</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Access uses PayFast for secure trip payments.
          </p>
        </div>
        <span className="rounded-full border px-2 py-1 text-xs font-medium">PayFast</span>
      </div>

      <div className="mt-3 flex items-start gap-2 rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <span>
          When you request a paid trip, Access opens PayFast automatically. Card and banking
          credentials are entered on PayFast and are not stored in your Access profile.
        </span>
      </div>

      <div className="mt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Recent payments
        </h3>
        {loading ? (
          <p className="py-4 text-sm text-muted-foreground">Loading payments…</p>
        ) : payments.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">No payments yet.</p>
        ) : (
          <ul className="mt-2 divide-y">
            {payments.map((payment) => (
              <li key={payment.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">
                    {payment.purpose === "cancellation_charge"
                      ? "Cancellation charge"
                      : payment.purpose === "trip_adjustment"
                        ? "Trip edit payment"
                        : "Trip payment"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(payment.created_at).toLocaleString()} · {payment.status}
                  </p>
                </div>
                <a
                  href={`/app/trip/${payment.ride_id}`}
                  className="flex shrink-0 items-center gap-1 font-semibold hover:underline"
                >
                  {formatZAR(Number(payment.amount))}
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
