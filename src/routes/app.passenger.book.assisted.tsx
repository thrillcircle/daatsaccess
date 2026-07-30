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
import { AddressAutocomplete, type AddressPick } from "@/components/AddressAutocomplete";
import { RouteMap } from "@/components/RouteMap";
import { computeRoute } from "@/lib/maps.functions";
import { ASSISTANCE_OPTIONS, type AssistanceCode } from "@/lib/booking-types";
import { toast } from "sonner";
import { ChevronLeft } from "lucide-react";

export const Route = createFileRoute("/app/passenger/book/assisted")({
  head: () => ({ meta: [{ title: "Access Assisted — Book" }] }),
  component: BookAssistedPage,
});

function localInputNow(): string {
  const d = new Date(Date.now() + 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function BookAssistedPage() {
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

  const [bookFor, setBookFor] = useState<"self" | "other">("self");
  const [travellerName, setTravellerName] = useState("");
  const [travellerPhone, setTravellerPhone] = useState("");
  const [relationship, setRelationship] = useState("");
  const [mode, setMode] = useState<"now" | "scheduled">("scheduled");
  const [scheduleLocal, setScheduleLocal] = useState("");
  const [pickupPt, setPickupPt] = useState<AddressPick | null>(null);
  const [destPt, setDestPt] = useState<AddressPick | null>(null);
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [durationMin, setDurationMin] = useState<number | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [companionCount, setCompanionCount] = useState<1 | 2 | 3 | 4>(1);
  const [assistance, setAssistance] = useState<AssistanceCode[]>([]);
  const [otherInstructions, setOtherInstructions] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

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
    if (!pickupPt || !destPt) {
      setDistanceKm(null);
      setDurationMin(null);
      return;
    }
    let cancelled = false;
    setEstimating(true);
    route({
      data: {
        originLat: pickupPt.lat,
        originLng: pickupPt.lng,
        destLat: destPt.lat,
        destLng: destPt.lng,
      },
    })
      .then((r) => {
        if (cancelled) return;
        setDistanceKm(r.distanceKm);
        setDurationMin(r.durationMin);
      })
      .catch((err: unknown) => {
        if (!cancelled) toast.error(err instanceof Error ? err.message : "Could not compute route");
      })
      .finally(() => !cancelled && setEstimating(false));
    return () => {
      cancelled = true;
    };
  }, [pickupPt, destPt, route]);

  const scheduleDate = mode === "scheduled" && scheduleLocal ? new Date(scheduleLocal) : null;
  const scheduleValid =
    mode === "now" ||
    (!!scheduleDate &&
      !Number.isNaN(scheduleDate.getTime()) &&
      scheduleDate.getTime() > Date.now() + 60_000);

  const hasAssistance = assistance.length > 0;
  const canSubmit =
    !!user &&
    pickupPt &&
    destPt &&
    distanceKm != null &&
    travellerName.trim().length > 0 &&
    companionCount >= 1 &&
    companionCount <= 4 &&
    hasAssistance &&
    scheduleValid &&
    !submitting;

  function toggleAssistance(code: AssistanceCode, on: boolean) {
    setAssistance((prev) =>
      on ? Array.from(new Set([...prev, code])) : prev.filter((c) => c !== code),
    );
  }

  async function onSubmit() {
    if (!canSubmit || !user || !pickupPt || !destPt || distanceKm == null) return;
    setSubmitting(true);
    try {
      const startAt =
        mode === "scheduled" && scheduleDate
          ? scheduleDate.toISOString()
          : new Date().toISOString();
      const { data: booking, error: bookingErr } = await supabase
        .from("service_bookings")
        .insert({
          booked_by_user_id: user.id,
          service_type: "assisted",
          journey_pattern: "one_way",
          status: "awaiting_quote",
          start_at: startAt,
          requested_companion_count: companionCount,
          passenger_notes: notes.trim() || null,
          estimated_total: null,
        })
        .select()
        .single();
      if (bookingErr) throw bookingErr;

      const { error: travErr } = await supabase.from("booking_travellers").insert({
        booking_id: booking.id,
        linked_user_id: bookFor === "self" ? user.id : null,
        full_name: travellerName.trim(),
        phone: travellerPhone.trim() || null,
        relationship_to_booker: bookFor === "self" ? "self" : relationship.trim() || null,
        is_primary: true,
      });
      if (travErr) throw travErr;

      const allCodes: AssistanceCode[] = otherInstructions.trim()
        ? Array.from(new Set([...assistance, "other" as AssistanceCode]))
        : assistance;
      const { error: asErr } = await supabase.from("booking_assistance_requirements").insert(
        allCodes.map((code) => ({
          booking_id: booking.id,
          requirement_code: code,
          quantity: 1,
          notes: code === "other" ? otherInstructions.trim() || null : null,
        })),
      );
      if (asErr) throw asErr;

      // Store pickup/destination as an itinerary item so admin can spin up the ride later.
      const { error: itinErr } = await supabase.from("booking_itinerary_items").insert({
        booking_id: booking.id,
        day_number: 1,
        sequence_number: 1,
        item_type: "ride",
        title: `${pickupPt.address} → ${destPt.address}`,
        planned_start_at: startAt,
        address: pickupPt.address,
        latitude: pickupPt.lat,
        longitude: pickupPt.lng,
        notes: JSON.stringify({
          destination: {
            address: destPt.address,
            lat: destPt.lat,
            lng: destPt.lng,
            placeId: destPt.placeId,
          },
          pickupPlaceId: pickupPt.placeId,
          distanceKm,
          durationMin,
          requestType: mode,
          scheduledAt: mode === "scheduled" && scheduleDate ? scheduleDate.toISOString() : null,
        }),
      });
      if (itinErr) throw itinErr;

      await supabase.from("service_booking_events").insert({
        booking_id: booking.id,
        actor_user_id: user.id,
        event_type: "booking_created",
        payload: { service_type: "assisted", companion_count: companionCount },
      });

      toast.success("Access Assisted booking submitted — awaiting quote");
      navigate({ to: "/app/passenger/bookings" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create booking");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell title="Access Assisted" nav={nav}>
      <div className="mb-3">
        <Link
          to="/app/passenger/book"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="mr-1 h-4 w-4" /> Back
        </Link>
      </div>

      <section className="rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)]">
        <h2 className="text-base font-semibold">Who is travelling?</h2>
        <RadioGroup
          value={bookFor}
          onValueChange={(v) => setBookFor(v as "self" | "other")}
          className="mt-3 grid grid-cols-2 gap-2"
        >
          <Label
            htmlFor="abf-self"
            className="flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm"
          >
            <RadioGroupItem id="abf-self" value="self" /> Myself
          </Label>
          <Label
            htmlFor="abf-other"
            className="flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm"
          >
            <RadioGroupItem id="abf-other" value="other" /> Someone else
          </Label>
        </RadioGroup>
        <div className="mt-3 grid gap-3">
          <div>
            <Label htmlFor="atrav-name">Traveller full name</Label>
            <Input
              id="atrav-name"
              value={travellerName}
              onChange={(e) => setTravellerName(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="atrav-phone">Traveller phone</Label>
            <Input
              id="atrav-phone"
              value={travellerPhone}
              onChange={(e) => setTravellerPhone(e.target.value)}
            />
          </div>
          {bookFor === "other" ? (
            <div>
              <Label htmlFor="atrav-rel">Relationship to traveller</Label>
              <Input
                id="atrav-rel"
                value={relationship}
                onChange={(e) => setRelationship(e.target.value)}
              />
            </div>
          ) : null}
        </div>
      </section>

      <section className="mt-3 rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)]">
        <h2 className="text-base font-semibold">When?</h2>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant={mode === "now" ? "default" : "outline"}
            onClick={() => setMode("now")}
          >
            As soon as possible
          </Button>
          <Button
            type="button"
            variant={mode === "scheduled" ? "default" : "outline"}
            onClick={() => setMode("scheduled")}
          >
            Schedule
          </Button>
        </div>
        {mode === "scheduled" ? (
          <div className="mt-3">
            <Label htmlFor="asched">Pickup time (Africa/Johannesburg)</Label>
            <Input
              id="asched"
              type="datetime-local"
              min={localInputNow()}
              value={scheduleLocal}
              onChange={(e) => setScheduleLocal(e.target.value)}
            />
          </div>
        ) : null}
      </section>

      <section className="mt-3 rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)]">
        <h2 className="text-base font-semibold">Pickup &amp; destination</h2>
        <div className="mt-3 space-y-3">
          <AddressAutocomplete
            id="apickup"
            label="Pickup"
            value={pickupPt}
            onChange={setPickupPt}
            enableCurrentLocation
          />
          <AddressAutocomplete
            id="adest"
            label="Destination"
            value={destPt}
            onChange={setDestPt}
            bias={pickupPt ? { lat: pickupPt.lat, lng: pickupPt.lng } : null}
          />
        </div>
        {pickupPt && destPt ? (
          <div className="mt-3 space-y-2">
            <RouteMap origin={pickupPt} destination={destPt} className="h-40" />
            <div className="flex items-center justify-between rounded-lg bg-secondary px-3 py-2 text-sm">
              <span className="text-muted-foreground">
                {estimating
                  ? "Estimating…"
                  : distanceKm != null
                    ? `${distanceKm.toFixed(2)} km${durationMin != null ? ` · ~${durationMin} min` : ""}`
                    : "—"}
              </span>
              <span className="font-semibold">Personalised quote</span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Specialised rates remain unpublished. Our team will calculate and send a personalised
              quote after reviewing the route and assistance requirements.
            </p>
          </div>
        ) : null}
      </section>

      <section className="mt-3 rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)]">
        <h2 className="text-base font-semibold">Companion support</h2>
        <p className="text-xs text-muted-foreground">
          How many trained companions should travel with you?
        </p>
        <div className="mt-3 grid grid-cols-4 gap-2">
          {[1, 2, 3, 4].map((n) => (
            <Button
              key={n}
              type="button"
              variant={companionCount === n ? "default" : "outline"}
              onClick={() => setCompanionCount(n as 1 | 2 | 3 | 4)}
            >
              {n}
            </Button>
          ))}
        </div>
      </section>

      <section className="mt-3 rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)]">
        <h2 className="text-base font-semibold">Assistance needed</h2>
        <p className="text-xs text-muted-foreground">Pick at least one.</p>
        <div className="mt-3 grid gap-2">
          {ASSISTANCE_OPTIONS.filter((o) => o.code !== "other").map((opt) => (
            <Label
              key={opt.code}
              htmlFor={`aa-${opt.code}`}
              className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm"
            >
              <Checkbox
                id={`aa-${opt.code}`}
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
          <Label htmlFor="other-support">Other support instructions (optional)</Label>
          <Textarea
            id="other-support"
            value={otherInstructions}
            onChange={(e) => setOtherInstructions(e.target.value)}
          />
        </div>
      </section>

      <section className="mt-3 rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)]">
        <Label htmlFor="anotes">Notes for the team (optional)</Label>
        <Textarea id="anotes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </section>

      <Button className="mt-4 w-full" size="lg" disabled={!canSubmit} onClick={onSubmit}>
        {submitting ? "Submitting…" : "Submit for quote"}
      </Button>
      {!hasAssistance ? (
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Pick at least one assistance type to continue.
        </p>
      ) : null}
    </AppShell>
  );
}
