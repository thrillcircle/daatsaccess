import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useUserRoles } from "@/hooks/use-auth";
import { AppShell, NAV_ICONS } from "@/components/AppShell";
import { RideStatusBadge } from "@/components/RideStatusBadge";
import { Badge } from "@/components/ui/badge";
import { formatZAR } from "@/lib/pricing";
import { Pencil } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";

type Ride = Database["public"]["Tables"]["rides"]["Row"];
type RideChange = Database["public"]["Tables"]["ride_change_log"]["Row"];

export const Route = createFileRoute("/app/admin")({
  head: () => ({ meta: [{ title: "Admin — Access" }] }),
  component: AdminPage,
});

function AdminPage() {
  const { user } = useAuth();
  const { roles, loading: rolesLoading } = useUserRoles(user?.id);

  const nav = useMemo(() => {
    const items = [];
    if (roles?.includes("passenger")) items.push({ to: "/app/passenger", label: "Ride", icon: NAV_ICONS.Passenger });
    if (roles?.includes("driver")) items.push({ to: "/app/driver", label: "Drive", icon: NAV_ICONS.Driver });
    items.push({ to: "/app/admin", label: "Admin", icon: NAV_ICONS.Admin });
    return items;
  }, [roles]);

  const [metrics, setMetrics] = useState<{
    users: number;
    drivers: number;
    trips: number;
    completed: number;
    earnings: number;
  } | null>(null);
  const [rides, setRides] = useState<Ride[]>([]);
  const [edits, setEdits] = useState<RideChange[]>([]);
  const isAdmin = !!roles?.includes("admin");

  // Initial load + live Realtime: rides upserts and ride_change_log inserts
  // stream in without a refresh.
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      const [profiles, drivers, allRides, recentEdits] = await Promise.all([
        supabase.from("profiles").select("id", { count: "exact", head: true }),
        supabase.from("driver_profiles").select("id", { count: "exact", head: true }),
        supabase.from("rides").select("*").order("created_at", { ascending: false }).limit(50),
        supabase
          .from("ride_change_log")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(20),
      ]);
      if (cancelled) return;
      const all = (allRides.data ?? []) as Ride[];
      const completed = all.filter((r) => r.status === "completed");
      const earnings = completed.reduce((acc, r) => acc + Number(r.estimated_price), 0);
      setMetrics({
        users: profiles.count ?? 0,
        drivers: drivers.count ?? 0,
        trips: all.length,
        completed: completed.length,
        earnings,
      });
      setRides(all);
      setEdits((recentEdits.data ?? []) as RideChange[]);
    })();

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
          <p className="mt-1 text-sm text-muted-foreground">
            Your account doesn't have the admin role.
          </p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Admin" nav={nav}>
      <section className="grid grid-cols-2 gap-3">
        <Metric label="Users" value={metrics?.users ?? "—"} />
        <Metric label="Drivers" value={metrics?.drivers ?? "—"} />
        <Metric label="Total trips" value={metrics?.trips ?? "—"} />
        <Metric label="Completed" value={metrics?.completed ?? "—"} />
        <div className="col-span-2">
          <Metric
            label="Estimated earnings"
            value={metrics ? formatZAR(metrics.earnings) : "—"}
          />
        </div>
      </section>

      <section className="mt-6">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Recent rides
        </h3>
        <ul className="divide-y rounded-2xl border bg-card">
          {rides.map((r) => (
            <li key={r.id} className="px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.destination_address}</p>
                  <p className="truncate text-xs text-muted-foreground">{r.pickup_address}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold">{formatZAR(Number(r.estimated_price))}</p>
                  <RideStatusBadge status={r.status} />
                </div>
              </div>
            </li>
          ))}
          {!rides.length && (
            <li className="px-4 py-6 text-center text-sm text-muted-foreground">
              No rides yet.
            </li>
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
    </AppShell>
  );
}


function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)]">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}
