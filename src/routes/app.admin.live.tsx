import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, Clock3, MapPin, RefreshCw, ShieldAlert } from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import {
  DispatchStatusBadge,
  OperationStatusBadge,
} from "@/components/operations/OperationStatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth, useUserRoles } from "@/hooks/use-auth";
import {
  asRows,
  formatOperationTime,
  locationFreshness,
  operationsDb,
  type OperationAssignment,
  type OperationalAlert,
  type OperationRun,
} from "@/lib/operations";
import { toast } from "sonner";

export const Route = createFileRoute("/app/admin/live")({
  head: () => ({ meta: [{ title: "Live Operations — Admin" }] }),
  component: LiveOperationsPage,
});

type DriverProfile = {
  user_id: string;
  location_updated_at: string | null;
  current_lat: number | null;
  current_lng: number | null;
};
type Profile = { user_id: string; full_name: string | null };
type Incident = {
  id: string;
  operation_run_id: string | null;
  incident_reference: string;
  severity: string;
  status: string;
  title: string;
};

const LIVE_STATUSES = [
  "ready",
  "dispatched",
  "driver_en_route",
  "driver_arrived",
  "passenger_on_board",
  "in_service",
  "waiting",
  "interrupted",
] as const;

function LiveOperationsPage() {
  const { user, loading: authLoading } = useAuth();
  const { roles, loading: rolesLoading } = useUserRoles(user?.id);
  const navigate = useNavigate();
  const isAdmin = !!roles?.includes("admin");
  const [runs, setRuns] = useState<OperationRun[]>([]);
  const [assignments, setAssignments] = useState<OperationAssignment[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [driverProfiles, setDriverProfiles] = useState<Record<string, DriverProfile>>({});
  const [alerts, setAlerts] = useState<OperationalAlert[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading || rolesLoading || roles === null) return;
    if (!user || !isAdmin) navigate({ to: "/app" });
  }, [authLoading, rolesLoading, roles, user, isAdmin, navigate]);

  const load = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    const [runRes, assignmentRes, profileRes, driverRes, alertRes, incidentRes] = await Promise.all(
      [
        operationsDb
          .from("operation_runs")
          .select("*")
          .in("operational_status", [...LIVE_STATUSES])
          .order("planned_start_at"),
        operationsDb
          .from("operation_run_assignments")
          .select("*")
          .in("status", ["reserved", "assigned", "acknowledged"]),
        operationsDb.from("profiles").select("user_id,full_name"),
        operationsDb
          .from("driver_profiles")
          .select("user_id,location_updated_at,current_lat,current_lng"),
        operationsDb
          .from("operational_alerts")
          .select("*")
          .in("status", ["open", "acknowledged"])
          .order("created_at", { ascending: false }),
        operationsDb
          .from("operational_incidents")
          .select("id,operation_run_id,incident_reference,severity,status,title")
          .not("status", "in", "(resolved,closed)")
          .order("created_at", { ascending: false }),
      ],
    );
    const error =
      runRes.error ||
      assignmentRes.error ||
      profileRes.error ||
      driverRes.error ||
      alertRes.error ||
      incidentRes.error;
    if (error) toast.error(error.message);
    else {
      setRuns(asRows<OperationRun>(runRes.data));
      setAssignments(asRows<OperationAssignment>(assignmentRes.data));
      setProfiles(
        Object.fromEntries(
          asRows<Profile>(profileRes.data).map((profile) => [profile.user_id, profile]),
        ),
      );
      setDriverProfiles(
        Object.fromEntries(
          asRows<DriverProfile>(driverRes.data).map((profile) => [profile.user_id, profile]),
        ),
      );
      setAlerts(asRows<OperationalAlert>(alertRes.data));
      setIncidents(asRows<Incident>(incidentRes.data));
    }
    setLoading(false);
  }, [isAdmin]);

  useEffect(() => {
    void load();
    if (!isAdmin) return;
    const channel = operationsDb
      .channel("phase5-live-operations")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "operation_runs" },
        () => void load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "operation_run_assignments" },
        () => void load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "operational_alerts" },
        () => void load(),
      )
      .subscribe();
    return () => {
      void operationsDb.removeChannel(channel);
    };
  }, [isAdmin, load]);

  const counts = useMemo(
    () =>
      Object.fromEntries(
        LIVE_STATUSES.map((status) => [
          status,
          runs.filter((run) => run.operational_status === status).length,
        ]),
      ),
    [runs],
  );

  if (!isAdmin) return null;
  return (
    <AdminShell
      title="Live Operations"
      subtitle="Server-authoritative service runs, current assignments, Driver location freshness, alerts and incidents."
      actions={
        <Button size="sm" variant="outline" onClick={() => void load()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        {LIVE_STATUSES.map((status) => (
          <Card key={status}>
            <CardContent className="pt-4">
              <p className="text-xl font-semibold">{counts[status] ?? 0}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {status.replaceAll("_", " ")}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_320px]">
        <div className="space-y-3">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading live operations…</p>
          ) : null}
          {!loading && !runs.length ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                No active operations right now.
              </CardContent>
            </Card>
          ) : null}
          {runs.map((run) => {
            const driverAssignment = assignments.find(
              (assignment) =>
                assignment.operation_run_id === run.id && assignment.resource_type === "driver",
            );
            const driver = driverAssignment?.driver_user_id
              ? driverProfiles[driverAssignment.driver_user_id]
              : undefined;
            const freshness = locationFreshness(driver?.location_updated_at);
            const runAlerts = alerts.filter((alert) => alert.operation_run_id === run.id);
            const runIncidents = incidents.filter(
              (incident) => incident.operation_run_id === run.id,
            );
            return (
              <Card key={run.id}>
                <CardContent className="pt-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
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
                        {runAlerts.length ? (
                          <Badge variant="destructive">
                            {runAlerts.length} alert{runAlerts.length === 1 ? "" : "s"}
                          </Badge>
                        ) : null}
                        {runIncidents.length ? <Badge variant="destructive">Incident</Badge> : null}
                      </div>
                      <p className="mt-2 flex items-start gap-2 text-sm">
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        {run.pickup_address || "Pickup pending"} →{" "}
                        {run.destination_address || "Destination pending"}
                      </p>
                      <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                        <Clock3 className="h-3.5 w-3.5" />
                        {formatOperationTime(run.planned_start_at)}
                      </p>
                    </div>
                    <div className="min-w-52 rounded-lg border bg-muted/30 p-3 text-sm">
                      <p className="font-medium">
                        {driverAssignment?.driver_user_id
                          ? profiles[driverAssignment.driver_user_id]?.full_name ||
                            "Assigned Driver"
                          : "No Driver assigned"}
                      </p>
                      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                        <span
                          className={`h-2 w-2 rounded-full ${freshness.state === "fresh" ? "bg-emerald-500" : freshness.state === "delayed" ? "bg-amber-500" : "bg-destructive"}`}
                        />
                        {freshness.state === "unavailable"
                          ? "Location unavailable"
                          : `${freshness.state} · ${Math.round(freshness.minutes ?? 0)}m ago`}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="space-y-4">
          <Card>
            <CardContent className="pt-5">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-amber-600" />
                <p className="font-semibold">Open alerts</p>
              </div>
              <div className="mt-3 space-y-2">
                {alerts.slice(0, 8).map((alert) => (
                  <div key={alert.id} className="rounded-lg border p-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium">{alert.title}</p>
                      <Badge variant={alert.severity === "critical" ? "destructive" : "outline"}>
                        {alert.severity}
                      </Badge>
                    </div>
                  </div>
                ))}
                {!alerts.length ? (
                  <p className="text-sm text-muted-foreground">No open alerts.</p>
                ) : null}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                <p className="font-semibold">Active incidents</p>
              </div>
              <div className="mt-3 space-y-2">
                {incidents.slice(0, 8).map((incident) => (
                  <div key={incident.id} className="rounded-lg border p-2 text-xs">
                    <p className="font-medium">
                      {incident.incident_reference} · {incident.title}
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      {incident.severity} · {incident.status}
                    </p>
                  </div>
                ))}
                {!incidents.length ? (
                  <p className="text-sm text-muted-foreground">No active incidents.</p>
                ) : null}
              </div>
            </CardContent>
          </Card>
          <Button asChild variant="outline" className="w-full">
            <Link to="/app/admin/reliability">
              <Activity className="mr-2 h-4 w-4" />
              Open reliability centre
            </Link>
          </Button>
        </div>
      </div>
    </AdminShell>
  );
}
