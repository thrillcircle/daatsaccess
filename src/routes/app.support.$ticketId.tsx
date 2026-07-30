import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, MessageSquare, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useAuth } from "@/hooks/use-auth";
import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  supportCategoryLabel,
  supportPriorityLabel,
  supportStatusLabel,
  type SupportMessage,
  type SupportTicket,
} from "@/lib/support";

const db = supabase as unknown as SupabaseClient;

export const Route = createFileRoute("/app/support/$ticketId")({
  head: () => ({ meta: [{ title: "Support ticket — Access" }] }),
  component: SupportTicketPage,
});

function SupportTicketPage() {
  const { ticketId } = Route.useParams();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [ticket, setTicket] = useState<SupportTicket | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) navigate({ to: "/auth" });
  }, [authLoading, user, navigate]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const load = async () => {
      const [ticketResult, messageResult] = await Promise.all([
        db.from("support_tickets").select("*").eq("id", ticketId).maybeSingle(),
        db
          .from("support_messages")
          .select("*")
          .eq("ticket_id", ticketId)
          .order("created_at", { ascending: true }),
      ]);
      if (cancelled) return;
      if (ticketResult.error) toast.error(ticketResult.error.message);
      setTicket((ticketResult.data ?? null) as SupportTicket | null);
      setMessages((messageResult.data ?? []) as SupportMessage[]);
      setLoading(false);
    };
    void load();
    const channel = supabase
      .channel(`support-ticket-${ticketId}`)
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
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [ticketId, user]);

  async function sendMessage() {
    if (!message.trim()) return;
    setSending(true);
    const { error } = await db.rpc("support_add_message", {
      p_ticket_id: ticketId,
      p_message: message.trim(),
      p_is_internal_note: false,
    });
    setSending(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setMessage("");
    toast.success("Reply sent");
  }

  if (authLoading || loading) {
    return (
      <AppShell title="Support">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading ticket…
        </p>
      </AppShell>
    );
  }

  if (!ticket) {
    return (
      <AppShell title="Support">
        <div className="rounded-2xl border bg-card p-6 text-center">
          <p className="font-semibold">Ticket not found</p>
          <p className="mt-1 text-sm text-muted-foreground">
            It may not exist or you may not have access to it.
          </p>
          <Button asChild className="mt-4" variant="outline">
            <Link to="/app/support">Return to Support</Link>
          </Button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Support">
      <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
        <Link to="/app/support">
          <ArrowLeft className="mr-1 h-4 w-4" /> Support centre
        </Link>
      </Button>

      <section className="rounded-2xl border bg-card p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-primary">{ticket.ticket_reference}</p>
            <h1 className="text-lg font-semibold">{ticket.subject}</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              {supportCategoryLabel(ticket.category)} · created{" "}
              {new Date(ticket.created_at).toLocaleString("en-ZA")}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <Badge variant={ticket.priority === "urgent" ? "destructive" : "outline"}>
              {supportPriorityLabel(ticket.priority)}
            </Badge>
            <Badge variant="secondary">{supportStatusLabel(ticket.status)}</Badge>
          </div>
        </div>
        <div className="mt-4 rounded-xl bg-secondary p-3 text-sm whitespace-pre-wrap">
          {ticket.description}
        </div>
        <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
          <p>Trip: {ticket.ride_id ? ticket.ride_id.slice(0, 8) : "Not linked"}</p>
          <p>
            Service booking:{" "}
            {ticket.service_booking_id ? ticket.service_booking_id.slice(0, 8) : "Not linked"}
          </p>
        </div>
        {ticket.resolution_summary ? (
          <div className="mt-4 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm">
            <p className="font-medium">Resolution</p>
            <p className="mt-1 text-muted-foreground">{ticket.resolution_summary}</p>
          </div>
        ) : null}
      </section>

      <section className="mt-4 rounded-2xl border bg-card p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">Conversation</h2>
        </div>
        {!messages.length ? (
          <p className="mt-4 rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
            No replies yet. Access Support will respond here.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {messages.map((item) => {
              const mine = item.sender_id === user?.id;
              return (
                <li
                  key={item.id}
                  className={`max-w-[88%] rounded-2xl p-3 text-sm ${
                    mine ? "ml-auto bg-primary text-primary-foreground" : "bg-secondary"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{item.message}</p>
                  <p
                    className={`mt-1 text-[10px] ${
                      mine ? "text-primary-foreground/70" : "text-muted-foreground"
                    }`}
                  >
                    {mine ? "You" : "Access Support"} ·{" "}
                    {new Date(item.created_at).toLocaleString("en-ZA")}
                  </p>
                </li>
              );
            })}
          </ul>
        )}

        {ticket.status === "closed" ? (
          <p className="mt-4 rounded-xl bg-secondary p-3 text-sm text-muted-foreground">
            This ticket is closed. Create a new ticket if you need more help.
          </p>
        ) : (
          <div className="mt-4 space-y-2">
            <Textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={4}
              maxLength={5000}
              placeholder="Write a reply…"
            />
            <Button className="w-full" onClick={sendMessage} disabled={sending || !message.trim()}>
              {sending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              Send reply
            </Button>
          </div>
        )}
      </section>
    </AppShell>
  );
}
