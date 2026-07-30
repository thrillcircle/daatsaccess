import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Calculator, History, Loader2, Send, ShieldCheck } from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth, useUserRoles } from "@/hooks/use-auth";
import { SERVICE_TYPE_LABEL, type BookingStatus, type ServiceType } from "@/lib/booking-types";
import { formatZAR } from "@/lib/pricing";
import { pricingDb, type JsonValue } from "@/lib/pricing-api";
import type { PricingInputs } from "@/lib/pricing-engine";
import { toast } from "sonner";

export const Route = createFileRoute("/app/admin/bookings/$bookingId/quote")({
  head: () => ({ meta: [{ title: "Quote Workspace — Admin" }] }),
  component: AdminQuoteWorkspacePage,
});

type Booking = {
  id: string;
  booking_reference: string;
  service_type: ServiceType;
  status: BookingStatus;
  start_at: string | null;
  estimated_total: number | null;
  quoted_total: number | null;
};

type Quote = {
  id: string;
  booking_id: string;
  quote_reference: string;
  status: string;
  revision_number: number;
  subtotal: number;
  adjustments_total: number;
  margin_amount: number;
  final_total: number;
  currency: string;
  valid_until: string | null;
  sent_at: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  expired_at: string | null;
  superseded_at: string | null;
  cancelled_at: string | null;
  admin_override_reason: string | null;
  row_version: number;
  calculation_snapshot: JsonValue;
  created_at: string;
};

type QuoteItem = {
  id: string;
  quote_id: string;
  component_code: string | null;
  label: string;
  quantity: number;
  unit: string | null;
  unit_price: number;
  line_subtotal: number | null;
  adjustment: number;
  line_total: number;
  customer_visible: boolean;
  internal_explanation: string | null;
  calculation_order: number;
};

type AuditEvent = {
  id: string;
  quote_id: string | null;
  event_type: string;
  reason: string | null;
  created_at: string;
};

type Workspace = {
  booking: Booking;
  quotes: Quote[];
  items: QuoteItem[];
  audit_events: AuditEvent[];
};

function defaultInputs(service: ServiceType): PricingInputs {
  switch (service) {
    case "transport":
      return { distance_km: 10 };
    case "assisted":
      return { distance_km: 10, companion_hours: 2, specialist_vehicle_required: true };
    case "appointment":
      return {
        distance_km: 20,
        companion_hours: 3,
        waiting_hours: 1,
        specialist_vehicle_required: true,
      };
    case "extended_journey":
      return {
        distance_km: 100,
        journey_days: 2,
        driver_overnights: 1,
        companion_days: 2,
        specialist_vehicle_required: true,
      };
  }
}

function asWorkspace(value: JsonValue | null): Workspace | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const workspace = value as unknown as Workspace;
  return workspace.booking && Array.isArray(workspace.quotes) ? workspace : null;
}

