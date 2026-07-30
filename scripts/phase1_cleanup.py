from __future__ import annotations

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content.rstrip() + "\n", encoding="utf-8")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


APP_SHELL = r'''import { Link, useRouterState } from "@tanstack/react-router";
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
  { to: "/app/driver", hash: "upcoming", label: "Upcoming", icon: <CalendarRange className="h-5 w-5" /> },
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
              Access {title ? <span className="font-normal text-muted-foreground">· {title}</span> : null}
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
        <nav className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 backdrop-blur" aria-label="Primary navigation">
          <div className="mx-auto flex max-w-md items-stretch justify-around">
            {resolvedNav.map((item) => {
              const active = isNavActive(pathname, item);
              const className =
                "flex min-w-0 flex-1 flex-col items-center gap-1 px-1 py-3 text-[11px] sm:text-xs " +
                (active ? "text-primary" : "text-muted-foreground");
              if (item.hash) {
                return (
                  <a key={`${item.to}#${item.hash}`} href={`${item.to}#${item.hash}`} className={className}>
                    {item.icon}
                    <span className="truncate">{item.label}</span>
                  </a>
                );
              }
              return (
                <Link key={item.to} to={item.to} className={className} aria-current={active ? "page" : undefined}>
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
'''

ADMIN_SHELL = r'''import { Link, useRouterState } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import {
  Accessibility,
  Activity,
  CalendarRange,
  Car,
  CircleDollarSign,
  Gauge,
  History,
  LayoutDashboard,
  LifeBuoy,
  ListOrdered,
  LogOut,
  Menu,
  Settings,
  ShieldCheck,
  UserCircle2,
  UserRoundCog,
  Users,
  Wrench,
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
    ],
  },
  {
    heading: "Operations",
    items: [
      { to: "/app/admin/passengers", label: "Passengers", icon: UserCircle2 },
      { to: "/app/admin/drivers", label: "Drivers", icon: Users },
      { to: "/app/admin/bookings", label: "Service Bookings", icon: CalendarRange },
      { to: "/app/admin/support", label: "Support", icon: LifeBuoy, soon: true },
    ],
  },
  {
    heading: "Fleet Management",
    items: [
      { to: "/app/admin/fleet", label: "Fleet Dashboard", icon: Gauge },
      { to: "/app/admin/vehicle-profiles", label: "Vehicle Profiles", icon: Car, soon: true },
      { to: "/app/admin/maintenance", label: "Maintenance", icon: Wrench, soon: true },
    ],
  },
  {
    heading: "System",
    items: [
      { to: "/app/admin/users", label: "Users & Roles", icon: ShieldCheck, soon: true },
      { to: "/app/admin/pricing-services", label: "Pricing & Services", icon: CircleDollarSign },
      { to: "/app/admin/settings", label: "Settings", icon: Settings, soon: true },
      { to: "/app/profile", label: "Admin Profile", icon: UserRoundCog },
    ],
  },
];

function NavList({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-6" aria-label="Admin navigation">
      {SECTIONS.map((section) => (
        <div key={section.heading}>
          <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-white/40">
            {section.heading}
          </p>
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const Icon = item.icon;
              const active = item.soon
                ? false
                : item.exact
                  ? pathname === item.to
                  : pathname === item.to || pathname.startsWith(item.to + "/");
              if (item.soon) {
                return (
                  <li key={item.to}>
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
                <li key={item.to}>
                  <Link
                    to={item.to as "/app/admin"}
                    onClick={onNavigate}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                      active
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-white/75 hover:bg-white/5 hover:text-white",
                    )}
                    aria-current={active ? "page" : undefined}
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
        <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
          <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 border-r-0 bg-[oklch(0.20_0.03_252)] p-0 text-white">
                <SheetTitle className="sr-only">Admin navigation</SheetTitle>
                <div className="flex h-full flex-col gap-6 overflow-y-auto px-3 py-5">
                  <SidebarBrand />
                  <NavList pathname={pathname} onNavigate={() => setMobileOpen(false)} />
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
              {subtitle ? <p className="hidden truncate text-xs text-muted-foreground sm:block">{subtitle}</p> : null}
            </div>

            <div className="flex items-center gap-1">
              <NotificationBell />
              <Button variant="ghost" size="icon" onClick={signOut} aria-label="Sign out" className="lg:hidden">
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
                {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
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
'''

