import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";
import { AppShell, NAV_ICONS } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth, useUserRoles } from "@/hooks/use-auth";
import { SERVICE_TYPE_LABEL, type ServiceType } from "@/lib/booking-types";
import { formatZAR } from "@/lib/pricing";
import { pricingDb, type JsonValue } from "@/lib/pricing-api";
import { toast } from "sonner";

export const Route = createFileRoute("/app/passenger/bookings/$bookingId/quote")({
  head: () => ({ meta: [{ title: "Service Quote — Access" }] }),
  component: PassengerQuotePage,
});

type Booking = {
  id: string;
  booking_reference: string;
  service_type: ServiceType;
  status: string;
  start_at: string | null;
  quoted_total: number | null;
  deposit_amount: number | null;
  deposit_status: string;
};

type Quote = {
  id: string;
  booking_id: string;
  quote_reference: string;
  status: string;
  revision_number: number;
  currency: string;
  subtotal: number;
  adjustments_total: number;
  final_total: number;
  deposit_required: boolean;
  deposit_amount: number;
  valid_until: string | null;
  sent_at: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  expired_at: string | null;
  superseded_at: string | null;
  cancelled_at: string | null;
  row_version: number;
  created_at: string;
};

type QuoteItem = {
  id: string;
  quote_id: string;
  component_code: string | null;
  label: string;
  description: string | null;
  quantity: number;
  unit: string | null;
  unit_price: number;
  line_subtotal: number | null;
  adjustment: number;
  line_total: number;
  calculation_order: number;
};

type Workspace = { booking: Booking; quotes: Quote[]; items: QuoteItem[] };

function asWorkspace(value: JsonValue | null): Workspace | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const workspace = value as unknown as Workspace;
  return workspace.booking && Array.isArray(workspace.quotes) ? workspace : null;
}

function isActionable(quote: Quote): boolean {
  if (quote.status !== "sent" || !quote.sent_at) return false;
  if (
    quote.accepted_at ||
    quote.declined_at ||
    quote.expired_at ||
    quote.superseded_at ||
    quote.cancelled_at
  )
    return false;
  return !quote.valid_until || new Date(quote.valid_until).getTime() > Date.now();
}

