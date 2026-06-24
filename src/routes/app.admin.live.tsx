import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useUserRoles } from "@/hooks/use-auth";
import { AppShell, NAV_ICONS } from "@/components/AppShell";
import { AdminTabs } from "@/components/AdminTabs";
import { RideStatusBadge } from "@/components/RideStatusBadge";
import { LiveTripMap } from "@/components/LiveTripMap";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatZAR } from "@/lib/pricing";
import { Phone, Pencil, MapPin, Clock } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";

type Ride = Database["public"]["Tables"]["rides"]["Row"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type ChangeLog = Database["public"]["Tables"]["ride_change_log"]["Row"];
type LiveLoc = Database["public"]["Tables"]["ride_live_locations"]["Row"];

const ACTIVE: Database["public"]["Enums"]["ride_status"][] = [
  "requested",
  "accepted",
  "driver_arriving",
  "arrived",
  "in_progress",
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
  const [changesByRide, setChangesByRide] = useState<Record<string, ChangeLog>>({});
  const [locsByRide, setLocsByRide] = useState<Record<string, LiveLoc[]>>({});
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

      const userIds = Array.from(
        new Set(rs.flatMap((r) => [r.passenger_id, r.driver_id].filter(Boolean) as string[])),
      );
      const rideIds = rs.map((r) => r.id);

      const [profilesRes, changesRes, locsRes] = await Promise.all([
        userIds.length
          ? supabase.from("profiles").select("*").in("user_id", userIds)
          : Promise.resolve({ data: [] as Profile[] }),
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
      ]);
      if (cancelled) return;

      const pMap: Record<string, Profile> = {};
      for (const p of (profilesRes.data ?? []) as Profile[]) pMap[p.user_id] = p;
      setProfilesById(pMap);

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
    };

    load();

    const ch = supabase
      .channel("admin-live-ops")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rides" },
        () => load(),
      )
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
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "ride_change_log" },
        (payload) => {
          const row = payload.new as ChangeLog;
          setChangesByRide((prev) => ({ ...prev, [row.ride_id]: row }));
        },
      )
      .subscribe();

    const tick = setInterval(() => {
      // re-render to refresh "x s ago" labels
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
      <AppShell title="Admin" nav={nav}>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </AppShell>
    );
  }
  if (!isAdmin) {
    return (
      <AppShell title="Admin" nav={nav}>
        <div className="rounded-2xl border bg-card p-6 text-center">
          <h2 className="font-semibold">Admins only</h2>
        </div>
      </AppShell>
    );
  }

  const selLocs = selected ? locsByRide[selected.id] ?? [] : [];
  const driverLoc = selLocs.find((l) => l.user_role === "driver");
  const paxLoc = selLocs.find((l) => l.user_role === "passenger");

  return (
    <AppShell title="Admin" nav={nav}>
      <AdminTabs />

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
            const change = changesByRide[r.id];
            const locs = locsByRide[r.id] ?? [];
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
                      <div className="flex items-center gap-2">
                        <RideStatusBadge status={r.status} />
                        {change && (
                          <Badge variant="secondary" className="gap-1">
                            <Pencil className="h-3 w-3" /> v{r.route_version}
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
                        {Number(r.distance_km).toFixed(1)} km · {fmtMins(r.estimated_duration_seconds)}
                      </p>
                    </div>
                  </div>
                </button>

                <div className="mt-3 grid grid-cols-2 gap-2 border-t pt-3 text-xs">
                  <PersonCell label="Passenger" name={pax?.full_name} phone={pax?.phone} />
                  <PersonCell
                    label="Driver"
                    name={drv?.full_name ?? "Unassigned"}
                    phone={drv?.phone}
                  />
                </div>

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
                </div>
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
    </AppShell>
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
        <a
          href={`tel:${phone}`}
          className="mt-0.5 inline-flex items-center gap-1 text-primary"
        >
          <Phone className="h-3 w-3" /> {phone}
        </a>
      ) : (
        <span className="text-muted-foreground">No phone</span>
      )}
    </div>
  );
}

// keep Button import used (silence tree-shake noise on routes)
void Button;