PASSENGERS_PAGE = r'''import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Search, Phone, UserCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useUserRoles } from "@/hooks/use-auth";
import { AdminShell } from "@/components/AdminShell";
import { Input } from "@/components/ui/input";
import type { Database } from "@/integrations/supabase/types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

export const Route = createFileRoute("/app/admin/passengers")({
  head: () => ({ meta: [{ title: "Passengers — Admin" }] }),
  component: PassengersPage,
});

function PassengersPage() {
  const { user, loading: authLoading } = useAuth();
  const { roles, loading: rolesLoading } = useUserRoles(user?.id);
  const navigate = useNavigate();
  const isAdmin = !!roles?.includes("admin");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [query, setQuery] = useState("");
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
        setLoading(false);
        return;
      }
      const { data, error: profileError } = await supabase
        .from("profiles")
        .select("*")
        .in("user_id", ids)
        .order("full_name", { ascending: true, nullsFirst: false });
      if (cancelled) return;
      if (profileError) setError(profileError.message);
      setProfiles((data ?? []) as Profile[]);
      setLoading(false);
    };
    void load();
    const channel = supabase
      .channel("admin-passengers")
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "user_roles" }, () => void load())
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [isAdmin]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return profiles;
    return profiles.filter(
      (profile) =>
        (profile.full_name?.toLowerCase().includes(q) ?? false) ||
        (profile.phone?.toLowerCase().includes(q) ?? false) ||
        profile.user_id.toLowerCase().includes(q),
    );
  }, [profiles, query]);

  if (authLoading || rolesLoading || (user && roles === null)) {
    return <AdminShell title="Passengers"><p className="text-sm text-muted-foreground">Loading…</p></AdminShell>;
  }
  if (!isAdmin) return null;

  return (
    <AdminShell title="Passengers" subtitle="Passenger profiles are managed separately from driver operations.">
      <div className="relative mb-4 max-w-xl">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name, phone, or user ID…"
          className="pl-9"
        />
      </div>

      {error ? (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>
      ) : loading ? (
        <div className="rounded-2xl border bg-card p-8 text-center text-sm text-muted-foreground">Loading passengers…</div>
      ) : !filtered.length ? (
        <div className="rounded-2xl border bg-card p-8 text-center text-sm text-muted-foreground">
          {profiles.length ? "No passengers match your search." : "No passenger profiles found."}
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((profile) => (
            <li key={profile.user_id} className="rounded-2xl border bg-card p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                  <UserCircle2 className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{profile.full_name ?? "Unnamed passenger"}</p>
                  {profile.phone ? (
                    <a href={`tel:${profile.phone}`} className="mt-1 inline-flex items-center gap-1 text-xs text-primary">
                      <Phone className="h-3 w-3" /> {profile.phone}
                    </a>
                  ) : (
                    <p className="mt-1 text-xs text-muted-foreground">No phone on profile</p>
                  )}
                  <p className="mt-2 font-mono text-[10px] text-muted-foreground">{profile.user_id}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </AdminShell>
  );
}
'''

