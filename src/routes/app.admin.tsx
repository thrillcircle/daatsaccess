import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useUserRoles } from "@/hooks/use-auth";
import { AdminShell } from "@/components/AdminShell";
import { NAV_ICONS } from "@/components/AppShell";
import { RideStatusBadge } from "@/components/RideStatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatZAR } from "@/lib/pricing";
import { Pencil, ArrowRight } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";

const ACTIVE_STATUSES = ["requested", "accepted", "driver_arriving", "arrived", "in_progress"] as const;

type OverviewFilter =
  | "all"
  | "requested"
  | "scheduled"
  | "active"
  | "completed"
  | "cancelled";

const VALID_OVERVIEW = new Set<OverviewFilter>([
  "all", "requested", "scheduled", "active", "completed", "cancelled",
]);

type OverviewSearch = { filter: OverviewFilter };

// Map overview filter -> Trips page status (when "View All" is clicked).
const TRIPS_STATUS_FOR: Record<OverviewFilter, string> = {
  all: "all",
  requested: "requested",
  scheduled: "scheduled",
  active: "all",
  completed: "completed",
  cancelled: "cancelled",
};


type Ride = Database["public"]["Tables"]["rides"]["Row"];
type RideChange = Database["public"]["Tables"]["ride_change_log"]["Row"];

export const Route = createFileRoute("/app/admin")({
  head: () => ({ meta: [{ title: "Admin — Access" }] }),
  validateSearch: (raw: Record<string, unknown>): OverviewSearch => {
    const f = typeof raw.filter === "string" && VALID_OVERVIEW.has(raw.filter as OverviewFilter)
      ? (raw.filter as OverviewFilter)
      : "all";
    return { filter: f };
  },
  component: AdminPage,
});

