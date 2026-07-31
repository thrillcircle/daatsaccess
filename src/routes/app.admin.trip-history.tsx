import { createFileRoute, Link, useNavigate, type SearchSchemaInput } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useUserRoles } from "@/hooks/use-auth";
import { AdminShell } from "@/components/AdminShell";
import { RideStatusBadge } from "@/components/RideStatusBadge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatZAR } from "@/lib/pricing";
import {
  Search,
  Download,
  Filter,
  ExternalLink,
  MoreVertical,
  Phone,
  MessageSquare,
  UserPlus,
  X,
  ListOrdered,
  CalendarRange,
  Activity,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Database } from "@/integrations/supabase/types";

type Ride = Database["public"]["Tables"]["rides"]["Row"];
type PaymentStatus = Database["public"]["Enums"]["payment_status"];
type Profile = { user_id: string; full_name: string | null; phone: string | null };
type DriverVehicle = {
  user_id: string;
  vehicle_model: string | null;
  license_plate: string | null;
  vehicle_type: string | null;
};
type FleetVehicle = {
  id: string;
  vehicle_name: string | null;
  vehicle_type: string | null;
  license_plate: string | null;
};
type PaymentRow = { ride_id: string; status: PaymentStatus; amount: number };

type StatusFilter = "all" | "scheduled" | "active" | "completed" | "cancelled";
const STATUS_OPTIONS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All status" },
  { key: "scheduled", label: "Scheduled" },
  { key: "active", label: "Active" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
];
const VALID_STATUS = new Set<StatusFilter>(STATUS_OPTIONS.map((s) => s.key));
const VALID_SORT = new Set<SortOrder>(["newest", "oldest"]);
type SortOrder = "newest" | "oldest";
const ACTIVE_STATUSES = [
  "requested",
  "accepted",
  "driver_arriving",
  "arrived",
  "in_progress",
] as const;
const PAGE_SIZE = 10;

type Counts = {
  total: number;
  scheduled: number;
  active: number;
  completed: number;
  cancelled: number;
};

type HistorySearch = {
  status: StatusFilter;
  q: string;
  from: string;
  to: string;
  driver: string;
  vehicle: string;
  sort: SortOrder;
};

export const Route = createFileRoute("/app/admin/trip-history")({
  head: () => ({ meta: [{ title: "Trip History — Admin" }] }),
  validateSearch: (raw: Record<string, unknown> & SearchSchemaInput): HistorySearch => ({
    status:
      typeof raw.status === "string" && VALID_STATUS.has(raw.status as StatusFilter)
        ? (raw.status as StatusFilter)
        : "all",
    q: typeof raw.q === "string" ? raw.q : "",
    from: typeof raw.from === "string" ? raw.from : "",
    to: typeof raw.to === "string" ? raw.to : "",
    driver: typeof raw.driver === "string" ? raw.driver : "",
    vehicle: typeof raw.vehicle === "string" ? raw.vehicle : "",
    sort:
      typeof raw.sort === "string" && VALID_SORT.has(raw.sort as SortOrder)
        ? (raw.sort as SortOrder)
        : "newest",
  }),
  component: TripHistoryPage,
});

