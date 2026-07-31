import { describe, expect, it } from "vitest";
import { locationFreshness, nextDriverActions, operationStatusVariant } from "./operations";

describe("Phase 5 operation helpers", () => {
  it("classifies driver location freshness deterministically", () => {
    const now = Date.parse("2026-07-31T12:00:00Z");
    expect(locationFreshness("2026-07-31T11:58:00Z", now).state).toBe("fresh");
    expect(locationFreshness("2026-07-31T11:50:00Z", now).state).toBe("delayed");
    expect(locationFreshness("2026-07-31T11:30:00Z", now).state).toBe("stale");
    expect(locationFreshness(null, now).state).toBe("unavailable");
  });

  it("exposes only valid driver-side transitions", () => {
    expect(nextDriverActions("driver_en_route")).toEqual(["driver_arrived", "interrupted"]);
    expect(nextDriverActions("completed")).toEqual([]);
    expect(nextDriverActions("driver_arrived")).toContain("passenger_no_show");
  });

  it("marks terminal operational failures as destructive", () => {
    expect(operationStatusVariant("failed")).toBe("destructive");
    expect(operationStatusVariant("completed")).toBe("default");
  });
});
