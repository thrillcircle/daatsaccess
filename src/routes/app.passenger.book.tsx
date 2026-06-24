import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { AppShell, NAV_ICONS } from "@/components/AppShell";
import { useAuth, useUserRoles } from "@/hooks/use-auth";
import { Badge } from "@/components/ui/badge";
import { Accessibility, HeartHandshake, CalendarClock, Plane } from "lucide-react";

export const Route = createFileRoute("/app/passenger/book")({
  head: () => ({ meta: [{ title: "Book a service — Access" }] }),
  component: BookServicePage,
});

const SERVICES = [
  {
    key: "transport",
    href: "/app/passenger/book/transport" as const,
    title: "Access Transport",
    icon: Accessibility,
    description:
      "Accessible point-to-point transport for wheelchair users, elderly passengers, temporary or permanent mobility limitations, medical transport, airport transfers and long-distance travel.",
    available: true,
  },
  {
    key: "assisted",
    href: "/app/passenger/book/assisted" as const,
    title: "Access Assisted",
    icon: HeartHandshake,
    description: "Accessible transport with a driver and trained companion support.",
    available: true,
  },
  {
    key: "appointment",
    href: "/app/passenger/book" as const,
    title: "Access Appointment",
    icon: CalendarClock,
    description: "Drop-off, wait at your appointment and return when you're done.",
    available: false,
  },
  {
    key: "extended",
    href: "/app/passenger/book" as const,
    title: "Access Extended Journey",
    icon: Plane,
    description: "Multi-day journeys with accommodation and itinerary support.",
    available: false,
  },
];

function BookServicePage() {
  const { user } = useAuth();
  const { roles } = useUserRoles(user?.id);

  const nav = useMemo(() => {
    const items = [
      { to: "/app/passenger", label: "Ride", icon: NAV_ICONS.Passenger },
      { to: "/app/passenger/bookings", label: "Bookings", icon: NAV_ICONS.Profile },
    ];
    if (roles?.includes("driver")) items.push({ to: "/app/driver", label: "Drive", icon: NAV_ICONS.Driver });
    if (roles?.includes("admin")) items.push({ to: "/app/admin", label: "Admin", icon: NAV_ICONS.Admin });
    items.push({ to: "/app/profile", label: "Profile", icon: NAV_ICONS.Profile });
    return items;
  }, [roles]);

  return (
    <AppShell title="Book" nav={nav}>
      <section>
        <h1 className="text-xl font-semibold">Which service do you need?</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick the type of trip that fits the traveller's needs.
        </p>
      </section>
      <div className="mt-4 space-y-3">
        {SERVICES.map((s) => {
          const Icon = s.icon;
          const Card = (
            <div
              className={
                "flex gap-3 rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)] " +
                (s.available ? "transition hover:border-primary/40 hover:bg-accent/40" : "opacity-60")
              }
            >
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <Icon className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold">{s.title}</h2>
                  {!s.available ? (
                    <Badge variant="outline" className="text-[10px] uppercase">Coming soon</Badge>
                  ) : null}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{s.description}</p>
              </div>
            </div>
          );
          return s.available ? (
            <Link key={s.key} to={s.href} className="block">
              {Card}
            </Link>
          ) : (
            <div key={s.key}>{Card}</div>
          );
        })}
      </div>
    </AppShell>
  );
}
