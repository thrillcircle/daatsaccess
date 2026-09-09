import type { AddressPick } from "@/components/AddressAutocomplete";

export type PublicServiceCode = "transport" | "assisted" | "appointment" | "extended";

export type PublicTripDraft = {
  service: PublicServiceCode;
  pickup: AddressPick;
  destination: AddressPick;
  travelAt: string;
  distanceKm: number;
  durationMin: number | null;
  indicativeTransportPrice: number;
  createdAt: string;
};

export const PUBLIC_TRIP_DRAFT_KEY = "access_public_trip_draft";

export const PUBLIC_SERVICE_ROUTE: Record<PublicServiceCode, string> = {
  transport: "/app/passenger/book/transport",
  assisted: "/app/passenger/book/assisted",
  appointment: "/app/passenger/book/appointment",
  extended: "/app/passenger/book/extended",
};

export function savePublicTripDraft(draft: PublicTripDraft) {
  if (typeof window !== "undefined") {
    window.sessionStorage.setItem(PUBLIC_TRIP_DRAFT_KEY, JSON.stringify(draft));
  }
}

export function getPublicTripDestination(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.sessionStorage.getItem(PUBLIC_TRIP_DRAFT_KEY);
    if (!stored) return null;
    const draft = JSON.parse(stored) as Partial<PublicTripDraft>;
    return draft.service && draft.service in PUBLIC_SERVICE_ROUTE
      ? PUBLIC_SERVICE_ROUTE[draft.service as PublicServiceCode]
      : null;
  } catch {
    return null;
  }
}

export function getPublicTripDraft(service?: PublicServiceCode): PublicTripDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.sessionStorage.getItem(PUBLIC_TRIP_DRAFT_KEY);
    if (!stored) return null;
    const draft = JSON.parse(stored) as Partial<PublicTripDraft>;
    if (
      !draft.service ||
      !(draft.service in PUBLIC_SERVICE_ROUTE) ||
      (service && draft.service !== service) ||
      !draft.pickup ||
      !draft.destination ||
      !draft.travelAt ||
      typeof draft.distanceKm !== "number"
    ) {
      return null;
    }
    return draft as PublicTripDraft;
  } catch {
    return null;
  }
}

export function clearPublicTripDraft() {
  if (typeof window !== "undefined") {
    window.sessionStorage.removeItem(PUBLIC_TRIP_DRAFT_KEY);
  }
}
