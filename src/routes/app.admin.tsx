import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useUserRoles } from "@/hooks/use-auth";
import { AppShell, NAV_ICONS } from "@/components/AppShell";
import { RideStatusBadge } from "@/components/RideStatusBadge";
import { formatZAR } from "@/lib/pricing";
import type { Database } from "@/integrations/supabase/types";

type Ride = Database["public"]["Tables"]["rides"]["Row"];

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
  const isAdmin = !!roles?.includes("admin");

  useEffect(() => {
    if (!isAdmin) return;
    (async () => {
      const [profiles, drivers, allRides] = await Promise.all([
        supabase.from("profiles").select("id", { count: "exact", head: true }),
        supabase.from("driver_profiles").select("id", { count: "exact", head: true }),
        supabase.from("rides").select("*").order("created_at", { ascending: false }).limit(50),
      ]);
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
    })();
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