PRICING_PAGE = r'''import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Calculator, Info, Loader2, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useUserRoles } from "@/hooks/use-auth";
import { AdminShell } from "@/components/AdminShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatZAR } from "@/lib/pricing";
import { toast } from "sonner";

type ServiceKey = "ride" | "transport" | "assisted" | "appointment" | "extended_journey";

type PricingRule = {
  id: string;
  service_type: ServiceKey;
  currency: string;
  base_fare: number;
  per_km_rate: number;
  per_minute_rate: number;
  companion_hourly_rate: number;
  companion_minimum_hours: number;
  waiting_hourly_rate: number;
  specialist_vehicle_fee: number;
  vehicle_daily_rate: number;
  driver_daily_rate: number;
  driver_overnight_rate: number;
  companion_daily_rate: number;
  platform_margin_percent: number;
  is_active: boolean;
  is_mock: boolean;
  effective_from: string;
  updated_at: string;
  updated_by: string | null;
};

type PricingInsert = Omit<PricingRule, "id" | "updated_at"> & { id?: string; updated_at?: string };
type PricingUpdate = Partial<PricingInsert>;

type PricingDatabase = {
  public: {
    Tables: {
      service_pricing_rules: {
        Row: PricingRule;
        Insert: PricingInsert;
        Update: PricingUpdate;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

const pricingDb = supabase as unknown as SupabaseClient<PricingDatabase>;

const SERVICE_LABEL: Record<ServiceKey, string> = {
  ride: "Normal Ride",
  transport: "Access Transport",
  assisted: "Access Assisted",
  appointment: "Access Appointment",
  extended_journey: "Access Extended Journey",
};

const NUMBER_FIELDS: Array<{ key: keyof PricingRule; label: string; step?: string; suffix?: string }> = [
  { key: "base_fare", label: "Base fare", step: "0.01", suffix: "ZAR" },
  { key: "per_km_rate", label: "Per kilometre", step: "0.01", suffix: "ZAR/km" },
  { key: "per_minute_rate", label: "Transport time", step: "0.01", suffix: "ZAR/min" },
  { key: "companion_hourly_rate", label: "Companion hourly rate", step: "0.01", suffix: "ZAR/hour" },
  { key: "companion_minimum_hours", label: "Minimum companion hours", step: "0.5", suffix: "hours" },
  { key: "waiting_hourly_rate", label: "Waiting time", step: "0.01", suffix: "ZAR/hour" },
  { key: "specialist_vehicle_fee", label: "Specialist vehicle fee", step: "0.01", suffix: "ZAR" },
  { key: "vehicle_daily_rate", label: "Vehicle daily rate", step: "0.01", suffix: "ZAR/day" },
  { key: "driver_daily_rate", label: "Driver daily rate", step: "0.01", suffix: "ZAR/day" },
  { key: "driver_overnight_rate", label: "Driver overnight allowance", step: "0.01", suffix: "ZAR/night" },
  { key: "companion_daily_rate", label: "Companion daily rate", step: "0.01", suffix: "ZAR/day" },
  { key: "platform_margin_percent", label: "Target gross margin", step: "0.1", suffix: "%" },
];

export const Route = createFileRoute("/app/admin/pricing-services")({
  head: () => ({ meta: [{ title: "Pricing & Services — Admin" }] }),
  component: PricingServicesPage,
});

function preview(rule: PricingRule): number {
  const companionHours = Math.max(2, Number(rule.companion_minimum_hours || 0));
  const deliveryCost =
    Number(rule.base_fare || 0) +
    Number(rule.per_km_rate || 0) * 10 +
    Number(rule.per_minute_rate || 0) * 60 +
    Number(rule.companion_hourly_rate || 0) * companionHours +
    Number(rule.waiting_hourly_rate || 0) +
    Number(rule.specialist_vehicle_fee || 0) +
    Number(rule.vehicle_daily_rate || 0) +
    Number(rule.driver_daily_rate || 0) +
    Number(rule.driver_overnight_rate || 0) +
    Number(rule.companion_daily_rate || 0);
  const margin = Math.min(95, Math.max(0, Number(rule.platform_margin_percent || 0))) / 100;
  return margin > 0 ? deliveryCost / (1 - margin) : deliveryCost;
}

function PricingServicesPage() {
  const { user, loading: authLoading } = useAuth();
  const { roles, loading: rolesLoading } = useUserRoles(user?.id);
  const navigate = useNavigate();
  const isAdmin = !!roles?.includes("admin");
  const [rows, setRows] = useState<PricingRule[]>([]);
  const [drafts, setDrafts] = useState<Record<string, PricingRule>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || rolesLoading || roles === null) return;
    if (!user || !isAdmin) navigate({ to: "/app" });
  }, [authLoading, rolesLoading, roles, user, isAdmin, navigate]);

  const load = async () => {
    setLoading(true);
    setError(null);
    const { data, error: loadError } = await pricingDb
      .from("service_pricing_rules")
      .select("*")
      .order("service_type");
    if (loadError) {
      setError(loadError.message);
      setRows([]);
      setDrafts({});
    } else {
      const list = (data ?? []) as PricingRule[];
      setRows(list);
      setDrafts(Object.fromEntries(list.map((row) => [row.id, { ...row }])));
    }
    setLoading(false);
  };

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin]);

  const ordered = useMemo(
    () => [...rows].sort((a, b) => Object.keys(SERVICE_LABEL).indexOf(a.service_type) - Object.keys(SERVICE_LABEL).indexOf(b.service_type)),
    [rows],
  );

  const updateDraft = (id: string, patch: Partial<PricingRule>) => {
    setDrafts((previous) => ({ ...previous, [id]: { ...previous[id], ...patch } }));
  };

  const save = async (row: PricingRule) => {
    const draft = drafts[row.id];
    if (!draft || !user) return;
    setSavingId(row.id);
    const payload: PricingUpdate = {
      base_fare: Number(draft.base_fare),
      per_km_rate: Number(draft.per_km_rate),
      per_minute_rate: Number(draft.per_minute_rate),
      companion_hourly_rate: Number(draft.companion_hourly_rate),
      companion_minimum_hours: Number(draft.companion_minimum_hours),
      waiting_hourly_rate: Number(draft.waiting_hourly_rate),
      specialist_vehicle_fee: Number(draft.specialist_vehicle_fee),
      vehicle_daily_rate: Number(draft.vehicle_daily_rate),
      driver_daily_rate: Number(draft.driver_daily_rate),
      driver_overnight_rate: Number(draft.driver_overnight_rate),
      companion_daily_rate: Number(draft.companion_daily_rate),
      platform_margin_percent: Number(draft.platform_margin_percent),
      is_active: draft.is_active,
      is_mock: draft.is_mock,
      effective_from: draft.effective_from,
      updated_by: user.id,
    };
    const { error: saveError } = await pricingDb
      .from("service_pricing_rules")
      .update(payload)
      .eq("id", row.id);
    setSavingId(null);
    if (saveError) {
      toast.error(saveError.message);
      return;
    }
    toast.success(`${SERVICE_LABEL[row.service_type]} pricing saved`);
    await load();
  };

  if (authLoading || rolesLoading || (user && roles === null)) {
    return <AdminShell title="Pricing & Services"><p className="text-sm text-muted-foreground">Loading…</p></AdminShell>;
  }
  if (!isAdmin) return null;

  return (
    <AdminShell
      title="Pricing & Services"
      subtitle="Administrators control service rates here. Mock rates are clearly marked and can be replaced before launch."
    >
      <div className="mb-5 rounded-2xl border border-primary/25 bg-primary/5 p-4 text-sm">
        <div className="flex items-start gap-2">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div>
            <p className="font-medium">Current confirmed formula</p>
            <p className="text-muted-foreground">Normal Ride and Access Transport remain R20.00 base fare + R13.50 per kilometre.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Other values are draft mock data. This module stores and previews the rates now; Phase 4 will connect every specialised booking and quote calculation to the active pricing version.
            </p>
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          Could not load pricing rules: {error}. Apply the new Supabase migration before using this page.
        </div>
      ) : loading ? (
        <div className="rounded-2xl border bg-card p-8 text-center text-sm text-muted-foreground">
          <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> Loading pricing rules…
        </div>
      ) : (
        <div className="space-y-5">
          {ordered.map((row) => {
            const draft = drafts[row.id] ?? row;
            return (
              <section key={row.id} className="rounded-2xl border bg-card p-4 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold">{SERVICE_LABEL[row.service_type]}</h2>
                      <Badge variant={draft.is_mock ? "secondary" : "default"}>{draft.is_mock ? "Mock rates" : "Confirmed base"}</Badge>
                      <Badge variant={draft.is_active ? "outline" : "destructive"}>{draft.is_active ? "Active" : "Inactive"}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">Effective from {new Date(draft.effective_from).toLocaleDateString("en-ZA")}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`active-${row.id}`} className="text-xs">Service active</Label>
                    <Switch id={`active-${row.id}`} checked={draft.is_active} onCheckedChange={(checked) => updateDraft(row.id, { is_active: checked })} />
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {NUMBER_FIELDS.map((field) => (
                    <div key={String(field.key)} className="space-y-1.5">
                      <Label htmlFor={`${row.id}-${String(field.key)}`} className="text-xs">{field.label}</Label>
                      <div className="relative">
                        <Input
                          id={`${row.id}-${String(field.key)}`}
                          type="number"
                          min="0"
                          step={field.step ?? "1"}
                          value={Number(draft[field.key] ?? 0)}
                          onChange={(event) => updateDraft(row.id, { [field.key]: Number(event.target.value) } as Partial<PricingRule>)}
                          className="pr-20"
                        />
                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">{field.suffix}</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex flex-col gap-3 rounded-xl bg-secondary p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-2 text-sm">
                    <Calculator className="mt-0.5 h-4 w-4 text-primary" />
                    <div>
                      <p className="font-medium">Mock calculation preview: {formatZAR(preview(draft))}</p>
                      <p className="text-xs text-muted-foreground">10 km, 60 transport minutes, minimum companion hours, 1 waiting hour and 1 daily unit where configured.</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2 text-xs">
                      <Switch checked={draft.is_mock} onCheckedChange={(checked) => updateDraft(row.id, { is_mock: checked })} />
                      Mark as mock
                    </label>
                    <Button onClick={() => void save(row)} disabled={savingId === row.id}>
                      {savingId === row.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                      Save rates
                    </Button>
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </AdminShell>
  );
}
'''

