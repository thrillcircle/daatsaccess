import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Radio, RefreshCw, RotateCcw, Send, TimerOff } from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import {
  DispatchStatusBadge,
  OperationStatusBadge,
} from "@/components/operations/OperationStatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth, useUserRoles } from "@/hooks/use-auth";
import {
  asRows,
  formatOperationTime,
  operationsDb,
  type DispatchOffer,
  type OperationRun,
} from "@/lib/operations";
import { toast } from "sonner";

export const Route = createFileRoute("/app/admin/dispatch")({
  head: () => ({ meta: [{ title: "Dispatch — Admin" }] }),
  component: DispatchPage,
});

type Profile = { user_id: string; full_name: string | null };
type Alert = {
  id: string;
  operation_run_id: string | null;
  title: string;
  severity: string;
  status: string;
};

function DispatchPage() {
  const { user, loading: authLoading } = useAuth();
  const { roles, loading: rolesLoading } = useUserRoles(user?.id);
  const navigate = useNavigate();
  const isAdmin = !!roles?.includes("admin");
  const [runs, setRuns] = useState<OperationRun[]>([]);
  const [offers, setOffers] = useState<DispatchOffer[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || rolesLoading || roles === null) return;
    if (!user || !isAdmin) navigate({ to: "/app" });
  }, [authLoading, rolesLoading, roles, user, isAdmin, navigate]);

  const load = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    const [runRes, offerRes, profileRes, alertRes] = await Promise.all([
      operationsDb
        .from("operation_runs")
        .select("*")
        .in("run_type", ["immediate_ride", "scheduled_ride", "transport_leg"])
        .not("operational_status", "in", "(completed,cancelled,failed)")
        .order("priority", { ascending: false })
        .order("planned_start_at", { ascending: true }),
      operationsDb
        .from("dispatch_offers")
        .select("*")
        .order("offered_at", { ascending: false })
        .limit(200),
      operationsDb.from("profiles").select("user_id,full_name"),
      operationsDb
        .from("operational_alerts")
        .select("id,operation_run_id,title,severity,status")
        .in("alert_type", ["no_driver", "dispatch_exhausted"])
        .in("status", ["open", "acknowledged"]),
    ]);
    const error = runRes.error || offerRes.error || profileRes.error || alertRes.error;
    if (error) toast.error(error.message);
    else {
      setRuns(asRows<OperationRun>(runRes.data));
      setOffers(asRows<DispatchOffer>(offerRes.data));
      setAlerts(asRows<Alert>(alertRes.data));
      setProfiles(
        Object.fromEntries(
          asRows<Profile>(profileRes.data).map((profile) => [profile.user_id, profile]),
        ),
      );
    }
    setLoading(false);
  }, [isAdmin]);

  useEffect(() => {
    void load();
    if (!isAdmin) return;
    const channel = operationsDb
      .channel("admin-phase5-dispatch")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "dispatch_offers" },
        () => void load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "operation_runs" },
        () => void load(),
      )
      .subscribe();
    return () => {
      void operationsDb.removeChannel(channel);
    };
  }, [isAdmin, load]);

  const offersByRun = useMemo(() => {
    const grouped = new Map<string, DispatchOffer[]>();
    for (const offer of offers)
      grouped.set(offer.operation_run_id, [...(grouped.get(offer.operation_run_id) ?? []), offer]);
    return grouped;
  }, [offers]);

  async function dispatch(run: OperationRun) {
    setBusy(run.id);
    const { error } = await operationsDb.rpc("admin_dispatch_operation", {
      p_run_id: run.id,
      p_expected_run_version: run.row_version,
      p_candidate_limit: 5,
      p_offer_minutes: 2,
      p_idempotency_key: crypto.randomUUID(),
    });
    setBusy(null);
    if (error) toast.error(error.message);
    else {
      toast.success("Dispatch wave created");
      await load();
    }
  }

  if (!isAdmin) return null;
  return (
    <AdminShell
      title="Dispatch"
      subtitle="Auditable Driver offers replace open ride broadcasts. The first eligible acceptance wins transactionally."
      actions={
        <Button variant="outline" size="sm" onClick={() => void load()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      }
    >
      <div className="grid gap-4 md:grid-cols-4">
        <Metric
          label="Pending"
          value={runs.filter((run) => run.dispatch_status === "pending").length}
        />
        <Metric
          label="Offers active"
          value={
            offers.filter(
              (offer) => offer.status === "offered" && new Date(offer.expires_at) > new Date(),
            ).length
          }
        />
        <Metric
          label="Acknowledged"
          value={runs.filter((run) => run.dispatch_status === "acknowledged").length}
        />
        <Metric label="Dispatch alerts" value={alerts.length} />
      </div>

      <div className="mt-5 space-y-4">
        {loading ? <p className="text-sm text-muted-foreground">Loading dispatch queue…</p> : null}
        {!loading && !runs.length ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No active transport runs require dispatch.
            </CardContent>
          </Card>
        ) : null}
        {runs.map((run) => {
          const runOffers = offersByRun.get(run.id) ?? [];
          const activeOffers = runOffers.filter(
            (offer) => offer.status === "offered" && new Date(offer.expires_at) > new Date(),
          );
          const runAlerts = alerts.filter((alert) => alert.operation_run_id === run.id);
          return (
            <Card key={run.id}>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        to="/app/admin/operations/$runId"
                        params={{ runId: run.id }}
                        className="font-semibold text-primary hover:underline"
                      >
                        {run.run_reference}
                      </Link>
                      <OperationStatusBadge status={run.operational_status} />
                      <DispatchStatusBadge status={run.dispatch_status} />
                      {run.priority !== "normal" ? (
                        <Badge variant="destructive">{run.priority}</Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {run.pickup_address || "Pickup pending"} →{" "}
                      {run.destination_address || "Destination pending"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatOperationTime(run.planned_start_at)}
                    </p>
                  </div>
                  {!(["assigned", "acknowledged", "manually_assigned"] as string[]).includes(
                    run.dispatch_status,
                  ) ? (
                    <Button
                      onClick={() => void dispatch(run)}
                      disabled={busy === run.id || run.is_verification_record}
                    >
                      {run.dispatch_status === "expired" ? (
                        <RotateCcw className="mr-2 h-4 w-4" />
                      ) : (
                        <Send className="mr-2 h-4 w-4" />
                      )}
                      {run.dispatch_status === "expired" ? "Retry dispatch" : "Create offers"}
                    </Button>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent>
                {run.is_verification_record ? (
                  <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                    Verification records cannot enter live dispatch.
                  </div>
                ) : null}
                {runAlerts.map((alert) => (
                  <div
                    key={alert.id}
                    className="mb-3 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm"
                  >
                    <TimerOff className="h-4 w-4 text-amber-600" />
                    {alert.title}
                  </div>
                ))}
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {runOffers.length ? (
                    runOffers.slice(0, 9).map((offer) => (
                      <div key={offer.id} className="rounded-lg border p-3 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-medium">
                            {profiles[offer.driver_user_id]?.full_name ||
                              `Driver ${offer.driver_user_id.slice(0, 8)}`}
                          </p>
                          <Badge
                            variant={
                              offer.status === "accepted"
                                ? "default"
                                : offer.status === "offered"
                                  ? "secondary"
                                  : "outline"
                            }
                          >
                            {offer.status}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Wave {offer.dispatch_wave} · expires{" "}
                          {new Date(offer.expires_at).toLocaleTimeString("en-ZA", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                        {offer.response_reason ? (
                          <p className="mt-2 text-xs text-muted-foreground">
                            {offer.response_reason}
                          </p>
                        ) : null}
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No offers have been created yet.
                    </p>
                  )}
                </div>
                {activeOffers.length ? (
                  <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                    <Radio className="h-3.5 w-3.5 animate-pulse text-primary" />
                    {activeOffers.length} Driver offer(s) awaiting response
                  </p>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </AdminShell>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <p className="text-2xl font-semibold">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}
