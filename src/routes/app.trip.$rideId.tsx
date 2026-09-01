import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { LifeBuoy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { AppShell, NAV_ICONS } from "@/components/AppShell";
import { RouteMap } from "@/components/RouteMap";
import { RideStatusBadge } from "@/components/RideStatusBadge";
import { PassengerPaymentCard } from "@/components/payments/PassengerPaymentCard";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatZAR } from "@/lib/pricing";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";

type Ride = Database["public"]["Tables"]["rides"]["Row"];
type StatusEvent = Database["public"]["Tables"]["ride_status_events"]["Row"];
type Review = Database["public"]["Tables"]["ride_reviews"]["Row"];

export const Route = createFileRoute("/app/trip/$rideId")({
  head: () => ({ meta: [{ title: "Trip details — Access" }] }),
  component: TripDetailsPage,
});

function TripDetailsPage() {
  const { rideId } = Route.useParams();
  const { user } = useAuth();
  const [ride, setRide] = useState<Ride | null>(null);
  const [events, setEvents] = useState<StatusEvent[]>([]);
  const [driver, setDriver] = useState<{ full_name: string | null; phone: string | null } | null>(
    null,
  );
  const [vehicle, setVehicle] = useState<{
    vehicle_model: string | null;
    vehicle_type: string | null;
    license_plate: string | null;
  } | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    setError(null);
    const { data: r, error: rErr } = await supabase
      .from("rides")
      .select("*")
      .eq("id", rideId)
      .maybeSingle();
    if (rErr || !r) {
      setError(rErr?.message ?? "Trip not found");
      setLoading(false);
      return;
    }
    setRide(r as Ride);

    const [evRes, revRes, drvRes, vehRes] = await Promise.all([
      supabase
        .from("ride_status_events")
        .select("*")
        .eq("ride_id", rideId)
        .order("created_at", { ascending: true }),
      supabase.from("ride_reviews").select("*").eq("ride_id", rideId).maybeSingle(),
      r.driver_id
        ? supabase
            .from("profiles")
            .select("full_name, phone")
            .eq("user_id", r.driver_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      r.driver_id
        ? supabase
            .from("driver_profiles")
            .select("vehicle_model, vehicle_type, license_plate")
            .eq("user_id", r.driver_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    setEvents((evRes.data ?? []) as StatusEvent[]);
    setReview((revRes.data as Review | null) ?? null);
    setDriver((drvRes.data as typeof driver) ?? null);
    setVehicle((vehRes.data as typeof vehicle) ?? null);
    setLoading(false);
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rideId]);

  const isPassenger = !!user && !!ride && ride.passenger_id === user.id;

  const nav = [
    { to: "/app/passenger", label: "Ride", icon: NAV_ICONS.Passenger },
    { to: "/app/profile", label: "Profile", icon: NAV_ICONS.Profile },
  ];

  return (
    <AppShell title="Trip details" nav={nav}>
      <div className="mb-3">
        <Link to="/app/passenger" className="text-sm text-muted-foreground hover:underline">
          ← Back to rides
        </Link>
      </div>

      {loading ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading trip…</p>
      ) : error || !ride ? (
        <div className="rounded-2xl border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">{error ?? "Trip not found"}</p>
          <Button variant="outline" className="mt-3" onClick={reload}>
            Retry
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <RouteMap
            origin={{ lat: Number(ride.pickup_lat), lng: Number(ride.pickup_lng) }}
            destination={{ lat: Number(ride.destination_lat), lng: Number(ride.destination_lng) }}
            className="h-64 rounded-2xl"
          />

          <section className="rounded-2xl border bg-card p-4">
            <div className="flex items-center justify-between">
              <RideStatusBadge status={ride.status} />
              <span className="rounded-full border px-2 py-0.5 text-xs uppercase tracking-wide text-muted-foreground">
                {ride.request_type === "scheduled" ? "Scheduled" : "Immediate"}
              </span>
            </div>
            <div className="mt-3 space-y-2 text-sm">
              <Detail label="Pickup" value={ride.pickup_address} />
              <Detail label="Destination" value={ride.destination_address} />
              {ride.scheduled_at ? (
                <Detail
                  label="Scheduled for"
                  value={new Date(ride.scheduled_at).toLocaleString()}
                />
              ) : null}
            </div>
          </section>

          <section className="rounded-2xl border bg-card p-4">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Driver
            </h3>
            {ride.driver_id ? (
              <div className="space-y-2 text-sm">
                <Detail label="Name" value={driver?.full_name ?? "—"} />
                <Detail label="Phone" value={driver?.phone ?? "—"} />
                <Detail
                  label="Vehicle"
                  value={
                    [vehicle?.vehicle_model, vehicle?.vehicle_type, vehicle?.license_plate]
                      .filter(Boolean)
                      .join(" · ") || "—"
                  }
                />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No driver was assigned.</p>
            )}
          </section>

          <section className="rounded-2xl border bg-card p-4">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Trip summary
            </h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Detail
                label="Distance"
                value={
                  ride.actual_distance_km != null
                    ? `${Number(ride.actual_distance_km).toFixed(2)} km`
                    : `${Number(ride.distance_km).toFixed(2)} km (route estimate)`
                }
              />
              <Detail label="Duration" value={formatDuration(ride)} />
              <Detail label="Fare" value={formatZAR(Number(ride.estimated_price))} />
              <Detail
                label="Route version"
                value={`v${ride.route_version}${ride.last_route_updated_at ? " (edited)" : ""}`}
              />
            </div>
          </section>

          {isPassenger ? <PassengerPaymentCard ride={ride} /> : null}

          <section className="rounded-2xl border bg-card p-4">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Timeline
            </h3>
            <Timeline ride={ride} events={events} />
          </section>

          <section className="rounded-2xl border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Support
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Open a case already linked to this trip.
                </p>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link
                  to="/app/support"
                  search={{
                    rideId: ride.id,
                    bookingId: "",
                    category: "trip_issue",
                    subject: `Trip support · ${ride.id.slice(0, 8)}`,
                  }}
                >
                  <LifeBuoy className="mr-1 h-4 w-4" /> Get help
                </Link>
              </Button>
            </div>
          </section>

          <section className="rounded-2xl border bg-card p-4">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Rating
            </h3>
            {review ? (
              <ReviewView review={review} />
            ) : isPassenger && ride.status === "completed" && ride.driver_id ? (
              <ReviewForm
                rideId={ride.id}
                passengerId={ride.passenger_id}
                driverId={ride.driver_id}
                onSaved={reload}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                {ride.status === "completed"
                  ? "No rating submitted."
                  : "Rating becomes available after the trip completes."}
              </p>
            )}
          </section>
        </div>
      )}
    </AppShell>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="break-words">{value}</p>
    </div>
  );
}

function formatDuration(ride: Ride): string {
  const sec =
    ride.actual_duration_seconds ??
    (ride.started_at && ride.completed_at
      ? Math.round(
          (new Date(ride.completed_at).getTime() - new Date(ride.started_at).getTime()) / 1000,
        )
      : null);
  if (sec == null) return "—";
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function Timeline({ ride, events }: { ride: Ride; events: StatusEvent[] }) {
  const points: { label: string; at: string | null }[] = [
    { label: "Requested", at: ride.created_at },
    { label: "Accepted", at: ride.accepted_at },
    { label: "Driver arrived", at: ride.driver_arrived_at },
    { label: "Trip started", at: ride.started_at },
    { label: "Completed", at: ride.completed_at },
  ];
  const extra = events
    .filter((e) => !["accepted", "arrived", "in_progress", "completed"].includes(e.new_status))
    .map((e) => ({ label: `Status: ${e.new_status}`, at: e.created_at }));
  return (
    <ol className="space-y-2">
      {[...points, ...extra].map((p, i) => (
        <li key={i} className="flex items-start gap-3 text-sm">
          <span
            className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${
              p.at ? "bg-primary" : "bg-muted-foreground/30"
            }`}
          />
          <div>
            <p className="font-medium">{p.label}</p>
            <p className="text-xs text-muted-foreground">
              {p.at ? new Date(p.at).toLocaleString() : "—"}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function ReviewView({ review }: { review: Review }) {
  return (
    <div>
      <div className="flex items-center gap-1 text-amber-500">
        {[1, 2, 3, 4, 5].map((n) => (
          <span key={n} className={n <= review.rating ? "" : "text-muted-foreground/30"}>
            ★
          </span>
        ))}
        <span className="ml-2 text-sm text-foreground">{review.rating}/5</span>
      </div>
      {review.comment ? (
        <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{review.comment}</p>
      ) : null}
      <p className="mt-2 text-xs text-muted-foreground">
        Submitted {new Date(review.created_at).toLocaleString()}
      </p>
    </div>
  );
}

function ReviewForm({
  rideId,
  passengerId,
  driverId,
  onSaved,
}: {
  rideId: string;
  passengerId: string;
  driverId: string;
  onSaved: () => void;
}) {
  const [rating, setRating] = useState<number>(5);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (rating < 1 || rating > 5) return;
    setSaving(true);
    const { error } = await supabase.from("ride_reviews").insert({
      ride_id: rideId,
      passenger_id: passengerId,
      driver_id: driverId,
      rating,
      comment: comment.trim() ? comment.trim().slice(0, 500) : null,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Thanks for your rating");
    onSaved();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1 text-2xl">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setRating(n)}
            aria-label={`Rate ${n} star${n > 1 ? "s" : ""}`}
            className={
              "transition " + (n <= rating ? "text-amber-500" : "text-muted-foreground/30")
            }
          >
            ★
          </button>
        ))}
      </div>
      <Textarea
        value={comment}
        onChange={(e) => setComment(e.target.value.slice(0, 500))}
        placeholder="Share a comment (optional, up to 500 characters)"
        rows={3}
      />
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{comment.length}/500</span>
        <Button onClick={submit} disabled={saving}>
          {saving ? "Saving…" : "Submit rating"}
        </Button>
      </div>
    </div>
  );
}
