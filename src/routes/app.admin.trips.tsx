import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useUserRoles } from "@/hooks/use-auth";
import { AdminShell } from "@/components/AdminShell";
import { NAV_ICONS } from "@/components/AppShell";
import { RideStatusBadge } from "@/components/RideStatusBadge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatZAR } from "@/lib/pricing";
import {
  Search,
  Star,
  KeyRound,
  Loader2,
  Eye,
  EyeOff,
  ShieldAlert,
  Check,
  Settings2,
  Phone,
  MessageSquare,
  ExternalLink,
  Car,
  History,
} from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import {
  adminResetRidePin,
  adminViewRidePin,
  adminAcknowledgePinAlert,
} from "@/lib/ride-pin.functions";
import type { Database } from "@/integrations/supabase/types";
import { getVehicleAlerts } from "@/lib/vehicle-alerts";
import { rankVehiclesForTrip, type Suitability } from "@/lib/vehicle-suitability";
import { fleetDb } from "@/lib/fleet";

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
import { Label } from "@/components/ui/label";

type Ride = Database["public"]["Tables"]["rides"]["Row"];
type RideStatus = Database["public"]["Enums"]["ride_status"];
type PaymentStatus = Database["public"]["Enums"]["payment_status"];
type Profile = { user_id: string; full_name: string | null; phone: string | null };
type Vehicle = {
  user_id: string;
  vehicle_model: string | null;
  license_plate: string | null;
  vehicle_type: string | null;
  is_available: boolean;
};
type FleetVehicle = Database["public"]["Tables"]["vehicle_profiles"]["Row"];
type PaymentRow = {
  ride_id: string;
  status: PaymentStatus;
  amount: number;
  payment_method: string | null;
};
type Review = { ride_id: string; rating: number; comment: string | null };

type FilterKey =
  | "all"
  | "scheduled"
  | "requested"
  | "accepted"
  | "driver_arriving"
  | "arrived"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "pin_required";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "requested", label: "Requested" },
  { key: "scheduled", label: "Scheduled" },
  { key: "accepted", label: "Accepted" },
  { key: "driver_arriving", label: "Driver arriving" },
  { key: "arrived", label: "Arrived" },
  { key: "in_progress", label: "In progress" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
  { key: "pin_required", label: "PIN support required" },
];

const VALID_FILTERS = new Set<FilterKey>(FILTERS.map((f) => f.key));
const ACTIVE_STATUSES = [
  "requested",
  "accepted",
  "driver_arriving",
  "arrived",
  "in_progress",
] as const;
const PIN_LOCK_WINDOW_MIN = 15;
const PIN_LOCK_THRESHOLD = 5;
const PAGE_SIZE = 6;

type StatusCounts = {
  total: number;
  scheduled: number;
  active: number;
  completed: number;
  cancelled: number;
};

type TripsSearch = { status: FilterKey; q: string };

export const Route = createFileRoute("/app/admin/trips")({
  head: () => ({ meta: [{ title: "Trips — Admin" }] }),
  validateSearch: (raw: Record<string, unknown>): TripsSearch => {
    const status =
      typeof raw.status === "string" && VALID_FILTERS.has(raw.status as FilterKey)
        ? (raw.status as FilterKey)
        : "all";
    const q = typeof raw.q === "string" ? raw.q : "";
    return { status, q };
  },
  component: AdminTripsPage,
});

