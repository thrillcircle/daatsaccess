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
import { useRouteEstimate } from "@/hooks/use-route-estimate";

import { formatZAR } from "@/lib/pricing";
import { pricingDb, rpcNullable } from "@/lib/pricing-api";
import { usePassengerPricingEstimate } from "@/hooks/use-passenger-pricing-estimate";
import type { Database } from "@/integrations/supabase/types";
import { Car, Radio } from "lucide-react";
import { useLiveLocation } from "@/hooks/use-live-location";
import { PassengerOperationsTimeline } from "@/components/operations/PassengerOperationsTimeline";
import { cancelPassengerRide, reschedulePassengerRide } from "@/lib/passenger-ride-workflows";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Ride = Database["public"]["Tables"]["rides"]["Row"];

const JOBURG_TZ = "Africa/Johannesburg";

function formatJoburg(d: Date): string {
  return d.toLocaleString("en-ZA", {
    timeZone: JOBURG_TZ,
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function localInputNow(): string {
  // datetime-local needs YYYY-MM-DDTHH:mm in the browser's local time.
  const d = new Date(Date.now() + 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const Route = createFileRoute("/app/passenger/")({
  head: () => ({
    meta: [
      { title: "Ride — Access" },
      {
        name: "description",
        content:
          "Your Access passenger dashboard: request a ride, follow your active trip and review your recent Access journeys.",
      },
      { property: "og:title", content: "Ride — Access" },
      {
        property: "og:description",
        content:
          "Your Access passenger dashboard: request a ride, follow your active trip and review your recent Access journeys.",
      },
      { property: "og:url", content: "https://daats.app/app/passenger" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: "https://daats.app/app/passenger" }],
  }),

  component: PassengerPage,
});

function PassengerPage() {
  const { user } = useAuth();
  const { roles } = useUserRoles(user?.id);

  const nav = useMemo(() => {
    const items = [
      { to: "/app/passenger", label: "Ride", icon: NAV_ICONS.Passenger },
      { to: "/app/passenger/book", label: "Book", icon: NAV_ICONS.Profile },
      { to: "/app/passenger/bookings", label: "Bookings", icon: NAV_ICONS.Profile },
    ];
    if (roles?.includes("driver"))
      items.push({ to: "/app/driver", label: "Drive", icon: NAV_ICONS.Driver });
    if (roles?.includes("admin"))
      items.push({ to: "/app/admin", label: "Admin", icon: NAV_ICONS.Admin });
    items.push({ to: "/app/profile", label: "Profile", icon: NAV_ICONS.Profile });
    return items;
  }, [roles]);

  return (
    <AppShell title="Ride" nav={nav}>
      <h1 className="mb-3 text-xl font-semibold tracking-tight">Book a ride</h1>
      <RideRequest userId={user?.id} />

      <PassengerOperationsTimeline userId={user?.id} />
      <RatePrompt userId={user?.id} />
      <ScheduledTrips userId={user?.id} />
      <BecomeDriver userId={user?.id} hasDriverRole={!!roles?.includes("driver")} />
      <RideHistory
        userId={user?.id}
        title="Completed trips"
        statuses={["completed"]}
        emptyText="No completed trips yet. Your finished rides will show here."
      />
      <RideHistory
        userId={user?.id}
        title="Cancelled trips"
        statuses={["cancelled"]}
        emptyText="No cancelled trips."
      />
    </AppShell>
  );
}

function RatePrompt({ userId }: { userId?: string }) {
  const [ride, setRide] = useState<Ride | null>(null);
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("rides")
        .select("*")
        .eq("passenger_id", userId)
        .eq("status", "completed")
        .not("driver_id", "is", null)
        .order("completed_at", { ascending: false })
        .limit(5);
      const list = (data ?? []) as Ride[];
      if (!list.length) return;
      const { data: reviews } = await supabase
        .from("ride_reviews")
        .select("ride_id")
        .eq("passenger_id", userId)
        .in(
          "ride_id",
          list.map((r) => r.id),
        );
      const rated = new Set((reviews ?? []).map((r) => r.ride_id));
      const next = list.find((r) => !rated.has(r.id));
      if (!cancelled) setRide(next ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);
  if (!ride) return null;
  return (
    <section className="mt-3 rounded-2xl border border-primary/30 bg-primary/5 p-4">
      <p className="text-sm font-medium">How was your last trip?</p>
      <p className="mt-1 truncate text-xs text-muted-foreground">{ride.destination_address}</p>
      <a
        href={`/app/trip/${ride.id}`}
        className="mt-3 inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
      >
        Rate your driver
      </a>
    </section>
  );
}

function RideRequest({ userId }: { userId?: string }) {
  const [pickupPt, setPickupPt] = useState<AddressPick | null>(null);
  const [destPt, setDestPt] = useState<AddressPick | null>(null);
  const [bias, setBias] = useState<{ lat: number; lng: number } | null>(null);
  const {
    distanceKm,
    durationMin,
    estimating,
    error: routeError,
    retry: retryRoute,
  } = useRouteEstimate(pickupPt, destPt);
  const [submitting, setSubmitting] = useState(false);

  const [activeRide, setActiveRide] = useState<Ride | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [mode, setMode] = useState<"now" | "scheduled">("now");
  // Local datetime string in user's browser timezone (Africa/Johannesburg for ZA users).
  const [scheduleLocal, setScheduleLocal] = useState<string>("");

  const scheduleDate = mode === "scheduled" && scheduleLocal ? new Date(scheduleLocal) : null;
  const scheduleValid =
    mode === "now"
      ? true
      : !!scheduleDate &&
        !Number.isNaN(scheduleDate.getTime()) &&
        scheduleDate.getTime() > Date.now() + 60_000; // at least 1 minute in future

  const {
    estimate: serverEstimate,
    loading: pricingLoading,
    error: pricingError,
  } = usePassengerPricingEstimate({
    serviceCode: "ride",
    distanceKm,
    effectiveAt: scheduleDate?.toISOString() ?? null,
  });
  const price = serverEstimate?.total ?? null;
  const canRequest = !!(pickupPt && destPt && distanceKm != null && price != null) && scheduleValid;

  // Soft-bias autocomplete around the passenger's current location (no prompt — only if cached).
  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setBias({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => undefined,
      { maximumAge: 5 * 60 * 1000, timeout: 4000 },
    );
  }, []);

  // Route distance/duration are computed by useRouteEstimate (race-safe).

  // Load + subscribe to active ride. A scheduled ride only becomes "current"
  // once its scheduled time has arrived (or it's a "now" request).
  useEffect(() => {
    if (!userId) return;
    let unsub: (() => void) | undefined;
    const isCurrent = (r: Ride) =>
      ["requested", "accepted", "driver_arriving", "arrived", "in_progress"].includes(r.status) &&
      (r.request_type !== "scheduled" ||
        (r.scheduled_at != null && new Date(r.scheduled_at).getTime() <= Date.now()));
    (async () => {
      const nowIso = new Date().toISOString();
      const { data } = await supabase
        .from("rides")
        .select("*")
        .eq("passenger_id", userId)
        .in("status", ["requested", "accepted", "driver_arriving", "arrived", "in_progress"])
        .or(`request_type.eq.now,scheduled_at.lte.${nowIso}`)
        .order("created_at", { ascending: false })
        .limit(1);
      setActiveRide((data?.[0] as Ride | undefined) ?? null);

      const ch = supabase
        .channel("passenger-rides-" + userId)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "rides", filter: `passenger_id=eq.${userId}` },
          (payload) => {
            const r = payload.new as Ride;
            if (!r) return;
            if (isCurrent(r)) setActiveRide(r);
            else setActiveRide(null);
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
    if (mode === "scheduled" && !scheduleValid) {
      toast.error("Pick a future date and time");
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await pricingDb.rpc("passenger_create_priced_ride", {
        p_pickup_address: pickupPt.address,
        p_pickup_lat: pickupPt.lat,
        p_pickup_lng: pickupPt.lng,
        p_pickup_place_id: rpcNullable(pickupPt.placeId),
        p_destination_address: destPt.address,
        p_destination_lat: destPt.lat,
        p_destination_lng: destPt.lng,
        p_destination_place_id: rpcNullable(destPt.placeId),
        p_distance_km: distanceKm,
        p_duration_seconds: rpcNullable(durationMin != null ? Math.round(durationMin * 60) : null),
        p_request_type: mode,
        p_scheduled_at: rpcNullable(
          mode === "scheduled" && scheduleDate ? scheduleDate.toISOString() : null,
        ),
        p_idempotency_key: crypto.randomUUID(),
      });
      if (error) throw error;
      const result = data as unknown as { ride?: Ride };
      if (!result.ride) throw new Error("The pricing service did not create the ride");
      const inserted = result.ride;
      if (inserted.request_type === "scheduled") {
        toast.success(
          `Trip scheduled for ${new Date(inserted.scheduled_at!).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`,
        );
        setMode("now");
        setScheduleLocal("");
      } else {
        setActiveRide(inserted);
        toast.success("Ride requested — finding a driver");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to request ride");
    } finally {
      setSubmitting(false);
    }
  }

  async function performCancel() {
    if (!activeRide) return;
    setCancelling(true);
    try {
      await cancelPassengerRide(activeRide.id);
      setConfirmCancel(false);
      setActiveRide(null);
      toast.success("Ride cancelled");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to cancel ride", {
        action: { label: "Retry", onClick: () => void performCancel() },
      });
    } finally {
      setCancelling(false);
    }
  }

  // Share pickup position only while driver is en route (before pickup).
  const sharePickup =
    !!activeRide &&
    !!userId &&
    ["accepted", "driver_arriving", "arrived"].includes(activeRide.status);
  const passengerLive = useLiveLocation({
    enabled: sharePickup,
    userId,
    role: "passenger",
    rideId: sharePickup ? activeRide!.id : null,
  });

  if (activeRide) {
    return (
      <>
        <ActiveTripCard ride={activeRide} onCancel={() => setConfirmCancel(true)} />
        <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Cancel this ride?</AlertDialogTitle>
              <AlertDialogDescription>
                Your driver will be notified. You can request a new ride right after.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={cancelling}>Keep ride</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  void performCancel();
                }}
                disabled={cancelling}
              >
                {cancelling ? "Cancelling…" : "Cancel ride"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {sharePickup && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-xs text-muted-foreground">
            <Radio
              className={
                "h-3.5 w-3.5 " + (passengerLive.status === "watching" ? "text-primary" : "")
              }
            />
            {passengerLive.status === "watching"
              ? "Sharing your pickup location with the driver"
              : passengerLive.status === "denied" || passengerLive.status === "unavailable"
                ? "Location off — driver will navigate to your typed pickup address"
                : "Starting location sharing…"}
          </div>
        )}
        <div className="mt-3 flex items-center justify-between rounded-lg bg-secondary px-3 py-2 text-sm">
          <span className="text-muted-foreground">
            {Number(activeRide.distance_km).toFixed(2)} km
          </span>
          <span className="font-semibold">{formatZAR(Number(activeRide.estimated_price))}</span>
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

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant={mode === "now" ? "default" : "outline"}
          onClick={() => setMode("now")}
        >
          Ride now
        </Button>
        <Button
          type="button"
          variant={mode === "scheduled" ? "default" : "outline"}
          onClick={() => setMode("scheduled")}
        >
          Schedule for later
        </Button>
      </div>

      {mode === "scheduled" && (
        <div className="mt-3 space-y-2 rounded-lg border bg-background p-3">
          <Label htmlFor="schedule-at" className="text-xs">
            Pickup time (Africa/Johannesburg)
          </Label>
          <Input
            id="schedule-at"
            type="datetime-local"
            value={scheduleLocal}
            min={localInputNow()}
            onChange={(e) => setScheduleLocal(e.target.value)}
          />
          {scheduleDate && scheduleValid ? (
            <p className="text-xs text-muted-foreground">
              Scheduled for{" "}
              <strong className="text-foreground">{formatJoburg(scheduleDate)}</strong>
            </p>
          ) : scheduleLocal ? (
            <p className="text-xs text-destructive">Pick a time in the future.</p>
          ) : null}
          <p className="text-[11px] text-muted-foreground">
            Final ETA can change due to traffic and driver availability.
          </p>
        </div>
      )}

      {pickupPt && destPt && (
        <div className="mt-4 space-y-3">
          <RouteMap origin={pickupPt} destination={destPt} className="h-48" />
          <div className="flex items-center justify-between rounded-lg bg-secondary px-3 py-2 text-sm">
            <span className="text-muted-foreground">
              {estimating || pricingLoading
                ? "Estimating…"
                : distanceKm != null
                  ? `${distanceKm.toFixed(2)} km${durationMin != null ? ` · ~${durationMin} min` : ""}`
                  : "—"}
            </span>
            <span className="font-semibold">{price != null ? formatZAR(price) : "—"}</span>
          </div>
          {routeError ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-destructive/40 px-3 py-2">
              <p className="text-xs text-destructive">{routeError}</p>
              <Button type="button" size="sm" variant="outline" onClick={retryRoute}>
                Retry
              </Button>
            </div>
          ) : null}
          {pricingError ? <p className="text-xs text-destructive">{pricingError}</p> : null}

          <Button
            className="w-full"
            size="lg"
            onClick={onRequest}
            disabled={!canRequest || submitting || estimating || pricingLoading}
          >
            {submitting
              ? mode === "scheduled"
                ? "Scheduling…"
                : "Requesting…"
              : mode === "scheduled"
                ? "Schedule ride"
                : "Request ride"}
          </Button>
        </div>
      )}
    </section>
  );
}

type ScheduledRideRow = Ride & {
  driver?: {
    full_name: string | null;
    vehicle_model: string | null;
    vehicle_type: string | null;
    license_plate: string | null;
  } | null;
};

function ScheduledTrips({ userId }: { userId?: string }) {
  const [rides, setRides] = useState<ScheduledRideRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editVal, setEditVal] = useState<string>("");

  const load = async () => {
    if (!userId) return;
    setLoading(true);
    const { data } = await supabase
      .from("rides")
      .select("*")
      .eq("passenger_id", userId)
      .eq("request_type", "scheduled")
      .in("status", ["requested", "accepted"])
      .gt("scheduled_at", new Date().toISOString())
      .order("scheduled_at", { ascending: true });
    const list = (data ?? []) as Ride[];
    const driverIds = Array.from(
      new Set(list.map((r) => r.driver_id).filter((v): v is string => !!v)),
    );
    let driverMap = new Map<
      string,
      {
        full_name: string | null;
        vehicle_model: string | null;
        vehicle_type: string | null;
        license_plate: string | null;
      }
    >();
    if (driverIds.length) {
      const [{ data: profs }, { data: vehs }] = await Promise.all([
        supabase.from("profiles").select("user_id, full_name").in("user_id", driverIds),
        supabase
          .from("driver_profiles")
          .select("user_id, vehicle_model, vehicle_type, license_plate")
          .in("user_id", driverIds),
      ]);
      const pMap = new Map((profs ?? []).map((p) => [p.user_id, p]));
      const vMap = new Map((vehs ?? []).map((v) => [v.user_id, v]));
      driverMap = new Map(
        driverIds.map((id) => [
          id,
          {
            full_name: pMap.get(id)?.full_name ?? null,
            vehicle_model: vMap.get(id)?.vehicle_model ?? null,
            vehicle_type: vMap.get(id)?.vehicle_type ?? null,
            license_plate: vMap.get(id)?.license_plate ?? null,
          },
        ]),
      );
    }
    setRides(
      list.map((r) => ({
        ...r,
        driver: r.driver_id ? (driverMap.get(r.driver_id) ?? null) : null,
      })),
    );
    setLoading(false);
  };

  useEffect(() => {
    if (!userId) return;
    load();
    const ch = supabase
      .channel("passenger-scheduled-" + userId)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rides", filter: `passenger_id=eq.${userId}` },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function cancel(id: string) {
    try {
      await cancelPassengerRide(id);
      toast.success("Scheduled trip cancelled");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to cancel trip");
    }
  }

  async function saveEdit(id: string) {
    if (!editVal) return;
    const d = new Date(editVal);
    if (Number.isNaN(d.getTime()) || d.getTime() <= Date.now() + 60_000) {
      toast.error("Pick a future date and time");
      return;
    }
    try {
      await reschedulePassengerRide(id, d.toISOString());
      toast.success("Scheduled time updated");
      setEditingId(null);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reschedule trip");
    }
  }

  if (loading) return null;
  if (!rides.length) return null;

  return (
    <section className="mt-4 rounded-2xl border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Upcoming scheduled trips
      </h3>
      <ul className="divide-y">
        {rides.map((r) => {
          const editing = editingId === r.id;
          return (
            <li key={r.id} className="space-y-2 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground">
                    {r.scheduled_at ? formatJoburg(new Date(r.scheduled_at)) : "—"}
                  </p>
                  <p className="mt-1 truncate text-sm font-medium">{r.destination_address}</p>
                  <p className="truncate text-xs text-muted-foreground">From {r.pickup_address}</p>
                  <p className="text-xs text-muted-foreground">
                    {Number(r.distance_km).toFixed(1)} km · ~
                    {r.estimated_duration_seconds
                      ? Math.round(r.estimated_duration_seconds / 60)
                      : "?"}{" "}
                    min
                  </p>
                  {r.driver && (
                    <p className="mt-1 rounded-md bg-secondary px-2 py-1 text-xs">
                      <span className="font-medium">Driver assigned:</span>{" "}
                      {r.driver.full_name ?? "Driver"}
                      {r.driver.vehicle_model ? ` · ${r.driver.vehicle_model}` : ""}
                      {r.driver.license_plate ? ` · ${r.driver.license_plate}` : ""}
                    </p>
                  )}
                </div>
                <p className="text-sm font-semibold">{formatZAR(Number(r.estimated_price))}</p>
              </div>
              {editing ? (
                <div className="flex items-center gap-2">
                  <Input
                    type="datetime-local"
                    value={editVal}
                    min={localInputNow()}
                    onChange={(e) => setEditVal(e.target.value)}
                  />
                  <Button size="sm" onClick={() => saveEdit(r.id)}>
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  {!r.driver_id && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditingId(r.id);
                        if (r.scheduled_at) {
                          const d = new Date(r.scheduled_at);
                          const pad = (n: number) => String(n).padStart(2, "0");
                          setEditVal(
                            `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`,
                          );
                        }
                      }}
                    >
                      Edit time
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => cancel(r.id)}>
                    Cancel trip
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Final ETA can change due to traffic and driver availability.
      </p>
    </section>
  );
}

function BecomeDriver({ userId, hasDriverRole }: { userId?: string; hasDriverRole: boolean }) {
  if (!userId || hasDriverRole) return null;
  async function onBecome() {
    const { error } = await supabase
      .from("user_roles")
      .insert({ user_id: userId!, role: "driver" });
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

type HistoryRow = Ride & {
  driver?: { full_name: string | null } | null;
  driver_vehicle?: {
    vehicle_model: string | null;
    vehicle_type: string | null;
    license_plate: string | null;
  } | null;
  review?: { rating: number } | null;
};

type RideStatus = Database["public"]["Enums"]["ride_status"];

function RideHistory({
  userId,
  title = "Trip history",
  statuses = ["completed", "cancelled"],
  emptyText = "No trips to show.",
}: {
  userId?: string;
  title?: string;
  statuses?: RideStatus[];
  emptyText?: string;
}) {
  const [rides, setRides] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("rides")
        .select("*")
        .eq("passenger_id", userId)
        .in("status", statuses)
        .order("created_at", { ascending: false })
        .limit(50);
      const list = (data ?? []) as Ride[];
      const driverIds = Array.from(
        new Set(list.map((r) => r.driver_id).filter((v): v is string => !!v)),
      );
      const rideIds = list.map((r) => r.id);
      const [profilesRes, vehiclesRes, reviewsRes] = await Promise.all([
        driverIds.length
          ? supabase.from("profiles").select("user_id, full_name").in("user_id", driverIds)
          : Promise.resolve({ data: [] as { user_id: string; full_name: string | null }[] }),
        driverIds.length
          ? supabase
              .from("driver_profiles")
              .select("user_id, vehicle_model, vehicle_type, license_plate")
              .in("user_id", driverIds)
          : Promise.resolve({
              data: [] as {
                user_id: string;
                vehicle_model: string | null;
                vehicle_type: string | null;
                license_plate: string | null;
              }[],
            }),
        rideIds.length
          ? supabase
              .from("ride_reviews")
              .select("ride_id, rating")
              .eq("passenger_id", userId)
              .in("ride_id", rideIds)
          : Promise.resolve({ data: [] as { ride_id: string; rating: number }[] }),
      ]);
      const pMap = new Map((profilesRes.data ?? []).map((p) => [p.user_id, p]));
      const vMap = new Map((vehiclesRes.data ?? []).map((v) => [v.user_id, v]));
      const rMap = new Map((reviewsRes.data ?? []).map((r) => [r.ride_id, r]));
      const enriched: HistoryRow[] = list.map((r) => ({
        ...r,
        driver: r.driver_id ? (pMap.get(r.driver_id) ?? null) : null,
        driver_vehicle: r.driver_id ? (vMap.get(r.driver_id) ?? null) : null,
        review: rMap.get(r.id) ?? null,
      }));
      if (!cancelled) {
        setRides(enriched);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, statuses]);

  return (
    <section className="mt-4 rounded-2xl border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {loading ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
      ) : !rides.length ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="divide-y">
          {rides.map((r) => {
            const travelSec =
              r.actual_duration_seconds ??
              (r.started_at && r.completed_at
                ? Math.round(
                    (new Date(r.completed_at).getTime() - new Date(r.started_at).getTime()) / 1000,
                  )
                : null);
            const distKm = r.actual_distance_km ?? r.distance_km;
            const distLabel =
              r.actual_distance_km != null
                ? `${Number(distKm).toFixed(1)} km`
                : `${Number(distKm).toFixed(1)} km (est)`;
            const tripDate = new Date(r.completed_at ?? r.created_at);
            const vehicle = [r.driver_vehicle?.vehicle_model, r.driver_vehicle?.license_plate]
              .filter(Boolean)
              .join(" · ");
            return (
              <li key={r.id} className="py-3">
                <a
                  href={`/app/trip/${r.id}`}
                  className="block rounded-lg p-1 -m-1 hover:bg-muted/40 focus:bg-muted/40 focus:outline-none"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-xs text-muted-foreground">
                          {tripDate.toLocaleString(undefined, {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </p>
                        <span className="rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                          {r.request_type === "scheduled" ? "Scheduled" : "Immediate"}
                        </span>
                        {r.review ? (
                          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                            ★ {r.review.rating}/5
                          </span>
                        ) : r.status === "completed" ? (
                          <span className="text-[10px] text-muted-foreground">Not rated</span>
                        ) : null}
                      </div>
                      <p className="mt-1 truncate text-sm font-medium">{r.destination_address}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        From {r.pickup_address}
                      </p>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {r.driver?.full_name ?? "Driver"}
                        {vehicle ? ` · ${vehicle}` : ""}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {distLabel}
                        {travelSec != null ? ` · ${Math.round(travelSec / 60)} min` : ""}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold">
                        {formatZAR(Number(r.estimated_price))}
                      </p>
                      <RideStatusBadge status={r.status} />
                    </div>
                  </div>
                </a>
              </li>
            );
          })}
        </ul>
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
