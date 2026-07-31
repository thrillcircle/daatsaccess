import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, Ban, Clock3, RefreshCw, Siren, UserRound, Wrench } from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import {
  DispatchStatusBadge,
  OperationStatusBadge,
} from "@/components/operations/OperationStatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth, useUserRoles } from "@/hooks/use-auth";
import {
  asRows,
  formatOperationTime,
  operationsDb,
  type OperationAssignment,
  type OperationalAlert,
  type OperationalIncident,
  type OperationRun,
} from "@/lib/operations";
import { toast } from "sonner";

export const Route = createFileRoute("/app/admin/operations/$runId")({
  head: () => ({ meta: [{ title: "Operation Detail — Admin" }] }),
  component: OperationDetailPage,
});

type Event = {
  id: string;
  event_type: string;
  reason: string | null;
  actor_role: string | null;
  created_at: string;
  passenger_visible: boolean;
  driver_visible: boolean;
};
type Profile = { user_id: string; full_name: string | null; phone: string | null };
type Vehicle = {
  id: string;
  vehicle_name: string;
  license_plate: string;
  make: string | null;
  model: string | null;
  status: string;
};
type Outbox = {
  id: string;
  notification_type: string;
  title: string;
  status: string;
  attempt_count: number;
  created_at: string;
  delivered_at: string | null;
};

