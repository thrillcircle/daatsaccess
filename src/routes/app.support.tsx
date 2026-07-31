import { createFileRoute, Link, useNavigate, type SearchSchemaInput } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { LifeBuoy, Loader2, MessageCircleQuestion, Plus, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useUserRoles } from "@/hooks/use-auth";
import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  SUPPORT_CATEGORIES,
  SUPPORT_FAQS,
  containsUrgentSupportLanguage,
  supportAge,
  supportCategoryLabel,
  supportPriorityLabel,
  supportStatusLabel,
  type SupportCategory,
  type SupportPriority,
  type SupportRole,
  type SupportTicket,
} from "@/lib/support";

const db = supabase;

type RideOption = {
  id: string;
  pickup_address: string;
  destination_address: string;
  status: string;
  created_at: string;
};

type BookingOption = {
  id: string;
  booking_reference: string;
  service_type: string;
  status: string;
};

type SupportSearch = {
  rideId: string;
  bookingId: string;
  category: SupportCategory | "";
  subject: string;
};

const SUPPORT_CATEGORY_VALUES = new Set(SUPPORT_CATEGORIES.map((item) => item.value));

export const Route = createFileRoute("/app/support")({
  validateSearch: (search: Record<string, unknown> & SearchSchemaInput): SupportSearch => ({
    rideId: typeof search.rideId === "string" ? search.rideId : "",
    bookingId: typeof search.bookingId === "string" ? search.bookingId : "",
    category:
      typeof search.category === "string" &&
      SUPPORT_CATEGORY_VALUES.has(search.category as SupportCategory)
        ? (search.category as SupportCategory)
        : "",
    subject: typeof search.subject === "string" ? search.subject.slice(0, 160) : "",
  }),
  head: () => ({ meta: [{ title: "Support — Access" }] }),
  component: SupportPage,
});

