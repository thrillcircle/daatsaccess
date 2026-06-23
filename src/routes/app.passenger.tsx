import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useUserRoles } from "@/hooks/use-auth";
import { AppShell, NAV_ICONS } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { RouteMap } from "@/components/RouteMap";
import { RideStatusBadge } from "@/components/RideStatusBadge";
import { ActiveTripCard } from "@/components/ActiveTripCard";
import { AddressAutocomplete, type AddressPick } from "@/components/AddressAutocomplete";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { computeRoute } from "@/lib/maps.functions";
import { estimatePrice, formatZAR } from "@/lib/pricing";
import type { Database } from "@/integrations/supabase/types";
import { Car, Radio } from "lucide-react";
import { useLiveLocation } from "@/hooks/use-live-location";

type Ride = Database["public"]["Tables"]["rides"]["Row"];

export const Route = createFileRoute("/app/passenger")({
  head: () => ({ meta: [{ title: "Passenger — Access" }] }),
  component: PassengerPage,
});

function PassengerPage() {
  const { user } = useAuth();
  const { roles } = useUserRoles(user?.id);

  const nav = useMemo(() => {
    const items = [{ to: "/app/passenger", label: "Ride", icon: NAV_ICONS.Passenger }];
    if (roles?.includes("driver")) items.push({ to: "/app/driver", label: "Drive", icon: NAV_ICONS.Driver });
    if (roles?.includes("admin")) items.push({ to: "/app/admin", label: "Admin", icon: NAV_ICONS.Admin });
    items.push({ to: "/app/profile", label: "Profile", icon: NAV_ICONS.Profile });
    return items;
  }, [roles]);

  return (
    <AppShell title="Passenger" nav={nav}>
      <RideRequest userId={user?.id} />
      <BecomeDriver userId={user?.id} hasDriverRole={!!roles?.includes("driver")} />
      <RideHistory userId={user?.id} />
    </AppShell>
  );
}

function RideRequest({ userId }: { userId?: string }) {
  const route = useServerFn(computeRoute);

  const [pickupPt, setPickupPt] = useState<AddressPick | null>(null);
  const [destPt, setDestPt] = useState<AddressPick | null>(null);
  const [bias, setBias] = useState<{ lat: number; lng: number } | null>(null);
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [durationMin, setDurationMin] = useState<number | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activeRide, setActiveRide] = useState<Ride | null>(null);

  const price = distanceKm != null ? estimatePrice(distanceKm) : null;
  const canRequest = !!(pickupPt && destPt && distanceKm != null);

  // Soft-bias autocomplete around the passenger's current location (no prompt — only if cached).
  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setBias({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => undefined,
      { maximumAge: 5 * 60 * 1000, timeout: 4000 },
    );
  }, []);

  // Auto-compute route whenever both points are valid.
  useEffect(() => {
    if (!pickupPt || !destPt) {
      setDistanceKm(null);
      setDurationMin(null);
      return;
    }
    let cancelled = false;
    setEstimating(true);
    route({
      data: {
        originLat: pickupPt.lat,
        originLng: pickupPt.lng,
        destLat: destPt.lat,
        destLng: destPt.lng,
      },
    })
      .then((r) => {
        if (cancelled) return;
        setDistanceKm(r.distanceKm);
        setDurationMin(r.durationMin);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        toast.error(err instanceof Error ? err.message : "Could not compute route");
      })
      .finally(() => !cancelled && setEstimating(false));
    return () => {
      cancelled = true;
    };
  }, [pickupPt, destPt, route]);

  // Load + subscribe to active ride
  useEffect(() => {
    if (!userId) return;
    let unsub: (() => void) | undefined;
    (async () => {
      const { data } = await supabase
        .from("rides")
        .select("*")
        .eq("passenger_id", userId)
        .in("status", ["requested", "accepted", "driver_arriving", "arrived", "in_progress"])
        .order("created_at", { ascending: false })
        .limit(1);
      setActiveRide(data?.[0] ?? null);

      const ch = supabase
        .channel("passenger-rides-" + userId)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "rides", filter: `passenger_id=eq.${userId}` },
          (payload) => {
            const r = payload.new as Ride;
            if (!r) return;
            if (
              ["requested", "accepted", "driver_arriving", "arrived", "in_progress"].includes(
                r.status,
              )
            ) {
              setActiveRide(r);
            } else {
              setActiveRide(null);
            }
          },
        )
        .subscribe();
      unsub = () => {
        supabase.removeChannel(ch);
      };
    })();
    return () => unsub?.();
  }, [userId]);

  async function onRequest() {
    if (!userId || !pickupPt || !destPt || distanceKm == null || price == null) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase
        .from("rides")
        .insert({
          passenger_id: userId,
          pickup_address: pickupPt.address,
          pickup_lat: pickupPt.lat,
          pickup_lng: pickupPt.lng,
          pickup_place_id: pickupPt.placeId,
          destination_address: destPt.address,
          destination_lat: destPt.lat,
          destination_lng: destPt.lng,
          destination_place_id: destPt.placeId,
          distance_km: distanceKm,
          estimated_price: price,
          estimated_duration_seconds: durationMin != null ? durationMin * 60 : null,
        })
        .select()
        .single();
      if (error) throw error;
      setActiveRide(data as Ride);
      toast.success("Ride requested — finding a driver");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to request ride");
    } finally {
      setSubmitting(false);
    }
  }

  async function onCancel() {
    if (!activeRide) return;
    const { error } = await supabase
      .from("rides")
      .update({ status: "cancelled" })
      .eq("id", activeRide.id);
    if (error) toast.error(error.message);
    else {
      setActiveRide(null);
      toast.success("Ride cancelled");
    }
  }

  if (activeRide) {
    return (
      <>
        <ActiveTripCard ride={activeRide} onCancel={onCancel} />
        <div className="mt-3 flex items-center justify-between rounded-lg bg-secondary px-3 py-2 text-sm">
          <span className="text-muted-foreground">
            {Number(activeRide.distance_km).toFixed(2)} km
          </span>
          <span className="font-semibold">
            {formatZAR(Number(activeRide.estimated_price))}
          </span>
        </div>
      </>
    );
  }

  return (
    <section className="rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)]">
      <h2 className="text-lg font-semibold">Where to?</h2>
      <p className="text-sm text-muted-foreground">
        Search for a pickup and destination to see the fare.
      </p>

      <div className="mt-4 space-y-3">
        <AddressAutocomplete
          id="pickup"
          label="Pickup"
          value={pickupPt}
          onChange={setPickupPt}
          bias={bias}
          placeholder="e.g. Sandton City, Johannesburg"
          enableCurrentLocation
        />
        <AddressAutocomplete
          id="dest"
          label="Destination"
          value={destPt}
          onChange={setDestPt}
          bias={bias ?? (pickupPt ? { lat: pickupPt.lat, lng: pickupPt.lng } : null)}
          placeholder="e.g. OR Tambo International Airport"
        />
      </div>

      {pickupPt && destPt && (
        <div className="mt-4 space-y-3">
          <RouteMap origin={pickupPt} destination={destPt} className="h-48" />
          <div className="flex items-center justify-between rounded-lg bg-secondary px-3 py-2 text-sm">
            <span className="text-muted-foreground">
              {estimating
                ? "Estimating…"
                : distanceKm != null
                  ? `${distanceKm.toFixed(2)} km${durationMin != null ? ` · ~${durationMin} min` : ""}`
                  : "—"}
            </span>
            <span className="font-semibold">
              {price != null ? formatZAR(price) : "—"}
            </span>
          </div>
          <Button
            className="w-full"
            size="lg"
            onClick={onRequest}
            disabled={!canRequest || submitting || estimating}
          >
            {submitting ? "Requesting…" : "Request ride"}
          </Button>
        </div>
      )}
    </section>
  );
}

