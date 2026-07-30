import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Accessibility,
  CalendarRange,
  Car,
  FileCheck2,
  LifeBuoy,
  Loader2,
  MapPinned,
  ShieldCheck,
  Star,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Database } from "@/integrations/supabase/types";
import {
  VEHICLE_STATUS_LABEL,
  accessibilityLabels,
  documentState,
  fleetDb,
  isAssignmentEffective,
  type CanonicalVehicle,
  type VehicleAssignment,
  type VehicleDocument,
} from "@/lib/fleet";

type DriverProfile = Database["public"]["Tables"]["driver_profiles"]["Row"];
type Ride = Database["public"]["Tables"]["rides"]["Row"];

type CanonicalAssignmentState = {
  assignment: VehicleAssignment | null;
  vehicle: CanonicalVehicle | null;
  documents: VehicleDocument[];
};

const EMPTY_ASSIGNMENT: CanonicalAssignmentState = {
  assignment: null,
  vehicle: null,
  documents: [],
};

export function DriverProfileSections({ userId }: { userId: string }) {
  const [driver, setDriver] = useState<DriverProfile | null>(null);
  const [canonical, setCanonical] = useState<CanonicalAssignmentState>(EMPTY_ASSIGNMENT);
  const [rides, setRides] = useState<Ride[]>([]);
  const [ratings, setRatings] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      const [driverResult, assignmentResult, rideResult, ratingResult] = await Promise.all([
        supabase.from("driver_profiles").select("*").eq("user_id", userId).maybeSingle(),
        fleetDb
          .from("vehicle_driver_assignments")
          .select("*")
          .eq("driver_id", userId)
          .eq("status", "active")
          .lte("start_at", new Date().toISOString())
          .order("start_at", { ascending: false }),
        supabase.from("rides").select("*").eq("driver_id", userId),
        supabase.from("ride_reviews").select("rating").eq("driver_id", userId),
      ]);
      if (cancelled) return;
      const firstError =
        driverResult.error || assignmentResult.error || rideResult.error || ratingResult.error;
      if (firstError) setError(firstError.message);

      const assignment = ((assignmentResult.data ?? []) as VehicleAssignment[]).find((item) =>
        isAssignmentEffective(item),
      );
      let vehicle: CanonicalVehicle | null = null;
      let documents: VehicleDocument[] = [];
      if (assignment) {
        const [vehicleResult, documentResult] = await Promise.all([
          fleetDb
            .from("vehicle_profiles")
            .select("*")
            .eq("id", assignment.vehicle_id)
            .maybeSingle(),
          fleetDb.rpc("driver_current_vehicle_document_status"),
        ]);
        if (cancelled) return;
        if (vehicleResult.error) setError(vehicleResult.error.message);
        if (documentResult.error) setError(documentResult.error.message);
        vehicle = (vehicleResult.data ?? null) as CanonicalVehicle | null;
        documents = (documentResult.data ?? []) as VehicleDocument[];
      }

      setDriver(driverResult.data);
      setCanonical({ assignment: assignment ?? null, vehicle, documents });
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

  const vehicle = canonical.vehicle;
  const assignment = canonical.assignment;
  const accessibility = vehicle ? accessibilityLabels(vehicle) : [];
  const documentStates = vehicle
    ? [
        documentState(
          canonical.documents.find((document) => document.document_type === "roadworthy")
            ?.expires_at ?? vehicle.roadworthy_expiry_date,
        ),
        documentState(
          canonical.documents.find((document) => document.document_type === "license_disc")
            ?.expires_at ?? vehicle.license_disc_expiry_date,
        ),
        documentState(
          canonical.documents.find((document) => document.document_type === "insurance")
            ?.expires_at ?? vehicle.insurance_expiry_date,
        ),
      ]
    : [];
  const complianceSummary = !vehicle
    ? "Not assigned"
    : documentStates.includes("expired")
      ? "Document expired"
      : documentStates.includes("missing")
        ? "Document information incomplete"
        : documentStates.includes("expiring")
          ? "Document expiring soon"
          : "Documents current";

  return (
    <>
      <section className="mt-4 rounded-2xl border bg-card p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Car className="h-4 w-4 text-primary" />
              <h2 className="font-semibold">Current vehicle assignment</h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Canonical effective assignment managed by Access administration.
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-1.5">
            <Badge variant={driver?.is_available ? "default" : "secondary"}>
              {driver?.is_available ? "Online" : "Offline"}
            </Badge>
            {vehicle ? (
              <Badge variant={vehicle.status === "out_of_service" ? "destructive" : "outline"}>
                {VEHICLE_STATUS_LABEL[vehicle.status]}
              </Badge>
            ) : null}
          </div>
        </div>

        {!vehicle || !assignment ? (
          <p className="mt-4 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
            No vehicle is currently assigned. Contact Access administration.
          </p>
        ) : (
          <>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              <ReadOnlyField label="Vehicle name" value={vehicle.vehicle_name} />
              <ReadOnlyField label="Vehicle type" value={vehicle.vehicle_type || "Not recorded"} />
              <ReadOnlyField
                label="Make and model"
                value={[vehicle.make, vehicle.model].filter(Boolean).join(" ") || "Not recorded"}
              />
              <ReadOnlyField label="Registration" value={vehicle.license_plate} />
              <ReadOnlyField
                label="Passenger capacity"
                value={
                  vehicle.passenger_capacity == null
                    ? "Not recorded"
                    : String(vehicle.passenger_capacity)
                }
              />
              <ReadOnlyField
                label="Wheelchair capacity"
                value={
                  vehicle.wheelchair_capacity == null
                    ? "Not recorded"
                    : String(vehicle.wheelchair_capacity)
                }
              />
              <ReadOnlyField
                label="Assignment period"
                value={`${new Date(assignment.start_at).toLocaleString("en-ZA")} — ${
                  assignment.end_at
                    ? new Date(assignment.end_at).toLocaleString("en-ZA")
                    : "ongoing"
                }`}
              />
              <ReadOnlyField label="Compliance" value={complianceSummary} />
              <ReadOnlyField
                label="Current odometer"
                value={`${Number(vehicle.current_odometer_km).toLocaleString("en-ZA")} km`}
              />
              <ReadOnlyField
                label="Location status"
                value={
                  driver?.location_updated_at
                    ? `Updated ${new Date(driver.location_updated_at).toLocaleString("en-ZA")}`
                    : "No recent location"
                }
              />
            </dl>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {accessibility.map((label) => (
                <Badge key={label} variant="secondary">
                  <Accessibility className="mr-1 h-3 w-3" /> {label}
                </Badge>
              ))}
              <Badge variant="outline">
                <FileCheck2 className="mr-1 h-3 w-3" /> {complianceSummary}
              </Badge>
            </div>
          </>
        )}

        <p className="mt-4 flex items-start gap-2 rounded-xl bg-secondary p-3 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Vehicle identity, assignment, documents, odometer and maintenance status are controlled by
          Access administration. Drivers may report issues but cannot edit these records.
        </p>
        <Button asChild variant="outline" className="mt-3 w-full">
          <Link
            to="/app/support"
            search={{
              rideId: "",
              bookingId: "",
              category: "vehicle_issue",
              subject: vehicle
                ? `Vehicle issue · ${vehicle.license_plate}`
                : "Vehicle or driver operations issue",
            }}
          >
            <LifeBuoy className="mr-1 h-4 w-4" /> Report a vehicle or operational issue
          </Link>
        </Button>
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
          This operational summary intentionally excludes fares, earnings, commissions, maintenance
          costs and payment values.
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
