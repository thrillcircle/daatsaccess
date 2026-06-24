import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useUserRoles } from "@/hooks/use-auth";
import { AppShell, NAV_ICONS } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LiveTripMap } from "@/components/LiveTripMap";
import { RideStatusBadge } from "@/components/RideStatusBadge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { formatZAR } from "@/lib/pricing";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";
import { MapPin, Navigation, AlertTriangle, Bell, Phone, Clock, Pencil, ExternalLink } from "lucide-react";
import { useLiveLocation } from "@/hooks/use-live-location";
import { useRideChanges } from "@/hooks/use-ride-changes";
import { useRideLiveLocations } from "@/hooks/use-ride-live-locations";
import { useServerFn } from "@tanstack/react-start";
import { acknowledgeRideChange } from "@/lib/ride-edit.functions";
import {
  acceptRide,
  markArrived,
  completeTrip,
  startScheduledPickup,
} from "@/lib/ride-driver.functions";
import {
  getRidePassengerDetails,
  type PassengerDetails,
} from "@/lib/driver-trip.functions";
import { StartTripPinDialog } from "@/components/StartTripPinDialog";

const PICKUP_WINDOW_MS = 30 * 60 * 1000;
const isFarFutureScheduled = (r: Ride) =>
  r.request_type === "scheduled" &&
  r.scheduled_at != null &&
  new Date(r.scheduled_at).getTime() - Date.now() > PICKUP_WINDOW_MS;

function mapsNavUrl(lat: number, lng: number) {
  return `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${lat},${lng}`;
}
function openMapsNav(lat: number, lng: number): Window | null {
  // Called synchronously inside the click handler to satisfy popup-blockers.
  return typeof window !== "undefined"
    ? window.open(mapsNavUrl(lat, lng), "_blank", "noopener,noreferrer")
    : null;
}

type Ride = Database["public"]["Tables"]["rides"]["Row"];
type DriverProfile = Database["public"]["Tables"]["driver_profiles"]["Row"];


export const Route = createFileRoute("/app/driver")({
  head: () => ({ meta: [{ title: "Driver — Access" }] }),
  component: DriverPage,
});

