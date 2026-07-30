import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  Accessibility,
  ArrowLeft,
  CalendarRange,
  Car,
  ClipboardList,
  FileCheck2,
  Gauge,
  History,
  Loader2,
  MapPinned,
  PencilLine,
  ShieldCheck,
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
import { Textarea } from "@/components/ui/textarea";
import { useAuth, useUserRoles } from "@/hooks/use-auth";
import {
  ASSIGNMENT_STATUS_LABEL,
  MAINTENANCE_STATUS_LABEL,
  VEHICLE_STATUS_LABEL,
  accessibilityLabels,
  documentState,
  fleetDb,
  isAssignmentEffective,
  serviceState,
  type CanonicalVehicle,
  type FleetConsolidationIssue,
  type MaintenanceWorkOrder,
  type VehicleAssignment,
  type VehicleDocument,
  type VehicleOdometerEvent,
  type VehicleOperationalStatus,
  type VehicleStatusEvent,
} from "@/lib/fleet";
import { toast } from "sonner";

export const Route = createFileRoute("/app/admin/vehicle-profiles/$vehicleId")({
  head: () => ({ meta: [{ title: "Vehicle — Admin" }] }),
  component: VehicleDetailPage,
});

type DriverProfile = { user_id: string; full_name: string | null; phone: string | null };
type RideRow = {
  id: string;
  status: string;
  pickup_address: string;
  destination_address: string;
  driver_id: string | null;
  passenger_id: string;
  scheduled_at: string | null;
  created_at: string;
};
type BookingAssignment = {
  id: string;
  booking_id: string;
  vehicle_id: string | null;
  fleet_vehicle_id: string | null;
  status: string;
  assigned_at: string;
};
type BookingRow = { id: string; booking_reference: string; service_type: string; status: string };
type LegacyMapping = {
  id: string;
  legacy_source: string;
  legacy_record_id: string;
  legacy_registration: string | null;
  match_method: string;
  match_confidence: number;
  migration_status: string;
  conflict_notes: string | null;
};

type DetailData = {
  vehicle: CanonicalVehicle | null;
  assignments: VehicleAssignment[];
  documents: VehicleDocument[];
  workOrders: MaintenanceWorkOrder[];
  odometerEvents: VehicleOdometerEvent[];
  statusEvents: VehicleStatusEvent[];
  rides: RideRow[];
  bookingAssignments: BookingAssignment[];
  bookings: BookingRow[];
  mappings: LegacyMapping[];
  issues: FleetConsolidationIssue[];
  drivers: DriverProfile[];
};

const EMPTY_DATA: DetailData = {
  vehicle: null,
  assignments: [],
  documents: [],
  workOrders: [],
  odometerEvents: [],
  statusEvents: [],
  rides: [],
  bookingAssignments: [],
  bookings: [],
  mappings: [],
  issues: [],
  drivers: [],
};

