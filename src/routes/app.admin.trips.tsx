import { createFileRoute } from "@tanstack/react-router";
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
import { Search, Star, KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { adminResetRidePin } from "@/lib/ride-pin.functions";
import type { Database } from "@/integrations/supabase/types";

type Ride = Database["public"]["Tables"]["rides"]["Row"];
type Profile = { user_id: string; full_name: string | null; phone: string | null };
type Review = { ride_id: string; rating: number; comment: string | null };

type FilterKey =
  | "scheduled"
  | "requested"
  | "accepted"
  | "driver_arriving"
  | "arrived"
  | "in_progress"
  | "completed"
  | "cancelled";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "scheduled", label: "Scheduled" },
  { key: "requested", label: "Requested" },
  { key: "accepted", label: "Accepted" },
  { key: "driver_arriving", label: "Driver arriving" },
  { key: "arrived", label: "Arrived" },
  { key: "in_progress", label: "In progress" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
];


export const Route = createFileRoute("/app/admin/trips")({
  head: () => ({ meta: [{ title: "Trips — Admin" }] }),
  component: AdminTripsPage,
});

function AdminTripsPage() {
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

  const [active, setActive] = useState<FilterKey>("scheduled");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [rides, setRides] = useState<Ride[]>([]);
  const [passengers, setPassengers] = useState<Map<string, Profile>>(new Map());
  const [drivers, setDrivers] = useState<Map<string, Profile>>(new Map());
  const [reviews, setReviews] = useState<Map<string, Review>>(new Map());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      // Resolve search-matched user ids first (by name or phone) so we can
      // include them in the rides filter.
      let userIdMatches: string[] | null = null;
      const q = debouncedSearch;
      if (q && q.length >= 2) {
        const { data: profMatches } = await supabase
          .from("profiles")
          .select("user_id")
          .or(`full_name.ilike.%${q}%,phone.ilike.%${q}%`)
          .limit(50);
        userIdMatches = (profMatches ?? []).map((p) => p.user_id);
      }

      let query = supabase.from("rides").select("*");
      if (active === "scheduled") {
        query = query
          .eq("request_type", "scheduled")
          .in("status", ["requested", "accepted"]);
      } else {
        query = query.eq("status", active);
      }

      if (q) {
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q);
        const orParts: string[] = [
          `pickup_address.ilike.%${q}%`,
          `destination_address.ilike.%${q}%`,
        ];
        if (isUuid) orParts.push(`id.eq.${q}`);
        if (userIdMatches && userIdMatches.length) {
          const list = userIdMatches.join(",");
          orParts.push(`passenger_id.in.(${list})`);
          orParts.push(`driver_id.in.(${list})`);
        }
        query = query.or(orParts.join(","));
      }

      const orderCol = active === "scheduled" ? "scheduled_at" : active === "completed" ? "completed_at" : "created_at";
      const { data } = await query.order(orderCol, { ascending: active === "scheduled", nullsFirst: false }).limit(100);

      if (cancelled) return;
      const list = (data ?? []) as Ride[];
      setRides(list);

      const personIds = Array.from(
        new Set(
          list
            .flatMap((r) => [r.passenger_id, r.driver_id])
            .filter((v): v is string => !!v),
        ),
      );
      if (personIds.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("user_id, full_name, phone")
          .in("user_id", personIds);
        const m = new Map<string, Profile>(
          ((profs ?? []) as Profile[]).map((p) => [p.user_id, p]),
        );
        if (!cancelled) {
          setPassengers(m);
          setDrivers(m);
        }
      } else {
        setPassengers(new Map());
        setDrivers(new Map());
      }

      if (active === "completed" && list.length) {
        const rideIds = list.map((r) => r.id);
        const { data: revs } = await supabase
          .from("ride_reviews")
          .select("ride_id, rating, comment")
          .in("ride_id", rideIds);
        if (!cancelled) {
          setReviews(
            new Map(((revs ?? []) as Review[]).map((r) => [r.ride_id, r])),
          );
        }
      } else {
        setReviews(new Map());
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, active, debouncedSearch]);

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

  return (
    <AppShell title="Admin" nav={nav}>
      <AdminTabs />

      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, phone, ride ID, pickup or destination"
          className="pl-9"
        />
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <Button
            key={f.key}
            size="sm"
            variant={active === f.key ? "default" : "outline"}
            className="h-8 text-xs"
            onClick={() => setActive(f.key)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      <ul className="divide-y rounded-2xl border bg-card">
        {loading ? (
          <li className="px-4 py-6 text-center text-sm text-muted-foreground">
            Loading…
          </li>
        ) : !rides.length ? (
          <li className="px-4 py-6 text-center text-sm text-muted-foreground">
            No trips match these filters.
          </li>
        ) : (
          rides.map((r) => (
            <TripRow
              key={r.id}
              ride={r}
              passenger={passengers.get(r.passenger_id) ?? null}
              driver={r.driver_id ? drivers.get(r.driver_id) ?? null : null}
              review={reviews.get(r.id) ?? null}
              variant={active}
            />
          ))
        )}
      </ul>
    </AppShell>
  );
}

