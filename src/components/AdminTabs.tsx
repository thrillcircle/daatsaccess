import { Link, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, Activity, Users, ListOrdered, Truck, History } from "lucide-react";

const TABS: ReadonlyArray<{
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  exact?: boolean;
}> = [
  { to: "/app/admin", label: "Overview", icon: LayoutDashboard, exact: true },
  { to: "/app/admin/trips", label: "Trips", icon: ListOrdered },
  { to: "/app/admin/trip-history", label: "History", icon: History },
  { to: "/app/admin/live", label: "Live Ops", icon: Activity },
  { to: "/app/admin/drivers", label: "Drivers", icon: Users },
  { to: "/app/admin/fleet", label: "Fleet", icon: Truck },
];

export function AdminTabs() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav className="mb-4 flex gap-1 rounded-xl border bg-card p-1">
      {TABS.map((t) => {
        const active = t.exact ? pathname === t.to : pathname.startsWith(t.to);
        const Icon = t.icon;
        return (
          <Link
            key={t.to}
            to={t.to as "/app/admin"}
            className={
              "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-medium transition-colors " +
              (active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted")
            }
          >
            <Icon className="h-3.5 w-3.5" />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
