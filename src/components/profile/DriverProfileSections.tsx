import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CalendarRange, Car, Loader2, MapPinned, ShieldCheck, Star } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import type { Database } from "@/integrations/supabase/types";

type DriverProfile = Database["public"]["Tables"]["driver_profiles"]["Row"];
type Ride = Database["public"]["Tables"]["rides"]["Row"];

export function DriverProfileSections({ userId }: { userId: string }) {
  const [driver, setDriver] = useState<DriverProfile | null>(null);
  const [rides, setRides] = useState<Ride[]>([]);
  const [ratings, setRatings] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      const [driverResult, rideResult, ratingResult] = await Promise.all([
        supabase.from("driver_profiles").select("*").eq("user_id", userId).maybeSingle(),
        supabase.from("rides").select("*").eq("driver_id", userId),
        supabase.from("ride_reviews").select("rating").eq("driver_id", userId),
      ]);
      if (cancelled) return;
      if (driverResult.error) setError(driverResult.error.message);
      setDriver(driverResult.data);
      setRides((rideResult.data ?? []) as Ride[]);
      setRatings((ratingResult.data ?? []).map((row) => Number(row.rating)));
      setLoading(false);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const stats = useMemo(() => {
    const completed = rides.filter((ride) => ride.status === "completed");
    const cancelled = rides.filter((ride) => ride.status === "cancelled");
    const upcoming = rides.filter(
      (ride) =>
        ride.request_type === "scheduled" &&
        (ride.status === "requested" || ride.status === "accepted"),
    );
    return {
      completed: completed.length,
      cancelled: cancelled.length,
      upcoming: upcoming.length,
      totalKm: completed.reduce(
        (sum, ride) => sum + Number(ride.actual_distance_km || ride.distance_km || 0),
        0,
      ),
      averageRating: ratings.length
        ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length
        : null,
    };
  }, [rides, ratings]);

  if (loading) {
    return (
      <section className="mt-4 rounded-2xl border bg-card p-4 shadow-sm">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading driver operations…
        </p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="mt-4 rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
        {error}
      </section>
    );
  }

  return (
    <>
      <section className="mt-4 rounded-2xl border bg-card p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Car className="h-4 w-4 text-primary" />
              <h2 className="font-semibold">Current vehicle record</h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Temporary Phase 2 source: current driver profile. Phase 3 will replace this with daily
              fleet assignment.
            </p>
          </div>
          <Badge variant={driver?.is_available ? "default" : "secondary"}>
            {driver?.is_available ? "Online" : "Offline"}
          </Badge>
        </div>

        {!driver ? (
          <p className="mt-4 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
            No driver operational profile has been assigned yet. Contact Access administration.
          </p>
        ) : (
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            <ReadOnlyField label="Vehicle type" value={driver.vehicle_type || "Not assigned"} />
            <ReadOnlyField label="Vehicle model" value={driver.vehicle_model || "Not assigned"} />
            <ReadOnlyField label="Registration" value={driver.license_plate || "Not assigned"} />
            <ReadOnlyField
              label="Location status"
              value={
                driver.location_updated_at
                  ? `Updated ${new Date(driver.location_updated_at).toLocaleString("en-ZA")}`
                  : "No recent location"
              }
            />
          </dl>
        )}

        <p className="mt-4 flex items-start gap-2 rounded-xl bg-secondary p-3 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Vehicle and driver records are managed by Access administration. Drivers can report issues
          through Support but cannot edit vehicle master data or maintenance status.
        </p>
      </section>

      <section className="mt-4 rounded-2xl border bg-card p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <Star className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">Driver performance</h2>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat
            label="Average rating"
            value={
              stats.averageRating == null ? "No ratings" : `${stats.averageRating.toFixed(2)}★`
            }
          />
          <Stat label="Ratings" value={ratings.length} />
          <Stat label="Completed" value={stats.completed} />
          <Stat label="Cancelled" value={stats.cancelled} />
          <Stat
            label="Upcoming"
            value={stats.upcoming}
            icon={<CalendarRange className="h-3.5 w-3.5" />}
          />
          <Stat
            label="Total distance"
            value={`${stats.totalKm.toFixed(0)} km`}
            icon={<MapPinned className="h-3.5 w-3.5" />}
          />
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          This operational summary intentionally excludes fares, earnings, commissions, and payment
          values.
        </p>
      </section>
    </>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-secondary/40 p-3">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm font-medium">{value}</dd>
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: string | number; icon?: ReactNode }) {
  return (
    <div className="rounded-xl border p-3 text-center">
      <p className="flex items-center justify-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {icon} {label}
      </p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}
