from pathlib import Path


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one match, found {count}: {old[:120]!r}")
    path.write_text(text.replace(old, new, 1))


def replace_count(path: Path, old: str, new: str, expected: int) -> None:
    text = path.read_text()
    count = text.count(old)
    if count != expected:
        raise RuntimeError(f"{path}: expected {expected} matches, found {count}: {old!r}")
    path.write_text(text.replace(old, new))


def replace_between(path: Path, start: str, end: str, replacement: str) -> None:
    text = path.read_text()
    start_index = text.find(start)
    if start_index < 0:
        raise RuntimeError(f"{path}: start marker not found: {start!r}")
    end_index = text.find(end, start_index)
    if end_index < 0:
        raise RuntimeError(f"{path}: end marker not found: {end!r}")
    path.write_text(text[:start_index] + replacement + text[end_index:])


api = Path("src/lib/pricing-api.ts")
replace_once(api, "type PricingDatabase = {", "export type PricingDatabase = {")
replace_count(api, "p_pickup_place_id: string;", "p_pickup_place_id: string | null;", 2)
replace_count(api, "p_destination_place_id: string;", "p_destination_place_id: string | null;", 2)
replace_count(api, "p_duration_seconds: number;", "p_duration_seconds: number | null;", 3)
replace_count(api, "p_scheduled_at: string;", "p_scheduled_at: string | null;", 2)
replace_once(api, "p_pickup: JsonValue;", "p_pickup: JsonValue | null;")
replace_once(api, "p_destination: JsonValue;", "p_destination: JsonValue | null;")

ride = Path("src/routes/app.passenger.index.tsx")
replace_once(
    ride,
    'import { estimatePrice, formatZAR } from "@/lib/pricing";',
    'import { formatZAR } from "@/lib/pricing";\nimport { pricingDb } from "@/lib/pricing-api";\nimport { usePassengerPricingEstimate } from "@/hooks/use-passenger-pricing-estimate";',
)
replace_once(
    ride,
    "  const price = distanceKm != null ? estimatePrice(distanceKm) : null;\n  const canRequest = !!(pickupPt && destPt && distanceKm != null) && scheduleValid;",
    '''  const { estimate: serverEstimate, loading: pricingLoading, error: pricingError } =
    usePassengerPricingEstimate({
      serviceCode: "ride",
      distanceKm,
      effectiveAt: scheduleDate?.toISOString() ?? null,
    });
  const price = serverEstimate?.total ?? null;
  const canRequest = !!(pickupPt && destPt && distanceKm != null && price != null) && scheduleValid;''',
)
replace_between(
    ride,
    '      const { data, error } = await supabase\n        .from("rides")',
    '      if (inserted.request_type === "scheduled") {',
    '''      const { data, error } = await pricingDb.rpc("passenger_create_priced_ride", {
        p_pickup_address: pickupPt.address,
        p_pickup_lat: pickupPt.lat,
        p_pickup_lng: pickupPt.lng,
        p_pickup_place_id: pickupPt.placeId ?? null,
        p_destination_address: destPt.address,
        p_destination_lat: destPt.lat,
        p_destination_lng: destPt.lng,
        p_destination_place_id: destPt.placeId ?? null,
        p_distance_km: distanceKm,
        p_duration_seconds: durationMin != null ? Math.round(durationMin * 60) : null,
        p_request_type: mode,
        p_scheduled_at:
          mode === "scheduled" && scheduleDate ? scheduleDate.toISOString() : null,
        p_idempotency_key: crypto.randomUUID(),
      });
      if (error) throw error;
      const result = data as unknown as { ride?: Ride };
      if (!result.ride) throw new Error("The pricing service did not create the ride");
      const inserted = result.ride;
''',
)
replace_once(ride, "{estimating\n                ? \"Estimating…\"", "{estimating || pricingLoading\n                ? \"Estimating…\"")
replace_once(
    ride,
    '<span className="font-semibold">{price != null ? formatZAR(price) : "—"}</span>\n          </div>\n          <Button',
    '''<span className="font-semibold">{price != null ? formatZAR(price) : "—"}</span>
          </div>
          {pricingError ? <p className="text-xs text-destructive">{pricingError}</p> : null}
          <Button''',
)
replace_once(
    ride,
    "disabled={!canRequest || submitting || estimating}",
    "disabled={!canRequest || submitting || estimating || pricingLoading}",
)

