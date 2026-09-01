import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  canAdminCancel,
  canPassengerCancel,
  computeCancellationCharge,
  lockedRatesFromSnapshot,
} from "@/lib/cancellation";
import { parseRideStops } from "@/lib/driver-ride-projection";
import { mapsNavUrl } from "@/components/driver/driver-utils";
import { DRIVER_SAFE_RIDE_FIELDS } from "@/lib/driver-ride-projection";

const MIGRATIONS_DIR = join(process.cwd(), "supabase/migrations");
const allSql = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8"))
  .join("\n");

const snapshot = {
  lines: [
    { calculation_type: "flat", unit_price: 35, line_total: 35, calculation_order: 1 },
    { calculation_type: "per_km", unit_price: 12.5, line_total: 125, calculation_order: 2 },
  ],
};

describe("cancellation policy", () => {
  it("lets a passenger cancel only before admin acceptance", () => {
    expect(canPassengerCancel("requested")).toBe(true);
    for (const s of ["accepted", "driver_arriving", "arrived", "in_progress", "completed"] as const) {
      expect(canPassengerCancel(s)).toBe(false);
    }
  });

  it("lets an admin cancel any non-terminal trip", () => {
    for (const s of ["requested", "accepted", "driver_arriving", "arrived", "in_progress"] as const) {
      expect(canAdminCancel(s)).toBe(true);
    }
    expect(canAdminCancel("completed")).toBe(false);
    expect(canAdminCancel("cancelled")).toBe(false);
  });

  it("charges R0 for driver, vehicle, accident and operational failures", () => {
    for (const c of ["driver_failure", "accident", "vehicle_fault", "operational"] as const) {
      expect(computeCancellationCharge(c, 12, { perKmRate: 12.5, serviceFee: 35 }).total).toBe(0);
    }
  });

  it("charges distance travelled at the locked rate plus the locked service fee", () => {
    const rates = lockedRatesFromSnapshot(snapshot);
    expect(rates).toEqual({ perKmRate: 12.5, serviceFee: 35 });
    const charge = computeCancellationCharge("passenger_requested", 4, rates);
    expect(charge.total).toBe(85);
  });

  it("never invents pricing when the trip has no snapshot", () => {
    expect(lockedRatesFromSnapshot(null)).toEqual({ perKmRate: 0, serviceFee: 0 });
  });
});

describe("multi-stop trips", () => {
  const raw = [
    { sequence: 2, address: "C", lat: -26.1, lng: 28.1 },
    { sequence: 0, address: "A", lat: -26.2, lng: 28.2 },
    { sequence: 1, address: "B", lat: -26.3, lng: 28.3 },
  ];

  it("preserves stop order by sequence", () => {
    expect(parseRideStops(raw).map((s) => s.address)).toEqual(["A", "B", "C"]);
  });

  it("caps stops at five", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      sequence: i,
      address: `S${i}`,
      lat: -26,
      lng: 28,
    }));
    expect(parseRideStops(many)).toHaveLength(5);
  });

  it("drops invalid stops", () => {
    expect(parseRideStops([{ address: "", lat: 1, lng: 2 }, { address: "ok" }])).toEqual([]);
  });

  it("includes stops as ordered Google Maps waypoints", () => {
    const url = mapsNavUrl(-26.9, 28.9, [
      { lat: -26.1, lng: 28.1 },
      { lat: -26.2, lng: 28.2 },
    ]);
    expect(url).toContain("destination=-26.9,28.9");
    expect(decodeURIComponent(url)).toContain("waypoints=-26.1,28.1|-26.2,28.2");
  });

  it("exposes stops to drivers without any financial field", () => {
    expect(DRIVER_SAFE_RIDE_FIELDS).toContain("route_stops");
    for (const banned of ["estimated_price", "final_price", "payment_status", "commission"]) {
      expect(DRIVER_SAFE_RIDE_FIELDS).not.toContain(banned);
    }
  });
});

describe("database repairs", () => {
  it("ships the driver lifecycle, cancellation and route-stop migrations", () => {
    expect(allSql).toContain("driver_mark_arrived");
    expect(allSql).toContain("admin_cancel_ride");
    expect(allSql).toContain("ride_cancellation_charges");
    expect(allSql).toContain("route_stops");
  });

  it("keeps protected functions away from PUBLIC and anon", () => {
    expect(allSql).toMatch(/revoke\s+all\s+on\s+function\s+public\.admin_cancel_ride[\s\S]*?from\s+public/i);
  });

  it("guards stale route updates with route_version", () => {
    expect(allSql).toContain("p_expected_route_version");
  });
});