function AdminTripsPage() {
  const { user } = useAuth();
  const { roles, loading: rolesLoading } = useUserRoles(user?.id);
  const isAdmin = !!roles?.includes("admin");
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/app/admin/trips" });

  const nav = useMemo(() => {
    const items = [];
    if (roles?.includes("passenger"))
      items.push({ to: "/app/passenger", label: "Ride", icon: NAV_ICONS.Passenger });
    if (roles?.includes("driver"))
      items.push({ to: "/app/driver", label: "Drive", icon: NAV_ICONS.Driver });
    items.push({ to: "/app/admin", label: "Admin", icon: NAV_ICONS.Admin });
    return items;
  }, [roles]);

  const active = search.status;
  const [searchInput, setSearchInput] = useState(search.q);
  const [debouncedSearch, setDebouncedSearch] = useState(search.q);
  const [rides, setRides] = useState<Ride[]>([]);
  const [passengers, setPassengers] = useState<Map<string, Profile>>(new Map());
  const [drivers, setDrivers] = useState<Map<string, Profile>>(new Map());
  const [vehicles, setVehicles] = useState<Map<string, Vehicle>>(new Map());
  const [payments, setPayments] = useState<Map<string, PaymentRow>>(new Map());
  const [reviews, setReviews] = useState<Map<string, Review>>(new Map());
  const [fleetVehicles, setFleetVehicles] = useState<Map<string, FleetVehicle>>(new Map());

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [hasMore, setHasMore] = useState(false);
  const [counts, setCounts] = useState<StatusCounts | null>(null);
  const reload = () => setReloadKey((k) => k + 1);

  useEffect(() => setSearchInput(search.q), [search.q]);

  // Reset pagination when filters change.
  useEffect(() => {
    setPageSize(PAGE_SIZE);
  }, [active, debouncedSearch]);

  useEffect(() => {
    const t = setTimeout(() => {
      const trimmed = searchInput.trim();
      setDebouncedSearch(trimmed);
      if (trimmed !== search.q) {
        navigate({ search: (p: TripsSearch) => ({ ...p, q: trimmed }), replace: true });
      }
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput, navigate, search.q]);

  // Status counts (unfiltered by search/status — always show totals).
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      const [total, scheduled, active, completed, cancelledQ] = await Promise.all([
        supabase.from("rides").select("id", { count: "exact", head: true }),
        supabase
          .from("rides")
          .select("id", { count: "exact", head: true })
          .eq("request_type", "scheduled")
          .in("status", ["requested", "accepted"]),
        supabase
          .from("rides")
          .select("id", { count: "exact", head: true })
          .in("status", ACTIVE_STATUSES as unknown as Ride["status"][]),
        supabase
          .from("rides")
          .select("id", { count: "exact", head: true })
          .eq("status", "completed"),
        supabase
          .from("rides")
          .select("id", { count: "exact", head: true })
          .eq("status", "cancelled"),
      ]);
      if (cancelled) return;
      setCounts({
        total: total.count ?? 0,
        scheduled: scheduled.count ?? 0,
        active: active.count ?? 0,
        completed: completed.count ?? 0,
        cancelled: cancelledQ.count ?? 0,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, reloadKey]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
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

        // PIN support required: active rides whose driver hit the failed
        // attempt threshold inside the active lockout window. Admins can read
        // ride_pin_attempts via RLS.
        let pinRequiredIds: string[] | null = null;
        if (active === "pin_required") {
          const since = new Date(Date.now() - PIN_LOCK_WINDOW_MIN * 60_000).toISOString();
          const { data: atts } = await supabase
            .from("ride_pin_attempts")
            .select("ride_id, success, attempted_at")
            .gte("attempted_at", since)
            .eq("success", false);
          const counts = new Map<string, number>();
          for (const a of atts ?? []) counts.set(a.ride_id, (counts.get(a.ride_id) ?? 0) + 1);
          pinRequiredIds = Array.from(counts.entries())
            .filter(([, n]) => n >= PIN_LOCK_THRESHOLD)
            .map(([id]) => id);
          if (!pinRequiredIds.length) {
            setRides([]);
            setPassengers(new Map());
            setDrivers(new Map());
            setReviews(new Map());
            setLoading(false);
            return;
          }
        }

        let query = supabase.from("rides").select("*");
        if (active === "scheduled") {
          query = query.eq("request_type", "scheduled").in("status", ["requested", "accepted"]);
        } else if (active === "pin_required") {
          query = query
            .in("status", ACTIVE_STATUSES as unknown as Ride["status"][])
            .in("id", pinRequiredIds!);
        } else if (active !== "all") {
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

        const orderCol =
          active === "scheduled"
            ? "scheduled_at"
            : active === "completed"
              ? "completed_at"
              : "created_at";
        const { data, error: err } = await query
          .order(orderCol, { ascending: active === "scheduled", nullsFirst: false })
          .limit(pageSize + 1);
        if (err) throw err;

        if (cancelled) return;
        const rows = (data ?? []) as Ride[];
        setHasMore(rows.length > pageSize);
        const list = rows.slice(0, pageSize);
        setRides(list);

        const personIds = Array.from(
          new Set(
            list.flatMap((r) => [r.passenger_id, r.driver_id]).filter((v): v is string => !!v),
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

        const driverIds = Array.from(
          new Set(list.map((r) => r.driver_id).filter((v): v is string => !!v)),
        );
        if (driverIds.length) {
          const { data: vs } = await supabase
            .from("driver_profiles")
            .select("user_id, vehicle_model, license_plate, vehicle_type, is_available")
            .in("user_id", driverIds);
          if (!cancelled)
            setVehicles(new Map(((vs ?? []) as Vehicle[]).map((v) => [v.user_id, v])));
        } else {
          setVehicles(new Map());
        }

        // Fleet vehicles assigned to these rides (rides.vehicle_id).
        const fleetIds = Array.from(
          new Set(list.map((r) => r.vehicle_id).filter((v): v is string => !!v)),
        );
        if (fleetIds.length) {
          const { data: fvs } = await supabase
            .from("vehicle_profiles")
            .select("*")
            .in("id", fleetIds);
          if (!cancelled) {
            const fm = new Map<string, FleetVehicle>();
            for (const r of list) {
              if (!r.vehicle_id) continue;
              const v = (fvs ?? []).find((x) => x.id === r.vehicle_id);
              if (v) fm.set(r.id, v as FleetVehicle);
            }
            setFleetVehicles(fm);
          }
        } else {
          setFleetVehicles(new Map());
        }

        if (list.length) {
          const rideIds = list.map((r) => r.id);
          const { data: pays } = await supabase
            .from("payments")
            .select("ride_id, status, amount, payment_method")
            .in("ride_id", rideIds);
          if (!cancelled) {
            setPayments(new Map(((pays ?? []) as PaymentRow[]).map((p) => [p.ride_id, p])));
          }
        } else {
          setPayments(new Map());
        }

        if (active === "completed" && list.length) {
          const rideIds = list.map((r) => r.id);
          const { data: revs } = await supabase
            .from("ride_reviews")
            .select("ride_id, rating, comment")
            .in("ride_id", rideIds);
          if (!cancelled) {
            setReviews(new Map(((revs ?? []) as Review[]).map((r) => [r.ride_id, r])));
          }
        } else {
          setReviews(new Map());
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load trips");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, active, debouncedSearch, reloadKey, pageSize]);

  if (rolesLoading) {
    return (
      <AdminShell title="Trips">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </AdminShell>
    );
  }

  if (!isAdmin) {
    return (
      <AdminShell title="Trips">
        <div className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">
          Admins only.
        </div>
      </AdminShell>
    );
  }

  const activeLabel = FILTERS.find((f) => f.key === active)?.label ?? "All";
  const filtersApplied = active !== "all" || !!debouncedSearch;

  return (
    <AdminShell title="Trips">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-5">
          <CountChip label="Total" value={counts?.total ?? "—"} />
          <CountChip label="Scheduled" value={counts?.scheduled ?? "—"} />
          <CountChip label="Active" value={counts?.active ?? "—"} />
          <CountChip label="Completed" value={counts?.completed ?? "—"} />
          <CountChip label="Cancelled" value={counts?.cancelled ?? "—"} />
        </div>
        <Button asChild size="sm" variant="outline" className="h-8 text-xs">
          <Link to="/app/admin/trip-history" search={{ status: "all", q: "", from: "", to: "" }}>
            <History className="mr-1 h-3 w-3" /> Trip History
          </Link>
        </Button>
      </div>

      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search name, phone, ride ID, plate, pickup or destination"
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
            onClick={() => navigate({ search: (p: TripsSearch) => ({ ...p, status: f.key }) })}
          >
            {f.label}
          </Button>
        ))}
      </div>

      <div className="mb-3 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          Showing <span className="font-medium text-foreground">{activeLabel}</span>
          {debouncedSearch && (
            <>
              {" "}
              matching "<span className="font-medium text-foreground">{debouncedSearch}</span>"
            </>
          )}{" "}
          · {rides.length} result{rides.length === 1 ? "" : "s"}
        </span>
        {filtersApplied && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => {
              setSearchInput("");
              navigate({ search: { status: "all", q: "" } });
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
        {loading ? (
          <li className="px-4 py-6 text-center text-sm text-muted-foreground">Loading…</li>
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
              driver={r.driver_id ? (drivers.get(r.driver_id) ?? null) : null}
              vehicle={r.driver_id ? (vehicles.get(r.driver_id) ?? null) : null}
              fleetVehicle={fleetVehicles.get(r.id) ?? null}
              payment={payments.get(r.id) ?? null}
              review={reviews.get(r.id) ?? null}
              variant={active}
              onChanged={reload}
            />
          ))
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
    </AdminShell>
  );
}

function TripRow({
  ride,
  passenger,
  driver,
  vehicle,
  fleetVehicle,
  payment,
  review,
  variant,
  onChanged,
}: {
  ride: Ride;
  passenger: Profile | null;
  driver: Profile | null;
  vehicle: Vehicle | null;
  fleetVehicle: FleetVehicle | null;
  payment: PaymentRow | null;
  review: Review | null;
  variant: FilterKey;
  onChanged: () => void;
}) {
  const fleetAlerts = fleetVehicle ? getVehicleAlerts(fleetVehicle) : [];
  const vehicleModel = fleetVehicle
    ? `${fleetVehicle.vehicle_name ?? ""} ${fleetVehicle.model ?? ""}`.trim() ||
      (fleetVehicle.vehicle_name ?? "—")
    : (vehicle?.vehicle_model ?? null);
  const vehicleType = fleetVehicle?.vehicle_type ?? vehicle?.vehicle_type ?? null;
  const vehiclePlate = fleetVehicle?.license_plate ?? vehicle?.license_plate ?? null;
  const vehicleAssignmentStatus: "fleet" | "driver" | "unassigned" = fleetVehicle
    ? "fleet"
    : vehicle && (vehicle.vehicle_model || vehicle.license_plate)
      ? "driver"
      : "unassigned";
  const driverAvailability: "available" | "offline" | "none" = vehicle
    ? vehicle.is_available
      ? "available"
      : "offline"
    : "none";

  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{ride.destination_address}</p>
          <p className="truncate text-xs text-muted-foreground">From {ride.pickup_address}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-semibold">{formatZAR(Number(ride.estimated_price))}</p>
          <RideStatusBadge status={ride.status} />
          <PaymentBadge payment={payment} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <Field label="Passenger" value={passenger?.full_name ?? "—"} />
        <Field label="Phone" value={passenger?.phone ?? "—"} />
        <Field
          label="Driver"
          value={driver?.full_name ?? (ride.driver_id ? "Assigned" : "Unassigned")}
        />
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Driver availability
          </div>
          <div className="text-xs">
            {driverAvailability === "available" ? (
              <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                Available
              </Badge>
            ) : driverAvailability === "offline" ? (
              <Badge variant="secondary">Offline</Badge>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </div>
        </div>
        <Field label="Vehicle model" value={vehicleModel ?? "Unassigned"} />
        <Field label="Vehicle type" value={vehicleType ?? "—"} />
        <Field label="License plate" value={vehiclePlate ?? "—"} />
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Vehicle assignment
          </div>
          <div className="text-xs">
            {vehicleAssignmentStatus === "fleet" ? (
              <Badge className="bg-sky-500/15 text-sky-700 dark:text-sky-300">Fleet vehicle</Badge>
            ) : vehicleAssignmentStatus === "driver" ? (
              <Badge variant="outline">Driver's vehicle</Badge>
            ) : (
              <Badge
                variant="outline"
                className="border-amber-500/40 text-amber-700 dark:text-amber-300"
              >
                Unassigned
              </Badge>
            )}
          </div>
        </div>

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
            <Field label="Est. distance" value={`${Number(ride.distance_km).toFixed(1)} km`} />
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
            <Field label="Actual duration" value={formatDuration(ride)} />
          </>
        )}
        <Field
          label="Created"
          value={new Date(ride.created_at).toLocaleString(undefined, {
            dateStyle: "short",
            timeStyle: "short",
          })}
        />
      </div>

      {variant === "completed" && review && (
        <div className="rounded-md bg-secondary px-2.5 py-2 text-xs">
          <div className="flex items-center gap-1 font-medium">
            <Star className="h-3.5 w-3.5 fill-current text-amber-500" />
            {review.rating} / 5
          </div>
          {review.comment && <p className="mt-1 text-muted-foreground">"{review.comment}"</p>}
        </div>
      )}

      {fleetAlerts.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {fleetAlerts.map((a, i) => (
            <Badge
              key={i}
              className={
                "text-[10px] " +
                (a.severity === "urgent"
                  ? "bg-destructive text-destructive-foreground"
                  : "bg-amber-500/20 text-amber-800 dark:text-amber-200")
              }
            >
              {a.label}
            </Badge>
          ))}
        </div>
      )}

      {ride.driver_id && !["completed", "cancelled"].includes(ride.status) && (
        <AdminPinRow rideId={ride.id} />
      )}

      <div className="flex items-center justify-between gap-2">
        <Badge variant="outline" className="font-mono text-[10px]">
          {ride.id.slice(0, 8)}
        </Badge>
        <div className="flex flex-wrap items-center gap-1">
          <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
            <Link to="/app/trip/$rideId" params={{ rideId: ride.id }}>
              <ExternalLink className="mr-1 h-3 w-3" /> Details
            </Link>
          </Button>
          {ride.driver_id && (
            <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
              <Link to="/app/admin/drivers" search={{ status: "all", q: ride.driver_id }}>
                <ExternalLink className="mr-1 h-3 w-3" /> Driver
              </Link>
            </Button>
          )}
          {ride.vehicle_id ? (
            <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
              <Link
                to="/app/admin/vehicle-profiles/$vehicleId"
                params={{ vehicleId: ride.vehicle_id }}
              >
                <Car className="mr-1 h-3 w-3" /> Vehicle
              </Link>
            </Button>
          ) : null}
          <AdminActionsDialog
            ride={ride}
            passenger={passenger}
            driver={driver}
            vehicle={vehicle}
            fleetVehicle={fleetVehicle}
            payment={payment}
            onChanged={onChanged}
          />
        </div>
      </div>
    </li>
  );
}

function PaymentBadge({ payment }: { payment: PaymentRow | null }) {
  if (!payment) return null;
  const variant: "default" | "secondary" | "destructive" | "outline" =
    payment.status === "paid"
      ? "default"
      : payment.status === "failed"
        ? "destructive"
        : payment.status === "refunded"
          ? "outline"
          : "secondary";
  return (
    <Badge variant={variant} className="ml-1 mt-1 text-[10px] capitalize">
      {payment.status}
    </Badge>
  );
}

const STATUS_TRANSITIONS: RideStatus[] = [
  "requested",
  "accepted",
  "driver_arriving",
  "arrived",
  "in_progress",
  "completed",
  "cancelled",
];

type DriverOption = {
  user_id: string;
  full_name: string | null;
  vehicle_model: string | null;
  license_plate: string | null;
  is_available: boolean;
};

function AdminActionsDialog({
  ride,
  passenger,
  driver,
  vehicle,
  fleetVehicle,
  payment,
  onChanged,
}: {
  ride: Ride;
  passenger: Profile | null;
  driver: Profile | null;
  vehicle: Vehicle | null;
  fleetVehicle: FleetVehicle | null;
  payment: PaymentRow | null;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [drivers, setDrivers] = useState<DriverOption[]>([]);
  const [selectedDriver, setSelectedDriver] = useState<string>(ride.driver_id ?? "");
  const [selectedStatus, setSelectedStatus] = useState<RideStatus>(ride.status);
  const [selectedPayment, setSelectedPayment] = useState<PaymentStatus | "">(payment?.status ?? "");
  const [fleetRanked, setFleetRanked] = useState<Suitability[]>([]);
  const [selectedFleet, setSelectedFleet] = useState<string>(ride.vehicle_id ?? "");

  useEffect(() => {
    if (!open) return;
    setSelectedDriver(ride.driver_id ?? "");
    setSelectedStatus(ride.status);
    setSelectedPayment(payment?.status ?? "");
    (async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "driver");
      const ids = (roles ?? []).map((r) => r.user_id);
      if (!ids.length) return setDrivers([]);
      const [{ data: profs }, { data: vs }] = await Promise.all([
        supabase.from("profiles").select("user_id, full_name").in("user_id", ids),
        supabase
          .from("driver_profiles")
          .select("user_id, vehicle_model, license_plate, is_available")
          .in("user_id", ids),
      ]);
      const vMap = new Map(
        (
          (vs ?? []) as {
            user_id: string;
            vehicle_model: string | null;
            license_plate: string | null;
            is_available: boolean;
          }[]
        ).map((v) => [v.user_id, v]),
      );
      const opts: DriverOption[] = (
        (profs ?? []) as { user_id: string; full_name: string | null }[]
      ).map((p) => ({
        user_id: p.user_id,
        full_name: p.full_name,
        vehicle_model: vMap.get(p.user_id)?.vehicle_model ?? null,
        license_plate: vMap.get(p.user_id)?.license_plate ?? null,
        is_available: vMap.get(p.user_id)?.is_available ?? false,
      }));
      opts.sort(
        (a, b) =>
          Number(b.is_available) - Number(a.is_available) ||
          (a.full_name ?? "").localeCompare(b.full_name ?? ""),
      );
      setDrivers(opts);
    })();

    // Fleet vehicles + active assignments for suitability ranking.
    (async () => {
      setSelectedFleet(ride.vehicle_id ?? "");
      const [{ data: vehs }, { data: busyRides }] = await Promise.all([
        supabase.from("vehicle_profiles").select("*").order("vehicle_name"),
        supabase
          .from("rides")
          .select("vehicle_id")
          .in("status", ACTIVE_STATUSES as unknown as Ride["status"][])
          .neq("id", ride.id),
      ]);
      const busy = new Set<string>(
        ((busyRides ?? []) as { vehicle_id: string | null }[])
          .map((r) => r.vehicle_id)
          .filter((v): v is string => !!v),
      );
      const ranked = rankVehiclesForTrip(
        (vehs ?? []) as FleetVehicle[],
        { passengerCount: 1 },
        busy,
        ride.id,
      );
      setFleetRanked(ranked);
    })();
  }, [open, ride.id, ride.driver_id, ride.status, ride.vehicle_id, payment?.status]);

  async function runUpdate(patch: Partial<Ride>, successMsg: string) {
    setBusy(true);
    try {
      const { error } = await supabase.from("rides").update(patch).eq("id", ride.id);
      if (error) throw error;
      toast.success(successMsg);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function onAssignResources() {
    if (!selectedDriver || !selectedFleet) {
      toast.error("Select both a driver and a suitable canonical vehicle");
      return;
    }
    const suitability = fleetRanked.find((item) => item.vehicle.id === selectedFleet);
    if (suitability && !suitability.suitable) {
      toast.error("The selected vehicle has blocking suitability conditions");
      return;
    }

    setBusy(true);
    try {
      const { error } = await fleetDb.rpc("admin_assign_ride_resources", {
        p_ride_id: ride.id,
        p_driver_id: selectedDriver,
        p_vehicle_id: selectedFleet,
        p_expected_status: ride.status,
        p_idempotency_key: crypto.randomUUID(),
      });
      if (error) throw error;
      toast.success("Driver and canonical vehicle assigned atomically");
      setOpen(false);
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Resource assignment failed");
    } finally {
      setBusy(false);
    }
  }

  async function onChangeStatus() {
    if (selectedStatus === ride.status) return;
    const patch: Partial<Ride> = { status: selectedStatus };
    const nowIso = new Date().toISOString();
    if (selectedStatus === "accepted" && !ride.accepted_at) patch.accepted_at = nowIso;
    if (selectedStatus === "driver_arriving") patch.accepted_at = ride.accepted_at ?? nowIso;
    if (selectedStatus === "arrived" && !ride.driver_arrived_at) patch.driver_arrived_at = nowIso;
    if (selectedStatus === "in_progress" && !ride.started_at) patch.started_at = nowIso;
    if (selectedStatus === "completed" && !ride.completed_at) patch.completed_at = nowIso;
    await runUpdate(patch, `Status changed to ${selectedStatus.replace("_", " ")}`);
  }

  async function onCancel() {
    await runUpdate({ status: "cancelled" }, "Trip cancelled");
  }

  async function onComplete() {
    await runUpdate(
      { status: "completed", completed_at: ride.completed_at ?? new Date().toISOString() },
      "Trip marked completed",
    );
  }

  async function onUpdatePayment() {
    if (!payment || !selectedPayment || selectedPayment === payment.status) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from("payments")
        .update({ status: selectedPayment })
        .eq("ride_id", ride.id);
      if (error) throw error;
      toast.success(`Payment marked ${selectedPayment}`);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Payment update failed");
    } finally {
      setBusy(false);
    }
  }

  const terminal = ride.status === "completed" || ride.status === "cancelled";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 text-xs">
          <Settings2 className="mr-1 h-3 w-3" /> Actions
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Manage trip</DialogTitle>
          <DialogDescription className="font-mono text-[10px]">{ride.id}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="rounded-md border bg-secondary/40 p-2 text-xs">
            <p className="font-medium">{ride.destination_address}</p>
            <p className="text-muted-foreground">From {ride.pickup_address}</p>
            <p className="mt-1 text-muted-foreground">
              Passenger: {passenger?.full_name ?? "—"} · Driver:{" "}
              {driver?.full_name ?? (ride.driver_id ? "Assigned" : "Unassigned")}
            </p>
            {vehicle && (vehicle.vehicle_model || vehicle.license_plate) && (
              <p className="mt-0.5 flex items-center gap-1 text-muted-foreground">
                <Car className="h-3 w-3" />{" "}
                {[vehicle.vehicle_model, vehicle.license_plate].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>

          {/* Contact */}
          <div className="space-y-1">
            <Label className="text-xs">Contact</Label>
            <div className="flex flex-wrap gap-1.5">
              <Button
                asChild
                size="sm"
                variant="outline"
                disabled={!passenger?.phone}
                className="h-8 text-xs"
              >
                <a href={passenger?.phone ? `tel:${passenger.phone}` : "#"}>
                  <Phone className="mr-1 h-3 w-3" /> Call passenger
                </a>
              </Button>
              <Button
                asChild
                size="sm"
                variant="outline"
                disabled={!passenger?.phone}
                className="h-8 text-xs"
              >
                <a href={passenger?.phone ? `sms:${passenger.phone}` : "#"}>
                  <MessageSquare className="mr-1 h-3 w-3" /> SMS passenger
                </a>
              </Button>
              <Button
                asChild
                size="sm"
                variant="outline"
                disabled={!driver?.phone}
                className="h-8 text-xs"
              >
                <a href={driver?.phone ? `tel:${driver.phone}` : "#"}>
                  <Phone className="mr-1 h-3 w-3" /> Call driver
                </a>
              </Button>
              <Button
                asChild
                size="sm"
                variant="outline"
                disabled={!driver?.phone}
                className="h-8 text-xs"
              >
                <a href={driver?.phone ? `sms:${driver.phone}` : "#"}>
                  <MessageSquare className="mr-1 h-3 w-3" /> SMS driver
                </a>
              </Button>
            </div>
          </div>

          {/* Assign driver and canonical vehicle atomically */}
          <div className="space-y-3">
            <Label className="text-xs">Assign driver and canonical vehicle</Label>
            <Select value={selectedDriver} onValueChange={setSelectedDriver}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="Select a driver" />
              </SelectTrigger>
              <SelectContent>
                {drivers.length === 0 ? (
                  <SelectItem value="__none" disabled>
                    No drivers found
                  </SelectItem>
                ) : null}
                {drivers.map((driverOption) => (
                  <SelectItem key={driverOption.user_id} value={driverOption.user_id}>
                    {driverOption.full_name ?? driverOption.user_id.slice(0, 8)}
                    {driverOption.is_available ? " · available" : " · offline"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={selectedFleet} onValueChange={setSelectedFleet}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="Select a canonical vehicle" />
              </SelectTrigger>
              <SelectContent className="max-h-80">
                {fleetRanked.length === 0 ? (
                  <SelectItem value="__empty" disabled>
                    No canonical vehicles
                  </SelectItem>
                ) : null}
                {fleetRanked.map((suitability) => {
                  const candidate = suitability.vehicle;
                  const tag = suitability.suitable
                    ? suitability.warnings.length
                      ? " ⚠"
                      : " ✓"
                    : " ✕";
                  return (
                    <SelectItem
                      key={candidate.id}
                      value={candidate.id}
                      disabled={!suitability.suitable}
                    >
                      {candidate.vehicle_name} · {candidate.license_plate}
                      {candidate.passenger_capacity != null
                        ? ` · ${candidate.passenger_capacity} pax`
                        : ""}
                      {candidate.wheelchair_accessible ? " · WC" : ""}
                      {tag}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>

            {(() => {
              const picked = fleetRanked.find((item) => item.vehicle.id === selectedFleet);
              if (!picked) return null;
              return (
                <div className="flex flex-wrap gap-1">
                  {picked.blocking.map((reason, index) => (
                    <Badge key={`b${index}`} variant="destructive" className="text-[10px]">
                      {reason.label}
                    </Badge>
                  ))}
                  {picked.warnings.map((reason, index) => (
                    <Badge
                      key={`w${index}`}
                      className="bg-amber-500/20 text-[10px] text-amber-800 dark:text-amber-200"
                    >
                      {reason.label}
                    </Badge>
                  ))}
                  {picked.suitable && picked.warnings.length === 0 ? (
                    <Badge variant="secondary" className="text-[10px]">
                      Suitable
                    </Badge>
                  ) : null}
                </div>
              );
            })()}

            <Button
              size="sm"
              disabled={busy || terminal || !selectedDriver || !selectedFleet}
              onClick={onAssignResources}
              className="h-8 text-xs"
            >
              {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
              Assign resources
            </Button>
            <p className="text-[10px] text-muted-foreground">
              Driver and vehicle are validated and written in one protected transaction.
            </p>
          </div>

          {/* Change status */}
          <div className="space-y-1">
            <Label className="text-xs">Change status</Label>
            <div className="flex gap-1.5">
              <Select
                value={selectedStatus}
                onValueChange={(v) => setSelectedStatus(v as RideStatus)}
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_TRANSITIONS.map((s) => (
                    <SelectItem key={s} value={s} className="capitalize">
                      {s.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                disabled={busy || selectedStatus === ride.status}
                onClick={onChangeStatus}
                className="h-9 text-xs"
              >
                Apply
              </Button>
            </div>
          </div>

          {/* Payment */}
          {payment && (
            <div className="space-y-1">
              <Label className="text-xs">Payment status</Label>
              <div className="flex gap-1.5">
                <Select
                  value={selectedPayment || undefined}
                  onValueChange={(v) => setSelectedPayment(v as PaymentStatus)}
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(["pending", "paid", "failed", "refunded"] as PaymentStatus[]).map((s) => (
                      <SelectItem key={s} value={s} className="capitalize">
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  disabled={busy || !selectedPayment || selectedPayment === payment.status}
                  onClick={onUpdatePayment}
                  className="h-9 text-xs"
                >
                  Update
                </Button>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex-row justify-between gap-2 sm:justify-between">
          <Button variant="destructive" size="sm" disabled={busy || terminal} onClick={onCancel}>
            Cancel trip
          </Button>
          <Button
            size="sm"
            disabled={busy || ride.status === "completed" || ride.status === "cancelled"}
            onClick={onComplete}
          >
            <Check className="mr-1 h-3 w-3" /> Mark completed
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const LOCK_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

type PinAttempt = { attempted_at: string; success: boolean };
type PinAlert = { id: string; read_at: string | null; created_at: string };

function AdminPinRow({ rideId }: { rideId: string }) {
  const [pin, setPin] = useState<string | null>(null);
  const [revealBusy, setRevealBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [ackBusy, setAckBusy] = useState(false);
  const [attempts, setAttempts] = useState<PinAttempt[]>([]);
  const [alert, setAlert] = useState<PinAlert | null>(null);
  const [now, setNow] = useState(Date.now());

  const viewFn = useServerFn(adminViewRidePin);
  const resetFn = useServerFn(adminResetRidePin);
  const ackFn = useServerFn(adminAcknowledgePinAlert);

  // Initial load + realtime subscription on attempts and admin alerts.
  useEffect(() => {
    let cancelled = false;
    const loadAttempts = async () => {
      const { data } = await supabase
        .from("ride_pin_attempts")
        .select("attempted_at, success")
        .eq("ride_id", rideId)
        .order("attempted_at", { ascending: false })
        .limit(20);
      if (!cancelled) setAttempts((data ?? []) as PinAttempt[]);
    };
    const loadAlert = async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const { data } = await supabase
        .from("notifications")
        .select("id, read_at, created_at")
        .eq("user_id", u.user.id)
        .eq("ride_id", rideId)
        .eq("type", "pin_failed_attempt_limit")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!cancelled) setAlert((data as PinAlert | null) ?? null);
    };
    loadAttempts();
    loadAlert();

    const ch = supabase
      .channel(`admin-pin-${rideId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "ride_pin_attempts",
          filter: `ride_id=eq.${rideId}`,
        },
        () => loadAttempts(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `ride_id=eq.${rideId}` },
        () => loadAlert(),
      )
      .subscribe();
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
      clearInterval(tick);
    };
  }, [rideId]);

  const recentFailures = useMemo(
    () =>
      attempts.filter(
        (a) => !a.success && now - new Date(a.attempted_at).getTime() < LOCK_WINDOW_MS,
      ),
    [attempts, now],
  );
  const latestFailIso = recentFailures[0]?.attempted_at ?? null;
  const locked = recentFailures.length >= MAX_FAILURES;
  const lockExpiresAt =
    locked && latestFailIso ? new Date(latestFailIso).getTime() + LOCK_WINDOW_MS : null;
  const lockSecondsLeft = lockExpiresAt ? Math.max(0, Math.round((lockExpiresAt - now) / 1000)) : 0;
  const hasOpenAlert = !!alert && alert.read_at === null;

  async function onReveal() {
    setRevealBusy(true);
    try {
      const r = await viewFn({ data: { rideId } });
      setPin(r.pin);
      toast.success("PIN revealed — audit entry recorded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reveal failed");
    } finally {
      setRevealBusy(false);
    }
  }

  async function onReset() {
    setResetBusy(true);
    try {
      const r = await resetFn({ data: { rideId } });
      setPin(r.pin);
      toast.success("PIN reset and failed attempts cleared");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reset failed");
    } finally {
      setResetBusy(false);
    }
  }

  async function onAcknowledge() {
    setAckBusy(true);
    try {
      await ackFn({ data: { rideId } });
      toast.success("Alert acknowledged");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Acknowledge failed");
    } finally {
      setAckBusy(false);
    }
  }

  return (
    <div
      className={
        "space-y-2 rounded-md border px-2.5 py-2 text-xs " +
        (hasOpenAlert ? "border-destructive/60 bg-destructive/10" : "border-dashed bg-secondary/40")
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <KeyRound className="h-3.5 w-3.5" /> Start PIN
          <span className="ml-1 font-mono text-base font-semibold tracking-widest text-foreground">
            {pin ?? "••••"}
          </span>
          {hasOpenAlert && (
            <Badge variant="destructive" className="ml-2 gap-1">
              <ShieldAlert className="h-3 w-3" /> PIN lockout
            </Badge>
          )}
        </span>
        <div className="flex flex-wrap items-center gap-1">
          <Button size="sm" variant="outline" onClick={onReveal} disabled={revealBusy}>
            {revealBusy ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : pin ? (
              <EyeOff className="mr-1 h-3 w-3" />
            ) : (
              <Eye className="mr-1 h-3 w-3" />
            )}
            {pin ? "Re-reveal" : "Reveal PIN"}
          </Button>
          <Button size="sm" variant="ghost" onClick={onReset} disabled={resetBusy}>
            {resetBusy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}Reset
          </Button>
          {hasOpenAlert && (
            <Button size="sm" variant="secondary" onClick={onAcknowledge} disabled={ackBusy}>
              {ackBusy ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <Check className="mr-1 h-3 w-3" />
              )}
              Acknowledge
            </Button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground sm:grid-cols-4">
        <span>
          Failed attempts:{" "}
          <span className="font-medium text-foreground">
            {recentFailures.length}/{MAX_FAILURES}
          </span>
        </span>
        <span>
          Latest attempt:{" "}
          <span className="font-medium text-foreground">
            {latestFailIso
              ? new Date(latestFailIso).toLocaleTimeString(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "—"}
          </span>
        </span>
        <span>
          Lockout:{" "}
          <span className={"font-medium " + (locked ? "text-destructive" : "text-foreground")}>
            {locked ? "Active" : "Clear"}
          </span>
        </span>
        <span>
          Lockout expires:{" "}
          <span className="font-medium text-foreground">
            {lockExpiresAt
              ? `${new Date(lockExpiresAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })} (~${Math.ceil(lockSecondsLeft / 60)}m)`
              : "—"}
          </span>
        </span>
      </div>
    </div>
  );
}

function formatDuration(r: Ride): string {
  const secs =
    r.actual_duration_seconds ??
    (r.started_at && r.completed_at
      ? Math.round((new Date(r.completed_at).getTime() - new Date(r.started_at).getTime()) / 1000)
      : null);
  if (secs == null) return "—";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function CountChip({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border bg-card px-2 py-1.5 text-center">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold">{value}</p>
    </div>
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
