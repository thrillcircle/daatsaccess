import { createFileRoute, Link, useNavigate, type SearchSchemaInput } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Loader2,
  PauseCircle,
  PlayCircle,
  Plus,
  Search,
  ShieldAlert,
  Wrench,
} from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { AdminMaintenanceActions } from "@/components/fleet/AdminMaintenanceActions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth, useUserRoles } from "@/hooks/use-auth";
import {
  MAINTENANCE_STATUS_LABEL,
  fleetDb,
  type CanonicalVehicle,
  type MaintenanceWorkOrder,
} from "@/lib/fleet";
import { toast } from "sonner";

export const Route = createFileRoute("/app/admin/maintenance")({
  validateSearch: (search: Record<string, unknown> & SearchSchemaInput) => ({
    q: typeof search.q === "string" ? search.q : "",
    status: typeof search.status === "string" ? search.status : "open",
    severity: typeof search.severity === "string" ? search.severity : "all",
    vehicle: typeof search.vehicle === "string" ? search.vehicle : "all",
  }),
  head: () => ({ meta: [{ title: "Maintenance — Admin" }] }),
  component: MaintenancePage,
});

function MaintenancePage() {
  const { user, loading: authLoading } = useAuth();
  const { roles, loading: rolesLoading } = useUserRoles(user?.id);
  const navigate = useNavigate();
  const search = Route.useSearch();
  const isAdmin = !!roles?.includes("admin");
  const [vehicles, setVehicles] = useState<CanonicalVehicle[]>([]);
  const [orders, setOrders] = useState<MaintenanceWorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (authLoading || rolesLoading || roles === null) return;
    if (!user || !isAdmin) navigate({ to: "/app" });
  }, [authLoading, rolesLoading, roles, user, isAdmin, navigate]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      const [vehicleResult, orderResult] = await Promise.all([
        fleetDb.from("vehicle_profiles").select("*").order("vehicle_name"),
        fleetDb
          .from("vehicle_maintenance_work_orders")
          .select("*")
          .order("reported_at", { ascending: false }),
      ]);
      if (cancelled) return;
      const error = vehicleResult.error || orderResult.error;
      if (error) {
        toast.error(error.message);
        setLoading(false);
        return;
      }
      setVehicles((vehicleResult.data ?? []) as CanonicalVehicle[]);
      setOrders((orderResult.data ?? []) as MaintenanceWorkOrder[]);
      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, reload]);

  const stats = useMemo(
    () => ({
      open: orders.filter((order) => order.status === "open").length,
      urgent: orders.filter(
        (order) =>
          !["completed", "cancelled"].includes(order.status) &&
          (order.severity === "urgent" || order.severity === "unsafe"),
      ).length,
      scheduled: orders.filter((order) => order.status === "scheduled").length,
      inProgress: orders.filter((order) => order.status === "in_progress").length,
      waiting: orders.filter((order) => order.status === "waiting_for_parts").length,
      completed: orders.filter((order) => order.status === "completed").length,
    }),
    [orders],
  );

  const filtered = useMemo(() => {
    const query = search.q.trim().toLowerCase();
    return orders.filter((order) => {
      const vehicle = vehicles.find((item) => item.id === order.vehicle_id);
      const matchesQuery =
        !query ||
        [
          order.work_order_reference,
          order.description,
          order.service_provider,
          vehicle?.vehicle_name,
          vehicle?.license_plate,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(query));
      const matchesStatus =
        search.status === "all" ||
        (search.status === "open"
          ? !["completed", "cancelled"].includes(order.status)
          : order.status === search.status);
      const matchesSeverity = search.severity === "all" || order.severity === search.severity;
      const matchesVehicle = search.vehicle === "all" || order.vehicle_id === search.vehicle;
      return matchesQuery && matchesStatus && matchesSeverity && matchesVehicle;
    });
  }, [orders, search, vehicles]);

  function setSearch(next: Partial<typeof search>) {
    navigate({ to: "/app/admin/maintenance", search: { ...search, ...next }, replace: true });
  }

  if (authLoading || rolesLoading || loading || (user && roles === null)) {
    return (
      <AdminShell title="Maintenance" subtitle="Vehicle work orders and service operations.">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading maintenance…
        </p>
      </AdminShell>
    );
  }
  if (!isAdmin) return null;

  return (
    <AdminShell
      title="Maintenance"
      subtitle="Open, schedule, progress and complete canonical vehicle work orders."
      actions={
        <CreateMaintenanceDialog
          vehicles={vehicles}
          onCreated={() => setReload((value) => value + 1)}
        />
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <Metric icon={Wrench} label="Open" value={stats.open} />
        <Metric icon={ShieldAlert} label="Urgent / unsafe" value={stats.urgent} tone="danger" />
        <Metric icon={CalendarClock} label="Scheduled" value={stats.scheduled} />
        <Metric icon={PlayCircle} label="In progress" value={stats.inProgress} tone="warning" />
        <Metric icon={PauseCircle} label="Waiting for parts" value={stats.waiting} tone="warning" />
        <Metric icon={CheckCircle2} label="Completed" value={stats.completed} />
      </div>

      <section className="mt-4 rounded-2xl border bg-card p-4 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_repeat(3,minmax(150px,auto))]">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              value={search.q}
              onChange={(event) => setSearch({ q: event.target.value })}
              className="pl-9"
              placeholder="Search work order, vehicle, provider or description"
            />
          </label>
          <select
            value={search.status}
            onChange={(event) => setSearch({ status: event.target.value })}
            className="h-10 rounded-md border bg-background px-3 text-sm"
          >
            <option value="all">All statuses</option>
            <option value="open">All open work</option>
            <option value="scheduled">Scheduled</option>
            <option value="in_progress">In progress</option>
            <option value="waiting_for_parts">Waiting for parts</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <select
            value={search.severity}
            onChange={(event) => setSearch({ severity: event.target.value })}
            className="h-10 rounded-md border bg-background px-3 text-sm"
          >
            <option value="all">All severities</option>
            <option value="routine">Routine</option>
            <option value="attention">Attention</option>
            <option value="urgent">Urgent</option>
            <option value="unsafe">Unsafe</option>
          </select>
          <select
            value={search.vehicle}
            onChange={(event) => setSearch({ vehicle: event.target.value })}
            className="h-10 rounded-md border bg-background px-3 text-sm"
          >
            <option value="all">All vehicles</option>
            {vehicles.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.vehicle_name} · {vehicle.license_plate}
              </option>
            ))}
          </select>
        </div>
      </section>

      <div className="mt-4 space-y-3">
        {filtered.map((order) => {
          const vehicle = vehicles.find((item) => item.id === order.vehicle_id);
          return (
            <article key={order.id} className="rounded-2xl border bg-card p-4 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{order.work_order_reference}</p>
                    <Badge
                      variant={
                        order.severity === "urgent" || order.severity === "unsafe"
                          ? "destructive"
                          : "outline"
                      }
                    >
                      {order.severity}
                    </Badge>
                    <Badge variant="secondary">{MAINTENANCE_STATUS_LABEL[order.status]}</Badge>
                  </div>
                  <Link
                    to="/app/admin/vehicle-profiles/$vehicleId"
                    params={{ vehicleId: order.vehicle_id }}
                    className="mt-2 inline-flex text-sm font-medium text-primary hover:underline"
                  >
                    {vehicle?.vehicle_name ?? "Vehicle"} ·{" "}
                    {vehicle?.license_plate ?? order.vehicle_id}
                  </Link>
                  <p className="mt-2 text-sm text-muted-foreground">{order.description}</p>
                  <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
                    <Detail label="Type" value={order.maintenance_type.replaceAll("_", " ")} />
                    <Detail label="Provider" value={order.service_provider || "Not assigned"} />
                    <Detail
                      label="Reported"
                      value={new Date(order.reported_at).toLocaleString("en-ZA")}
                    />
                  </dl>
                </div>
                <AdminMaintenanceActions
                  order={order}
                  onChanged={() => setReload((value) => value + 1)}
                />
              </div>
            </article>
          );
        })}
        {!filtered.length ? (
          <div className="rounded-2xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
            No maintenance work orders match these filters.
          </div>
        ) : null}
      </div>
    </AdminShell>
  );
}

