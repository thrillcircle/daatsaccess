import { Link, useRouterState } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import {
  LayoutDashboard,
  ListOrdered,
  History,
  Activity,
  Users,
  Truck,
  UserCircle2,
  CalendarRange,
  LifeBuoy,
  Gauge,
  Car,
  Wrench,
  ShieldCheck,
  Settings,
  Menu,
  LogOut,
  Accessibility,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { NotificationBell } from "@/components/NotificationBell";
import { cn } from "@/lib/utils";

type NavLink = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  exact?: boolean;
  soon?: boolean;
};

type NavSection = { heading: string; items: NavLink[] };

const SECTIONS: NavSection[] = [
  {
    heading: "Main",
    items: [
      { to: "/app/admin", label: "Overview", icon: LayoutDashboard, exact: true },
      { to: "/app/admin/trips", label: "Trips", icon: ListOrdered },
      { to: "/app/admin/trip-history", label: "Trip History", icon: History },
      { to: "/app/admin/live", label: "Live Operations", icon: Activity },
      { to: "/app/admin/drivers", label: "Drivers", icon: Users },
      { to: "/app/admin/fleet", label: "Vehicles", icon: Truck },
    ],
  },
  {
    heading: "Operations",
    items: [
      { to: "/app/admin/passengers", label: "Passengers", icon: UserCircle2, soon: true },
      { to: "/app/admin/bookings", label: "Service Bookings", icon: CalendarRange },
      { to: "/app/admin/support", label: "Support", icon: LifeBuoy, soon: true },
    ],
  },
  {
    heading: "Fleet Management",
    items: [
      { to: "/app/admin/fleet", label: "Fleet Dashboard", icon: Gauge },
      { to: "/app/admin/fleet", label: "Vehicle Profiles", icon: Car },
      { to: "/app/admin/fleet", label: "Maintenance", icon: Wrench },
    ],
  },
  {
    heading: "System",
    items: [
      { to: "/app/admin/users", label: "Users", icon: ShieldCheck, soon: true },
      { to: "/app/admin/settings", label: "Settings", icon: Settings, soon: true },
    ],
  },
];

function NavList({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex flex-col gap-6">
      {SECTIONS.map((section) => (
        <div key={section.heading}>
          <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-white/40">
            {section.heading}
          </p>
          <ul className="space-y-0.5">
            {section.items.map((item, idx) => {
              const Icon = item.icon;
              const active = item.soon
                ? false
                : item.exact
                  ? pathname === item.to
                  : pathname === item.to || pathname.startsWith(item.to + "/");
              if (item.soon) {
                return (
                  <li key={`${item.to}-${idx}`}>
                    <span className="flex cursor-not-allowed items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm text-white/40">
                      <span className="flex items-center gap-3">
                        <Icon className="h-4 w-4" />
                        {item.label}
                      </span>
                      <Badge variant="outline" className="border-white/15 bg-transparent text-[9px] uppercase text-white/40">
                        Soon
                      </Badge>
                    </span>
                  </li>
                );
              }
              return (
                <li key={`${item.to}-${idx}`}>
                  <Link
                    to={item.to as "/app/admin"}
                    onClick={onNavigate}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                      active
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-white/75 hover:bg-white/5 hover:text-white",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="truncate">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function SidebarBrand() {
  return (
    <div className="flex items-center gap-2 px-3 py-1">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground">
        <Accessibility className="h-5 w-5" />
      </span>
      <div className="leading-tight">
        <p className="text-sm font-semibold text-white">Access</p>
        <p className="text-[11px] text-white/50">Admin Portal</p>
      </div>
    </div>
  );
}

export function AdminShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { signOut } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-muted/40">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col gap-6 overflow-y-auto bg-[oklch(0.20_0.03_252)] px-3 py-5 lg:flex">
        <SidebarBrand />
        <NavList pathname={pathname} />
        <div className="mt-auto px-3">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-white/70 hover:bg-white/5 hover:text-white"
            onClick={signOut}
          >
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </div>
      </aside>

      <div className="lg:pl-64">
        {/* Top header */}
        <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
          <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
            {/* Mobile menu */}
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="lg:hidden"
                  aria-label="Open menu"
                >
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent
                side="left"
                className="w-72 border-r-0 bg-[oklch(0.20_0.03_252)] p-0 text-white"
              >
                <SheetTitle className="sr-only">Admin navigation</SheetTitle>
                <div className="flex h-full flex-col gap-6 overflow-y-auto px-3 py-5">
                  <SidebarBrand />
                  <NavList
                    pathname={pathname}
                    onNavigate={() => setMobileOpen(false)}
                  />
                  <div className="mt-auto px-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start gap-2 text-white/70 hover:bg-white/5 hover:text-white"
                      onClick={() => {
                        setMobileOpen(false);
                        signOut();
                      }}
                    >
                      <LogOut className="h-4 w-4" /> Sign out
                    </Button>
                  </div>
                </div>
              </SheetContent>
            </Sheet>

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold sm:text-base">{title}</p>
              {subtitle ? (
                <p className="hidden truncate text-xs text-muted-foreground sm:block">
                  {subtitle}
                </p>
              ) : null}
            </div>

            <div className="flex items-center gap-1">
              <NotificationBell />
              <Button
                variant="ghost"
                size="icon"
                onClick={signOut}
                aria-label="Sign out"
                className="lg:hidden"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 sm:py-6">
          {(title || subtitle || actions) && (
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="min-w-0">
                <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{title}</h1>
                {subtitle ? (
                  <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
                ) : null}
              </div>
              {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
