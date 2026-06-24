import { describe, it, expect } from "vitest";
import { estimatePrice, BASE_FARE_ZAR, PER_KM_ZAR, formatZAR } from "@/lib/pricing";
import {
  isDriverTransitionAllowed,
  isPassengerTransitionAllowed,
  isTripEditable,
  isImmutableAfterCompletion,
  isValidScheduleTime,
} from "@/lib/ride-rules";

describe("pricing", () => {
  it("uses R20 base + R13.50 per km", () => {
    expect(BASE_FARE_ZAR).toBe(20);
    expect(PER_KM_ZAR).toBe(13.5);
  });

  it("computes fare = base + km * rate", () => {
    expect(estimatePrice(0)).toBe(20);
    expect(estimatePrice(1)).toBe(33.5);
    expect(estimatePrice(5)).toBe(87.5);
    expect(estimatePrice(10)).toBe(155);
  });

  it("rounds to 2 decimals", () => {
    expect(estimatePrice(0.333)).toBe(Math.round((20 + 0.333 * 13.5) * 100) / 100);
  });

  it("rejects negative or non-finite distance", () => {
    expect(() => estimatePrice(-1)).toThrow();
    expect(() => estimatePrice(Number.NaN)).toThrow();
    expect(() => estimatePrice(Number.POSITIVE_INFINITY)).toThrow();
  });

  it("formats ZAR currency", () => {
    expect(formatZAR(87.5)).toMatch(/87[.,]50/);
  });
});

describe("schedule-time validation", () => {
  const now = new Date("2026-06-24T12:00:00Z");

  it("rejects null / undefined / invalid", () => {
    expect(isValidScheduleTime(null, now)).toBe(false);
    expect(isValidScheduleTime(undefined, now)).toBe(false);
    expect(isValidScheduleTime("not-a-date", now)).toBe(false);
  });

  it("rejects past or near-now times", () => {
    expect(isValidScheduleTime(new Date(now.getTime() - 60_000), now)).toBe(false);
    expect(isValidScheduleTime(now, now)).toBe(false);
    expect(isValidScheduleTime(new Date(now.getTime() + 30_000), now)).toBe(false);
  });

  it("accepts a time at least 1 minute in the future", () => {
    expect(isValidScheduleTime(new Date(now.getTime() + 60_000), now)).toBe(true);
    expect(isValidScheduleTime(new Date(now.getTime() + 3_600_000), now)).toBe(true);
  });

  it("respects a custom lead time", () => {
    const t = new Date(now.getTime() + 5 * 60_000);
    expect(isValidScheduleTime(t, now, 10 * 60_000)).toBe(false);
    expect(isValidScheduleTime(t, now, 5 * 60_000)).toBe(true);
  });
});

describe("driver status transitions", () => {
  it("allows the canonical lifecycle", () => {
    expect(isDriverTransitionAllowed("requested", "accepted")).toBe(true);
    expect(isDriverTransitionAllowed("accepted", "driver_arriving")).toBe(true);
    expect(isDriverTransitionAllowed("driver_arriving", "arrived")).toBe(true);
    expect(isDriverTransitionAllowed("arrived", "in_progress")).toBe(true);
    expect(isDriverTransitionAllowed("in_progress", "completed")).toBe(true);
  });

  it("allows driver cancellation before in_progress", () => {
    expect(isDriverTransitionAllowed("accepted", "cancelled")).toBe(true);
    expect(isDriverTransitionAllowed("driver_arriving", "cancelled")).toBe(true);
    expect(isDriverTransitionAllowed("arrived", "cancelled")).toBe(true);
  });

  it("rejects skipping states", () => {
    expect(isDriverTransitionAllowed("requested", "completed")).toBe(false);
    expect(isDriverTransitionAllowed("requested", "in_progress")).toBe(false);
    expect(isDriverTransitionAllowed("accepted", "completed")).toBe(false);
  });

  it("rejects moving out of terminal states", () => {
    expect(isDriverTransitionAllowed("completed", "in_progress")).toBe(false);
    expect(isDriverTransitionAllowed("cancelled", "requested")).toBe(false);
  });

  it("rejects driver cancellation once in_progress", () => {
    expect(isDriverTransitionAllowed("in_progress", "cancelled")).toBe(false);
  });
});

describe("passenger status transitions", () => {
  it("allows cancel from any active status", () => {
    expect(isPassengerTransitionAllowed("requested", "cancelled")).toBe(true);
    expect(isPassengerTransitionAllowed("accepted", "cancelled")).toBe(true);
    expect(isPassengerTransitionAllowed("driver_arriving", "cancelled")).toBe(true);
    expect(isPassengerTransitionAllowed("in_progress", "cancelled")).toBe(true);
  });

  it("rejects any other transition", () => {
    expect(isPassengerTransitionAllowed("requested", "completed")).toBe(false);
    expect(isPassengerTransitionAllowed("in_progress", "completed")).toBe(false);
    expect(isPassengerTransitionAllowed("requested", "accepted")).toBe(false);
  });

  it("rejects cancelling a terminal ride", () => {
    expect(isPassengerTransitionAllowed("completed", "cancelled")).toBe(false);
    expect(isPassengerTransitionAllowed("cancelled", "cancelled")).toBe(false);
  });
});

describe("trip edit rules", () => {
  it("pickup is editable only before driver arrives", () => {
    expect(isTripEditable("requested", "pickup")).toBe(true);
    expect(isTripEditable("accepted", "pickup")).toBe(true);
    expect(isTripEditable("driver_arriving", "pickup")).toBe(true);
    expect(isTripEditable("arrived", "pickup")).toBe(false);
    expect(isTripEditable("in_progress", "pickup")).toBe(false);
  });

  it("destination is editable through in_progress", () => {
    expect(isTripEditable("requested", "destination")).toBe(true);
    expect(isTripEditable("arrived", "destination")).toBe(true);
    expect(isTripEditable("in_progress", "destination")).toBe(true);
  });

  it("nothing is editable after the trip is finished", () => {
    expect(isTripEditable("completed", "pickup")).toBe(false);
    expect(isTripEditable("completed", "destination")).toBe(false);
    expect(isTripEditable("cancelled", "pickup")).toBe(false);
    expect(isTripEditable("cancelled", "destination")).toBe(false);
  });
});

describe("completed-trip immutability", () => {
  it("treats completed and cancelled as immutable", () => {
    expect(isImmutableAfterCompletion("completed")).toBe(true);
    expect(isImmutableAfterCompletion("cancelled")).toBe(true);
  });

  it("treats active statuses as still mutable", () => {
    for (const s of [
      "requested",
      "accepted",
      "driver_arriving",
      "arrived",
      "in_progress",
    ] as const) {
      expect(isImmutableAfterCompletion(s)).toBe(false);
    }
  });
});
