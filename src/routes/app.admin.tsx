import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/app/admin")({
  head: () => ({
    meta: [
      { title: "Admin — Access" },
      {
        name: "description",
        content:
          "Access admin console: live trips, drivers, fleet readiness and booking operations.",
      },
      { property: "og:title", content: "Admin — Access" },
      {
        property: "og:description",
        content:
          "Access admin console: live trips, drivers, fleet readiness and booking operations.",
      },
      { property: "og:url", content: "https://daats.app/app/admin" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <Outlet />,
});