MIGRATION = r'''-- Phase 1 foundation for Admin > Pricing & Services.
-- Normal Ride and Access Transport preserve the confirmed R20 + R13.50/km formula.
-- Specialised-service values are seeded as editable mock data and must be reviewed before launch.

CREATE TABLE IF NOT EXISTS public.service_pricing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_type text NOT NULL UNIQUE CHECK (service_type IN ('ride','transport','assisted','appointment','extended_journey')),
  currency text NOT NULL DEFAULT 'ZAR',
  base_fare numeric(10,2) NOT NULL DEFAULT 0 CHECK (base_fare >= 0),
  per_km_rate numeric(10,2) NOT NULL DEFAULT 0 CHECK (per_km_rate >= 0),
  per_minute_rate numeric(10,2) NOT NULL DEFAULT 0 CHECK (per_minute_rate >= 0),
  companion_hourly_rate numeric(10,2) NOT NULL DEFAULT 0 CHECK (companion_hourly_rate >= 0),
  companion_minimum_hours numeric(10,2) NOT NULL DEFAULT 0 CHECK (companion_minimum_hours >= 0),
  waiting_hourly_rate numeric(10,2) NOT NULL DEFAULT 0 CHECK (waiting_hourly_rate >= 0),
  specialist_vehicle_fee numeric(10,2) NOT NULL DEFAULT 0 CHECK (specialist_vehicle_fee >= 0),
  vehicle_daily_rate numeric(10,2) NOT NULL DEFAULT 0 CHECK (vehicle_daily_rate >= 0),
  driver_daily_rate numeric(10,2) NOT NULL DEFAULT 0 CHECK (driver_daily_rate >= 0),
  driver_overnight_rate numeric(10,2) NOT NULL DEFAULT 0 CHECK (driver_overnight_rate >= 0),
  companion_daily_rate numeric(10,2) NOT NULL DEFAULT 0 CHECK (companion_daily_rate >= 0),
  platform_margin_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (platform_margin_percent >= 0 AND platform_margin_percent < 100),
  is_active boolean NOT NULL DEFAULT true,
  is_mock boolean NOT NULL DEFAULT true,
  effective_from timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_pricing_rules TO authenticated;
GRANT ALL ON public.service_pricing_rules TO service_role;
ALTER TABLE public.service_pricing_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view service pricing" ON public.service_pricing_rules;
CREATE POLICY "Admins can view service pricing"
  ON public.service_pricing_rules FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins can insert service pricing" ON public.service_pricing_rules;
CREATE POLICY "Admins can insert service pricing"
  ON public.service_pricing_rules FOR INSERT TO authenticated
  WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins can update service pricing" ON public.service_pricing_rules;
CREATE POLICY "Admins can update service pricing"
  ON public.service_pricing_rules FOR UPDATE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins can delete service pricing" ON public.service_pricing_rules;
CREATE POLICY "Admins can delete service pricing"
  ON public.service_pricing_rules FOR DELETE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role));

DROP TRIGGER IF EXISTS set_service_pricing_rules_updated_at ON public.service_pricing_rules;
CREATE TRIGGER set_service_pricing_rules_updated_at
  BEFORE UPDATE ON public.service_pricing_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.service_pricing_rules (
  service_type, base_fare, per_km_rate, per_minute_rate,
  companion_hourly_rate, companion_minimum_hours, waiting_hourly_rate,
  specialist_vehicle_fee, vehicle_daily_rate, driver_daily_rate,
  driver_overnight_rate, companion_daily_rate, platform_margin_percent,
  is_active, is_mock
) VALUES
  ('ride', 20.00, 13.50, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, true, false),
  ('transport', 20.00, 13.50, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, true, false),
  ('assisted', 20.00, 13.50, 0, 120.00, 2.00, 0, 150.00, 0, 0, 0, 0, 15.00, true, true),
  ('appointment', 20.00, 13.50, 0, 120.00, 2.00, 100.00, 150.00, 0, 0, 0, 0, 15.00, true, true),
  ('extended_journey', 20.00, 13.50, 0, 0, 0, 0, 250.00, 1200.00, 900.00, 450.00, 800.00, 15.00, true, true)
ON CONFLICT (service_type) DO NOTHING;

COMMENT ON TABLE public.service_pricing_rules IS
  'Admin-controlled, version-ready pricing foundation. Specialised-service seed values are mock data until reviewed.';
'''

