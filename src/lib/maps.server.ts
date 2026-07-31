/**
 * Server-only Google Maps helpers. Every call goes through the Lovable
 * connector gateway using GOOGLE_MAPS_API_KEY (server key) — this module is
 * never bundled into the browser, so the server key is never exposed.
 */

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_maps";

function gatewayHeaders(extra: Record<string, string> = {}) {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const mapsKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!lovableKey || !mapsKey) throw new Error("Google Maps connector not configured");
  return {
    Authorization: `Bearer ${lovableKey}`,
    "X-Connection-Api-Key": mapsKey,
    ...extra,
  };
}

async function assertOk(res: Response, label: string) {
  if (res.ok) return;
  const body = await res.text();
  if (res.status === 403) {
    let reason: string | undefined;
    try {
      const parsed = JSON.parse(body) as {
        error?: { details?: Array<{ reason?: string }> };
      };
      reason = parsed.error?.details?.find((d) => d.reason)?.reason;
    } catch {
      /* non-JSON body */
    }
    if (reason === "API_KEY_HTTP_REFERRER_BLOCKED") {
      throw new Error(
        'Google Maps server key is referrer-restricted. In Google Cloud Console, set the server key\'s application restrictions to "None" or "IP addresses".',
      );
    }
    if (reason === "API_KEY_SERVICE_BLOCKED") {
      throw new Error(
        "Google Maps server key does not allow this API. In Google Cloud Console, add it to the server key's allowed-APIs list.",
      );
    }
  }
  throw new Error(`${label} failed (${res.status}): ${body.slice(0, 200)}`);
}

export type GeocodeResult = { address: string; lat: number; lng: number };

export async function geocode(address: string): Promise<GeocodeResult> {
  const url = `${GATEWAY_URL}/maps/api/geocode/json?address=${encodeURIComponent(
    address,
  )}&region=za`;
  const res = await fetch(url, { headers: gatewayHeaders() });
  await assertOk(res, "Geocoding");
  const json = (await res.json()) as {
    status: string;
    results: Array<{
      formatted_address: string;
      geometry: { location: { lat: number; lng: number } };
    }>;
  };
  if (json.status !== "OK" || !json.results.length) throw new Error("Address not found");
  const r = json.results[0];
  return {
    address: r.formatted_address,
    lat: r.geometry.location.lat,
    lng: r.geometry.location.lng,
  };
}

export type RouteEstimate = { distanceKm: number; durationMin: number };

export async function route(input: {
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
}): Promise<RouteEstimate> {
  const body = {
    origin: { location: { latLng: { latitude: input.originLat, longitude: input.originLng } } },
    destination: { location: { latLng: { latitude: input.destLat, longitude: input.destLng } } },
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_UNAWARE",
  };
  const res = await fetch(`${GATEWAY_URL}/routes/directions/v2:computeRoutes`, {
    method: "POST",
    headers: gatewayHeaders({
      "Content-Type": "application/json",
      "X-Goog-FieldMask": "routes.distanceMeters,routes.duration",
    }),
    body: JSON.stringify(body),
  });
  await assertOk(res, "Route compute");
  const json = (await res.json()) as {
    routes?: Array<{ distanceMeters: number; duration: string }>;
  };
  const first = json.routes?.[0];
  if (!first) throw new Error("No route found");
  const distanceKm = Math.round((first.distanceMeters / 1000) * 100) / 100;
  const durationSec = parseInt(String(first.duration).replace("s", ""), 10) || 0;
  return { distanceKm, durationMin: Math.round(durationSec / 60) };
}

export type PlaceSuggestion = {
  placeId: string;
  primary: string;
  secondary: string;
};

/** Server-side Places API (New) autocomplete — fallback when the browser key is blocked. */
export async function autocomplete(input: {
  query: string;
  lat?: number;
  lng?: number;
}): Promise<PlaceSuggestion[]> {
  const body: Record<string, unknown> = {
    input: input.query,
    includedRegionCodes: ["za"],
    languageCode: "en",
  };
  if (typeof input.lat === "number" && typeof input.lng === "number") {
    body.locationBias = {
      circle: { center: { latitude: input.lat, longitude: input.lng }, radius: 30000 },
    };
  }
  const res = await fetch(`${GATEWAY_URL}/places/v1/places:autocomplete`, {
    method: "POST",
    headers: gatewayHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  await assertOk(res, "Places autocomplete");
  const json = (await res.json()) as {
    suggestions?: Array<{
      placePrediction?: {
        placeId: string;
        structuredFormat?: {
          mainText?: { text: string };
          secondaryText?: { text: string };
        };
        text?: { text: string };
      };
    }>;
  };
  return (json.suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .map((p) => ({
      placeId: p.placeId,
      primary: p.structuredFormat?.mainText?.text ?? p.text?.text ?? "",
      secondary: p.structuredFormat?.secondaryText?.text ?? "",
    }));
}

/** Server-side Place Details — resolves a placeId to address + coordinates. */
export async function placeDetails(placeId: string): Promise<GeocodeResult & { placeId: string }> {
  const res = await fetch(`${GATEWAY_URL}/places/v1/places/${encodeURIComponent(placeId)}`, {
    headers: gatewayHeaders({ "X-Goog-FieldMask": "id,formattedAddress,location" }),
  });
  await assertOk(res, "Place details");
  const json = (await res.json()) as {
    id?: string;
    formattedAddress?: string;
    location?: { latitude: number; longitude: number };
  };
  if (!json.location) throw new Error("Place has no coordinates");
  return {
    placeId: json.id ?? placeId,
    address: json.formattedAddress ?? "",
    lat: json.location.latitude,
    lng: json.location.longitude,
  };
}
