import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/app/driver")({
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
