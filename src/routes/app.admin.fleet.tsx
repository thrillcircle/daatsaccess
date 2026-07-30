import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  Car,
  CheckCircle2,
  ClipboardList,
  FileWarning,
  Gauge,
  History,
  Loader2,
  ShieldAlert,
  UserRoundCheck,
  Wrench,
} from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth, useUserRoles } from "@/hooks/use-auth";
import {
  MAINTENANCE_STATUS_LABEL,
  VEHICLE_STATUS_LABEL,
  documentState,
  fleetDb,
  isAssignmentEffective,
  serviceState,
  type CanonicalVehicle,
  type FleetConsolidationIssue,
  type MaintenanceWorkOrder,
  type VehicleAssignment,
  type VehicleDocument,
  type VehicleStatusEvent,
} from "@/lib/fleet";
import { toast } from "sonner";

export const Route = createFileRoute("/app/admin/fleet")({
  head: () => ({ meta: [{ title: "Fleet Dashboard — Admin" }] }),
  component: FleetDashboardPage,
});

type DriverProfile = { user_id: string; full_name: string | null };

type DashboardData = {
  vehicles: CanonicalVehicle[];
  assignments: VehicleAssignment[];
  documents: VehicleDocument[];
  workOrders: MaintenanceWorkOrder[];
  issues: FleetConsolidationIssue[];
  statusEvents: VehicleStatusEvent[];
  drivers: DriverProfile[];
};

const EMPTY_DATA: DashboardData = {
  vehicles: [],
  assignments: [],
  documents: [],
  workOrders: [],
  issues: [],
  statusEvents: [],
  drivers: [],
};

