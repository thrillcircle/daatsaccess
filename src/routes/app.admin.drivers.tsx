import { createFileRoute, Link, useNavigate, type SearchSchemaInput } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useUserRoles } from "@/hooks/use-auth";
import { AdminShell } from "@/components/AdminShell";
import { NAV_ICONS } from "@/components/AppShell";
import { RideStatusBadge } from "@/components/RideStatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  Phone,
  Car,
  Search,
  MessageSquare,
  History,
  UserPlus,
  UserMinus,
  Power,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";

type DriverProfile = Database["public"]["Tables"]["driver_profiles"]["Row"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Ride = Database["public"]["Tables"]["rides"]["Row"];

type DriverStats = {
  completed: number;
  cancelled: number;
  upcoming: number;
  totalKm: number;
};

const ACTIVE: Database["public"]["Enums"]["ride_status"][] = [
  "requested",
  "accepted",
  "driver_arriving",
  "arrived",
  "in_progress",
];

const LIVE_THRESHOLD_MS = 90 * 1000; // location considered live if updated within 90s

type DriverFilter =
  "all" | "online" | "offline" | "assigned" | "available" | "stale" | "incomplete";

const DRIVER_FILTERS: { key: DriverFilter; label: string }[] = [
  { key: "all", label: "All drivers" },
  { key: "online", label: "Online" },
  { key: "offline", label: "Offline" },
  { key: "assigned", label: "Assigned to trip" },
  { key: "available", label: "Available" },
  { key: "stale", label: "Stale location" },
  { key: "incomplete", label: "Profile incomplete" },
];
const VALID_DRIVER_FILTERS = new Set<DriverFilter>(DRIVER_FILTERS.map((f) => f.key));

type DriversSearch = { status: DriverFilter; q: string };

export const Route = createFileRoute("/app/admin/drivers")({
  head: () => ({ meta: [{ title: "Drivers — Admin" }] }),
  validateSearch: (raw: Record<string, unknown> & SearchSchemaInput): DriversSearch => ({
    status:
      typeof raw.status === "string" && VALID_DRIVER_FILTERS.has(raw.status as DriverFilter)
        ? (raw.status as DriverFilter)
        : "all",
    q: typeof raw.q === "string" ? raw.q : "",
  }),
  component: DriversPage,
});

function fmtAgo(iso: string | null | undefined) {
  if (!iso) return "never";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}

function DriversPage() {
  const { user } = useAuth();
  const { roles, loading: rolesLoading } = useUserRoles(user?.id);
  const isAdmin = !!roles?.includes("admin");
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/app/admin/drivers" });

  const nav = useMemo(() => {
    const items = [];
    if (roles?.includes("passenger"))
      items.push({ to: "/app/passenger", label: "Ride", icon: NAV_ICONS.Passenger });
    if (roles?.includes("driver"))
      items.push({ to: "/app/driver", label: "Drive", icon: NAV_ICONS.Driver });
    items.push({ to: "/app/admin", label: "Admin", icon: NAV_ICONS.Admin });
    return items;
  }, [roles]);

  const activeFilter = search.status;
  const [drivers, setDrivers] = useState<DriverProfile[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [activeRides, setActiveRides] = useState<Record<string, Ride>>({});
  const [stats, setStats] = useState<Record<string, DriverStats>>({});
  const [unassignedRides, setUnassignedRides] = useState<Ride[]>([]);
  const [queryInput, setQueryInput] = useState(search.q);

  useEffect(() => setQueryInput(search.q), [search.q]);
  useEffect(() => {
    const t = setTimeout(() => {
      const trimmed = queryInput.trim();
      if (trimmed !== search.q) {
        navigate({ search: (p: DriversSearch) => ({ ...p, q: trimmed }), replace: true });
      }
    }, 250);
    return () => clearTimeout(t);
  }, [queryInput, navigate, search.q]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;

    const load = async () => {
      const { data: driverRoles } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "driver");
      const driverRoleIds = (driverRoles ?? []).map((r) => r.user_id);
      if (cancelled) return;
      if (!driverRoleIds.length) {
        setDrivers([]);
        setProfiles({});
        setActiveRides({});
        setStats({});
        setUnassignedRides([]);
        return;
      }
      const { data: drv } = await supabase
        .from("driver_profiles")
        .select("*")
        .in("user_id", driverRoleIds)
        .order("location_updated_at", { ascending: false, nullsFirst: false });
      const ds = (drv ?? []) as DriverProfile[];
      if (cancelled) return;
      setDrivers(ds);

      const userIds = ds.map((d) => d.user_id);
      const [profRes, ridesRes, allRidesRes, unassignedRes] = await Promise.all([
        userIds.length
          ? supabase.from("profiles").select("*").in("user_id", userIds)
          : Promise.resolve({ data: [] as Profile[] }),
        userIds.length
          ? supabase.from("rides").select("*").in("driver_id", userIds).in("status", ACTIVE)
          : Promise.resolve({ data: [] as Ride[] }),
        userIds.length
          ? supabase
              .from("rides")
              .select(
                "driver_id, status, distance_km, actual_distance_km, scheduled_at, request_type",
              )
              .in("driver_id", userIds)
          : Promise.resolve({
              data: [] as Pick<
                Ride,
                | "driver_id"
                | "status"
                | "distance_km"
                | "actual_distance_km"
                | "scheduled_at"
                | "request_type"
              >[],
            }),
        supabase
          .from("rides")
          .select("*")
          .is("driver_id", null)
          .eq("status", "requested")
          .order("created_at", { ascending: false })
          .limit(50),
      ]);
      if (cancelled) return;

      const pMap: Record<string, Profile> = {};
      for (const p of (profRes.data ?? []) as Profile[]) pMap[p.user_id] = p;
      setProfiles(pMap);

      const rMap: Record<string, Ride> = {};
      for (const r of (ridesRes.data ?? []) as Ride[]) {
        if (r.driver_id) rMap[r.driver_id] = r;
      }
      setActiveRides(rMap);

      const sMap: Record<string, DriverStats> = {};
      for (const uid of userIds)
        sMap[uid] = { completed: 0, cancelled: 0, upcoming: 0, totalKm: 0 };
      const nowTs = Date.now();
      for (const row of (allRidesRes.data ?? []) as Array<
        Pick<
          Ride,
          | "driver_id"
          | "status"
          | "distance_km"
          | "actual_distance_km"
          | "scheduled_at"
          | "request_type"
        >
      >) {
        if (!row.driver_id) continue;
        const s = sMap[row.driver_id];
        if (!s) continue;
        if (row.status === "completed") {
          s.completed += 1;
          s.totalKm += Number(row.actual_distance_km ?? row.distance_km ?? 0);
        } else if (row.status === "cancelled") {
          s.cancelled += 1;
        }
        if (
          row.request_type === "scheduled" &&
          row.scheduled_at &&
          new Date(row.scheduled_at).getTime() > nowTs &&
          (row.status === "requested" || row.status === "accepted")
        ) {
          s.upcoming += 1;
        }
      }
      setStats(sMap);

      setUnassignedRides((unassignedRes.data ?? []) as Ride[]);
    };

    load();

    const ch = supabase
      .channel("admin-drivers")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "driver_profiles" },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const old = payload.old as DriverProfile;
            setDrivers((prev) => prev.filter((d) => d.id !== old.id));
            return;
          }
          const row = payload.new as DriverProfile;
          setDrivers((prev) => {
            const idx = prev.findIndex((d) => d.id === row.id);
            // Only merge updates for users already known to have the driver role.
            if (idx === -1) return prev;
            const copy = prev.slice();
            copy[idx] = row;
            return copy;
          });
        },
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "rides" }, () => load())
      .subscribe();

    const tick = setInterval(() => setDrivers((prev) => prev.slice()), 15000);

    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
      clearInterval(tick);
    };
  }, [isAdmin]);

  if (rolesLoading) {
    return (
      <AdminShell title="Drivers">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </AdminShell>
    );
  }
  if (!isAdmin) {
    return (
      <AdminShell title="Drivers">
        <div className="rounded-2xl border bg-card p-6 text-center">
          <h2 className="font-semibold">Admins only</h2>
        </div>
      </AdminShell>
    );
  }

  const now = Date.now();
  const q = queryInput.trim().toLowerCase();

  const matchSearch = (d: DriverProfile) => {
    if (!q) return true;
    const p = profiles[d.user_id];
    return (
      (p?.full_name?.toLowerCase().includes(q) ?? false) ||
      (p?.phone?.toLowerCase().includes(q) ?? false) ||
      (d.license_plate?.toLowerCase().includes(q) ?? false) ||
      d.user_id.toLowerCase().includes(q)
    );
  };

  const matchFilter = (d: DriverProfile) => {
    const updatedTs = d.location_updated_at ? new Date(d.location_updated_at).getTime() : 0;
    const isLiveLoc = updatedTs && now - updatedTs < LIVE_THRESHOLD_MS;
    const onTrip = !!activeRides[d.user_id];
    const profileComplete =
      !!d.vehicle_type &&
      !!d.vehicle_model &&
      !!d.license_plate &&
      !!profiles[d.user_id]?.full_name &&
      !!profiles[d.user_id]?.phone;
    switch (activeFilter) {
      case "online":
        return !!d.is_available;
      case "offline":
        return !d.is_available;
      case "assigned":
        return onTrip;
      case "available":
        return !!d.is_available && !onTrip;
      case "stale":
        return !!d.is_available && !isLiveLoc;
      case "incomplete":
        return !profileComplete;
      default:
        return true;
    }
  };

  const filteredDrivers = drivers.filter((d) => matchSearch(d) && matchFilter(d));

  const filtersApplied = activeFilter !== "all" || !!q;

  return (
    <AdminShell title="Drivers">
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={queryInput}
          onChange={(e) => setQueryInput(e.target.value)}
          placeholder="Search by name, phone, licence plate, or user ID…"
          className="pl-9"
        />
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {DRIVER_FILTERS.map((f) => (
          <Button
            key={f.key}
            size="sm"
            variant={activeFilter === f.key ? "default" : "outline"}
            className="h-8 text-xs"
            onClick={() => navigate({ search: (p: DriversSearch) => ({ ...p, status: f.key }) })}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {filtersApplied && (
        <div className="mb-3 flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            {filteredDrivers.length} of {drivers.length} drivers ·{" "}
            {DRIVER_FILTERS.find((f) => f.key === activeFilter)?.label}
            {q && (
              <>
                {" "}
                matching "<span className="text-foreground">{q}</span>"
              </>
            )}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => {
              setQueryInput("");
              navigate({ search: { status: "all", q: "" } });
            }}
          >
            Clear filters
          </Button>
        </div>
      )}

      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Drivers ({filteredDrivers.length}/{drivers.length})
      </h3>

      <ul className="space-y-3">
        {filteredDrivers.map((d) => {
          const prof = profiles[d.user_id];
          const ride = activeRides[d.user_id];
          const driverStats = stats[d.user_id] ?? {
            completed: 0,
            cancelled: 0,
            upcoming: 0,
            totalKm: 0,
          };
          const updatedTs = d.location_updated_at ? new Date(d.location_updated_at).getTime() : 0;
          const isLive = d.is_available && updatedTs && now - updatedTs < LIVE_THRESHOLD_MS;
          const hasLoc = d.current_lat != null && d.current_lng != null;
          return (
            <li key={d.id} className="rounded-2xl border bg-card p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{prof?.full_name ?? "Unknown driver"}</p>
                  {prof?.phone ? (
                    <a
                      href={`tel:${prof.phone}`}
                      className="inline-flex items-center gap-1 text-xs text-primary"
                    >
                      <Phone className="h-3 w-3" /> {prof.phone}
                    </a>
                  ) : (
                    <p className="text-xs text-muted-foreground">No phone</p>
                  )}
                </div>
                <Badge variant={isLive ? "default" : "secondary"}>
                  {isLive ? "Online · Live" : d.is_available ? "Online · Stale" : "Offline"}
                </Badge>
              </div>

              <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                <Car className="h-3.5 w-3.5" />
                <span>
                  {d.vehicle_model ?? "Vehicle —"}
                  {d.vehicle_type ? ` · ${d.vehicle_type}` : ""}
                  {d.license_plate ? ` · ${d.license_plate}` : ""}
                </span>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-2 border-t pt-2 text-[11px]">
                <div>
                  <p className="uppercase tracking-wide text-muted-foreground">
                    {isLive ? "Live location" : "Last-known location"}
                  </p>
                  <p className="font-mono">
                    {hasLoc ? `${d.current_lat!.toFixed(4)}, ${d.current_lng!.toFixed(4)}` : "—"}
                  </p>
                  <p className="text-muted-foreground">updated {fmtAgo(d.location_updated_at)}</p>
                </div>
                <div>
                  <p className="uppercase tracking-wide text-muted-foreground">Current trip</p>
                  {ride ? (
                    <>
                      <p className="truncate font-medium">{ride.destination_address}</p>
                      <div className="mt-0.5">
                        <RideStatusBadge status={ride.status} />
                      </div>
                    </>
                  ) : (
                    <p className="text-muted-foreground">Idle</p>
                  )}
                </div>
              </div>

              <div className="mt-2 grid grid-cols-4 gap-1 border-t pt-2 text-center text-[11px]">
                <StatCell label="Completed" value={driverStats.completed.toString()} />
                <StatCell label="Cancelled" value={driverStats.cancelled.toString()} />
                <StatCell label="Upcoming" value={driverStats.upcoming.toString()} />
                <StatCell label="Total km" value={driverStats.totalKm.toFixed(0)} />
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                <ToggleAvailableButton driver={d} />
                <AssignTripDialog
                  driver={d}
                  driverName={prof?.full_name ?? null}
                  unassignedRides={unassignedRides}
                />
                {ride && <UnassignButton ride={ride} />}
                <TripHistoryDialog driverId={d.user_id} driverName={prof?.full_name ?? null} />
                {prof?.phone && (
                  <>
                    <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                      <a href={`tel:${prof.phone}`}>
                        <Phone className="mr-1 h-3 w-3" /> Call
                      </a>
                    </Button>
                    <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                      <a href={`sms:${prof.phone}`}>
                        <MessageSquare className="mr-1 h-3 w-3" /> SMS
                      </a>
                    </Button>
                  </>
                )}
                {ride && (
                  <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
                    <Link to="/app/trip/$rideId" params={{ rideId: ride.id }}>
                      <ExternalLink className="mr-1 h-3 w-3" /> View trip
                    </Link>
                  </Button>
                )}
              </div>
            </li>
          );
        })}
        {!filteredDrivers.length && (
          <li className="rounded-2xl border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
            {drivers.length ? "No drivers match your search." : "No drivers registered yet."}
          </li>
        )}
      </ul>
    </AdminShell>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-xs font-semibold">{value}</p>
    </div>
  );
}

function ToggleAvailableButton({ driver }: { driver: DriverProfile }) {
  const [busy, setBusy] = useState(false);
  const next = !driver.is_available;
  return (
    <Button
      size="sm"
      variant={driver.is_available ? "secondary" : "default"}
      className="h-7 text-xs"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const { error } = await supabase
          .from("driver_profiles")
          .update({ is_available: next })
          .eq("user_id", driver.user_id);
        setBusy(false);
        if (error) toast.error(error.message);
        else toast.success(`Marked ${next ? "available" : "unavailable"}`);
      }}
    >
      {busy ? (
        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
      ) : (
        <Power className="mr-1 h-3 w-3" />
      )}
      {driver.is_available ? "Set unavailable" : "Set available"}
    </Button>
  );
}

