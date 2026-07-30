import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  Car,
  CheckCircle2,
  History,
  Loader2,
  Plus,
  Search,
  Unplug,
  UserRoundCheck,
  Users,
} from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
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
  ASSIGNMENT_STATUS_LABEL,
  VEHICLE_STATUS_LABEL,
  fleetDb,
  isAssignmentEffective,
  type AssignmentType,
  type CanonicalVehicle,
  type VehicleAssignment,
} from "@/lib/fleet";
import { toast } from "sonner";

export const Route = createFileRoute("/app/admin/driver-assignments")({
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search.q === "string" ? search.q : "",
    view: typeof search.view === "string" ? search.view : "active",
  }),
  head: () => ({ meta: [{ title: "Driver Assignments — Admin" }] }),
  component: DriverAssignmentsPage,
});

type DriverProfile = {
  user_id: string;
  full_name: string | null;
  phone: string | null;
};

function DriverAssignmentsPage() {
  const { user, loading: authLoading } = useAuth();
  const { roles, loading: rolesLoading } = useUserRoles(user?.id);
  const navigate = useNavigate();
  const search = Route.useSearch();
  const isAdmin = !!roles?.includes("admin");
  const [vehicles, setVehicles] = useState<CanonicalVehicle[]>([]);
  const [drivers, setDrivers] = useState<DriverProfile[]>([]);
  const [assignments, setAssignments] = useState<VehicleAssignment[]>([]);
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
      const [vehicleResult, assignmentResult, roleResult] = await Promise.all([
        fleetDb.from("vehicle_profiles").select("*").order("vehicle_name"),
        fleetDb
          .from("vehicle_driver_assignments")
          .select("*")
          .order("start_at", { ascending: false }),
        fleetDb.from("user_roles").select("user_id").eq("role", "driver"),
      ]);
      if (cancelled) return;
      const error = vehicleResult.error || assignmentResult.error || roleResult.error;
      if (error) {
        toast.error(error.message);
        setLoading(false);
        return;
      }
      const driverIds = (roleResult.data ?? []).map((row) => row.user_id as string);
      const profileResult = driverIds.length
        ? await fleetDb.from("profiles").select("user_id,full_name,phone").in("user_id", driverIds)
        : { data: [] as DriverProfile[], error: null };
      if (cancelled) return;
      if (profileResult.error) toast.error(profileResult.error.message);

      setVehicles((vehicleResult.data ?? []) as CanonicalVehicle[]);
      setAssignments((assignmentResult.data ?? []) as VehicleAssignment[]);
      setDrivers((profileResult.data ?? []) as DriverProfile[]);
      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, reload]);

  const now = new Date();
  const activeAssignments = assignments.filter((assignment) => isAssignmentEffective(assignment, now));
  const upcomingAssignments = assignments.filter(
    (assignment) => assignment.status === "scheduled" && new Date(assignment.start_at) > now,
  );
  const historyAssignments = assignments.filter((assignment) =>
    ["completed", "cancelled"].includes(assignment.status),
  );
  const assignedDriverIds = new Set(activeAssignments.map((assignment) => assignment.driver_id));
  const assignedVehicleIds = new Set(activeAssignments.map((assignment) => assignment.vehicle_id));
  const unassignedDrivers = drivers.filter((driver) => !assignedDriverIds.has(driver.user_id));
  const unassignedVehicles = vehicles.filter(
    (vehicle) => vehicle.status === "active" && !assignedVehicleIds.has(vehicle.id),
  );

  const visibleAssignments = useMemo(() => {
    const source =
      search.view === "upcoming"
        ? upcomingAssignments
        : search.view === "history"
          ? historyAssignments
          : activeAssignments;
    const query = search.q.trim().toLowerCase();
    if (!query) return source;
    return source.filter((assignment) => {
      const vehicle = vehicles.find((item) => item.id === assignment.vehicle_id);
      const driver = drivers.find((item) => item.user_id === assignment.driver_id);
      return [
        vehicle?.vehicle_name,
        vehicle?.license_plate,
        driver?.full_name,
        driver?.phone,
        assignment.assignment_type,
        assignment.assignment_reason,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
  }, [activeAssignments, drivers, historyAssignments, search.q, search.view, upcomingAssignments, vehicles]);

  function setSearch(next: Partial<typeof search>) {
    navigate({ to: "/app/admin/driver-assignments", search: { ...search, ...next }, replace: true });
  }

  if (authLoading || rolesLoading || loading || (user && roles === null)) {
    return (
      <AdminShell title="Driver Assignments" subtitle="Effective vehicle assignment history.">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading assignments…
        </p>
      </AdminShell>
    );
  }
  if (!isAdmin) return null;

  const vehicleFor = (vehicleId: string) => vehicles.find((vehicle) => vehicle.id === vehicleId);
  const driverFor = (driverId: string) => drivers.find((driver) => driver.user_id === driverId);

  return (
    <AdminShell
      title="Driver Assignments"
      subtitle="Schedule, activate and end canonical driver-to-vehicle assignments."
      actions={
        <CreateAssignmentDialog
          vehicles={unassignedVehicles}
          drivers={unassignedDrivers}
          onCreated={() => setReload((value) => value + 1)}
        />
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Metric icon={UserRoundCheck} label="Active now" value={activeAssignments.length} />
        <Metric icon={CalendarClock} label="Upcoming" value={upcomingAssignments.length} />
        <Metric icon={Users} label="Unassigned drivers" value={unassignedDrivers.length} />
        <Metric icon={Car} label="Unassigned vehicles" value={unassignedVehicles.length} />
        <Metric icon={History} label="History" value={historyAssignments.length} />
      </div>

      <section className="mt-4 rounded-2xl border bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <label className="relative block min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              value={search.q}
              onChange={(event) => setSearch({ q: event.target.value })}
              className="pl-9"
              placeholder="Search driver, vehicle, registration or reason"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            {(["active", "upcoming", "history"] as const).map((view) => (
              <Button
                key={view}
                variant={search.view === view ? "default" : "outline"}
                size="sm"
                onClick={() => setSearch({ view })}
              >
                {view[0].toUpperCase() + view.slice(1)}
              </Button>
            ))}
          </div>
        </div>
      </section>

      <div className="mt-4 space-y-3">
        {visibleAssignments.map((assignment) => {
          const vehicle = vehicleFor(assignment.vehicle_id);
          const driver = driverFor(assignment.driver_id);
          return (
            <article key={assignment.id} className="rounded-2xl border bg-card p-4 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="grid min-w-0 flex-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Driver</p>
                    <p className="mt-1 font-semibold">{driver?.full_name ?? assignment.driver_id}</p>
                    <p className="text-xs text-muted-foreground">{driver?.phone ?? "No phone"}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Vehicle</p>
                    <Link
                      to="/app/admin/vehicle-profiles/$vehicleId"
                      params={{ vehicleId: assignment.vehicle_id }}
                      className="mt-1 block font-semibold text-primary hover:underline"
                    >
                      {vehicle?.vehicle_name ?? assignment.vehicle_id}
                    </Link>
                    <p className="text-xs text-muted-foreground">{vehicle?.license_plate ?? "Registration unavailable"}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Assignment</p>
                    <p className="mt-1 font-medium capitalize">{assignment.assignment_type.replaceAll("_", " ")}</p>
                    <Badge variant="outline" className="mt-1">
                      {ASSIGNMENT_STATUS_LABEL[assignment.status]}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Effective period</p>
                    <p className="mt-1 text-sm">{new Date(assignment.start_at).toLocaleString("en-ZA")}</p>
                    <p className="text-xs text-muted-foreground">
                      to {assignment.end_at ? new Date(assignment.end_at).toLocaleString("en-ZA") : "ongoing"}
                    </p>
                  </div>
                </div>
                {assignment.status === "active" || assignment.status === "scheduled" ? (
                  <EndAssignmentButton
                    assignment={assignment}
                    onEnded={() => setReload((value) => value + 1)}
                  />
                ) : null}
              </div>
              {vehicle && vehicle.status !== "active" ? (
                <p className="mt-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  Conflict: assigned vehicle is {VEHICLE_STATUS_LABEL[vehicle.status].toLowerCase()}.
                </p>
              ) : null}
            </article>
          );
        })}
        {!visibleAssignments.length ? (
          <div className="rounded-2xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
            No assignments in this view.
          </div>
        ) : null}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <section className="rounded-2xl border bg-card p-4 shadow-sm">
          <h2 className="font-semibold">Unassigned drivers</h2>
          <p className="text-xs text-muted-foreground">Drivers without an effective canonical vehicle.</p>
          <div className="mt-3 space-y-2">
            {unassignedDrivers.slice(0, 8).map((driver) => (
              <div key={driver.user_id} className="rounded-xl border p-3 text-sm">
                <p className="font-medium">{driver.full_name ?? driver.user_id}</p>
                <p className="text-xs text-muted-foreground">{driver.phone ?? "No phone"}</p>
              </div>
            ))}
            {!unassignedDrivers.length ? <Empty text="All drivers have an effective assignment." /> : null}
          </div>
        </section>

        <section className="rounded-2xl border bg-card p-4 shadow-sm">
          <h2 className="font-semibold">Unassigned active vehicles</h2>
          <p className="text-xs text-muted-foreground">Available canonical vehicles without a current driver.</p>
          <div className="mt-3 space-y-2">
            {unassignedVehicles.slice(0, 8).map((vehicle) => (
              <Link
                key={vehicle.id}
                to="/app/admin/vehicle-profiles/$vehicleId"
                params={{ vehicleId: vehicle.id }}
                className="block rounded-xl border p-3 text-sm transition-colors hover:bg-muted/50"
              >
                <p className="font-medium">{vehicle.vehicle_name}</p>
                <p className="text-xs text-muted-foreground">{vehicle.license_plate}</p>
              </Link>
            ))}
            {!unassignedVehicles.length ? <Empty text="All active vehicles are assigned." /> : null}
          </div>
        </section>
      </div>
    </AdminShell>
  );
}

function CreateAssignmentDialog({
  vehicles,
  drivers,
  onCreated,
}: {
  vehicles: CanonicalVehicle[];
  drivers: DriverProfile[];
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [vehicleId, setVehicleId] = useState("");
  const [driverId, setDriverId] = useState("");
  const [type, setType] = useState<AssignmentType>("primary");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!vehicleId || !driverId) {
      toast.error("Select a driver and an active vehicle");
      return;
    }
    const start = startAt ? new Date(startAt) : new Date();
    const end = endAt ? new Date(endAt) : null;
    if (end && end <= start) {
      toast.error("Assignment end must be after its start");
      return;
    }
    setSaving(true);
    const { error } = await fleetDb.rpc("admin_assign_driver_vehicle", {
      p_vehicle_id: vehicleId,
      p_driver_id: driverId,
      p_assignment_type: type,
      p_start_at: start.toISOString(),
      p_end_at: end?.toISOString() ?? null,
      p_assignment_reason: reason.trim() || null,
      p_notes: notes.trim() || null,
      p_source: "admin",
      p_idempotency_key: crypto.randomUUID(),
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Driver and vehicle assignment created");
    setOpen(false);
    setVehicleId("");
    setDriverId("");
    setType("primary");
    setStartAt("");
    setEndAt("");
    setReason("");
    setNotes("");
    onCreated();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={!vehicles.length || !drivers.length}>
          <Plus className="mr-1 h-4 w-4" /> New assignment
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Assign driver to vehicle</DialogTitle>
          <DialogDescription>
            The server rejects driver or vehicle time overlaps and non-active vehicles.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1.5 text-sm">
            <span className="font-medium">Driver</span>
            <select value={driverId} onChange={(event) => setDriverId(event.target.value)} className="h-10 w-full rounded-md border bg-background px-3">
              <option value="">Select driver</option>
              {drivers.map((driver) => (
                <option key={driver.user_id} value={driver.user_id}>
                  {driver.full_name ?? driver.user_id}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="font-medium">Vehicle</span>
            <select value={vehicleId} onChange={(event) => setVehicleId(event.target.value)} className="h-10 w-full rounded-md border bg-background px-3">
              <option value="">Select vehicle</option>
              {vehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.vehicle_name} · {vehicle.license_plate}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="font-medium">Assignment type</span>
            <select value={type} onChange={(event) => setType(event.target.value as AssignmentType)} className="h-10 w-full rounded-md border bg-background px-3">
              <option value="primary">Primary</option>
              <option value="shift">Shift</option>
              <option value="temporary">Temporary</option>
              <option value="replacement">Replacement</option>
              <option value="trip_specific">Trip-specific</option>
            </select>
          </label>
          <div />
          <label className="space-y-1.5 text-sm">
            <span className="font-medium">Start</span>
            <Input type="datetime-local" value={startAt} onChange={(event) => setStartAt(event.target.value)} />
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="font-medium">End</span>
            <Input type="datetime-local" value={endAt} onChange={(event) => setEndAt(event.target.value)} />
          </label>
          <label className="space-y-1.5 text-sm sm:col-span-2">
            <span className="font-medium">Assignment reason</span>
            <Input value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
          <label className="space-y-1.5 text-sm sm:col-span-2">
            <span className="font-medium">Notes</span>
            <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            Create assignment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EndAssignmentButton({
  assignment,
  onEnded,
}: {
  assignment: VehicleAssignment;
  onEnded: () => void;
}) {
  const [saving, setSaving] = useState(false);

  async function end() {
    setSaving(true);
    const { error } = await fleetDb.rpc("admin_end_vehicle_assignment", {
      p_assignment_id: assignment.id,
      p_reason: "Ended by Access administration",
      p_expected_status: assignment.status,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Assignment ended");
    onEnded();
  }

  return (
    <Button variant="outline" size="sm" onClick={end} disabled={saving}>
      {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Unplug className="mr-1 h-4 w-4" />}
      End assignment
    </Button>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof Car; label: string; value: number }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-xl border border-dashed p-3 text-sm text-muted-foreground">{text}</p>;
}