function DriverPage() {
  const { user } = useAuth();
  const { roles } = useUserRoles(user?.id);
  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [activeRide, setActiveRide] = useState<Ride | null>(null);
  const [openRides, setOpenRides] = useState<Ride[]>([]);

  const nav = useMemo(() => {
    const items = [];
    if (roles?.includes("passenger")) items.push({ to: "/app/passenger", label: "Ride", icon: NAV_ICONS.Passenger });
    items.push({ to: "/app/driver", label: "Drive", icon: NAV_ICONS.Driver });
    if (roles?.includes("admin")) items.push({ to: "/app/admin", label: "Admin", icon: NAV_ICONS.Admin });
    return items;
  }, [roles]);

  // Load driver profile
  useEffect(() => {
    if (!user) return;
    supabase
      .from("driver_profiles")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        setProfile(data);
        setLoadingProfile(false);
      });
  }, [user]);

  // Active ride for this driver. Far-future scheduled rides that the driver
  // has accepted remain "accepted" until pickup nears — they are surfaced
  // separately in the Upcoming scheduled trips list, not as the active ride.
  useEffect(() => {
    if (!user) return;
    let unsub: (() => void) | undefined;
    const pickActive = (r: Ride | null | undefined): Ride | null => {
      if (!r) return null;
      if (!["accepted", "driver_arriving", "arrived", "in_progress"].includes(r.status))
        return null;
      if (r.status === "accepted" && isFarFutureScheduled(r)) return null;
      return r;
    };
    (async () => {
      const { data } = await supabase
        .from("rides")
        .select("*")
        .eq("driver_id", user.id)
        .in("status", ["accepted", "driver_arriving", "arrived", "in_progress"])
        .order("created_at", { ascending: false });
      const list = (data ?? []) as Ride[];
      setActiveRide(list.map(pickActive).find((r): r is Ride => r != null) ?? null);

      const ch = supabase
        .channel("driver-active-" + user.id)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "rides", filter: `driver_id=eq.${user.id}` },
          (payload) => {
            const r = payload.new as Ride;
            const picked = pickActive(r);
            if (picked) setActiveRide(picked);
            else setActiveRide(null);
          },
        )
        .subscribe();
      unsub = () => supabase.removeChannel(ch);
    })();
    return () => unsub?.();
  }, [user]);

  // Open ride requests (only when online and no active ride)
  useEffect(() => {
    if (!user || !profile?.is_available || activeRide) {
      setOpenRides([]);
      return;
    }
    let unsub: (() => void) | undefined;
    const load = async () => {
      const nowIso = new Date().toISOString();
      const { data } = await supabase
        .from("rides")
        .select("*")
        .is("driver_id", null)
        .eq("status", "requested")
        .or(`request_type.eq.now,scheduled_at.lte.${nowIso}`)
        .order("created_at", { ascending: false })
        .limit(20);
      setOpenRides((data ?? []) as Ride[]);

    };
    load();
    const ch = supabase
      .channel("driver-open-rides")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rides" },
        () => load(),
      )
      .subscribe();
    unsub = () => supabase.removeChannel(ch);
    return () => unsub?.();
  }, [user, profile?.is_available, activeRide]);

  const trackingRideId =
    activeRide && ["accepted", "driver_arriving", "arrived", "in_progress"].includes(activeRide.status)
      ? activeRide.id
      : null;
  const live = useLiveLocation({
    enabled: !!profile?.is_available,
    userId: user?.id,
    role: "driver",
    rideId: trackingRideId,
    updateDriverProfile: true,
  });

  if (loadingProfile) {
    return (
      <AppShell title="Driver" nav={nav}>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </AppShell>
    );
  }

  if (!profile) {
    return (
      <AppShell title="Driver" nav={nav}>
        <DriverOnboarding userId={user!.id} onCreated={setProfile} />
      </AppShell>
    );
  }


  return (
    <AppShell title="Driver" nav={nav}>
      <OnlineToggle profile={profile} onChange={setProfile} />
      {profile.is_available && (live.status === "denied" || live.status === "unavailable") && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="h-4 w-4" />
          Location unavailable — passengers can't see you. Enable location and try again.
        </div>
      )}
      {activeRide ? (
        <ActiveRideCard ride={activeRide} onUpdate={setActiveRide} />
      ) : profile.is_available ? (
        <>
          <OpenRidesList
            rides={openRides.filter(
              (r) =>
                r.request_type !== "scheduled" ||
                (r.scheduled_at != null &&
                  new Date(r.scheduled_at).getTime() <= Date.now()),
            )}
            driverId={user!.id}
          />
          <ScheduledOpenRequests driverId={user!.id} online={profile.is_available} />
        </>
      ) : (
        <div className="mt-4 rounded-2xl border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
          You're offline. Go online to see ride requests.
        </div>
      )}
      <UpcomingScheduledTrips driverId={user!.id} onActivate={setActiveRide} />
      <DriverHistory driverId={user!.id} />

    </AppShell>
  );
}

function DriverOnboarding({
  userId,
  onCreated,
}: {
  userId: string;
  onCreated: (p: DriverProfile) => void;
}) {
  const [vehicleType, setVehicleType] = useState("Sedan");
  const [vehicleModel, setVehicleModel] = useState("");
  const [licensePlate, setLicensePlate] = useState("");
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const { data, error } = await supabase
      .from("driver_profiles")
      .insert({
        user_id: userId,
        vehicle_type: vehicleType,
        vehicle_model: vehicleModel,
        license_plate: licensePlate,
        is_available: false,
      })
      .select()
      .single();
    setSaving(false);
    if (error) toast.error(error.message);
    else if (data) {
      onCreated(data);
      toast.success("Driver profile created");
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border bg-card p-4">
      <div>
        <h2 className="text-lg font-semibold">Driver setup</h2>
        <p className="text-sm text-muted-foreground">Tell us about your vehicle.</p>
      </div>
      <div className="space-y-1.5">
        <Label>Vehicle type</Label>
        <Input value={vehicleType} onChange={(e) => setVehicleType(e.target.value)} required />
      </div>
      <div className="space-y-1.5">
        <Label>Vehicle model</Label>
        <Input
          value={vehicleModel}
          onChange={(e) => setVehicleModel(e.target.value)}
          placeholder="Toyota Corolla 2020"
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label>License plate</Label>
        <Input
          value={licensePlate}
          onChange={(e) => setLicensePlate(e.target.value.toUpperCase())}
          placeholder="ABC 123 GP"
          required
        />
      </div>
      <Button type="submit" className="w-full" disabled={saving}>
        {saving ? "Saving…" : "Save and continue"}
      </Button>
    </form>
  );
}

