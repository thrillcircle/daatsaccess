import { describe, expect, it } from "vitest";
import {
  calculatePricing,
  CONFIRMED_RIDE_COMPONENTS,
  roundZAR,
  type PricingComponentDefinition,
} from "@/lib/pricing-engine";

const component = (
  component_code: string,
  calculation_type: PricingComponentDefinition["calculation_type"],
  amount: number,
  calculation_order: number,
  minimum_quantity = 0,
  customer_visible = true,
): PricingComponentDefinition => ({
  component_code,
  customer_label: component_code.replaceAll("_", " "),
  calculation_type,
  amount,
  minimum_quantity,
  calculation_order,
  customer_visible,
  is_active: true,
});

describe("Phase 4 deterministic pricing", () => {
  it("keeps the confirmed zero-distance Ride fare at R20", () => {
    expect(calculatePricing("ride", CONFIRMED_RIDE_COMPONENTS, { distance_km: 0 }).total).toBe(20);
  });

  it("keeps the confirmed 10 km Ride fare at R155", () => {
    expect(calculatePricing("ride", CONFIRMED_RIDE_COMPONENTS, { distance_km: 10 }).total).toBe(
      155,
    );
  });

  it("rounds decimal distance deterministically to cents", () => {
    expect(
      calculatePricing("transport", CONFIRMED_RIDE_COMPONENTS, { distance_km: 1.234 }).total,
    ).toBe(36.66);
  });

  it("applies companion minimum hours", () => {
    const result = calculatePricing(
      "assisted",
      [...CONFIRMED_RIDE_COMPONENTS, component("companion_hours", "per_hour", 120, 40, 2)],
      { distance_km: 10, companion_hours: 0.5 },
    );
    expect(result.lines.find((line) => line.componentCode === "companion_hours")?.quantity).toBe(2);
    expect(result.total).toBe(395);
  });

  it("calculates appointment waiting time", () => {
    const result = calculatePricing(
      "appointment",
      [
        ...CONFIRMED_RIDE_COMPONENTS,
        component("companion_hours", "per_hour", 120, 40, 2),
        component("waiting_hours", "per_hour", 100, 50),
      ],
      { distance_km: 10, companion_hours: 2, waiting_hours: 1.5 },
    );
    expect(result.total).toBe(545);
  });

  it("calculates daily and overnight extended-journey quantities", () => {
    const result = calculatePricing(
      "extended_journey",
      [
        ...CONFIRMED_RIDE_COMPONENTS,
        component("vehicle_days", "per_day", 1200, 70),
        component("driver_days", "per_day", 900, 80),
        component("driver_overnights", "flat", 450, 90),
        component("companion_days", "per_day", 800, 100),
      ],
      { distance_km: 10, journey_days: 2, driver_overnights: 1, companion_days: 2 },
    );
    expect(result.total).toBe(6405);
  });

  it("applies percentage components after preceding components", () => {
    const result = calculatePricing(
      "assisted",
      [
        ...CONFIRMED_RIDE_COMPONENTS,
        component("companion_hours", "per_hour", 120, 40, 2),
        component("platform_margin", "percentage", 15, 110, 0, false),
      ],
      { distance_km: 10, companion_hours: 2 },
    );
    expect(result.subtotal).toBe(395);
    expect(result.marginAmount).toBe(59.25);
    expect(result.total).toBe(454.25);
  });

  it("returns structured missing-input warnings", () => {
    const result = calculatePricing("appointment", CONFIRMED_RIDE_COMPONENTS, {});
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        "Route distance is required",
        "Companion hours are required",
        "Waiting duration is required",
      ]),
    );
  });

  it("rounds half cents consistently", () => {
    expect(roundZAR(10.005)).toBe(10.01);
    expect(roundZAR(10.004)).toBe(10);
  });

  it("does not include disabled components", () => {
    const disabled = { ...component("specialist_vehicle", "flat", 150, 60), is_active: false };
    const result = calculatePricing("transport", [...CONFIRMED_RIDE_COMPONENTS, disabled], {
      distance_km: 10,
      specialist_vehicle_required: true,
    });
    expect(result.total).toBe(155);
  });
});
