import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useUserRoles } from "@/hooks/use-auth";
import { AppShell, NAV_ICONS } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AddressAutocomplete, type AddressPick } from "@/components/AddressAutocomplete";
import { RouteMap } from "@/components/RouteMap";
import { computeRoute } from "@/lib/maps.functions";
import {
  ASSISTANCE_OPTIONS,
  APPOINTMENT_PATTERN_LABEL,
  APPOINTMENT_PATTERN_DESCRIPTION,
  type AssistanceCode,
  type AppointmentPattern,
  type RecurrenceFrequency,
  type RecurrenceRule,
} from "@/lib/booking-types";
import { toast } from "sonner";
import { ChevronLeft, Stethoscope } from "lucide-react";

export const Route = createFileRoute("/app/passenger/book/appointment")({
  head: () => ({ meta: [{ title: "Access Appointment — Book" }] }),
  component: BookAppointmentPage,
});

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_GENERATED_OCCURRENCES = 8;

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function localInputNow(): string {
  const d = new Date(Date.now() + 60 * 60_000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function addMinutes(iso: string, mins: number): string {
  return new Date(new Date(iso).getTime() + mins * 60_000).toISOString();
}

function generateOccurrences(
  start: Date,
  rule: RecurrenceRule,
  max = MAX_GENERATED_OCCURRENCES,
): Date[] {
  const out: Date[] = [];
  const endTs = rule.end_date
    ? new Date(rule.end_date).getTime() + 24 * 60 * 60_000
    : Number.POSITIVE_INFINITY;
  const limit = Math.min(max, rule.occurrences ?? max);

  if (rule.frequency === "weekly" || rule.frequency === "biweekly" || rule.frequency === "custom") {
    const days =
      rule.weekdays && rule.weekdays.length ? rule.weekdays.slice().sort() : [start.getDay()];
    const weekStep = rule.frequency === "biweekly" ? 2 : Math.max(1, rule.interval || 1);
    // Walk weeks; emit every selected weekday within the week.
    const weekAnchor = new Date(start);
    weekAnchor.setHours(start.getHours(), start.getMinutes(), 0, 0);
    // Move to Sunday of that week
    weekAnchor.setDate(weekAnchor.getDate() - weekAnchor.getDay());
    while (out.length < limit) {
      for (const dow of days) {
        const d = new Date(weekAnchor);
        d.setDate(weekAnchor.getDate() + dow);
        if (d.getTime() < start.getTime()) continue;
        if (d.getTime() > endTs) return out;
        out.push(d);
        if (out.length >= limit) return out;
      }
      weekAnchor.setDate(weekAnchor.getDate() + 7 * weekStep);
      if (out.length === 0 && weekAnchor.getTime() > endTs) return out;
    }
  } else if (rule.frequency === "monthly") {
    const step = Math.max(1, rule.interval || 1);
    let d = new Date(start);
    while (out.length < limit && d.getTime() <= endTs) {
      out.push(new Date(d));
      d = new Date(d);
      d.setMonth(d.getMonth() + step);
    }
  }
  return out;
}

function BookAppointmentPage() {
  const { user } = useAuth();
  const { roles } = useUserRoles(user?.id);
  const navigate = useNavigate();
  const route = useServerFn(computeRoute);

  const nav = useMemo(() => {
    const items = [
      { to: "/app/passenger", label: "Ride", icon: NAV_ICONS.Passenger },
      { to: "/app/passenger/bookings", label: "Bookings", icon: NAV_ICONS.Profile },
    ];
    if (roles?.includes("driver"))
      items.push({ to: "/app/driver", label: "Drive", icon: NAV_ICONS.Driver });
    if (roles?.includes("admin"))
      items.push({ to: "/app/admin", label: "Admin", icon: NAV_ICONS.Admin });
    items.push({ to: "/app/profile", label: "Profile", icon: NAV_ICONS.Profile });
    return items;
  }, [roles]);

  // Traveller
  const [bookFor, setBookFor] = useState<"self" | "other">("self");
  const [travellerName, setTravellerName] = useState("");
  const [travellerPhone, setTravellerPhone] = useState("");
  const [relationship, setRelationship] = useState("");

  // Facility & timing
  const [facilityName, setFacilityName] = useState("");
  const [facilityPt, setFacilityPt] = useState<AddressPick | null>(null);
  const [apptLocal, setApptLocal] = useState("");
  const [arriveBeforeMin, setArriveBeforeMin] = useState(15);
  const [durationMinExpected, setDurationMinExpected] = useState(60);

  // Pickup / return
  const [pickupPt, setPickupPt] = useState<AddressPick | null>(null);
  const [returnSameAsPickup, setReturnSameAsPickup] = useState(true);
  const [returnPt, setReturnPt] = useState<AddressPick | null>(null);

  // Pattern + support
  const [pattern, setPattern] = useState<AppointmentPattern>("dropoff_collect");
  const [companionCount, setCompanionCount] = useState<0 | 1 | 2 | 3 | 4>(1);
  const [assistance, setAssistance] = useState<AssistanceCode[]>([]);
  const [otherInstructions, setOtherInstructions] = useState("");
  const [notes, setNotes] = useState("");

  // Recurrence
  const [frequency, setFrequency] = useState<RecurrenceFrequency>("weekly");
  const [interval, setInterval] = useState(1);
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [recurEnd, setRecurEnd] = useState<string>("");
  const [occurrences, setOccurrences] = useState<number>(4);
  const [endMode, setEndMode] = useState<"date" | "count">("count");

  // Routing estimate (outbound pickup → facility)
  const [outboundKm, setOutboundKm] = useState<number | null>(null);
  const [outboundMin, setOutboundMin] = useState<number | null>(null);
  const [estimating, setEstimating] = useState(false);

  const [submitting, setSubmitting] = useState(false);

  // Prefill traveller from profile
  useEffect(() => {
    if (!user || bookFor !== "self") return;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("full_name, phone")
        .eq("user_id", user.id)
        .maybeSingle();
      if (data) {
        setTravellerName((n) => n || data.full_name || "");
        setTravellerPhone((p) => p || data.phone || "");
      }
    })();
  }, [user, bookFor]);

  useEffect(() => {
    if (!pickupPt || !facilityPt) {
      setOutboundKm(null);
      setOutboundMin(null);
      return;
    }
    let cancelled = false;
    setEstimating(true);
    route({
      data: {
        originLat: pickupPt.lat,
        originLng: pickupPt.lng,
        destLat: facilityPt.lat,
        destLng: facilityPt.lng,
      },
    })
      .then((r) => {
        if (cancelled) return;
        setOutboundKm(r.distanceKm);
        setOutboundMin(r.durationMin);
      })
      .catch((err: unknown) => {
        if (!cancelled) toast.error(err instanceof Error ? err.message : "Could not compute route");
      })
      .finally(() => !cancelled && setEstimating(false));
    return () => {
      cancelled = true;
    };
  }, [pickupPt, facilityPt, route]);

  const apptDate = useMemo(() => (apptLocal ? new Date(apptLocal) : null), [apptLocal]);
  const apptValid =
    !!apptDate && !Number.isNaN(apptDate.getTime()) && apptDate.getTime() > Date.now() + 60_000;
  const effectiveReturnPt = returnSameAsPickup ? pickupPt : returnPt;

  const recurrenceRule = useMemo<RecurrenceRule | null>(
    () =>
      pattern === "recurring"
        ? {
            frequency,
            interval,
            weekdays:
              frequency === "monthly"
                ? undefined
                : weekdays.length
                  ? weekdays
                  : apptDate
                    ? [apptDate.getDay()]
                    : [],
            end_date: endMode === "date" && recurEnd ? recurEnd : null,
            occurrences:
              endMode === "count"
                ? Math.max(1, Math.min(MAX_GENERATED_OCCURRENCES, occurrences))
                : null,
          }
        : null,
    [apptDate, endMode, frequency, interval, occurrences, pattern, recurEnd, weekdays],
  );

  const previewDates = useMemo(() => {
    if (pattern !== "recurring" || !apptDate || !recurrenceRule) return [];
    return generateOccurrences(apptDate, recurrenceRule);
  }, [pattern, apptDate, recurrenceRule]);

  const canSubmit =
    !!user &&
    pickupPt &&
    facilityPt &&
    !!facilityName.trim() &&
    travellerName.trim().length > 0 &&
    apptValid &&
    (pattern !== "dropoff_collect" || !!effectiveReturnPt) &&
    (pattern !== "wait_return" || !!effectiveReturnPt) &&
    (pattern !== "recurring" || previewDates.length > 0) &&
    companionCount >= 0 &&
    companionCount <= 4 &&
    !submitting;

  function toggleAssistance(code: AssistanceCode, on: boolean) {
    setAssistance((prev) =>
      on ? Array.from(new Set([...prev, code])) : prev.filter((c) => c !== code),
    );
  }

  function toggleWeekday(dow: number, on: boolean) {
    setWeekdays((prev) =>
      on ? Array.from(new Set([...prev, dow])).sort() : prev.filter((d) => d !== dow),
    );
  }

  async function createBookingFor(startAt: string, parentBookingId: string | null) {
    if (!user || !pickupPt || !facilityPt || !apptDate) throw new Error("Missing fields");
    const pickupArrivalAt = addMinutes(startAt, -arriveBeforeMin); // pickup time = appt - arriveBefore (approx)
    const journeyPattern =
      pattern === "dropoff"
        ? "one_way"
        : pattern === "wait_return"
          ? "wait_and_return"
          : pattern === "recurring" && parentBookingId == null
            ? "recurring"
            : "return";

    const { data: booking, error: bookingErr } = await supabase
      .from("service_bookings")
      .insert({
        booked_by_user_id: user.id,
        service_type: "appointment",
        journey_pattern: journeyPattern,
        status: "awaiting_quote",
        start_at: pickupArrivalAt,
        end_at:
          pattern === "wait_return"
            ? addMinutes(startAt, durationMinExpected)
            : pattern === "dropoff_collect"
              ? addMinutes(startAt, durationMinExpected)
              : null,
        requested_companion_count: companionCount,
        passenger_notes: notes.trim() || null,
        estimated_total: null,
        parent_booking_id: parentBookingId,
        recurrence_rule:
          parentBookingId == null && recurrenceRule ? (recurrenceRule as unknown as never) : null,
      })
      .select()
      .single();
    if (bookingErr) throw bookingErr;

    // Traveller
    const { error: travErr } = await supabase.from("booking_travellers").insert({
      booking_id: booking.id,
      linked_user_id: bookFor === "self" ? user.id : null,
      full_name: travellerName.trim(),
      phone: travellerPhone.trim() || null,
      relationship_to_booker: bookFor === "self" ? "self" : relationship.trim() || null,
      is_primary: true,
    });
    if (travErr) throw travErr;

    // Assistance
    const allCodes: AssistanceCode[] = otherInstructions.trim()
      ? Array.from(new Set([...assistance, "other" as AssistanceCode]))
      : assistance;
    if (allCodes.length) {
      const { error: asErr } = await supabase.from("booking_assistance_requirements").insert(
        allCodes.map((code) => ({
          booking_id: booking.id,
          requirement_code: code,
          quantity: 1,
          notes: code === "other" ? otherInstructions.trim() || null : null,
        })),
      );
      if (asErr) throw asErr;
    }

    // Itinerary: outbound ride
    const outboundMeta = {
      destination: {
        address: facilityPt.address,
        lat: facilityPt.lat,
        lng: facilityPt.lng,
        placeId: facilityPt.placeId,
      },
      pickupPlaceId: pickupPt.placeId,
      distanceKm: outboundKm,
      durationMin: outboundMin,
      requestType: "scheduled",
      scheduledAt: pickupArrivalAt,
      facilityName: facilityName.trim(),
      apptAt: startAt,
      arriveBeforeMin,
      expectedDurationMin: durationMinExpected,
    };

    const items: Array<Record<string, unknown>> = [];
    items.push({
      booking_id: booking.id,
      day_number: 1,
      sequence_number: 1,
      item_type: "ride",
      title: `Outbound → ${facilityName.trim()}`,
      planned_start_at: pickupArrivalAt,
      planned_end_at: startAt,
      address: pickupPt.address,
      latitude: pickupPt.lat,
      longitude: pickupPt.lng,
      notes: JSON.stringify(outboundMeta),
    });

    if (pattern === "wait_return" && effectiveReturnPt) {
      const waitStart = startAt;
      const waitEnd = addMinutes(startAt, durationMinExpected);
      items.push({
        booking_id: booking.id,
        day_number: 1,
        sequence_number: 2,
        item_type: "waiting",
        title: `Wait at ${facilityName.trim()}`,
        planned_start_at: waitStart,
        planned_end_at: waitEnd,
        address: facilityPt.address,
        latitude: facilityPt.lat,
        longitude: facilityPt.lng,
        notes: JSON.stringify({
          facilityName: facilityName.trim(),
          expectedDurationMin: durationMinExpected,
        }),
      });
      items.push({
        booking_id: booking.id,
        day_number: 1,
        sequence_number: 3,
        item_type: "ride",
        title: `Return → ${effectiveReturnPt.address}`,
        planned_start_at: waitEnd,
        address: facilityPt.address,
        latitude: facilityPt.lat,
        longitude: facilityPt.lng,
        notes: JSON.stringify({
          destination: {
            address: effectiveReturnPt.address,
            lat: effectiveReturnPt.lat,
            lng: effectiveReturnPt.lng,
            placeId: effectiveReturnPt.placeId,
          },
          requestType: "scheduled",
          scheduledAt: waitEnd,
          facilityName: facilityName.trim(),
        }),
      });
    } else if (pattern === "dropoff_collect" && effectiveReturnPt) {
      const collectAt = addMinutes(startAt, durationMinExpected);
      items.push({
        booking_id: booking.id,
        day_number: 1,
        sequence_number: 2,
        item_type: "ride",
        title: `Collection → ${effectiveReturnPt.address}`,
        planned_start_at: collectAt,
        address: facilityPt.address,
        latitude: facilityPt.lat,
        longitude: facilityPt.lng,
        notes: JSON.stringify({
          destination: {
            address: effectiveReturnPt.address,
            lat: effectiveReturnPt.lat,
            lng: effectiveReturnPt.lng,
            placeId: effectiveReturnPt.placeId,
          },
          requestType: "scheduled",
          scheduledAt: collectAt,
          facilityName: facilityName.trim(),
        }),
      });
    }

    const { error: itinErr } = await supabase
      .from("booking_itinerary_items")
      .insert(items as never);
    if (itinErr) throw itinErr;

    await supabase.from("service_booking_events").insert({
      booking_id: booking.id,
      actor_user_id: user.id,
      event_type: "booking_created",
      payload: {
        service_type: "appointment",
        pattern,
        parent_booking_id: parentBookingId,
        facility: facilityName.trim(),
      } as never,
    });

    return booking;
  }

  async function onSubmit() {
    if (!canSubmit || !user || !apptDate) return;
    setSubmitting(true);
    try {
      if (pattern === "recurring") {
        // Create a parent + child occurrences (max 8). Admin can review/confirm.
        const parent = await createBookingFor(apptDate.toISOString(), null);
        const dates = previewDates.slice(1); // first occurrence = parent
        for (const d of dates) {
          await createBookingFor(d.toISOString(), parent.id);
        }
        toast.success(
          `Recurring appointment series created (${previewDates.length} dates) — awaiting quote`,
        );
      } else {
        await createBookingFor(apptDate.toISOString(), null);
        toast.success("Access Appointment booking submitted — awaiting quote");
      }
      navigate({ to: "/app/passenger/bookings" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create booking");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell title="Access Appointment" nav={nav}>
      <div className="mb-3">
        <Link
          to="/app/passenger/book"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="mr-1 h-4 w-4" /> Back
        </Link>
      </div>

      <section className="rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)]">
        <div className="flex items-center gap-2">
          <Stethoscope className="h-5 w-5 text-primary" />
          <h2 className="text-base font-semibold">Appointment details</h2>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Accessible transport and support for healthcare visits, assessments, physiotherapy,
          checkups and medical-facility appointments.
        </p>

        <div className="mt-3 grid gap-3">
          <div>
            <Label htmlFor="appt-facility">Facility name</Label>
            <Input
              id="appt-facility"
              value={facilityName}
              onChange={(e) => setFacilityName(e.target.value)}
              placeholder="e.g. Sandton Mediclinic"
            />
          </div>
          <AddressAutocomplete
            id="appt-facility-addr"
            label="Facility address"
            value={facilityPt}
            onChange={setFacilityPt}
          />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="appt-time">Appointment date & time</Label>
              <Input
                id="appt-time"
                type="datetime-local"
                min={localInputNow()}
                value={apptLocal}
                onChange={(e) => setApptLocal(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="appt-arrive">Arrive how early? (min)</Label>
              <Input
                id="appt-arrive"
                type="number"
                min={0}
                max={120}
                value={arriveBeforeMin}
                onChange={(e) => setArriveBeforeMin(Number(e.target.value) || 0)}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="appt-duration">Expected appointment duration (min)</Label>
            <Input
              id="appt-duration"
              type="number"
              min={5}
              step={5}
              value={durationMinExpected}
              onChange={(e) => setDurationMinExpected(Math.max(5, Number(e.target.value) || 0))}
            />
          </div>
        </div>
      </section>

      <section className="mt-3 rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)]">
        <h2 className="text-base font-semibold">Journey option</h2>
        <RadioGroup
          value={pattern}
          onValueChange={(v) => setPattern(v as AppointmentPattern)}
          className="mt-3 grid gap-2"
        >
          {(["dropoff", "dropoff_collect", "wait_return", "recurring"] as AppointmentPattern[]).map(
            (p) => (
              <Label
                key={p}
                htmlFor={`appt-p-${p}`}
                className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm"
              >
                <RadioGroupItem id={`appt-p-${p}`} value={p} className="mt-0.5" />
                <span className="min-w-0">
                  <span className="block font-medium">{APPOINTMENT_PATTERN_LABEL[p]}</span>
                  <span className="block text-xs text-muted-foreground">
                    {APPOINTMENT_PATTERN_DESCRIPTION[p]}
                  </span>
                </span>
              </Label>
            ),
          )}
        </RadioGroup>
      </section>

      <section className="mt-3 rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)]">
        <h2 className="text-base font-semibold">Pickup &amp; return</h2>
        <div className="mt-3 space-y-3">
          <AddressAutocomplete
            id="appt-pickup"
            label="Pickup address"
            value={pickupPt}
            onChange={setPickupPt}
            enableCurrentLocation
          />
          {pattern === "dropoff_collect" || pattern === "wait_return" ? (
            <>
              <Label
                htmlFor="appt-ret-same"
                className="flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm"
              >
                <Checkbox
                  id="appt-ret-same"
                  checked={returnSameAsPickup}
                  onCheckedChange={(c) => setReturnSameAsPickup(c === true)}
                />
                <span>Return to the same pickup address</span>
              </Label>
              {!returnSameAsPickup ? (
                <AddressAutocomplete
                  id="appt-return"
                  label="Return address"
                  value={returnPt}
                  onChange={setReturnPt}
                />
              ) : null}
            </>
          ) : null}
        </div>
        {pickupPt && facilityPt ? (
          <div className="mt-3 space-y-2">
            <RouteMap origin={pickupPt} destination={facilityPt} className="h-40" />
            <div className="flex items-center justify-between rounded-lg bg-secondary px-3 py-2 text-sm">
              <span className="text-muted-foreground">
                {estimating
                  ? "Estimating outbound…"
                  : outboundKm != null
                    ? `Outbound ${outboundKm.toFixed(2)} km${outboundMin != null ? ` · ~${outboundMin} min` : ""}`
                    : "—"}
              </span>
              <span className="font-semibold">Personalised quote</span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Appointment pricing remains unpublished. Our team will calculate the complete route,
              waiting and support requirements before sending a personalised quote.
            </p>
          </div>
        ) : null}
      </section>

      <section className="mt-3 rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)]">
        <h2 className="text-base font-semibold">Who is travelling?</h2>
        <RadioGroup
          value={bookFor}
          onValueChange={(v) => setBookFor(v as "self" | "other")}
          className="mt-3 grid grid-cols-2 gap-2"
        >
          <Label
            htmlFor="appt-bf-self"
            className="flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm"
          >
            <RadioGroupItem id="appt-bf-self" value="self" /> Myself
          </Label>
          <Label
            htmlFor="appt-bf-other"
            className="flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm"
          >
            <RadioGroupItem id="appt-bf-other" value="other" /> Someone else
          </Label>
        </RadioGroup>
        <div className="mt-3 grid gap-3">
          <div>
            <Label htmlFor="appt-trav-name">Primary traveller name</Label>
            <Input
              id="appt-trav-name"
              value={travellerName}
              onChange={(e) => setTravellerName(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="appt-trav-phone">Traveller phone</Label>
            <Input
              id="appt-trav-phone"
              value={travellerPhone}
              onChange={(e) => setTravellerPhone(e.target.value)}
            />
          </div>
          {bookFor === "other" ? (
            <div>
              <Label htmlFor="appt-trav-rel">Relationship to traveller</Label>
              <Input
                id="appt-trav-rel"
                value={relationship}
                onChange={(e) => setRelationship(e.target.value)}
              />
            </div>
          ) : null}
        </div>
      </section>

      <section className="mt-3 rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)]">
        <h2 className="text-base font-semibold">Companion support</h2>
        <p className="text-xs text-muted-foreground">
          How many trained companions should accompany the traveller?
        </p>
        <div className="mt-3 grid grid-cols-5 gap-2">
          {[0, 1, 2, 3, 4].map((n) => (
            <Button
              key={n}
              type="button"
              variant={companionCount === n ? "default" : "outline"}
              onClick={() => setCompanionCount(n as 0 | 1 | 2 | 3 | 4)}
            >
              {n}
            </Button>
          ))}
        </div>
      </section>

      <section className="mt-3 rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)]">
        <h2 className="text-base font-semibold">Assistance needed (optional)</h2>
        <div className="mt-3 grid gap-2">
          {ASSISTANCE_OPTIONS.filter((o) => o.code !== "other").map((opt) => (
            <Label
              key={opt.code}
              htmlFor={`appt-aa-${opt.code}`}
              className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm"
            >
              <Checkbox
                id={`appt-aa-${opt.code}`}
                checked={assistance.includes(opt.code)}
                onCheckedChange={(c) => toggleAssistance(opt.code, c === true)}
              />
              <span className="min-w-0">
                <span className="block font-medium">{opt.label}</span>
                <span className="block text-xs text-muted-foreground">{opt.description}</span>
              </span>
            </Label>
          ))}
        </div>
        <div className="mt-3">
          <Label htmlFor="appt-other-support">Other support instructions (optional)</Label>
          <Textarea
            id="appt-other-support"
            value={otherInstructions}
            onChange={(e) => setOtherInstructions(e.target.value)}
          />
        </div>
      </section>

      <section className="mt-3 rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)]">
        <Label htmlFor="appt-notes">Operational notes for the team (optional)</Label>
        <Textarea
          id="appt-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. wheelchair-accessible entrance on the south side"
        />
      </section>

      {pattern === "recurring" ? (
        <section className="mt-3 rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)]">
          <h2 className="text-base font-semibold">Recurrence</h2>
          <p className="text-xs text-muted-foreground">
            We'll generate up to {MAX_GENERATED_OCCURRENCES} dates. Our team confirms each before
            any ride is dispatched.
          </p>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Frequency</Label>
              <Select
                value={frequency}
                onValueChange={(v) => setFrequency(v as RecurrenceFrequency)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="biweekly">Every 2 weeks</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {frequency === "custom" || frequency === "monthly" ? (
              <div>
                <Label htmlFor="appt-interval">
                  Interval ({frequency === "monthly" ? "months" : "weeks"})
                </Label>
                <Input
                  id="appt-interval"
                  type="number"
                  min={1}
                  max={12}
                  value={interval}
                  onChange={(e) => setInterval(Math.max(1, Number(e.target.value) || 1))}
                />
              </div>
            ) : null}
          </div>

          {frequency !== "monthly" ? (
            <div className="mt-3">
              <Label>Days of the week</Label>
              <div className="mt-1 grid grid-cols-7 gap-1">
                {WEEKDAY_LABELS.map((d, idx) => (
                  <Button
                    key={idx}
                    type="button"
                    size="sm"
                    variant={weekdays.includes(idx) ? "default" : "outline"}
                    onClick={() => toggleWeekday(idx, !weekdays.includes(idx))}
                  >
                    {d}
                  </Button>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Leave blank to use the same weekday as your first appointment.
              </p>
            </div>
          ) : null}

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <Label>End condition</Label>
              <RadioGroup
                value={endMode}
                onValueChange={(v) => setEndMode(v as "date" | "count")}
                className="mt-1 grid grid-cols-2 gap-2"
              >
                <Label
                  htmlFor="appt-em-count"
                  className="flex cursor-pointer items-center gap-2 rounded-lg border p-2 text-xs"
                >
                  <RadioGroupItem id="appt-em-count" value="count" /> # of times
                </Label>
                <Label
                  htmlFor="appt-em-date"
                  className="flex cursor-pointer items-center gap-2 rounded-lg border p-2 text-xs"
                >
                  <RadioGroupItem id="appt-em-date" value="date" /> End date
                </Label>
              </RadioGroup>
            </div>
            {endMode === "count" ? (
              <div>
                <Label htmlFor="appt-occ">
                  Number of occurrences (max {MAX_GENERATED_OCCURRENCES})
                </Label>
                <Input
                  id="appt-occ"
                  type="number"
                  min={1}
                  max={MAX_GENERATED_OCCURRENCES}
                  value={occurrences}
                  onChange={(e) =>
                    setOccurrences(
                      Math.max(1, Math.min(MAX_GENERATED_OCCURRENCES, Number(e.target.value) || 1)),
                    )
                  }
                />
              </div>
            ) : (
              <div>
                <Label htmlFor="appt-end">End date</Label>
                <Input
                  id="appt-end"
                  type="date"
                  value={recurEnd}
                  onChange={(e) => setRecurEnd(e.target.value)}
                />
              </div>
            )}
          </div>

          {previewDates.length ? (
            <div className="mt-3 rounded-lg bg-secondary/50 p-3 text-xs">
              <p className="font-medium">Generated dates ({previewDates.length}):</p>
              <ul className="mt-1 space-y-0.5">
                {previewDates.map((d, i) => (
                  <li key={i}>
                    #{i + 1} —{" "}
                    {d.toLocaleString("en-ZA", {
                      timeZone: "Africa/Johannesburg",
                      weekday: "short",
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              Set frequency, weekdays and end condition to preview dates.
            </p>
          )}
        </section>
      ) : null}

      <Button className="mt-4 w-full" size="lg" disabled={!canSubmit} onClick={onSubmit}>
        {submitting ? "Submitting…" : "Submit for quote"}
      </Button>
      {!apptValid && apptLocal ? (
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Appointment must be at least 1 hour from now.
        </p>
      ) : null}
    </AppShell>
  );
}