transport = Path("src/routes/app.passenger.book.transport.tsx")
replace_once(
    transport,
    'import { estimatePrice, formatZAR } from "@/lib/pricing";',
    'import { formatZAR } from "@/lib/pricing";\nimport { pricingDb } from "@/lib/pricing-api";\nimport { usePassengerPricingEstimate } from "@/hooks/use-passenger-pricing-estimate";',
)
replace_once(
    transport,
    "  const price = distanceKm != null ? estimatePrice(distanceKm) : null;",
    '''  const { estimate: serverEstimate, loading: pricingLoading, error: pricingError } =
    usePassengerPricingEstimate({
      serviceCode: "transport",
      distanceKm,
      effectiveAt: scheduleDate?.toISOString() ?? null,
    });
  const price = serverEstimate?.total ?? null;''',
)
replace_once(
    transport,
    "    scheduleValid &&\n    !submitting;",
    "    scheduleValid &&\n    !pricingLoading &&\n    !pricingError &&\n    !submitting;",
)
replace_between(
    transport,
    "      const startAt = mode === \"scheduled\" && scheduleDate ? scheduleDate.toISOString() : new Date().toISOString();",
    '      toast.success("Access Transport booked");',
    '''      const { error } = await pricingDb.rpc("passenger_create_transport_booking", {
        p_pickup_address: pickupPt.address,
        p_pickup_lat: pickupPt.lat,
        p_pickup_lng: pickupPt.lng,
        p_pickup_place_id: pickupPt.placeId ?? null,
        p_destination_address: destPt.address,
        p_destination_lat: destPt.lat,
        p_destination_lng: destPt.lng,
        p_destination_place_id: destPt.placeId ?? null,
        p_distance_km: distanceKm,
        p_duration_seconds: durationMin != null ? Math.round(durationMin * 60) : null,
        p_request_type: mode,
        p_scheduled_at:
          mode === "scheduled" && scheduleDate ? scheduleDate.toISOString() : null,
        p_traveller_is_self: bookFor === "self",
        p_traveller_name: travellerName.trim(),
        p_traveller_phone: travellerPhone.trim(),
        p_relationship: relationship.trim(),
        p_assistance_codes: assistance,
        p_passenger_notes: notes.trim(),
        p_idempotency_key: crypto.randomUUID(),
      });
      if (error) throw error;
''',
)
replace_once(
    transport,
    '{estimating ? "Estimating…" : distanceKm != null',
    '{estimating || pricingLoading ? "Estimating…" : distanceKm != null',
)
replace_once(
    transport,
    '<span className="font-semibold">{price != null ? formatZAR(price) : "—"}</span>\n            </div>',
    '''<span className="font-semibold">{price != null ? formatZAR(price) : "—"}</span>
            </div>
            {pricingError ? <p className="text-xs text-destructive">{pricingError}</p> : null}''',
)

for path in (ride, transport):
    text = path.read_text()
    if "estimatePrice(" in text:
        raise RuntimeError(f"{path}: legacy browser pricing remains")

if '.from("rides")\n        .insert' in ride.read_text():
    raise RuntimeError("Ride page still inserts directly into rides")
if '.from("service_bookings")\n        .insert' in transport.read_text() or '.from("rides")\n        .insert' in transport.read_text():
    raise RuntimeError("Transport page still performs direct authoritative inserts")

print("Phase 4 authoritative estimate integration applied")
