import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useUserRoles } from "@/hooks/use-auth";
import { AppShell, NAV_ICONS } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ChevronLeft, Plane, Plus, Trash2 } from "lucide-react";
import {
  EXTENDED_DURATION_DAYS,
  EXTENDED_DURATION_LABEL,
  EXTENDED_ITEM_LABEL,
  type ExtendedDurationPreset,
  type ExtendedItineraryItem,
  type ExtendedItineraryItemType,
  type ExtendedJourneyMetadata,
} from "@/lib/booking-types";

export const Route = createFileRoute("/app/passenger/book/extended")({
  head: () => ({ meta: [{ title: "Access Extended Journey — Book" }] }),
  component: BookExtendedPage,
});

const ITEM_TYPES: ExtendedItineraryItemType[] = ["ride", "activity", "waiting", "appointment", "accommodation", "other"];

function pad(n: number) { return String(n).padStart(2, "0"); }
function todayISO() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function addDaysISO(iso: string, days: number) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function diffDays(startISO: string, endISO: string) {
  if (!startISO || !endISO) return 0;
  const a = new Date(startISO + "T00:00:00").getTime();
  const b = new Date(endISO + "T00:00:00").getTime();
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

function BookExtendedPage() {
  const { user } = useAuth();
  const { roles } = useUserRoles(user?.id);
  const navigate = useNavigate();

  const nav = useMemo(() => {
    const items = [
      { to: "/app/passenger" as const, label: "Ride", icon: NAV_ICONS.Passenger },
      { to: "/app/passenger/bookings" as const, label: "Bookings", icon: NAV_ICONS.Profile },
    ];
    if (roles?.includes("driver")) items.push({ to: "/app/driver" as never, label: "Drive", icon: NAV_ICONS.Driver });
    if (roles?.includes("admin")) items.push({ to: "/app/admin" as never, label: "Admin", icon: NAV_ICONS.Admin });
    items.push({ to: "/app/profile" as never, label: "Profile", icon: NAV_ICONS.Profile });
    return items;
  }, [roles]);

  // Traveller
  const [bookFor, setBookFor] = useState<"self" | "other">("self");
  const [travellerName, setTravellerName] = useState("");
  const [travellerPhone, setTravellerPhone] = useState("");
  const [relationship, setRelationship] = useState("");

  // Duration + dates
  const [preset, setPreset] = useState<ExtendedDurationPreset>("three_days");
  const [startDate, setStartDate] = useState<string>(addDaysISO(todayISO(), 7));
  const [endDate, setEndDate] = useState<string>(addDaysISO(todayISO(), 9));

  // Group + equipment
  const [groupSize, setGroupSize] = useState(1);
  const [additional, setAdditional] = useState<{ full_name: string; phone: string; relationship: string }[]>([]);
  const [wheelchairCount, setWheelchairCount] = useState(0);
  const [equipmentCount, setEquipmentCount] = useState(0);
  const [companionCount, setCompanionCount] = useState<0 | 1 | 2 | 3 | 4>(1);

  // Locations
  const [startingLocation, setStartingLocation] = useState("");
  const [mainDestination, setMainDestination] = useState("");
  const [destinations, setDestinations] = useState<string[]>([]);

  // Requirements
  const [luggage, setLuggage] = useState("");
  const [accommodation, setAccommodation] = useState("");
  const [overnightSupport, setOvernightSupport] = useState("");
  const [emergencyName, setEmergencyName] = useState("");
  const [emergencyPhone, setEmergencyPhone] = useState("");
  const [emergencyRel, setEmergencyRel] = useState("");
  const [generalSupport, setGeneralSupport] = useState("");
  const [notes, setNotes] = useState("");

  // Itinerary
  const [itinerary, setItinerary] = useState<ExtendedItineraryItem[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Prefill traveller from profile (self)
  useEffect(() => {
    if (!user || bookFor !== "self") return;
    (async () => {
      const { data } = await supabase.from("profiles").select("full_name, phone").eq("user_id", user.id).maybeSingle();
      if (data) {
        setTravellerName((n) => n || data.full_name || "");
        setTravellerPhone((p) => p || data.phone || "");
      }
    })();
  }, [user, bookFor]);

  // Apply preset
  useEffect(() => {
    if (preset === "custom") return;
    const days = EXTENDED_DURATION_DAYS[preset];
    setEndDate(addDaysISO(startDate, days - 1));
  }, [preset, startDate]);

  const totalDays = diffDays(startDate, endDate);

  function addItem(day: number) {
    setItinerary((prev) => {
      const dayItems = prev.filter((i) => i.day === day);
      const nextSeq = dayItems.length + 1;
      return [...prev, { day, sequence: nextSeq, type: "activity", title: "", start_time: null, end_time: null, address: null, notes: null }];
    });
  }
  function removeItem(idx: number) {
    setItinerary((prev) => prev.filter((_, i) => i !== idx).map((it, i, arr) => {
      // re-sequence by day
      const sameDayBefore = arr.slice(0, i).filter((x) => x.day === it.day).length;
      return { ...it, sequence: sameDayBefore + 1 };
    }));
  }
  function updateItem(idx: number, patch: Partial<ExtendedItineraryItem>) {
    setItinerary((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }
  function addDestination() { setDestinations((d) => [...d, ""]); }
  function updateDestination(i: number, v: string) { setDestinations((d) => d.map((x, idx) => (idx === i ? v : x))); }
  function removeDestination(i: number) { setDestinations((d) => d.filter((_, idx) => idx !== i)); }

  function addTraveller() { setAdditional((a) => [...a, { full_name: "", phone: "", relationship: "" }]); }
  function updateTraveller(i: number, patch: Partial<{ full_name: string; phone: string; relationship: string }>) {
    setAdditional((a) => a.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  }
  function removeTraveller(i: number) { setAdditional((a) => a.filter((_, idx) => idx !== i)); }

  const canSubmit =
    !!user &&
    travellerName.trim().length > 0 &&
    !!startDate &&
    !!endDate &&
    new Date(endDate) >= new Date(startDate) &&
    !!startingLocation.trim() &&
    !!mainDestination.trim() &&
    !!emergencyName.trim() &&
    !!emergencyPhone.trim() &&
    companionCount >= 0 &&
    companionCount <= 4 &&
    !submitting;

  async function onSubmit() {
    if (!canSubmit || !user) return;
    setSubmitting(true);
    try {
      const meta: ExtendedJourneyMetadata = {
        duration_preset: preset,
        group_size: groupSize,
        additional_travellers: additional
          .filter((t) => t.full_name.trim())
          .map((t) => ({ full_name: t.full_name.trim(), phone: t.phone.trim() || null, relationship: t.relationship.trim() || null })),
        wheelchair_count: wheelchairCount,
        mobility_equipment_count: equipmentCount,
        starting_location: startingLocation.trim(),
        main_destination: mainDestination.trim(),
        planned_destinations: destinations.map((d) => d.trim()).filter(Boolean),
        luggage_requirements: luggage.trim(),
        accommodation_requirements: accommodation.trim(),
        overnight_support_requirements: overnightSupport.trim(),
        emergency_contact: { name: emergencyName.trim(), phone: emergencyPhone.trim(), relationship: emergencyRel.trim() || null },
        general_support_instructions: generalSupport.trim(),
      };

      const { data: booking, error: bErr } = await supabase
        .from("service_bookings")
        .insert({
          booked_by_user_id: user.id,
          service_type: "extended_journey",
          journey_pattern: "multi_day",
          status: "awaiting_quote",
          start_at: new Date(startDate + "T08:00:00").toISOString(),
          end_at: new Date(endDate + "T18:00:00").toISOString(),
          requested_companion_count: companionCount,
          passenger_notes: notes.trim() || null,
          metadata: meta as unknown as never,
        })
        .select()
        .single();
      if (bErr) throw bErr;

      // Traveller
      const travellerInserts = [
        {
          booking_id: booking.id,
          linked_user_id: bookFor === "self" ? user.id : null,
          full_name: travellerName.trim(),
          phone: travellerPhone.trim() || null,
          relationship_to_booker: bookFor === "self" ? "self" : relationship.trim() || null,
          is_primary: true,
        },
        ...meta.additional_travellers.map((t) => ({
          booking_id: booking.id,
          linked_user_id: null,
          full_name: t.full_name,
          phone: t.phone ?? null,
          relationship_to_booker: t.relationship ?? null,
          is_primary: false,
        })),
      ];
      const { error: travErr } = await supabase.from("booking_travellers").insert(travellerInserts);
      if (travErr) throw travErr;

      // Itinerary draft (no rides created yet — quote/confirmation gate)
      if (itinerary.length > 0) {
        const items = itinerary
          .filter((i) => i.title.trim() || i.type === "ride" || i.type === "waiting")
          .map((i) => {
            const planned_start_at = i.start_time
              ? new Date(addDaysISO(startDate, i.day - 1) + "T" + i.start_time + ":00").toISOString()
              : null;
            const planned_end_at = i.end_time
              ? new Date(addDaysISO(startDate, i.day - 1) + "T" + i.end_time + ":00").toISOString()
              : null;
            return {
              booking_id: booking.id,
              day_number: i.day,
              sequence_number: i.sequence,
              item_type: i.type,
              title: i.title.trim() || EXTENDED_ITEM_LABEL[i.type],
              address: i.address?.trim() || null,
              planned_start_at,
              planned_end_at,
              notes: i.notes?.trim() || null,
            };
          });
        if (items.length) {
          const { error: itErr } = await supabase.from("booking_itinerary_items").insert(items as never);
          if (itErr) throw itErr;
        }
      }

      await supabase.from("service_booking_events").insert({
        booking_id: booking.id,
        actor_user_id: user.id,
        event_type: "booking_created",
        payload: { service_type: "extended_journey", duration_preset: preset, days: totalDays } as never,
      });

      toast.success("Extended Journey request submitted — awaiting quote");
      navigate({ to: "/app/passenger/bookings" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create booking");
    } finally {
      setSubmitting(false);
    }
  }

  // Build day tabs/sections
  const dayNumbers = Array.from({ length: Math.max(1, totalDays) }, (_, i) => i + 1);

  return (
    <AppShell title="Extended Journey" nav={nav}>
      <div className="mb-3 flex items-center gap-2">
        <Button asChild size="sm" variant="ghost">
          <Link to="/app/passenger/book"><ChevronLeft className="h-4 w-4" /> Back</Link>
        </Button>
      </div>

      <header className="rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)]">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
            <Plane className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Access Extended Journey</h1>
            <p className="text-xs text-muted-foreground">Premium accessible multi-day travel with a dedicated vehicle, driver and companion team.</p>
          </div>
        </div>
      </header>

      {/* Duration */}
      <section className="mt-4 rounded-xl border bg-card p-4">
        <h2 className="text-sm font-semibold">Duration</h2>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(["three_days", "five_days", "seven_days", "custom"] as ExtendedDurationPreset[]).map((p) => (
            <Button
              key={p}
              type="button"
              variant={preset === p ? "default" : "outline"}
              size="sm"
              onClick={() => setPreset(p)}
            >
              {EXTENDED_DURATION_LABEL[p]}
            </Button>
          ))}
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div>
            <Label htmlFor="ej-start">Start date</Label>
            <Input id="ej-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="ej-end">End date</Label>
            <Input id="ej-end" type="date" value={endDate} min={startDate} onChange={(e) => { setEndDate(e.target.value); setPreset("custom"); }} />
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Total: {totalDays} day{totalDays === 1 ? "" : "s"}</p>
      </section>

      {/* Traveller */}
      <section className="mt-4 rounded-xl border bg-card p-4">
        <h2 className="text-sm font-semibold">Primary traveller</h2>
        <div className="mt-2 flex gap-2">
          <Button type="button" size="sm" variant={bookFor === "self" ? "default" : "outline"} onClick={() => setBookFor("self")}>Booking for me</Button>
          <Button type="button" size="sm" variant={bookFor === "other" ? "default" : "outline"} onClick={() => setBookFor("other")}>Someone else</Button>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div>
            <Label>Full name</Label>
            <Input value={travellerName} onChange={(e) => setTravellerName(e.target.value)} />
          </div>
          <div>
            <Label>Phone</Label>
            <Input value={travellerPhone} onChange={(e) => setTravellerPhone(e.target.value)} />
          </div>
          {bookFor === "other" ? (
            <div className="sm:col-span-2">
              <Label>Relationship to you</Label>
              <Input value={relationship} onChange={(e) => setRelationship(e.target.value)} />
            </div>
          ) : null}
        </div>
      </section>

      {/* Additional travellers */}
      <section className="mt-4 rounded-xl border bg-card p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Additional travellers</h2>
          <Button type="button" size="sm" variant="outline" onClick={addTraveller}><Plus className="h-3.5 w-3.5" /> Add</Button>
        </div>
        {additional.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">No additional travellers.</p>
        ) : (
          <div className="mt-2 space-y-2">
            {additional.map((t, i) => (
              <div key={i} className="grid gap-2 rounded border p-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
                <Input placeholder="Full name" value={t.full_name} onChange={(e) => updateTraveller(i, { full_name: e.target.value })} />
                <Input placeholder="Phone" value={t.phone} onChange={(e) => updateTraveller(i, { phone: e.target.value })} />
                <Input placeholder="Relationship" value={t.relationship} onChange={(e) => updateTraveller(i, { relationship: e.target.value })} />
                <Button type="button" size="sm" variant="ghost" onClick={() => removeTraveller(i)}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            ))}
          </div>
        )}
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div>
            <Label>Group size (total)</Label>
            <Input type="number" min={1} value={groupSize} onChange={(e) => setGroupSize(Math.max(1, Number(e.target.value) || 1))} />
          </div>
          <div>
            <Label>Required companions (0–4)</Label>
            <Select value={String(companionCount)} onValueChange={(v) => setCompanionCount(Number(v) as 0 | 1 | 2 | 3 | 4)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {[0, 1, 2, 3, 4].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Wheelchairs</Label>
            <Input type="number" min={0} value={wheelchairCount} onChange={(e) => setWheelchairCount(Math.max(0, Number(e.target.value) || 0))} />
          </div>
          <div>
            <Label>Other mobility equipment</Label>
            <Input type="number" min={0} value={equipmentCount} onChange={(e) => setEquipmentCount(Math.max(0, Number(e.target.value) || 0))} />
          </div>
        </div>
      </section>

      {/* Locations */}
      <section className="mt-4 rounded-xl border bg-card p-4">
        <h2 className="text-sm font-semibold">Locations</h2>
        <div className="mt-2 grid gap-2">
          <div>
            <Label>Starting location</Label>
            <Input value={startingLocation} onChange={(e) => setStartingLocation(e.target.value)} placeholder="e.g. Home address, hotel name" />
          </div>
          <div>
            <Label>Main destination</Label>
            <Input value={mainDestination} onChange={(e) => setMainDestination(e.target.value)} placeholder="e.g. Garden Route, Cape Town" />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <Label>Other planned destinations</Label>
              <Button type="button" size="sm" variant="outline" onClick={addDestination}><Plus className="h-3.5 w-3.5" /> Add</Button>
            </div>
            {destinations.length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">Add stops you'd like to include.</p>
            ) : (
              <div className="mt-2 space-y-2">
                {destinations.map((d, i) => (
                  <div key={i} className="flex gap-2">
                    <Input value={d} onChange={(e) => updateDestination(i, e.target.value)} />
                    <Button type="button" size="sm" variant="ghost" onClick={() => removeDestination(i)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Requirements */}
      <section className="mt-4 rounded-xl border bg-card p-4">
        <h2 className="text-sm font-semibold">Requirements & support</h2>
        <div className="mt-2 grid gap-2">
          <div>
            <Label>Luggage requirements</Label>
            <Textarea rows={2} value={luggage} onChange={(e) => setLuggage(e.target.value)} placeholder="Bags, mobility equipment, medical supplies…" />
          </div>
          <div>
            <Label>Accommodation requirements</Label>
            <Textarea rows={2} value={accommodation} onChange={(e) => setAccommodation(e.target.value)} placeholder="Accessible rooms, ground floor, etc." />
          </div>
          <div>
            <Label>Overnight support requirements</Label>
            <Textarea rows={2} value={overnightSupport} onChange={(e) => setOvernightSupport(e.target.value)} placeholder="Personal care, medication reminders, sleep support…" />
          </div>
          <div>
            <Label>General support instructions</Label>
            <Textarea rows={2} value={generalSupport} onChange={(e) => setGeneralSupport(e.target.value)} />
          </div>
        </div>
      </section>

      {/* Emergency contact */}
      <section className="mt-4 rounded-xl border bg-card p-4">
        <h2 className="text-sm font-semibold">Emergency contact</h2>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <div><Label>Name</Label><Input value={emergencyName} onChange={(e) => setEmergencyName(e.target.value)} /></div>
          <div><Label>Phone</Label><Input value={emergencyPhone} onChange={(e) => setEmergencyPhone(e.target.value)} /></div>
          <div><Label>Relationship</Label><Input value={emergencyRel} onChange={(e) => setEmergencyRel(e.target.value)} /></div>
        </div>
      </section>

      {/* Itinerary builder */}
      <section className="mt-4 rounded-xl border bg-card p-4">
        <h2 className="text-sm font-semibold">Daily itinerary (draft)</h2>
        <p className="text-xs text-muted-foreground">Sketch your plan — Admin will refine it and confirm rides only after you accept the quote.</p>
        <div className="mt-3 space-y-3">
          {dayNumbers.map((day) => {
            const dayItems = itinerary
              .map((it, idx) => ({ it, idx }))
              .filter((x) => x.it.day === day)
              .sort((a, b) => a.it.sequence - b.it.sequence);
            return (
              <div key={day} className="rounded-lg border bg-background/40 p-2">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">Day {day}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(addDaysISO(startDate, day - 1) + "T00:00:00").toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" })}
                    </span>
                  </div>
                  <Button type="button" size="sm" variant="outline" onClick={() => addItem(day)}><Plus className="h-3.5 w-3.5" /> Item</Button>
                </div>
                {dayItems.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No items yet.</p>
                ) : (
                  <ol className="space-y-2">
                    {dayItems.map(({ it, idx }) => (
                      <li key={idx} className="rounded border p-2">
                        <div className="grid gap-2 sm:grid-cols-[110px_1fr_auto]">
                          <Select value={it.type} onValueChange={(v) => updateItem(idx, { type: v as ExtendedItineraryItemType })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {ITEM_TYPES.map((t) => <SelectItem key={t} value={t}>{EXTENDED_ITEM_LABEL[t]}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <Input placeholder="Title (e.g. Hotel check-in)" value={it.title} onChange={(e) => updateItem(idx, { title: e.target.value })} />
                          <Button type="button" size="sm" variant="ghost" onClick={() => removeItem(idx)}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </div>
                        <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_2fr]">
                          <Input type="time" value={it.start_time ?? ""} onChange={(e) => updateItem(idx, { start_time: e.target.value || null })} />
                          <Input type="time" value={it.end_time ?? ""} onChange={(e) => updateItem(idx, { end_time: e.target.value || null })} />
                          <Input placeholder="Address / location" value={it.address ?? ""} onChange={(e) => updateItem(idx, { address: e.target.value || null })} />
                        </div>
                        <Textarea className="mt-2" rows={2} placeholder="Notes" value={it.notes ?? ""} onChange={(e) => updateItem(idx, { notes: e.target.value || null })} />
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="mt-4 rounded-xl border bg-card p-4">
        <Label htmlFor="ej-notes">Booking notes (optional)</Label>
        <Textarea id="ej-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </section>

      <div className="sticky bottom-0 left-0 right-0 z-10 mt-4 -mx-4 border-t bg-background/95 p-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border">
        <Button className="w-full" size="lg" disabled={!canSubmit} onClick={onSubmit}>
          {submitting ? "Submitting…" : "Submit for quote"}
        </Button>
        <p className="mt-1 text-center text-[11px] text-muted-foreground">
          Extended Journey requests start as awaiting_quote. No rides are created until Admin reviews and you accept the quote.
        </p>
      </div>
    </AppShell>
  );
}
