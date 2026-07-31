import { createServerFn } from "@tanstack/react-start";
import {
  autocomplete,
  geocode,
  placeDetails,
  route,
  type GeocodeResult,
  type PlaceSuggestion,
  type RouteEstimate,
} from "./maps.server";

export type { GeocodeResult, RouteEstimate, PlaceSuggestion };

export const geocodeAddress = createServerFn({ method: "POST" })
  .validator((input: { address: string }) => {
    if (!input || typeof input.address !== "string" || input.address.trim().length < 3) {
      throw new Error("Address is required");
    }
    return { address: input.address.trim().slice(0, 200) };
  })
  .handler(async ({ data }): Promise<GeocodeResult> => geocode(data.address));

export const computeRoute = createServerFn({ method: "POST" })
  .validator(
    (input: { originLat: number; originLng: number; destLat: number; destLng: number }) => {
      const nums = [input?.originLat, input?.originLng, input?.destLat, input?.destLng];
      if (nums.some((n) => typeof n !== "number" || Number.isNaN(n))) {
        throw new Error("Invalid coordinates");
      }
      return input;
    },
  )
  .handler(async ({ data }): Promise<RouteEstimate> => route(data));

export const searchAddresses = createServerFn({ method: "POST" })
  .validator((input: { query: string; lat?: number; lng?: number }) => {
    if (!input || typeof input.query !== "string" || input.query.trim().length < 3) {
      throw new Error("Query is required");
    }
    return {
      query: input.query.trim().slice(0, 200),
      lat: typeof input.lat === "number" ? input.lat : undefined,
      lng: typeof input.lng === "number" ? input.lng : undefined,
    };
  })
  .handler(async ({ data }): Promise<PlaceSuggestion[]> => autocomplete(data));

export const resolvePlace = createServerFn({ method: "POST" })
  .validator((input: { placeId: string }) => {
    if (!input || typeof input.placeId !== "string" || !input.placeId.trim()) {
      throw new Error("placeId is required");
    }
    return { placeId: input.placeId.trim().slice(0, 300) };
  })
  .handler(async ({ data }) => placeDetails(data.placeId));
