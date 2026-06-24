import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useUserRoles } from "@/hooks/use-auth";
import { AdminShell } from "@/components/AdminShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Filter, ExternalLink, MapPin, ClipboardList } from "lucide-react";

export const Route = createFileRoute("/app/admin/bookings")({
  head: () => ({ meta: [{ title: "Service Bookings — Admin" }] }),
  component: AdminBookingsPage,
});

type Booking = {
  id: string;
  booking_reference: string;
  booked_by_user_id: string;
  service_type: ServiceType;
  status: BookingStatus;
  start_at: string | null;
  requested_companion_count: number;
  estimated_total: number | null;
  quoted_total: number | null;
  passenger_notes: string | null;
  admin_notes: string | null;
  created_at: string;
};

type Traveller = { id: string; booking_id: string; full_name: string; phone: string | null; is_primary: boolean; relationship_to_booker: string | null };
type Assistance = { id: string; booking_id: string; requirement_code: AssistanceCode; notes: string | null; quantity: number };
type Itinerary = {
  id: string;
  booking_id: string;
  item_type: string;
  title: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  planned_start_at: string | null;
  planned_end_at: string | null;
  actual_start_at: string | null;
  actual_end_at: string | null;
  status: string;
  day_number: number;
  sequence_number: number;
};
type Quote = { id: string; booking_id: string; status: string; total: number; currency: string; notes: string | null };
type DriverAssign = { id: string; booking_id: string; driver_user_id: string; status: string };
type VehicleAssign = { id: string; booking_id: string; fleet_vehicle_id: string; status: string };
type CompanionAssign = { id: string; booking_id: string; companion_id: string; status: string };
type FleetVehicle = { id: string; registration_number: string; make: string | null; model: string | null; passenger_capacity: number; wheelchair_capacity: number; operational_status: string; is_active: boolean };
type Companion = { id: string; full_name: string; photo_url: string | null; admin_approved: boolean; is_available: boolean };
type Ride = { id: string; service_booking_id: string | null; itinerary_item_id: string | null; status: string; driver_id: string | null };
type Profile = { user_id: string; full_name: string | null; phone: string | null };

const ALL_STATUSES: (BookingStatus | "all")[] = [
  "all",
  "draft",
  "submitted",
  "awaiting_quote",
  "quoted",
  "accepted",
  "resources_assigned",
  "active",
  "completed",
  "cancelled",
];

const ALL_SERVICE_TYPES: (ServiceType | "all")[] = ["all", "transport", "assisted", "appointment", "extended_journey"];

