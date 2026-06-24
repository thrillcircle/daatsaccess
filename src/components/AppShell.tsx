import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Car, User, ShieldCheck, LogOut, UserCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { NotificationBell } from "@/components/NotificationBell";

type NavItem = { to: string; label: string; icon: ReactNode };

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
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-md items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-primary text-primary-foreground font-bold">
              A
            </span>
            <span className="font-semibold tracking-tight">
              Access {title ? <span className="text-muted-foreground font-normal">· {title}</span> : null}
            </span>
          </Link>
          {user ? (
            <Button variant="ghost" size="icon" onClick={signOut} aria-label="Sign out">
              <LogOut className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      </header>

      <main className="mx-auto max-w-md px-4 pb-24 pt-4">{children}</main>

      {nav && nav.length ? (
        <nav className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 backdrop-blur">
          <div className="mx-auto flex max-w-md items-stretch justify-around">
            {nav.map((item) => {
              const active = pathname === item.to || pathname.startsWith(item.to + "/");
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={
                    "flex flex-1 flex-col items-center gap-1 py-3 text-xs " +
                    (active ? "text-primary" : "text-muted-foreground")
                  }
                >
                  {item.icon}
                  <span>{item.label}</span>
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
  Passenger: <User className="h-5 w-5" />,
  Driver: <Car className="h-5 w-5" />,
  Admin: <ShieldCheck className="h-5 w-5" />,
  Profile: <UserCog className="h-5 w-5" />,
};