function FleetDashboardPage() {
  const { user, loading: authLoading } = useAuth();
  const { roles, loading: rolesLoading } = useUserRoles(user?.id);
  const navigate = useNavigate();
  const isAdmin = !!roles?.includes("admin");
  const [data, setData] = useState<DashboardData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading || rolesLoading || roles === null) return;
    if (!user || !isAdmin) navigate({ to: "/app" });
  }, [authLoading, rolesLoading, roles, user, isAdmin, navigate]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      const [vehicleResult, assignmentResult, documentResult, workOrderResult, issueResult, statusResult] =
        await Promise.all([
          fleetDb.from("vehicle_profiles").select("*").order("vehicle_name"),
          fleetDb
            .from("vehicle_driver_assignments")
            .select("*")
            .in("status", ["scheduled", "active"])
            .order("start_at", { ascending: false }),
          fleetDb.from("vehicle_documents").select("*").eq("is_current", true),
          fleetDb
            .from("vehicle_maintenance_work_orders")
            .select("*")
            .not("status", "in", "(completed,cancelled)")
            .order("reported_at", { ascending: false }),
          fleetDb
            .from("fleet_consolidation_issues")
            .select("*")
            .eq("status", "open")
            .order("created_at", { ascending: false }),
          fleetDb
            .from("vehicle_status_events")
            .select("*")
            .order("created_at", { ascending: false })
            .limit(12),
        ]);

      const error =
        vehicleResult.error ||
        assignmentResult.error ||
        documentResult.error ||
        workOrderResult.error ||
        issueResult.error ||
        statusResult.error;
      if (cancelled) return;
      if (error) {
        toast.error(error.message);
        setLoading(false);
        return;
      }

      const assignments = (assignmentResult.data ?? []) as VehicleAssignment[];
      const driverIds = Array.from(new Set(assignments.map((assignment) => assignment.driver_id)));
      const driverResult = driverIds.length
        ? await fleetDb.from("profiles").select("user_id,full_name").in("user_id", driverIds)
        : { data: [] as DriverProfile[], error: null };
      if (cancelled) return;
      if (driverResult.error) toast.error(driverResult.error.message);

      setData({
        vehicles: (vehicleResult.data ?? []) as CanonicalVehicle[],
        assignments,
        documents: (documentResult.data ?? []) as VehicleDocument[],
        workOrders: (workOrderResult.data ?? []) as MaintenanceWorkOrder[],
        issues: (issueResult.data ?? []) as FleetConsolidationIssue[],
        statusEvents: (statusResult.data ?? []) as VehicleStatusEvent[],
        drivers: (driverResult.data ?? []) as DriverProfile[],
      });
      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  const dashboard = useMemo(() => {
    const activeAssignments = data.assignments.filter((assignment) => isAssignmentEffective(assignment));
    const assignedVehicleIds = new Set(activeAssignments.map((assignment) => assignment.vehicle_id));
    let expiringDocuments = 0;
    let expiredDocuments = 0;
    let dueSoon = 0;
    let overdue = 0;

    for (const vehicle of data.vehicles) {
      const documents = data.documents.filter((document) => document.vehicle_id === vehicle.id);
      const states = [
        documentState(
          documents.find((document) => document.document_type === "roadworthy")?.expires_at ??
            vehicle.roadworthy_expiry_date,
        ),
        documentState(
          documents.find((document) => document.document_type === "license_disc")?.expires_at ??
            vehicle.license_disc_expiry_date,
        ),
        documentState(
          documents.find((document) => document.document_type === "insurance")?.expires_at ??
            vehicle.insurance_expiry_date,
        ),
      ];
      if (states.includes("expired")) expiredDocuments += 1;
      else if (states.includes("expiring")) expiringDocuments += 1;

      const service = serviceState(vehicle);
      if (service === "overdue") overdue += 1;
      else if (service === "due_soon") dueSoon += 1;
    }

    return {
      activeAssignments,
      assignedVehicleIds,
      total: data.vehicles.length,
      active: data.vehicles.filter((vehicle) => vehicle.status === "active").length,
      available: data.vehicles.filter(
        (vehicle) => vehicle.status === "active" && !assignedVehicleIds.has(vehicle.id),
      ).length,
      assigned: assignedVehicleIds.size,
      unassigned: data.vehicles.filter(
        (vehicle) => vehicle.status === "active" && !assignedVehicleIds.has(vehicle.id),
      ).length,
      maintenance: data.vehicles.filter((vehicle) => vehicle.status === "maintenance").length,
      outOfService: data.vehicles.filter((vehicle) => vehicle.status === "out_of_service").length,
      retired: data.vehicles.filter((vehicle) => vehicle.status === "retired").length,
      expiringDocuments,
      expiredDocuments,
      dueSoon,
      overdue,
      urgentMaintenance: data.workOrders.filter(
        (order) => order.severity === "urgent" || order.severity === "unsafe",
      ).length,
      openIssues: data.issues.length,
    };
  }, [data]);

  if (authLoading || rolesLoading || loading || (user && roles === null)) {
    return (
      <AdminShell title="Fleet Dashboard" subtitle="Canonical vehicle operations and compliance.">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading canonical fleet…
        </p>
      </AdminShell>
    );
  }
  if (!isAdmin) return null;

  const driverName = (driverId: string) =>
    data.drivers.find((driver) => driver.user_id === driverId)?.full_name ?? driverId.slice(0, 8);
  const vehicleName = (vehicleId: string) =>
    data.vehicles.find((vehicle) => vehicle.id === vehicleId)?.vehicle_name ?? "Vehicle";

  return (
    <AdminShell
      title="Fleet Dashboard"
      subtitle="Operational overview of the canonical Access vehicle fleet."
      actions={
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link to="/app/admin/driver-assignments">Driver assignments</Link>
          </Button>
          <Button asChild>
            <Link to="/app/admin/vehicle-profiles">Vehicle profiles</Link>
          </Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        <Metric icon={Car} label="Canonical vehicles" value={dashboard.total} />
        <Metric icon={CheckCircle2} label="Active" value={dashboard.active} />
        <Metric icon={Gauge} label="Available" value={dashboard.available} />
        <Metric icon={UserRoundCheck} label="Assigned now" value={dashboard.assigned} />
        <Metric icon={Wrench} label="Maintenance" value={dashboard.maintenance} tone="warning" />
        <Metric icon={ShieldAlert} label="Out of service" value={dashboard.outOfService} tone="danger" />
        <Metric icon={History} label="Retired" value={dashboard.retired} />
        <Metric icon={FileWarning} label="Docs expiring" value={dashboard.expiringDocuments} tone="warning" />
        <Metric icon={FileWarning} label="Docs expired" value={dashboard.expiredDocuments} tone="danger" />
        <Metric icon={CalendarClock} label="Service due" value={dashboard.dueSoon} tone="warning" />
        <Metric icon={AlertTriangle} label="Service overdue" value={dashboard.overdue} tone="danger" />
        <Metric icon={ClipboardList} label="Reconciliation issues" value={dashboard.openIssues} tone="danger" />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <section className="rounded-2xl border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">Vehicles requiring attention</h2>
              <p className="text-xs text-muted-foreground">
                Maintenance, compliance, service and migration exceptions.
              </p>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link to="/app/admin/maintenance">Maintenance</Link>
            </Button>
          </div>
          <div className="mt-3 space-y-2">
            {data.workOrders.slice(0, 5).map((order) => (
              <Link
                key={order.id}
                to="/app/admin/vehicle-profiles/$vehicleId"
                params={{ vehicleId: order.vehicle_id }}
                className="flex items-start justify-between gap-3 rounded-xl border p-3 transition-colors hover:bg-muted/50"
              >
                <div>
                  <p className="text-sm font-medium">
                    {order.work_order_reference} · {vehicleName(order.vehicle_id)}
                  </p>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{order.description}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge variant={order.severity === "urgent" || order.severity === "unsafe" ? "destructive" : "outline"}>
                    {order.severity.replaceAll("_", " ")}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground">
                    {MAINTENANCE_STATUS_LABEL[order.status]}
                  </span>
                </div>
              </Link>
            ))}
            {!data.workOrders.length ? (
              <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                No open maintenance work orders.
              </p>
            ) : null}
            {dashboard.openIssues > 0 ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">
                <p className="font-medium text-destructive">
                  {dashboard.openIssues} unresolved fleet consolidation issue
                  {dashboard.openIssues === 1 ? "" : "s"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Do not remove legacy fleet sources until all issues are reconciled.
                </p>
              </div>
            ) : null}
          </div>
        </section>

        <section className="rounded-2xl border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">Current assignments</h2>
              <p className="text-xs text-muted-foreground">Effective driver and vehicle pairings.</p>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link to="/app/admin/driver-assignments">View all</Link>
            </Button>
          </div>
          <div className="mt-3 space-y-2">
            {dashboard.activeAssignments.slice(0, 6).map((assignment) => (
              <div key={assignment.id} className="flex items-center justify-between gap-3 rounded-xl border p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{driverName(assignment.driver_id)}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {vehicleName(assignment.vehicle_id)} · {assignment.assignment_type.replaceAll("_", " ")}
                  </p>
                </div>
                <Badge>Active</Badge>
              </div>
            ))}
            {!dashboard.activeAssignments.length ? (
              <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                No effective fleet assignments.
              </p>
            ) : null}
          </div>
        </section>
      </div>

      <section className="mt-5 rounded-2xl border bg-card p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Recent vehicle status changes</h2>
            <p className="text-xs text-muted-foreground">Canonical status history, newest first.</p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link to="/app/admin/vehicle-profiles">Open vehicle profiles</Link>
          </Button>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {data.statusEvents.map((event) => (
            <Link
              key={event.id}
              to="/app/admin/vehicle-profiles/$vehicleId"
              params={{ vehicleId: event.vehicle_id }}
              className="rounded-xl border p-3 transition-colors hover:bg-muted/50"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-medium">{vehicleName(event.vehicle_id)}</p>
                <Badge variant={event.new_status === "out_of_service" ? "destructive" : "outline"}>
                  {VEHICLE_STATUS_LABEL[event.new_status]}
                </Badge>
              </div>
              <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{event.reason}</p>
              <p className="mt-2 text-[10px] text-muted-foreground">
                {new Date(event.created_at).toLocaleString("en-ZA")}
              </p>
            </Link>
          ))}
          {!data.statusEvents.length ? (
            <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
              No status events recorded yet.
            </p>
          ) : null}
        </div>
      </section>
    </AdminShell>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  tone = "default",
}: {
  icon: typeof Car;
  label: string;
  value: number;
  tone?: "default" | "warning" | "danger";
}) {
  return (
    <div
      className={
        tone === "danger"
          ? "rounded-xl border border-destructive/30 bg-destructive/5 p-3"
          : tone === "warning"
            ? "rounded-xl border border-amber-400/40 bg-amber-50/50 p-3 dark:bg-amber-950/10"
            : "rounded-xl border bg-card p-3"
      }
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}