function AdminBookingsPage() {
  const { user, loading: authLoading } = useAuth();
  const { roles, loading: rolesLoading } = useUserRoles(user?.id);
  const isAdmin = !!roles?.includes("admin");
  const navigate = useNavigate();

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [travellers, setTravellers] = useState<Traveller[]>([]);
  const [assistance, setAssistance] = useState<Assistance[]>([]);
  const [itinerary, setItinerary] = useState<Itinerary[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [driverAssigns, setDriverAssigns] = useState<DriverAssign[]>([]);
  const [vehicleAssigns, setVehicleAssigns] = useState<VehicleAssign[]>([]);
  const [companionAssigns, setCompanionAssigns] = useState<CompanionAssign[]>([]);
  const [fleetVehicles, setFleetVehicles] = useState<FleetVehicle[]>([]);
  const [companions, setCompanions] = useState<Companion[]>([]);
  const [drivers, setDrivers] = useState<Profile[]>([]);
  const [bookers, setBookers] = useState<Profile[]>([]);
  const [rides, setRides] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadTick, setReloadTick] = useState(0);

  const [fType, setFType] = useState<ServiceType | "all">("all");
  const [fStatus, setFStatus] = useState<BookingStatus | "all">("all");
  const [fRef, setFRef] = useState("");
  const [fBooker, setFBooker] = useState("");
  const [fTraveller, setFTraveller] = useState("");
  const [fDate, setFDate] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const reload = useCallback(() => setReloadTick((n) => n + 1), []);

  useEffect(() => {
    if (authLoading || rolesLoading || roles === null) return;
    if (!user || !isAdmin) navigate({ to: "/app" });
  }, [authLoading, rolesLoading, roles, user, isAdmin, navigate]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: b } = await supabase
        .from("service_bookings")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (cancelled) return;
      const list = (b ?? []) as Booking[];
      setBookings(list);
      const ids = list.map((x) => x.id);
      if (ids.length) {
        const [tr, ar, ir, qr, dr, vr, cr, rr, dp, fv, cp] = await Promise.all([
          supabase.from("booking_travellers").select("*").in("booking_id", ids),
          supabase.from("booking_assistance_requirements").select("*").in("booking_id", ids),
          supabase.from("booking_itinerary_items").select("*").in("booking_id", ids),
          supabase.from("service_quotes").select("id,booking_id,status,total,currency,notes").in("booking_id", ids),
          supabase.from("booking_driver_assignments").select("*").in("booking_id", ids),
          supabase.from("booking_vehicle_assignments").select("*").in("booking_id", ids),
          supabase.from("booking_companion_assignments").select("*").in("booking_id", ids),
          supabase.from("rides").select("id,service_booking_id,status,driver_id").in("service_booking_id", ids),
          supabase.from("user_roles").select("user_id").eq("role", "driver"),
          supabase.from("fleet_vehicles").select("*").eq("is_active", true).order("registration_number"),
          supabase.from("companion_profiles").select("*").order("full_name"),
        ]);
        if (cancelled) return;
        setTravellers((tr.data ?? []) as Traveller[]);
        setAssistance((ar.data ?? []) as Assistance[]);
        setItinerary((ir.data ?? []) as Itinerary[]);
        setQuotes((qr.data ?? []) as Quote[]);
        setDriverAssigns((dr.data ?? []) as DriverAssign[]);
        setVehicleAssigns((vr.data ?? []) as VehicleAssign[]);
        setCompanionAssigns((cr.data ?? []) as CompanionAssign[]);
        setRides((rr.data ?? []) as Ride[]);
        setFleetVehicles((fv.data ?? []) as FleetVehicle[]);
        setCompanions((cp.data ?? []) as Companion[]);
        const driverIds = Array.from(new Set((dp.data ?? []).map((r) => r.user_id)));
        const bookerIds = Array.from(new Set(list.map((x) => x.booked_by_user_id)));
        const driverDriversAssigned = Array.from(new Set((dr.data ?? []).map((x) => x.driver_user_id)));
        const allProfileIds = Array.from(new Set([...driverIds, ...bookerIds, ...driverDriversAssigned]));
        if (allProfileIds.length) {
          const { data: profs } = await supabase.from("profiles").select("user_id,full_name,phone").in("user_id", allProfileIds);
          if (cancelled) return;
          const all = (profs ?? []) as Profile[];
          setDrivers(all.filter((p) => driverIds.includes(p.user_id)));
          setBookers(all.filter((p) => bookerIds.includes(p.user_id)));
        }
      } else {
        const [fv, cp, dp] = await Promise.all([
          supabase.from("fleet_vehicles").select("*").eq("is_active", true).order("registration_number"),
          supabase.from("companion_profiles").select("*").order("full_name"),
          supabase.from("user_roles").select("user_id").eq("role", "driver"),
        ]);
        if (cancelled) return;
        setFleetVehicles((fv.data ?? []) as FleetVehicle[]);
        setCompanions((cp.data ?? []) as Companion[]);
        const driverIds = Array.from(new Set((dp.data ?? []).map((r) => r.user_id)));
        if (driverIds.length) {
          const { data: profs } = await supabase.from("profiles").select("user_id,full_name,phone").in("user_id", driverIds);
          if (!cancelled) setDrivers((profs ?? []) as Profile[]);
        }
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [isAdmin, reloadTick]);

  useEffect(() => {
    if (!isAdmin) return;
    const ch = supabase
      .channel("admin-service-bookings")
      .on("postgres_changes", { event: "*", schema: "public", table: "service_bookings" }, () => reload())
      .on("postgres_changes", { event: "*", schema: "public", table: "booking_driver_assignments" }, () => reload())
      .on("postgres_changes", { event: "*", schema: "public", table: "booking_vehicle_assignments" }, () => reload())
      .on("postgres_changes", { event: "*", schema: "public", table: "booking_companion_assignments" }, () => reload())
      .on("postgres_changes", { event: "*", schema: "public", table: "service_quotes" }, () => reload())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [isAdmin, reload]);

  const bookerName = (id: string) => bookers.find((p) => p.user_id === id)?.full_name ?? id.slice(0, 8);
  const primaryTraveller = (bid: string) => travellers.find((t) => t.booking_id === bid && t.is_primary) ?? travellers.find((t) => t.booking_id === bid);

  const filtered = useMemo(() => {
    return bookings.filter((b) => {
      if (fType !== "all" && b.service_type !== fType) return false;
      if (fStatus !== "all" && b.status !== fStatus) return false;
      if (fRef && !b.booking_reference.toLowerCase().includes(fRef.toLowerCase())) return false;
      if (fBooker) {
        const name = bookerName(b.booked_by_user_id).toLowerCase();
        if (!name.includes(fBooker.toLowerCase())) return false;
      }
      if (fTraveller) {
        const tlist = travellers.filter((t) => t.booking_id === b.id);
        const match = tlist.some((t) => t.full_name.toLowerCase().includes(fTraveller.toLowerCase()));
        if (!match) return false;
      }
      if (fDate) {
        const d = b.start_at ? b.start_at.slice(0, 10) : b.created_at.slice(0, 10);
        if (d !== fDate) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookings, fType, fStatus, fRef, fBooker, fTraveller, fDate, travellers, bookers]);

  if (authLoading || rolesLoading || (user && roles === null)) {
    return <AdminShell title="Service Bookings"><p className="p-6 text-sm text-muted-foreground">Loading…</p></AdminShell>;
  }
  if (!isAdmin) return null;

  const selectedBooking = selected ? bookings.find((b) => b.id === selected) ?? null : null;

  return (
    <AdminShell title="Service Bookings" subtitle="Quote, assign and activate Access Transport and Access Assisted bookings.">
      <section className="mb-4 rounded-xl border bg-card p-3">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
          <Filter className="h-3.5 w-3.5" /> Filters
        </div>
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Select value={fType} onValueChange={(v) => setFType(v as ServiceType | "all")}>
            <SelectTrigger><SelectValue placeholder="Service" /></SelectTrigger>
            <SelectContent>
              {ALL_SERVICE_TYPES.map((t) => (
                <SelectItem key={t} value={t}>{t === "all" ? "All services" : SERVICE_TYPE_LABEL[t]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={fStatus} onValueChange={(v) => setFStatus(v as BookingStatus | "all")}>
            <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              {ALL_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{s === "all" ? "All statuses" : BOOKING_STATUS_LABEL[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input type="date" value={fDate} onChange={(e) => setFDate(e.target.value)} />
          <Input placeholder="Booking ref" value={fRef} onChange={(e) => setFRef(e.target.value)} />
          <Input placeholder="Booker name" value={fBooker} onChange={(e) => setFBooker(e.target.value)} />
          <Input placeholder="Traveller name" value={fTraveller} onChange={(e) => setFTraveller(e.target.value)} />
        </div>
      </section>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading bookings…</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">No service bookings match these filters.</div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Reference</th>
                <th className="px-3 py-2 text-left">Service</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="hidden px-3 py-2 text-left sm:table-cell">Booker</th>
                <th className="hidden px-3 py-2 text-left sm:table-cell">Traveller</th>
                <th className="hidden px-3 py-2 text-left lg:table-cell">When</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b) => {
                const t = primaryTraveller(b.id);
                return (
                  <tr key={b.id} className="border-t">
                    <td className="px-3 py-2 font-mono text-xs">{b.booking_reference}</td>
                    <td className="px-3 py-2">{SERVICE_TYPE_LABEL[b.service_type]}</td>
                    <td className="px-3 py-2"><Badge variant={bookingStatusVariant(b.status)}>{BOOKING_STATUS_LABEL[b.status]}</Badge></td>
                    <td className="hidden px-3 py-2 sm:table-cell">{bookerName(b.booked_by_user_id)}</td>
                    <td className="hidden px-3 py-2 sm:table-cell">{t?.full_name ?? "—"}</td>
                    <td className="hidden px-3 py-2 text-xs lg:table-cell">{b.start_at ? new Date(b.start_at).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", dateStyle: "short", timeStyle: "short" }) : "—"}</td>
                    <td className="px-3 py-2 text-right">{formatZAR(Number(b.quoted_total ?? b.estimated_total ?? 0))}</td>
                    <td className="px-3 py-2 text-right">
                      <Button size="sm" variant="outline" onClick={() => setSelected(b.id)}>Open</Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <BookingDetailDialog
        booking={selectedBooking}
        onClose={() => setSelected(null)}
        actorId={user!.id}
        travellers={travellers}
        assistance={assistance}
        itinerary={itinerary}
        quotes={quotes}
        driverAssigns={driverAssigns}
        vehicleAssigns={vehicleAssigns}
        companionAssigns={companionAssigns}
        rides={rides}
        fleetVehicles={fleetVehicles}
        companions={companions}
        drivers={drivers}
        bookers={bookers}
        onChanged={reload}
      />
    </AdminShell>
  );
}

function BookingDetailDialog({
  booking, onClose, actorId, travellers, assistance, itinerary, quotes, driverAssigns, vehicleAssigns, companionAssigns, rides, fleetVehicles, companions, drivers, bookers, onChanged,
}: {
  booking: Booking | null;
  onClose: () => void;
  actorId: string;
  travellers: Traveller[];
  assistance: Assistance[];
  itinerary: Itinerary[];
  quotes: Quote[];
  driverAssigns: DriverAssign[];
  vehicleAssigns: VehicleAssign[];
  companionAssigns: CompanionAssign[];
  rides: Ride[];
  fleetVehicles: FleetVehicle[];
  companions: Companion[];
  drivers: Profile[];
  bookers: Profile[];
  onChanged: () => void;
}) {
  const [vehicleId, setVehicleId] = useState<string>("");
  const [driverId, setDriverId] = useState<string>("");
  const [companionSel, setCompanionSel] = useState<string[]>([]);
  const [quoteTotal, setQuoteTotal] = useState<string>("");
  const [quoteNotes, setQuoteNotes] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!booking) return;
    const v = vehicleAssigns.find((x) => x.booking_id === booking.id);
    setVehicleId(v?.fleet_vehicle_id ?? "");
    const d = driverAssigns.find((x) => x.booking_id === booking.id);
    setDriverId(d?.driver_user_id ?? "");
    setCompanionSel(companionAssigns.filter((c) => c.booking_id === booking.id).map((c) => c.companion_id));
    const q = quotes.find((x) => x.booking_id === booking.id);
    setQuoteTotal(q ? String(q.total) : "");
    setQuoteNotes(q?.notes ?? "");
  }, [booking, vehicleAssigns, driverAssigns, companionAssigns, quotes]);

  if (!booking) return null;

  const t = travellers.filter((x) => x.booking_id === booking.id);
  const primary = t.find((x) => x.is_primary) ?? t[0];
  const a = assistance.filter((x) => x.booking_id === booking.id);
  const it = itinerary.filter((x) => x.booking_id === booking.id).sort((x, y) => x.sequence_number - y.sequence_number);
  const q = quotes.find((x) => x.booking_id === booking.id);
  const ride = rides.find((r) => r.service_booking_id === booking.id);
  const bookerProfile = bookers.find((p) => p.user_id === booking.booked_by_user_id);
  const rideItem = it.find((i) => i.item_type === "ride");
  let parsedDest: { address: string; lat: number; lng: number } | null = null;
  let parsedMeta: { distanceKm?: number; durationMin?: number; estimatedTransport?: number; requestType?: "now" | "scheduled"; scheduledAt?: string | null } = {};
  if (rideItem?.notes) {
    try {
      const j = JSON.parse(rideItem.notes);
      if (j.destination) parsedDest = j.destination;
      parsedMeta = j;
    } catch { /* ignore */ }
  }

  async function logEvent(eventType: string, payload: Record<string, unknown>) {
    await supabase.from("service_booking_events").insert({
      booking_id: booking!.id,
      actor_user_id: actorId,
      event_type: eventType,
      payload: payload as never,
    });
  }

  async function saveVehicle() {
    if (!vehicleId) { toast.error("Pick a vehicle"); return; }
    setBusy(true);
    try {
      // Replace existing assignment
      await supabase.from("booking_vehicle_assignments").delete().eq("booking_id", booking!.id);
      const { error } = await supabase.from("booking_vehicle_assignments").insert({
        booking_id: booking!.id, fleet_vehicle_id: vehicleId, status: "confirmed",
      });
      if (error) throw error;
      await logEvent("vehicle_assigned", { fleet_vehicle_id: vehicleId });
      toast.success("Vehicle assigned");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally { setBusy(false); }
  }

  async function saveDriver() {
    if (!driverId) { toast.error("Pick a driver"); return; }
    setBusy(true);
    try {
      await supabase.from("booking_driver_assignments").delete().eq("booking_id", booking!.id);
      const { error } = await supabase.from("booking_driver_assignments").insert({
        booking_id: booking!.id, driver_user_id: driverId, status: "confirmed",
      });
      if (error) throw error;
      await logEvent("driver_assigned", { driver_user_id: driverId });
      toast.success("Driver assigned");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally { setBusy(false); }
  }

  async function saveCompanions() {
    if (companionSel.length !== booking!.requested_companion_count) {
      toast.error(`Pick exactly ${booking!.requested_companion_count} companion${booking!.requested_companion_count === 1 ? "" : "s"}`);
      return;
    }
    setBusy(true);
    try {
      await supabase.from("booking_companion_assignments").delete().eq("booking_id", booking!.id);
      const { error } = await supabase.from("booking_companion_assignments").insert(
        companionSel.map((cid) => ({ booking_id: booking!.id, companion_id: cid, status: "confirmed" })),
      );
      if (error) throw error;
      await logEvent("companions_assigned", { companion_ids: companionSel });
      toast.success("Companions assigned");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally { setBusy(false); }
  }

  async function saveQuote(sendNow: boolean) {
    const total = Number(quoteTotal);
    if (!Number.isFinite(total) || total < 0) { toast.error("Enter a valid total"); return; }
    setBusy(true);
    try {
      const existing = quotes.find((x) => x.booking_id === booking!.id);
      let quoteId = existing?.id ?? null;
      if (existing) {
        const { error } = await supabase.from("service_quotes")
          .update({ total, subtotal: total, notes: quoteNotes.trim() || null, status: sendNow ? "sent" : "draft" })
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("service_quotes")
          .insert({ booking_id: booking!.id, total, subtotal: total, notes: quoteNotes.trim() || null, status: sendNow ? "sent" : "draft", created_by_user_id: actorId })
          .select().single();
        if (error) throw error;
        quoteId = data.id;
      }
      // Single-line item
      if (quoteId) {
        await supabase.from("service_quote_items").delete().eq("quote_id", quoteId);
        await supabase.from("service_quote_items").insert({
          quote_id: quoteId, label: "Assistance support", quantity: 1, unit_price: total, line_total: total, sort_order: 0,
        });
      }
      if (sendNow) {
        await supabase.from("service_bookings")
          .update({ status: "quoted", quoted_total: total })
          .eq("id", booking!.id);
        await logEvent("quote_sent", { total });
      } else {
        await logEvent("quote_saved", { total });
      }
      toast.success(sendNow ? "Quote sent to customer" : "Quote saved");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally { setBusy(false); }
  }

  async function confirmResources() {
    setBusy(true);
    try {
      const { error } = await supabase.from("service_bookings").update({ status: "resources_assigned" }).eq("id", booking!.id);
      if (error) throw error;
      await logEvent("resources_confirmed", {});
      toast.success("Resources confirmed");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally { setBusy(false); }
  }

  async function createLinkedRide() {
    if (!rideItem || !parsedDest) { toast.error("No itinerary route to use"); return; }
    if (!driverId) { toast.error("Assign a driver first"); return; }
    setBusy(true);
    try {
      const distanceKm = Number(parsedMeta.distanceKm ?? 0);
      const transport = Number(parsedMeta.estimatedTransport ?? booking!.estimated_total ?? 0);
      const requestType = parsedMeta.requestType === "scheduled" ? "scheduled" : "now";
      // Step 1: insert as 'requested' without driver to satisfy validation
      const { data: ins, error: insErr } = await supabase
        .from("rides")
        .insert({
          passenger_id: booking!.booked_by_user_id,
          pickup_address: rideItem.address ?? "",
          pickup_lat: rideItem.latitude ?? 0,
          pickup_lng: rideItem.longitude ?? 0,
          destination_address: parsedDest.address,
          destination_lat: parsedDest.lat,
          destination_lng: parsedDest.lng,
          distance_km: distanceKm,
          estimated_price: transport,
          estimated_duration_seconds: parsedMeta.durationMin != null ? Math.round(Number(parsedMeta.durationMin) * 60) : null,
          request_type: requestType,
          scheduled_at: parsedMeta.scheduledAt ?? null,
          service_booking_id: booking!.id,
          itinerary_item_id: rideItem.id,
          leg_sequence: 1,
          day_number: 1,
        })
        .select().single();
      if (insErr) throw insErr;
      // Step 2: assign driver (admin bypasses transition checks)
      const { error: updErr } = await supabase
        .from("rides")
        .update({ driver_id: driverId, status: "accepted", accepted_at: new Date().toISOString() })
        .eq("id", ins.id);
      if (updErr) throw updErr;
      await supabase.from("service_bookings").update({ status: "active" }).eq("id", booking!.id);
      await logEvent("ride_created", { ride_id: ins.id });
      toast.success("Ride created and assigned");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create ride");
    } finally { setBusy(false); }
  }

  async function setStatus(status: BookingStatus) {
    setBusy(true);
    const { error } = await supabase.from("service_bookings").update({ status }).eq("id", booking!.id);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    await logEvent("status_changed", { status });
    toast.success(`Status: ${BOOKING_STATUS_LABEL[status]}`);
    onChanged();
  }

  return (
    <Dialog open={!!booking} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>{SERVICE_TYPE_LABEL[booking.service_type]}</span>
            <Badge variant={bookingStatusVariant(booking.status)}>{BOOKING_STATUS_LABEL[booking.status]}</Badge>
          </DialogTitle>
          <DialogDescription className="font-mono text-xs">{booking.booking_reference}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <section className="rounded-lg border p-3 text-sm">
            <h4 className="font-semibold">Booker</h4>
            <p>{bookerProfile?.full_name ?? booking.booked_by_user_id.slice(0, 8)}</p>
            {bookerProfile?.phone ? <p className="text-xs text-muted-foreground">{bookerProfile.phone}</p> : null}
          </section>
          <section className="rounded-lg border p-3 text-sm">
            <h4 className="font-semibold">Booking for</h4>
            {primary ? (
              <>
                <p>{primary.full_name}{primary.relationship_to_booker && primary.relationship_to_booker !== "self" ? ` (${primary.relationship_to_booker})` : ""}</p>
                {primary.phone ? <p className="text-xs text-muted-foreground">{primary.phone}</p> : null}
              </>
            ) : <p className="text-muted-foreground">—</p>}
          </section>
        </div>

        <section className="rounded-lg border p-3 text-sm">
          <h4 className="font-semibold">Assistance requirements</h4>
          {a.length ? (
            <ul className="mt-2 space-y-1">
              {a.map((x) => (
                <li key={x.id} className="text-sm">
                  <Badge variant="outline" className="mr-2">{ASSISTANCE_LABEL[x.requirement_code]}</Badge>
                  {x.notes ? <span className="text-xs text-muted-foreground">{x.notes}</span> : null}
                </li>
              ))}
            </ul>
          ) : <p className="text-xs text-muted-foreground">None recorded.</p>}
          {booking.passenger_notes ? (
            <p className="mt-2 text-xs"><span className="font-medium">Passenger notes:</span> {booking.passenger_notes}</p>
          ) : null}
        </section>

        <section className="rounded-lg border p-3 text-sm">
          <h4 className="font-semibold flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> Route</h4>
          {ride ? (
            <p>Linked ride <Link to="/app/trip/$rideId" params={{ rideId: ride.id }} className="text-primary underline">{ride.id.slice(0, 8)}</Link> · {ride.status.replace("_", " ")}</p>
          ) : rideItem ? (
            <div className="mt-1 space-y-0.5 text-xs">
              <p><span className="text-muted-foreground">Pickup:</span> {rideItem.address}</p>
              {parsedDest ? <p><span className="text-muted-foreground">Destination:</span> {parsedDest.address}</p> : null}
              {parsedMeta.distanceKm != null ? <p><span className="text-muted-foreground">Estimate:</span> {Number(parsedMeta.distanceKm).toFixed(2)} km · {formatZAR(Number(parsedMeta.estimatedTransport ?? 0))} transport</p> : null}
            </div>
          ) : <p className="text-xs text-muted-foreground">No route yet.</p>}
        </section>

        <section className="grid gap-3 rounded-lg border p-3">
          <h4 className="text-sm font-semibold">Resources</h4>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <Select value={vehicleId} onValueChange={setVehicleId}>
              <SelectTrigger><SelectValue placeholder="Assign fleet vehicle" /></SelectTrigger>
              <SelectContent>
                {fleetVehicles.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.registration_number} · {v.make ?? ""} {v.model ?? ""} · {v.passenger_capacity} pax{v.wheelchair_capacity > 0 ? ` · ${v.wheelchair_capacity} wheelchair` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" disabled={busy || !vehicleId} onClick={saveVehicle}>Save vehicle</Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <Select value={driverId} onValueChange={setDriverId}>
              <SelectTrigger><SelectValue placeholder="Assign driver" /></SelectTrigger>
              <SelectContent>
                {drivers.map((d) => (
                  <SelectItem key={d.user_id} value={d.user_id}>{d.full_name ?? d.user_id.slice(0, 8)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" disabled={busy || !driverId} onClick={saveDriver}>Save driver</Button>
          </div>
          {booking.service_type === "assisted" && booking.requested_companion_count > 0 ? (
            <div className="grid gap-2">
              <Label className="text-xs text-muted-foreground">Companions ({companionSel.length}/{booking.requested_companion_count})</Label>
              <div className="grid max-h-40 gap-1 overflow-y-auto rounded border p-2">
                {companions.filter((c) => c.admin_approved && c.is_available).length === 0 ? (
                  <p className="text-xs text-muted-foreground">No approved &amp; available companions yet. Add some in Companion management.</p>
                ) : (
                  companions.filter((c) => c.admin_approved && c.is_available).map((c) => {
                    const checked = companionSel.includes(c.id);
                    return (
                      <label key={c.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            setCompanionSel((prev) =>
                              e.target.checked
                                ? Array.from(new Set([...prev, c.id])).slice(0, booking.requested_companion_count)
                                : prev.filter((x) => x !== c.id),
                            );
                          }}
                        />
                        {c.full_name}
                      </label>
                    );
                  })
                )}
              </div>
              <Button size="sm" disabled={busy} onClick={saveCompanions}>Save companions</Button>
            </div>
          ) : null}
        </section>

        <section className="grid gap-2 rounded-lg border p-3">
          <h4 className="text-sm font-semibold flex items-center gap-1"><ClipboardList className="h-3.5 w-3.5" /> Quote</h4>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <Label htmlFor="qt-total">Total (ZAR)</Label>
              <Input id="qt-total" type="number" min="0" step="0.01" value={quoteTotal} onChange={(e) => setQuoteTotal(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="qt-notes">Notes</Label>
              <Input id="qt-notes" value={quoteNotes} onChange={(e) => setQuoteNotes(e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => saveQuote(false)}>Save draft</Button>
            <Button size="sm" disabled={busy} onClick={() => saveQuote(true)}>Send to customer</Button>
          </div>
          {q ? <p className="text-xs text-muted-foreground">Current: {q.status} · {formatZAR(Number(q.total))}</p> : null}
        </section>

        <section className="grid gap-2 rounded-lg border p-3">
          <h4 className="text-sm font-semibold">Activation</h4>
          <div className="flex flex-wrap gap-2">
            {booking.status !== "accepted" && booking.status !== "completed" && booking.status !== "cancelled" ? (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setStatus("accepted")}>Mark as accepted</Button>
            ) : null}
            <Button size="sm" variant="outline" disabled={busy} onClick={confirmResources}>Confirm resources</Button>
            {booking.service_type === "assisted" && !ride ? (
              <Button size="sm" disabled={busy || !driverId} onClick={createLinkedRide}>Create linked ride</Button>
            ) : null}
            {booking.status !== "cancelled" && booking.status !== "completed" ? (
              <Button size="sm" variant="destructive" disabled={busy} onClick={() => setStatus("cancelled")}>Cancel booking</Button>
            ) : null}
          </div>
          <p className="text-[11px] text-muted-foreground">Creating a linked ride keeps the existing PIN and trip-status lifecycle in charge of the actual transport.</p>
        </section>

        <DialogFooter>
          {ride ? (
            <Button asChild variant="outline" size="sm">
              <Link to="/app/trip/$rideId" params={{ rideId: ride.id }}>
                <ExternalLink className="mr-1 h-3.5 w-3.5" /> Open trip
              </Link>
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
