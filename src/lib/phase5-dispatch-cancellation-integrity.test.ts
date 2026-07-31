import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = source(
  "supabase/migrations/20260731184500_phase5_dispatch_cancellation_integrity.sql",
);
const dispatchMigration = source("supabase/migrations/20260731131000_phase5_planning_dispatch.sql");
const driverFunctions = source("src/lib/ride-driver.functions.ts");
const driverReads = source("src/lib/driver-rides.ts");
const activeRide = source("src/components/driver/DriverActiveRide.tsx");
const operationsPanel = source("src/components/operations/DriverOperationsPanel.tsx");
const generatedTypes = source("src/integrations/supabase/types.ts");

function functionSection(sql: string, name: string) {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}`;
  const start = sql.indexOf(marker);
  expect(start, `${name} must exist`).toBeGreaterThanOrEqual(0);
  const rest = sql.slice(start + marker.length);
  const next = rest.search(/\nCREATE OR REPLACE FUNCTION /);
  return next === -1 ? sql.slice(start) : sql.slice(start, start + marker.length + next);
}

describe("Phase 5 dispatch and cancellation integrity closeout", () => {
  it("drops and revokes both legacy Driver ride-id mutation RPCs", () => {
    expect(migration).toContain("DROP FUNCTION IF EXISTS public.driver_accept_ride(uuid)");
    expect(migration).toContain("DROP FUNCTION IF EXISTS public.driver_cancel_ride(uuid)");
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.driver_accept_ride(uuid) FROM PUBLIC, anon, authenticated",
    );
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.driver_cancel_ride(uuid) FROM PUBLIC, anon, authenticated",
    );
  });

  it("removes every runtime source call to the legacy claim and cancel paths", () => {
    const runtime = [driverFunctions, driverReads, activeRide, operationsPanel].join("\n");
    expect(runtime).not.toContain("driver_accept_ride");
    expect(runtime).not.toContain("acceptRide");
    expect(runtime).not.toContain("driver_cancel_ride");
    expect(runtime).not.toContain("cancelDriverRide");
    expect(generatedTypes).not.toContain("driver_accept_ride:");
    expect(generatedTypes).not.toContain("driver_cancel_ride:");
  });

  it("keeps dispatch-offer acceptance as the sole immediate acceptance path", () => {
    expect(operationsPanel).toContain('rpc("driver_accept_dispatch_offer"');
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.driver_accept_dispatch_offer(uuid, integer, text)",
    );
    const acceptance = functionSection(dispatchMigration, "driver_accept_dispatch_offer");
    for (const contract of [
      "FOR UPDATE",
      "driver_user_id",
      "expires_at",
      "Another Driver accepted first",
      "operation_run_assignments",
      "dispatch_offer_events",
    ]) {
      expect(acceptance).toContain(contract);
    }
  });

  it("removes the generic Driver cancellation UI and preserves operational alternatives", () => {
    expect(activeRide).not.toContain("onClick={cancel}");
    expect(activeRide).not.toMatch(/>\s*Cancel\s*</);
    expect(activeRide).toContain("operational decline, no-show, incident");
    expect(operationsPanel).toContain('rpc("driver_decline_operation"');
    expect(operationsPanel).toContain('rpc("driver_report_no_show"');
    expect(operationsPanel).toContain('rpc("driver_report_incident"');
  });

  it("keeps Admin cancellation inside the operation state machine", () => {
    const cancellation = functionSection(dispatchMigration, "admin_cancel_operation");
    for (const contract of [
      "FOR UPDATE",
      "operation_runs",
      "operation_run_assignments",
      "dispatch_offers",
      "private.operations_add_event",
      "private.operations_enqueue_notification",
      "rides",
    ]) {
      expect(cancellation).toContain(contract);
    }
  });

  it("inlines Driver ownership and removes authenticated access to the private helper", () => {
    expect(migration).toContain("ride.driver_id = auth.uid()");
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION private.is_ride_driver(uuid,uuid) FROM PUBLIC, anon, authenticated",
    );
    expect(migration).toContain("DROP FUNCTION IF EXISTS private.is_ride_driver(uuid, uuid)");
    const policyDefinitions = migration.slice(
      migration.indexOf('DROP POLICY IF EXISTS "participants read status events"'),
      migration.indexOf("DO $closeout$", migration.indexOf("assigned driver acks change log")),
    );
    expect(policyDefinitions).not.toContain("private.is_ride_driver");
  });

  it("preserves Driver financial exclusion and reloads PostgREST", () => {
    expect(driverReads).toContain('supabase.rpc("driver_rides"');
    expect(driverReads).toContain('supabase.rpc("driver_ride"');
    for (const financial of [
      "estimated_price",
      "pricing_version_id",
      "estimate_snapshot",
      "deposit_amount",
      "payment",
    ]) {
      expect(driverReads).not.toContain(financial);
      expect(activeRide).not.toContain(financial);
    }
    expect(migration).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
