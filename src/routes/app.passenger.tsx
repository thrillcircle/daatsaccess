import { createFileRoute, Outlet } from "@tanstack/react-router";

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
  component: () => <Outlet />,
});