function AssignTripDialog({
  driver,
  driverName,
  unassignedRides,
}: {
  driver: DriverProfile;
  driverName: string | null;
  unassignedRides: Ride[];
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string>("");
  const [busy, setBusy] = useState(false);

  async function assign() {
    if (!selected) return;
    setBusy(true);
    const { error } = await supabase
      .from("rides")
      .update({
        driver_id: driver.user_id,
        status: "accepted",
        accepted_at: new Date().toISOString(),
      })
      .eq("id", selected);
    setBusy(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Driver assigned");
      setOpen(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 text-xs">
          <UserPlus className="mr-1 h-3 w-3" /> Assign trip
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Assign trip to {driverName ?? "driver"}</DialogTitle>
          <DialogDescription>
            Pick an unassigned trip request to assign to this driver.
          </DialogDescription>
        </DialogHeader>
        {unassignedRides.length === 0 ? (
          <p className="text-sm text-muted-foreground">No unassigned trip requests right now.</p>
        ) : (
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger className="text-xs">
              <SelectValue placeholder="Select a trip" />
            </SelectTrigger>
            <SelectContent>
              {unassignedRides.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.pickup_address.slice(0, 30)} → {r.destination_address.slice(0, 30)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <DialogFooter>
          <Button size="sm" disabled={!selected || busy} onClick={assign}>
            {busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}Assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UnassignButton({ ride }: { ride: Ride }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      className="h-7 text-xs"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const { error } = await supabase
          .from("rides")
          .update({ driver_id: null, status: "requested", accepted_at: null })
          .eq("id", ride.id);
        setBusy(false);
        if (error) toast.error(error.message);
        else toast.success("Driver unassigned");
      }}
    >
      {busy ? (
        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
      ) : (
        <UserMinus className="mr-1 h-3 w-3" />
      )}
      Unassign current
    </Button>
  );
}

function TripHistoryDialog({
  driverId,
  driverName,
}: {
  driverId: string;
  driverName: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    (async () => {
      const { data } = await supabase
        .from("rides")
        .select("*")
        .eq("driver_id", driverId)
        .order("created_at", { ascending: false })
        .limit(50);
      setHistory((data ?? []) as Ride[]);
      setLoading(false);
    })();
  }, [open, driverId]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 text-xs">
          <History className="mr-1 h-3 w-3" /> History
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Trip history — {driverName ?? "driver"}</DialogTitle>
          <DialogDescription>Last 50 trips assigned to this driver.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto">
          {loading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : !history.length ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No trips yet.</p>
          ) : (
            <ul className="divide-y">
              {history.map((r) => (
                <li key={r.id} className="py-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{r.destination_address}</span>
                    <RideStatusBadge status={r.status} />
                  </div>
                  <p className="truncate text-muted-foreground">From {r.pickup_address}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {new Date(r.created_at).toLocaleString(undefined, {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                    {" · "}
                    {Number(r.actual_distance_km ?? r.distance_km ?? 0).toFixed(1)} km
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
