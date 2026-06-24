import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useUserRoles } from "@/hooks/use-auth";
import { AppShell, NAV_ICONS } from "@/components/AppShell";
import { AdminTabs } from "@/components/AdminTabs";
import { RideStatusBadge } from "@/components/RideStatusBadge";
import { Badge } from "@/components/ui/badge";
import { Phone, Car } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";

type DriverProfile = Database["public"]["Tables"]["driver_profiles"]["Row"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Ride = Database["public"]["Tables"]["rides"]["Row"];

const ACTIVE: Database["public"]["Enums"]["ride_status"][] = [
  "requested",
  "accepted",
  "driver_arriving",
  "arrived",
  "in_progress",
];

const LIVE_THRESHOLD_MS = 90 * 1000; // location considered live if updated within 90s

export const Route = createFileRoute("/app/admin/drivers")({
  head: () => ({ meta: [{ title: "Drivers — Admin" }] }),
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

  const nav = useMemo(() => {
    const items = [];
    if (roles?.includes("passenger")) items.push({ to: "/app/passenger", label: "Ride", icon: NAV_ICONS.Passenger });
    if (roles?.includes("driver")) items.push({ to: "/app/driver", label: "Drive", icon: NAV_ICONS.Driver });
    items.push({ to: "/app/admin", label: "Admin", icon: NAV_ICONS.Admin });
    return items;
  }, [roles]);

  const [drivers, setDrivers] = useState<DriverProfile[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [activeRides, setActiveRides] = useState<Record<string, Ride>>({});

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;

    const load = async () => {
      const { data: drv } = await supabase
        .from("driver_profiles")
        .select("*")
        .order("location_updated_at", { ascending: false, nullsFirst: false });
      const ds = (drv ?? []) as DriverProfile[];
      if (cancelled) return;
      setDrivers(ds);

      const userIds = ds.map((d) => d.user_id);
      const [profRes, ridesRes] = await Promise.all([
        userIds.length
          ? supabase.from("profiles").select("*").in("user_id", userIds)
          : Promise.resolve({ data: [] as Profile[] }),
        userIds.length
          ? supabase
              .from("rides")
              .select("*")
              .in("driver_id", userIds)
              .in("status", ACTIVE)
          : Promise.resolve({ data: [] as Ride[] }),
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
            if (idx === -1) return [row, ...prev];
            const copy = prev.slice();
            copy[idx] = row;
            return copy;
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rides" },
        () => load(),
      )
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

  const now = Date.now();

  return (
    <AppShell title="Admin" nav={nav}>
      <AdminTabs />

      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Drivers ({drivers.length})
      </h3>

      <ul className="space-y-3">
        {drivers.map((d) => {
          const prof = profiles[d.user_id];
          const ride = activeRides[d.user_id];
          const updatedTs = d.location_updated_at
            ? new Date(d.location_updated_at).getTime()
            : 0;
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
                    {hasLoc
                      ? `${d.current_lat!.toFixed(4)}, ${d.current_lng!.toFixed(4)}`
                      : "—"}
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
            </li>
          );
        })}
        {!drivers.length && (
          <li className="rounded-2xl border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
            No drivers registered yet.
          </li>
        )}
      </ul>
    </AppShell>
  );
}
