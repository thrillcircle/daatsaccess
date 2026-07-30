import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useUserRoles } from "@/hooks/use-auth";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Database } from "@/integrations/supabase/types";

type Notification = Database["public"]["Tables"]["notifications"]["Row"] & {
  support_ticket_id?: string | null;
};

export function NotificationBell() {
  const { user } = useAuth();
  const { roles } = useUserRoles(user?.id);
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const isAdmin = !!roles?.includes("admin");

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(30);
      if (!cancelled) setItems((data ?? []) as Notification[]);
    };
    void load();
    const channel = supabase
      .channel("notifications-" + user.id)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => setItems((previous) => [payload.new as Notification, ...previous].slice(0, 30)),
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) =>
          setItems((previous) =>
            previous.map((notification) =>
              notification.id === (payload.new as Notification).id
                ? (payload.new as Notification)
                : notification,
            ),
          ),
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [user]);

  const unread = items.filter((item) => !item.read_at);

  async function markAllRead() {
    if (!user || !unread.length) return;
    await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .in(
        "id",
        unread.map((item) => item.id),
      );
  }

  if (!user) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Notifications" className="relative">
          <Bell className="h-4 w-4" />
          {unread.length > 0 ? (
            <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
              {unread.length > 9 ? "9+" : unread.length}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-sm font-semibold">Notifications</p>
          {unread.length > 0 ? (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={markAllRead}>
              Mark all read
            </Button>
          ) : null}
        </div>
        <ScrollArea className="max-h-96">
          {!items.length ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              You're all caught up.
            </p>
          ) : (
            <ul className="divide-y">
              {items.map((notification) => {
                const inner = (
                  <div
                    className={
                      "block space-y-1 px-3 py-2.5 text-sm hover:bg-muted/50 " +
                      (!notification.read_at ? "bg-primary/5" : "")
                    }
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium leading-tight">{notification.title}</p>
                      {!notification.read_at ? (
                        <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
                      ) : null}
                    </div>
                    {notification.body ? (
                      <p className="text-xs text-muted-foreground">{notification.body}</p>
                    ) : null}
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {timeAgo(notification.created_at)}
                    </p>
                  </div>
                );

                let destination: React.ReactNode = inner;
                if (notification.support_ticket_id) {
                  destination = isAdmin ? (
                    <Link
                      to="/app/admin/support/$ticketId"
                      params={{ ticketId: notification.support_ticket_id }}
                      onClick={() => setOpen(false)}
                    >
                      {inner}
                    </Link>
                  ) : (
                    <Link
                      to="/app/support/$ticketId"
                      params={{ ticketId: notification.support_ticket_id }}
                      onClick={() => setOpen(false)}
                    >
                      {inner}
                    </Link>
                  );
                } else if (notification.ride_id) {
                  destination = (
                    <Link
                      to="/app/trip/$rideId"
                      params={{ rideId: notification.ride_id }}
                      onClick={() => setOpen(false)}
                    >
                      {inner}
                    </Link>
                  );
                }

                return <li key={notification.id}>{destination}</li>;
              })}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

function timeAgo(iso: string): string {
  const difference = Date.now() - new Date(iso).getTime();
  if (difference < 60_000) return "just now";
  if (difference < 3_600_000) return `${Math.floor(difference / 60_000)}m ago`;
  if (difference < 86_400_000) return `${Math.floor(difference / 3_600_000)}h ago`;
  return new Date(iso).toLocaleDateString();
}
