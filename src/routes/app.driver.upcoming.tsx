import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, Accessibility, Car, Clock, MapPin, Navigation } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useDriverUpcoming, type DriverWorkItem } from "@/hooks/use-driver-work";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { dayBucket, formatJoburg, type DayBucket } from "@/components/driver/driver-utils";

export const Route = createFileRoute("/app/driver/upcoming")({
  head: () => ({
    meta: [
      { title: "Upcoming work — Access Driver" },
      {
        name: "description",
        content: "All future Access Driver assignments grouped by today, tomorrow and later.",
      },
      { property: "og:title", content: "Upcoming work — Access Driver" },
      {
        property: "og:description",
        content: "All future Access Driver assignments grouped by today, tomorrow and later.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DriverUpcomingPage,
});

const GROUP_LABEL: Record<DayBucket, string> = {
  today: "Today",
  tomorrow: "Tomorrow",
  later: "Later",
};

function WorkCard({ item }: { item: DriverWorkItem }) {
  const actionable =
    item.kind === "operation"
      ? ["dispatched", "driver_en_route", "driver_arrived", "in_service", "waiting"].includes(
          item.status,
        )
      : false;
  return (
    <div className="space-y-2 rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-medium text-primary">
          <Clock className="h-3.5 w-3.5" />
          {item.startAt ? formatJoburg(item.startAt) : "Not scheduled"}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline">{item.status.replaceAll("_", " ")}</Badge>
          {item.assignmentStatus ? (
            <Badge variant={item.acknowledged ? "secondary" : "default"}>
              {item.acknowledged ? "Acknowledged" : "Awaiting acknowledgement"}
            </Badge>
          ) : null}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {item.reference} · {item.serviceType.replaceAll("_", " ")}
      </p>
      <p className="flex items-start gap-2 text-sm">
        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <span className="truncate">{item.pickup ?? "Pickup pending"}</span>
      </p>
      <p className="flex items-start gap-2 text-sm">
        <Navigation className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <span className="truncate">{item.destination ?? "Destination pending"}</span>
      </p>
      {item.vehicleLabel ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Car className="h-3.5 w-3.5" /> {item.vehicleLabel}
        </p>
      ) : null}
      {item.accessibility.length ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Accessibility className="h-3.5 w-3.5" /> {item.accessibility.join(" · ")}
        </p>
      ) : null}
      {item.scheduleChanged ? (
        <p className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 text-xs">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
          Schedule changed — check the latest timing before you travel.
        </p>
      ) : null}
      {actionable ? (
        <Button asChild size="sm" className="w-full">
          <Link to="/app/driver">Go to active service</Link>
        </Button>
      ) : null}
    </div>
  );
}

function DriverUpcomingPage() {
  const { user } = useAuth();
  const { items, loading } = useDriverUpcoming(user?.id);

  const groups: Record<DayBucket, DriverWorkItem[]> = { today: [], tomorrow: [], later: [] };
  for (const item of items) groups[dayBucket(item.startAt)].push(item);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-lg font-semibold">Upcoming work</h1>
        <p className="text-sm text-muted-foreground">
          Future assignments only. Completed and cancelled work lives in{" "}
          <Link to="/app/driver/history" className="underline">
            History
          </Link>
          .
        </p>
      </header>

      {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {!loading && !items.length ? (
        <div className="rounded-2xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
          Nothing scheduled yet. New assignments appear here as soon as Operations plans them.
        </div>
      ) : null}

      {(["today", "tomorrow", "later"] as DayBucket[]).map((bucket) =>
        groups[bucket].length ? (
          <section key={bucket} className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {GROUP_LABEL[bucket]} ({groups[bucket].length})
            </h2>
            {groups[bucket].map((item) => (
              <WorkCard key={item.key} item={item} />
            ))}
          </section>
        ) : null,
      )}
    </div>
  );
}
