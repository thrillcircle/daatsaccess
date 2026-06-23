import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Phone, Star, Car, MapPin, Navigation, Clock, AlertTriangle } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RideStatusBadge } from "@/components/RideStatusBadge";
import { RouteMap } from "@/components/RouteMap";
import { useRideLiveLocations } from "@/hooks/use-ride-live-locations";
import {
  getRideDriverDetails,
  type DriverDetails,
} from "@/lib/active-trip.functions";

type Ride = Database["public"]["Tables"]["rides"]["Row"];

const STALE_MS = 45_000;

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function relativeTime(iso: string | null | undefined, now: number) {
  if (!iso) return "—";
  const diff = Math.max(0, now - new Date(iso).getTime());
  if (diff < 10_000) return "just now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

export function ActiveTripCard({ ride, onCancel }: { ride: Ride; onCancel?: () => void }) {
  const fetchDriver = useServerFn(getRideDriverDetails);
  const [driver, setDriver] = useState<DriverDetails | null | undefined>(undefined);
  const [driverErr, setDriverErr] = useState<string | null>(null);
  const liveRows = useRideLiveLocations(ride.id);
  const [now, setNow] = useState(Date.now());

  // Tick once a second for stale calc / ETA freshness.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Load driver details once a driver is assigned, and refresh on driver change.
  useEffect(() => {
    if (!ride.driver_id) {
      setDriver(null);
      return;
    }
    let cancelled = false;
    setDriver(undefined);
    setDriverErr(null);
    fetchDriver({ data: { rideId: ride.id } })
      .then((d) => !cancelled && setDriver(d))
      .catch((e: unknown) => {
        if (cancelled) return;
        setDriverErr(e instanceof Error ? e.message : "Failed to load driver");
        setDriver(null);
      });
    return () => {
      cancelled = true;
    };
  }, [ride.id, ride.driver_id, fetchDriver]);

  const driverLive = useMemo(
    () => liveRows.find((r) => r.user_role === "driver"),
    [liveRows],
  );

  const pickup = { lat: ride.pickup_lat, lng: ride.pickup_lng };
  const destination = { lat: ride.destination_lat, lng: ride.destination_lng };
  const beforePickup = ["accepted", "driver_arriving", "arrived"].includes(ride.status);
  const inProgress = ride.status === "in_progress";

  const driverPos = driverLive
    ? { lat: Number(driverLive.latitude), lng: Number(driverLive.longitude) }
    : null;
  const updatedAtIso = driverLive?.updated_at ?? null;
  const updatedAtMs = updatedAtIso ? new Date(updatedAtIso).getTime() : 0;
  const isStale = updatedAtIso ? now - updatedAtMs > STALE_MS : false;

  // Distance to pickup + ETA (simple 30 km/h urban estimate).
  let distanceToPickupKm: number | null = null;
  let etaMin: number | null = null;
  if (driverPos && beforePickup) {
    distanceToPickupKm = haversineKm(driverPos, pickup);
    etaMin = Math.max(1, Math.round((distanceToPickupKm / 30) * 60));
  }

  // Decide what the map shows.
  const mapOrigin =
    inProgress ? pickup : beforePickup && driverPos ? driverPos : pickup;
  const mapDestination = inProgress ? destination : pickup;

  return (
    <section className="rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)]">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Your ride
        </h2>
        <RideStatusBadge status={ride.status} />
      </div>

      <RouteMap origin={mapOrigin} destination={mapDestination} className="h-56" />

      {/* Live tracking strip */}
      {(beforePickup || inProgress) && (
        <div className="mt-3 rounded-lg bg-secondary px-3 py-2 text-sm">
          {ride.status === "requested" ? (
            <span className="text-muted-foreground">Finding a driver…</span>
          ) : !driverPos ? (
            <span className="flex items-center gap-2 text-muted-foreground">
              <Clock className="h-4 w-4" /> Waiting for driver location…
            </span>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {beforePickup ? (
                  <>
                    <Navigation className="h-4 w-4 text-primary" />
                    <span>
                      {ride.status === "arrived"
                        ? "Driver has arrived"
                        : `${distanceToPickupKm?.toFixed(1)} km away · ~${etaMin} min`}
                    </span>
                  </>
                ) : (
                  <>
                    <Car className="h-4 w-4 text-primary" />
                    <span>On the way to destination</span>
                  </>
                )}
              </div>
              <span
                className={
                  "inline-flex items-center gap-1 text-xs " +
                  (isStale ? "text-warning-foreground" : "text-muted-foreground")
                }
              >
                {isStale && <AlertTriangle className="h-3 w-3" />}
                {isStale ? "Stale" : "Updated"} {relativeTime(updatedAtIso, now)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Driver card — only when matched */}
      {ride.driver_id && (
        <div className="mt-4 rounded-xl border bg-background p-3">
          {driver === undefined ? (
            <div className="flex items-center gap-3">
              <Skeleton className="h-12 w-12 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ) : driver === null ? (
            <p className="text-sm text-muted-foreground">
              {driverErr ?? "Driver details unavailable"}
            </p>
          ) : (
            <div className="flex items-start gap-3">
              <Avatar className="h-12 w-12">
                {driver.avatarUrl && <AvatarImage src={driver.avatarUrl} alt={driver.fullName ?? "Driver"} />}
                <AvatarFallback>
                  {(driver.fullName ?? "D").slice(0, 1).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate font-medium">{driver.fullName ?? "Your driver"}</p>
                  {driver.avgRating != null && (
                    <span className="inline-flex items-center gap-1 text-sm">
                      <Star className="h-3.5 w-3.5 fill-warning text-warning" />
                      {driver.avgRating.toFixed(1)}
                    </span>
                  )}
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {[driver.vehicleType, driver.vehicleModel].filter(Boolean).join(" · ") ||
                    "Vehicle details pending"}
                </p>
                {driver.licensePlate && (
                  <p className="mt-1 inline-block rounded border bg-muted px-1.5 py-0.5 font-mono text-xs tracking-wider">
                    {driver.licensePlate}
                  </p>
                )}
              </div>
              {driver.phone && (
                <Button asChild size="sm" variant="outline" className="shrink-0">
                  <a href={`tel:${driver.phone}`} aria-label={`Call ${driver.fullName ?? "driver"}`}>
                    <Phone className="h-4 w-4" />
                  </a>
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Trip addresses */}
      <dl className="mt-4 space-y-2 text-sm">
        <Row icon={<MapPin className="h-4 w-4 text-primary" />} label="From" value={ride.pickup_address} />
        <Row icon={<Navigation className="h-4 w-4 text-primary" />} label="To" value={ride.destination_address} />
      </dl>

      {onCancel && ride.status !== "in_progress" && ride.status !== "arrived" && (
        <Button variant="outline" className="mt-4 w-full" onClick={onCancel}>
          Cancel ride
        </Button>
      )}
    </section>
  );
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      {icon}
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate text-sm">{value}</p>
      </div>
    </div>
  );
}
