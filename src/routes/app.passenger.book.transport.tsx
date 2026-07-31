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
import { useRouteEstimate } from "@/hooks/use-route-estimate";
import { formatZAR } from "@/lib/pricing";
import { pricingDb, rpcNullable } from "@/lib/pricing-api";
import { usePassengerPricingEstimate } from "@/hooks/use-passenger-pricing-estimate";
import { ASSISTANCE_OPTIONS, type AssistanceCode } from "@/lib/booking-types";
import { toast } from "sonner";
import { ChevronLeft } from "lucide-react";

export const Route = createFileRoute("/app/passenger/book/transport")({
  head: () => ({ meta: [{ title: "Access Transport — Book" }] }),
  component: BookTransportPage,
});

function localInputNow(): string {
  const d = new Date(Date.now() + 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function BookTransportPage() {
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
  const [mode, setMode] = useState<"now" | "scheduled">("now");
  const [scheduleLocal, setScheduleLocal] = useState("");
  const [pickupPt, setPickupPt] = useState<AddressPick | null>(null);
  const [destPt, setDestPt] = useState<AddressPick | null>(null);
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [durationMin, setDurationMin] = useState<number | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [assistance, setAssistance] = useState<AssistanceCode[]>([]);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Auto-fill self traveller name from profile.
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

  // Compute route.
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

  const {
    estimate: serverEstimate,
    loading: pricingLoading,
    error: pricingError,
  } = usePassengerPricingEstimate({
    serviceCode: "transport",
    distanceKm,
    effectiveAt: scheduleDate?.toISOString() ?? null,
  });
  const price = serverEstimate?.total ?? null;
  const canSubmit =
    !!user &&
    pickupPt &&
    destPt &&
    distanceKm != null &&
    price != null &&
    travellerName.trim().length > 0 &&
    scheduleValid &&
    !pricingLoading &&
    !pricingError &&
    !submitting;

  function toggleAssistance(code: AssistanceCode, on: boolean) {
    setAssistance((prev) =>
      on ? Array.from(new Set([...prev, code])) : prev.filter((c) => c !== code),
    );
  }

  async function onSubmit() {
    if (!canSubmit || !user || !pickupPt || !destPt || distanceKm == null || price == null) return;
    setSubmitting(true);
    try {
      const { error } = await pricingDb.rpc("passenger_create_transport_booking", {
        p_pickup_address: pickupPt.address,
        p_pickup_lat: pickupPt.lat,
        p_pickup_lng: pickupPt.lng,
        p_pickup_place_id: rpcNullable(pickupPt.placeId),
        p_destination_address: destPt.address,
        p_destination_lat: destPt.lat,
        p_destination_lng: destPt.lng,
        p_destination_place_id: rpcNullable(destPt.placeId),
        p_distance_km: distanceKm,
        p_duration_seconds: rpcNullable(durationMin != null ? Math.round(durationMin * 60) : null),
        p_request_type: mode,
        p_scheduled_at: rpcNullable(
          mode === "scheduled" && scheduleDate ? scheduleDate.toISOString() : null,
        ),
        p_traveller_is_self: bookFor === "self",
        p_traveller_name: travellerName.trim(),
        p_traveller_phone: travellerPhone.trim(),
        p_relationship: relationship.trim(),
        p_assistance_codes: assistance,
        p_passenger_notes: notes.trim(),
        p_idempotency_key: crypto.randomUUID(),
      });
      if (error) throw error;
      toast.success("Access Transport booked");
      navigate({ to: "/app/passenger/bookings" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create booking");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell title="Access Transport" nav={nav}>
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
            htmlFor="bf-self"
            className="flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm"
          >
            <RadioGroupItem id="bf-self" value="self" /> Myself
          </Label>
          <Label
            htmlFor="bf-other"
            className="flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm"
          >
            <RadioGroupItem id="bf-other" value="other" /> Someone else
          </Label>
        </RadioGroup>

        <div className="mt-3 grid gap-3">
          <div>
            <Label htmlFor="trav-name">Traveller full name</Label>
            <Input
              id="trav-name"
              value={travellerName}
              onChange={(e) => setTravellerName(e.target.value)}
              placeholder="Full name"
            />
          </div>
          <div>
            <Label htmlFor="trav-phone">Traveller phone</Label>
            <Input
              id="trav-phone"
              value={travellerPhone}
              onChange={(e) => setTravellerPhone(e.target.value)}
              placeholder="Optional"
            />
          </div>
          {bookFor === "other" ? (
            <div>
              <Label htmlFor="trav-rel">Relationship to traveller</Label>
              <Input
                id="trav-rel"
                value={relationship}
                onChange={(e) => setRelationship(e.target.value)}
                placeholder="e.g. mother, patient, friend"
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
            Now
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
            <Label htmlFor="sched">Pickup time (Africa/Johannesburg)</Label>
            <Input
              id="sched"
              type="datetime-local"
              min={localInputNow()}
              value={scheduleLocal}
              onChange={(e) => setScheduleLocal(e.target.value)}
            />
            {scheduleLocal && !scheduleValid ? (
              <p className="mt-1 text-xs text-destructive">
                Pick a time at least one minute in the future.
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="mt-3 rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)]">
        <h2 className="text-base font-semibold">Pickup &amp; destination</h2>
        <div className="mt-3 space-y-3">
          <AddressAutocomplete
            id="pickup"
            label="Pickup"
            value={pickupPt}
            onChange={setPickupPt}
            enableCurrentLocation
          />
          <AddressAutocomplete
            id="dest"
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
                {estimating || pricingLoading
                  ? "Estimating…"
                  : distanceKm != null
                    ? `${distanceKm.toFixed(2)} km${durationMin != null ? ` · ~${durationMin} min` : ""}`
                    : "—"}
              </span>
              <span className="font-semibold">{price != null ? formatZAR(price) : "—"}</span>
            </div>
            {pricingError ? <p className="text-xs text-destructive">{pricingError}</p> : null}
          </div>
        ) : null}
      </section>

      <section className="mt-3 rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)]">
        <h2 className="text-base font-semibold">Accessibility requirements</h2>
        <p className="text-xs text-muted-foreground">
          Pick everything that applies — we share only what the driver needs.
        </p>
        <div className="mt-3 grid gap-2">
          {ASSISTANCE_OPTIONS.map((opt) => (
            <Label
              key={opt.code}
              htmlFor={`a-${opt.code}`}
              className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm"
            >
              <Checkbox
                id={`a-${opt.code}`}
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
      </section>

      <section className="mt-3 rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)]">
        <Label htmlFor="notes">Notes for the driver (optional)</Label>
        <Textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything else the driver should know."
        />
      </section>

      <Button className="mt-4 w-full" size="lg" disabled={!canSubmit} onClick={onSubmit}>
        {submitting ? "Booking…" : "Confirm booking"}
      </Button>
    </AppShell>
  );
}
