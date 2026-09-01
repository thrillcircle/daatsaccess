import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AlertCircle, CreditCard, Loader2, RefreshCcw, ShieldCheck, Siren } from "lucide-react";
import { toast } from "sonner";
import { AdminShell } from "@/components/AdminShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatZAR } from "@/lib/pricing";
import {
  adminListPaymentRefunds,
  adminListPrivacyRequests,
  adminUpdatePrivacyRequest,
  getCommercialSnapshot,
  processPayfastRefund,
  type CommercialSnapshot,
  type PaymentRefund,
  type PrivacyRequest,
} from "@/lib/phase7-commercial";

export const Route = createFileRoute("/app/admin/commercial")({
  head: () => ({ meta: [{ title: "Commercial Readiness — Access Admin" }] }),
  component: AdminCommercialPage,
});

function AdminCommercialPage() {
  const [snapshot, setSnapshot] = useState<CommercialSnapshot | null>(null);
  const [refunds, setRefunds] = useState<PaymentRefund[]>([]);
  const [privacy, setPrivacy] = useState<PrivacyRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [privacyResolution, setPrivacyResolution] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    try {
      const [commercial, refundRows, privacyRows] = await Promise.all([
        getCommercialSnapshot(),
        adminListPaymentRefunds(),
        adminListPrivacyRequests(),
      ]);
      setSnapshot(commercial);
      setRefunds(refundRows);
      setPrivacy(privacyRows);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not load commercial readiness data",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function processRefund(refund: PaymentRefund) {
    setBusy(`refund:${refund.id}`);
    try {
      const result = await processPayfastRefund(refund.id);
      if (result.status === "action_required") {
        toast.warning(result.message ?? "Refund requires administrator handling");
      } else {
        toast.success("Refund processed");
      }
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not process refund");
    } finally {
      setBusy(null);
    }
  }

  async function updatePrivacy(request: PrivacyRequest, status: PrivacyRequest["status"]) {
    setBusy(`privacy:${request.id}`);
    try {
      await adminUpdatePrivacyRequest({
        requestId: request.id,
        status,
        adminNote: status === "in_progress" ? "Request accepted for processing" : undefined,
        resolutionSummary: privacyResolution[request.id]?.trim() || undefined,
      });
      toast.success(`Privacy request ${status.replaceAll("_", " ")}`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update privacy request");
    } finally {
      setBusy(null);
    }
  }

  const activeRefunds = refunds.filter((item) =>
    ["requested", "failed", "action_required", "processing"].includes(item.status),
  );
  const activePrivacy = privacy.filter((item) =>
    ["requested", "in_progress"].includes(item.status),
  );

  return (
    <AdminShell title="Commercial Readiness">
      <div className="space-y-4">
        <section className="rounded-2xl border bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-primary" />
                <h1 className="text-xl font-semibold">Commercial readiness</h1>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Payments, refunds, operational exceptions, safety, privacy and notification
                readiness in one place.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCcw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>
        </section>

        {loading || !snapshot ? (
          <section className="rounded-2xl border bg-card p-10 text-center text-sm text-muted-foreground">
            <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> Loading commercial snapshot…
          </section>
        ) : (
          <>
            <section className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Operations
              </h2>
              <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
                <Metric label="Trips today" value={snapshot.operations.trips_today} />
                <Metric label="Requested" value={snapshot.operations.requested} />
                <Metric label="Accepted / arriving" value={snapshot.operations.accepted} />
                <Metric label="In progress" value={snapshot.operations.in_progress} />
                <Metric label="Completed today" value={snapshot.operations.completed_today} />
                <Metric label="Cancelled today" value={snapshot.operations.cancelled_today} />
              </div>
            </section>

            <section className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Payments
              </h2>
              <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
                <Metric
                  label="Collected today"
                  value={formatZAR(Number(snapshot.payments.collected_today))}
                />
                <Metric label="Pending payments" value={snapshot.payments.pending} />
                <Metric label="Failed today" value={snapshot.payments.failed_today} />
                <Metric label="Refund queue" value={snapshot.payments.refunds_requested} />
                <Metric label="Refunds today" value={snapshot.payments.refunds_completed_today} />
                <Metric
                  label="Cancellation charges"
                  value={formatZAR(Number(snapshot.payments.cancellation_charges_today))}
                />
              </div>
            </section>

            <section className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                System
              </h2>
              <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-7">
                <Metric
                  label="Notification failures"
                  value={snapshot.system.notification_failures}
                  warn={snapshot.system.notification_failures > 0}
                />
                <Metric
                  label="External channels"
                  value={snapshot.system.external_channels_action_required}
                  warn={snapshot.system.external_channels_action_required > 0}
                />
                <Metric
                  label="Open SOS"
                  value={snapshot.system.open_safety_incidents}
                  warn={snapshot.system.open_safety_incidents > 0}
                />
                <Metric
                  label="Urgent support"
                  value={snapshot.system.urgent_support_cases}
                  warn={snapshot.system.urgent_support_cases > 0}
                />
                <Metric
                  label="Privacy requests"
                  value={snapshot.system.open_privacy_requests}
                  warn={snapshot.system.open_privacy_requests > 0}
                />
                <Metric
                  label="Scheduler failures"
                  value={snapshot.system.scheduler_failures_24h}
                  warn={snapshot.system.scheduler_failures_24h > 0}
                />
                <Metric
                  label="Ops alerts"
                  value={snapshot.system.unresolved_operational_alerts}
                  warn={snapshot.system.unresolved_operational_alerts > 0}
                />
              </div>
              {snapshot.system.external_channels_action_required > 0 ? (
                <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>
                    External push/SMS/WhatsApp/email delivery records are waiting for provider
                    configuration. In-app notifications remain active. No provider secrets are
                    stored in app settings.
                  </p>
                </div>
              ) : null}
            </section>
          </>
        )}

        <section className="rounded-2xl border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-primary" />
            <h2 className="font-semibold">Refund & cancellation settlement queue</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Prepaid fares are netted against cancellation charges. Only the unused balance is
            refunded; only a shortfall can become an additional charge.
          </p>
          <div className="mt-4 space-y-2">
            {!activeRefunds.length ? (
              <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
                No refunds need attention.
              </p>
            ) : (
              activeRefunds.map((refund) => (
                <div key={refund.id} className="rounded-xl border p-3 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">
                        {refund.passenger_name ?? "Passenger"} · {formatZAR(Number(refund.amount))}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">{refund.reason}</p>
                      <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                        {refund.merchant_payment_id ?? refund.payment_id}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="rounded-full border px-2 py-1 text-xs capitalize">
                        {refund.status.replaceAll("_", " ")}
                      </span>
                      {refund.status !== "processing" ? (
                        <Button
                          className="mt-2 block"
                          size="sm"
                          variant="outline"
                          disabled={busy === `refund:${refund.id}`}
                          onClick={() => void processRefund(refund)}
                        >
                          {busy === `refund:${refund.id}` ? "Processing…" : "Process with PayFast"}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  {refund.action_required_reason || refund.failure_reason ? (
                    <p className="mt-2 rounded-lg bg-amber-500/10 p-2 text-xs">
                      {refund.action_required_reason ?? refund.failure_reason}
                    </p>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-2xl border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <Siren className="h-4 w-4 text-primary" />
            <h2 className="font-semibold">POPIA request queue</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Track data-export and account-deletion requests to a documented resolution.
          </p>
          <div className="mt-4 space-y-3">
            {!activePrivacy.length ? (
              <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
                No privacy requests need attention.
              </p>
            ) : (
              activePrivacy.map((request) => (
                <div key={request.id} className="rounded-xl border p-3 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">
                        {request.full_name ?? "User"} · {request.request_type.replaceAll("_", " ")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Requested {new Date(request.created_at).toLocaleString("en-ZA")}
                      </p>
                    </div>
                    <span className="rounded-full border px-2 py-1 text-xs capitalize">
                      {request.status.replaceAll("_", " ")}
                    </span>
                  </div>
                  <Textarea
                    className="mt-3"
                    rows={2}
                    placeholder="Resolution summary required before completion"
                    value={privacyResolution[request.id] ?? request.resolution_summary ?? ""}
                    onChange={(event) =>
                      setPrivacyResolution((current) => ({
                        ...current,
                        [request.id]: event.target.value,
                      }))
                    }
                  />
                  <div className="mt-2 flex flex-wrap justify-end gap-2">
                    {request.status === "requested" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy === `privacy:${request.id}`}
                        onClick={() => void updatePrivacy(request, "in_progress")}
                      >
                        Start processing
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      disabled={
                        busy === `privacy:${request.id}` ||
                        !(privacyResolution[request.id] ?? request.resolution_summary ?? "").trim()
                      }
                      onClick={() => void updatePrivacy(request, "completed")}
                    >
                      Mark completed
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={
                        busy === `privacy:${request.id}` ||
                        !(privacyResolution[request.id] ?? request.resolution_summary ?? "").trim()
                      }
                      onClick={() => void updatePrivacy(request, "rejected")}
                    >
                      Reject with reason
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </AdminShell>
  );
}

function Metric({
  label,
  value,
  warn = false,
}: {
  label: string;
  value: string | number;
  warn?: boolean;
}) {
  return (
    <div className={`rounded-xl border bg-card p-3 ${warn ? "border-amber-500/40" : ""}`}>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${warn ? "text-amber-700" : ""}`}>{value}</p>
    </div>
  );
}
