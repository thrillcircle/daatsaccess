import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/app/admin/vehicles")({
  beforeLoad: () => {
    throw redirect({ to: "/app/admin/fleet" });
  },
});
