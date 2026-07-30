import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Accessibility,
  Car,
  FileWarning,
  Loader2,
  Plus,
  Search,
  UserRoundCheck,
  Wrench,
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
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAuth, useUserRoles } from "@/hooks/use-auth";
import {
  VEHICLE_STATUS_LABEL,
  accessibilityLabels,
  documentState,
  fleetDb,
  isAssignmentEffective,
  serviceState,
  type CanonicalVehicle,
  type VehicleAssignment,
  type VehicleDocument,
  type VehicleOperationalStatus,
} from "@/lib/fleet";
import { toast } from "sonner";

export const Route = createFileRoute("/app/admin/vehicle-profiles")({
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search.q === "string" ? search.q : "",
    status: typeof search.status === "string" ? search.status : "all",
    assignment: typeof search.assignment === "string" ? search.assignment : "all",
    attention: typeof search.attention === "string" ? search.attention : "all",
  }),
  head: () => ({ meta: [{ title: "Vehicle Profiles — Admin" }] }),
  component: VehicleProfilesPage,
});

type DriverProfile = { user_id: string; full_name: string | null };

function VehicleProfilesPage() {
  const { user, loading: authLoading } = useAuth();
  const { roles, loading: rolesLoading } = useUserRoles(user?.id);
  const navigate = useNavigate();
  const search = Route.useSearch();
  const isAdmin = !!roles?.includes("admin");
  const [vehicles, setVehicles] = useState<CanonicalVehicle[]>([]);
  const [assignments, setAssignments] = useState<VehicleAssignment[]>([]);
  const [documents, setDocuments] = useState<VehicleDocument[]>([]);
  const [drivers, setDrivers] = useState<DriverProfile[]>([]);
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
      const [vehicleResult, assignmentResult, documentResult] = await Promise.all([
        fleetDb.from("vehicle_profiles").select("*").order("vehicle_name"),
        fleetDb
          .from("vehicle_driver_assignments")
          .select("*")
          .in("status", ["scheduled", "active"])
          .order("start_at", { ascending: false }),
        fleetDb.from("vehicle_documents").select("*").eq("is_current", true),
      ]);
      if (cancelled) return;
      const error = vehicleResult.error || assignmentResult.error || documentResult.error;
      if (error) {
        toast.error(error.message);
        setLoading(false);
        return;
      }

      const nextAssignments = (assignmentResult.data ?? []) as VehicleAssignment[];
      const driverIds = Array.from(
        new Set(nextAssignments.map((assignment) => assignment.driver_id)),
      );
      const driverResult = driverIds.length
        ? await fleetDb.from("profiles").select("user_id,full_name").in("user_id", driverIds)
        : { data: [] as DriverProfile[], error: null };
      if (cancelled) return;
      if (driverResult.error) toast.error(driverResult.error.message);

      setVehicles((vehicleResult.data ?? []) as CanonicalVehicle[]);
      setAssignments(nextAssignments);
      setDocuments((documentResult.data ?? []) as VehicleDocument[]);
      setDrivers((driverResult.data ?? []) as DriverProfile[]);
      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, reload]);

  const filtered = useMemo(() => {
    const query = search.q.trim().toLowerCase();
    return vehicles.filter((vehicle) => {
      const activeAssignment = assignments.find(
        (assignment) => assignment.vehicle_id === vehicle.id && isAssignmentEffective(assignment),
      );
      const vehicleDocuments = documents.filter((document) => document.vehicle_id === vehicle.id);
      const docStates = [
        documentState(
          vehicleDocuments.find((document) => document.document_type === "roadworthy")
            ?.expires_at ?? vehicle.roadworthy_expiry_date,
        ),
        documentState(
          vehicleDocuments.find((document) => document.document_type === "license_disc")
            ?.expires_at ?? vehicle.license_disc_expiry_date,
        ),
        documentState(
          vehicleDocuments.find((document) => document.document_type === "insurance")?.expires_at ??
            vehicle.insurance_expiry_date,
        ),
      ];
      const service = serviceState(vehicle);
      const matchesQuery =
        !query ||
        [
          vehicle.vehicle_name,
          vehicle.license_plate,
          vehicle.vin_number,
          vehicle.make,
          vehicle.model,
          vehicle.vehicle_type,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(query));
      const matchesStatus = search.status === "all" || vehicle.status === search.status;
      const matchesAssignment =
        search.assignment === "all" ||
        (search.assignment === "assigned" ? !!activeAssignment : !activeAssignment);
      const matchesAttention =
        search.attention === "all" ||
        (search.attention === "documents" &&
          (docStates.includes("expired") ||
            docStates.includes("expiring") ||
            docStates.includes("missing"))) ||
        (search.attention === "service" && (service === "due_soon" || service === "overdue")) ||
        (search.attention === "accessibility" && vehicle.wheelchair_accessible);
      return matchesQuery && matchesStatus && matchesAssignment && matchesAttention;
    });
  }, [assignments, documents, search, vehicles]);

  function setSearch(next: Partial<typeof search>) {
    navigate({
      to: "/app/admin/vehicle-profiles",
      search: { ...search, ...next },
      replace: true,
    });
  }

  if (authLoading || rolesLoading || loading || (user && roles === null)) {
    return (
      <AdminShell title="Vehicle Profiles" subtitle="Canonical vehicle master records.">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading vehicle profiles…
        </p>
      </AdminShell>
    );
  }
  if (!isAdmin) return null;

  const assignmentFor = (vehicleId: string) =>
    assignments.find(
      (assignment) => assignment.vehicle_id === vehicleId && isAssignmentEffective(assignment),
    );
  const driverName = (driverId: string | undefined) =>
    driverId
      ? (drivers.find((driver) => driver.user_id === driverId)?.full_name ?? driverId.slice(0, 8))
      : "Unassigned";

  return (
    <AdminShell
      title="Vehicle Profiles"
      subtitle="Create and manage the authoritative Access vehicle record."
      actions={<CreateVehicleDialog onCreated={() => setReload((value) => value + 1)} />}
    >
      <section className="rounded-2xl border bg-card p-4 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_repeat(3,minmax(150px,auto))]">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              value={search.q}
              onChange={(event) => setSearch({ q: event.target.value })}
              className="pl-9"
              placeholder="Search registration, VIN, name, make or model"
            />
          </label>
          <select
            value={search.status}
            onChange={(event) => setSearch({ status: event.target.value })}
            className="h-10 rounded-md border bg-background px-3 text-sm"
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="maintenance">Maintenance</option>
            <option value="out_of_service">Out of service</option>
            <option value="retired">Retired</option>
          </select>
          <select
            value={search.assignment}
            onChange={(event) => setSearch({ assignment: event.target.value })}
            className="h-10 rounded-md border bg-background px-3 text-sm"
          >
            <option value="all">All assignments</option>
            <option value="assigned">Assigned now</option>
            <option value="unassigned">Unassigned</option>
          </select>
          <select
            value={search.attention}
            onChange={(event) => setSearch({ attention: event.target.value })}
            className="h-10 rounded-md border bg-background px-3 text-sm"
          >
            <option value="all">All compliance states</option>
            <option value="documents">Document attention</option>
            <option value="service">Service attention</option>
            <option value="accessibility">Accessible vehicles</option>
          </select>
        </div>
      </section>

      <div className="mt-4 space-y-3">
        {filtered.map((vehicle) => {
          const assignment = assignmentFor(vehicle.id);
          const vehicleDocuments = documents.filter(
            (document) => document.vehicle_id === vehicle.id,
          );
          const documentStates = [
            documentState(
              vehicleDocuments.find((document) => document.document_type === "roadworthy")
                ?.expires_at ?? vehicle.roadworthy_expiry_date,
            ),
            documentState(
              vehicleDocuments.find((document) => document.document_type === "license_disc")
                ?.expires_at ?? vehicle.license_disc_expiry_date,
            ),
            documentState(
              vehicleDocuments.find((document) => document.document_type === "insurance")
                ?.expires_at ?? vehicle.insurance_expiry_date,
            ),
          ];
          const service = serviceState(vehicle);
          const accessibility = accessibilityLabels(vehicle);
          return (
            <Link
              key={vehicle.id}
              to="/app/admin/vehicle-profiles/$vehicleId"
              params={{ vehicleId: vehicle.id }}
              className="block rounded-2xl border bg-card p-4 shadow-sm transition-colors hover:bg-muted/40"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary">
                      <Car className="h-5 w-5" />
                    </span>
                    <div>
                      <h2 className="font-semibold">{vehicle.vehicle_name}</h2>
                      <p className="text-sm text-muted-foreground">
                        {vehicle.license_plate} ·{" "}
                        {[vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(" ") ||
                          "Vehicle details incomplete"}
                      </p>
                    </div>
                    <Badge
                      variant={vehicle.status === "out_of_service" ? "destructive" : "outline"}
                    >
                      {VEHICLE_STATUS_LABEL[vehicle.status]}
                    </Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {accessibility.map((label) => (
                      <Badge key={label} variant="secondary">
                        <Accessibility className="mr-1 h-3 w-3" /> {label}
                      </Badge>
                    ))}
                    {!accessibility.length ? (
                      <Badge variant="outline">Accessibility not recorded</Badge>
                    ) : null}
                  </div>
                </div>

                <dl className="grid min-w-0 grid-cols-2 gap-x-5 gap-y-2 text-sm sm:grid-cols-4 lg:min-w-[520px]">
                  <Summary
                    icon={UserRoundCheck}
                    label="Current driver"
                    value={driverName(assignment?.driver_id)}
                  />
                  <Summary
                    icon={Car}
                    label="Capacity"
                    value={`${vehicle.passenger_capacity ?? "—"} passengers`}
                  />
                  <Summary
                    icon={Wrench}
                    label="Service"
                    value={service.replaceAll("_", " ")}
                    attention={service === "overdue" || service === "due_soon"}
                  />
                  <Summary
                    icon={FileWarning}
                    label="Documents"
                    value={
                      documentStates.includes("expired")
                        ? "Expired"
                        : documentStates.includes("missing")
                          ? "Incomplete"
                          : documentStates.includes("expiring")
                            ? "Expiring soon"
                            : "Current"
                    }
                    attention={
                      documentStates.includes("expired") ||
                      documentStates.includes("missing") ||
                      documentStates.includes("expiring")
                    }
                  />
                </dl>
              </div>
            </Link>
          );
        })}
        {!filtered.length ? (
          <div className="rounded-2xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
            No canonical vehicles match these filters.
          </div>
        ) : null}
      </div>
    </AdminShell>
  );
}

