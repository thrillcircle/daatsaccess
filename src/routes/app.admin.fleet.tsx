import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useUserRoles } from "@/hooks/use-auth";
import { AdminShell } from "@/components/AdminShell";
import { NAV_ICONS } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Pencil, Gauge, Wrench, UserPlus, StickyNote, Loader2, Accessibility, ExternalLink, ShieldCheck, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";
import { getVehicleAlerts, highestSeverity } from "@/lib/vehicle-alerts";

type Vehicle = Database["public"]["Tables"]["vehicle_profiles"]["Row"];
type VehicleInsert = Database["public"]["Tables"]["vehicle_profiles"]["Insert"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];

const STATUSES = ["active", "in_maintenance", "out_of_service", "retired"] as const;
const ACTIVE_RIDE_STATUSES = ["requested", "accepted", "driver_arriving", "arrived", "in_progress"] as const;

type FleetStats = {
  total: number;
  available: number;
  assignedToday: number;
  inMaintenance: number;
  serviceDueSoon: number;
  expiredDocs: number;
};

type VehicleTripStats = {
  upcoming: number;
  completed: number;
  estimatedKm: number;
};

export const Route = createFileRoute("/app/admin/fleet")({
  head: () => ({ meta: [{ title: "Fleet — Admin" }] }),
  component: VehiclesPage,
});


