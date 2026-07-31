import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const migration = source(
  "supabase/migrations/20260731202338_1be35fbb-80eb-4913-8d9c-04082fe5aeed.sql",
);
const workflows = source("src/lib/passenger-ride-workflows.ts");
const passengerHome = source("src/routes/app.passenger.index.tsx");
const types = source("src/integrations/supabase/types.ts");

describe("Phase 5 passenger operation workflows", () => {
  it("ships both protected passenger workflows", () => {
    expect(migration).toContain("FUNCTION public.passenger_cancel_ride");
    expect(migration).toContain("FUNCTION public.passenger_reschedule_ride");
    expect(types).toContain("passenger_cancel_ride:");
    expect(types).toContain("passenger_reschedule_ride:");
  });

  it("keeps the legacy driver ride-id RPCs retired", () => {
    expect(types).not.toContain("driver_accept_ride:");
    expect(types).not.toContain("driver_cancel_ride:");
  });

  it("forces passengers through the workflows instead of direct ride writes", () => {
    expect(migration).toContain("Use the protected cancellation workflow to cancel this trip");
    expect(migration).toContain("Use the protected rescheduling workflow to change this trip time");
    expect(migration).toContain("access.ride_workflow");
  });

  it("scopes execution to authenticated callers only", () => {
    for (const fn of ["passenger_cancel_ride", "passenger_reschedule_ride"]) {
      expect(migration).toMatch(
        new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon`, "i"),
      );
      expect(migration).toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO authenticated`, "i"),
      );
    }
    expect(migration).toMatch(/NOTIFY pgrst, 'reload schema'/i);
  });

  it("passes an idempotency key from the client wrappers", () => {
    expect(workflows).toContain('supabase.rpc("passenger_cancel_ride"');
    expect(workflows).toContain('supabase.rpc("passenger_reschedule_ride"');
    expect(workflows).toContain("p_idempotency_key");
  });

  it("removes direct passenger ride mutations from the passenger home route", () => {
    expect(passengerHome).toContain("cancelPassengerRide");
    expect(passengerHome).not.toMatch(/from\("rides"\)\s*\n?\s*\.update\(/);
  });
});