write("src/components/AppShell.tsx", APP_SHELL)
write("src/components/AdminShell.tsx", ADMIN_SHELL)
write("src/routes/app.admin.passengers.tsx", PASSENGERS_PAGE)
write("src/routes/app.admin.pricing-services.tsx", PRICING_PAGE)
write("supabase/migrations/20260730173000_phase1_service_pricing_rules.sql", MIGRATION)

# Driver cleanup: keep all trip operations, remove financial visibility and standardise navigation.
driver_path = "src/routes/app.driver.tsx"
driver = read(driver_path)
driver = driver.replace('import { useEffect, useMemo, useState } from "react";', 'import { useEffect, useState } from "react";')
driver = driver.replace('import { useAuth, useUserRoles } from "@/hooks/use-auth";', 'import { useAuth } from "@/hooks/use-auth";')
driver = driver.replace('import { AppShell, NAV_ICONS } from "@/components/AppShell";', 'import { AppShell } from "@/components/AppShell";')
driver = driver.replace('import { formatZAR } from "@/lib/pricing";\n', '')
driver = driver.replace('  const { roles } = useUserRoles(user?.id);\n', '')
driver = re.sub(r'\n  const nav = useMemo\(\(\) => \{.*?\n  \}, \[roles\]\);\n', '\n', driver, count=1, flags=re.S)
driver = driver.replace('<AppShell title="Driver" nav={nav}>', '<AppShell title="Driver">')
driver = replace_once(
    driver,
    '      <UpcomingScheduledTrips driverId={user!.id} onActivate={setActiveRide} />\n      <DriverHistory driverId={user!.id} />',
    '      <div id="upcoming" className="scroll-mt-20">\n        <UpcomingScheduledTrips driverId={user!.id} onActivate={setActiveRide} />\n      </div>\n      <div id="history" className="scroll-mt-20">\n        <DriverHistory driverId={user!.id} />\n      </div>',
    "driver section anchors",
)
driver = driver.replace(
    ': `★ ${rating.avg.toFixed(2)} · ${rating.count} rating${rating.count === 1 ? "" : "s"}`}',
    ': `★ ${rating.avg.toFixed(2)} from ${rating.count} rating${rating.count === 1 ? "" : "s"}`}',
)
driver = replace_once(
    driver,
    '''            <div className="text-right">\n              <p className="text-base font-semibold">{formatZAR(Number(r.estimated_price))}</p>\n              <p className="text-xs text-muted-foreground">{Number(r.distance_km).toFixed(1)} km</p>\n            </div>''',
    '''            <div className="text-right">\n              <p className="text-sm font-medium">{Number(r.distance_km).toFixed(1)} km</p>\n              <p className="text-xs text-muted-foreground">Trip distance</p>\n            </div>''',
    "open ride money",
)
driver = driver.replace('          <Stat label="Fare" value={formatZAR(Number(ride.estimated_price))} />\n', '')
driver = driver.replace('          <div className="grid grid-cols-3 gap-2 rounded-lg bg-secondary px-3 py-2 text-xs">', '          <div className="grid grid-cols-2 gap-2 rounded-lg bg-secondary px-3 py-2 text-xs">')
driver = driver.replace('            <Stat label="Fare" value={formatZAR(Number(next.estimated_price ?? 0))} />\n', '')
driver = replace_once(
    driver,
    '''  const totals = completed.reduce(\n    (acc, r) => {\n      const km = Number(r.actual_distance_km ?? r.distance_km) || 0;\n      const fare = Number(r.estimated_price) || 0;\n      acc.km += km;\n      acc.earnings += fare;\n      return acc;\n    },\n    { km: 0, earnings: 0 },\n  );''',
    '''  const totalKm = completed.reduce(\n    (sum, r) => sum + (Number(r.actual_distance_km ?? r.distance_km) || 0),\n    0,\n  );''',
    "driver history totals",
)
driver = driver.replace('      <div className="mb-4 grid grid-cols-3 gap-2">\n        <SummaryStat label="Completed" value={String(completed.length)} />\n        <SummaryStat label="Distance" value={`${totals.km.toFixed(1)} km`} />\n        <SummaryStat label="Earnings" value={formatZAR(totals.earnings)} />\n      </div>', '      <div className="mb-4 grid grid-cols-2 gap-2">\n        <SummaryStat label="Completed" value={String(completed.length)} />\n        <SummaryStat label="Distance" value={`${totalKm.toFixed(1)} km`} />\n      </div>')
driver = replace_once(
    driver,
    '''                  <div className="text-right">\n                    <p className="text-sm font-semibold">\n                      {formatZAR(Number(r.estimated_price))}\n                    </p>\n                    <RideStatusBadge status={r.status} />\n                  </div>''',
    '''                  <div className="text-right">\n                    <RideStatusBadge status={r.status} />\n                  </div>''',
    "driver history row money",
)
driver = re.sub(r'\n\s*<p className="text-base font-semibold">\n\s*\{formatZAR\(Number\(r\.estimated_price\)\)\}\n\s*</p>', '', driver)
if "formatZAR" in driver or "Earnings" in driver or 'label="Fare"' in driver:
    raise RuntimeError("driver cleanup incomplete: financial UI remains")