function PassengerQuotePage() {
  const { bookingId } = Route.useParams();
  const { user } = useAuth();
  const { roles } = useUserRoles(user?.id);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [declineReason, setDeclineReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const nav = useMemo(() => {
    const items = [
      { to: "/app/passenger", label: "Ride", icon: NAV_ICONS.Passenger },
      { to: "/app/passenger/bookings", label: "Bookings", icon: NAV_ICONS.Profile },
    ];
    if (roles?.includes("driver"))
      items.push({ to: "/app/driver", label: "Drive", icon: NAV_ICONS.Driver });
    if (roles?.includes("admin"))
      items.push({ to: "/app/admin", label: "Admin", icon: NAV_ICONS.Admin });
    items.push({ to: "/app/profile", label: "Profile", icon: NAV_ICONS.Profile });
    return items;
  }, [roles]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: loadError } = await pricingDb.rpc("passenger_quote_workspace", {
      p_booking_id: bookingId,
    });
    if (loadError) {
      setError(loadError.message);
      setWorkspace(null);
    } else {
      setWorkspace(asWorkspace(data));
    }
    setLoading(false);
  }, [bookingId]);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  const currentQuote = useMemo(
    () => workspace?.quotes.find(isActionable) ?? workspace?.quotes[0] ?? null,
    [workspace],
  );

  const accept = async () => {
    if (!currentQuote) return;
    setBusy("accept");
    const { data, error: acceptError } = await pricingDb.rpc("passenger_accept_service_quote", {
      p_quote_id: currentQuote.id,
      p_expected_row_version: currentQuote.row_version,
      p_idempotency_key: crypto.randomUUID(),
    });
    setBusy(null);
    if (acceptError) return toast.error(acceptError.message);
    const outcome = data as unknown as { accepted?: boolean; reason?: string };
    if (outcome.accepted === false) {
      toast.error(
        outcome.reason === "expired" ? "This quote has expired" : "The quote was not accepted",
      );
      await load();
      return;
    }
    toast.success("Quote accepted");
    await load();
  };

  const decline = async () => {
    if (!currentQuote) return;
    setBusy("decline");
    const { data, error: declineError } = await pricingDb.rpc("passenger_decline_service_quote", {
      p_quote_id: currentQuote.id,
      p_expected_row_version: currentQuote.row_version,
      p_reason: declineReason,
    });
    setBusy(null);
    if (declineError) return toast.error(declineError.message);
    const outcome = data as unknown as { declined?: boolean; reason?: string };
    if (outcome.declined === false) {
      toast.error(
        outcome.reason === "expired" ? "This quote has expired" : "The quote was not declined",
      );
      await load();
      return;
    }
    toast.success("Quote declined. Access can prepare a revised quote.");
    await load();
  };

  if (!user) return null;

  return (
    <AppShell title="Service Quote" nav={nav}>
      <Button asChild variant="ghost" size="sm" className="mb-3">
        <Link to="/app/passenger/bookings">
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to bookings
        </Link>
      </Button>
      {error ? (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      {loading ? (
        <div className="rounded-2xl border p-8 text-center text-sm text-muted-foreground">
          <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
          Loading quote…
        </div>
      ) : null}

      {workspace && currentQuote ? (
        <div className="space-y-4">
          <section className="rounded-2xl border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {workspace.booking.booking_reference}
                </p>
                <h1 className="text-xl font-semibold">
                  {SERVICE_TYPE_LABEL[workspace.booking.service_type]}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {currentQuote.quote_reference} · revision {currentQuote.revision_number}
                </p>
              </div>
              <Badge variant={isActionable(currentQuote) ? "default" : "outline"}>
                {currentQuote.status}
              </Badge>
            </div>
            {currentQuote.valid_until ? (
              <div className="mt-3 flex items-center gap-2 rounded-xl bg-secondary p-3 text-sm">
                <Clock className="h-4 w-4" />
                Valid until {new Date(currentQuote.valid_until).toLocaleString("en-ZA")}
              </div>
            ) : null}
          </section>

          <section className="rounded-2xl border bg-card p-4 shadow-sm">
            <h2 className="font-semibold">Quote breakdown</h2>
            <div className="mt-3 space-y-2 text-sm">
              {workspace.items
                .filter((item) => item.quote_id === currentQuote.id)
                .map((item) => (
                  <div key={item.id} className="flex items-start justify-between gap-3">
                    <div>
                      <p>{item.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {Number(item.quantity)} {item.unit ?? "unit"} ×{" "}
                        {formatZAR(Number(item.unit_price))}
                      </p>
                    </div>
                    <span className="font-medium">{formatZAR(Number(item.line_total))}</span>
                  </div>
                ))}
              <div className="mt-3 flex justify-between border-t pt-3 text-lg font-semibold">
                <span>Total</span>
                <span>{formatZAR(Number(currentQuote.final_total))}</span>
              </div>
              {currentQuote.deposit_required ? (
                <div className="flex justify-between text-sm">
                  <span>Deposit required</span>
                  <span>{formatZAR(Number(currentQuote.deposit_amount))}</span>
                </div>
              ) : null}
            </div>
          </section>

          {isActionable(currentQuote) ? (
            <section className="rounded-2xl border border-primary/25 bg-primary/5 p-4">
              <h2 className="font-semibold">Your response</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Accepting confirms this immutable quote revision for your booking.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button onClick={() => void accept()} disabled={busy === "accept"}>
                  {busy === "accept" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                  )}
                  Accept quote
                </Button>
              </div>
              <div className="mt-4">
                <Label>Reason for declining (optional)</Label>
                <Textarea
                  value={declineReason}
                  onChange={(event) => setDeclineReason(event.target.value)}
                />
                <Button
                  className="mt-2"
                  variant="outline"
                  onClick={() => void decline()}
                  disabled={busy === "decline"}
                >
                  {busy === "decline" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <XCircle className="mr-2 h-4 w-4" />
                  )}
                  Decline quote
                </Button>
              </div>
            </section>
          ) : (
            <section className="rounded-2xl border p-4 text-sm">
              {currentQuote.accepted_at ? (
                <p className="flex items-center gap-2 text-primary">
                  <CheckCircle2 className="h-4 w-4" />
                  Accepted {new Date(currentQuote.accepted_at).toLocaleString("en-ZA")}
                </p>
              ) : null}
              {currentQuote.declined_at ? (
                <p>Declined {new Date(currentQuote.declined_at).toLocaleString("en-ZA")}</p>
              ) : null}
              {currentQuote.expired_at ||
              (currentQuote.valid_until &&
                new Date(currentQuote.valid_until).getTime() <= Date.now()) ? (
                <p>This quote has expired.</p>
              ) : null}
              {currentQuote.superseded_at ? (
                <p>This quote was replaced by a newer revision.</p>
              ) : null}
            </section>
          )}

          {workspace.quotes.length > 1 ? (
            <section className="rounded-2xl border bg-card p-4">
              <h2 className="font-semibold">Quote history</h2>
              <div className="mt-2 space-y-2 text-sm">
                {workspace.quotes.map((quote) => (
                  <div
                    key={quote.id}
                    className="flex items-center justify-between gap-3 rounded-lg bg-secondary/60 p-2"
                  >
                    <span>
                      Revision {quote.revision_number} · {quote.status}
                    </span>
                    <span>{formatZAR(Number(quote.final_total))}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : !loading && !error ? (
        <div className="rounded-2xl border p-6 text-center text-sm text-muted-foreground">
          No quote has been prepared for this booking yet.
        </div>
      ) : null}
    </AppShell>
  );
}
