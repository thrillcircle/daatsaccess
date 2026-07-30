import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
  Accessibility,
  CalendarRange,
  Car,
  History,
  LayoutDashboard,
  ListChecks,
  LogOut,
  MapPin,
  PanelsTopLeft,
  ShieldCheck,
  UserCircle2,
  UserCog,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth, useUserRoles } from "@/hooks/use-auth";
import { NotificationBell } from "@/components/NotificationBell";

export type NavItem = {
  to: string;
  label: string;
  icon: ReactNode;
  hash?: string;
};

const PASSENGER_NAV: NavItem[] = [
  { to: "/app/passenger", label: "Ride", icon: <MapPin className="h-5 w-5" /> },
  { to: "/app/passenger/book", label: "Services", icon: <Accessibility className="h-5 w-5" /> },
  { to: "/app/passenger/bookings", label: "My Trips", icon: <CalendarRange className="h-5 w-5" /> },
  { to: "/app/profile", label: "Profile", icon: <UserCircle2 className="h-5 w-5" /> },
];

const DRIVER_NAV: NavItem[] = [
  { to: "/app/driver", label: "Drive", icon: <Car className="h-5 w-5" /> },
  {
    to: "/app/driver",
    hash: "upcoming",
    label: "Upcoming",
    icon: <CalendarRange className="h-5 w-5" />,
  },
  { to: "/app/driver", hash: "history", label: "History", icon: <History className="h-5 w-5" /> },
  { to: "/app/profile", label: "Profile", icon: <UserCircle2 className="h-5 w-5" /> },
];

const ADMIN_PROFILE_NAV: NavItem[] = [
  { to: "/app/admin", label: "Overview", icon: <LayoutDashboard className="h-5 w-5" /> },
  { to: "/app/profile", label: "Profile", icon: <UserCircle2 className="h-5 w-5" /> },
];

function isNavActive(pathname: string, item: NavItem): boolean {
  if (item.hash) return false;
  if (item.to === "/app/passenger") {
    return pathname === "/app/passenger" || pathname === "/app/passenger/";
  }
  if (item.to === "/app/passenger/book") {
    return pathname === item.to || pathname.startsWith(item.to + "/");
  }
  if (item.to === "/app/passenger/bookings") {
    return pathname === item.to || pathname.startsWith(item.to + "/");
  }
  return pathname === item.to || pathname.startsWith(item.to + "/");
}

export function AppShell({
  children,
  nav,
  title,
}: {
  children: ReactNode;
  nav?: NavItem[];
  title?: string;
}) {
  const { signOut, user } = useAuth();
  const { roles } = useUserRoles(user?.id);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const hasPassenger = !!roles?.includes("passenger");
  const hasDriver = !!roles?.includes("driver");
  const hasAdmin = !!roles?.includes("admin");
  const isProfile = pathname === "/app/profile";

  let resolvedNav = nav ?? [];
  if (pathname.startsWith("/app/passenger")) {
    resolvedNav = PASSENGER_NAV;
  } else if (pathname.startsWith("/app/driver")) {
    resolvedNav = DRIVER_NAV;
  } else if (isProfile) {
    if (hasPassenger || roles == null) resolvedNav = PASSENGER_NAV;
    else if (hasDriver) resolvedNav = DRIVER_NAV;
    else if (hasAdmin) resolvedNav = ADMIN_PROFILE_NAV;
  }

  const portalCount = [hasPassenger, hasDriver, hasAdmin].filter(Boolean).length;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-md items-center justify-between px-4">
          <Link to="/" className="flex min-w-0 items-center gap-2">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary font-bold text-primary-foreground">
              A
            </span>
            <span className="truncate font-semibold tracking-tight">
              Access{" "}
              {title ? <span className="font-normal text-muted-foreground">· {title}</span> : null}
            </span>
          </Link>
          {user ? (
            <div className="flex items-center gap-1">
              <NotificationBell />
              {portalCount > 1 ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label="Switch portal">
                      <PanelsTopLeft className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>Switch portal</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {hasPassenger ? (
                      <DropdownMenuItem asChild>
                        <Link to="/app/passenger">Passenger</Link>
                      </DropdownMenuItem>
                    ) : null}
                    {hasDriver ? (
                      <DropdownMenuItem asChild>
                        <Link to="/app/driver">Driver</Link>
                      </DropdownMenuItem>
                    ) : null}
                    {hasAdmin ? (
                      <DropdownMenuItem asChild>
                        <Link to="/app/admin">Admin</Link>
                      </DropdownMenuItem>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
              <Button variant="ghost" size="icon" onClick={signOut} aria-label="Sign out">
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          ) : null}
        </div>
      </header>

      <main className="mx-auto max-w-md px-4 pb-24 pt-4">{children}</main>

      {resolvedNav.length ? (
        <nav
          className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 backdrop-blur"
          aria-label="Primary navigation"
        >
          <div className="mx-auto flex max-w-md items-stretch justify-around">
            {resolvedNav.map((item) => {
              const active = isNavActive(pathname, item);
              const className =
                "flex min-w-0 flex-1 flex-col items-center gap-1 px-1 py-3 text-[11px] sm:text-xs " +
                (active ? "text-primary" : "text-muted-foreground");
              if (item.hash) {
                return (
                  <a
                    key={`${item.to}#${item.hash}`}
                    href={`${item.to}#${item.hash}`}
                    className={className}
                  >
                    {item.icon}
                    <span className="truncate">{item.label}</span>
                  </a>
                );
              }
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={className}
                  aria-current={active ? "page" : undefined}
                >
                  {item.icon}
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      ) : null}
    </div>
  );
}

export const NAV_ICONS = {
  Passenger: <MapPin className="h-5 w-5" />,
  Services: <Accessibility className="h-5 w-5" />,
  Trips: <ListChecks className="h-5 w-5" />,
  Driver: <Car className="h-5 w-5" />,
  Upcoming: <CalendarRange className="h-5 w-5" />,
  History: <History className="h-5 w-5" />,
  Admin: <ShieldCheck className="h-5 w-5" />,
  Profile: <UserCog className="h-5 w-5" />,
};
