import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useUserRoles } from "@/hooks/use-auth";
import { AppShell, NAV_ICONS } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RouteMap } from "@/components/RouteMap";
import { RideStatusBadge } from "@/components/RideStatusBadge";
import { formatZAR } from "@/lib/pricing";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";
import { MapPin, Navigation } from "lucide-react";

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

  return (
    <AppShell title="Driver" nav={nav}>
      <OnlineToggle profile={profile} onChange={setProfile} />
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

function OpenRidesList({ rides, driverId }: { rides: Ride[]; driverId: string }) {
  async function accept(ride: Ride) {
    const { error } = await supabase
      .from("rides")
      .update({ driver_id: driverId, status: "accepted" })
      .eq("id", ride.id)
      .eq("status", "requested")
      .is("driver_id", null);
    if (error) toast.error(error.message);
    else toast.success("Ride accepted");
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
          <Button className="w-full" onClick={() => accept(r)}>
            Accept ride
          </Button>
        </div>
      ))}
    </section>
  );
}

function ActiveRideCard({ ride, onUpdate }: { ride: Ride; onUpdate: (r: Ride | null) => void }) {
  const nextStatus: Record<RideStatus, RideStatus | null> = {
    requested: "accepted",
    accepted: "driver_arriving",
    driver_arriving: "in_progress",
    in_progress: "completed",
    completed: null,
    cancelled: null,
  };
  const nextLabel: Record<RideStatus, string> = {
    requested: "Accept",
    accepted: "I'm arriving",
    driver_arriving: "Start trip",
    in_progress: "Complete trip",
    completed: "",
    cancelled: "",
  };

  async function advance() {
    const next = nextStatus[ride.status];
    if (!next) return;
    const { data, error } = await supabase
      .from("rides")
      .update({ status: next })
      .eq("id", ride.id)
      .select()
      .single();
    if (error) toast.error(error.message);
    else if (data) {
      if (next === "completed") {
        toast.success("Trip completed");
        onUpdate(null);
      } else onUpdate(data as Ride);
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

  return (
    <section className="mt-4 rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)]">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Active ride
        </h2>
        <RideStatusBadge status={ride.status} />
      </div>
      <RouteMap
        origin={{ lat: ride.pickup_lat, lng: ride.pickup_lng }}
        destination={{ lat: ride.destination_lat, lng: ride.destination_lng }}
        className="h-48"
      />
      <dl className="mt-3 space-y-2 text-sm">
        <p className="flex items-start gap-2">
          <MapPin className="mt-0.5 h-4 w-4 text-primary" />
          <span className="truncate">{ride.pickup_address}</span>
        </p>
        <p className="flex items-start gap-2">
          <Navigation className="mt-0.5 h-4 w-4 text-primary" />
          <span className="truncate">{ride.destination_address}</span>
        </p>
        <div className="flex items-center justify-between pt-2">
          <span className="text-muted-foreground">Fare</span>
          <span className="font-semibold">{formatZAR(Number(ride.estimated_price))}</span>
        </div>
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