function SupportPage() {
  const { user, loading: authLoading } = useAuth();
  const { roles, loading: rolesLoading } = useUserRoles(user?.id);
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [rides, setRides] = useState<RideOption[]>([]);
  const [bookings, setBookings] = useState<BookingOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(
    Boolean(search.rideId || search.bookingId || search.category || search.subject),
  );
  const [assistantAnswer, setAssistantAnswer] = useState<string | null>(null);
  const [requesterRole, setRequesterRole] = useState<SupportRole>("passenger");
  const [category, setCategory] = useState<SupportCategory>(search.category || "trip_issue");
  const [priority, setPriority] = useState<Extract<SupportPriority, "normal" | "high">>("normal");
  const [subject, setSubject] = useState(search.subject);
  const [description, setDescription] = useState("");
  const [rideId, setRideId] = useState(search.rideId);
  const [bookingId, setBookingId] = useState(search.bookingId);

  const availableRoles = useMemo<SupportRole[]>(() => {
    const next: SupportRole[] = [];
    if (roles?.includes("passenger")) next.push("passenger");
    if (roles?.includes("driver")) next.push("driver");
    if (roles?.includes("admin")) next.push("admin");
    return next.length ? next : ["passenger"];
  }, [roles]);

  useEffect(() => {
    if (!availableRoles.includes(requesterRole)) setRequesterRole(availableRoles[0]);
  }, [availableRoles, requesterRole]);

  useEffect(() => {
    if (search.rideId) setRideId(search.rideId);
    if (search.bookingId) setBookingId(search.bookingId);
    if (search.category) setCategory(search.category);
    if (search.subject) setSubject(search.subject);
    if (search.rideId || search.bookingId || search.category || search.subject) setShowForm(true);
  }, [search.bookingId, search.category, search.rideId, search.subject]);

  useEffect(() => {
    if (authLoading || rolesLoading) return;
    if (!user) navigate({ to: "/auth" });
  }, [authLoading, rolesLoading, user, navigate]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const [ticketResult, rideResult, bookingResult] = await Promise.all([
        db.from("support_tickets").select("*").order("updated_at", { ascending: false }),
        supabase
          .from("rides")
          .select("id,pickup_address,destination_address,status,created_at")
          .or(`passenger_id.eq.${user.id},driver_id.eq.${user.id}`)
          .order("created_at", { ascending: false })
          .limit(30),
        supabase
          .from("service_bookings")
          .select("id,booking_reference,service_type,status")
          .eq("booked_by_user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(30),
      ]);
      if (cancelled) return;
      if (ticketResult.error) toast.error(ticketResult.error.message);
      setTickets((ticketResult.data ?? []) as SupportTicket[]);
      setRides((rideResult.data ?? []) as RideOption[]);
      setBookings((bookingResult.data ?? []) as BookingOption[]);
      setLoading(false);
    };
    void load();
    const channel = supabase
      .channel(`support-centre-${user.id}`)
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
  }, [user]);

  async function createTicket() {
    if (!user) return;
    if (subject.trim().length < 3 || description.trim().length < 3) {
      toast.error("Add a subject and a clear description");
      return;
    }
    setCreating(true);
    const { data, error } = await db.rpc("support_create_ticket", {
      p_requester_role: requesterRole,
      p_category: category,
      p_subject: subject.trim(),
      p_description: description.trim(),
      p_priority: priority,
      p_ride_id: rideId || undefined,
      p_service_booking_id: bookingId || undefined,
      p_passenger_id: undefined,
      p_driver_id: undefined,
    });
    setCreating(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const created = data as SupportTicket;
    toast.success(`${created.ticket_reference} created`);
    setSubject("");
    setDescription("");
    setRideId("");
    setBookingId("");
    setPriority("normal");
    setShowForm(false);
    navigate({ to: "/app/support/$ticketId", params: { ticketId: created.id } });
  }

  const urgentWarning = containsUrgentSupportLanguage(`${subject} ${description}`);

  if (authLoading || rolesLoading || !user) {
    return (
      <AppShell title="Support">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading support…
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell title="Support">
      <section className="rounded-2xl border bg-card p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <LifeBuoy className="h-5 w-5 text-primary" />
              <h1 className="text-lg font-semibold">Access Support</h1>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Get guided help or create a ticket for Access Operations.
            </p>
          </div>
          <Button size="sm" onClick={() => setShowForm((value) => !value)}>
            <Plus className="mr-1 h-4 w-4" /> New ticket
          </Button>
        </div>
      </section>

      <section className="mt-4 rounded-2xl border bg-card p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <MessageCircleQuestion className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">Access Support Assistant</h2>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Automated guidance with escalation to Access Support. It cannot cancel trips, issue
          refunds, assign drivers, or act as an emergency service.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {SUPPORT_FAQS.map((faq) => (
            <Button
              key={faq.question}
              type="button"
              size="sm"
              variant="outline"
              className="h-auto whitespace-normal text-left text-xs"
              onClick={() => {
                setAssistantAnswer(faq.answer);
                setCategory(faq.category);
                setSubject(faq.subject);
              }}
            >
              {faq.question}
            </Button>
          ))}
        </div>
        {assistantAnswer ? (
          <div className="mt-3 rounded-xl bg-secondary p-3 text-sm">
            <p>{assistantAnswer}</p>
            <Button className="mt-3" size="sm" onClick={() => setShowForm(true)}>
              Create a support ticket
            </Button>
          </div>
        ) : null}
      </section>

      {showForm ? (
        <section className="mt-4 space-y-4 rounded-2xl border bg-card p-4 shadow-sm">
          <div>
            <h2 className="font-semibold">Create support ticket</h2>
            <p className="text-xs text-muted-foreground">
              Link the relevant trip or service booking where possible.
            </p>
          </div>

          {availableRoles.length > 1 ? (
            <div className="space-y-1.5">
              <Label htmlFor="support-role">I need help as</Label>
              <select
                id="support-role"
                value={requesterRole}
                onChange={(event) => setRequesterRole(event.target.value as SupportRole)}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              >
                {availableRoles.map((role) => (
                  <option key={role} value={role}>
                    {role[0].toUpperCase() + role.slice(1)}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="support-category">Category</Label>
            <select
              id="support-category"
              value={category}
              onChange={(event) => setCategory(event.target.value as SupportCategory)}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            >
              {SUPPORT_CATEGORIES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="support-priority">How quickly do you need help?</Label>
            <select
              id="support-priority"
              value={priority}
              onChange={(event) => setPriority(event.target.value as "normal" | "high")}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            >
              <option value="normal">Normal</option>
              <option value="high">High — blocking my trip or service</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="support-ride">Related trip</Label>
            <select
              id="support-ride"
              value={rideId}
              onChange={(event) => setRideId(event.target.value)}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            >
              <option value="">No trip selected</option>
              {rides.map((ride) => (
                <option key={ride.id} value={ride.id}>
                  {ride.destination_address} · {ride.status.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="support-booking">Related service booking</Label>
            <select
              id="support-booking"
              value={bookingId}
              onChange={(event) => setBookingId(event.target.value)}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            >
              <option value="">No booking selected</option>
              {bookings.map((booking) => (
                <option key={booking.id} value={booking.id}>
                  {booking.booking_reference} · {booking.service_type.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="support-subject">Subject</Label>
            <Input
              id="support-subject"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              maxLength={160}
              placeholder="What do you need help with?"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="support-description">Description</Label>
            <Textarea
              id="support-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={5000}
              rows={5}
              placeholder="Describe what happened and what help you need."
            />
          </div>

          {requesterRole === "driver" && category === "vehicle_issue" ? (
            <p className="rounded-xl border border-amber-400/40 bg-amber-50 p-3 text-xs text-amber-900">
              State whether the vehicle is safe to continue. This ticket does not change the
              vehicle's maintenance or operational status.
            </p>
          ) : null}

          {urgentWarning ? (
            <div className="flex gap-2 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <p>
                Access Support is not an emergency service. If there is immediate danger, contact
                the appropriate emergency service. This ticket will be flagged for urgent admin
                review.
              </p>
            </div>
          ) : null}

          <div className="flex gap-2">
            <Button className="flex-1" onClick={createTicket} disabled={creating}>
              {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Submit ticket
            </Button>
            <Button variant="outline" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
          </div>
        </section>
      ) : null}

      <section className="mt-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            My support tickets
          </h2>
          <span className="text-xs text-muted-foreground">{tickets.length}</span>
        </div>
        {loading ? (
          <div className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">
            <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" /> Loading tickets…
          </div>
        ) : !tickets.length ? (
          <div className="rounded-2xl border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
            No support tickets yet.
          </div>
        ) : (
          <ul className="space-y-3">
            {tickets.map((ticket) => (
              <li key={ticket.id}>
                <Link
                  to="/app/support/$ticketId"
                  params={{ ticketId: ticket.id }}
                  className="block rounded-2xl border bg-card p-4 shadow-sm transition hover:border-primary/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-primary">{ticket.ticket_reference}</p>
                      <p className="truncate font-semibold">{ticket.subject}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {supportCategoryLabel(ticket.category)} · updated{" "}
                        {supportAge(ticket.updated_at)} ago
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Badge variant={ticket.priority === "urgent" ? "destructive" : "outline"}>
                        {supportPriorityLabel(ticket.priority)}
                      </Badge>
                      <Badge variant="secondary">{supportStatusLabel(ticket.status)}</Badge>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AppShell>
  );
}