function Summary({
  icon: Icon,
  label,
  value,
  attention = false,
}: {
  icon: typeof Car;
  label: string;
  value: string;
  attention?: boolean;
}) {
  return (
    <div className={attention ? "text-amber-700 dark:text-amber-300" : ""}>
      <dt className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3 w-3" /> {label}
      </dt>
      <dd className="mt-1 truncate font-medium capitalize">{value}</dd>
    </div>
  );
}

function CreateVehicleDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [vehicleName, setVehicleName] = useState("");
  const [licensePlate, setLicensePlate] = useState("");
  const [vehicleType, setVehicleType] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [passengerCapacity, setPassengerCapacity] = useState("4");
  const [wheelchairAccessible, setWheelchairAccessible] = useState(false);
  const [wheelchairCapacity, setWheelchairCapacity] = useState("0");
  const [rampOrLift, setRampOrLift] = useState(false);
  const [notes, setNotes] = useState("");

  async function save() {
    if (vehicleName.trim().length < 2 || licensePlate.trim().length < 2) {
      toast.error("Vehicle name and registration are required");
      return;
    }
    setSaving(true);
    const { error } = await fleetDb.rpc("admin_create_vehicle", {
      p_vehicle_name: vehicleName.trim(),
      p_license_plate: licensePlate.trim(),
      p_vehicle_type: vehicleType.trim() || null,
      p_make: make.trim() || null,
      p_model: model.trim() || null,
      p_year: year ? Number(year) : null,
      p_passenger_capacity: passengerCapacity ? Number(passengerCapacity) : null,
      p_wheelchair_accessible: wheelchairAccessible,
      p_wheelchair_capacity: wheelchairCapacity ? Number(wheelchairCapacity) : 0,
      p_ramp_or_lift_available: rampOrLift,
      p_admin_notes: notes.trim() || null,
      p_idempotency_key: crypto.randomUUID(),
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Canonical vehicle created");
    setOpen(false);
    setVehicleName("");
    setLicensePlate("");
    setVehicleType("");
    setMake("");
    setModel("");
    setYear("");
    setPassengerCapacity("4");
    setWheelchairAccessible(false);
    setWheelchairCapacity("0");
    setRampOrLift(false);
    setNotes("");
    onCreated();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-1 h-4 w-4" /> Add vehicle
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create canonical vehicle</DialogTitle>
          <DialogDescription>
            New vehicle records are stored only in the authoritative vehicle profile table.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Vehicle name">
            <Input value={vehicleName} onChange={(event) => setVehicleName(event.target.value)} />
          </Field>
          <Field label="Registration">
            <Input value={licensePlate} onChange={(event) => setLicensePlate(event.target.value)} />
          </Field>
          <Field label="Vehicle type">
            <Input value={vehicleType} onChange={(event) => setVehicleType(event.target.value)} />
          </Field>
          <Field label="Make">
            <Input value={make} onChange={(event) => setMake(event.target.value)} />
          </Field>
          <Field label="Model">
            <Input value={model} onChange={(event) => setModel(event.target.value)} />
          </Field>
          <Field label="Year">
            <Input type="number" value={year} onChange={(event) => setYear(event.target.value)} />
          </Field>
          <Field label="Passenger capacity">
            <Input
              type="number"
              min="0"
              value={passengerCapacity}
              onChange={(event) => setPassengerCapacity(event.target.value)}
            />
          </Field>
          <Field label="Wheelchair capacity">
            <Input
              type="number"
              min="0"
              value={wheelchairCapacity}
              onChange={(event) => setWheelchairCapacity(event.target.value)}
            />
          </Field>
          <label className="flex items-center justify-between rounded-xl border p-3 text-sm">
            <span>Wheelchair accessible</span>
            <Switch checked={wheelchairAccessible} onCheckedChange={setWheelchairAccessible} />
          </label>
          <label className="flex items-center justify-between rounded-xl border p-3 text-sm">
            <span>Ramp or lift available</span>
            <Switch checked={rampOrLift} onCheckedChange={setRampOrLift} />
          </label>
          <div className="sm:col-span-2">
            <Label htmlFor="vehicle-notes">Admin notes</Label>
            <Textarea
              id="vehicle-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
              className="mt-1.5"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            Create vehicle
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="space-y-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}
