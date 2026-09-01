import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { getPassengerOnboardingStatus } from "@/lib/passenger-onboarding";

export const Route = createFileRoute("/app/passenger/book")({
  beforeLoad: async () => {
    const onboarding = await getPassengerOnboardingStatus();
    if (!onboarding.complete) {
      throw redirect({ to: "/app/passenger/onboarding" });
    }
  },
  component: () => <Outlet />,
});
