import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  CalendarRange,
  HeartHandshake,
  LifeBuoy,
  Loader2,
  MapPin,
  Phone,
  Shield,
  UserCircle2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useAuth, useUserRoles } from "@/hooks/use-auth";
import { AdminShell } from "@/components/AdminShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RideStatusBadge } from "@/components/RideStatusBadge";
import type { Database } from "@/integrations/supabase/types";
import {
  supportCategoryLabel,
  supportPriorityLabel,
  supportStatusLabel,
  type SupportTicket,
} from "@/lib/support";

const db = supabase as unknown as SupabaseClient;
type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Ride = Database["public"]["Tables"]["rides"]["Row"];
type Booking = Database["public"]["Tables"]["service_bookings"]["Row"];
type SavedAddress = {
  id: string;
  label: string;
  formatted_address: string;
  is_default: boolean;
};
type Preferences = {
  preferred_contact_method: string;
  wheelchair_user: boolean;
  mobility_device_notes: string | null;
  communication_support_notes: string | null;
  general_assistance_notes: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relationship: string | null;
};

export const Route = createFileRoute("/app/admin/passengers/$passengerId")({
  head: () => ({ meta: [{ title: "Passenger — Admin" }] }),
  component: PassengerDetailPage,
});

function PassengerDetailPage() {
  const { passengerId } = Route.useParams();
  const { user, loading: authLoading } = useAuth();
  const { roles, loading: rolesLoading } = useUserRoles(user?.id);
  const navigate = useNavigate();
  const isAdmin = !!roles?.includes("admin");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [rides, setRides] = useState<Ride[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || rolesLoading || roles === null) return;
    if (!user || !isAdmin) navigate({ to: "/app" });
  }, [authLoading, rolesLoading, roles, user, isAdmin, navigate]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      const [
        profileResult,
        rideResult,
        bookingResult,
        addressResult,
        preferenceResult,
        ticketResult,
      ] = await Promise.all([
        supabase.from("profiles").select("*").eq("user_id", passengerId).maybeSingle(),
        supabase
          .from("rides")
          .select("*")
          .eq("passenger_id", passengerId)
          .order("created_at", { ascending: false }),
        supabase
          .from("service_bookings")
          .select("*")
          .eq("booked_by_user_id", passengerId)
          .order("created_at", { ascending: false }),
        db
          .from("passenger_saved_addresses")
          .select("id,label,formatted_address,is_default")
          .eq("passenger_id", passengerId)
          .order("is_default", { ascending: false }),
        db.from("passenger_preferences").select("*").eq("passenger_id", passengerId).maybeSingle(),
        db
          .from("support_tickets")
          .select("*")
          .or(`passenger_id.eq.${passengerId},created_by.eq.${passengerId}`)
          .order("updated_at", { ascending: false }),
      ]);
      if (cancelled) return;
      const firstError =
        profileResult.error ||
        rideResult.error ||
        bookingResult.error ||
        addressResult.error ||
        preferenceResult.error ||
        ticketResult.error;
      if (firstError) setError(firstError.message);
      setProfile(profileResult.data);
      setRides((rideResult.data ?? []) as Ride[]);
      setBookings((bookingResult.data ?? []) as Booking[]);
      setAddresses((addressResult.data ?? []) as SavedAddress[]);
      setPreferences((preferenceResult.data ?? null) as Preferences | null);
      setTickets((ticketResult.data ?? []) as SupportTicket[]);
      setLoading(false);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, passengerId]);

  if (authLoading || rolesLoading || loading || (user && roles === null)) {
    return (
      <AdminShell title="Passenger">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading passenger…
        </p>
      </AdminShell>
    );
  }
  if (!isAdmin) return null;
  if (error || !profile) {
    return (
      <AdminShell title="Passenger">
        <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error ?? "Passenger profile not found"}
        </div>
      </AdminShell>
    );
  }

  const activeStatuses = new Set([
    "requested",
    "accepted",
    "driver_arriving",
    "arrived",
    "in_progress",
  ]);
  const activeRides = rides.filter((ride) => activeStatuses.has(ride.status));
  const upcoming = rides.filter(
    (ride) =>
      ride.request_type === "scheduled" &&
      (ride.status === "requested" || ride.status === "accepted"),
  );
  const historical = rides.filter(
    (ride) => ride.status === "completed" || ride.status === "cancelled",
  );
  const openTickets = tickets.filter((ticket) => !["resolved", "closed"].includes(ticket.status));

  return (
    <AdminShell
      title={profile.full_name ?? "Passenger"}
      subtitle="Passenger profile, trips, service bookings and support history."
      actions={
        profile.phone ? (
          <Button asChild size="sm" variant="outline">
            <a href={`tel:${profile.phone}`}>
              <Phone className="mr-1 h-4 w-4" /> Call passenger
            </a>
          </Button>
        ) : null
      }
    >
      <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
        <Link to="/app/admin/passengers" search={{ q: "", filter: "all" }}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Passengers
        </Link>
      </Button>

      <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="space-y-5">
          <section className="rounded-2xl border bg-card p-4 shadow-sm">
            <div className="flex items-start gap-3">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary">
                <UserCircle2 className="h-6 w-6" />
              </span>
              <div className="min-w-0">
                <h2 className="truncate font-semibold">
                  {profile.full_name ?? "Unnamed passenger"}
                </h2>
                <p className="text-sm text-muted-foreground">{profile.phone ?? "No phone"}</p>
                <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
                  {profile.user_id}
                </p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-center">
              <MiniStat label="Active" value={activeRides.length} />
              <MiniStat label="Upcoming" value={upcoming.length} />
              <MiniStat
                label="Completed"
                value={rides.filter((ride) => ride.status === "completed").length}
              />
              <MiniStat label="Open support" value={openTickets.length} />
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Registered {new Date(profile.created_at).toLocaleString("en-ZA")}
            </p>
          </section>

          <section className="rounded-2xl border bg-card p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-primary" />
              <h2 className="font-semibold">Saved addresses</h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Privacy-sensitive information. Use only for authorised operational support.
            </p>
            <ul className="mt-3 space-y-2">
              {addresses.map((address) => (
                <li key={address.id} className="rounded-xl border p-3 text-sm">
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{address.label}</p>
                    {address.is_default ? <Badge>Default</Badge> : null}
                  </div>
                  <p className="mt-1 text-muted-foreground">{address.formatted_address}</p>
                </li>
              ))}
              {!addresses.length ? (
                <li className="rounded-xl border border-dashed p-3 text-sm text-muted-foreground">
                  No saved addresses.
                </li>
              ) : null}
            </ul>
          </section>

          <section className="rounded-2xl border bg-card p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <HeartHandshake className="h-4 w-4 text-primary" />
              <h2 className="font-semibold">Assistance preferences</h2>
            </div>
            {preferences ? (
              <dl className="mt-3 space-y-3 text-sm">
                <Detail
                  label="Preferred contact"
                  value={preferences.preferred_contact_method.replaceAll("_", " ")}
                />
                <Detail
                  label="Wheelchair user"
                  value={preferences.wheelchair_user ? "Yes" : "No"}
                />
                <Detail
                  label="Mobility notes"
                  value={preferences.mobility_device_notes || "None"}
                />
                <Detail
                  label="Communication support"
                  value={preferences.communication_support_notes || "None"}
                />
                <Detail
                  label="General assistance"
                  value={preferences.general_assistance_notes || "None"}
                />
              </dl>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">No passenger preferences saved.</p>
            )}
          </section>

          <section className="rounded-2xl border bg-card p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" />
              <h2 className="font-semibold">Emergency contact</h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Restricted operational information. Do not expose in passenger lists or driver
              profiles.
            </p>
            <dl className="mt-3 space-y-2 text-sm">
              <Detail label="Name" value={preferences?.emergency_contact_name || "Not provided"} />
              <Detail
                label="Phone"
                value={preferences?.emergency_contact_phone || "Not provided"}
              />
              <Detail
                label="Relationship"
                value={preferences?.emergency_contact_relationship || "Not provided"}
              />
            </dl>
          </section>
        </aside>

        <div className="space-y-5">
          <section className="rounded-2xl border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CalendarRange className="h-4 w-4 text-primary" />
                <h2 className="font-semibold">Active and upcoming trips</h2>
              </div>
              <Badge variant="outline">{activeRides.length + upcoming.length}</Badge>
            </div>
            <TripList
              rides={Array.from(
                new Map([...activeRides, ...upcoming].map((ride) => [ride.id, ride])).values(),
              )}
            />
          </section>

          <section className="rounded-2xl border bg-card p-4 shadow-sm">
            <h2 className="font-semibold">Trip history</h2>
            <TripList rides={historical.slice(0, 20)} />
          </section>

          <section className="rounded-2xl border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">Service bookings</h2>
                <p className="text-xs text-muted-foreground">
                  Transport, Assisted, Appointment and Extended Journey requests.
                </p>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link to="/app/admin/bookings">Open bookings</Link>
              </Button>
            </div>
            <ul className="mt-4 space-y-2">
              {bookings.slice(0, 20).map((booking) => (
                <li key={booking.id} className="rounded-xl border p-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{booking.booking_reference}</p>
                      <p className="text-xs text-muted-foreground">
                        {booking.service_type.replaceAll("_", " ")}
                      </p>
                    </div>
                    <Badge variant="secondary">{booking.status.replaceAll("_", " ")}</Badge>
                  </div>
                </li>
              ))}
              {!bookings.length ? (
                <li className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
                  No service bookings.
                </li>
              ) : null}
            </ul>
          </section>

          <section className="rounded-2xl border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <LifeBuoy className="h-4 w-4 text-primary" />
                <div>
                  <h2 className="font-semibold">Support history</h2>
                  <p className="text-xs text-muted-foreground">
                    Open and resolved passenger support cases.
                  </p>
                </div>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link
                  to="/app/admin/support"
                  search={{
                    q: profile.full_name ?? profile.user_id,
                    status: "all",
                    priority: "all",
                    category: "all",
                  }}
                >
                  Open Support
                </Link>
              </Button>
            </div>
            <ul className="mt-4 space-y-2">
              {tickets.map((ticket) => (
                <li key={ticket.id}>
                  <Link
                    to="/app/admin/support/$ticketId"
                    params={{ ticketId: ticket.id }}
                    className="block rounded-xl border p-3 text-sm transition hover:border-primary/40"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">
                          {ticket.ticket_reference} · {ticket.subject}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {supportCategoryLabel(ticket.category)}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <Badge variant={ticket.priority === "urgent" ? "destructive" : "outline"}>
                          {supportPriorityLabel(ticket.priority)}
                        </Badge>
                        <Badge variant="secondary">{supportStatusLabel(ticket.status)}</Badge>
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
              {!tickets.length ? (
                <li className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
                  No support tickets.
                </li>
              ) : null}
            </ul>
          </section>
        </div>
      </div>
    </AdminShell>
  );
}

function TripList({ rides }: { rides: Ride[] }) {
  if (!rides.length) {
    return (
      <p className="mt-4 rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
        No trips in this section.
      </p>
    );
  }
  return (
    <ul className="mt-4 space-y-2">
      {rides.map((ride) => (
        <li key={ride.id}>
          <Link
            to="/app/trip/$rideId"
            params={{ rideId: ride.id }}
            className="block rounded-xl border p-3 text-sm transition hover:border-primary/40"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{ride.destination_address}</p>
                <p className="truncate text-xs text-muted-foreground">From {ride.pickup_address}</p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {new Date(ride.scheduled_at ?? ride.created_at).toLocaleString("en-ZA")}
                </p>
              </div>
              <RideStatusBadge status={ride.status} />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border p-3">
      <p className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap">{value}</dd>
    </div>
  );
}