function OnlineToggle({
  profile,
  onChange,
}: {
  profile: DriverProfile;
  onChange: (p: DriverProfile) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [rating, setRating] = useState<{ avg: number; count: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("ride_reviews")
        .select("rating")
        .eq("driver_id", profile.user_id);
      if (cancelled) return;
      const rows = (data ?? []) as { rating: number }[];
      if (!rows.length) setRating({ avg: 0, count: 0 });
      else {
        const sum = rows.reduce((a, r) => a + r.rating, 0);
        setRating({ avg: sum / rows.length, count: rows.length });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profile.user_id]);

  async function toggle(checked: boolean) {
    setBusy(true);
    let payload: Partial<DriverProfile> = { is_available: checked };
    if (checked && "geolocation" in navigator) {
      await new Promise<void>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            payload = {
              ...payload,
              current_lat: pos.coords.latitude,
              current_lng: pos.coords.longitude,
            };
            resolve();
          },
          () => resolve(),
          { timeout: 5000 },
        );
      });
    }
    const { data, error } = await supabase
      .from("driver_profiles")
      .update(payload)
      .eq("user_id", profile.user_id)
      .select()
      .single();
    setBusy(false);
    if (error) toast.error(error.message);
    else if (data) onChange(data);
  }
  return (
    <section className="flex items-center justify-between rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)]">
      <div>
        <p className="font-medium">{profile.is_available ? "Online" : "Offline"}</p>
        <p className="text-xs text-muted-foreground">
          {profile.vehicle_model} · {profile.license_plate}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {rating == null
            ? "Loading rating…"
            : rating.count === 0
              ? "No ratings yet"
              : `★ ${rating.avg.toFixed(2)} · ${rating.count} rating${rating.count === 1 ? "" : "s"}`}
        </p>
      </div>
      <Switch checked={profile.is_available} onCheckedChange={toggle} disabled={busy} />
    </section>
  );
}


function OpenRidesList({ rides }: { rides: Ride[]; driverId: string }) {
  const accept = useServerFn(acceptRide);
  async function onAccept(ride: Ride) {
    // Pre-open the Maps tab synchronously so the popup-blocker treats it as
    // user-initiated. If the server claim fails we close the placeholder.
    const win = openMapsNav(ride.pickup_lat, ride.pickup_lng);
    try {
      await accept({ data: { rideId: ride.id } });
      toast.success("Ride accepted — navigating to pickup");
    } catch (e) {
      win?.close();
      toast.error(e instanceof Error ? e.message : "Could not accept ride");
    }
  }


  if (!rides.length) {
    return (
      <div className="mt-4 rounded-2xl border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
        Waiting for ride requests…
      </div>
    );
  }
  return (
    <section className="mt-4 space-y-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Open requests ({rides.length})
      </h3>
      {rides.map((r) => (
        <div key={r.id} className="space-y-3 rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-2 text-sm">
              <p className="flex items-start gap-2">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span className="truncate">{r.pickup_address}</span>
              </p>
              <p className="flex items-start gap-2">
                <Navigation className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span className="truncate">{r.destination_address}</span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-base font-semibold">{formatZAR(Number(r.estimated_price))}</p>
              <p className="text-xs text-muted-foreground">{Number(r.distance_km).toFixed(1)} km</p>
            </div>
          </div>
          <Button className="w-full" onClick={() => onAccept(r)}>
            Accept ride
          </Button>

        </div>
      ))}
    </section>
  );
}

