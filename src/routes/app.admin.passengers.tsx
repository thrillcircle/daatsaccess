import { createFileRoute, Link, useNavigate, type SearchSchemaInput } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Activity, Loader2, Phone, Search, UserCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useUserRoles } from "@/hooks/use-auth";
import { AdminShell } from "@/components/AdminShell";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import type { Database } from "@/integrations/supabase/types";

const db = supabase;
type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Ride = Pick<
  Database["public"]["Tables"]["rides"]["Row"],
  "id" | "passenger_id" | "status" | "request_type" | "scheduled_at" | "created_at" | "updated_at"
>;
type Booking = Pick<
  Database["public"]["Tables"]["service_bookings"]["Row"],
  "id" | "booked_by_user_id" | "status" | "created_at" | "updated_at"
>;
type SupportTicketSummary = {
  id: string;
  passenger_id: string | null;
  created_by: string;
  status: string;
  updated_at: string;
};

type PassengerFilter = "all" | "active" | "upcoming" | "support" | "incomplete" | "no_history";
type PassengerSearch = { q: string; filter: PassengerFilter };
const VALID_FILTERS = new Set<PassengerFilter>([
  "all",
  "active",
  "upcoming",
  "support",
  "incomplete",
  "no_history",
]);

export const Route = createFileRoute("/app/admin/passengers")({
  head: () => ({ meta: [{ title: "Passengers — Admin" }] }),
  validateSearch: (raw: Record<string, unknown> & SearchSchemaInput): PassengerSearch => ({
    q: typeof raw.q === "string" ? raw.q : "",
    filter:
      typeof raw.filter === "string" && VALID_FILTERS.has(raw.filter as PassengerFilter)
        ? (raw.filter as PassengerFilter)
        : "all",
  }),
  component: PassengersPage,
});

type PassengerStats = {
  active: number;
  upcoming: number;
  completed: number;
  cancelled: number;
  bookings: number;
  openSupport: number;
  lastActivity: string | null;
};