function VehiclesPage() {
  const { user } = useAuth();
  const { roles, loading: rolesLoading } = useUserRoles(user?.id);
  const isAdmin = !!roles?.includes("admin");
  const navigate = useNavigate();

  const nav = useMemo(() => {
    const items: { to: string; label: string; icon: typeof NAV_ICONS.Admin }[] = [];
    if (roles?.includes("passenger")) items.push({ to: "/app/passenger", label: "Ride", icon: NAV_ICONS.Passenger });
    if (roles?.includes("driver")) items.push({ to: "/app/driver", label: "Drive", icon: NAV_ICONS.Driver });
    items.push({ to: "/app/admin", label: "Admin", icon: NAV_ICONS.Admin });
    return items;
  }, [roles]);

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Profile[]>([]);
  const [tripStats, setTripStats] = useState<Map<string, VehicleTripStats>>(new Map());
  const [assignedToday, setAssignedToday] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [vRes, rRes] = await Promise.all([
        supabase.from("vehicle_profiles").select("*").order("vehicle_name"),
        supabase.from("user_roles").select("user_id").eq("role", "driver"),
      ]);
      if (cancelled) return;
      if (vRes.error) toast.error("Failed to load vehicles");
      const vehicleRows = vRes.data ?? [];
      setVehicles(vehicleRows);
      const driverIds = (rRes.data ?? []).map((r) => r.user_id);
      let ds: Profile[] = [];
      if (driverIds.length) {
        const pRes = await supabase.from("profiles").select("*").in("user_id", driverIds);
        ds = pRes.data ?? [];
      }
      setDrivers(ds);

      // Trip stats per vehicle.
      const vIds = vehicleRows.map((v) => v.id);
      if (vIds.length) {
        const { data: rides } = await supabase
          .from("rides")
          .select("vehicle_id, status, distance_km, actual_distance_km, scheduled_at, created_at")
          .in("vehicle_id", vIds);
        const stats = new Map<string, VehicleTripStats>();
        const todays = new Set<string>();
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);
        for (const v of vehicleRows) stats.set(v.id, { upcoming: 0, completed: 0, estimatedKm: 0 });
        for (const r of rides ?? []) {
          if (!r.vehicle_id) continue;
          const s = stats.get(r.vehicle_id);
          if (!s) continue;
          if (r.status === "completed") {
            s.completed += 1;
            s.estimatedKm += Number(r.actual_distance_km ?? r.distance_km ?? 0);
          } else if ((ACTIVE_RIDE_STATUSES as readonly string[]).includes(r.status)) {
            s.upcoming += 1;
          }
          const ref = r.scheduled_at ? new Date(r.scheduled_at) : new Date(r.created_at);
          if (ref >= todayStart && ref <= todayEnd && r.status !== "cancelled") {
            todays.add(r.vehicle_id);
          }
        }
        if (!cancelled) {
          setTripStats(stats);
          setAssignedToday(todays);
        }
      } else {
        setTripStats(new Map());
        setAssignedToday(new Set());
      }

      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [isAdmin, reloadTick]);

  const refresh = () => setReloadTick((n) => n + 1);

  useEffect(() => {
    if (!rolesLoading && !isAdmin) navigate({ to: "/app" });
  }, [rolesLoading, isAdmin, navigate]);

  if (rolesLoading) return <AdminShell title="Fleet"><div className="p-6 text-sm text-muted-foreground">Loading…</div></AdminShell>;
  if (!isAdmin) return null;

  const driverName = (id: string | null) => {
    if (!id) return "Unassigned";
    const d = drivers.find((p) => p.user_id === id);
    return d?.full_name ?? id.slice(0, 8);
  };

  const stats: FleetStats = vehicles.reduce<FleetStats>(
    (acc, v) => {
      acc.total++;
      if (v.status === "active" && !assignedToday.has(v.id)) acc.available++;
      if (assignedToday.has(v.id)) acc.assignedToday++;
      if (v.status === "in_maintenance") acc.inMaintenance++;
      const alerts = getVehicleAlerts(v);
      if (alerts.some((a) => a.label === "Service due soon" || a.label === "Service overdue"))
        acc.serviceDueSoon++;
      if (alerts.some((a) => /expired/i.test(a.label))) acc.expiredDocs++;
      return acc;
    },
    { total: 0, available: 0, assignedToday: 0, inMaintenance: 0, serviceDueSoon: 0, expiredDocs: 0 },
  );

  return (
    <AdminShell title="Fleet">
      <div className="mx-auto max-w-6xl p-4">
        <div className="mb-4 flex items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold">Fleet Management</h1>
            <p className="text-sm text-muted-foreground">
              Operations, safety, accessibility &amp; maintenance planning
            </p>
          </div>
          <VehicleDialog drivers={drivers} onSaved={refresh}>
            <Button size="sm"><Plus className="mr-1 h-4 w-4" /> Add vehicle</Button>
          </VehicleDialog>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <FleetStatCard label="Total" value={stats.total} />
          <FleetStatCard label="Available" value={stats.available} accent="ok" />
          <FleetStatCard label="Assigned today" value={stats.assignedToday} />
          <FleetStatCard label="In maintenance" value={stats.inMaintenance} accent="warn" />
          <FleetStatCard label="Service due" value={stats.serviceDueSoon} accent="warn" />
          <FleetStatCard label="Expired docs" value={stats.expiredDocs} accent="bad" />
        </div>

        {loading ? (
          <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
            <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> Loading fleet…
          </div>
        ) : vehicles.length === 0 ? (
          <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
            No vehicles yet. Add your first one to get started.
          </div>
        ) : (
          <div className="space-y-3">
            {vehicles.map((v) => (
              <VehicleRow
                key={v.id}
                vehicle={v}
                driverName={driverName(v.assigned_driver_id)}
                drivers={drivers}
                tripStats={tripStats.get(v.id) ?? { upcoming: 0, completed: 0, estimatedKm: 0 }}
                assignedNow={assignedToday.has(v.id)}
                onChanged={refresh}
              />
            ))}
          </div>
        )}
      </div>
    </AdminShell>
  );
}

function FleetStatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: "ok" | "warn" | "bad";
}) {
  const cls =
    accent === "ok"
      ? "border-emerald-500/30 bg-emerald-500/5"
      : accent === "warn"
      ? "border-amber-500/40 bg-amber-500/5"
      : accent === "bad"
      ? "border-destructive/40 bg-destructive/5"
      : "";
  const Icon =
    accent === "ok" ? CheckCircle2 :
    accent === "warn" ? AlertTriangle :
    accent === "bad" ? AlertTriangle :
    ShieldCheck;
  return (
    <div className={`rounded-lg border bg-card p-3 ${cls}`}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}



function VehicleRow({
  vehicle: v,
  driverName,
  drivers,
  tripStats,
  assignedNow,
  onChanged,
}: {
  vehicle: Vehicle;
  driverName: string;
  drivers: Profile[];
  tripStats: VehicleTripStats;
  assignedNow: boolean;
  onChanged: () => void;
}) {
  const alerts = getVehicleAlerts(v);
  const sev = highestSeverity(alerts);
  const ringClass =
    sev === "urgent" ? "ring-2 ring-destructive/40" :
    sev === "warning" ? "ring-2 ring-amber-400/40" : "";

  const statusColor: Record<string, string> = {
    active: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    in_maintenance: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    out_of_service: "bg-destructive/15 text-destructive",
    retired: "bg-muted text-muted-foreground",
  };

  const odo = Number(v.current_odometer_km ?? 0);
  const lastKm = v.last_service_km != null ? Number(v.last_service_km) : null;
  const dueKm = v.next_service_due_km != null ? Number(v.next_service_due_km) : null;
  const interval = Number(v.service_interval_km ?? 0);
  let servicePct: number | null = null;
  if (lastKm != null && interval > 0) {
    servicePct = Math.max(0, Math.min(100, ((odo - lastKm) / interval) * 100));
  } else if (dueKm != null && interval > 0) {
    servicePct = Math.max(0, Math.min(100, ((odo - (dueKm - interval)) / interval) * 100));
  }

  const lifecycleStatus = assignedNow ? "assigned" : v.status;
  const lifecycleColor: Record<string, string> = {
    ...statusColor,
    assigned: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  };

  return (
    <div className={`rounded-xl border bg-card p-4 ${ringClass}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{v.vehicle_name}</span>
            <Badge variant="outline" className="font-mono">{v.license_plate}</Badge>
            <Badge className={lifecycleColor[lifecycleStatus] ?? ""}>
              {lifecycleStatus.replace(/_/g, " ")}
            </Badge>
            {v.wheelchair_accessible && (
              <Badge variant="secondary" className="gap-1"><Accessibility className="h-3 w-3" /> Accessible</Badge>
            )}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {[v.vehicle_type, [v.make, v.model].filter(Boolean).join(" "), v.year].filter(Boolean).join(" · ")}
            {v.ramp_or_lift_available && " · Ramp/lift"}
            {v.passenger_capacity != null && ` · ${v.passenger_capacity} pax`}
            {v.wheelchair_capacity != null && ` · ${v.wheelchair_capacity} WC`}
          </div>
        </div>
        <div className="text-right text-xs">
          <div className="text-muted-foreground">Driver</div>
          <div className="font-medium">{driverName}</div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <Stat label="Odometer" value={`${odo.toLocaleString()} km`} />
        <Stat
          label="Next service"
          value={dueKm != null ? `${dueKm.toLocaleString()} km` : "—"}
        />
        <Stat label="Service interval" value={interval ? `${interval.toLocaleString()} km` : "—"} />
        <Stat label="Last service" value={v.last_service_date ?? (lastKm != null ? `${lastKm.toLocaleString()} km` : "—")} />
        <Stat label="License" value={v.license_disc_expiry_date ?? "—"} />
        <Stat label="Insurance" value={v.insurance_expiry_date ?? "—"} />
        <Stat label="Roadworthy" value={v.roadworthy_expiry_date ?? "—"} />
        <Stat label="VIN" value={v.vin_number ?? "—"} />
      </div>

      {servicePct != null && (
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
            <span>Service progress</span>
            <span className="font-medium text-foreground">{servicePct.toFixed(0)}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={
                "h-full " +
                (servicePct >= 100
                  ? "bg-destructive"
                  : servicePct >= 90
                  ? "bg-amber-500"
                  : "bg-emerald-500")
              }
              style={{ width: `${servicePct}%` }}
            />
          </div>
        </div>
      )}

      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <Stat label="Upcoming trips" value={String(tripStats.upcoming)} />
        <Stat label="Completed trips" value={String(tripStats.completed)} />
        <Stat label="Est. km driven" value={`${Math.round(tripStats.estimatedKm).toLocaleString()} km`} />
      </div>

      {alerts.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {alerts.map((a, i) => (
            <Badge
              key={i}
              className={a.severity === "urgent"
                ? "bg-destructive text-destructive-foreground"
                : "bg-amber-500/20 text-amber-800 dark:text-amber-200"}
            >
              {a.label}
            </Badge>
          ))}
        </div>
      )}

      {v.admin_notes && (
        <div className="mt-3 rounded-md border bg-muted/30 p-2 text-xs whitespace-pre-wrap">
          <span className="font-medium">Notes: </span>{v.admin_notes}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <VehicleDialog vehicle={v} drivers={drivers} onSaved={onChanged}>
          <Button size="sm" variant="outline"><Pencil className="mr-1 h-3.5 w-3.5" /> Edit</Button>
        </VehicleDialog>
        <AssignDriverDialog vehicle={v} drivers={drivers} onSaved={onChanged}>
          <Button size="sm" variant="outline"><UserPlus className="mr-1 h-3.5 w-3.5" /> Driver</Button>
        </AssignDriverDialog>
        <OdometerDialog vehicle={v} onSaved={onChanged}>
          <Button size="sm" variant="outline"><Gauge className="mr-1 h-3.5 w-3.5" /> Odometer</Button>
        </OdometerDialog>
        <RecordServiceDialog vehicle={v} onSaved={onChanged}>
          <Button size="sm" variant="outline"><Wrench className="mr-1 h-3.5 w-3.5" /> Record service</Button>
        </RecordServiceDialog>
        <NoteDialog vehicle={v} onSaved={onChanged}>
          <Button size="sm" variant="outline"><StickyNote className="mr-1 h-3.5 w-3.5" /> Note</Button>
        </NoteDialog>
        <VehicleTripsDialog vehicle={v}>
          <Button size="sm" variant="ghost"><ExternalLink className="mr-1 h-3.5 w-3.5" /> Trips</Button>
        </VehicleTripsDialog>
        <StatusButtons vehicle={v} onSaved={onChanged} />
      </div>
    </div>
  );
}


function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-background p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="truncate text-xs font-medium">{value}</div>
    </div>
  );
}

function StatusButtons({ vehicle: v, onSaved }: { vehicle: Vehicle; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const update = async (status: typeof STATUSES[number]) => {
    setBusy(true);
    const { error } = await supabase.from("vehicle_profiles").update({ status }).eq("id", v.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`Marked ${status.replace(/_/g, " ")}`);
    onSaved();
  };
  if (v.status === "active") {
    return (
      <Button size="sm" variant="outline" disabled={busy} onClick={() => update("in_maintenance")}>
        <Wrench className="mr-1 h-3.5 w-3.5" /> Mark in maintenance
      </Button>
    );
  }
  return (
    <Button size="sm" variant="outline" disabled={busy} onClick={() => update("active")}>
      Mark active
    </Button>
  );
}

function VehicleDialog({
  vehicle,
  drivers,
  children,
  onSaved,
}: {
  vehicle?: Vehicle;
  drivers: Profile[];
  children: React.ReactNode;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<VehicleInsert>(() => ({
    vehicle_name: vehicle?.vehicle_name ?? "",
    vehicle_type: vehicle?.vehicle_type ?? "",
    make: vehicle?.make ?? "",
    model: vehicle?.model ?? "",
    year: vehicle?.year ?? null,
    license_plate: vehicle?.license_plate ?? "",
    vin_number: vehicle?.vin_number ?? "",
    wheelchair_accessible: vehicle?.wheelchair_accessible ?? false,
    ramp_or_lift_available: vehicle?.ramp_or_lift_available ?? false,
    passenger_capacity: vehicle?.passenger_capacity ?? null,
    wheelchair_capacity: vehicle?.wheelchair_capacity ?? null,
    assigned_driver_id: vehicle?.assigned_driver_id ?? null,
    current_odometer_km: vehicle?.current_odometer_km ?? 0,
    last_service_km: vehicle?.last_service_km ?? null,
    next_service_due_km: vehicle?.next_service_due_km ?? null,
    service_interval_km: vehicle?.service_interval_km ?? 10000,
    last_service_date: vehicle?.last_service_date ?? null,
    roadworthy_expiry_date: vehicle?.roadworthy_expiry_date ?? null,
    license_disc_expiry_date: vehicle?.license_disc_expiry_date ?? null,
    insurance_expiry_date: vehicle?.insurance_expiry_date ?? null,
    status: vehicle?.status ?? "active",
    admin_notes: vehicle?.admin_notes ?? "",
  }));

  const set = <K extends keyof VehicleInsert>(k: K, v: VehicleInsert[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.vehicle_name?.trim() || !form.license_plate?.trim()) {
      return toast.error("Name and license plate are required");
    }
    setBusy(true);
    const payload: VehicleInsert = {
      ...form,
      assigned_driver_id: form.assigned_driver_id || null,
      vehicle_type: form.vehicle_type || null,
      make: form.make || null,
      model: form.model || null,
      vin_number: form.vin_number || null,
      admin_notes: form.admin_notes || null,
    };
    const res = vehicle
      ? await supabase.from("vehicle_profiles").update(payload).eq("id", vehicle.id)
      : await supabase.from("vehicle_profiles").insert(payload);
    setBusy(false);
    if (res.error) return toast.error(res.error.message);
    toast.success(vehicle ? "Vehicle updated" : "Vehicle added");
    setOpen(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{vehicle ? "Edit vehicle" : "Add vehicle"}</DialogTitle>
          <DialogDescription>Manage vehicle details, accessibility, and maintenance schedule.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Vehicle name *">
            <Input value={form.vehicle_name ?? ""} onChange={(e) => set("vehicle_name", e.target.value)} />
          </Field>
          <Field label="License plate *">
            <Input value={form.license_plate ?? ""} onChange={(e) => set("license_plate", e.target.value)} />
          </Field>
          <Field label="Type">
            <Input placeholder="Sedan, Minivan, MPV…" value={form.vehicle_type ?? ""} onChange={(e) => set("vehicle_type", e.target.value)} />
          </Field>
          <Field label="Status">
            <Select value={form.status ?? "active"} onValueChange={(val) => set("status", val)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Make"><Input value={form.make ?? ""} onChange={(e) => set("make", e.target.value)} /></Field>
          <Field label="Model"><Input value={form.model ?? ""} onChange={(e) => set("model", e.target.value)} /></Field>
          <Field label="Year">
            <Input type="number" value={form.year ?? ""} onChange={(e) => set("year", e.target.value ? Number(e.target.value) : null)} />
          </Field>
          <Field label="VIN"><Input value={form.vin_number ?? ""} onChange={(e) => set("vin_number", e.target.value)} /></Field>
          <Field label="Passenger capacity">
            <Input type="number" value={form.passenger_capacity ?? ""} onChange={(e) => set("passenger_capacity", e.target.value ? Number(e.target.value) : null)} />
          </Field>
          <Field label="Wheelchair capacity">
            <Input type="number" value={form.wheelchair_capacity ?? ""} onChange={(e) => set("wheelchair_capacity", e.target.value ? Number(e.target.value) : null)} />
          </Field>
          <Field label="Assigned driver">
            <Select
              value={form.assigned_driver_id ?? "none"}
              onValueChange={(val) => set("assigned_driver_id", val === "none" ? null : val)}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Unassigned</SelectItem>
                {drivers.map((d) => (
                  <SelectItem key={d.user_id} value={d.user_id}>{d.full_name ?? d.user_id.slice(0, 8)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="flex items-center justify-between rounded-md border p-2">
            <Label>Wheelchair accessible</Label>
            <Switch checked={!!form.wheelchair_accessible} onCheckedChange={(c) => set("wheelchair_accessible", c)} />
          </div>
          <div className="flex items-center justify-between rounded-md border p-2">
            <Label>Ramp / lift available</Label>
            <Switch checked={!!form.ramp_or_lift_available} onCheckedChange={(c) => set("ramp_or_lift_available", c)} />
          </div>
          <Field label="Current odometer (km)">
            <Input type="number" value={form.current_odometer_km ?? 0} onChange={(e) => set("current_odometer_km", e.target.value ? Number(e.target.value) : 0)} />
          </Field>
          <Field label="Service interval (km)">
            <Input type="number" value={form.service_interval_km ?? 10000} onChange={(e) => set("service_interval_km", e.target.value ? Number(e.target.value) : 10000)} />
          </Field>
          <Field label="Last service (km)">
            <Input type="number" value={form.last_service_km ?? ""} onChange={(e) => set("last_service_km", e.target.value ? Number(e.target.value) : null)} />
          </Field>
          <Field label="Next service due (km)">
            <Input type="number" value={form.next_service_due_km ?? ""} onChange={(e) => set("next_service_due_km", e.target.value ? Number(e.target.value) : null)} />
          </Field>
          <Field label="Last service date">
            <Input type="date" value={form.last_service_date ?? ""} onChange={(e) => set("last_service_date", e.target.value || null)} />
          </Field>
          <Field label="Roadworthy expiry">
            <Input type="date" value={form.roadworthy_expiry_date ?? ""} onChange={(e) => set("roadworthy_expiry_date", e.target.value || null)} />
          </Field>
          <Field label="License disc expiry">
            <Input type="date" value={form.license_disc_expiry_date ?? ""} onChange={(e) => set("license_disc_expiry_date", e.target.value || null)} />
          </Field>
          <Field label="Insurance expiry">
            <Input type="date" value={form.insurance_expiry_date ?? ""} onChange={(e) => set("insurance_expiry_date", e.target.value || null)} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Admin notes">
              <Textarea rows={3} value={form.admin_notes ?? ""} onChange={(e) => set("admin_notes", e.target.value)} />
            </Field>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={save} disabled={busy}>
            {busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function AssignDriverDialog({
  vehicle,
  drivers,
  children,
  onSaved,
}: {
  vehicle: Vehicle;
  drivers: Profile[];
  children: React.ReactNode;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<string>(vehicle.assigned_driver_id ?? "none");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const { error } = await supabase.from("vehicle_profiles")
      .update({ assigned_driver_id: value === "none" ? null : value })
      .eq("id", vehicle.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Driver updated");
    setOpen(false);
    onSaved();
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Assign driver</DialogTitle></DialogHeader>
        <Select value={value} onValueChange={setValue}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Unassigned</SelectItem>
            {drivers.map((d) => (
              <SelectItem key={d.user_id} value={d.user_id}>{d.full_name ?? d.user_id.slice(0, 8)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={save} disabled={busy}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OdometerDialog({
  vehicle,
  children,
  onSaved,
}: {
  vehicle: Vehicle;
  children: React.ReactNode;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<string>(String(vehicle.current_odometer_km ?? 0));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const km = Number(value);
    if (Number.isNaN(km) || km < 0) return toast.error("Enter a valid km value");
    if (km < Number(vehicle.current_odometer_km ?? 0)) {
      return toast.error("Odometer cannot decrease");
    }
    setBusy(true);
    const { error } = await supabase.from("vehicle_profiles")
      .update({ current_odometer_km: km })
      .eq("id", vehicle.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Odometer updated");
    setOpen(false);
    onSaved();
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Update odometer</DialogTitle>
          <DialogDescription>Current: {Number(vehicle.current_odometer_km).toLocaleString()} km</DialogDescription>
        </DialogHeader>
        <Input type="number" value={value} onChange={(e) => setValue(e.target.value)} />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={save} disabled={busy}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NoteDialog({
  vehicle,
  children,
  onSaved,
}: {
  vehicle: Vehicle;
  children: React.ReactNode;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<string>(vehicle.admin_notes ?? "");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const { error } = await supabase.from("vehicle_profiles")
      .update({ admin_notes: value || null })
      .eq("id", vehicle.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Note saved");
    setOpen(false);
    onSaved();
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Admin note</DialogTitle></DialogHeader>
        <Textarea rows={5} value={value} onChange={(e) => setValue(e.target.value)} />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={save} disabled={busy}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RecordServiceDialog({
  vehicle,
  children,
  onSaved,
}: {
  vehicle: Vehicle;
  children: React.ReactNode;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [km, setKm] = useState<string>(String(vehicle.current_odometer_km ?? 0));
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [intervalKm, setIntervalKm] = useState<string>(String(vehicle.service_interval_km ?? 10000));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const lastKm = Number(km);
    const interval = Number(intervalKm);
    if (Number.isNaN(lastKm) || lastKm < 0) return toast.error("Enter valid service km");
    if (Number.isNaN(interval) || interval <= 0) return toast.error("Enter valid interval");
    setBusy(true);
    const odo = Math.max(Number(vehicle.current_odometer_km ?? 0), lastKm);
    const { error } = await supabase
      .from("vehicle_profiles")
      .update({
        last_service_km: lastKm,
        last_service_date: date || null,
        service_interval_km: interval,
        next_service_due_km: lastKm + interval,
        current_odometer_km: odo,
        status: vehicle.status === "in_maintenance" ? "active" : vehicle.status,
      })
      .eq("id", vehicle.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Service recorded · next due at " + (lastKm + interval).toLocaleString() + " km");
    setOpen(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record completed service</DialogTitle>
          <DialogDescription>
            Updates last service km/date and recalculates the next service due km.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Service km">
            <Input type="number" value={km} onChange={(e) => setKm(e.target.value)} />
          </Field>
          <Field label="Service date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Service interval (km)">
            <Input type="number" value={intervalKm} onChange={(e) => setIntervalKm(e.target.value)} />
          </Field>
          <div className="rounded-md border bg-muted/30 p-2 text-xs">
            <div className="text-muted-foreground">Next service due</div>
            <div className="font-medium">
              {(Number(km || 0) + Number(intervalKm || 0)).toLocaleString()} km
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={save} disabled={busy}>
            {busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type VehicleTrip = {
  id: string;
  status: string;
  pickup_address: string;
  destination_address: string;
  scheduled_at: string | null;
  created_at: string;
  completed_at: string | null;
  distance_km: number;
  actual_distance_km: number | null;
};

function VehicleTripsDialog({
  vehicle,
  children,
}: {
  vehicle: Vehicle;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [trips, setTrips] = useState<VehicleTrip[]>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("rides")
        .select("id,status,pickup_address,destination_address,scheduled_at,created_at,completed_at,distance_km,actual_distance_km")
        .eq("vehicle_id", vehicle.id)
        .order("created_at", { ascending: false })
        .limit(100);
      if (cancelled) return;
      if (error) toast.error(error.message);
      setTrips((data ?? []) as VehicleTrip[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, vehicle.id]);

  const upcoming = trips.filter((t) => (ACTIVE_RIDE_STATUSES as readonly string[]).includes(t.status));
  const past = trips.filter((t) => !(ACTIVE_RIDE_STATUSES as readonly string[]).includes(t.status));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{vehicle.vehicle_name} · trips</DialogTitle>
          <DialogDescription>Upcoming and recent trips assigned to this vehicle.</DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> Loading trips…
          </div>
        ) : trips.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No trips assigned to this vehicle yet.</p>
        ) : (
          <div className="space-y-4">
            <TripsSection title="Upcoming / active" trips={upcoming} />
            <TripsSection title="Past trips" trips={past} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TripsSection({ title, trips }: { title: string; trips: VehicleTrip[] }) {
  if (!trips.length) return null;
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <ul className="divide-y rounded-md border">
        {trips.map((t) => (
          <li key={t.id} className="space-y-1 px-3 py-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-medium">{t.destination_address}</span>
              <Badge variant="outline" className="capitalize">{t.status.replace(/_/g, " ")}</Badge>
            </div>
            <p className="truncate text-muted-foreground">From {t.pickup_address}</p>
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>
                {t.scheduled_at
                  ? new Date(t.scheduled_at).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", dateStyle: "short", timeStyle: "short" })
                  : new Date(t.created_at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}
              </span>
              <span>
                {Number(t.actual_distance_km ?? t.distance_km).toFixed(1)} km
              </span>
              <Link to="/app/trip/$rideId" params={{ rideId: t.id }} className="text-primary hover:underline">
                Details
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Used by other admin surfaces to link in
export { Link };

