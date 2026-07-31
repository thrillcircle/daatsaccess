import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Clock, MapPin, Navigation } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { startScheduledPickup } from "@/lib/ride-driver.functions";
import { formatJoburg, openMapsNav, type DriverSafeRide } from "@/components/driver/driver-utils";
import { fetchDriverRides } from "@/lib/driver-rides";

type PassengerLite = { user_id: string; full_name: string | null };

/**
 * Scheduled rides the Driver has accepted. Used on the Drive hub with a small
 * `limit` (compact preview) and on the Upcoming page without a limit.
 */
export function UpcomingScheduledTrips({
  driverId,
  onActivate,
  limit,
  title = "Upcoming trips",
  showViewAll = false,
}: {
  driverId: string;
  onActivate?: (r: DriverSafeRide) => void;
  limit?: number;
  title?: string;
  showViewAll?: boolean;
}) {
  const [rides, setRides] = useState<DriverSafeRide[]>([]);
  const [passengers, setPassengers] = useState<Map<string, PassengerLite>>(new Map());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, force] = useState(0);
  const start = useServerFn(startScheduledPickup);

  const load = useCallback(async () => {
    // Protected Driver projection — never a direct `rides` read.
    let list: DriverSafeRide[] = [];
    try {
      list = (await fetchDriverRides("upcoming", 200)).filter(
        (r) => r.request_type === "scheduled",
      );
    } catch {
      list = [];
    }
    list.sort(
      (a, b) =>
        new Date(a.scheduled_at ?? 0).getTime() - new Date(b.scheduled_at ?? 0).getTime(),
    );
    setRides(list);
    const ids = Array.from(new Set(list.map((r) => r.passenger_id)));
    if (ids.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", ids);
      setPassengers(new Map(((profs ?? []) as PassengerLite[]).map((p) => [p.user_id, p])));
    }
  }, []);

  useEffect(() => {
    void load();
    const channel = supabase
      .channel("driver-upcoming-signal-" + driverId)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "operation_run_assignments",
          filter: `driver_user_id=eq.${driverId}`,
        },
        () => void load(),
      )
      .subscribe();
    // Re-evaluate the 30-min pickup window (and reload the safe projection)
    // every minute so the start button enables without a manual reload.
    const tick = setInterval(() => {
      force((n) => n + 1);
      void load();
    }, 60_000);
    return () => {
      void supabase.removeChannel(channel);
      clearInterval(tick);
    };
  }, [driverId, load]);

  async function onStart(r: DriverSafeRide) {
    setBusyId(r.id);
    // Open Maps synchronously to satisfy popup blockers.
    const win = openMapsNav(r.pickup_lat, r.pickup_lng);
    try {
      const updated = await start({ data: { rideId: r.id } });
      onActivate?.(updated as DriverSafeRide);
      toast.success("Pickup navigation started");
    } catch (e) {
      win?.close();
      toast.error(e instanceof Error ? e.message : "Could not start pickup");
    } finally {
      setBusyId(null);
    }
  }

  if (!rides.length) return null;
  const visible = limit ? rides.slice(0, limit) : rides;

  return (
    <section className="mt-6 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {title} ({rides.length})
        </h3>
        {showViewAll ? (
          <Button asChild variant="link" size="sm" className="h-auto p-0">
            <Link to="/app/driver/upcoming">View all upcoming</Link>
          </Button>
        ) : null}
      </div>
      {visible.map((r) => {
        const p = passengers.get(r.passenger_id);
        const scheduledMs = r.scheduled_at ? new Date(r.scheduled_at).getTime() : null;
        const minsAway =
          scheduledMs != null ? Math.round((scheduledMs - Date.now()) / 60_000) : null;
        const inWindow = minsAway != null && minsAway <= 30;
        const soon = minsAway != null && minsAway <= 60;
        return (
          <div
            key={r.id}
            className={`space-y-3 rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)] ${
              soon ? "ring-2 ring-primary/40" : ""
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1 text-sm">
                <p className="flex items-center gap-1.5 text-xs font-medium text-primary">
                  <Clock className="h-3.5 w-3.5" />
                  {r.scheduled_at ? formatJoburg(r.scheduled_at) : "—"}
                  {minsAway != null && minsAway > 0 && (
                    <span className="text-muted-foreground">
                      · in {minsAway < 60 ? `${minsAway} min` : `${Math.round(minsAway / 60)}h`}
                    </span>
                  )}
                </p>
                <p className="flex items-start gap-2">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span className="truncate">{r.pickup_address}</span>
                </p>
                <p className="flex items-start gap-2">
                  <Navigation className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span className="truncate">{r.destination_address}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {p?.full_name ?? "Passenger"} · {Number(r.distance_km).toFixed(1)} km
                </p>
              </div>
            </div>
            <Button
              className="w-full"
              size="lg"
              disabled={!inWindow || busyId === r.id}
              onClick={() => onStart(r)}
            >
              {busyId === r.id
                ? "Starting…"
                : inWindow
                  ? "Start pickup navigation"
                  : `Available 30 min before pickup`}
            </Button>
          </div>
        );
      })}
    </section>
  );
}
