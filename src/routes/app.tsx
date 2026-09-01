import {
  createFileRoute,
  Outlet,
  redirect,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentAccountStatus } from "@/lib/architecture-closeout";
import { getPassengerOnboardingStatus } from "@/lib/passenger-onboarding";
import { AutomaticPayfastCheckout } from "@/components/payments/AutomaticPayfastCheckout";

export const Route = createFileRoute("/app")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
    if ((await getCurrentAccountStatus()) === "suspended") {
      await supabase.auth.signOut();
      throw redirect({ to: "/auth", search: { mode: "signin" } });
    }
    return { user: data.user };
  },
  component: AppLayout,
});

function AppLayout() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isRoot = pathname === "/app" || pathname === "/app/";

  useEffect(() => {
    if (!isRoot) return;
    let mounted = true;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) {
        navigate({ to: "/auth" });
        return;
      }
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", u.user.id);
      const rs = (roles ?? []).map((r) => r.role as string);
      if (!mounted) return;

      if (rs.includes("admin")) {
        navigate({ to: "/app/admin" });
        return;
      }
      if (rs.includes("driver")) {
        navigate({ to: "/app/driver" });
        return;
      }
      if (rs.includes("passenger")) {
        try {
          const onboarding = await getPassengerOnboardingStatus();
          if (!mounted) return;
          navigate({
            to: onboarding.complete ? "/app/passenger" : "/app/passenger/onboarding",
          });
          return;
        } catch {
          if (!mounted) return;
          navigate({ to: "/app/passenger/onboarding" });
          return;
        }
      }

      navigate({ to: "/app/profile" });
    })();
    return () => {
      mounted = false;
    };
  }, [isRoot, navigate]);

  if (isRoot) {
    return (
      <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }
  return (
    <>
      <AutomaticPayfastCheckout />
      <Outlet />
    </>
  );
}
