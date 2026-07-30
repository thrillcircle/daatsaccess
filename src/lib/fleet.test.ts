import { describe, expect, it } from "vitest";
import {
  documentState,
  isAssignmentEffective,
  normalizeRegistration,
  serviceState,
  vehicleDocumentSummary,
  type CanonicalVehicle,
  type VehicleAssignment,
} from "@/lib/fleet";

function vehicle(overrides: Partial<CanonicalVehicle> = {}): CanonicalVehicle {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    vehicle_name: "Access One",
    vehicle_type: "Van",
    make: "Toyota",
    model: "Quantum",
    year: 2025,
    license_plate: "AA 11 BB GP",
    license_plate_normalized: "AA11BBGP",
    vin_number: null,
    wheelchair_accessible: true,
    ramp_or_lift_available: true,
    passenger_capacity: 8,
    wheelchair_capacity: 2,
    accessibility_features: [],
    assigned_driver_id: null,
    current_odometer_km: 9_000,
    last_service_km: 0,
    next_service_due_km: 10_000,
    service_interval_km: 10_000,
    last_service_date: null,
    roadworthy_expiry_date: null,
    license_disc_expiry_date: null,
    insurance_expiry_date: null,
    status: "active",
    admin_notes: null,
    legacy_consolidation_status: "canonical",
    created_at: "2026-07-30T00:00:00.000Z",
    updated_at: "2026-07-30T00:00:00.000Z",
    ...overrides,
  };
}

function assignment(overrides: Partial<VehicleAssignment> = {}): VehicleAssignment {
  return {
    id: "00000000-0000-0000-0000-000000000010",
    vehicle_id: "00000000-0000-0000-0000-000000000001",
    driver_id: "00000000-0000-0000-0000-000000000020",
    assignment_type: "primary",
    status: "active",
    start_at: "2026-07-30T08:00:00.000Z",
    end_at: null,
    assigned_by: null,
    ended_by: null,
    assignment_reason: null,
    notes: null,
    source: "admin",
    created_at: "2026-07-30T08:00:00.000Z",
    updated_at: "2026-07-30T08:00:00.000Z",
    ...overrides,
  };
}

describe("fleet domain", () => {
  it("normalises registrations across spaces, punctuation and case", () => {
    expect(normalizeRegistration(" aa-11 bb gp ")).toBe("AA11BBGP");
    expect(normalizeRegistration("AA 11 BB GP")).toBe("AA11BBGP");
  });

  it("resolves scheduled or active assignments by effective time", () => {
    const at = new Date("2026-07-30T12:00:00.000Z");

    expect(isAssignmentEffective(assignment(), at)).toBe(true);
    expect(isAssignmentEffective(assignment({ end_at: "2026-07-30T10:00:00.000Z" }), at)).toBe(
      false,
    );
    expect(isAssignmentEffective(assignment({ status: "scheduled" }), at)).toBe(true);
    expect(
      isAssignmentEffective(
        assignment({ status: "scheduled", start_at: "2026-07-31T08:00:00.000Z" }),
        at,
      ),
    ).toBe(false);
    expect(isAssignmentEffective(assignment({ status: "cancelled" }), at)).toBe(false);
  });

  it("classifies missing, expiring and expired documents", () => {
    const now = new Date("2026-07-30T10:00:00.000Z");
    expect(documentState(null, now)).toBe("missing");
    expect(documentState("2026-07-20", now)).toBe("expired");
    expect(documentState("2026-08-15", now)).toBe("expiring");
    expect(documentState("2027-01-01", now)).toBe("valid");
  });

  it("uses current document rows before legacy expiry columns", () => {
    const summary = vehicleDocumentSummary(
      vehicle({
        roadworthy_expiry_date: "2026-07-01",
        license_disc_expiry_date: "2027-01-01",
        insurance_expiry_date: "2027-01-01",
      }),
      [
        {
          id: "d1",
          vehicle_id: "00000000-0000-0000-0000-000000000001",
          document_type: "roadworthy",
          document_number: null,
          issued_at: null,
          expires_at: "2027-02-01",
          storage_path: null,
          status: "current",
          is_current: true,
          uploaded_by: null,
          created_at: "2026-07-30T00:00:00.000Z",
          updated_at: "2026-07-30T00:00:00.000Z",
        },
      ],
      new Date("2026-07-30T10:00:00.000Z"),
    );

    expect(summary.roadworthy).toBe("valid");
    expect(summary.license_disc).toBe("valid");
    expect(summary.insurance).toBe("valid");
  });

  it("calculates service due states from canonical odometer data", () => {
    expect(serviceState(vehicle({ current_odometer_km: 8_000 }))).toBe("current");
    expect(serviceState(vehicle({ current_odometer_km: 9_500 }))).toBe("due_soon");
    expect(serviceState(vehicle({ current_odometer_km: 10_000 }))).toBe("overdue");
    expect(
      serviceState(
        vehicle({ next_service_due_km: null, last_service_km: null, service_interval_km: 0 }),
      ),
    ).toBe("unknown");
  });
});