function PassengersPage() {
  const { user, loading: authLoading } = useAuth();
  const { roles, loading: rolesLoading } = useUserRoles(user?.id);
  const navigate = useNavigate();
  const search = Route.useSearch();
  const isAdmin = !!roles?.includes("admin");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [rides, setRides] = useState<Ride[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [tickets, setTickets] = useState<SupportTicketSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || rolesLoading || roles === null) return;
    if (!user || !isAdmin) navigate({ to: "/app" });
  }, [authLoading, rolesLoading, roles, user, isAdmin, navigate]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      const { data: roleRows, error: roleError } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "passenger");
      if (cancelled) return;
      if (roleError) {
        setError(roleError.message);
        setLoading(false);
        return;
      }
      const ids = Array.from(new Set((roleRows ?? []).map((row) => row.user_id)));
      if (!ids.length) {
        setProfiles([]);
        setRides([]);
        setBookings([]);
        setTickets([]);
        setLoading(false);
        return;
      }
      const [profileResult, rideResult, bookingResult, ticketResult] = await Promise.all([
        supabase
          .from("profiles")
          .select("*")
          .in("user_id", ids)
          .order("full_name", { ascending: true, nullsFirst: false }),
        supabase
          .from("rides")
          .select("id,passenger_id,status,request_type,scheduled_at,created_at,updated_at")
          .in("passenger_id", ids),
        supabase
          .from("service_bookings")
          .select("id,booked_by_user_id,status,created_at,updated_at")
          .in("booked_by_user_id", ids),
        db
          .from("support_tickets")
          .select("id,passenger_id,created_by,status,updated_at")
          .in("passenger_id", ids),
      ]);
      if (cancelled) return;
      if (profileResult.error) setError(profileResult.error.message);
      else if (rideResult.error) setError(rideResult.error.message);
      else if (bookingResult.error) setError(bookingResult.error.message);
      else if (ticketResult.error) setError(ticketResult.error.message);
      setProfiles((profileResult.data ?? []) as Profile[]);
      setRides((rideResult.data ?? []) as Ride[]);
      setBookings((bookingResult.data ?? []) as Booking[]);
      setTickets((ticketResult.data ?? []) as SupportTicketSummary[]);
      setLoading(false);
    };
    void load();
    const channel = supabase
      .channel("admin-passenger-operations")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "profiles" },
        () => void load(),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "rides" }, () => void load())
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "service_bookings" },
        () => void load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "support_tickets" },
        () => void load(),
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [isAdmin]);

  const stats = useMemo(() => {
    const activeStatuses = new Set([
      "requested",
      "accepted",
      "driver_arriving",
      "arrived",
      "in_progress",
    ]);
    const openSupportStatuses = new Set([
      "open",
      "triage",
      "assigned",
      "waiting_for_user",
      "in_progress",
    ]);
    const map: Record<string, PassengerStats> = {};
    for (const profile of profiles) {
      const passengerRides = rides.filter((ride) => ride.passenger_id === profile.user_id);
      const passengerBookings = bookings.filter(
        (booking) => booking.booked_by_user_id === profile.user_id,
      );
      const passengerTickets = tickets.filter(
        (ticket) =>
          ticket.passenger_id === profile.user_id || ticket.created_by === profile.user_id,
      );
      const dates = [
        ...passengerRides.map((ride) => ride.updated_at || ride.created_at),
        ...passengerBookings.map((booking) => booking.updated_at || booking.created_at),
        ...passengerTickets.map((ticket) => ticket.updated_at),
        profile.created_at,
      ];
      map[profile.user_id] = {
        active: passengerRides.filter((ride) => activeStatuses.has(ride.status)).length,
        upcoming: passengerRides.filter(
          (ride) =>
            ride.request_type === "scheduled" &&
            (ride.status === "requested" || ride.status === "accepted"),
        ).length,
        completed: passengerRides.filter((ride) => ride.status === "completed").length,
        cancelled: passengerRides.filter((ride) => ride.status === "cancelled").length,
        bookings: passengerBookings.length,
        openSupport: passengerTickets.filter((ticket) => openSupportStatuses.has(ticket.status))
          .length,
        lastActivity: dates.length
          ? dates.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0]
          : null,
      };
    }
    return map;
  }, [profiles, rides, bookings, tickets]);

  const filtered = useMemo(() => {
    const query = search.q.trim().toLowerCase();
    return profiles.filter((profile) => {
      const summary = stats[profile.user_id] ?? {
        active: 0,
        upcoming: 0,
        completed: 0,
        cancelled: 0,
        bookings: 0,
        openSupport: 0,
        lastActivity: null,
      };
      if (search.filter === "active" && summary.active === 0) return false;
      if (search.filter === "upcoming" && summary.upcoming === 0) return false;
      if (search.filter === "support" && summary.openSupport === 0) return false;
      if (search.filter === "incomplete" && profile.full_name && profile.phone) return false;
      if (
        search.filter === "no_history" &&
        summary.completed + summary.cancelled + summary.active + summary.upcoming > 0
      )
        return false;
      if (!query) return true;
      return (
        (profile.full_name?.toLowerCase().includes(query) ?? false) ||
        (profile.phone?.toLowerCase().includes(query) ?? false) ||
        profile.user_id.toLowerCase().includes(query)
      );
    });
  }, [profiles, stats, search]);

  const updateSearch = (patch: Partial<PassengerSearch>) =>
    navigate({ to: "/app/admin/passengers", search: { ...search, ...patch } });

  if (authLoading || rolesLoading || (user && roles === null)) {
    return (
      <AdminShell title="Passengers">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </AdminShell>
    );
  }
  if (!isAdmin) return null;

  return (
    <AdminShell
      title="Passengers"
      subtitle="Passenger profiles, trip activity, service bookings and support history."
    >
      <section className="rounded-2xl border bg-card p-4 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[minmax(240px,1fr)_220px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search.q}
              onChange={(event) => updateSearch({ q: event.target.value })}
              placeholder="Search by name, phone or user ID…"
              className="pl-9"
            />
          </div>
          <select
            value={search.filter}
            onChange={(event) => updateSearch({ filter: event.target.value as PassengerFilter })}
            className="h-10 rounded-md border bg-background px-3 text-sm"
          >
            <option value="all">All passengers</option>
            <option value="active">Active trip</option>
            <option value="upcoming">Upcoming trip</option>
            <option value="support">Open support case</option>
            <option value="incomplete">Incomplete profile</option>
            <option value="no_history">No trip history</option>
          </select>
        </div>
      </section>

      <div className="mb-3 mt-5 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Passenger records
        </h2>
        <span className="text-xs text-muted-foreground">
          {filtered.length} of {profiles.length}
        </span>
      </div>

      {error ? (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : loading ? (
        <div className="rounded-2xl border bg-card p-8 text-center text-sm text-muted-foreground">
          <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> Loading passengers…
        </div>
      ) : !filtered.length ? (
        <div className="rounded-2xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
          No passengers match these filters.
        </div>
      ) : (
        <ul className="grid gap-3 xl:grid-cols-2">
          {filtered.map((profile) => {
            const summary = stats[profile.user_id];
            const complete = !!profile.full_name && !!profile.phone;
            return (
              <li key={profile.user_id}>
                <Link
                  to="/app/admin/passengers/$passengerId"
                  params={{ passengerId: profile.user_id }}
                  className="block rounded-2xl border bg-card p-4 shadow-sm transition hover:border-primary/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                        <UserCircle2 className="h-5 w-5" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-semibold">
                          {profile.full_name ?? "Unnamed passenger"}
                        </p>
                        {profile.phone ? (
                          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                            <Phone className="h-3 w-3" /> {profile.phone}
                          </p>
                        ) : (
                          <p className="mt-1 text-xs text-muted-foreground">No phone</p>
                        )}
                        <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                          {profile.user_id.slice(0, 8)}…
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge variant={complete ? "outline" : "secondary"}>
                        {complete ? "Complete" : "Incomplete"}
                      </Badge>
                      {summary?.active ? <Badge>Active trip</Badge> : null}
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-2 border-t pt-3 text-center sm:grid-cols-6">
                    <Stat label="Active" value={summary?.active ?? 0} />
                    <Stat label="Upcoming" value={summary?.upcoming ?? 0} />
                    <Stat label="Completed" value={summary?.completed ?? 0} />
                    <Stat label="Cancelled" value={summary?.cancelled ?? 0} />
                    <Stat label="Services" value={summary?.bookings ?? 0} />
                    <Stat label="Support" value={summary?.openSupport ?? 0} />
                  </div>
                  <p className="mt-3 flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Activity className="h-3 w-3" /> Last activity{" "}
                    {summary?.lastActivity
                      ? new Date(summary.lastActivity).toLocaleString("en-ZA")
                      : "—"}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </AdminShell>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold">{value}</p>
    </div>
  );
}