function OperationDetailPage() {
  const { runId } = Route.useParams();
  const { user, loading: authLoading } = useAuth();
  const { roles, loading: rolesLoading } = useUserRoles(user?.id);
  const navigate = useNavigate();
  const isAdmin = !!roles?.includes("admin");
  const [run, setRun] = useState<OperationRun | null>(null);
  const [assignments, setAssignments] = useState<OperationAssignment[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [alerts, setAlerts] = useState<OperationalAlert[]>([]);
  const [incidents, setIncidents] = useState<OperationalIncident[]>([]);
  const [outbox, setOutbox] = useState<Outbox[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [vehicles, setVehicles] = useState<Record<string, Vehicle>>({});
  const [loading, setLoading] = useState(true);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [incidentOpen, setIncidentOpen] = useState(false);
  const [incidentType, setIncidentType] = useState("delay");
  const [incidentSeverity, setIncidentSeverity] = useState("medium");
  const [incidentTitle, setIncidentTitle] = useState("");
  const [incidentNotes, setIncidentNotes] = useState("");
  const [passengerSummary, setPassengerSummary] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (authLoading || rolesLoading || roles === null) return;
    if (!user || !isAdmin) navigate({ to: "/app" });
  }, [authLoading, rolesLoading, roles, user, isAdmin, navigate]);

  const load = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    const [
      runRes,
      assignmentRes,
      eventRes,
      alertRes,
      incidentRes,
      outboxRes,
      profileRes,
      vehicleRes,
    ] = await Promise.all([
      operationsDb.from("operation_runs").select("*").eq("id", runId).maybeSingle(),
      operationsDb
        .from("operation_run_assignments")
        .select("*")
        .eq("operation_run_id", runId)
        .order("created_at"),
      operationsDb
        .from("operation_run_events")
        .select("id,event_type,reason,actor_role,created_at,passenger_visible,driver_visible")
        .eq("operation_run_id", runId)
        .order("created_at", { ascending: false }),
      operationsDb
        .from("operational_alerts")
        .select("*")
        .eq("operation_run_id", runId)
        .order("created_at", { ascending: false }),
      operationsDb
        .from("operational_incidents")
        .select("*")
        .eq("operation_run_id", runId)
        .order("created_at", { ascending: false }),
      operationsDb
        .from("notification_outbox")
        .select("id,notification_type,title,status,attempt_count,created_at,delivered_at")
        .eq("operation_run_id", runId)
        .order("created_at", { ascending: false }),
      operationsDb.from("profiles").select("user_id,full_name,phone"),
      operationsDb
        .from("vehicle_profiles")
        .select("id,vehicle_name,license_plate,make,model,status"),
    ]);
    const error =
      runRes.error ||
      assignmentRes.error ||
      eventRes.error ||
      alertRes.error ||
      incidentRes.error ||
      outboxRes.error ||
      profileRes.error ||
      vehicleRes.error;
    if (error) toast.error(error.message);
    else {
      setRun((runRes.data ?? null) as OperationRun | null);
      setAssignments(asRows<OperationAssignment>(assignmentRes.data));
      setEvents(asRows<Event>(eventRes.data));
      setAlerts(asRows<OperationalAlert>(alertRes.data));
      setIncidents(asRows<OperationalIncident>(incidentRes.data));
      setOutbox(asRows<Outbox>(outboxRes.data));
      setProfiles(
        Object.fromEntries(
          asRows<Profile>(profileRes.data).map((profile) => [profile.user_id, profile]),
        ),
      );
      setVehicles(
        Object.fromEntries(
          asRows<Vehicle>(vehicleRes.data).map((vehicle) => [vehicle.id, vehicle]),
        ),
      );
    }
    setLoading(false);
  }, [isAdmin, runId]);

  useEffect(() => {
    void load();
  }, [load]);

  const driverAssignment = useMemo(
    () =>
      assignments.find(
        (assignment) =>
          assignment.resource_type === "driver" &&
          ["reserved", "assigned", "acknowledged"].includes(assignment.status),
      ),
    [assignments],
  );
  const vehicleAssignment = useMemo(
    () =>
      assignments.find(
        (assignment) =>
          assignment.resource_type === "vehicle" &&
          ["reserved", "assigned", "acknowledged"].includes(assignment.status),
      ),
    [assignments],
  );

  async function cancelOperation() {
    if (!run || !cancelReason.trim()) return;
    setBusy(true);
    const { error } = await operationsDb.rpc("admin_cancel_operation", {
      p_run_id: run.id,
      p_expected_run_version: run.row_version,
      p_reason: cancelReason.trim(),
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Operation cancelled");
      setCancelOpen(false);
      setCancelReason("");
      await load();
    }
  }

  async function createIncident() {
    if (!run || !incidentTitle.trim()) return;
    setBusy(true);
    const { error } = await operationsDb.rpc("admin_create_operational_incident", {
      p_run_id: run.id,
      p_incident_type: incidentType,
      p_severity: incidentSeverity,
      p_title: incidentTitle.trim(),
      p_internal_notes: incidentNotes || null,
      p_passenger_visible_summary: passengerSummary || null,
      p_support_ticket_id: null,
      p_maintenance_work_order_id: null,
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Incident created");
      setIncidentOpen(false);
      setIncidentTitle("");
      setIncidentNotes("");
      setPassengerSummary("");
      await load();
    }
  }

  if (!isAdmin) return null;
  if (loading)
    return (
      <AdminShell title="Operation detail">
        <p className="text-sm text-muted-foreground">Loading operation…</p>
      </AdminShell>
    );
  if (!run)
    return (
      <AdminShell title="Operation detail">
        <p className="text-sm text-muted-foreground">Operation not found.</p>
      </AdminShell>
    );

  return (
    <AdminShell
      title={run.run_reference}
      subtitle={`${run.run_type.replaceAll("_", " ")} · ${run.service_type.replaceAll("_", " ")}`}
      actions={
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={() => setIncidentOpen(true)}>
            <Siren className="mr-2 h-4 w-4" />
            Incident
          </Button>
          {!(["completed", "cancelled"] as string[]).includes(run.operational_status) ? (
            <Button variant="destructive" size="sm" onClick={() => setCancelOpen(true)}>
              <Ban className="mr-2 h-4 w-4" />
              Cancel
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <OperationStatusBadge status={run.operational_status} />
        <DispatchStatusBadge status={run.dispatch_status} />
        <Badge variant="outline">{run.planning_status.replaceAll("_", " ")}</Badge>
        {run.is_verification_record ? (
          <Badge variant="destructive">Verification record</Badge>
        ) : null}
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <InfoCard title="Schedule" icon={<Clock3 className="h-4 w-4" />}>
          <p>{formatOperationTime(run.planned_start_at)}</p>
          <p className="text-xs text-muted-foreground">
            to {formatOperationTime(run.planned_end_at)}
          </p>
        </InfoCard>
        <InfoCard title="Driver" icon={<UserRound className="h-4 w-4" />}>
          <p>
            {driverAssignment?.driver_user_id
              ? profiles[driverAssignment.driver_user_id]?.full_name ||
                driverAssignment.driver_user_id
              : "Unassigned"}
          </p>
          <p className="text-xs text-muted-foreground">
            {driverAssignment?.status || "No reservation"}
          </p>
        </InfoCard>
        <InfoCard title="Vehicle" icon={<Wrench className="h-4 w-4" />}>
          <p>
            {vehicleAssignment?.vehicle_id
              ? vehicles[vehicleAssignment.vehicle_id]?.vehicle_name || vehicleAssignment.vehicle_id
              : "Unassigned"}
          </p>
          <p className="text-xs text-muted-foreground">
            {vehicleAssignment?.vehicle_id
              ? vehicles[vehicleAssignment.vehicle_id]?.license_plate
              : "No reservation"}
          </p>
        </InfoCard>
      </div>

      <Card className="mt-5">
        <CardHeader>
          <CardTitle className="text-base">Route and requirements</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            <span className="font-medium">Pickup:</span> {run.pickup_address || "Not supplied"}
          </p>
          <p>
            <span className="font-medium">Destination:</span>{" "}
            {run.destination_address || "Not supplied"}
          </p>
          <p>
            <span className="font-medium">Passengers:</span> {run.passenger_count} ·{" "}
            <span className="font-medium">Wheelchairs:</span> {run.wheelchair_count}
          </p>
        </CardContent>
      </Card>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Operational timeline</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {events.map((event) => (
              <div key={event.id} className="border-l-2 border-primary/30 pl-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{event.event_type.replaceAll("_", " ")}</p>
                  {event.passenger_visible ? (
                    <Badge variant="outline">Passenger visible</Badge>
                  ) : null}
                  {event.driver_visible ? <Badge variant="outline">Driver visible</Badge> : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatOperationTime(event.created_at)} · {event.actor_role || "system"}
                </p>
                {event.reason ? <p className="mt-1 text-xs">{event.reason}</p> : null}
              </div>
            ))}
            {!events.length ? (
              <p className="text-sm text-muted-foreground">No Phase 5 events yet.</p>
            ) : null}
          </CardContent>
        </Card>
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                Alerts
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {alerts.map((alert) => (
                <div key={alert.id} className="rounded-lg border p-3 text-sm">
                  <div className="flex justify-between gap-2">
                    <p className="font-medium">{alert.title}</p>
                    <Badge variant={alert.severity === "critical" ? "destructive" : "outline"}>
                      {alert.status}
                    </Badge>
                  </div>
                </div>
              ))}
              {!alerts.length ? <p className="text-sm text-muted-foreground">No alerts.</p> : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Siren className="h-4 w-4 text-destructive" />
                Incidents
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {incidents.map((incident) => (
                <div key={incident.id} className="rounded-lg border p-3 text-sm">
                  <p className="font-medium">
                    {incident.incident_reference} · {incident.title}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {incident.severity} · {incident.status}
                  </p>
                  {incident.passenger_visible_summary ? (
                    <p className="mt-2 text-xs">
                      Passenger update: {incident.passenger_visible_summary}
                    </p>
                  ) : null}
                </div>
              ))}
              {!incidents.length ? (
                <p className="text-sm text-muted-foreground">No incidents.</p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="mt-5">
        <CardHeader>
          <CardTitle className="text-base">Notification delivery</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {outbox.map((item) => (
            <div key={item.id} className="rounded-lg border p-3 text-sm">
              <div className="flex justify-between gap-2">
                <p className="font-medium">{item.title}</p>
                <Badge variant="outline">{item.status}</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {item.notification_type} · attempts {item.attempt_count}
              </p>
            </div>
          ))}
          {!outbox.length ? (
            <p className="text-sm text-muted-foreground">No Phase 5 notifications.</p>
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel operation</DialogTitle>
            <DialogDescription>
              Assignments and active dispatch offers will be released transactionally.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Reason</Label>
            <Textarea
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>
              Back
            </Button>
            <Button
              variant="destructive"
              onClick={() => void cancelOperation()}
              disabled={!cancelReason.trim() || busy}
            >
              Cancel operation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={incidentOpen} onOpenChange={setIncidentOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create operational incident</DialogTitle>
            <DialogDescription>
              Internal notes remain private. Only the separate Passenger summary may be exposed.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={incidentType} onValueChange={setIncidentType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[
                      "delay",
                      "breakdown",
                      "driver_no_show",
                      "passenger_no_show",
                      "safety_concern",
                      "accessibility_failure",
                      "medical_escalation",
                      "route_disruption",
                      "service_interruption",
                      "other",
                    ].map((value) => (
                      <SelectItem key={value} value={value}>
                        {value.replaceAll("_", " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Severity</Label>
                <Select value={incidentSeverity} onValueChange={setIncidentSeverity}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["low", "medium", "high", "critical"].map((value) => (
                      <SelectItem key={value} value={value}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input
                value={incidentTitle}
                onChange={(event) => setIncidentTitle(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Internal notes</Label>
              <Textarea
                value={incidentNotes}
                onChange={(event) => setIncidentNotes(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Passenger-visible summary</Label>
              <Textarea
                value={passengerSummary}
                onChange={(event) => setPassengerSummary(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIncidentOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void createIncident()} disabled={!incidentTitle.trim() || busy}>
              Create incident
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminShell>
  );
}

function InfoCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium">
          {icon}
          {title}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}
