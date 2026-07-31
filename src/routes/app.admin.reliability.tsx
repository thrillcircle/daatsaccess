import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Play, RefreshCw, RotateCcw, ShieldCheck } from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useAuth, useUserRoles } from "@/hooks/use-auth";
import { asRows, formatOperationTime, operationsDb, type OperationalAlert } from "@/lib/operations";
import { toast } from "sonner";

export const Route = createFileRoute("/app/admin/reliability")({
  head: () => ({ meta: [{ title: "Operational Reliability — Admin" }] }),
  component: ReliabilityPage,
});

type SchedulerRun = {
  id: string;
  scheduler_key: string;
  trigger_source: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  processed_counts: unknown;
  failure_reason: string | null;
  duration_ms: number | null;
};
type Outbox = {
  id: string;
  recipient_user_id: string;
  notification_type: string;
  title: string;
  status: string;
  attempt_count: number;
  last_error: string | null;
  created_at: string;
};
type Issue = {
  id: string;
  issue_type: string;
  source_type: string;
  source_id: string | null;
  severity: string;
  status: string;
  details: unknown;
  created_at: string;
};

function ReliabilityPage() {
  const { user, loading: authLoading } = useAuth();
  const { roles, loading: rolesLoading } = useUserRoles(user?.id);
  const navigate = useNavigate();
  const isAdmin = !!roles?.includes("admin");
  const [schedulerRuns, setSchedulerRuns] = useState<SchedulerRun[]>([]);
  const [outbox, setOutbox] = useState<Outbox[]>([]);
  const [alerts, setAlerts] = useState<OperationalAlert[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [busy, setBusy] = useState(false);
  const [resolutionByAlert, setResolutionByAlert] = useState<Record<string, string>>({});

  useEffect(() => {
    if (authLoading || rolesLoading || roles === null) return;
    if (!user || !isAdmin) navigate({ to: "/app" });
  }, [authLoading, rolesLoading, roles, user, isAdmin, navigate]);

  const load = useCallback(async () => {
    if (!isAdmin) return;
    const [schedulerRes, outboxRes, alertRes, issueRes] = await Promise.all([
      operationsDb
        .from("operations_scheduler_runs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(30),
      operationsDb
        .from("notification_outbox")
        .select(
          "id,recipient_user_id,notification_type,title,status,attempt_count,last_error,created_at",
        )
        .order("created_at", { ascending: false })
        .limit(100),
      operationsDb
        .from("operational_alerts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100),
      operationsDb
        .from("operation_reconciliation_issues")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    const error = schedulerRes.error || outboxRes.error || alertRes.error || issueRes.error;
    if (error) toast.error(error.message);
    else {
      setSchedulerRuns(asRows<SchedulerRun>(schedulerRes.data));
      setOutbox(asRows<Outbox>(outboxRes.data));
      setAlerts(asRows<OperationalAlert>(alertRes.data));
      setIssues(asRows<Issue>(issueRes.data));
    }
  }, [isAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runScheduler() {
    setBusy(true);
    const { error } = await operationsDb.rpc("admin_run_operations_scheduler", {
      p_idempotency_key: crypto.randomUUID(),
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Reliability worker completed");
      await load();
    }
  }

  async function resolveAlert(alert: OperationalAlert) {
    const note = resolutionByAlert[alert.id]?.trim();
    if (!note) return;
    setBusy(true);
    const { error } = await operationsDb.rpc("admin_resolve_operational_alert", {
      p_alert_id: alert.id,
      p_resolution_note: note,
      p_dismiss: false,
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Alert resolved");
      setResolutionByAlert((previous) => ({ ...previous, [alert.id]: "" }));
      await load();
    }
  }

  if (!isAdmin) return null;
  const openAlerts = alerts.filter((alert) => ["open", "acknowledged"].includes(alert.status));
  return (
    <AdminShell
      title="Operational Reliability"
      subtitle="Scheduler health, notification delivery, conflict detection, unresolved alerts and migration reconciliation."
      actions={
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Button size="sm" onClick={() => void runScheduler()} disabled={busy}>
            <Play className="mr-2 h-4 w-4" />
            Run worker
          </Button>
        </div>
      }
    >
      <div className="grid gap-4 md:grid-cols-4">
        <Metric label="Open alerts" value={openAlerts.length} />
        <Metric
          label="Pending notifications"
          value={
            outbox.filter((item) => ["pending", "retrying", "processing"].includes(item.status))
              .length
          }
        />
        <Metric
          label="Failed notifications"
          value={outbox.filter((item) => item.status === "failed").length}
        />
        <Metric
          label="Reconciliation issues"
          value={issues.filter((issue) => issue.status === "open").length}
        />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4" />
              Scheduler executions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {schedulerRuns.map((run) => (
              <div key={run.id} className="rounded-lg border p-3 text-sm">
                <div className="flex justify-between gap-2">
                  <p className="font-medium">{run.scheduler_key}</p>
                  <Badge
                    variant={
                      run.status === "succeeded"
                        ? "default"
                        : run.status === "failed"
                          ? "destructive"
                          : "outline"
                    }
                  >
                    {run.status}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {run.trigger_source} · {formatOperationTime(run.started_at)} ·{" "}
                  {run.duration_ms ?? 0} ms
                </p>
                {run.failure_reason ? (
                  <p className="mt-2 text-xs text-destructive">{run.failure_reason}</p>
                ) : null}
              </div>
            ))}
            {!schedulerRuns.length ? (
              <p className="text-sm text-muted-foreground">The worker has not run yet.</p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <RotateCcw className="h-4 w-4" />
              Notification outbox
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {outbox.slice(0, 20).map((item) => (
              <div key={item.id} className="rounded-lg border p-3 text-sm">
                <div className="flex justify-between gap-2">
                  <p className="font-medium">{item.title}</p>
                  <Badge variant={item.status === "failed" ? "destructive" : "outline"}>
                    {item.status}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {item.notification_type} · attempts {item.attempt_count}
                </p>
                {item.last_error ? (
                  <p className="mt-2 text-xs text-destructive">{item.last_error}</p>
                ) : null}
              </div>
            ))}
            {!outbox.length ? (
              <p className="text-sm text-muted-foreground">No queued notifications.</p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            Operational alerts
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-2">
          {openAlerts.map((alert) => (
            <div key={alert.id} className="rounded-lg border p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{alert.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {alert.alert_type.replaceAll("_", " ")} ·{" "}
                    {formatOperationTime(alert.created_at)}
                  </p>
                </div>
                <Badge variant={alert.severity === "critical" ? "destructive" : "outline"}>
                  {alert.severity}
                </Badge>
              </div>
              {alert.operation_run_id ? (
                <Button asChild variant="link" size="sm" className="mt-1 h-auto p-0">
                  <Link
                    to="/app/admin/operations/$runId"
                    params={{ runId: alert.operation_run_id }}
                  >
                    Open operation
                  </Link>
                </Button>
              ) : null}
              <Textarea
                className="mt-3"
                placeholder="Resolution note"
                value={resolutionByAlert[alert.id] ?? ""}
                onChange={(event) =>
                  setResolutionByAlert((previous) => ({
                    ...previous,
                    [alert.id]: event.target.value,
                  }))
                }
              />
              <Button
                className="mt-2"
                size="sm"
                onClick={() => void resolveAlert(alert)}
                disabled={!resolutionByAlert[alert.id]?.trim() || busy}
              >
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Resolve
              </Button>
            </div>
          ))}
          {!openAlerts.length ? (
            <p className="text-sm text-muted-foreground">No open reliability alerts.</p>
          ) : null}
        </CardContent>
      </Card>

      <Card className="mt-5">
        <CardHeader>
          <CardTitle className="text-base">Reconciliation issues</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {issues.map((issue) => (
            <div key={issue.id} className="rounded-lg border p-3 text-sm">
              <div className="flex justify-between gap-2">
                <p className="font-medium">{issue.issue_type.replaceAll("_", " ")}</p>
                <Badge variant={issue.severity === "critical" ? "destructive" : "outline"}>
                  {issue.status}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {issue.source_type} · {issue.source_id?.slice(0, 8) || "no source"}
              </p>
            </div>
          ))}
          {!issues.length ? (
            <p className="text-sm text-muted-foreground">No reconciliation issues.</p>
          ) : null}
        </CardContent>
      </Card>
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
