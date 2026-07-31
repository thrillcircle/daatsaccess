import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Car, MapPin, Navigation } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useDriverHistory } from "@/hooks/use-driver-work";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatJoburg } from "@/components/driver/driver-utils";

export const Route = createFileRoute("/app/driver/history")({
  head: () => ({
    meta: [
      { title: "Trip history — Access Driver" },
      {
        name: "description",
        content: "Completed, cancelled and no-show Access Driver work with filters and search.",
      },
      { property: "og:title", content: "Trip history — Access Driver" },
      {
        property: "og:description",
        content: "Completed, cancelled and no-show Access Driver work with filters and search.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DriverHistoryPage,
});

const PERIODS = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "all", label: "All time" },
];

const STATUSES = [
  "completed",
  "cancelled",
  "passenger_no_show",
  "driver_no_show",
  "failed",
  "interrupted",
];

function DriverHistoryPage() {
  const { user } = useAuth();
  const { items, loading } = useDriverHistory(user?.id);
  const [status, setStatus] = useState("all");
  const [period, setPeriod] = useState("30");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const cutoff = period === "all" ? null : Date.now() - Number(period) * 24 * 60 * 60 * 1000;
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      if (status !== "all" && item.status !== status) return false;
      const when = new Date(item.endAt ?? item.startAt ?? 0).getTime();
      if (cutoff != null && when < cutoff) return false;
      if (q) {
        const hay = [item.reference, item.pickup, item.destination, item.vehicleLabel]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, status, period, search]);

  const totalKm = filtered.reduce((sum, i) => sum + (i.distanceKm ?? 0), 0);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold">Trip history</h1>
        <p className="text-sm text-muted-foreground">Completed and closed work only.</p>
      </header>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border bg-background p-3">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Trips</p>
          <p className="mt-1 text-sm font-semibold">{filtered.length}</p>
        </div>
        <div className="rounded-lg border bg-background p-3">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Distance</p>
          <p className="mt-1 text-sm font-semibold">{totalKm.toFixed(1)} km</p>
        </div>
      </div>

      <div className="space-y-3 rounded-2xl border bg-card p-4">
        <div className="space-y-1.5">
          <Label>Search</Label>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Address or reference"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s.replaceAll("_", " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Period</Label>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIODS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {!loading && !filtered.length ? (
        <div className="rounded-2xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
          No past work matches these filters.
        </div>
      ) : null}

      <ul className="space-y-3">
        {filtered.map((item) => (
          <li key={item.key} className="space-y-2 rounded-2xl border bg-card p-4">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {item.endAt || item.startAt
                  ? formatJoburg((item.endAt ?? item.startAt) as string)
                  : "—"}
              </p>
              <Badge variant="outline">{item.status.replaceAll("_", " ")}</Badge>
            </div>
            <p className="flex items-start gap-2 text-sm">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span className="truncate">{item.pickup ?? "—"}</span>
            </p>
            <p className="flex items-start gap-2 text-sm">
              <Navigation className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span className="truncate">{item.destination ?? "—"}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              {item.reference}
              {item.distanceKm != null ? ` · ${item.distanceKm.toFixed(1)} km` : ""}
              {item.durationSeconds != null
                ? ` · ${Math.round(item.durationSeconds / 60)} min`
                : ""}
            </p>
            {item.vehicleLabel ? (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Car className="h-3.5 w-3.5" /> {item.vehicleLabel}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
