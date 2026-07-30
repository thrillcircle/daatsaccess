import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { LifeBuoy, Loader2, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useUserRoles } from "@/hooks/use-auth";
import { AdminShell } from "@/components/AdminShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  SUPPORT_CATEGORIES,
  SUPPORT_PRIORITIES,
  SUPPORT_STATUSES,
  supportAge,
  supportCategoryLabel,
  supportPriorityLabel,
  supportStatusLabel,
  type SupportPriority,
  type SupportStatus,
  type SupportTicket,
} from "@/lib/support";

const db = supabase as any;

type ProfileSummary = { user_id: string; full_name: string | null; phone: string | null };
type SupportSearch = {
  q: string;
  status: "all" | SupportStatus;
  priority: "all" | SupportPriority;
  category: "all" | string;
};

const VALID_STATUS = new Set(["all", ...SUPPORT_STATUSES.map((item) => item.value)]);
const VALID_PRIORITY = new Set(["all", ...SUPPORT_PRIORITIES.map((item) => item.value)]);
const VALID_CATEGORY = new Set(["all", ...SUPPORT_CATEGORIES.map((item) => item.value)]);

export const Route = createFileRoute("/app/admin/support")({
  head: () => ({ meta: [{ title: "Support — Admin" }] }),
  validateSearch: (raw: Record<string, unknown>): SupportSearch => ({
    q: typeof raw.q === "string" ? raw.q : "",
    status:
      typeof raw.status === "string" && VALID_STATUS.has(raw.status)
        ? (raw.status as SupportSearch["status"])
        : "all",
    priority:
      typeof raw.priority === "string" && VALID_PRIORITY.has(raw.priority)
        ? (raw.priority as SupportSearch["priority"])
        : "all",
    category:
      typeof raw.category === "string" && VALID_CATEGORY.has(raw.category) ? raw.category : "all",
  }),
  component: AdminSupportPage,
});

