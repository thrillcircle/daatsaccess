import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Clock3, FileText, Loader2, MessageSquare, Send, UserCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useUserRoles } from "@/hooks/use-auth";
import { AdminShell } from "@/components/AdminShell";
import { AdminSupportVehicleActions } from "@/components/support/AdminSupportVehicleActions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  SUPPORT_PRIORITIES,
  SUPPORT_STATUSES,
  supportCategoryLabel,
  supportPriorityLabel,
  supportStatusLabel,
  type SupportEvent,
  type SupportMessage,
  type SupportPriority,
  type SupportStatus,
  type SupportTicket,
} from "@/lib/support";

const db = supabase;
type ProfileSummary = { user_id: string; full_name: string | null; phone: string | null };

export const Route = createFileRoute("/app/admin/support/$ticketId")({
  head: () => ({ meta: [{ title: "Support ticket — Admin" }] }),
  component: AdminSupportTicketPage,
});

function AdminSupportTicketPage() {
  const { ticketId } = Route.useParams();
  const { user, loading: authLoading } = useAuth();
  const { roles, loading: rolesLoading } = useUserRoles(user?.id);
  const navigate = useNavigate();
  const isAdmin = !!roles?.includes("admin");
  const [ticket, setTicket] = useState<SupportTicket | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [events, setEvents] = useState<SupportEvent[]>([]);
  const [profiles, setProfiles] = useState<Record<string, ProfileSummary>>({});
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<SupportStatus>("open");
  const [priority, setPriority] = useState<SupportPriority>("normal");
  const [resolution, setResolution] = useState("");
  const [reply, setReply] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (authLoading || rolesLoading || roles === null) return;
    if (!user || !isAdmin) navigate({ to: "/app" });
  }, [authLoading, rolesLoading, roles, user, isAdmin, navigate]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    const load = async () => {
      const [ticketResult, messageResult, eventResult] = await Promise.all([
        db.from("support_tickets").select("*").eq("id", ticketId).maybeSingle(),
        db
          .from("support_messages")
          .select("*")
          .eq("ticket_id", ticketId)
          .order("created_at", { ascending: true }),
        db
          .from("support_ticket_events")
          .select("*")
          .eq("ticket_id", ticketId)
          .order("created_at", { ascending: false }),
      ]);
      if (cancelled) return;
      if (ticketResult.error) toast.error(ticketResult.error.message);
      const nextTicket = (ticketResult.data ?? null) as SupportTicket | null;
      setTicket(nextTicket);
      setMessages((messageResult.data ?? []) as SupportMessage[]);
      setEvents((eventResult.data ?? []) as SupportEvent[]);
      if (nextTicket) {
        setStatus(nextTicket.status);
        setPriority(nextTicket.priority);
        setResolution(nextTicket.resolution_summary ?? "");
        const ids = Array.from(
          new Set(
            [
              nextTicket.created_by,
              nextTicket.passenger_id,
              nextTicket.driver_id,
              nextTicket.assigned_admin_id,
              ...(messageResult.data ?? []).map((message: SupportMessage) => message.sender_id),
              ...(eventResult.data ?? []).map((event: SupportEvent) => event.performed_by),
            ].filter((value): value is string => !!value),
          ),
        );
        if (ids.length) {
          const { data: rows } = await supabase
            .from("profiles")
            .select("user_id,full_name,phone")
            .in("user_id", ids);
          if (!cancelled) {
            setProfiles(
              Object.fromEntries(
                ((rows ?? []) as ProfileSummary[]).map((profile) => [profile.user_id, profile]),
              ),
            );
          }
        }
      }
      setLoading(false);
    };
    void load();
    const channel = supabase
      .channel(`admin-support-${ticketId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "support_tickets", filter: `id=eq.${ticketId}` },
        () => void load(),
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "support_messages",
          filter: `ticket_id=eq.${ticketId}`,
        },
        () => void load(),
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "support_ticket_events",
          filter: `ticket_id=eq.${ticketId}`,
        },
        () => void load(),
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [isAdmin, ticketId]);

  const requester = ticket ? profiles[ticket.created_by] : null;
  const assigned = ticket?.assigned_admin_id ? profiles[ticket.assigned_admin_id] : null;

  async function updateTicket(assignToSelf = false) {
    if (!ticket || !user) return;
    setSaving(true);
    const { error } = await db.rpc("support_admin_update_ticket", {
      p_ticket_id: ticket.id,
      p_status: status,
      p_priority: priority,
      p_assigned_admin_id: assignToSelf ? user.id : ticket.assigned_admin_id,
      p_resolution_summary: resolution || null,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(assignToSelf ? "Ticket assigned to you" : "Ticket updated");
  }

  async function addMessage(value: string, internal: boolean) {
    if (!value.trim()) return;
    setSending(true);
    const { error } = await db.rpc("support_add_message", {
      p_ticket_id: ticketId,
      p_message: value.trim(),
      p_is_internal_note: internal,
    });
    setSending(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (internal) setNote("");
    else setReply("");
    toast.success(internal ? "Internal note added" : "Reply sent");
  }

  const linkedActions = useMemo(() => {
    if (!ticket) return null;
    return (
      <div className="flex flex-wrap gap-2">
        {ticket.ride_id ? (
          <Button asChild size="sm" variant="outline">
            <Link to="/app/trip/$rideId" params={{ rideId: ticket.ride_id }}>
              View trip
            </Link>
          </Button>
        ) : null}
        {ticket.service_booking_id ? (
          <Button asChild size="sm" variant="outline">
            <Link to="/app/admin/bookings">Service bookings</Link>
          </Button>
        ) : null}
        <AdminSupportVehicleActions
          ticketId={ticket.id}
          vehicleId={ticket.vehicle_id}
          description={ticket.description}
        />
      </div>
    );
  }, [ticket]);

  if (authLoading || rolesLoading || loading || (user && roles === null)) {
    return (
      <AdminShell title="Support ticket">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading ticket…
        </p>
      </AdminShell>
    );
  }
  if (!isAdmin) return null;
  if (!ticket) {
    return (
      <AdminShell title="Support ticket">
        <div className="rounded-2xl border bg-card p-6 text-center">
          <p className="font-semibold">Ticket not found</p>
          <Button asChild className="mt-4" variant="outline">
            <Link to="/app/admin/support">Return to Support</Link>
          </Button>
        </div>
      </AdminShell>
    );
  }

  return (
    <AdminShell title={ticket.ticket_reference} subtitle={ticket.subject} actions={linkedActions}>
      <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
        <Link to="/app/admin/support">
          <ArrowLeft className="mr-1 h-4 w-4" /> Support queue
        </Link>
      </Button>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <section className="rounded-2xl border bg-card p-4 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{ticket.requester_role}</Badge>
                  <Badge variant={ticket.priority === "urgent" ? "destructive" : "outline"}>
                    {supportPriorityLabel(ticket.priority)}
                  </Badge>
                  <Badge variant="secondary">{supportStatusLabel(ticket.status)}</Badge>
                </div>
                <h1 className="mt-2 text-xl font-semibold">{ticket.subject}</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {supportCategoryLabel(ticket.category)} ·{" "}
                  {new Date(ticket.created_at).toLocaleString("en-ZA")}
                </p>
              </div>
              <div className="text-sm sm:text-right">
                <p className="font-medium">{requester?.full_name ?? "Unknown requester"}</p>
                <p className="text-muted-foreground">{requester?.phone ?? "No phone"}</p>
              </div>
            </div>
            <div className="mt-4 whitespace-pre-wrap rounded-xl bg-secondary p-3 text-sm">
              {ticket.description}
            </div>
            <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
              <p>Trip: {ticket.ride_id ?? "Not linked"}</p>
              <p>Service booking: {ticket.service_booking_id ?? "Not linked"}</p>
              <p>Vehicle: {ticket.vehicle_id ?? "Not linked"}</p>
            </div>
          </section>

          <section className="rounded-2xl border bg-card p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-primary" />
              <h2 className="font-semibold">Public conversation</h2>
            </div>
            <ul className="mt-4 space-y-3">
              {messages
                .filter((message) => !message.is_internal_note)
                .map((message) => {
                  const sender = profiles[message.sender_id];
                  const adminMessage = message.sender_role === "admin";
                  return (
                    <li
                      key={message.id}
                      className={`max-w-[90%] rounded-2xl p-3 text-sm ${
                        adminMessage ? "ml-auto bg-primary text-primary-foreground" : "bg-secondary"
                      }`}
                    >
                      <p className="whitespace-pre-wrap">{message.message}</p>
                      <p
                        className={`mt-1 text-[10px] ${adminMessage ? "text-primary-foreground/70" : "text-muted-foreground"}`}
                      >
                        {sender?.full_name ?? message.sender_role} ·{" "}
                        {new Date(message.created_at).toLocaleString("en-ZA")}
                      </p>
                    </li>
                  );
                })}
              {!messages.some((message) => !message.is_internal_note) ? (
                <li className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
                  No public replies yet.
                </li>
              ) : null}
            </ul>
            <div className="mt-4 space-y-2">
              <Textarea
                value={reply}
                onChange={(event) => setReply(event.target.value)}
                rows={4}
                placeholder="Write a public reply…"
              />
              <Button onClick={() => addMessage(reply, false)} disabled={sending || !reply.trim()}>
                {sending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="mr-2 h-4 w-4" />
                )}
                Send public reply
              </Button>
            </div>
          </section>

          <section className="rounded-2xl border border-amber-400/30 bg-amber-50/40 p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-amber-700" />
              <h2 className="font-semibold">Internal notes</h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Internal notes are visible to administrators only.
            </p>
            <ul className="mt-4 space-y-2">
              {messages
                .filter((message) => message.is_internal_note)
                .map((message) => (
                  <li key={message.id} className="rounded-xl border bg-background p-3 text-sm">
                    <p className="whitespace-pre-wrap">{message.message}</p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {profiles[message.sender_id]?.full_name ?? "Administrator"} ·{" "}
                      {new Date(message.created_at).toLocaleString("en-ZA")}
                    </p>
                  </li>
                ))}
            </ul>
            <div className="mt-4 space-y-2">
              <Textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={3}
                placeholder="Add an internal note…"
              />
              <Button
                variant="outline"
                onClick={() => addMessage(note, true)}
                disabled={sending || !note.trim()}
              >
                Add internal note
              </Button>
            </div>
          </section>
        </div>

        <aside className="space-y-5">
          <section className="rounded-2xl border bg-card p-4 shadow-sm">
            <h2 className="font-semibold">Ticket controls</h2>
            <div className="mt-4 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="admin-support-status">Status</Label>
                <select
                  id="admin-support-status"
                  value={status}
                  onChange={(event) => setStatus(event.target.value as SupportStatus)}
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                >
                  {SUPPORT_STATUSES.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="admin-support-priority">Priority</Label>
                <select
                  id="admin-support-priority"
                  value={priority}
                  onChange={(event) => setPriority(event.target.value as SupportPriority)}
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                >
                  {SUPPORT_PRIORITIES.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="admin-support-resolution">Resolution summary</Label>
                <Textarea
                  id="admin-support-resolution"
                  value={resolution}
                  onChange={(event) => setResolution(event.target.value)}
                  rows={4}
                  placeholder="Required when resolving a ticket."
                />
              </div>
              <Button className="w-full" onClick={() => updateTicket(false)} disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Save changes
              </Button>
              <Button
                className="w-full"
                variant="outline"
                onClick={() => updateTicket(true)}
                disabled={saving}
              >
                <UserCheck className="mr-2 h-4 w-4" /> Assign to me
              </Button>
            </div>
            <div className="mt-4 rounded-xl bg-secondary p-3 text-xs text-muted-foreground">
              Assigned:{" "}
              {assigned?.full_name ?? (ticket.assigned_admin_id ? "Administrator" : "Unassigned")}
            </div>
          </section>

          <section className="rounded-2xl border bg-card p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <Clock3 className="h-4 w-4 text-primary" />
              <h2 className="font-semibold">Audit timeline</h2>
            </div>
            <ul className="mt-4 space-y-3">
              {events.map((event) => (
                <li key={event.id} className="border-l-2 border-primary/20 pl-3 text-xs">
                  <p className="font-medium capitalize">{event.event_type.replaceAll("_", " ")}</p>
                  <p className="text-muted-foreground">
                    {profiles[event.performed_by ?? ""]?.full_name ?? "System"} ·{" "}
                    {new Date(event.created_at).toLocaleString("en-ZA")}
                  </p>
                </li>
              ))}
              {!events.length ? (
                <li className="text-sm text-muted-foreground">No events recorded.</li>
              ) : null}
            </ul>
          </section>
        </aside>
      </div>
    </AdminShell>
  );
}