write(driver_path, driver)

# Admin overview: correct misleading terminology while preserving the existing calculation.
admin_index_path = "src/routes/app.admin.index.tsx"
admin_index = read(admin_index_path)
admin_index = admin_index.replace('    earnings: number;', '    completedTripValue: number;')
admin_index = admin_index.replace('        const earnings = completedRides.reduce', '        const completedTripValue = completedRides.reduce')
admin_index = admin_index.replace('          earnings,', '          completedTripValue,')
admin_index = admin_index.replace('            label="Estimated earnings (completed)"\n            value={metrics ? formatZAR(metrics.earnings) : "—"}', '            label="Completed Trip Value"\n            description="Sum of estimated prices for completed trips. This is not confirmed revenue or driver earnings."\n            value={metrics ? formatZAR(metrics.completedTripValue) : "—"}')
admin_index = admin_index.replace('  label, value, active, onClick,\n}: {\n  label: string;\n  value: string | number;\n  active?: boolean;\n  onClick?: () => void;\n}) {', '  label, value, active, onClick, description,\n}: {\n  label: string;\n  value: string | number;\n  active?: boolean;\n  onClick?: () => void;\n  description?: string;\n}) {')
admin_index = admin_index.replace('        <p className="mt-1 text-2xl font-semibold">{value}</p>\n      </button>', '        <p className="mt-1 text-2xl font-semibold">{value}</p>\n        {description ? <p className="mt-1 text-[11px] font-normal normal-case text-muted-foreground">{description}</p> : null}\n      </button>')
admin_index = admin_index.replace('      <p className="mt-1 text-2xl font-semibold">{value}</p>\n    </div>', '      <p className="mt-1 text-2xl font-semibold">{value}</p>\n      {description ? <p className="mt-1 text-[11px] font-normal normal-case text-muted-foreground">{description}</p> : null}\n    </div>', 1)
if "metrics.earnings" in admin_index or "Estimated earnings" in admin_index:
    raise RuntimeError("admin metric rename incomplete")