function ActiveRideCard({ ride, onUpdate }: { ride: Ride; onUpdate: (r: Ride | null) => void }) {
  const arriveFn = useServerFn(markArrived);
  const startFn = useServerFn(startTrip);
  const completeFn = useServerFn(completeTrip);
  const [busy, setBusy] = useState(false);
  // Track whether the last attempt to open Google Maps was blocked, so we can
  // surface a large fallback "Open Google Maps Navigation" button.
  const [navBlocked, setNavBlocked] = useState(false);

  const navTarget: { lat: number; lng: number; label: string } =
    ride.status === "in_progress"
      ? { lat: ride.destination_lat, lng: ride.destination_lng, label: "destination" }
      : { lat: ride.pickup_lat, lng: ride.pickup_lng, label: "pickup" };

  function launchNav() {
    const win = openMapsNav(navTarget.lat, navTarget.lng);
    setNavBlocked(!win);
    return win;
  }

  async function onArrived() {
    setBusy(true);
    try {
      const r = await arriveFn({ data: { rideId: ride.id } });
      onUpdate(r as Ride);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not mark arrived");
    } finally {
      setBusy(false);
    }
  }

  async function onStart() {
    setBusy(true);
    // Open Maps to the destination synchronously inside the click.
    const win = openMapsNav(ride.destination_lat, ride.destination_lng);
    try {
      const r = await startFn({ data: { rideId: ride.id } });
      setNavBlocked(!win);
      onUpdate(r as Ride);
      toast.success("Trip started — navigating to destination");
    } catch (e) {
      win?.close();
      toast.error(e instanceof Error ? e.message : "Could not start trip");
    } finally {
      setBusy(false);
    }
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

  async function cancel() {
    const { error } = await supabase
      .from("rides")
      .update({ status: "cancelled" })
      .eq("id", ride.id);
    if (error) toast.error(error.message);
    else {
      onUpdate(null);
      toast.success("Ride cancelled");
    }
  }


  // Passenger contact (active rides only — hidden after completion/cancel).
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

  // Live positions for both participants on this ride.
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

  // Distance + ETA to pickup (simple 30 km/h urban estimate when no live route).
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
  const destEtaClock = etaToDestMin != null
    ? clockIn((etaToPickupMin ?? 0) + etaToDestMin)
    : null;

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
          <RideStatusBadge status={ride.status} />
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
                ? pickupEtaClock ?? "—"
                : etaToDestMin != null
                  ? `~${etaToDestMin} min`
                  : "—"
            }
          />
          <Stat
            label="Drop-off ETA"
            value={destEtaClock ?? (etaToDestMin != null ? `~${etaToDestMin} min` : "—")}
          />
          <Stat label="Fare" value={formatZAR(Number(ride.estimated_price))} />
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
        <Button className="mt-4 w-full" size="lg" onClick={onStart} disabled={busy}>
          Start trip
        </Button>
      )}
      {ride.status === "in_progress" && (
        <Button className="mt-4 w-full" size="lg" onClick={onComplete} disabled={busy}>
          Complete trip
        </Button>
      )}
      {ride.status !== "in_progress" && (
        <Button variant="outline" className="mt-2 w-full" onClick={cancel} disabled={busy}>
          Cancel
        </Button>
      )}
    </section>
  );
}