function TripRow({
  ride,
  passenger,
  driver,
  review,
  variant,
}: {
  ride: Ride;
  passenger: Profile | null;
  driver: Profile | null;
  review: Review | null;
  variant: FilterKey;
}) {
  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{ride.destination_address}</p>
          <p className="truncate text-xs text-muted-foreground">
            From {ride.pickup_address}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-semibold">
            {formatZAR(Number(ride.estimated_price))}
          </p>
          <RideStatusBadge status={ride.status} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <Field label="Passenger" value={passenger?.full_name ?? "—"} />
        <Field
          label="Phone"
          value={passenger?.phone ?? "—"}
        />
        <Field
          label="Driver"
          value={driver?.full_name ?? (ride.driver_id ? "Assigned" : "Unassigned")}
        />
        {variant === "scheduled" && (
          <>
            <Field
              label="Scheduled"
              value={
                ride.scheduled_at
                  ? new Date(ride.scheduled_at).toLocaleString("en-ZA", {
                      timeZone: "Africa/Johannesburg",
                      dateStyle: "medium",
                      timeStyle: "short",
                    })
                  : "—"
              }
            />
            <Field
              label="Est. distance"
              value={`${Number(ride.distance_km).toFixed(1)} km`}
            />
            <Field
              label="Created"
              value={new Date(ride.created_at).toLocaleString(undefined, {
                dateStyle: "short",
                timeStyle: "short",
              })}
            />
          </>
        )}
        {variant === "completed" && (
          <>
            <Field
              label="Actual distance"
              value={
                ride.actual_distance_km != null
                  ? `${Number(ride.actual_distance_km).toFixed(1)} km`
                  : `${Number(ride.distance_km).toFixed(1)} km (est)`
              }
            />
            <Field
              label="Actual duration"
              value={formatDuration(ride)}
            />
            <Field label="Final fare" value={formatZAR(Number(ride.estimated_price))} />
          </>
        )}
        {variant !== "scheduled" && variant !== "completed" && (
          <Field
            label="Created"
            value={new Date(ride.created_at).toLocaleString(undefined, {
              dateStyle: "short",
              timeStyle: "short",
            })}
          />
        )}
      </div>

      {variant === "completed" && review && (
        <div className="rounded-md bg-secondary px-2.5 py-2 text-xs">
          <div className="flex items-center gap-1 font-medium">
            <Star className="h-3.5 w-3.5 fill-current text-amber-500" />
            {review.rating} / 5
          </div>
          {review.comment && (
            <p className="mt-1 text-muted-foreground">"{review.comment}"</p>
          )}
        </div>
      )}

      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        <Badge variant="outline" className="font-mono text-[10px]">
          {ride.id.slice(0, 8)}
        </Badge>
      </p>
    </li>
  );
}

function formatDuration(r: Ride): string {
  const secs =
    r.actual_duration_seconds ??
    (r.started_at && r.completed_at
      ? Math.round(
          (new Date(r.completed_at).getTime() - new Date(r.started_at).getTime()) / 1000,
        )
      : null);
  if (secs == null) return "—";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="truncate text-xs">{value}</p>
    </div>
  );
}
