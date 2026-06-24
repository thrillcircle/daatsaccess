import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useUserRoles } from "@/hooks/use-auth";
import { AppShell, NAV_ICONS } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  BOOKING_STATUS_LABEL,
  SERVICE_TYPE_LABEL,
  bookingStatusVariant,
  ASSISTANCE_LABEL,
  type AssistanceCode,
  type BookingStatus,
  type ServiceType,
} from "@/lib/booking-types";
import { formatZAR } from "@/lib/pricing";
import { toast } from "sonner";
import { Plus, ChevronRight } from "lucide-react";

export const Route = createFileRoute("/app/passenger/bookings")({
  head: () => ({ meta: [{ title: "My bookings — Access" }] }),
  component: PassengerBookingsPage,
});

type Booking = {
  id: string;
  booking_reference: string;
  service_type: ServiceType;
  status: BookingStatus;
  start_at: string | null;
  end_at: string | null;
  requested_companion_count: number;
  estimated_total: number | null;
  quoted_total: number | null;
  deposit_amount: number | null;
  deposit_status: "none" | "pending" | "paid" | "refunded" | "waived";
  metadata: unknown;
  passenger_notes: string | null;
  created_at: string;
};

type Traveller = { id: string; booking_id: string; full_name: string; phone: string | null; is_primary: boolean; relationship_to_booker: string | null };
type Assistance = { id: string; booking_id: string; requirement_code: AssistanceCode; notes: string | null };
type Quote = { id: string; booking_id: string; status: string; total: number; currency: string; valid_until: string | null; notes: string | null };
type QuoteItem = { id: string; quote_id: string; label: string; description: string | null; quantity: number; unit_price: number; line_total: number; sort_order: number };
type Itinerary = { id: string; booking_id: string; day_number: number; sequence_number: number; item_type: string; title: string | null; address: string | null; planned_start_at: string | null; planned_end_at: string | null; status: string };
type DriverAssign = { id: string; booking_id: string; driver_user_id: string; status: string; assignment_role: string };
type VehicleAssign = { id: string; booking_id: string; fleet_vehicle_id: string; status: string };
type CompanionAssign = { id: string; booking_id: string; companion_id: string; status: string };
type FleetVehicle = { id: string; registration_number: string; make: string | null; model: string | null };
type Companion = { id: string; full_name: string; photo_url: string | null };
type Ride = { id: string; service_booking_id: string | null; status: string; driver_id: string | null };
type Profile = { user_id: string; full_name: string | null };

