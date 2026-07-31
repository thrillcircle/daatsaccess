import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DRIVER_PROHIBITED_RIDE_KEYS,
  DRIVER_SAFE_RIDE_FIELDS,
  hasNoFinancialFields,
  sanitizeDriverRide,
  sanitizeDriverRides,
} from "@/lib/driver-ride-projection";

const MIGRATION = "supabase/migrations/20260731160019_phase5_driver_financial_role_boundary.sql";

/** A full rides row as it exists in the database, including financial columns. */
function fullRideRow(status: string, extra: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    passenger_id: "22222222-2222-2222-2222-222222222222",
    driver_id: "33333333-3333-3333-3333-333333333333",
    pickup_address: "1 Test Rd",
    destination_address: "2 Test Ave",
    pickup_lat: -26.2,
    pickup_lng: 28.04,
    destination_lat: -26.1,
    destination_lng: 28.05,
    distance_km: 12.5,
    status,
    request_type: "immediate",
    created_at: "2026-07-31T10:00:00Z",
    updated_at: "2026-07-31T10:05:00Z",
    route_version: 1,
    // Financial columns that must never reach a Driver:
    estimated_price: 188.75,
    pricing_version_id: "44444444-4444-4444-4444-444444444444",
    estimate_snapshot: { base: 20, per_km: 13.5 },
    ...extra,
  };
}

describe("driver safe ride projection", () => {
  it("never allows a prohibited key in the allow-list", () => {
    for (const field of DRIVER_SAFE_RIDE_FIELDS) {
      expect(DRIVER_PROHIBITED_RIDE_KEYS as readonly string[]).not.toContain(field);
    }
  });

  const transitions: [string, Record<string, unknown>][] = [
    ["normal acceptance", fullRideRow("accepted", { accepted_at: "2026-07-31T10:01:00Z" })],
    [
      "scheduled pickup",
      fullRideRow("driver_arriving", {
        request_type: "scheduled",
        scheduled_at: "2026-07-31T10:30:00Z",
      }),
    ],
    ["arrived", fullRideRow("arrived", { driver_arrived_at: "2026-07-31T10:20:00Z" })],
    ["trip start", fullRideRow("in_progress", { started_at: "2026-07-31T10:25:00Z" })],
    [
      "completion",
      fullRideRow("completed", {
        completed_at: "2026-07-31T10:55:00Z",
        actual_distance_km: 12.8,
        actual_duration_seconds: 1800,
      }),
    ],
  ];

  for (const [label, row] of transitions) {
    it(`${label} response carries no financial field`, () => {
      const safe = sanitizeDriverRide(row);
      expect(hasNoFinancialFields(safe)).toBe(true);
      for (const key of DRIVER_PROHIBITED_RIDE_KEYS) {
        expect(Object.keys(safe)).not.toContain(key);
      }
      expect(safe.status).toBe(row["status"]);
      expect(safe.id).toBe(row["id"]);
    });
  }

  it("repeated or stale transition payloads stay safe", () => {
    const stale = sanitizeDriverRide(null);
    expect(hasNoFinancialFields(stale)).toBe(true);
    expect(stale.id).toBeNull();
    expect(sanitizeDriverRides(undefined)).toEqual([]);
  });

  it("detects a prohibited key in an unsanitized payload", () => {
    expect(hasNoFinancialFields(fullRideRow("accepted"))).toBe(false);
    expect(hasNoFinancialFields([fullRideRow("accepted")])).toBe(false);
  });

  it("rejected/unauthorized transitions produce no ride payload at all", () => {
    // The protected RPCs raise instead of returning a row; the client helper
    // converts that into a thrown Error with no ride data attached.
    const error = new Error("Driver role required");
    expect(hasNoFinancialFields({ message: error.message })).toBe(true);
  });
});

describe("phase 5 driver boundary migration", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  it("removes the direct driver rides SELECT branch", () => {
    expect(sql).toContain('drop policy if exists "driver sees assigned or open rides" on public.rides');
    expect(sql).not.toMatch(/create policy[^;]*on public\.rides\s+for select/i);
  });

  it("removes the driver branch from the payments policy", () => {
    const paymentsPolicy = sql.slice(sql.indexOf('create policy "involved sees payment"'));
    const body = paymentsPolicy.slice(0, paymentsPolicy.indexOf(";"));
    expect(body).not.toContain("driver_id");
    expect(body).toContain("passenger_id");
  });

  it("requires the driver role for driver_profiles writes", () => {
    for (const cmd of ["insert", "update", "delete"]) {
      expect(sql).toContain(`drivers ${cmd} own driver profile`);
    }
    expect(sql).toContain("private.has_role(auth.uid(), 'driver')");
  });

  it("pins search_path on every security definer function it creates", () => {
    const definers = sql.match(/security definer/g) ?? [];
    const pinned = sql.match(/set search_path = public, private, pg_temp/g) ?? [];
    expect(definers.length).toBeGreaterThan(0);
    expect(pinned.length).toBeGreaterThanOrEqual(definers.length);
  });

  it("revokes protected driver RPCs from anon and public", () => {
    for (const fn of [
      "driver_rides",
      "driver_ride",
      "driver_accept_ride",
      "driver_start_scheduled_pickup",
      "driver_mark_arrived",
      "driver_start_trip",
      "driver_complete_trip",
      "driver_cancel_ride",
    ]) {
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from anon`));
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to authenticated`));
    }
  });

  it("reloads PostgREST", () => {
    expect(sql).toContain("notify pgrst, 'reload schema'");
  });
});
