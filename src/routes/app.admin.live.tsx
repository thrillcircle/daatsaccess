import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useUserRoles } from "@/hooks/use-auth";
import { AdminShell } from "@/components/AdminShell";
import { RideStatusBadge } from "@/components/RideStatusBadge";
import { LiveTripMap } from "@/components/LiveTripMap";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatZAR } from "@/lib/pricing";
import {
  Phone,
  Pencil,
  MapPin,
  Clock,
  Car,
  MessageSquare,
  Siren,
  StickyNote,
  UserPlus,
  Loader2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";

type Ride = Database["public"]["Tables"]["rides"]["Row"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type ChangeLog = Database["public"]["Tables"]["ride_change_log"]["Row"];
type LiveLoc = Database["public"]["Tables"]["ride_live_locations"]["Row"];
type DriverProfile = Database["public"]["Tables"]["driver_profiles"]["Row"];
type AdminNote = Database["public"]["Tables"]["admin_trip_notes"]["Row"];
type RideStatus = Database["public"]["Enums"]["ride_status"];

const ACTIVE: RideStatus[] = [
  "requested",
  "accepted",
  "driver_arriving",
  "arrived",
  "in_progress",
];

const STATUS_OPTIONS: RideStatus[] = [
  "requested",
  "accepted",
  "driver_arriving",
  "arrived",
  "in_progress",
  "completed",
  "cancelled",
];

export const Route = createFileRoute("/app/admin/live")({
  head: () => ({ meta: [{ title: "Live Operations — Admin" }] }),
  component: LivePage,
});

function fmtMins(s: number | null) {
  if (!s) return "—";
  const m = Math.round(s / 60);
  return `${m} min`;
}

function fmtAgo(iso: string | null | undefined) {
  if (!iso) return "—";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  return `${Math.round(diff / 3600)}h ago`;
}

function LivePage() {
  const { user } = useAuth();
  const { roles, loading: rolesLoading } = useUserRoles(user?.id);
  const isAdmin = !!roles?.includes("admin");

  const nav = useMemo(() => {
    const items = [];
    if (roles?.includes("passenger")) items.push({ to: "/app/passenger", label: "Ride", icon: NAV_ICONS.Passenger });
    if (roles?.includes("driver")) items.push({ to: "/app/driver", label: "Drive", icon: NAV_ICONS.Driver });
    items.push({ to: "/app/admin", label: "Admin", icon: NAV_ICONS.Admin });
    return items;
  }, [roles]);

  const [rides, setRides] = useState<Ride[]>([]);
  const [profilesById, setProfilesById] = useState<Record<string, Profile>>({});
  const [vehiclesById, setVehiclesById] = useState<Record<string, DriverProfile>>({});
  const [onlineDrivers, setOnlineDrivers] = useState<DriverProfile[]>([]);
  const [changesByRide, setChangesByRide] = useState<Record<string, ChangeLog>>({});
  const [locsByRide, setLocsByRide] = useState<Record<string, LiveLoc[]>>({});
  const [notesByRide, setNotesByRide] = useState<Record<string, AdminNote[]>>({});
  const [unassignedRequested, setUnassignedRequested] = useState<Ride[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;

    const load = async () => {
      const { data: ridesData } = await supabase
        .from("rides")
        .select("*")
        .in("status", ACTIVE)
        .order("created_at", { ascending: false });
      const rs = (ridesData ?? []) as Ride[];
      if (cancelled) return;
      setRides(rs);
      setUnassignedRequested(rs.filter((r) => !r.driver_id && r.status === "requested"));

      const userIds = Array.from(
        new Set(rs.flatMap((r) => [r.passenger_id, r.driver_id].filter(Boolean) as string[])),
      );
      const driverIds = Array.from(new Set(rs.map((r) => r.driver_id).filter((v): v is string => !!v)));
      const rideIds = rs.map((r) => r.id);

      const [profilesRes, vehiclesRes, onlineRes, changesRes, locsRes, notesRes] = await Promise.all([
        userIds.length
          ? supabase.from("profiles").select("*").in("user_id", userIds)
          : Promise.resolve({ data: [] as Profile[] }),
        driverIds.length
          ? supabase.from("driver_profiles").select("*").in("user_id", driverIds)
          : Promise.resolve({ data: [] as DriverProfile[] }),
        supabase.from("driver_profiles").select("*").eq("is_available", true),
        rideIds.length
          ? supabase
              .from("ride_change_log")
              .select("*")
              .in("ride_id", rideIds)
              .order("created_at", { ascending: false })
          : Promise.resolve({ data: [] as ChangeLog[] }),
        rideIds.length
          ? supabase.from("ride_live_locations").select("*").in("ride_id", rideIds)
          : Promise.resolve({ data: [] as LiveLoc[] }),
        rideIds.length
          ? supabase
              .from("admin_trip_notes")
              .select("*")
              .in("ride_id", rideIds)
              .order("created_at", { ascending: false })
          : Promise.resolve({ data: [] as AdminNote[] }),
      ]);
      if (cancelled) return;

      const pMap: Record<string, Profile> = {};
      for (const p of (profilesRes.data ?? []) as Profile[]) pMap[p.user_id] = p;
      setProfilesById(pMap);

      const vMap: Record<string, DriverProfile> = {};
      for (const v of (vehiclesRes.data ?? []) as DriverProfile[]) vMap[v.user_id] = v;
      setVehiclesById(vMap);

      setOnlineDrivers((onlineRes.data ?? []) as DriverProfile[]);

      const cMap: Record<string, ChangeLog> = {};
      for (const c of (changesRes.data ?? []) as ChangeLog[]) {
        if (!cMap[c.ride_id]) cMap[c.ride_id] = c;
      }
      setChangesByRide(cMap);

      const lMap: Record<string, LiveLoc[]> = {};
      for (const l of (locsRes.data ?? []) as LiveLoc[]) {
        (lMap[l.ride_id] ||= []).push(l);
      }
      setLocsByRide(lMap);

      const nMap: Record<string, AdminNote[]> = {};
      for (const n of (notesRes.data ?? []) as AdminNote[]) {
        (nMap[n.ride_id] ||= []).push(n);
      }
      setNotesByRide(nMap);
    };

    load();

    const ch = supabase
      .channel("admin-live-ops")
      .on("postgres_changes", { event: "*", schema: "public", table: "rides" }, () => load())
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ride_live_locations" },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const old = payload.old as LiveLoc;
            setLocsByRide((prev) => {
              const arr = (prev[old.ride_id] ?? []).filter((l) => l.id !== old.id);
              return { ...prev, [old.ride_id]: arr };
            });
            return;
          }
          const row = payload.new as LiveLoc;
          setLocsByRide((prev) => {
            const arr = prev[row.ride_id] ?? [];
            const idx = arr.findIndex((l) => l.user_id === row.user_id);
            const next = idx === -1 ? [...arr, row] : arr.map((l, i) => (i === idx ? row : l));
            return { ...prev, [row.ride_id]: next };
          });
        },
      )
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "ride_change_log" }, (payload) => {
        const row = payload.new as ChangeLog;
        setChangesByRide((prev) => ({ ...prev, [row.ride_id]: row }));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "admin_trip_notes" }, (payload) => {
        const row = payload.new as AdminNote;
        setNotesByRide((prev) => {
          const arr = prev[row.ride_id] ?? [];
          return { ...prev, [row.ride_id]: [row, ...arr] };
        });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "driver_profiles" }, () => load())
      .subscribe();

    const tick = setInterval(() => {
      setRides((prev) => prev.slice());
    }, 15000);

    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
      clearInterval(tick);
    };
  }, [isAdmin]);

  const selected = rides.find((r) => r.id === selectedId) ?? rides[0] ?? null;

  if (rolesLoading) {
    return (
      <AdminShell title="Live Operations">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </AdminShell>
    );
  }
  if (!isAdmin) {
    return (
      <AdminShell title="Live Operations">
        <div className="rounded-2xl border bg-card p-6 text-center">
          <h2 className="font-semibold">Admins only</h2>
        </div>
      </AdminShell>
    );
  }

  const selLocs = selected ? locsByRide[selected.id] ?? [] : [];
  const driverLoc = selLocs.find((l) => l.user_role === "driver");
  const paxLoc = selLocs.find((l) => l.user_role === "passenger");
  const onlineCount = onlineDrivers.length;

  return (
    <AdminShell title="Live Operations">
      <div className="mb-3 grid grid-cols-3 gap-2 text-center text-xs">
        <Stat label="Active trips" value={rides.length} />
        <Stat label="Drivers online" value={onlineCount} />
        <Stat label="Unassigned" value={unassignedRequested.length} />
      </div>

      <section className="mb-4">
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Live map {selected ? "· selected trip" : ""}
        </h3>
        {selected ? (
          <LiveTripMap
            pickup={{ lat: selected.pickup_lat, lng: selected.pickup_lng }}
            destination={{ lat: selected.destination_lat, lng: selected.destination_lng }}
            driver={driverLoc ? { lat: driverLoc.latitude, lng: driverLoc.longitude } : null}
            passenger={paxLoc ? { lat: paxLoc.latitude, lng: paxLoc.longitude } : null}
            phase={selected.status === "in_progress" ? "inProgress" : "beforePickup"}
            className="h-64"
          />
        ) : (
          <div className="grid h-40 place-items-center rounded-xl border bg-muted text-sm text-muted-foreground">
            No active rides.
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-2 flex items-center justify-between text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <span>Active rides ({rides.length})</span>
        </h3>
        <ul className="space-y-3">
          {rides.map((r) => {
            const pax = profilesById[r.passenger_id];
            const drv = r.driver_id ? profilesById[r.driver_id] : null;
            const veh = r.driver_id ? vehiclesById[r.driver_id] : null;
            const change = changesByRide[r.id];
            const locs = locsByRide[r.id] ?? [];
            const drvLoc = locs.find((l) => l.user_role === "driver");
            const notes = notesByRide[r.id] ?? [];
            const hasEmergency = notes.some((n) => n.is_emergency);
            const lastLoc = locs.reduce<string | null>(
              (acc, l) => (!acc || l.updated_at > acc ? l.updated_at : acc),
              null,
            );
            const isSelected = (selected?.id ?? null) === r.id;
            return (
              <li
                key={r.id}
                className={
                  "rounded-2xl border bg-card p-4 shadow-sm transition-colors " +
                  (hasEmergency ? "border-destructive ring-2 ring-destructive/40 " : "") +
                  (isSelected ? "ring-2 ring-primary" : "")
                }
              >
                <button
                  type="button"
                  onClick={() => setSelectedId(r.id)}
                  className="block w-full text-left"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <RideStatusBadge status={r.status} />
                        {change && (
                          <Badge variant="secondary" className="gap-1">
                            <Pencil className="h-3 w-3" /> v{r.route_version}
                          </Badge>
                        )}
                        {hasEmergency && (
                          <Badge variant="destructive" className="gap-1">
                            <Siren className="h-3 w-3" /> Emergency
                          </Badge>
                        )}
                      </div>
                      <p className="truncate text-sm font-medium">
                        <MapPin className="mr-1 inline h-3 w-3 text-success" />
                        {r.pickup_address}
                      </p>
                      <p className="truncate text-sm">
                        <MapPin className="mr-1 inline h-3 w-3 text-destructive" />
                        {r.destination_address}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold">{formatZAR(Number(r.estimated_price))}</p>
                      <p className="text-xs text-muted-foreground">
                        {Number(r.distance_km).toFixed(1)} km · ETA {fmtMins(r.estimated_duration_seconds)}
                      </p>
                    </div>
                  </div>
                </button>

                <div className="mt-3 grid grid-cols-2 gap-2 border-t pt-3 text-xs">
                  <PersonCell label="Passenger" name={pax?.full_name} phone={pax?.phone} />
                  <PersonCell label="Driver" name={drv?.full_name ?? "Unassigned"} phone={drv?.phone} />
                </div>

                {veh && (veh.vehicle_model || veh.license_plate) && (
                  <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                    <Car className="h-3 w-3" />
                    {[veh.vehicle_model, veh.vehicle_type, veh.license_plate].filter(Boolean).join(" · ")}
                  </p>
                )}

                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3 w-3" /> created {fmtAgo(r.created_at)}
                  </span>
                  {change && (
                    <span className="inline-flex items-center gap-1">
                      <Pencil className="h-3 w-3" /> edited {fmtAgo(change.created_at)}
                    </span>
                  )}
                  <span>last loc: {fmtAgo(lastLoc)}</span>
                  {drvLoc && (
                    <span className="font-mono">
                      driver @ {drvLoc.latitude.toFixed(3)}, {drvLoc.longitude.toFixed(3)}
                    </span>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  <ReassignDialog ride={r} onlineDrivers={onlineDrivers} vehiclesById={vehiclesById} profilesById={profilesById} />
                  <StatusDialog ride={r} />
                  <CancelButton ride={r} />
                  <NotesDialog ride={r} notes={notes} userId={user?.id ?? ""} />
                  {pax?.phone && (
                    <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                      <a href={`tel:${pax.phone}`}>
                        <Phone className="mr-1 h-3 w-3" /> Pax
                      </a>
                    </Button>
                  )}
                  {drv?.phone && (
                    <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                      <a href={`tel:${drv.phone}`}>
                        <Phone className="mr-1 h-3 w-3" /> Driver
                      </a>
                    </Button>
                  )}
                </div>

                {notes.length > 0 && (
                  <ul className="mt-2 space-y-1 border-t pt-2 text-[11px]">
                    {notes.slice(0, 3).map((n) => (
                      <li
                        key={n.id}
                        className={
                          "rounded px-2 py-1 " +
                          (n.is_emergency ? "bg-destructive/10 text-destructive" : "bg-secondary/50")
                        }
                      >
                        {n.is_emergency && <Siren className="mr-1 inline h-3 w-3" />}
                        <span className="font-medium">{fmtAgo(n.created_at)}:</span>{" "}
                        {n.note}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
          {!rides.length && (
            <li className="rounded-2xl border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
              No active rides right now.
            </li>
          )}
        </ul>
      </section>
    </AdminShell>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border bg-card px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}

function PersonCell({
  label,
  name,
  phone,
}: {
  label: string;
  name?: string | null;
  phone?: string | null;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="truncate font-medium">{name ?? "—"}</p>
      {phone ? (
        <a href={`tel:${phone}`} className="mt-0.5 inline-flex items-center gap-1 text-primary">
          <Phone className="h-3 w-3" /> {phone}
        </a>
      ) : (
        <span className="text-muted-foreground">No phone</span>
      )}
    </div>
  );
}

function ReassignDialog({
  ride,
  onlineDrivers,
  vehiclesById,
  profilesById,
}: {
  ride: Ride;
  onlineDrivers: DriverProfile[];
  vehiclesById: Record<string, DriverProfile>;
  profilesById: Record<string, Profile>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string>("");

  async function reassign() {
    if (!selected) return;
    setBusy(true);
    const { error } = await supabase
      .from("rides")
      .update({
        driver_id: selected,
        accepted_at: new Date().toISOString(),
        status: ride.status === "requested" ? "accepted" : ride.status,
      })
      .eq("id", ride.id);
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Driver reassigned");
      setOpen(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 text-xs">
          <UserPlus className="mr-1 h-3 w-3" /> Reassign
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Reassign driver</DialogTitle>
          <DialogDescription>Pick an online driver to take this trip over.</DialogDescription>
        </DialogHeader>
        {onlineDrivers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No drivers are online right now.</p>
        ) : (
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger className="text-xs">
              <SelectValue placeholder="Select an online driver" />
            </SelectTrigger>
            <SelectContent>
              {onlineDrivers
                .filter((d) => d.user_id !== ride.driver_id)
                .map((d) => {
                  const name = profilesById[d.user_id]?.full_name ?? d.user_id.slice(0, 8);
                  const veh = vehiclesById[d.user_id] ?? d;
                  const vehLabel = [veh.vehicle_model, veh.license_plate].filter(Boolean).join(" · ");
                  return (
                    <SelectItem key={d.user_id} value={d.user_id}>
                      {name}
                      {vehLabel ? ` — ${vehLabel}` : ""}
                    </SelectItem>
                  );
                })}
            </SelectContent>
          </Select>
        )}
        <DialogFooter>
          <Button size="sm" disabled={!selected || busy} onClick={reassign}>
            {busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}Reassign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatusDialog({ ride }: { ride: Ride }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [next, setNext] = useState<RideStatus>(ride.status);

  async function apply() {
    if (next === ride.status) return;
    setBusy(true);
    const patch: Partial<Ride> = { status: next };
    const nowIso = new Date().toISOString();
    if (next === "accepted" && !ride.accepted_at) patch.accepted_at = nowIso;
    if (next === "arrived" && !ride.driver_arrived_at) patch.driver_arrived_at = nowIso;
    if (next === "in_progress" && !ride.started_at) patch.started_at = nowIso;
    if (next === "completed" && !ride.completed_at) patch.completed_at = nowIso;
    const { error } = await supabase.from("rides").update(patch).eq("id", ride.id);
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Status updated");
      setOpen(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 text-xs">
          <Pencil className="mr-1 h-3 w-3" /> Status
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Update trip status</DialogTitle>
        </DialogHeader>
        <Select value={next} onValueChange={(v) => setNext(v as RideStatus)}>
          <SelectTrigger className="text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s} className="capitalize">
                {s.replace(/_/g, " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button size="sm" disabled={busy || next === ride.status} onClick={apply}>
            {busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CancelButton({ ride }: { ride: Ride }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="destructive"
      className="h-7 text-xs"
      disabled={busy}
      onClick={async () => {
        if (!confirm("Cancel this trip?")) return;
        setBusy(true);
        const { error } = await supabase
          .from("rides")
          .update({ status: "cancelled" })
          .eq("id", ride.id);
        setBusy(false);
        if (error) toast.error(error.message);
        else toast.success("Trip cancelled");
      }}
    >
      {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <XCircle className="mr-1 h-3 w-3" />}
      Cancel
    </Button>
  );
}

function NotesDialog({
  ride,
  notes,
  userId,
}: {
  ride: Ride;
  notes: AdminNote[];
  userId: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [emergency, setEmergency] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save() {
    const trimmed = text.trim();
    if (!trimmed || !userId) return;
    setBusy(true);
    const { error } = await supabase.from("admin_trip_notes").insert({
      ride_id: ride.id,
      admin_id: userId,
      note: trimmed,
      is_emergency: emergency,
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success(emergency ? "Emergency flagged" : "Note added");
      setText("");
      setEmergency(false);
    }
  }

  async function quickEmergency() {
    if (!userId) return;
    setBusy(true);
    const { error } = await supabase.from("admin_trip_notes").insert({
      ride_id: ride.id,
      admin_id: userId,
      note: "Emergency support requested",
      is_emergency: true,
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else toast.success("Emergency flagged");
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs border-destructive/40 text-destructive hover:bg-destructive/10"
        disabled={busy}
        onClick={quickEmergency}
        title="Mark emergency / support needed"
      >
        <Siren className="mr-1 h-3 w-3" /> Emergency
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button size="sm" variant="outline" className="h-7 text-xs">
            <StickyNote className="mr-1 h-3 w-3" /> Notes ({notes.length})
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Internal notes</DialogTitle>
            <DialogDescription>Visible only to admins. Audit log for this trip.</DialogDescription>
          </DialogHeader>
          <div className="max-h-60 space-y-1 overflow-y-auto text-xs">
            {notes.length === 0 && <p className="text-muted-foreground">No notes yet.</p>}
            {notes.map((n) => (
              <div
                key={n.id}
                className={
                  "rounded px-2 py-1 " +
                  (n.is_emergency ? "bg-destructive/10 text-destructive" : "bg-secondary/50")
                }
              >
                {n.is_emergency && <Siren className="mr-1 inline h-3 w-3" />}
                <span className="font-medium">{new Date(n.created_at).toLocaleString()}:</span>{" "}
                {n.note}
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Add note</Label>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="What happened? Who was contacted?"
              className="min-h-[80px] text-sm"
              maxLength={2000}
            />
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={emergency}
                onChange={(e) => setEmergency(e.target.checked)}
              />
              Mark as emergency / support needed
              <MessageSquare className="h-3 w-3 text-muted-foreground" />
            </label>
          </div>
          <DialogFooter>
            <Button size="sm" disabled={!text.trim() || busy} onClick={save}>
              {busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}Save note
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
