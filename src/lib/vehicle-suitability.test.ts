import { describe, expect, it } from "vitest";
import {
  rankVehiclesForTrip,
  scoreVehicleForTrip,
  type VehicleProfile,
} from "@/lib/vehicle-suitability";

function vehicle(overrides: Partial<VehicleProfile> = {}): VehicleProfile {
  return {
    admin_notes: null,
    assigned_driver_id: null,
    created_at: "2026-07-30T00:00:00.000Z",
    current_odometer_km: 1000,
    id: "00000000-0000-0000-0000-000000000001",
    insurance_expiry_date: null,
    last_service_date: null,
    last_service_km: null,
    license_disc_expiry_date: null,
    license_plate: "TEST 001 GP",
    make: "Toyota",
    model: "Corolla",
    next_service_due_km: null,
    passenger_capacity: 4,
    ramp_or_lift_available: false,
    roadworthy_expiry_date: null,
    service_interval_km: 10000,
    status: "active",
    updated_at: "2026-07-30T00:00:00.000Z",
    vehicle_name: "Test Vehicle",
    vehicle_type: "Sedan",
    vin_number: null,
    wheelchair_accessible: false,
    wheelchair_capacity: 0,
    year: 2024,
    ...overrides,
  };
}

describe("vehicle suitability", () => {
  it("warns when the vehicle is already assigned to another active trip", () => {
    const candidate = vehicle();
    const result = scoreVehicleForTrip(candidate, { passengerCount: 1 }, new Set([candidate.id]));

    expect(result.warnings.map((warning) => warning.label)).toContain(
      "Already assigned to another active trip",
    );
    expect(result.suitable).toBe(true);
  });

  it("does not mark a free vehicle as busy", () => {
    const candidate = vehicle();
    const result = scoreVehicleForTrip(candidate, { passengerCount: 1 }, new Set());

    expect(result.warnings.map((warning) => warning.label)).not.toContain(
      "Already assigned to another active trip",
    );
  });

  it("blocks out-of-service vehicles and insufficient capacity", () => {
    const result = scoreVehicleForTrip(
      vehicle({ status: "out_of_service", passenger_capacity: 1 }),
      { passengerCount: 2 },
    );

    expect(result.suitable).toBe(false);
    expect(result.blocking.map((reason) => reason.label)).toEqual(
      expect.arrayContaining(["Vehicle out of service", "Capacity 1 < 2 pax"]),
    );
  });

  it("ranks a free vehicle above an otherwise equal busy vehicle", () => {
    const free = vehicle({ id: "00000000-0000-0000-0000-000000000010" });
    const busy = vehicle({ id: "00000000-0000-0000-0000-000000000020" });

    const ranked = rankVehiclesForTrip([busy, free], { passengerCount: 1 }, new Set([busy.id]));

    expect(ranked[0].vehicle.id).toBe(free.id);
  });
});
