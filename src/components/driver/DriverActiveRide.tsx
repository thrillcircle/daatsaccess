import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { LiveTripMap } from "@/components/LiveTripMap";
import { RideStatusBadge } from "@/components/RideStatusBadge";
import type { Database } from "@/integrations/supabase/types";

type RideStatus = Database["public"]["Enums"]["ride_status"];
import { StartTripPinDialog } from "@/components/StartTripPinDialog";
import { toast } from "sonner";
import { Bell, Clock, ExternalLink, MapPin, Navigation, Pencil, Phone } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { acknowledgeRideChange } from "@/lib/ride-edit.functions";
import { completeTrip, markArrived } from "@/lib/ride-driver.functions";
import { getRidePassengerDetails, type PassengerDetails } from "@/lib/driver-trip.functions";
import { useRideChanges } from "@/hooks/use-ride-changes";
import { useRideLiveLocations } from "@/hooks/use-ride-live-locations";
import {
  clockIn,
  haversineKm,
  openMapsNav,
  timeAgo,
  type DriverSafeRide,
} from "@/components/driver/driver-utils";
import { fetchDriverRide } from "@/lib/driver-rides";

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}

function PassengerCard({ passenger }: { passenger: PassengerDetails | null | undefined }) {
  if (passenger === undefined) {
    return (
      <div className="mt-3 flex items-center gap-3 rounded-xl border bg-background p-3">
        <Skeleton className="h-10 w-10 rounded-full" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    );
  }
  if (!passenger) return null;
  return (
    <div className="mt-3 flex items-center gap-3 rounded-xl border bg-background p-3">
      <Avatar className="h-10 w-10">
        {passenger.avatarUrl && (
          <AvatarImage src={passenger.avatarUrl} alt={passenger.fullName ?? "Passenger"} />
        )}
        <AvatarFallback>{(passenger.fullName ?? "P").slice(0, 1).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{passenger.fullName ?? "Your passenger"}</p>
        <p className="truncate text-xs text-muted-foreground">
          {passenger.phone ?? "No phone on file"}
        </p>
      </div>
      {passenger.phone && (
        <Button asChild size="sm" variant="outline" className="shrink-0">
          <a
            href={`tel:${passenger.phone}`}
            aria-label={`Call ${passenger.fullName ?? "passenger"}`}
          >
            <Phone className="h-4 w-4" />
          </a>
        </Button>
      )}
    </div>
  );
}

function ChangeRow({
  label,
  oldValue,
  newValue,
}: {
  label: string;
  oldValue: string;
  newValue: string;
}) {
  return (
    <div className="space-y-1 rounded-lg border p-3">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-xs line-through opacity-60">{oldValue || "—"}</p>
      <p className="text-sm font-medium">{newValue}</p>
    </div>
  );
}

function TripChangeAlerts({
  ride,
  passengerName,
}: {
  ride: DriverSafeRide;
  passengerName: string | null;
}) {
  const changes = useRideChanges(ride.id);
  const ack = useServerFn(acknowledgeRideChange);
  const [busy, setBusy] = useState<string | null>(null);

  const pending = changes.filter((c) => !c.acknowledged_by_driver_at);
  const current = pending[0];
  const open = !!current;

  async function onAck() {
    if (!current) return;
    setBusy(current.id);
    try {
      await ack({ data: { changeId: current.id } });
      const next = (current.new_values ?? {}) as Record<string, unknown>;
      if (ride.status === "in_progress" && "destination_address" in next) {
        openMapsNav(ride.destination_lat, ride.destination_lng);
      } else if ("pickup_address" in next) {
        openMapsNav(ride.pickup_lat, ride.pickup_lng);
      } else if ("destination_address" in next) {
        openMapsNav(ride.destination_lat, ride.destination_lng);
      }
      toast.success("Acknowledged — navigation updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not acknowledge");
    } finally {
      setBusy(null);
    }
  }

  if (!current) return null;
  const prev = (current.previous_values ?? {}) as Record<string, unknown>;
  const next = (current.new_values ?? {}) as Record<string, unknown>;
  const who = passengerName ?? "the passenger";
  const when = new Date(current.created_at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const newDurationMin =
    next.estimated_duration_seconds != null
      ? Math.max(1, Math.round(Number(next.estimated_duration_seconds) / 60))
      : null;

  return (
    <AlertDialog open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-warning" />
            Trip updated by {who}
          </AlertDialogTitle>
          <AlertDialogDescription>Changed at {when}</AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-3 text-sm">
          {"pickup_address" in next && (
            <ChangeRow
              label="Pickup"
              oldValue={String(prev.pickup_address ?? "")}
              newValue={String(next.pickup_address)}
            />
          )}
          {"destination_address" in next && (
            <ChangeRow
              label="Destination"
              oldValue={String(prev.destination_address ?? "")}
              newValue={String(next.destination_address)}
            />
          )}
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-secondary px-3 py-2 text-xs">
            <Stat label="Distance" value={`${Number(next.distance_km ?? 0).toFixed(1)} km`} />
            <Stat label="ETA" value={newDurationMin != null ? `${newDurationMin} min` : "—"} />
          </div>
        </div>

        <AlertDialogFooter>
          <Button className="w-full" size="lg" onClick={onAck} disabled={busy === current.id}>
            {busy === current.id ? "Acknowledging…" : "Acknowledge and update navigation"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ActiveRideCard({
  ride,
  onUpdate,
}: {
  ride: DriverSafeRide;
  onUpdate: (r: DriverSafeRide | null) => void;
}) {
  const arriveFn = useServerFn(markArrived);
  const completeFn = useServerFn(completeTrip);
  const [busy, setBusy] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [navBlocked, setNavBlocked] = useState(false);

  // Stops are only waypoints once the passenger is on board.
  const stops = parseRideStops(ride.route_stops);
  const stopWaypoints = stops.map((s) => ({ lat: s.lat, lng: s.lng }));

  const navTarget: { lat: number; lng: number; label: string } =
    ride.status === "in_progress"
      ? { lat: ride.destination_lat, lng: ride.destination_lng, label: "destination" }
      : { lat: ride.pickup_lat, lng: ride.pickup_lng, label: "pickup" };

  function launchNav() {
    const win = openMapsNav(
      navTarget.lat,
      navTarget.lng,
      ride.status === "in_progress" ? stopWaypoints : [],
    );
    setNavBlocked(!win);
    return win;
  }

  async function onArrived() {
    setBusy(true);
    try {
      const r = await arriveFn({ data: { rideId: ride.id } });
      onUpdate(r as DriverSafeRide);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not mark arrived");
    } finally {
      setBusy(false);
    }
  }

  async function onPinStarted() {
    openMapsNav(ride.destination_lat, ride.destination_lng);
    const fresh = await fetchDriverRide(ride.id).catch(() => null);
    if (fresh) onUpdate(fresh);
  }

  async function onComplete() {
    setBusy(true);
    try {
      await completeFn({ data: { rideId: ride.id } });
      toast.success("Trip completed");
      onUpdate(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not complete trip");
    } finally {
      setBusy(false);
    }
  }

  const fetchPassenger = useServerFn(getRidePassengerDetails);
  const [passenger, setPassenger] = useState<PassengerDetails | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    setPassenger(undefined);
    fetchPassenger({ data: { rideId: ride.id } })
      .then((p) => !cancelled && setPassenger(p))
      .catch(() => !cancelled && setPassenger(null));
    return () => {
      cancelled = true;
    };
  }, [ride.id, ride.status, fetchPassenger]);

  const liveRows = useRideLiveLocations(ride.id);
  const driverLive = liveRows.find((r) => r.user_role === "driver");
  const passengerLive = liveRows.find((r) => r.user_role === "passenger");
  const driverPos = driverLive
    ? { lat: Number(driverLive.latitude), lng: Number(driverLive.longitude) }
    : null;
  const passengerPos = passengerLive
    ? { lat: Number(passengerLive.latitude), lng: Number(passengerLive.longitude) }
    : null;
  const pickup = { lat: ride.pickup_lat, lng: ride.pickup_lng };
  const destination = { lat: ride.destination_lat, lng: ride.destination_lng };
  const beforePickup = ["accepted", "driver_arriving", "arrived"].includes(ride.status);
  const inProgress = ride.status === "in_progress";

  let distanceToPickupKm: number | null = null;
  let etaToPickupMin: number | null = null;
  if (driverPos && beforePickup) {
    distanceToPickupKm = haversineKm(driverPos, pickup);
    etaToPickupMin = Math.max(1, Math.round((distanceToPickupKm / 30) * 60));
  }
  const etaToDestMin =
    ride.estimated_duration_seconds != null
      ? Math.max(1, Math.round(ride.estimated_duration_seconds / 60))
      : null;
  const pickupEtaClock = etaToPickupMin != null ? clockIn(etaToPickupMin) : null;
  const destEtaClock = etaToDestMin != null ? clockIn((etaToPickupMin ?? 0) + etaToDestMin) : null;

  const wasEdited = (ride.route_version ?? 1) > 1;

  return (
    <section className="mt-4 rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)]">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Active ride
        </h2>
        <div className="flex items-center gap-2">
          {wasEdited && (
            <Badge variant="outline" className="gap-1">
              <Pencil className="h-3 w-3" /> Edited · v{ride.route_version}
            </Badge>
          )}
          <RideStatusBadge status={ride.status as RideStatus} />
        </div>
      </div>
      <TripChangeAlerts ride={ride} passengerName={passenger?.fullName ?? null} />
      <LiveTripMap
        pickup={pickup}
        destination={destination}
        driver={driverPos}
        passenger={passengerPos}
        phase={inProgress ? "inProgress" : "beforePickup"}
        className="h-48"
      />

      <PassengerCard passenger={passenger} />

      <dl className="mt-3 space-y-2 text-sm">
        <p className="flex items-start gap-2">
          <MapPin className="mt-0.5 h-4 w-4 text-primary" />
          <span className="truncate">{ride.pickup_address}</span>
        </p>
        <p className="flex items-start gap-2">
          <Navigation className="mt-0.5 h-4 w-4 text-primary" />
          <span className="truncate">{ride.destination_address}</span>
        </p>

        <div className="grid grid-cols-2 gap-2 rounded-lg bg-secondary px-3 py-2 text-xs">
          {beforePickup && (
            <Stat
              label="To pickup"
              value={
                distanceToPickupKm != null
                  ? `${distanceToPickupKm.toFixed(1)} km · ~${etaToPickupMin} min`
                  : "Waiting for GPS…"
              }
            />
          )}
          <Stat
            label={beforePickup ? "Pickup ETA" : "Trip time"}
            value={
              beforePickup
                ? (pickupEtaClock ?? "—")
                : etaToDestMin != null
                  ? `~${etaToDestMin} min`
                  : "—"
            }
          />
          <Stat
            label="Drop-off ETA"
            value={destEtaClock ?? (etaToDestMin != null ? `~${etaToDestMin} min` : "—")}
          />
        </div>

        {wasEdited && ride.last_route_updated_at && (
          <p className="flex items-center gap-1.5 pt-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            Route last edited {timeAgo(ride.last_route_updated_at)}
          </p>
        )}
      </dl>

      {navBlocked && (
        <Button
          className="mt-3 w-full"
          size="lg"
          variant="secondary"
          onClick={() => {
            const win = launchNav();
            if (win) toast.success("Opened Google Maps");
          }}
        >
          <ExternalLink className="mr-2 h-4 w-4" />
          Open Google Maps Navigation to {navTarget.label}
        </Button>
      )}

      {(ride.status === "accepted" || ride.status === "driver_arriving") && (
        <Button className="mt-4 w-full" size="lg" onClick={onArrived} disabled={busy}>
          I've arrived at pickup
        </Button>
      )}
      {ride.status === "arrived" && (
        <>
          <Button
            className="mt-4 w-full"
            size="lg"
            onClick={() => setPinOpen(true)}
            disabled={busy}
          >
            Enter passenger PIN to start trip
          </Button>
          <p className="mt-1 text-center text-xs text-muted-foreground">
            Ask the passenger for their 4-digit trip PIN before starting.
          </p>
          <StartTripPinDialog
            ride={ride}
            open={pinOpen}
            onOpenChange={setPinOpen}
            onStarted={onPinStarted}
          />
        </>
      )}
      {ride.status === "in_progress" && (
        <Button className="mt-4 w-full" size="lg" onClick={onComplete} disabled={busy}>
          Complete trip
        </Button>
      )}
      <p className="mt-3 text-center text-xs text-muted-foreground">
        Need to stop or change the service? Use the operational decline, no-show, incident, or
        support actions so Operations can keep the Ride and operation run synchronized.
      </p>
    </section>
  );
}