function AdminSupportPage() {
  const { user, loading: authLoading } = useAuth();
  const { roles, loading: rolesLoading } = useUserRoles(user?.id);
  const navigate = useNavigate();
  const search = Route.useSearch();
  const isAdmin = !!roles?.includes("admin");
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [profiles, setProfiles] = useState<Record<string, ProfileSummary>>({});
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
      const { data, error: ticketError } = await db
        .from("support_tickets")
        .select("*")
        .order("updated_at", { ascending: false });
      if (cancelled) return;
      if (ticketError) {
        setError(ticketError.message);
        setTickets([]);
        setLoading(false);
        return;
      }
      const list = (data ?? []) as SupportTicket[];
      setTickets(list);
      const ids = Array.from(
        new Set(
          list
            .flatMap((ticket) => [
              ticket.created_by,
              ticket.passenger_id,
              ticket.driver_id,
              ticket.assigned_admin_id,
            ])
            .filter((value): value is string => !!value),
        ),
      );
      if (ids.length) {
        const { data: profileRows } = await supabase
          .from("profiles")
          .select("user_id,full_name,phone")
          .in("user_id", ids);
        if (!cancelled) {
          setProfiles(
            Object.fromEntries(
              ((profileRows ?? []) as ProfileSummary[]).map((profile) => [profile.user_id, profile]),
            ),
          );
        }
      } else {
        setProfiles({});
      }
      setLoading(false);
    };
    void load();
    const channel = supabase
      .channel("admin-support-dashboard")
      .on("postgres_changes", { event: "*", schema: "public", table: "support_tickets" }, () =>
        void load(),
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [isAdmin]);

  const filtered = useMemo(() => {
    const query = search.q.trim().toLowerCase();
    return tickets.filter((ticket) => {
      if (search.status !== "all" && ticket.status !== search.status) return false;
      if (search.priority !== "all" && ticket.priority !== search.priority) return false;
      if (search.category !== "all" && ticket.category !== search.category) return false;
      if (!query) return true;
      const requester = profiles[ticket.created_by];
      return [
        ticket.ticket_reference,
        ticket.subject,
        ticket.description,
        requester?.full_name,
        requester?.phone,
        ticket.ride_id,
        ticket.service_booking_id,
      ].some((value) => value?.toLowerCase().includes(query));
    });
  }, [tickets, profiles, search]);

  const metrics = useMemo(() => {
    const openStatuses = new Set(["open", "triage", "assigned", "waiting_for_user", "in_progress"]);
    const open = tickets.filter((ticket) => openStatuses.has(ticket.status));
    const resolvedToday = tickets.filter(
      (ticket) =>
        ticket.resolved_at &&
        new Date(ticket.resolved_at).toDateString() === new Date().toDateString(),
    ).length;
    const averageOpenAgeHours = open.length
      ? open.reduce(
          (sum, ticket) => sum + (Date.now() - new Date(ticket.created_at).getTime()) / 3_600_000,
          0,
        ) / open.length
      : 0;
    return {
      open: open.length,
      urgent: open.filter((ticket) => ticket.priority === "urgent").length,
      unassigned: open.filter((ticket) => !ticket.assigned_admin_id).length,
      waiting: open.filter((ticket) => ticket.status === "waiting_for_user").length,
      inProgress: open.filter((ticket) => ticket.status === "in_progress").length,
      resolvedToday,
      averageOpenAgeHours,
    };
  }, [tickets]);

  const updateSearch = (patch: Partial<SupportSearch>) =>
    navigate({
      to: "/app/admin/support",
      search: { ...search, ...patch },
    });

  if (authLoading || rolesLoading || (user && roles === null)) {
    return (
      <AdminShell title="Support">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </AdminShell>
    );
  }
  if (!isAdmin) return null;

  return (
    <AdminShell
      title="Support"
      subtitle="Triage, assign and resolve passenger and driver support tickets."
      actions={
        <Button asChild size="sm" variant="outline">
          <Link to="/app/support">Create ticket</Link>
        </Button>
      }
    >
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        <Metric label="Open" value={metrics.open} />
        <Metric label="Urgent" value={metrics.urgent} emphasize />
        <Metric label="Unassigned" value={metrics.unassigned} />
        <Metric label="Waiting" value={metrics.waiting} />
        <Metric label="In progress" value={metrics.inProgress} />
        <Metric label="Resolved today" value={metrics.resolvedToday} />
        <Metric
          label="Avg open age"
          value={metrics.averageOpenAgeHours < 24 ? `${metrics.averageOpenAgeHours.toFixed(1)}h` : `${(metrics.averageOpenAgeHours / 24).toFixed(1)}d`}
        />
      </section>

      <section className="mt-5 rounded-2xl border bg-card p-4 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_180px_160px_200px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search.q}
              onChange={(event) => updateSearch({ q: event.target.value })}
              placeholder="Search ticket, requester, trip or booking…"
              className="pl-9"
            />
          </div>
          <select
            value={search.status}
            onChange={(event) => updateSearch({ status: event.target.value as SupportSearch["status"] })}
            className="h-10 rounded-md border bg-background px-3 text-sm"
          >
            <option value="all">All statuses</option>
            {SUPPORT_STATUSES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <select
            value={search.priority}
            onChange={(event) =>
              updateSearch({ priority: event.target.value as SupportSearch["priority"] })
            }
            className="h-10 rounded-md border bg-background px-3 text-sm"
          >
            <option value="all">All priorities</option>
            {SUPPORT_PRIORITIES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <select
            value={search.category}
            onChange={(event) => updateSearch({ category: event.target.value })}
            className="h-10 rounded-md border bg-background px-3 text-sm"
          >
            <option value="all">All categories</option>
            {SUPPORT_CATEGORIES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="mt-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <LifeBuoy className="h-4 w-4" /> Tickets
          </h2>
          <span className="text-xs text-muted-foreground">
            {filtered.length} of {tickets.length}
          </span>
        </div>
        {error ? (
          <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
            {error}
          </div>
        ) : loading ? (
          <div className="rounded-2xl border bg-card p-8 text-center text-sm text-muted-foreground">
            <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> Loading support tickets…
          </div>
        ) : !filtered.length ? (
          <div className="rounded-2xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
            No support tickets match these filters.
          </div>
        ) : (
          <ul className="space-y-3">
            {filtered.map((ticket) => {
              const requester = profiles[ticket.created_by];
              const assigned = ticket.assigned_admin_id ? profiles[ticket.assigned_admin_id] : null;
              return (
                <li key={ticket.id}>
                  <Link
                    to="/app/admin/support/$ticketId"
                    params={{ ticketId: ticket.id }}
                    className="block rounded-2xl border bg-card p-4 shadow-sm transition hover:border-primary/40"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-xs font-semibold text-primary">{ticket.ticket_reference}</p>
                          <Badge variant="outline">{ticket.requester_role}</Badge>
                        </div>
                        <p className="mt-1 truncate font-semibold">{ticket.subject}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {requester?.full_name ?? "Unknown requester"} · {supportCategoryLabel(ticket.category)} · age {supportAge(ticket.created_at)}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Assigned: {assigned?.full_name ?? (ticket.assigned_admin_id ? "Administrator" : "Unassigned")}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2 sm:flex-col sm:items-end">
                        <Badge variant={ticket.priority === "urgent" ? "destructive" : "outline"}>
                          {supportPriorityLabel(ticket.priority)}
                        </Badge>
                        <Badge variant="secondary">{supportStatusLabel(ticket.status)}</Badge>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </AdminShell>
  );
}

function Metric({ label, value, emphasize }: { label: string; value: string | number; emphasize?: boolean }) {
  return (
    <div className={`rounded-2xl border bg-card p-4 shadow-sm ${emphasize ? "border-destructive/40" : ""}`}>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${emphasize ? "text-destructive" : ""}`}>{value}</p>
    </div>
  );
}