function CreateMaintenanceDialog({
  vehicles,
  onCreated,
}: {
  vehicles: CanonicalVehicle[];
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [vehicleId, setVehicleId] = useState("");
  const [type, setType] = useState("repair");
  const [severity, setSeverity] = useState("attention");
  const [description, setDescription] = useState("");
  const [provider, setProvider] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!vehicleId || description.trim().length < 3) {
      toast.error("Select a vehicle and describe the maintenance requirement");
      return;
    }
    const vehicle = vehicles.find((item) => item.id === vehicleId);
    setSaving(true);
    const { error } = await fleetDb.rpc("admin_open_maintenance_work_order", {
      p_vehicle_id: vehicleId,
      p_maintenance_type: type,
      p_severity: severity,
      p_description: description.trim(),
      p_scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
      p_odometer_at_report: vehicle?.current_odometer_km ?? null,
      p_service_provider: provider.trim() || null,
      p_support_ticket_id: null,
      p_idempotency_key: crypto.randomUUID(),
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Maintenance work order created");
    setOpen(false);
    setVehicleId("");
    setDescription("");
    setProvider("");
    setScheduledAt("");
    onCreated();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-1 h-4 w-4" /> New work order
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New maintenance work order</DialogTitle>
          <DialogDescription>
            Urgent or unsafe reports automatically place the vehicle out of service.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1.5 text-sm sm:col-span-2">
            <span className="font-medium">Vehicle</span>
            <select
              value={vehicleId}
              onChange={(event) => setVehicleId(event.target.value)}
              className="h-10 w-full rounded-md border bg-background px-3"
            >
              <option value="">Select vehicle</option>
              {vehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.vehicle_name} · {vehicle.license_plate}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="font-medium">Type</span>
            <select
              value={type}
              onChange={(event) => setType(event.target.value)}
              className="h-10 w-full rounded-md border bg-background px-3"
            >
              <option value="scheduled_service">Scheduled service</option>
              <option value="repair">Repair</option>
              <option value="inspection">Inspection</option>
              <option value="tyres">Tyres</option>
              <option value="brakes">Brakes</option>
              <option value="accessibility_equipment">Accessibility equipment</option>
              <option value="ramp_or_lift">Ramp or lift</option>
              <option value="electrical">Electrical</option>
              <option value="bodywork">Bodywork</option>
              <option value="roadworthy">Roadworthy</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="font-medium">Severity</span>
            <select
              value={severity}
              onChange={(event) => setSeverity(event.target.value)}
              className="h-10 w-full rounded-md border bg-background px-3"
            >
              <option value="routine">Routine</option>
              <option value="attention">Attention</option>
              <option value="urgent">Urgent</option>
              <option value="unsafe">Unsafe</option>
            </select>
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="font-medium">Service provider</span>
            <Input value={provider} onChange={(event) => setProvider(event.target.value)} />
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="font-medium">Scheduled date and time</span>
            <Input
              type="datetime-local"
              value={scheduledAt}
              onChange={(event) => setScheduledAt(event.target.value)}
            />
          </label>
          <label className="space-y-1.5 text-sm sm:col-span-2">
            <span className="font-medium">Description</span>
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={4}
            />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            Create work order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  tone = "default",
}: {
  icon: typeof Wrench;
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
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-medium capitalize">{value}</dd>
    </div>
  );
}
