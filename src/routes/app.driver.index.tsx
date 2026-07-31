import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useLiveLocation } from "@/hooks/use-live-location";
import { Button } from "@/components/ui/button";
import { DriverOperationsPanel } from "@/components/operations/DriverOperationsPanel";
import { DriverOnboarding, OnlineToggle } from "@/components/driver/DriverOnline";
import { ActiveRideCard } from "@/components/driver/DriverActiveRide";
import { UpcomingScheduledTrips } from "@/components/driver/UpcomingScheduledTrips";
import {
  isFarFutureScheduled,
  type DriverProfile,
  type Ride,
} from "@/components/driver/driver-utils";

export const Route = createFileRoute("/app/driver/")({
  head: () => ({
    meta: [
      { title: "Drive — Access Driver" },
      {
        name: "description",
        content: "Today's operational hub: dispatch offers, active service and today's work.",
      },
      { property: "og:title", content: "Drive — Access Driver" },
      {
        property: "og:description",
        content: "Today's operational hub: dispatch offers, active service and today's work.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DrivePage,
});

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-6 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </h2>
  );
}

function DrivePage() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [activeRide, setActiveRide] = useState<Ride | null>(null);
  const [trackingOperationRunId, setTrackingOperationRunId] = useState<string | null>(null);
  const [trackingOperationRideId, setTrackingOperationRideId] = useState<string | null>(null);

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
  // on the Upcoming page, not as the active ride.
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
            setActiveRide(pickActive(r));
          },
        )
        .subscribe();
      unsub = () => supabase.removeChannel(ch);
    })();
    return () => unsub?.();
  }, [user]);

  const trackingRideId =
    trackingOperationRideId ??
    (activeRide &&
    ["accepted", "driver_arriving", "arrived", "in_progress"].includes(activeRide.status)
      ? activeRide.id
      : null);
  const live = useLiveLocation({
    enabled: !!profile?.is_available,
    userId: user?.id,
    role: "driver",
    rideId: trackingRideId,
    operationRunId: trackingOperationRunId,
    updateDriverProfile: true,
  });

  if (loadingProfile) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  if (!profile) {
    return <DriverOnboarding userId={user!.id} onCreated={setProfile} />;
  }

  return (
    <>
      <OnlineToggle profile={profile} onChange={setProfile} />
      {profile.is_available && (live.status === "denied" || live.status === "unavailable") && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="h-4 w-4" />
          Location unavailable — passengers can't see you. Enable location and try again.
        </div>
      )}

      <SectionTitle>Needs your attention</SectionTitle>
      <DriverOperationsPanel
        driverId={user!.id}
        online={profile.is_available}
        onTrackingRunChange={(runId, rideId) => {
          setTrackingOperationRunId(runId);
          setTrackingOperationRideId(rideId);
        }}
      />

      <SectionTitle>Active service</SectionTitle>
      {activeRide ? (
        <ActiveRideCard ride={activeRide} onUpdate={setActiveRide} />
      ) : (
        <div className="mt-3 rounded-2xl border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
          {profile.is_available
            ? "No active service right now. You'll be notified as soon as work is dispatched to you."
            : "You're offline. Scheduled work remains visible, but immediate dispatch offers require online status."}
        </div>
      )}

      <SectionTitle>Today &amp; coming up</SectionTitle>
      <UpcomingScheduledTrips
        driverId={user!.id}
        onActivate={setActiveRide}
        limit={3}
        title="Next assignments"
        showViewAll
      />

      <div className="mt-6 flex flex-col gap-2">
        <Button asChild variant="outline">
          <Link to="/app/driver/upcoming">
            View all upcoming <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
        <Button asChild variant="ghost">
          <Link to="/app/driver/history">View trip history</Link>
        </Button>
      </div>
    </>
  );
}