write(admin_index_path, admin_index)

# Drivers page: drivers only. Passenger profiles now live on /app/admin/passengers.
drivers_path = "src/routes/app.admin.drivers.tsx"
drivers = read(drivers_path)
drivers = re.sub(r'\n  const \[passengers, setPassengers\] = useState<Profile\[\]>\(\[\]\);', '', drivers, count=1)
drivers = drivers.replace('        setPassengers([]);\n', '')
drivers = re.sub(
    r'\n\n      const \{ data: passengerRoles \} = await supabase.*?\n      \} else if \(!cancelled\) \{\n        setPassengers\(\[\]\);\n      \}',
    '',
    drivers,
    count=1,
    flags=re.S,
)
drivers = re.sub(r'\n  const filteredPassengers = passengers\.filter\(\(p\) => \{.*?\n  \}\);', '', drivers, count=1, flags=re.S)
drivers = re.sub(
    r'\n\s*<h3 className="mb-3 mt-6 text-sm font-semibold uppercase tracking-wide text-muted-foreground">\n\s*Passengers .*?\n\s*</ul>',
    '',
    drivers,
    count=1,
    flags=re.S,
)
if "filteredPassengers" in drivers or "setPassengers" in drivers or "Passengers (" in drivers:
    raise RuntimeError("passenger content still present on drivers page")
write(drivers_path, drivers)

print("Phase 1 files patched successfully.")
