// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
  clearPublicTripDraft,
  getPublicTripDestination,
  getPublicTripDraft,
  savePublicTripDraft,
  type PublicTripDraft,
} from "@/lib/public-trip-estimate";

const draft: PublicTripDraft = {
  service: "transport",
  pickup: { address: "Birch Acres", placeId: "pickup", lat: -26.064, lng: 28.211 },
  destination: { address: "Johannesburg", placeId: "destination", lat: -26.204, lng: 28.047 },
  travelAt: "2026-09-10T09:00",
  distanceKm: 31.2,
  durationMin: 42,
  indicativeTransportPrice: 441.2,
  createdAt: "2026-09-09T07:00:00.000Z",
};

describe("public trip handoff", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("restores the exact guest trip for the selected booking service", () => {
    savePublicTripDraft(draft);

    expect(getPublicTripDestination()).toBe("/app/passenger/book/transport");
    expect(getPublicTripDraft("transport")).toEqual(draft);
    expect(getPublicTripDraft("assisted")).toBeNull();
  });

  it("clears the draft only after the booking is submitted", () => {
    savePublicTripDraft(draft);
    clearPublicTripDraft();

    expect(getPublicTripDraft()).toBeNull();
    expect(getPublicTripDestination()).toBeNull();
  });
});