function PassengerBookingsPage() {
  const { user } = useAuth();
  const { roles } = useUserRoles(user?.id);

  const nav = useMemo(() => {
    const items = [
      { to: "/app/passenger", label: "Ride", icon: NAV_ICONS.Passenger },
      { to: "/app/passenger/bookings", label: "Bookings", icon: NAV_ICONS.Profile },
    ];
    if (roles?.includes("driver")) items.push({ to: "/app/driver", label: "Drive", icon: NAV_ICONS.Driver });
    if (roles?.includes("admin")) items.push({ to: "/app/admin", label: "Admin", icon: NAV_ICONS.Admin });
    items.push({ to: "/app/profile", label: "Profile", icon: NAV_ICONS.Profile });
    return items;
  }, [roles]);

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [travellers, setTravellers] = useState<Traveller[]>([]);
  const [assistance, setAssistance] = useState<Assistance[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [quoteItems, setQuoteItems] = useState<QuoteItem[]>([]);
  const [itinerary, setItinerary] = useState<Itinerary[]>([]);
  const [driverAssigns, setDriverAssigns] = useState<DriverAssign[]>([]);
  const [vehicleAssigns, setVehicleAssigns] = useState<VehicleAssign[]>([]);
  const [companionAssigns, setCompanionAssigns] = useState<CompanionAssign[]>([]);
  const [fleetVehicles, setFleetVehicles] = useState<FleetVehicle[]>([]);
  const [companions, setCompanions] = useState<Companion[]>([]);
  const [rides, setRides] = useState<Ride[]>([]);
  const [driverProfiles, setDriverProfiles] = useState<Profile[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const { data: b } = await supabase
        .from("service_bookings")
        .select("id,booking_reference,service_type,status,start_at,end_at,requested_companion_count,estimated_total,quoted_total,deposit_amount,deposit_status,metadata,passenger_notes,created_at")
        .eq("booked_by_user_id", user.id)
        .order("created_at", { ascending: false });
      if (cancelled) return;
      const list = (b ?? []) as Booking[];
      setBookings(list);
      const ids = list.map((x) => x.id);
      if (ids.length) {
        const [tr, ar, qr, dr, vr, cr, rr, ir] = await Promise.all([
          supabase.from("booking_travellers").select("*").in("booking_id", ids),
          supabase.from("booking_assistance_requirements").select("*").in("booking_id", ids),
          supabase.from("service_quotes").select("id,booking_id,status,total,currency,valid_until,notes").in("booking_id", ids),
          supabase.from("booking_driver_assignments").select("*").in("booking_id", ids),
          supabase.from("booking_vehicle_assignments").select("*").in("booking_id", ids),
          supabase.from("booking_companion_assignments").select("*").in("booking_id", ids),
          supabase.from("rides").select("id,service_booking_id,status,driver_id").in("service_booking_id", ids),
          supabase.from("booking_itinerary_items").select("*").in("booking_id", ids).order("day_number").order("sequence_number"),
        ]);
        if (cancelled) return;
        setTravellers((tr.data ?? []) as Traveller[]);
        setAssistance((ar.data ?? []) as Assistance[]);
        const qs = (qr.data ?? []) as Quote[];
        setQuotes(qs);
        setDriverAssigns((dr.data ?? []) as DriverAssign[]);
        setVehicleAssigns((vr.data ?? []) as VehicleAssign[]);
        setCompanionAssigns((cr.data ?? []) as CompanionAssign[]);
        setRides((rr.data ?? []) as Ride[]);
        setItinerary((ir.data ?? []) as Itinerary[]);
        if (qs.length) {
          const { data: qi } = await supabase.from("service_quote_items").select("*").in("quote_id", qs.map((q) => q.id)).order("sort_order");
          if (!cancelled) setQuoteItems((qi ?? []) as QuoteItem[]);
        } else {
          setQuoteItems([]);
        }
        const vIds = Array.from(new Set((vr.data ?? []).map((v) => v.fleet_vehicle_id)));
        const cIds = Array.from(new Set((cr.data ?? []).map((c) => c.companion_id)));
        const drIds = Array.from(new Set([
          ...((dr.data ?? []).map((d) => d.driver_user_id)),
          ...((rr.data ?? []).map((r) => r.driver_id).filter(Boolean) as string[]),
        ]));
        const [fv, comp, prof] = await Promise.all([
          vIds.length ? supabase.from("fleet_vehicles").select("id,registration_number,make,model").in("id", vIds) : Promise.resolve({ data: [] as FleetVehicle[] }),
          cIds.length ? supabase.from("companion_profiles").select("id,full_name,photo_url").in("id", cIds) : Promise.resolve({ data: [] as Companion[] }),
          drIds.length ? supabase.from("profiles").select("user_id,full_name").in("user_id", drIds) : Promise.resolve({ data: [] as Profile[] }),
        ]);
        if (cancelled) return;
        setFleetVehicles((fv.data ?? []) as FleetVehicle[]);
        setCompanions((comp.data ?? []) as Companion[]);
        setDriverProfiles((prof.data ?? []) as Profile[]);
      }
      setLoading(false);
    };
    void load();

    const ch = supabase
      .channel("passenger-service-bookings-" + user.id)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "service_bookings", filter: `booked_by_user_id=eq.${user.id}` },
        () => void load(),
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [user]);

  if (!user) return null;

  return (
    <AppShell title="My bookings" nav={nav}>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">My bookings</h1>
        <Button size="sm" onClick={() => navigate({ to: "/app/passenger/book" })}>
          <Plus className="mr-1 h-4 w-4" /> New
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : bookings.length === 0 ? (
        <div className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">
          You haven't booked any services yet.{" "}
          <Link to="/app/passenger/book" className="text-primary underline">Start a booking</Link>.
        </div>
      ) : (
        <div className="space-y-3">
          {bookings.map((b) => {
            const t = travellers.filter((x) => x.booking_id === b.id);
            const primary = t.find((x) => x.is_primary) ?? t[0];
            const a = assistance.filter((x) => x.booking_id === b.id);
            const q = quotes.find((x) => x.booking_id === b.id);
            const dAssign = driverAssigns.find((x) => x.booking_id === b.id);
            const vAssign = vehicleAssigns.find((x) => x.booking_id === b.id);
            const cAssigns = companionAssigns.filter((x) => x.booking_id === b.id);
            const ride = rides.find((r) => r.service_booking_id === b.id);
            const driverName = (id: string | null | undefined) =>
              id ? driverProfiles.find((p) => p.user_id === id)?.full_name ?? "Driver" : null;
            const driver = driverName(dAssign?.driver_user_id ?? ride?.driver_id ?? null);
            const veh = vAssign ? fleetVehicles.find((v) => v.id === vAssign.fleet_vehicle_id) : null;
            const comps = cAssigns
              .map((ca) => companions.find((c) => c.id === ca.companion_id))
              .filter(Boolean) as Companion[];

            const nextAction = ((): string => {
              if (b.status === "cancelled") return "—";
              if (b.status === "completed") return "Trip complete";
              if (b.status === "awaiting_quote") return "Waiting for our team to send a quote.";
              if (b.status === "quoted" && q) return `Review and accept the quote (${formatZAR(Number(q.total))}).`;
              if (b.status === "accepted") return "Awaiting driver and vehicle assignment.";
              if (b.status === "resources_assigned") return "Resources ready — trip will start at the scheduled time.";
              if (b.status === "active" || ride) return ride ? "Track your live trip." : "Trip is active.";
              if (b.service_type === "transport") return "Driver is being matched.";
              return "Submitted.";
            })();

            return (
              <article key={b.id} className="rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)]">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">{b.booking_reference}</p>
                    <h3 className="truncate font-semibold">{SERVICE_TYPE_LABEL[b.service_type]}</h3>
                  </div>
                  <Badge variant={bookingStatusVariant(b.status)}>{BOOKING_STATUS_LABEL[b.status]}</Badge>
                </div>

                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                  <div className="col-span-2"><dt className="text-muted-foreground">Booking for</dt><dd>{primary?.full_name ?? "—"}{primary?.relationship_to_booker && primary.relationship_to_booker !== "self" ? ` (${primary.relationship_to_booker})` : ""}</dd></div>
                  {b.start_at ? <div className="col-span-2"><dt className="text-muted-foreground">When</dt><dd>{new Date(b.start_at).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", dateStyle: "medium", timeStyle: "short" })}</dd></div> : null}
                  <div><dt className="text-muted-foreground">Driver</dt><dd>{driver ?? "—"}</dd></div>
                  <div><dt className="text-muted-foreground">Vehicle</dt><dd>{veh ? `${veh.make ?? ""} ${veh.model ?? ""} · ${veh.registration_number}` : "—"}</dd></div>
                  {b.service_type === "assisted" ? (
                    <div className="col-span-2">
                      <dt className="text-muted-foreground">Companions</dt>
                      <dd>
                        {comps.length
                          ? comps.map((c) => c.full_name).join(", ")
                          : `${b.requested_companion_count} requested · assigned after quote acceptance`}
                      </dd>
                    </div>
                  ) : null}
                  {a.length ? (
                    <div className="col-span-2"><dt className="text-muted-foreground">Assistance</dt><dd className="flex flex-wrap gap-1">{a.map((x) => <Badge key={x.id} variant="outline" className="text-[10px]">{ASSISTANCE_LABEL[x.requirement_code]}</Badge>)}</dd></div>
                  ) : null}
                  <div><dt className="text-muted-foreground">Quote</dt><dd>{q ? `${q.status} · ${formatZAR(Number(q.total))}` : "—"}</dd></div>
                  <div><dt className="text-muted-foreground">Estimated</dt><dd>{b.estimated_total != null ? formatZAR(Number(b.estimated_total)) : "—"}</dd></div>
                  {b.service_type === "extended_journey" ? (
                    <>
                      {b.end_at ? <div className="col-span-2"><dt className="text-muted-foreground">Ends</dt><dd>{new Date(b.end_at).toLocaleDateString("en-ZA", { dateStyle: "medium" })}</dd></div> : null}
                      <div><dt className="text-muted-foreground">Deposit</dt><dd>{b.deposit_amount != null ? `${formatZAR(Number(b.deposit_amount))} · ${b.deposit_status}` : b.deposit_status}</dd></div>
                      <div><dt className="text-muted-foreground">Companions</dt><dd>{comps.length ? comps.map((c) => c.full_name).join(", ") : `${b.requested_companion_count} requested`}</dd></div>
                    </>
                  ) : null}
                  {ride ? <div className="col-span-2"><dt className="text-muted-foreground">Ride status</dt><dd>{ride.status.replace("_", " ")}</dd></div> : null}
                </dl>

                {b.service_type === "extended_journey" && q ? (
                  <details className="mt-2 rounded-lg border bg-background/40 p-2 text-xs">
                    <summary className="cursor-pointer font-medium">Quote breakdown ({quoteItems.filter((qi) => qi.quote_id === q.id).length} line items)</summary>
                    <ul className="mt-2 space-y-1">
                      {quoteItems.filter((qi) => qi.quote_id === q.id).map((qi) => (
                        <li key={qi.id} className="flex justify-between gap-2">
                          <span className="truncate">{qi.label} × {Number(qi.quantity)}</span>
                          <span className="font-mono">{formatZAR(Number(qi.line_total))}</span>
                        </li>
                      ))}
                    </ul>
                    {q.valid_until ? <p className="mt-2 text-[11px] text-muted-foreground">Valid until {new Date(q.valid_until).toLocaleDateString("en-ZA")}</p> : null}
                    {q.notes ? <p className="mt-1 text-[11px] text-muted-foreground">{q.notes}</p> : null}
                  </details>
                ) : null}

                {b.service_type === "extended_journey" && itinerary.some((i) => i.booking_id === b.id) ? (
                  <details className="mt-2 rounded-lg border bg-background/40 p-2 text-xs">
                    <summary className="cursor-pointer font-medium">Itinerary</summary>
                    <ol className="mt-2 space-y-1">
                      {itinerary.filter((i) => i.booking_id === b.id).map((i) => (
                        <li key={i.id}>
                          <span className="font-medium">Day {i.day_number} · {i.item_type}:</span> {i.title ?? "—"}
                          {i.address ? ` · ${i.address}` : ""}
                          {" · "}<span className="text-muted-foreground">{i.status}</span>
                        </li>
                      ))}
                    </ol>
                  </details>
                ) : null}

                <div className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-secondary/60 px-3 py-2 text-xs">
                  <span className="min-w-0 truncate"><span className="font-medium">Next:</span> {nextAction}</span>
                  {ride ? (
                    <Link to="/app/trip/$rideId" params={{ rideId: ride.id }} className="inline-flex items-center text-primary">
                      Track <ChevronRight className="h-3 w-3" />
                    </Link>
                  ) : null}
                </div>
                {b.status === "quoted" && q ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      onClick={async () => {
                        const { error: qErr } = await supabase.from("service_quotes").update({ status: "accepted" }).eq("id", q.id);
                        if (qErr) { toast.error(qErr.message); return; }
                        const { error: bErr } = await supabase.from("service_bookings").update({ status: "accepted", quoted_total: q.total }).eq("id", b.id);
                        if (bErr) { toast.error(bErr.message); return; }
                        await supabase.from("service_booking_events").insert({ booking_id: b.id, actor_user_id: user!.id, event_type: "quote_accepted", payload: { quote_id: q.id } as never });
                        toast.success("Quote accepted");
                      }}
                    >
                      Accept quote
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        const { error: qErr } = await supabase.from("service_quotes").update({ status: "rejected" }).eq("id", q.id);
                        if (qErr) { toast.error(qErr.message); return; }
                        await supabase.from("service_booking_events").insert({ booking_id: b.id, actor_user_id: user!.id, event_type: "quote_declined", payload: { quote_id: q.id } as never });
                        toast.success("Quote declined");
                      }}
                    >
                      Decline
                    </Button>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
