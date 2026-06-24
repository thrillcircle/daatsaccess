import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useUserRoles } from "@/hooks/use-auth";
import { AppShell, NAV_ICONS } from "@/components/AppShell";
import { AdminTabs } from "@/components/AdminTabs";
import { RideStatusBadge } from "@/components/RideStatusBadge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatZAR } from "@/lib/pricing";
import { Search, ExternalLink, Car } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";

type Ride = Database["public"]["Tables"]["rides"]["Row"];
type PaymentStatus = Database["public"]["Enums"]["payment_status"];
type Profile = { user_id: string; full_name: string | null; phone: string | null };
type Vehicle = { user_id: string; vehicle_model: string | null; license_plate: string | null };
type PaymentRow = { ride_id: string; status: PaymentStatus; amount: number };

type HistoryFilter = "all" | "scheduled" | "active" | "completed" | "cancelled";
const FILTERS: { key: HistoryFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "scheduled", label: "Scheduled" },
  { key: "active", label: "Active" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
];
const VALID = new Set<HistoryFilter>(FILTERS.map((f) => f.key));
const ACTIVE_STATUSES = ["requested", "accepted", "driver_arriving", "arrived", "in_progress"] as const;
const PAGE_SIZE = 20;
const RECENT_SKIP = 6;

type HistorySearch = { status: HistoryFilter; q: string; from: string; to: string };

export const Route = createFileRoute("/app/admin/trip-history")({
  head: () => ({ meta: [{ title: "Trip History — Admin" }] }),
  validateSearch: (raw: Record<string, unknown>): HistorySearch => ({
    status: typeof raw.status === "string" && VALID.has(raw.status as HistoryFilter)
      ? (raw.status as HistoryFilter)
      : "all",
    q: typeof raw.q === "string" ? raw.q : "",
    from: typeof raw.from === "string" ? raw.from : "",
    to: typeof raw.to === "string" ? raw.to : "",
  }),
  component: TripHistoryPage,
});