function PassengerCard({
  passenger,
}: {
  passenger: PassengerDetails | null | undefined;
}) {
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
        <AvatarFallback>
          {(passenger.fullName ?? "P").slice(0, 1).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {passenger.fullName ?? "Your passenger"}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {passenger.phone ?? "No phone on file"}
        </p>
      </div>
      {passenger.phone && (
        <Button asChild size="sm" variant="outline" className="shrink-0">
          <a href={`tel:${passenger.phone}`} aria-label={`Call ${passenger.fullName ?? "passenger"}`}>
            <Phone className="h-4 w-4" />
          </a>
        </Button>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}

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

function clockIn(minutes: number) {
  const d = new Date(Date.now() + minutes * 60_000);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function timeAgo(iso: string) {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

function TripChangeAlerts({
  ride,
  passengerName,
}: {
  ride: Ride;
  passengerName: string | null;
}) {
  const changes = useRideChanges(ride.id);
  const ack = useServerFn(acknowledgeRideChange);
  const [busy, setBusy] = useState<string | null>(null);

  const pending = changes.filter((c) => !c.acknowledged_by_driver_at);
  const current = pending[0];
  // Force-open whenever a pending change exists so the driver cannot miss it.
  const open = !!current;

  async function onAck() {
    if (!current) return;
    setBusy(current.id);
    try {
      await ack({ data: { changeId: current.id } });
      const next = (current.new_values ?? {}) as Record<string, unknown>;
      // Re-launch navigation to the updated stop. Pickup change before pickup;
      // destination change once carrying the passenger.
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
          <div className="grid grid-cols-3 gap-2 rounded-lg bg-secondary px-3 py-2 text-xs">
            <Stat label="Distance" value={`${Number(next.distance_km ?? 0).toFixed(1)} km`} />
            <Stat label="ETA" value={newDurationMin != null ? `${newDurationMin} min` : "—"} />
            <Stat label="Fare" value={formatZAR(Number(next.estimated_price ?? 0))} />
          </div>
        </div>

        <AlertDialogFooter>
          <Button
            className="w-full"
            size="lg"
            onClick={onAck}
            disabled={busy === current.id}
          >
            {busy === current.id
              ? "Acknowledging…"
              : "Acknowledge and update navigation"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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

type DriverHistoryRow = Ride & {
  passenger?: { full_name: string | null } | null;
};

function DriverHistory({ driverId }: { driverId: string }) {
  const [rows, setRows] = useState<DriverHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("rides")
        .select("*")
        .eq("driver_id", driverId)
        .in("status", ["completed", "cancelled"])
        .order("completed_at", { ascending: false, nullsFirst: false })
        .limit(50);
      const list = (data ?? []) as Ride[];
      const passengerIds = Array.from(new Set(list.map((r) => r.passenger_id)));
      const { data: profs } = passengerIds.length
        ? await supabase
            .from("profiles")
            .select("user_id, full_name")
            .in("user_id", passengerIds)
        : { data: [] as { user_id: string; full_name: string | null }[] };
      const pMap = new Map((profs ?? []).map((p) => [p.user_id, p]));
      const enriched: DriverHistoryRow[] = list.map((r) => ({
        ...r,
        passenger: pMap.get(r.passenger_id) ?? null,
      }));
      if (!cancelled) {
        setRows(enriched);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [driverId]);

  const completed = rows.filter((r) => r.status === "completed");
  const totals = completed.reduce(
    (acc, r) => {
      const km = Number(r.actual_distance_km ?? r.distance_km) || 0;
      const fare = Number(r.estimated_price) || 0;
      acc.km += km;
      acc.earnings += fare;
      return acc;
    },
    { km: 0, earnings: 0 },
  );

  return (
    <section className="mt-6 rounded-2xl border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Trip history
        </h3>
      </div>
      <div className="mb-4 grid grid-cols-3 gap-2">
        <SummaryStat label="Completed" value={String(completed.length)} />
        <SummaryStat label="Distance" value={`${totals.km.toFixed(1)} km`} />
        <SummaryStat label="Earnings" value={formatZAR(totals.earnings)} />
      </div>
      {loading ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
      ) : !rows.length ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No past trips yet. Completed rides will appear here.
        </p>
      ) : (
        <ul className="divide-y">
          {rows.map((r) => {
            const durSec =
              r.actual_duration_seconds ??
              (r.started_at && r.completed_at
                ? Math.round(
                    (new Date(r.completed_at).getTime() -
                      new Date(r.started_at).getTime()) /
                      1000,
                  )
                : null);
            const km = Number(r.actual_distance_km ?? r.distance_km);
            const when = r.completed_at ?? r.updated_at ?? r.created_at;
            return (
              <li key={r.id} className="py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted-foreground">
                      {new Date(when).toLocaleString(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </p>
                    <p className="mt-1 truncate text-sm font-medium">
                      {r.destination_address}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      From {r.pickup_address}
                    </p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {r.passenger?.full_name ?? "Passenger"}
                      {" · "}
                      {km.toFixed(1)} km
                      {r.actual_distance_km == null ? " (est)" : ""}
                      {durSec != null ? ` · ${Math.round(durSec / 60)} min` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold">
                      {formatZAR(Number(r.estimated_price))}
                    </p>
                    <RideStatusBadge status={r.status} />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
    </div>
  );
}


type PassengerLite = { user_id: string; full_name: string | null };

function formatJoburg(iso: string): string {
  return new Date(iso).toLocaleString("en-ZA", {
    timeZone: "Africa/Johannesburg",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function ScheduledOpenRequests({ driverId, online }: { driverId: string; online: boolean }) {
  const [rides, setRides] = useState<Ride[]>([]);
  const [passengers, setPassengers] = useState<Map<string, PassengerLite>>(new Map());
  const [busyId, setBusyId] = useState<string | null>(null);
  const accept = useServerFn(acceptRide);

  const load = async () => {
    const nowIso = new Date().toISOString();
    const { data } = await supabase
      .from("rides")
      .select("*")
      .is("driver_id", null)
      .eq("status", "requested")
      .eq("request_type", "scheduled")
      .gt("scheduled_at", nowIso)
      .order("scheduled_at", { ascending: true })
      .limit(20);
    const list = (data ?? []) as Ride[];
    setRides(list);
    const ids = Array.from(new Set(list.map((r) => r.passenger_id)));
    if (ids.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", ids);
      setPassengers(new Map(((profs ?? []) as PassengerLite[]).map((p) => [p.user_id, p])));
    } else {
      setPassengers(new Map());
    }
  };

  useEffect(() => {
    if (!online) return;
    load();
    const ch = supabase
      .channel("driver-scheduled-open")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rides" },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [online, driverId]);

  async function onAccept(r: Ride) {
    setBusyId(r.id);
    try {
      await accept({ data: { rideId: r.id } });
      toast.success("Scheduled trip accepted — see Upcoming trips");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not accept ride");
    } finally {
      setBusyId(null);
    }
  }

  if (!online || !rides.length) return null;
  return (
    <section className="mt-4 space-y-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Upcoming scheduled requests ({rides.length})
      </h3>
      {rides.map((r) => {
        const p = passengers.get(r.passenger_id);
        const durMin = r.estimated_duration_seconds
          ? Math.round(r.estimated_duration_seconds / 60)
          : null;
        return (
          <div
            key={r.id}
            className="space-y-3 rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)]"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1 text-sm">
                <p className="flex items-center gap-1.5 text-xs font-medium text-primary">
                  <Clock className="h-3.5 w-3.5" />
                  {r.scheduled_at ? formatJoburg(r.scheduled_at) : "—"}
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
                  {p?.full_name ?? "Passenger"} ·{" "}
                  {Number(r.distance_km).toFixed(1)} km
                  {durMin != null ? ` · ~${durMin} min` : ""}
                </p>
              </div>
              <p className="text-base font-semibold">
                {formatZAR(Number(r.estimated_price))}
              </p>
            </div>
            <Button
              className="w-full"
              onClick={() => onAccept(r)}
              disabled={busyId === r.id}
            >
              {busyId === r.id ? "Accepting…" : "Accept scheduled trip"}
            </Button>
          </div>
        );
      })}
    </section>
  );
}

function UpcomingScheduledTrips({
  driverId,
  onActivate,
}: {
  driverId: string;
  onActivate: (r: Ride) => void;
}) {
  const [rides, setRides] = useState<Ride[]>([]);
  const [passengers, setPassengers] = useState<Map<string, PassengerLite>>(new Map());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, force] = useState(0);
  const start = useServerFn(startScheduledPickup);

  const load = async () => {
    const { data } = await supabase
      .from("rides")
      .select("*")
      .eq("driver_id", driverId)
      .eq("status", "accepted")
      .eq("request_type", "scheduled")
      .order("scheduled_at", { ascending: true });
    const list = (data ?? []) as Ride[];
    setRides(list);
    const ids = Array.from(new Set(list.map((r) => r.passenger_id)));
    if (ids.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", ids);
      setPassengers(new Map(((profs ?? []) as PassengerLite[]).map((p) => [p.user_id, p])));
    }
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("driver-upcoming-" + driverId)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rides", filter: `driver_id=eq.${driverId}` },
        () => load(),
      )
      .subscribe();
    // Re-evaluate the 30-min pickup window every minute so the start button
    // becomes enabled without a manual reload.
    const tick = setInterval(() => force((n) => n + 1), 60_000);
    return () => {
      supabase.removeChannel(ch);
      clearInterval(tick);
    };
  }, [driverId]);

  async function onStart(r: Ride) {
    setBusyId(r.id);
    // Open Maps synchronously to satisfy popup blockers.
    const win = openMapsNav(r.pickup_lat, r.pickup_lng);
    try {
      const updated = await start({ data: { rideId: r.id } });
      onActivate(updated as Ride);
      toast.success("Pickup navigation started");
    } catch (e) {
      win?.close();
      toast.error(e instanceof Error ? e.message : "Could not start pickup");
    } finally {
      setBusyId(null);
    }
  }

  if (!rides.length) return null;
  return (
    <section className="mt-6 space-y-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Upcoming trips ({rides.length})
      </h3>
      {rides.map((r) => {
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
                  {p?.full_name ?? "Passenger"} ·{" "}
                  {Number(r.distance_km).toFixed(1)} km
                </p>
              </div>
              <p className="text-base font-semibold">
                {formatZAR(Number(r.estimated_price))}
              </p>
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



