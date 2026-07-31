import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/app/driver")({
  /**
   * Canonical role gate for the whole Driver route tree. Roles come from
   * `user_roles` — a Passenger or a non-Driver Admin is redirected away
   * before the layout (or any Driver onboarding UI) renders.
   */
  beforeLoad: async () => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) throw redirect({ to: "/auth" });
    const { data: roleRows } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", auth.user.id);
    const roles = (roleRows ?? []).map((r) => r.role as string);
    if (!roles.includes("driver")) {
      throw redirect({ to: roles.includes("admin") ? "/app/admin" : "/app/passenger" });
    }
    return { driverId: auth.user.id };
  },
  head: () => ({
    meta: [
      { title: "Driver hub — Access" },
      {
        name: "description",
        content: "Access Driver hub: active work, upcoming assignments and trip history.",
      },
      { property: "og:title", content: "Driver hub — Access" },
      {
        property: "og:description",
        content: "Access Driver hub: active work, upcoming assignments and trip history.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DriverLayout,
});

function DriverLayout() {
  return (
    <AppShell title="Driver">
      <Outlet />
    </AppShell>
  );
}