function TripHistoryPage() {
  const { user } = useAuth();
  const { roles, loading: rolesLoading } = useUserRoles(user?.id);
  const isAdmin = !!roles?.includes("admin");
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/app/admin/trip-history" });

  const [searchInput, setSearchInput] = useState(search.q);
  const [debounced, setDebounced] = useState(search.q);
  const [rides, setRides] = useState<Ride[]>([]);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [profiles, setProfiles] = useState<Map<string, Profile>>(new Map());
  const [driverVehicles, setDriverVehicles] = useState<Map<string, DriverVehicle>>(new Map());
  const [fleetVehicles, setFleetVehicles] = useState<Map<string, FleetVehicle>>(new Map());
  const [payments, setPayments] = useState<Map<string, PaymentRow>>(new Map());
  const [allDrivers, setAllDrivers] = useState<{ user_id: string; full_name: string | null }[]>([]);
  const [allFleet, setAllFleet] = useState<FleetVehicle[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [totalMatches, setTotalMatches] = useState<number>(0);
  const [filterDrawer, setFilterDrawer] = useState(false);

  useEffect(() => setSearchInput(search.q), [search.q]);
  useEffect(() => {
    const t = setTimeout(() => {
      const trimmed = searchInput.trim();
      setDebounced(trimmed);
      if (trimmed !== search.q) {
        navigate({
          search: (p: HistorySearch) => ({ ...p, q: trimmed }),
          replace: true,
        });
      }
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput, search.q, navigate]);

  useEffect(() => {
    setPageSize(PAGE_SIZE);
  }, [
    search.status,
    search.driver,
    search.vehicle,
    search.sort,
    debounced,
    search.from,
    search.to,
  ]);

  // Summary counts (always overall — independent of filters)
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
  }, [isAdmin]);

  // Filter dropdown options (drivers + fleet vehicles)
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      const [{ data: drv }, { data: vp }] = await Promise.all([
        supabase
          .from("driver_profiles")
          .select("user_id")
          .order("created_at", { ascending: false }),
        supabase
          .from("vehicle_profiles")
          .select("id, vehicle_name, vehicle_type, license_plate")
          .order("vehicle_name", { ascending: true }),
      ]);
      if (cancelled) return;
      const driverIds = (drv ?? []).map((d) => d.user_id);
      if (driverIds.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("user_id, full_name")
          .in("user_id", driverIds);
        if (!cancelled) {
          const profMap = new Map((profs ?? []).map((p) => [p.user_id, p.full_name]));
          setAllDrivers(
            driverIds.map((id) => ({ user_id: id, full_name: profMap.get(id) ?? null })),
          );
        }
      }
      if (!cancelled) setAllFleet((vp ?? []) as FleetVehicle[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  // Trips list with filters
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        let userIdMatches: string[] | null = null;
        if (debounced && debounced.length >= 2) {
          const { data: profMatches } = await supabase
            .from("profiles")
            .select("user_id")
            .or(`full_name.ilike.%${debounced}%,phone.ilike.%${debounced}%`)
            .limit(50);
          userIdMatches = (profMatches ?? []).map((p) => p.user_id);
        }

        const buildQuery = (head: boolean) => {
          let q = supabase
            .from("rides")
            .select(head ? "id" : "*", head ? { count: "exact", head: true } : undefined);
          if (search.status === "scheduled") {
            q = q.eq("request_type", "scheduled").in("status", ["requested", "accepted"]);
          } else if (search.status === "active") {
            q = q.in("status", ACTIVE_STATUSES as unknown as Ride["status"][]);
          } else if (search.status !== "all") {
            q = q.eq("status", search.status);
          }
          if (search.driver) q = q.eq("driver_id", search.driver);
          if (search.vehicle) q = q.eq("vehicle_id", search.vehicle);
          if (search.from) q = q.gte("created_at", new Date(search.from).toISOString());
          if (search.to) {
            const end = new Date(search.to);
            end.setHours(23, 59, 59, 999);
            q = q.lte("created_at", end.toISOString());
          }
          if (debounced) {
            const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
              debounced,
            );
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
            q = q.or(parts.join(","));
          }
          return q;
        };

        const countRes = await buildQuery(true);
        if (cancelled) return;
        setTotalMatches(countRes.count ?? 0);

        const dataQuery = buildQuery(false)
          .order("created_at", { ascending: search.sort === "oldest", nullsFirst: false })
          .limit(pageSize);
        const { data, error: err } = await dataQuery;
        if (err) throw err;
        if (cancelled) return;

        const list = (data ?? []) as Ride[];
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
          if (!cancelled) {
            setProfiles(new Map(((profs ?? []) as Profile[]).map((p) => [p.user_id, p])));
          }
        } else setProfiles(new Map());

        const driverIds = Array.from(
          new Set(list.map((r) => r.driver_id).filter((v): v is string => !!v)),
        );
        if (driverIds.length) {
          const { data: vs } = await supabase
            .from("driver_profiles")
            .select("user_id, vehicle_model, license_plate, vehicle_type")
            .in("user_id", driverIds);
          if (!cancelled)
            setDriverVehicles(new Map(((vs ?? []) as DriverVehicle[]).map((v) => [v.user_id, v])));
        } else setDriverVehicles(new Map());

        const fleetIds = Array.from(
          new Set(list.map((r) => r.vehicle_id).filter((v): v is string => !!v)),
        );
        if (fleetIds.length) {
          const { data: fvs } = await supabase
            .from("vehicle_profiles")
            .select("id, vehicle_name, vehicle_type, license_plate")
            .in("id", fleetIds);
          if (!cancelled)
            setFleetVehicles(new Map(((fvs ?? []) as FleetVehicle[]).map((v) => [v.id, v])));
        } else setFleetVehicles(new Map());

        if (list.length) {
          const ids = list.map((r) => r.id);
          const { data: pays } = await supabase
            .from("payments")
            .select("ride_id, status, amount")
            .in("ride_id", ids);
          if (!cancelled)
            setPayments(new Map(((pays ?? []) as PaymentRow[]).map((p) => [p.ride_id, p])));
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
  }, [
    isAdmin,
    search.status,
    search.driver,
    search.vehicle,
    search.sort,
    debounced,
    search.from,
    search.to,
    pageSize,
  ]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (search.status !== "all") n++;
    if (search.driver) n++;
    if (search.vehicle) n++;
    if (search.from) n++;
    if (search.to) n++;
    if (search.sort !== "newest") n++;
    return n;
  }, [search]);

  const clearFilters = () => {
    setSearchInput("");
    navigate({
      search: {
        status: "all",
        q: "",
        from: "",
        to: "",
        driver: "",
        vehicle: "",
        sort: "newest",
      },
    });
  };

  const updateSearch = (patch: Partial<HistorySearch>) =>
    navigate({ search: (p: HistorySearch) => ({ ...p, ...patch }) } as never);

  const exportCsv = () => {
    if (!rides.length) return;
    const header = [
      "Trip ID",
      "Passenger",
      "Driver",
      "Vehicle",
      "Status",
      "Amount (ZAR)",
      "Pickup",
      "Destination",
      "Created",
      "Scheduled",
    ];
    const rows = rides.map((r) => {
      const pax = profiles.get(r.passenger_id)?.full_name ?? "";
      const drv = r.driver_id ? (profiles.get(r.driver_id)?.full_name ?? "Assigned") : "Unassigned";
      const fleet = r.vehicle_id ? fleetVehicles.get(r.vehicle_id) : null;
      const dvVeh = r.driver_id ? driverVehicles.get(r.driver_id) : null;
      const vehicleLabel = fleet
        ? [fleet.vehicle_name, fleet.vehicle_type, fleet.license_plate].filter(Boolean).join(" · ")
        : dvVeh
          ? [dvVeh.vehicle_model, dvVeh.vehicle_type, dvVeh.license_plate]
              .filter(Boolean)
              .join(" · ")
          : "";
      return [
        r.id,
        pax,
        drv,
        vehicleLabel,
        r.status,
        String(Number(r.estimated_price)),
        r.pickup_address,
        r.destination_address,
        new Date(r.created_at).toISOString(),
        r.scheduled_at ? new Date(r.scheduled_at).toISOString() : "",
      ];
    });
    const csv = [header, ...rows]
      .map((row) =>
        row
          .map((cell) => {
            const v = String(cell ?? "");
            return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
          })
          .join(","),
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trip-history-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (rolesLoading) {
    return (
      <AdminShell title="Trip History">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </AdminShell>
    );
  }
  if (!isAdmin) {
    return (
      <AdminShell title="Trip History">
        <div className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">
          Admins only.
        </div>
      </AdminShell>
    );
  }

  const hasMore = rides.length < totalMatches;
  const showingTo = Math.min(rides.length, totalMatches);

  const headerActions = (
    <>
      <Button onClick={exportCsv} className="hidden sm:inline-flex" disabled={!rides.length}>
        <Download className="mr-2 h-4 w-4" /> Export Report
      </Button>
    </>
  );

  return (
    <AdminShell
      title="Trip History"
      subtitle="View and manage previous, current, and scheduled trips"
      actions={headerActions}
    >
      {/* Summary cards */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <SummaryCard
          tone="primary"
          icon={<ListOrdered className="h-4 w-4" />}
          label="Total Trips"
          value={counts?.total ?? "—"}
        />
        <SummaryCard
          tone="info"
          icon={<CalendarRange className="h-4 w-4" />}
          label="Scheduled"
          value={counts?.scheduled ?? "—"}
        />
        <SummaryCard
          tone="warning"
          icon={<Activity className="h-4 w-4" />}
          label="Active"
          value={counts?.active ?? "—"}
        />
        <SummaryCard
          tone="success"
          icon={<CheckCircle2 className="h-4 w-4" />}
          label="Completed"
          value={counts?.completed ?? "—"}
        />
        <SummaryCard
          tone="danger"
          icon={<XCircle className="h-4 w-4" />}
          label="Cancelled"
          value={counts?.cancelled ?? "—"}
        />
      </div>

      {/* Filter toolbar */}
      <div className="mb-4 rounded-xl border bg-card p-3 sm:p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1 lg:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search passenger, driver, trip ID, pickup or destination"
              className="pl-9"
            />
          </div>

          {/* Desktop inline filters */}
          <div className="hidden flex-wrap items-center gap-2 lg:flex">
            <FilterControls
              search={search}
              onUpdate={updateSearch}
              drivers={allDrivers}
              vehicles={allFleet}
            />
            <Button
              variant="ghost"
              size="sm"
              className="h-9"
              onClick={clearFilters}
              disabled={!activeFilterCount && !debounced}
            >
              <X className="mr-1 h-4 w-4" /> Clear
            </Button>
          </div>

          {/* Mobile filter drawer trigger */}
          <div className="flex items-center gap-2 lg:hidden">
            <Sheet open={filterDrawer} onOpenChange={setFilterDrawer}>
              <SheetTrigger asChild>
                <Button variant="outline" className="flex-1">
                  <Filter className="mr-2 h-4 w-4" /> Filters
                  {activeFilterCount > 0 && (
                    <Badge className="ml-2 h-5 min-w-5 px-1.5">{activeFilterCount}</Badge>
                  )}
                </Button>
              </SheetTrigger>
              <SheetContent side="bottom" className="rounded-t-2xl">
                <SheetHeader>
                  <SheetTitle>Filter trips</SheetTitle>
                </SheetHeader>
                <div className="mt-4 space-y-3">
                  <FilterControls
                    search={search}
                    onUpdate={updateSearch}
                    drivers={allDrivers}
                    vehicles={allFleet}
                    stacked
                  />
                </div>
                <div className="mt-5 flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => {
                      clearFilters();
                      setFilterDrawer(false);
                    }}
                  >
                    Clear
                  </Button>
                  <Button className="flex-1" onClick={() => setFilterDrawer(false)}>
                    Show results
                  </Button>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* Trips list */}
      <div className="rounded-xl border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">All Trips</h2>
            <Badge variant="secondary" className="text-[10px]">
              {totalMatches}
            </Badge>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="sm:hidden"
            onClick={exportCsv}
            disabled={!rides.length}
          >
            <Download className="mr-1 h-4 w-4" /> Export
          </Button>
        </div>

        {/* Desktop table */}
        <div className="hidden lg:block">
          <TooltipProvider delayDuration={200}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Trip Details</TableHead>
                  <TableHead>Passenger</TableHead>
                  <TableHead>Driver</TableHead>
                  <TableHead>Vehicle</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Date &amp; Time</TableHead>
                  <TableHead className="w-10 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && !rides.length ? (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="py-10 text-center text-sm text-muted-foreground"
                    >
                      Loading trips…
                    </TableCell>
                  </TableRow>
                ) : !rides.length ? (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="py-10 text-center text-sm text-muted-foreground"
                    >
                      No trips match these filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  rides.map((r) => {
                    const pax = profiles.get(r.passenger_id) ?? null;
                    const drv = r.driver_id ? (profiles.get(r.driver_id) ?? null) : null;
                    const fleet = r.vehicle_id ? (fleetVehicles.get(r.vehicle_id) ?? null) : null;
                    const dvVeh = r.driver_id ? (driverVehicles.get(r.driver_id) ?? null) : null;
                    const pay = payments.get(r.id) ?? null;
                    const vehicleLabel = fleet
                      ? [fleet.vehicle_name, fleet.vehicle_type, fleet.license_plate]
                          .filter(Boolean)
                          .join(" · ")
                      : dvVeh
                        ? [dvVeh.vehicle_model, dvVeh.vehicle_type, dvVeh.license_plate]
                            .filter(Boolean)
                            .join(" · ")
                        : null;
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="max-w-[260px]">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="min-w-0 cursor-default">
                                <p className="truncate text-sm font-medium">
                                  {r.destination_address}
                                </p>
                                <p className="truncate text-xs text-muted-foreground">
                                  From {r.pickup_address}
                                </p>
                                <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                                  #{r.id.slice(0, 8).toUpperCase()}
                                </p>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">
                              <p className="text-xs">
                                <strong>To:</strong> {r.destination_address}
                              </p>
                              <p className="text-xs">
                                <strong>From:</strong> {r.pickup_address}
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </TableCell>
                        <TableCell className="max-w-[160px]">
                          <p className="truncate text-sm">{pax?.full_name ?? "—"}</p>
                          {pax?.phone && (
                            <p className="truncate text-xs text-muted-foreground">{pax.phone}</p>
                          )}
                        </TableCell>
                        <TableCell className="max-w-[160px]">
                          <p className="truncate text-sm">
                            {drv?.full_name ?? (r.driver_id ? "Assigned" : "Unassigned")}
                          </p>
                          {drv?.phone && (
                            <p className="truncate text-xs text-muted-foreground">{drv.phone}</p>
                          )}
                        </TableCell>
                        <TableCell className="max-w-[160px]">
                          <p className="truncate text-sm">{vehicleLabel ?? "—"}</p>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
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
                                className="w-fit text-[10px] capitalize"
                              >
                                {pay.status}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right text-sm font-semibold tabular-nums">
                          {formatZAR(Number(r.estimated_price))}
                        </TableCell>
                        <TableCell>
                          <p className="text-xs">
                            {new Date(r.created_at).toLocaleDateString(undefined, {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                            })}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {new Date(r.created_at).toLocaleTimeString(undefined, {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </p>
                        </TableCell>
                        <TableCell className="text-right">
                          <TripActions ride={r} passenger={pax} driver={drv} />
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </TooltipProvider>
        </div>

        {/* Mobile cards */}
        <ul className="divide-y lg:hidden">
          {loading && !rides.length ? (
            <li className="px-4 py-8 text-center text-sm text-muted-foreground">Loading trips…</li>
          ) : !rides.length ? (
            <li className="px-4 py-8 text-center text-sm text-muted-foreground">
              No trips match these filters.
            </li>
          ) : (
            rides.map((r) => {
              const pax = profiles.get(r.passenger_id) ?? null;
              const drv = r.driver_id ? (profiles.get(r.driver_id) ?? null) : null;
              const fleet = r.vehicle_id ? (fleetVehicles.get(r.vehicle_id) ?? null) : null;
              const dvVeh = r.driver_id ? (driverVehicles.get(r.driver_id) ?? null) : null;
              const pay = payments.get(r.id) ?? null;
              const vehicleLabel = fleet
                ? [fleet.vehicle_name, fleet.vehicle_type, fleet.license_plate]
                    .filter(Boolean)
                    .join(" · ")
                : dvVeh
                  ? [dvVeh.vehicle_model, dvVeh.vehicle_type, dvVeh.license_plate]
                      .filter(Boolean)
                      .join(" · ")
                  : null;
              const when = r.scheduled_at ?? r.updated_at ?? r.created_at;
              return (
                <li key={r.id} className="space-y-2 px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="font-mono text-[10px]">
                          #{r.id.slice(0, 8).toUpperCase()}
                        </Badge>
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
                            className="text-[10px] capitalize"
                          >
                            {pay.status}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold tabular-nums">
                        {formatZAR(Number(r.estimated_price))}
                      </p>
                      <TripActions ride={r} passenger={pax} driver={drv} />
                    </div>
                  </div>

                  <div className="space-y-0.5">
                    <p className="line-clamp-2 text-sm font-medium leading-snug">
                      {r.destination_address}
                    </p>
                    <p className="line-clamp-2 text-xs text-muted-foreground leading-snug">
                      From {r.pickup_address}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    <Field label="Passenger" value={pax?.full_name ?? "—"} />
                    <Field
                      label="Driver"
                      value={drv?.full_name ?? (r.driver_id ? "Assigned" : "Unassigned")}
                    />
                    <Field label="Vehicle" value={vehicleLabel ?? "—"} />
                    <Field
                      label={r.scheduled_at ? "Scheduled" : "Updated"}
                      value={new Date(when).toLocaleString(undefined, {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    />
                  </div>
                </li>
              );
            })
          )}
        </ul>

        {/* Pagination */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
          <p className="text-xs text-muted-foreground">
            {totalMatches === 0 ? "No results" : `Showing 1–${showingTo} of ${totalMatches} trips`}
          </p>
          <div className="flex items-center gap-2">
            {hasMore && (
              <Button size="sm" variant="outline" onClick={() => setPageSize((s) => s + PAGE_SIZE)}>
                {loading ? "Loading…" : "Load more"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </AdminShell>
  );
}

function FilterControls({
  search,
  onUpdate,
  drivers,
  vehicles,
  stacked = false,
}: {
  search: HistorySearch;
  onUpdate: (patch: Partial<HistorySearch>) => void;
  drivers: { user_id: string; full_name: string | null }[];
  vehicles: FleetVehicle[];
  stacked?: boolean;
}) {
  const update = onUpdate;
  const wrap = stacked ? "grid grid-cols-1 gap-3" : "flex flex-wrap items-center gap-2";
  const fieldCls = stacked ? "w-full" : "w-[150px]";
  return (
    <div className={wrap}>
      <Select value={search.status} onValueChange={(v) => update({ status: v as StatusFilter })}>
        <SelectTrigger className={fieldCls}>
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          {STATUS_OPTIONS.map((o) => (
            <SelectItem key={o.key} value={o.key}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={search.driver || "__all"}
        onValueChange={(v) => update({ driver: v === "__all" ? "" : v })}
      >
        <SelectTrigger className={fieldCls}>
          <SelectValue placeholder="All Drivers" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all">All Drivers</SelectItem>
          {drivers.map((d) => (
            <SelectItem key={d.user_id} value={d.user_id}>
              {d.full_name ?? d.user_id.slice(0, 8)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={search.vehicle || "__all"}
        onValueChange={(v) => update({ vehicle: v === "__all" ? "" : v })}
      >
        <SelectTrigger className={fieldCls}>
          <SelectValue placeholder="All Vehicles" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all">All Vehicles</SelectItem>
          {vehicles.map((v) => (
            <SelectItem key={v.id} value={v.id}>
              {[v.vehicle_name, v.license_plate].filter(Boolean).join(" · ") || v.id.slice(0, 8)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Input
        type="date"
        aria-label="From date"
        value={search.from}
        onChange={(e) => update({ from: e.target.value })}
        className={fieldCls}
      />
      <Input
        type="date"
        aria-label="To date"
        value={search.to}
        onChange={(e) => update({ to: e.target.value })}
        className={fieldCls}
      />

      <Select value={search.sort} onValueChange={(v) => update({ sort: v as SortOrder })}>
        <SelectTrigger className={fieldCls}>
          <SelectValue placeholder="Sort" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="newest">Newest first</SelectItem>
          <SelectItem value="oldest">Oldest first</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function TripActions({
  ride,
  passenger,
  driver,
}: {
  ride: Ride;
  passenger: Profile | null;
  driver: Profile | null;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <MoreVertical className="h-4 w-4" />
          <span className="sr-only">Trip actions</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="text-xs">Trip actions</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link to="/app/trip/$rideId" params={{ rideId: ride.id }}>
            <ExternalLink className="mr-2 h-4 w-4" /> View details
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/app/admin/trips" search={{ status: "all", q: ride.id }}>
            <UserPlus className="mr-2 h-4 w-4" /> Assign / reassign
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!passenger?.phone}
          onClick={() => passenger?.phone && window.open(`tel:${passenger.phone}`)}
        >
          <Phone className="mr-2 h-4 w-4" /> Contact passenger
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!driver?.phone}
          onClick={() => driver?.phone && window.open(`tel:${driver.phone}`)}
        >
          <Phone className="mr-2 h-4 w-4" /> Contact driver
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!passenger?.phone}
          onClick={() => passenger?.phone && window.open(`sms:${passenger.phone}`)}
        >
          <MessageSquare className="mr-2 h-4 w-4" /> SMS passenger
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/app/admin/trips" search={{ status: "all", q: ride.id }}>
            Update status
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SummaryCard({
  tone,
  icon,
  label,
  value,
}: {
  tone: "primary" | "info" | "warning" | "success" | "danger";
  icon: React.ReactNode;
  label: string;
  value: number | string;
}) {
  const toneClass = {
    primary: "bg-primary/10 text-primary",
    info: "bg-[oklch(0.62_0.18_290)]/10 text-[oklch(0.55_0.2_290)]",
    warning: "bg-warning/15 text-[oklch(0.55_0.18_55)]",
    success: "bg-success/15 text-success",
    danger: "bg-destructive/10 text-destructive",
  }[tone];
  return (
    <div className="rounded-xl border bg-card p-3 sm:p-4">
      <div className="flex items-center gap-3">
        <span className={cn("grid h-9 w-9 place-items-center rounded-lg", toneClass)}>{icon}</span>
        <div className="min-w-0">
          <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <p className="text-lg font-bold leading-tight sm:text-xl">{value}</p>
        </div>
      </div>
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
