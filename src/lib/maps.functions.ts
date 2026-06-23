import { createServerFn } from "@tanstack/react-start";

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

export type GeocodeResult = {
  address: string;
  lat: number;
  lng: number;
};

export const geocodeAddress = createServerFn({ method: "POST" })
  .inputValidator((input: { address: string }) => {
    if (!input || typeof input.address !== "string" || input.address.trim().length < 3) {
      throw new Error("Address is required");
    }
    return { address: input.address.trim().slice(0, 200) };
  })
  .handler(async ({ data }): Promise<GeocodeResult> => {
    const url = `${GATEWAY_URL}/maps/api/geocode/json?address=${encodeURIComponent(
      data.address,
    )}&region=za`;
    const res = await fetch(url, { headers: gatewayHeaders() });
    if (!res.ok) throw new Error(`Geocoding failed (${res.status})`);
    const json = (await res.json()) as {
      status: string;
      results: Array<{
        formatted_address: string;
        geometry: { location: { lat: number; lng: number } };
      }>;
    };
    if (json.status !== "OK" || !json.results.length) {
      throw new Error("Address not found");
    }
    const r = json.results[0];
    return {
      address: r.formatted_address,
      lat: r.geometry.location.lat,
      lng: r.geometry.location.lng,
    };
  });

export type RouteEstimate = {
  distanceKm: number;
  durationMin: number;
};

export const computeRoute = createServerFn({ method: "POST" })
  .inputValidator(
    (input: {
      originLat: number;
      originLng: number;
      destLat: number;
      destLng: number;
    }) => {
      const nums = [input?.originLat, input?.originLng, input?.destLat, input?.destLng];
      if (nums.some((n) => typeof n !== "number" || Number.isNaN(n))) {
        throw new Error("Invalid coordinates");
      }
      return input;
    },
  )
  .handler(async ({ data }): Promise<RouteEstimate> => {
    const body = {
      origin: { location: { latLng: { latitude: data.originLat, longitude: data.originLng } } },
      destination: { location: { latLng: { latitude: data.destLat, longitude: data.destLng } } },
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
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Route compute failed (${res.status}): ${text.slice(0, 200)}`);
    }
    const json = (await res.json()) as {
      routes?: Array<{ distanceMeters: number; duration: string }>;
    };
    const route = json.routes?.[0];
    if (!route) throw new Error("No route found");
    const distanceKm = Math.round((route.distanceMeters / 1000) * 100) / 100;
    const durationSec = parseInt(String(route.duration).replace("s", ""), 10) || 0;
    return { distanceKm, durationMin: Math.round(durationSec / 60) };
  });