function validUntilDefault(): string {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function AdminQuoteWorkspacePage() {
  const { bookingId } = Route.useParams();
  const { user, loading: authLoading } = useAuth();
  const { roles, loading: rolesLoading } = useUserRoles(user?.id);
  const navigate = useNavigate();
  const isAdmin = !!roles?.includes("admin");
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [inputs, setInputs] = useState<PricingInputs>({ distance_km: 10 });
  const [validUntil, setValidUntil] = useState(validUntilDefault());
  const [adjustment, setAdjustment] = useState(0);
  const [overrideReason, setOverrideReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || rolesLoading || roles === null) return;
    if (!user || !isAdmin) navigate({ to: "/app" });
  }, [authLoading, rolesLoading, roles, user, isAdmin, navigate]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: loadError } = await pricingDb.rpc("admin_quote_workspace", {
      p_booking_id: bookingId,
    });
    if (loadError) {
      setError(loadError.message);
      setWorkspace(null);
    } else {
      const next = asWorkspace(data);
      setWorkspace(next);
      if (next)
        setInputs((current) =>
          Object.keys(current).length > 1 ? current : defaultInputs(next.booking.service_type),
        );
    }
    setLoading(false);
  }, [bookingId]);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  const selectedQuote = useMemo(
    () =>
      workspace?.quotes.find((quote) => quote.status === "draft" && !quote.sent_at) ??
      workspace?.quotes[0] ??
      null,
    [workspace],
  );

  const generate = async () => {
    if (!workspace) return;
    setBusy("generate");
    const { error: generateError } = await pricingDb.rpc("admin_generate_service_quote", {
      p_booking_id: workspace.booking.id,
      p_inputs: inputs as unknown as JsonValue,
      p_valid_until: new Date(validUntil).toISOString(),
      p_expected_booking_status: workspace.booking.status,
      p_idempotency_key: crypto.randomUUID(),
    });
    setBusy(null);
    if (generateError) return toast.error(generateError.message);
    toast.success("Calculated quote revision generated");
    await load();
  };

  const applyOverride = async () => {
    if (!selectedQuote) return;
    setBusy("override");
    const { error: overrideError } = await pricingDb.rpc("admin_apply_quote_override", {
      p_quote_id: selectedQuote.id,
      p_adjustment: Number(adjustment),
      p_reason: overrideReason,
      p_expected_row_version: selectedQuote.row_version,
    });
    setBusy(null);
    if (overrideError) return toast.error(overrideError.message);
    toast.success("Audited quote adjustment applied");
    setAdjustment(0);
    setOverrideReason("");
    await load();
  };

  const sendQuote = async () => {
    if (!selectedQuote) return;
    setBusy("send");
    const { error: sendError } = await pricingDb.rpc("admin_send_service_quote", {
      p_quote_id: selectedQuote.id,
      p_valid_until: new Date(validUntil).toISOString(),
      p_expected_row_version: selectedQuote.row_version,
      p_idempotency_key: crypto.randomUUID(),
    });
    setBusy(null);
    if (sendError) return toast.error(sendError.message);
    toast.success("Quote sent. Any previous actionable quote was superseded.");
    await load();
  };

  if (authLoading || rolesLoading || (user && roles === null)) {
    return (
      <AdminShell title="Quote Workspace">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </AdminShell>
    );
  }
  if (!isAdmin) return null;

  return (
    <AdminShell
      title="Quote Workspace"
      subtitle="Generate, revise and send a deterministic service quote."
    >
      <Button asChild variant="ghost" size="sm" className="mb-3">
        <Link to="/app/admin/bookings">
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
          Loading quote workspace…
        </div>
      ) : null}

      {workspace ? (
        <div className="space-y-5">
          <section className="rounded-2xl border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {workspace.booking.booking_reference}
                </p>
                <h2 className="text-lg font-semibold">
                  {SERVICE_TYPE_LABEL[workspace.booking.service_type]}
                </h2>
              </div>
              <Badge variant="outline">{workspace.booking.status.replaceAll("_", " ")}</Badge>
            </div>
            <div className="mt-3 flex items-start gap-2 rounded-xl bg-primary/5 p-3 text-sm">
              <ShieldCheck className="mt-0.5 h-4 w-4 text-primary" />
              <p>
                The server resolves the effective published version from the service start date and
                stores an immutable component/rate snapshot.
              </p>
            </div>
          </section>

          <section className="rounded-2xl border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 font-semibold">
                <Calculator className="h-4 w-4" />
                Calculation inputs
              </h3>
              <Button onClick={() => void generate()} disabled={busy === "generate"}>
                {busy === "generate" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Generate revision
              </Button>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {Object.entries(inputs)
                .filter(([, value]) => typeof value === "number")
                .map(([key, value]) => (
                  <div key={key}>
                    <Label>{key.replaceAll("_", " ")}</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.25"
                      value={Number(value)}
                      onChange={(event) =>
                        setInputs({ ...inputs, [key]: Number(event.target.value) })
                      }
                    />
                  </div>
                ))}
              <div>
                <Label>Quote valid until</Label>
                <Input
                  type="datetime-local"
                  value={validUntil}
                  onChange={(event) => setValidUntil(event.target.value)}
                />
              </div>
            </div>
          </section>

          {selectedQuote?.status === "draft" && !selectedQuote.sent_at ? (
            <section className="rounded-2xl border bg-card p-4 shadow-sm">
              <h3 className="font-semibold">Draft revision {selectedQuote.revision_number}</h3>
              <div className="mt-3 space-y-1 text-sm">
                {workspace.items
                  .filter((item) => item.quote_id === selectedQuote.id)
                  .map((item) => (
                    <div key={item.id} className="flex justify-between gap-3">
                      <span>
                        {item.label} × {Number(item.quantity)} {item.unit ?? ""}
                        {item.customer_visible ? "" : " · internal"}
                      </span>
                      <span>{formatZAR(Number(item.line_total))}</span>
                    </div>
                  ))}
                <div className="mt-2 flex justify-between border-t pt-2">
                  <span>Calculated subtotal</span>
                  <span>{formatZAR(Number(selectedQuote.subtotal))}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Internal margin</span>
                  <span>{formatZAR(Number(selectedQuote.margin_amount))}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Audited adjustment</span>
                  <span>{formatZAR(Number(selectedQuote.adjustments_total))}</span>
                </div>
                <div className="flex justify-between text-base font-semibold">
                  <span>Customer total</span>
                  <span>{formatZAR(Number(selectedQuote.final_total))}</span>
                </div>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-[160px_1fr_auto]">
                <div>
                  <Label>Adjustment (+/- ZAR)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={adjustment}
                    onChange={(event) => setAdjustment(Number(event.target.value))}
                  />
                </div>
                <div>
                  <Label>Mandatory reason</Label>
                  <Textarea
                    value={overrideReason}
                    onChange={(event) => setOverrideReason(event.target.value)}
                  />
                </div>
                <div className="flex items-end">
                  <Button
                    variant="outline"
                    disabled={!overrideReason.trim() || busy === "override"}
                    onClick={() => void applyOverride()}
                  >
                    Apply override
                  </Button>
                </div>
              </div>
              <div className="mt-4 flex justify-end">
                <Button onClick={() => void sendQuote()} disabled={busy === "send"}>
                  {busy === "send" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="mr-2 h-4 w-4" />
                  )}
                  Send quote
                </Button>
              </div>
            </section>
          ) : null}

          <section className="rounded-2xl border bg-card p-4 shadow-sm">
            <h3 className="flex items-center gap-2 font-semibold">
              <History className="h-4 w-4" />
              Revision history
            </h3>
            <div className="mt-3 space-y-3">
              {workspace.quotes.length === 0 ? (
                <p className="text-sm text-muted-foreground">No quote revisions yet.</p>
              ) : (
                workspace.quotes.map((quote) => (
                  <article key={quote.id} className="rounded-xl border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium">
                          {quote.quote_reference} · revision {quote.revision_number}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Created {new Date(quote.created_at).toLocaleString("en-ZA")}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{quote.status}</Badge>
                        <span className="font-semibold">
                          {formatZAR(Number(quote.final_total))}
                        </span>
                      </div>
                    </div>
                    {quote.admin_override_reason ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Override: {quote.admin_override_reason}
                      </p>
                    ) : null}
                    {quote.superseded_at ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Superseded {new Date(quote.superseded_at).toLocaleString("en-ZA")}
                      </p>
                    ) : null}
                  </article>
                ))
              )}
            </div>
          </section>

          <section className="rounded-2xl border bg-card p-4">
            <h3 className="font-semibold">Audit events</h3>
            <div className="mt-3 space-y-2 text-sm">
              {workspace.audit_events.length === 0 ? (
                <p className="text-muted-foreground">No audit events.</p>
              ) : (
                workspace.audit_events.map((event) => (
                  <div key={event.id} className="rounded-lg bg-secondary/60 p-2">
                    <div className="flex justify-between gap-2">
                      <span>{event.event_type.replaceAll("_", " ")}</span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(event.created_at).toLocaleString("en-ZA")}
                      </span>
                    </div>
                    {event.reason ? (
                      <p className="text-xs text-muted-foreground">{event.reason}</p>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      ) : null}
    </AdminShell>
  );
}