function TripHistoryPage() {
  const { user } = useAuth();
  const { roles, loading: rolesLoading } = useUserRoles(user?.id);
  const isAdmin = !!roles?.includes("admin");
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/app/admin/trip-history" });

  const nav = useMemo(() => {
    const items = [];
    if (roles?.includes("passenger")) items.push({ to: "/app/passenger", label: "Ride", icon: NAV_ICONS.Passenger });
    if (roles?.includes("driver")) items.push({ to: "/app/driver", label: "Drive", icon: NAV_ICONS.Driver });
    items.push({ to: "/app/admin", label: "Admin", icon: NAV_ICONS.Admin });
    return items;
  }, [roles]);

  const [searchInput, setSearchInput] = useState(search.q);
  const [debounced, setDebounced] = useState(search.q);
  const [rides, setRides] = useState<Ride[]>([]);
  const [profiles, setProfiles] = useState<Map<string, Profile>>(new Map());
  const [vehicles, setVehicles] = useState<Map<string, Vehicle>>(new Map());
  const [payments, setPayments] = useState<Map<string, PaymentRow>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => setSearchInput(search.q), [search.q]);
  useEffect(() => {
    const t = setTimeout(() => {
      const trimmed = searchInput.trim();
      setDebounced(trimmed);
      if (trimmed !== search.q) {
        navigate({ search: (p: HistorySearch) => ({ ...p, q: trimmed }), replace: true });
      }
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput, search.q, navigate]);

  useEffect(() => {
    setPageSize(PAGE_SIZE);
  }, [search.status, debounced, search.from, search.to]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // Determine the latest RECENT_SKIP ride IDs (the "Recent Trips" set)
        // so they can be excluded from history.
        const { data: recent } = await supabase
          .from("rides")
          .select("id")
          .order("created_at", { ascending: false })
          .limit(RECENT_SKIP);
        const excludeIds = (recent ?? []).map((r) => r.id);

        // Profile search (name/phone) → user_id list.
        let userIdMatches: string[] | null = null;
        if (debounced && debounced.length >= 2) {
          const { data: profMatches } = await supabase
            .from("profiles")
            .select("user_id")
            .or(`full_name.ilike.%${debounced}%,phone.ilike.%${debounced}%`)
            .limit(50);
          userIdMatches = (profMatches ?? []).map((p) => p.user_id);
        }

        let query = supabase.from("rides").select("*");
        if (excludeIds.length) {
          query = query.not("id", "in", `(${excludeIds.join(",")})`);
        }
        if (search.status === "scheduled") {
          query = query.eq("request_type", "scheduled").in("status", ["requested", "accepted"]);
        } else if (search.status === "active") {
          query = query.in("status", ACTIVE_STATUSES as unknown as Ride["status"][]);
        } else if (search.status !== "all") {
          query = query.eq("status", search.status);
        }
        if (search.from) query = query.gte("created_at", new Date(search.from).toISOString());
        if (search.to) {
          const end = new Date(search.to);
          end.setHours(23, 59, 59, 999);
          query = query.lte("created_at", end.toISOString());
        }
        if (debounced) {
          const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(debounced);
          const parts: string[] = [
            `pickup_address.ilike.%${debounced}%`,
            `destination_address.ilike.%${debounced}%`,
          ];
          if (isUuid) parts.push(`id.eq.${debounced}`);
          if (userIdMatches && userIdMatches.length) {
            const list = userIdMatches.join(",");
            parts.push(`passenger_id.in.(${list})`);
            parts.push(`driver_id.in.(${list})`);
          }
          query = query.or(parts.join(","));
        }

        const { data, error: err } = await query
          .order("created_at", { ascending: false, nullsFirst: false })
          .limit(pageSize + 1);
        if (err) throw err;
        if (cancelled) return;

        const rows = (data ?? []) as Ride[];
        setHasMore(rows.length > pageSize);
        const list = rows.slice(0, pageSize);
        setRides(list);

        const personIds = Array.from(
          new Set(list.flatMap((r) => [r.passenger_id, r.driver_id]).filter((v): v is string => !!v)),
        );
        if (personIds.length) {
          const { data: profs } = await supabase
            .from("profiles")
            .select("user_id, full_name, phone")
            .in("user_id", personIds);
          if (!cancelled) {
            setProfiles(new Map(((profs ?? []) as Profile[]).map((p) => [p.user_id, p])));
          }
        } else setProfiles(new Map());

        const driverIds = Array.from(new Set(list.map((r) => r.driver_id).filter((v): v is string => !!v)));
        if (driverIds.length) {
          const { data: vs } = await supabase
            .from("driver_profiles")
            .select("user_id, vehicle_model, license_plate")
            .in("user_id", driverIds);
          if (!cancelled) setVehicles(new Map(((vs ?? []) as Vehicle[]).map((v) => [v.user_id, v])));
        } else setVehicles(new Map());

        if (list.length) {
          const ids = list.map((r) => r.id);
          const { data: pays } = await supabase
            .from("payments")
            .select("ride_id, status, amount")
            .in("ride_id", ids);
          if (!cancelled) setPayments(new Map(((pays ?? []) as PaymentRow[]).map((p) => [p.ride_id, p])));
        } else setPayments(new Map());
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load trip history");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, search.status, debounced, search.from, search.to, pageSize]);

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
        <AdminTabs />
        <div className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">
          Admins only.
        </div>
      </AppShell>
    );
  }

  const filtersApplied =
    search.status !== "all" || !!debounced || !!search.from || !!search.to;

  return (
    <AppShell title="Admin" nav={nav}>
      <AdminTabs />

      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Trip History
        </h2>
        <p className="text-[11px] text-muted-foreground">Excludes the latest {RECENT_SKIP} recent trips</p>
      </div>

      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search passenger, driver, ride ID, pickup or destination"
          className="pl-9"
        />
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <Button
            key={f.key}
            size="sm"
            variant={search.status === f.key ? "default" : "outline"}
            className="h-8 text-xs"
            onClick={() => navigate({ search: (p: HistorySearch) => ({ ...p, status: f.key }) })}
          >
            {f.label}
          </Button>
        ))}
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end">
        <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
          From
          <Input
            type="date"
            value={search.from}
            onChange={(e) => navigate({ search: (p: HistorySearch) => ({ ...p, from: e.target.value }) })}
            className="h-9"
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
          To
          <Input
            type="date"
            value={search.to}
            onChange={(e) => navigate({ search: (p: HistorySearch) => ({ ...p, to: e.target.value }) })}
            className="h-9"
          />
        </label>
        {filtersApplied && (
          <Button
            size="sm"
            variant="ghost"
            className="h-8 self-end text-xs"
            onClick={() => {
              setSearchInput("");
              navigate({ search: { status: "all", q: "", from: "", to: "" } });
            }}
          >
            Clear filters
          </Button>
        )}
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <ul className="divide-y rounded-2xl border bg-card">
        {loading && !rides.length ? (
          <li className="px-4 py-6 text-center text-sm text-muted-foreground">Loading…</li>
        ) : !rides.length ? (
          <li className="px-4 py-6 text-center text-sm text-muted-foreground">No older trips match these filters.</li>
        ) : (
          rides.map((r) => {
            const pax = profiles.get(r.passenger_id) ?? null;
            const drv = r.driver_id ? profiles.get(r.driver_id) ?? null : null;
            const veh = r.driver_id ? vehicles.get(r.driver_id) ?? null : null;
            const pay = payments.get(r.id) ?? null;
            const endedAt = r.status === "completed" ? r.completed_at : r.status === "cancelled" ? r.updated_at : null;
            return (
              <li key={r.id} className="space-y-2 px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{r.destination_address}</p>
                    <p className="truncate text-xs text-muted-foreground">From {r.pickup_address}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold">{formatZAR(Number(r.estimated_price))}</p>
                    <RideStatusBadge status={r.status} />
                    {pay && (
                      <Badge
                        variant={
                          pay.status === "paid"
                            ? "default"
                            : pay.status === "failed"
                            ? "destructive"
                            : pay.status === "refunded"
                            ? "outline"
                            : "secondary"
                        }
                        className="ml-1 mt-1 text-[10px] capitalize"
                      >
                        {pay.status}
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <Field label="Passenger" value={pax?.full_name ?? "—"} />
                  <Field label="Driver" value={drv?.full_name ?? (r.driver_id ? "Assigned" : "Unassigned")} />
                  <Field
                    label="Vehicle"
                    value={
                      veh
                        ? [veh.vehicle_model, veh.license_plate].filter(Boolean).join(" · ") || "—"
                        : r.driver_id
                        ? "—"
                        : "Unassigned"
                    }
                  />
                  <Field
                    label="Scheduled"
                    value={
                      r.scheduled_at
                        ? new Date(r.scheduled_at).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", dateStyle: "short", timeStyle: "short" })
                        : "—"
                    }
                  />
                  <Field
                    label="Created"
                    value={new Date(r.created_at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}
                  />
                  <Field
                    label={r.status === "cancelled" ? "Cancelled" : "Completed"}
                    value={endedAt ? new Date(endedAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }) : "—"}
                  />
                </div>

                <div className="flex items-center justify-between gap-2">
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {r.id.slice(0, 8)}
                  </Badge>
                  <div className="flex items-center gap-1">
                    {veh && (
                      <span className="hidden items-center gap-1 text-[11px] text-muted-foreground sm:flex">
                        <Car className="h-3 w-3" />
                        {[veh.vehicle_model, veh.license_plate].filter(Boolean).join(" · ")}
                      </span>
                    )}
                    <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
                      <Link to="/app/trip/$rideId" params={{ rideId: r.id }}>
                        <ExternalLink className="mr-1 h-3 w-3" /> Details
                      </Link>
                    </Button>
                  </div>
                </div>
              </li>
            );
          })
        )}
      </ul>

      {!loading && rides.length > 0 && (
        <div className="mt-3 flex justify-center">
          {hasMore ? (
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={() => setPageSize((s) => s + PAGE_SIZE)}
            >
              Load more
            </Button>
          ) : (
            <span className="text-[11px] text-muted-foreground">No more trips</span>
          )}
        </div>
      )}
    </AppShell>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="truncate text-xs">{value}</p>
    </div>
  );
}