function BecomeDriver({ userId, hasDriverRole }: { userId?: string; hasDriverRole: boolean }) {
  if (!userId || hasDriverRole) return null;
  async function onBecome() {
    const { error } = await supabase.from("user_roles").insert({ user_id: userId!, role: "driver" });
    if (error) toast.error(error.message);
    else {
      toast.success("Driver role added — refresh to access driver mode");
      setTimeout(() => window.location.reload(), 600);
    }
  }
  return (
    <section className="mt-4 rounded-2xl border border-dashed bg-card p-4">
      <div className="flex items-start gap-3">
        <Car className="mt-0.5 h-5 w-5 text-primary" />
        <div className="flex-1">
          <h3 className="font-medium">Drive with Access</h3>
          <p className="text-sm text-muted-foreground">Earn by accepting rides from passengers.</p>
        </div>
      </div>
      <Button variant="outline" className="mt-3 w-full" onClick={onBecome}>
        Become a driver
      </Button>
    </section>
  );
}

function RideHistory({ userId }: { userId?: string }) {
  const [rides, setRides] = useState<Ride[]>([]);
  useEffect(() => {
    if (!userId) return;
    supabase
      .from("rides")
      .select("*")
      .eq("passenger_id", userId)
      .in("status", ["completed", "cancelled"])
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data }) => setRides((data ?? []) as Ride[]));
  }, [userId]);

  if (!rides.length) return null;
  return (
    <section className="mt-4 rounded-2xl border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Trip history
      </h3>
      <ul className="divide-y">
        {rides.map((r) => (
          <li key={r.id} className="py-3">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1 pr-2">
                <p className="truncate text-sm font-medium">{r.destination_address}</p>
                <p className="truncate text-xs text-muted-foreground">{r.pickup_address}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold">{formatZAR(Number(r.estimated_price))}</p>
                <RideStatusBadge status={r.status} />
              </div>
            </div>
          </li>
        ))}
      </ul>
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
