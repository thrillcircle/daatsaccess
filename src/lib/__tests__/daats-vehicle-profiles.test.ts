import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../../supabase/migrations/20260908193000_daats_vehicle_profiles.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("DAATS vehicle profile baseline", () => {
  it("contains the four authoritative fleet registrations and VINs", () => {
    for (const value of [
      "JL 28 WV GP",
      "JY 61 SX GP",
      "KT 71 FY GP",
      "FN 34 DH GP",
      "WF03XXTTG3DE34671",
      "WF03XXTTG3ER02027",
      "WF03XXTTG3GS18878",
      "JN1UB4E26Z0008512",
    ]) {
      expect(migration).toContain(value);
    }
  });

  it("records the supplied capacity, accessibility, transmission and fuel facts", () => {
    expect(migration).toContain("Rear wheelchair ramp");
    expect(migration).toContain("Wheelchair spaces: 2");
    expect(migration).toContain("3 passenger seats + 1 driver seat");
    expect(migration).toContain("5 passenger seats + 1 driver seat");
    expect(migration).toContain("Transmission: 6-speed manual");
    expect(migration).toContain("Transmission: 5-speed manual");
    expect(migration).toContain("Fuel: Diesel");
    expect(migration).toContain("Fuel: Petrol");
  });

  it("does not turn historical registration-document dates into current compliance dates", () => {
    expect(migration).toContain("historical uploaded document; not current licence status");
    expect(migration).not.toContain("license_disc_expiry_date =");
    expect(migration).not.toContain("roadworthy_expiry_date =");
  });

  it("does not create or permanently seed a driver assignment", () => {
    expect(migration).toContain("Drivers are NOT seeded");
    expect(migration).toContain("vehicle_driver_assignments");
    expect(migration).not.toContain("INSERT INTO public.driver_profiles");
    expect(migration).not.toContain("INSERT INTO public.vehicle_driver_assignments");
    expect(migration).not.toContain("assigned_driver_id =");
  });

  it("preserves a newer odometer reading when the baseline is replayed", () => {
    expect(migration).toContain(
      "current_odometer_km = GREATEST(vehicle.current_odometer_km, seed.odometer_km)",
    );
  });
});
