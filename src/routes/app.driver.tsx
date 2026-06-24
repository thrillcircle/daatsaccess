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
  startTrip,
  completeTrip,
} from "@/lib/ride-driver.functions";
import {
  getRidePassengerDetails,
  type PassengerDetails,
} from "@/lib/driver-trip.functions";

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
type RideStatus = Database["public"]["Enums"]["ride_status"];

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

  // Active ride for this driver
  useEffect(() => {
    if (!user) return;
    let unsub: (() => void) | undefined;
    (async () => {
      const { data } = await supabase
        .from("rides")
        .select("*")
        .eq("driver_id", user.id)
        .in("status", ["accepted", "driver_arriving", "in_progress"])
        .order("created_at", { ascending: false })
        .limit(1);
      setActiveRide(data?.[0] ?? null);

      const ch = supabase
        .channel("driver-active-" + user.id)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "rides", filter: `driver_id=eq.${user.id}` },
          (payload) => {
            const r = payload.new as Ride;
            if (r && ["accepted", "driver_arriving", "in_progress"].includes(r.status)) setActiveRide(r);
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
      const { data } = await supabase
        .from("rides")
        .select("*")
        .is("driver_id", null)
        .eq("status", "requested")
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

  const trackingRideId =
    activeRide && ["accepted", "driver_arriving", "arrived", "in_progress"].includes(activeRide.status)
      ? activeRide.id
      : null;
  const live = useLiveLocation({
    enabled: !!profile.is_available,
    userId: user!.id,
    role: "driver",
    rideId: trackingRideId,
    updateDriverProfile: true,
  });

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
        <OpenRidesList rides={openRides} driverId={user!.id} />
      ) : (
        <div className="mt-4 rounded-2xl border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
          You're offline. Go online to see ride requests.
        </div>
      )}
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
      <TripChangeAlerts ride={ride} />
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

      {nextStatus[ride.status] && (
        <Button className="mt-4 w-full" size="lg" onClick={advance}>
          {nextLabel[ride.status]}
        </Button>
      )}
      {ride.status !== "in_progress" && (
        <Button variant="outline" className="mt-2 w-full" onClick={cancel}>
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

function TripChangeAlerts({ ride }: { ride: Ride }) {
  const changes = useRideChanges(ride.id);
  const ack = useServerFn(acknowledgeRideChange);
  const [busy, setBusy] = useState<string | null>(null);

  const pending = changes.filter((c) => !c.acknowledged_by_driver_at);
  if (!pending.length) return null;

  async function onAck(id: string) {
    setBusy(id);
    try {
      await ack({ data: { changeId: id } });
      toast.success("Acknowledged — drive to the updated stop");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not acknowledge");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mb-3 space-y-2">
      {pending.map((c) => {
        const prev = (c.previous_values ?? {}) as Record<string, unknown>;
        const next = (c.new_values ?? {}) as Record<string, unknown>;
        return (
          <div
            key={c.id}
            className="rounded-xl border border-warning bg-warning/10 p-3 text-sm"
          >
            <div className="mb-2 flex items-center gap-2 font-medium">
              <Bell className="h-4 w-4" />
              Trip updated by passenger
            </div>
            <ul className="space-y-1 text-xs">
              {"pickup_address" in next && (
                <li>
                  <span className="text-muted-foreground">Pickup: </span>
                  <span className="line-through opacity-70">
                    {String(prev.pickup_address ?? "")}
                  </span>{" "}
                  → <span className="font-medium">{String(next.pickup_address)}</span>
                </li>
              )}
              {"destination_address" in next && (
                <li>
                  <span className="text-muted-foreground">Destination: </span>
                  <span className="line-through opacity-70">
                    {String(prev.destination_address ?? "")}
                  </span>{" "}
                  →{" "}
                  <span className="font-medium">{String(next.destination_address)}</span>
                </li>
              )}
              {"estimated_price" in next && (
                <li className="text-muted-foreground">
                  New fare: {formatZAR(Number(next.estimated_price))} ·{" "}
                  {Number(next.distance_km ?? 0).toFixed(2)} km
                </li>
              )}
            </ul>
            <Button
              size="sm"
              className="mt-2 w-full"
              onClick={() => onAck(c.id)}
              disabled={busy === c.id}
            >
              {busy === c.id ? "Acknowledging…" : "Acknowledge update"}
            </Button>
          </div>
        );
      })}
    </div>
  );
}
