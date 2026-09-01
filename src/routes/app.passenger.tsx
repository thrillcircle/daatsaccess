import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getPassengerOnboardingStatus } from "@/lib/passenger-onboarding";

export const Route = createFileRoute("/app/passenger")({
  head: () => ({
    meta: [
      { title: "Ride — Access" },
      {
        name: "description",
        content:
          "Your Access passenger area: book rides, assisted travel and appointment transport across South Africa.",
      },
      { property: "og:title", content: "Ride — Access" },
      {
        property: "og:description",
        content:
          "Your Access passenger area: book rides, assisted travel and appointment transport across South Africa.",
      },
      { property: "og:url", content: "https://daats.app/app/passenger" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PassengerLayout,
});

function PassengerLayout() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const onboardingRoute = pathname.startsWith("/app/passenger/onboarding");
    const existingBookingsRoute = pathname.startsWith("/app/passenger/bookings");
    if (onboardingRoute || existingBookingsRoute) {
      setChecking(false);
      return () => {
        cancelled = true;
      };
    }

    (async () => {
      setChecking(true);
      try {
        const onboarding = await getPassengerOnboardingStatus();
        if (cancelled) return;
        if (onboarding.complete) {
          setChecking(false);
          return;
        }

        const isPassengerRoot = pathname === "/app/passenger" || pathname === "/app/passenger/";
        if (isPassengerRoot) {
          const { data: userData } = await supabase.auth.getUser();
          const user = userData.user;
          if (!user || cancelled) return;
          const { data: activeRides } = await supabase
            .from("rides")
            .select("id")
            .eq("passenger_id", user.id)
            .in("status", ["requested", "accepted", "driver_arriving", "arrived", "in_progress"])
            .limit(1);
          if (cancelled) return;
          if (activeRides?.length) {
            setChecking(false);
            return;
          }
        }

        navigate({ to: "/app/passenger/onboarding", replace: true });
      } catch {
        if (!cancelled) navigate({ to: "/app/passenger/onboarding", replace: true });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate, pathname]);

  if (checking) {
    return (
      <div className="grid min-h-[60vh] place-items-center text-sm text-muted-foreground">
        <span className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking your passenger profile…
        </span>
      </div>
    );
  }

  return <Outlet />;
}