function AdminPage() {
  const { user } = useAuth();
  const { roles, loading: rolesLoading } = useUserRoles(user?.id);
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/app/admin" });
  const selected: OverviewFilter = search.filter as OverviewFilter;

  const nav = useMemo(() => {
    const items = [];
    if (roles?.includes("passenger")) items.push({ to: "/app/passenger", label: "Ride", icon: NAV_ICONS.Passenger });
    if (roles?.includes("driver")) items.push({ to: "/app/driver", label: "Drive", icon: NAV_ICONS.Driver });
    items.push({ to: "/app/admin", label: "Admin", icon: NAV_ICONS.Admin });
    return items;
  }, [roles]);

  const [metrics, setMetrics] = useState<{
    passengers: number;
    drivers: number;
    onlineDrivers: number;
    totalTrips: number;
    requested: number;
    active: number;
    scheduled: number;
    completed: number;
    cancelled: number;
    earnings: number;
    ratingAvg: number | null;
    ratingCount: number;
  } | null>(null);
  const [rides, setRides] = useState<Ride[]>([]);
  const [profilesById, setProfilesById] = useState<Record<string, { full_name: string | null; phone: string | null }>>({});
  const [edits, setEdits] = useState<RideChange[]>([]);
  const [loadingRides, setLoadingRides] = useState(true);
  const [ridesError, setRidesError] = useState<string | null>(null);
  const isAdmin = !!roles?.includes("admin");


  // Initial load + live Realtime: rides upserts and ride_change_log inserts
  // stream in without a refresh.
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    const loadMetrics = async () => {
      setLoadingRides(true);
      setRidesError(null);
      try {
        const [
          passengersRes,
          driversRes,
          onlineRes,
          totalTripsRes,
          requestedRes,
          activeRes,
          scheduledRes,
          completedRes,
          cancelledRes,
          allRides,
          recentEdits,
          ratingsRes,
        ] = await Promise.all([
          supabase.from("user_roles").select("user_id", { count: "exact", head: true }).eq("role", "passenger"),
          supabase.from("driver_profiles").select("id", { count: "exact", head: true }),
          supabase.from("driver_profiles").select("id", { count: "exact", head: true }).eq("is_available", true),
          supabase.from("rides").select("id", { count: "exact", head: true }),
          supabase.from("rides").select("id", { count: "exact", head: true }).eq("status", "requested"),
          supabase.from("rides").select("id", { count: "exact", head: true }).in("status", ACTIVE_STATUSES as unknown as ("requested" | "accepted" | "driver_arriving" | "arrived" | "in_progress")[]),
          supabase.from("rides").select("id", { count: "exact", head: true }).eq("request_type", "scheduled").in("status", ["requested", "accepted"]),
          supabase.from("rides").select("id", { count: "exact", head: true }).eq("status", "completed"),
          supabase.from("rides").select("id", { count: "exact", head: true }).eq("status", "cancelled"),
          supabase.from("rides").select("*").order("updated_at", { ascending: false, nullsFirst: false }).limit(50),
          supabase.from("ride_change_log").select("*").order("created_at", { ascending: false }).limit(20),
          supabase.from("ride_ratings").select("rating"),
        ]);
        if (cancelled) return;
        if (allRides.error) throw allRides.error;
        const all = (allRides.data ?? []) as Ride[];
        const completedRides = all.filter((r) => r.status === "completed");
        const earnings = completedRides.reduce((acc, r) => acc + Number(r.estimated_price ?? 0), 0);
        const ratings = (ratingsRes.data ?? []) as { rating: number }[];
        const ratingAvg = ratings.length
          ? ratings.reduce((a, r) => a + Number(r.rating), 0) / ratings.length
          : null;
        setMetrics({
          passengers: passengersRes.count ?? 0,
          drivers: driversRes.count ?? 0,
          onlineDrivers: onlineRes.count ?? 0,
          totalTrips: totalTripsRes.count ?? 0,
          requested: requestedRes.count ?? 0,
          active: activeRes.count ?? 0,
          scheduled: scheduledRes.count ?? 0,
          completed: completedRes.count ?? 0,
          cancelled: cancelledRes.count ?? 0,
          earnings,
          ratingAvg,
          ratingCount: ratings.length,
        });
        setRides(all);
        setEdits((recentEdits.data ?? []) as RideChange[]);

        const personIds = Array.from(
          new Set(
            all.flatMap((r) => [r.passenger_id, r.driver_id]).filter((v): v is string => !!v),
          ),
        );
        if (personIds.length) {
          const { data: profs } = await supabase
            .from("profiles")
            .select("user_id, full_name, phone")
            .in("user_id", personIds);
          if (!cancelled) {
            const m: Record<string, { full_name: string | null; phone: string | null }> = {};
            for (const p of profs ?? []) m[p.user_id] = { full_name: p.full_name, phone: p.phone };
            setProfilesById(m);
          }
        }
      } catch (e) {
        if (!cancelled) setRidesError(e instanceof Error ? e.message : "Failed to load metrics");
      } finally {
        if (!cancelled) setLoadingRides(false);
      }
    };

    loadMetrics();


    const ridesCh = supabase
      .channel("admin-rides")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rides" },
        (payload) => {
          setRides((prev) => {
            if (payload.eventType === "DELETE") {
              return prev.filter((r) => r.id !== (payload.old as Ride).id);
            }
            const row = payload.new as Ride;
            const idx = prev.findIndex((r) => r.id === row.id);
            if (idx === -1) return [row, ...prev].slice(0, 50);
            const copy = prev.slice();
            copy[idx] = row;
            return copy;
          });
        },
      )
      .subscribe();

    const editsCh = supabase
      .channel("admin-ride-edits")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "ride_change_log" },
        (payload) => {
          setEdits((prev) => [payload.new as RideChange, ...prev].slice(0, 20));
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(ridesCh);
      supabase.removeChannel(editsCh);
    };
  }, [isAdmin]);

  const filteredRides = useMemo(() => {
    const list = rides;
    switch (selected) {
      case "requested": return list.filter((r) => r.status === "requested");
      case "scheduled": return list.filter((r) => r.request_type === "scheduled" && (r.status === "requested" || r.status === "accepted"));
      case "active": return list.filter((r) => (ACTIVE_STATUSES as readonly string[]).includes(r.status));
      case "completed": return list.filter((r) => r.status === "completed");
      case "cancelled": return list.filter((r) => r.status === "cancelled");
      default: return list;
    }
  }, [rides, selected]);

  if (rolesLoading) {
    return (
      <AdminShell title="Overview">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </AdminShell>
    );
  }

  if (!isAdmin) {
    return (
      <AdminShell title="Overview">
        <div className="rounded-2xl border bg-card p-6 text-center">
          <h2 className="font-semibold">Admins only</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Your account doesn't have the admin role.
          </p>
        </div>
      </AdminShell>
    );
  }

  const recentTrips = filteredRides.slice(0, 6);
  const selectedLabel = ({
    all: "All trips",
    requested: "Requested",
    scheduled: "Scheduled",
    active: "Active",
    completed: "Completed",
    cancelled: "Cancelled",
  } as const)[selected];

  return (
    <AdminShell title="Overview">
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard
          label="Total trips" value={metrics?.totalTrips ?? "—"}
          active={selected === "all"}
          onClick={() => navigate({ search: { filter: "all" } })}
        />
        <MetricCard
          label="Requested" value={metrics?.requested ?? "—"}
          active={selected === "requested"}
          onClick={() => navigate({ search: { filter: "requested" } })}
        />
        <MetricCard
          label="Scheduled" value={metrics?.scheduled ?? "—"}
          active={selected === "scheduled"}
          onClick={() => navigate({ search: { filter: "scheduled" } })}
        />
        <MetricCard
          label="Active" value={metrics?.active ?? "—"}
          active={selected === "active"}
          onClick={() => navigate({ search: { filter: "active" } })}
        />
        <MetricCard
          label="Completed" value={metrics?.completed ?? "—"}
          active={selected === "completed"}
          onClick={() => navigate({ search: { filter: "completed" } })}
        />
        <MetricCard
          label="Cancelled" value={metrics?.cancelled ?? "—"}
          active={selected === "cancelled"}
          onClick={() => navigate({ search: { filter: "cancelled" } })}
        />
        <DriverMetricCard label="Drivers" value={metrics?.drivers ?? "—"} to="/app/admin/drivers" filterKey="all" />
        <DriverMetricCard label="Online drivers" value={metrics?.onlineDrivers ?? "—"} to="/app/admin/drivers" filterKey="online" />
        <div className="col-span-2 sm:col-span-4 grid grid-cols-2 gap-3 sm:grid-cols-2">
          <MetricCard
            label="Avg rating"
            value={metrics?.ratingAvg != null ? `${metrics.ratingAvg.toFixed(2)}★ (${metrics.ratingCount})` : "—"}
          />
          <MetricCard
            label="Estimated earnings (completed)"
            value={metrics ? formatZAR(metrics.earnings) : "—"}
          />
        </div>
      </section>

      <section className="mt-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Recent trips · <span className="text-foreground">{selectedLabel}</span>
          </h3>
          <div className="flex items-center gap-1.5">
            <Button asChild size="sm" variant="outline" className="h-7 text-xs">
              <Link to="/app/admin/trips" search={{ status: TRIPS_STATUS_FOR[selected], q: "" }}>
                View all <ArrowRight className="ml-1 h-3 w-3" />
              </Link>
            </Button>
            <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
              <Link to="/app/admin/trip-history" search={{ status: "all", q: "", from: "", to: "" }}>
                Trip History
              </Link>
            </Button>
          </div>

        </div>
        <ul className="divide-y rounded-2xl border bg-card">
          {ridesError ? (
            <li className="px-4 py-6 text-center text-sm text-destructive">{ridesError}</li>
          ) : loadingRides && !rides.length ? (
            <li className="px-4 py-6 text-center text-sm text-muted-foreground">Loading recent trips…</li>
          ) : !recentTrips.length ? (
            <li className="px-4 py-6 text-center text-sm text-muted-foreground">
              No trips match this filter.
            </li>
          ) : (
            recentTrips.map((r) => {
              const pax = profilesById[r.passenger_id];
              const drv = r.driver_id ? profilesById[r.driver_id] : null;
              const updated = r.updated_at ?? r.created_at;
              return (
                <li key={r.id} className="px-4 py-3">
                  <Link to="/app/trip/$rideId" params={{ rideId: r.id }} className="block">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <p className="truncate text-sm font-medium">{r.destination_address}</p>
                        <p className="truncate text-xs text-muted-foreground">From {r.pickup_address}</p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          Passenger: {pax?.full_name ?? "—"} · Driver: {drv?.full_name ?? (r.driver_id ? "Assigned" : "Unassigned")}
                        </p>
                        {r.scheduled_at && (
                          <p className="text-[11px] text-muted-foreground">
                            Scheduled {new Date(r.scheduled_at).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", dateStyle: "short", timeStyle: "short" })}
                          </p>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-semibold">{formatZAR(Number(r.estimated_price))}</p>
                        <RideStatusBadge status={r.status} />
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          Updated {new Date(updated).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })
          )}
        </ul>
      </section>

      <section className="mt-6">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <Pencil className="h-3.5 w-3.5" /> Live trip edits
        </h3>
        <ul className="divide-y rounded-2xl border bg-card">
          {edits.map((c) => {
            const next = (c.new_values ?? {}) as Record<string, unknown>;
            const ackd = !!c.acknowledged_by_driver_at;
            return (
              <li key={c.id} className="space-y-1 px-4 py-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium capitalize">
                    {c.change_type.replaceAll("_", " ")}
                  </span>
                  <Badge variant={ackd ? "outline" : "secondary"}>
                    {ackd ? "Acknowledged" : "Pending driver ack"}
                  </Badge>
                </div>
                {"pickup_address" in next && (
                  <p className="truncate text-xs text-muted-foreground">
                    Pickup → {String(next.pickup_address)}
                  </p>
                )}
                {"destination_address" in next && (
                  <p className="truncate text-xs text-muted-foreground">
                    Destination → {String(next.destination_address)}
                  </p>
                )}
                <p className="text-[11px] text-muted-foreground">
                  v{c.route_version} · {new Date(c.created_at).toLocaleString()}
                </p>
              </li>
            );
          })}
          {!edits.length && (
            <li className="px-4 py-6 text-center text-sm text-muted-foreground">
              No trip edits yet.
            </li>
          )}
        </ul>
      </section>
    </AdminShell>
  );
}


function MetricCard({
  label, value, active, onClick,
}: {
  label: string;
  value: string | number;
  active?: boolean;
  onClick?: () => void;
}) {
  const base =
    "rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)] text-left transition-colors";
  const clickable = onClick
    ? " cursor-pointer hover:bg-accent/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    : "";
  const activeCls = active ? " ring-2 ring-primary" : "";
  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-pressed={!!active} className={base + clickable + activeCls}>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold">{value}</p>
      </button>
    );
  }
  return (
    <div className={base + activeCls}>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function DriverMetricCard({
  label, value, to, filterKey,
}: {
  label: string; value: string | number; to: "/app/admin/drivers"; filterKey: string;
}) {
  return (
    <Link
      to={to}
      search={{ status: filterKey, q: "" }}
      className="rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)] cursor-pointer transition-colors hover:bg-accent/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </Link>
  );
}