function VehicleDetailPage() {
  const { vehicleId } = Route.useParams();
  const { user, loading: authLoading } = useAuth();
  const { roles, loading: rolesLoading } = useUserRoles(user?.id);
  const navigate = useNavigate();
  const isAdmin = !!roles?.includes("admin");
  const [data, setData] = useState<DetailData>(EMPTY_DATA);
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
      const [
        vehicleResult,
        assignmentResult,
        documentResult,
        workOrderResult,
        odometerResult,
        statusResult,
        rideResult,
        bookingAssignmentResult,
        mappingResult,
        issueResult,
      ] = await Promise.all([
        fleetDb.from("vehicle_profiles").select("*").eq("id", vehicleId).maybeSingle(),
        fleetDb
          .from("vehicle_driver_assignments")
          .select("*")
          .eq("vehicle_id", vehicleId)
          .order("start_at", { ascending: false }),
        fleetDb
          .from("vehicle_documents")
          .select("*")
          .eq("vehicle_id", vehicleId)
          .order("created_at", { ascending: false }),
        fleetDb
          .from("vehicle_maintenance_work_orders")
          .select("*")
          .eq("vehicle_id", vehicleId)
          .order("reported_at", { ascending: false }),
        fleetDb
          .from("vehicle_odometer_events")
          .select("*")
          .eq("vehicle_id", vehicleId)
          .order("recorded_at", { ascending: false }),
        fleetDb
          .from("vehicle_status_events")
          .select("*")
          .eq("vehicle_id", vehicleId)
          .order("created_at", { ascending: false }),
        fleetDb
          .from("rides")
          .select("id,status,pickup_address,destination_address,driver_id,passenger_id,scheduled_at,created_at")
          .eq("vehicle_id", vehicleId)
          .order("created_at", { ascending: false })
          .limit(50),
        fleetDb
          .from("booking_vehicle_assignments")
          .select("id,booking_id,vehicle_id,fleet_vehicle_id,status,assigned_at")
          .eq("vehicle_id", vehicleId)
          .order("assigned_at", { ascending: false }),
        fleetDb
          .from("vehicle_legacy_mappings")
          .select("*")
          .eq("canonical_vehicle_id", vehicleId)
          .order("created_at"),
        fleetDb
          .from("fleet_consolidation_issues")
          .select("*")
          .eq("status", "open")
          .or(`source_record_id.eq.${vehicleId},registration_number.eq.${vehicleId}`)
          .order("created_at", { ascending: false }),
      ]);
      if (cancelled) return;
      const error =
        vehicleResult.error ||
        assignmentResult.error ||
        documentResult.error ||
        workOrderResult.error ||
        odometerResult.error ||
        statusResult.error ||
        rideResult.error ||
        bookingAssignmentResult.error ||
        mappingResult.error ||
        issueResult.error;
      if (error) {
        toast.error(error.message);
        setLoading(false);
        return;
      }

      const assignments = (assignmentResult.data ?? []) as VehicleAssignment[];
      const bookingAssignments = (bookingAssignmentResult.data ?? []) as BookingAssignment[];
      const driverIds = Array.from(new Set(assignments.map((assignment) => assignment.driver_id)));
      const bookingIds = Array.from(new Set(bookingAssignments.map((assignment) => assignment.booking_id)));
      const [driverResult, bookingResult] = await Promise.all([
        driverIds.length
          ? fleetDb.from("profiles").select("user_id,full_name,phone").in("user_id", driverIds)
          : Promise.resolve({ data: [] as DriverProfile[], error: null }),
        bookingIds.length
          ? fleetDb
              .from("service_bookings")
              .select("id,booking_reference,service_type,status")
              .in("id", bookingIds)
          : Promise.resolve({ data: [] as BookingRow[], error: null }),
      ]);
      if (cancelled) return;
      if (driverResult.error) toast.error(driverResult.error.message);
      if (bookingResult.error) toast.error(bookingResult.error.message);

      setData({
        vehicle: (vehicleResult.data ?? null) as CanonicalVehicle | null,
        assignments,
        documents: (documentResult.data ?? []) as VehicleDocument[],
        workOrders: (workOrderResult.data ?? []) as MaintenanceWorkOrder[],
        odometerEvents: (odometerResult.data ?? []) as VehicleOdometerEvent[],
        statusEvents: (statusResult.data ?? []) as VehicleStatusEvent[],
        rides: (rideResult.data ?? []) as RideRow[],
        bookingAssignments,
        bookings: (bookingResult.data ?? []) as BookingRow[],
        mappings: (mappingResult.data ?? []) as LegacyMapping[],
        issues: (issueResult.data ?? []) as FleetConsolidationIssue[],
        drivers: (driverResult.data ?? []) as DriverProfile[],
      });
      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, reload, vehicleId]);

  if (authLoading || rolesLoading || loading || (user && roles === null)) {
    return (
      <AdminShell title="Vehicle" subtitle="Canonical vehicle record.">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading vehicle record…
        </p>
      </AdminShell>
    );
  }
  if (!isAdmin) return null;
  if (!data.vehicle) {
    return (
      <AdminShell title="Vehicle not found">
        <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          This canonical vehicle record does not exist or is not accessible.
        </p>
      </AdminShell>
    );
  }

  const vehicle = data.vehicle;
  const effectiveAssignment = data.assignments.find((assignment) => isAssignmentEffective(assignment));
  const driverName = (driverId: string | null | undefined) =>
    driverId
      ? data.drivers.find((driver) => driver.user_id === driverId)?.full_name ?? driverId.slice(0, 8)
      : "Unassigned";
  const documentFor = (type: VehicleDocument["document_type"]) =>
    data.documents.find((document) => document.document_type === type && document.is_current);
  const service = serviceState(vehicle);
  const accessibility = accessibilityLabels(vehicle);

  return (
    <AdminShell
      title={vehicle.vehicle_name}
      subtitle={`${vehicle.license_plate} · canonical vehicle profile`}
      actions={
        <div className="flex flex-wrap gap-2">
          <StatusDialog vehicle={vehicle} onChanged={() => setReload((value) => value + 1)} />
          <OdometerDialog vehicle={vehicle} onRecorded={() => setReload((value) => value + 1)} />
          <MaintenanceDialog vehicle={vehicle} onCreated={() => setReload((value) => value + 1)} />
        </div>
      }
    >
      <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
        <Link
          to="/app/admin/vehicle-profiles"
          search={{ q: "", status: "all", assignment: "all", attention: "all" }}
        >
          <ArrowLeft className="mr-1 h-4 w-4" /> Vehicle profiles
        </Link>
      </Button>

      {data.issues.length ? (
        <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <p className="font-medium text-destructive">Migration reconciliation required</p>
          <p className="mt-1 text-sm text-muted-foreground">
            This vehicle has {data.issues.length} unresolved consolidation issue
            {data.issues.length === 1 ? "" : "s"}. Legacy sources must not be removed yet.
          </p>
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="space-y-5">
          <Card title="Overview" icon={<Car className="h-4 w-4" />}>
            <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <Detail label="Vehicle name" value={vehicle.vehicle_name} />
              <Detail label="Registration" value={vehicle.license_plate} />
              <Detail label="VIN" value={vehicle.vin_number || "Not recorded"} />
              <Detail
                label="Make / model / year"
                value={[vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(" ") || "Incomplete"}
              />
              <Detail label="Vehicle type" value={vehicle.vehicle_type || "Not recorded"} />
              <Detail label="Status" value={VEHICLE_STATUS_LABEL[vehicle.status]} />
              <Detail label="Odometer" value={`${Number(vehicle.current_odometer_km).toLocaleString("en-ZA")} km`} />
              <Detail label="Service state" value={service.replaceAll("_", " ")} />
            </dl>
          </Card>

          <Card title="Capacity and accessibility" icon={<Accessibility className="h-4 w-4" />}>
            <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <Detail label="Passenger capacity" value={vehicle.passenger_capacity ?? "Not recorded"} />
              <Detail label="Wheelchair capacity" value={vehicle.wheelchair_capacity ?? "Not recorded"} />
              <Detail label="Wheelchair accessible" value={vehicle.wheelchair_accessible ? "Yes" : "No"} />
              <Detail label="Ramp or lift" value={vehicle.ramp_or_lift_available ? "Yes" : "No"} />
            </dl>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {accessibility.map((label) => (
                <Badge key={label} variant="secondary">
                  {label}
                </Badge>
              ))}
              {!accessibility.length ? <Badge variant="outline">No features recorded</Badge> : null}
            </div>
          </Card>

          <Card title="Current assignment" icon={<UserRoundCheck className="h-4 w-4" />}>
            {effectiveAssignment ? (
              <div className="space-y-3 text-sm">
                <Detail label="Driver" value={driverName(effectiveAssignment.driver_id)} />
                <Detail label="Type" value={effectiveAssignment.assignment_type.replaceAll("_", " ")} />
                <Detail label="Started" value={new Date(effectiveAssignment.start_at).toLocaleString("en-ZA")} />
                <Button asChild variant="outline" size="sm" className="w-full">
                  <Link to="/app/admin/driver-assignments">Manage assignments</Link>
                </Button>
              </div>
            ) : (
              <div>
                <p className="text-sm text-muted-foreground">No effective driver assignment.</p>
                <Button asChild variant="outline" size="sm" className="mt-3 w-full">
                  <Link to="/app/admin/driver-assignments">Assign a driver</Link>
                </Button>
              </div>
            )}
          </Card>

          <Card title="Admin notes" icon={<PencilLine className="h-4 w-4" />}>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {vehicle.admin_notes || "No administrative notes."}
            </p>
          </Card>
        </aside>

        <div className="space-y-5">
          <Card title="Documents" icon={<FileCheck2 className="h-4 w-4" />}>
            <div className="grid gap-3 md:grid-cols-3">
              {(["roadworthy", "license_disc", "insurance"] as const).map((type) => {
                const document = documentFor(type);
                const legacyExpiry =
                  type === "roadworthy"
                    ? vehicle.roadworthy_expiry_date
                    : type === "license_disc"
                      ? vehicle.license_disc_expiry_date
                      : vehicle.insurance_expiry_date;
                const state = documentState(document?.expires_at ?? legacyExpiry);
                return (
                  <div key={type} className="rounded-xl border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium capitalize">{type.replaceAll("_", " ")}</p>
                      <Badge variant={state === "expired" ? "destructive" : "outline"}>{state}</Badge>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Expires {document?.expires_at ?? legacyExpiry ?? "not recorded"}
                    </p>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card title="Assignment history" icon={<History className="h-4 w-4" />}>
            <div className="space-y-2">
              {data.assignments.map((assignment) => (
                <div key={assignment.id} className="grid gap-2 rounded-xl border p-3 text-sm md:grid-cols-4">
                  <Detail label="Driver" value={driverName(assignment.driver_id)} />
                  <Detail label="Type" value={assignment.assignment_type.replaceAll("_", " ")} />
                  <Detail label="Status" value={ASSIGNMENT_STATUS_LABEL[assignment.status]} />
                  <Detail
                    label="Period"
                    value={`${new Date(assignment.start_at).toLocaleString("en-ZA")} — ${
                      assignment.end_at ? new Date(assignment.end_at).toLocaleString("en-ZA") : "ongoing"
                    }`}
                  />
                </div>
              ))}
              {!data.assignments.length ? <Empty text="No assignment history." /> : null}
            </div>
          </Card>

          <Card title="Maintenance" icon={<Wrench className="h-4 w-4" />}>
            <div className="space-y-2">
              {data.workOrders.map((order) => (
                <div key={order.id} className="rounded-xl border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">
                      {order.work_order_reference} · {order.maintenance_type.replaceAll("_", " ")}
                    </p>
                    <div className="flex gap-1.5">
                      <Badge variant={order.severity === "urgent" || order.severity === "unsafe" ? "destructive" : "outline"}>
                        {order.severity}
                      </Badge>
                      <Badge variant="secondary">{MAINTENANCE_STATUS_LABEL[order.status]}</Badge>
                    </div>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{order.description}</p>
                </div>
              ))}
              {!data.workOrders.length ? <Empty text="No maintenance work orders." /> : null}
            </div>
          </Card>

          <Card title="Trips" icon={<MapPinned className="h-4 w-4" />}>
            <div className="space-y-2">
              {data.rides.map((ride) => (
                <Link
                  key={ride.id}
                  to="/app/trip/$rideId"
                  params={{ rideId: ride.id }}
                  className="block rounded-xl border p-3 transition-colors hover:bg-muted/50"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium">{ride.destination_address}</p>
                    <Badge variant="outline">{ride.status.replaceAll("_", " ")}</Badge>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">From {ride.pickup_address}</p>
                </Link>
              ))}
              {!data.rides.length ? <Empty text="No trips reference this canonical vehicle." /> : null}
            </div>
          </Card>

          <Card title="Service bookings" icon={<CalendarRange className="h-4 w-4" />}>
            <div className="space-y-2">
              {data.bookingAssignments.map((assignment) => {
                const booking = data.bookings.find((item) => item.id === assignment.booking_id);
                return (
                  <div key={assignment.id} className="rounded-xl border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">{booking?.booking_reference ?? assignment.booking_id}</p>
                      <Badge variant="outline">{assignment.status}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {booking ? `${booking.service_type.replaceAll("_", " ")} · ${booking.status.replaceAll("_", " ")}` : "Booking details unavailable"}
                    </p>
                  </div>
                );
              })}
              {!data.bookingAssignments.length ? <Empty text="No service-booking assignments." /> : null}
            </div>
          </Card>

          <Card title="Odometer history" icon={<Gauge className="h-4 w-4" />}>
            <div className="space-y-2">
              {data.odometerEvents.map((event) => (
                <div key={event.id} className="grid gap-2 rounded-xl border p-3 text-sm sm:grid-cols-3">
                  <Detail label="Reading" value={`${Number(event.odometer_km).toLocaleString("en-ZA")} km`} />
                  <Detail label="Source" value={event.source.replaceAll("_", " ")} />
                  <Detail label="Recorded" value={new Date(event.recorded_at).toLocaleString("en-ZA")} />
                </div>
              ))}
              {!data.odometerEvents.length ? <Empty text="No odometer history." /> : null}
            </div>
          </Card>

          <Card title="Status history" icon={<ShieldCheck className="h-4 w-4" />}>
            <div className="space-y-2">
              {data.statusEvents.map((event) => (
                <div key={event.id} className="rounded-xl border p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">
                      {event.previous_status ? `${event.previous_status.replaceAll("_", " ")} → ` : ""}
                      {VEHICLE_STATUS_LABEL[event.new_status]}
                    </p>
                    <span className="text-xs text-muted-foreground">
                      {new Date(event.created_at).toLocaleString("en-ZA")}
                    </span>
                  </div>
                  <p className="mt-1 text-muted-foreground">{event.reason}</p>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Legacy migration information" icon={<ClipboardList className="h-4 w-4" />}>
            <div className="space-y-2">
              {data.mappings.map((mapping) => (
                <div key={mapping.id} className="grid gap-2 rounded-xl border p-3 text-sm md:grid-cols-4">
                  <Detail label="Source" value={mapping.legacy_source.replaceAll("_", " ")} />
                  <Detail label="Registration" value={mapping.legacy_registration || "None"} />
                  <Detail label="Method" value={mapping.match_method.replaceAll("_", " ")} />
                  <Detail label="Status" value={`${mapping.migration_status} · ${mapping.match_confidence}%`} />
                </div>
              ))}
              {!data.mappings.length ? <Empty text="No legacy mappings recorded." /> : null}
            </div>
          </Card>
        </div>
      </div>
    </AdminShell>
  );
}

function Card({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2 text-primary">
        {icon}
        <h2 className="font-semibold text-foreground">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words font-medium capitalize">{value}</dd>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">{text}</p>;
}

function StatusDialog({ vehicle, onChanged }: { vehicle: CanonicalVehicle; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<VehicleOperationalStatus>(vehicle.status);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (reason.trim().length < 3) {
      toast.error("Add a reason for the status change");
      return;
    }
    setSaving(true);
    const { error } = await fleetDb.rpc("admin_change_vehicle_status", {
      p_vehicle_id: vehicle.id,
      p_new_status: status,
      p_reason: reason.trim(),
      p_expected_status: vehicle.status,
      p_work_order_id: null,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Vehicle status updated");
    setOpen(false);
    setReason("");
    onChanged();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <ShieldCheck className="mr-1 h-4 w-4" /> Change status
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change vehicle status</DialogTitle>
          <DialogDescription>
            Non-active statuses automatically end overlapping scheduled or active assignments.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <label className="space-y-1.5 text-sm">
            <span className="font-medium">New status</span>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as VehicleOperationalStatus)}
              className="h-10 w-full rounded-md border bg-background px-3"
            >
              <option value="active">Active</option>
              <option value="maintenance">Maintenance</option>
              <option value="out_of_service">Out of service</option>
              <option value="retired">Retired</option>
            </select>
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="font-medium">Reason</span>
            <Textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={4} />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            Save status
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OdometerDialog({ vehicle, onRecorded }: { vehicle: CanonicalVehicle; onRecorded: () => void }) {
  const [open, setOpen] = useState(false);
  const [odometer, setOdometer] = useState(String(vehicle.current_odometer_km));
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    const value = Number(odometer);
    if (!Number.isFinite(value) || value < 0) {
      toast.error("Enter a valid odometer reading");
      return;
    }
    setSaving(true);
    const { error } = await fleetDb.rpc("admin_record_vehicle_odometer", {
      p_vehicle_id: vehicle.id,
      p_odometer_km: value,
      p_source: "admin",
      p_ride_id: null,
      p_work_order_id: null,
      p_notes: notes.trim() || null,
      p_allow_correction: value < Number(vehicle.current_odometer_km),
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Odometer event recorded");
    setOpen(false);
    setNotes("");
    onRecorded();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Gauge className="mr-1 h-4 w-4" /> Record odometer
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record odometer event</DialogTitle>
          <DialogDescription>
            Lower readings are treated as corrections and require an audit reason.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <label className="space-y-1.5 text-sm">
            <span className="font-medium">Odometer kilometres</span>
            <Input type="number" min="0" value={odometer} onChange={(event) => setOdometer(event.target.value)} />
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="font-medium">Notes or correction reason</span>
            <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            Record event
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MaintenanceDialog({ vehicle, onCreated }: { vehicle: CanonicalVehicle; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("repair");
  const [severity, setSeverity] = useState("attention");
  const [description, setDescription] = useState("");
  const [provider, setProvider] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (description.trim().length < 3) {
      toast.error("Describe the maintenance requirement");
      return;
    }
    setSaving(true);
    const { error } = await fleetDb.rpc("admin_open_maintenance_work_order", {
      p_vehicle_id: vehicle.id,
      p_maintenance_type: type,
      p_severity: severity,
      p_description: description.trim(),
      p_scheduled_at: null,
      p_odometer_at_report: vehicle.current_odometer_km,
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
    setDescription("");
    setProvider("");
    onCreated();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Wrench className="mr-1 h-4 w-4" /> Open maintenance
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Open maintenance work order</DialogTitle>
          <DialogDescription>
            Urgent or unsafe work orders automatically place the vehicle out of service.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <label className="space-y-1.5 text-sm">
            <span className="font-medium">Maintenance type</span>
            <select value={type} onChange={(event) => setType(event.target.value)} className="h-10 w-full rounded-md border bg-background px-3">
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
            <select value={severity} onChange={(event) => setSeverity(event.target.value)} className="h-10 w-full rounded-md border bg-background px-3">
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
            <span className="font-medium">Description</span>
            <Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} />
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
