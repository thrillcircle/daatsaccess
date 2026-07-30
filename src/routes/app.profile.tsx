import { createFileRoute, Link } from "@tanstack/react-router";
import { LifeBuoy, Loader2, ShieldCheck } from "lucide-react";
import { useAuth, useUserRoles } from "@/hooks/use-auth";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { PersonalProfileCard } from "@/components/profile/PersonalProfileCard";
import { PassengerProfileSections } from "@/components/profile/PassengerProfileSections";
import { DriverProfileSections } from "@/components/profile/DriverProfileSections";

export const Route = createFileRoute("/app/profile")({
  head: () => ({ meta: [{ title: "Profile — Access" }] }),
  component: ProfilePage,
});

function ProfilePage() {
  const { user, loading: authLoading } = useAuth();
  const { roles, loading: rolesLoading } = useUserRoles(user?.id);

  if (authLoading || rolesLoading || !user) {
    return (
      <AppShell title="Profile">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading profile…
        </p>
      </AppShell>
    );
  }

  const isPassenger = !!roles?.includes("passenger");
  const isDriver = !!roles?.includes("driver");
  const isAdmin = !!roles?.includes("admin");
  const driverOnly = isDriver && !isPassenger && !isAdmin;
  const primaryRole = isAdmin ? "Administrator" : isPassenger ? "Passenger" : isDriver ? "Driver" : "Account";

  return (
    <AppShell title="Profile">
      <PersonalProfileCard user={user} readOnly={driverOnly} roleLabel={primaryRole} />

      {isPassenger ? <PassengerProfileSections userId={user.id} /> : null}
      {isDriver ? <DriverProfileSections userId={user.id} /> : null}

      {isAdmin ? (
        <section className="mt-4 rounded-2xl border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <h2 className="font-semibold">Administrator account</h2>
          </div>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border bg-secondary/40 p-3">
              <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Account ID</dt>
              <dd className="mt-1 break-all font-mono text-xs">{user.id}</dd>
            </div>
            <div className="rounded-xl border bg-secondary/40 p-3">
              <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Account created</dt>
              <dd className="mt-1 text-sm font-medium">
                {user.created_at ? new Date(user.created_at).toLocaleString("en-ZA") : "Unavailable"}
              </dd>
            </div>
          </dl>
          <p className="mt-4 text-xs text-muted-foreground">
            Administrator roles cannot be assigned or removed from this profile page. Role changes belong in the future Users & Roles module.
          </p>
          <Button asChild className="mt-4" variant="outline">
            <Link to="/app/admin">Return to Admin Overview</Link>
          </Button>
        </section>
      ) : null}

      <section className="mt-4 rounded-2xl border bg-card p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <LifeBuoy className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">Support</h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Create and track a support ticket for trip, booking, profile, driver, or vehicle issues.
        </p>
        <Button asChild className="mt-4 w-full">
          <Link to="/app/support">Open Access Support</Link>
        </Button>
      </section>
    </AppShell>
  );
}
