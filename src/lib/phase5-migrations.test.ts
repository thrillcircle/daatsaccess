import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = (name: string) =>
  readFileSync(resolve(process.cwd(), "supabase/migrations", name), "utf8");
const source = (name: string) => readFileSync(resolve(process.cwd(), name), "utf8");

const foundation = migration("20260731130000_phase5_operations_foundation.sql");
const dispatch = migration("20260731131000_phase5_planning_dispatch.sql");
const reliability = migration("20260731132000_phase5_reliability_scheduler.sql");

const migrationFiles = readdirSync(resolve(process.cwd(), "supabase/migrations"))
  .filter((name) => name.endsWith(".sql"))
  .sort();
const closeoutName = migrationFiles.find((name) =>
  name.includes("phase5_passenger_timeline_avatar_closeout"),
);
const closeout = closeoutName ? migration(closeoutName) : "";

describe("Phase 5 passenger timeline closeout", () => {
  it("ships a named closeout migration that is the final timeline definition", () => {
    expect(closeoutName).toBeTruthy();
    const timelineMigrations = migrationFiles.filter((name) =>
      migration(name).includes("FUNCTION public.passenger_operation_timeline("),
    );
    expect(timelineMigrations.at(-1)).toBe(closeoutName);
  });

  it("reads profiles.avatar_url and never profile.profile_photo_url", () => {
    expect(closeout).toContain("'profile_photo_url', profile.avatar_url");
    expect(closeout).not.toContain("profile.profile_photo_url");
  });

  it("keeps ownership checks and excludes internal data", () => {
    expect(closeout).toContain("Passenger role required");
    expect(closeout).toContain("Booking not found for this passenger");
    expect(closeout).toContain("Ride not found for this passenger");
    expect(closeout).toContain("run.passenger_id = v_actor");
    expect(closeout).toContain("passenger_visible_summary");
    for (const internal of [
      "internal_notes",
      "quoted_total",
      "margin_amount",
      "operational_alerts",
      "driver_location_history",
    ]) {
      expect(closeout).not.toContain(internal);
    }
  });

  it("revokes anonymous execution and reloads PostgREST", () => {
    expect(closeout).toContain(
      "REVOKE ALL ON FUNCTION public.passenger_operation_timeline(uuid,uuid) FROM PUBLIC, anon",
    );
    expect(closeout).toContain("NOTIFY pgrst, 'reload schema'");
  });
});

describe("Phase 5 database contracts", () => {
  it("creates one canonical run per active source and overlap-safe assignments", () => {
    expect(foundation).toContain("operation_runs_one_active_source_idx");
    expect(foundation).toContain("operation_assignments_driver_no_overlap");
    expect(foundation).toContain("operation_assignments_vehicle_no_overlap");
    expect(foundation).toContain("operation_assignments_companion_no_overlap");
  });

  it("preserves verification records outside live dispatch", () => {
    expect(foundation).toContain("PHASE 4 VERIFICATION RECORD");
    expect(dispatch).toContain("Verification records cannot be dispatched");
    expect(dispatch).toContain("Verification records cannot be published for live dispatch");
  });

  it("uses protected planning and dispatch operations", () => {
    for (const functionName of [
      "admin_plan_service_booking",
      "admin_validate_operation_plan",
      "admin_publish_operation_plan",
      "admin_assign_operation_resource",
      "admin_dispatch_operation",
      "driver_accept_dispatch_offer",
      "driver_acknowledge_operation",
      "driver_transition_operation",
    ]) {
      expect(dispatch).toContain(`CREATE OR REPLACE FUNCTION public.${functionName}`);
    }
    expect(dispatch).toContain("FOR UPDATE");
    expect(dispatch).toContain("Another Driver accepted first");
  });

  it("moves driver location behind a protected, rate-limited operation", () => {
    expect(dispatch).toContain("CREATE OR REPLACE FUNCTION public.driver_update_location");
    expect(dispatch).toContain("rate_limited");
    expect(dispatch).toContain(
      "Location updates require online status or an active near-term operation",
    );
  });

  it("keeps passengers on safe operation projections", () => {
    expect(dispatch).toContain("CREATE OR REPLACE FUNCTION public.passenger_operation_timeline");
    expect(dispatch).toContain("passenger_visible_summary");
    expect(dispatch).not.toContain("quoted_total");
    expect(dispatch).not.toContain("margin_amount");
  });

  it("uses a retryable and deduplicated notification outbox", () => {
    expect(foundation).toContain("notification_outbox");
    expect(foundation).toContain("deduplication_key text NOT NULL UNIQUE");
    expect(reliability).toContain("operations_deliver_notification_outbox");
    expect(reliability).toContain("FOR UPDATE SKIP LOCKED");
    expect(reliability).toContain("attempt_count");
  });

  it("keeps scheduler replay independent of pg_cron availability", () => {
    expect(reliability).toContain("to_regnamespace('cron')");
    expect(reliability).toContain("operations_scheduler_tick");
    expect(reliability).toContain("admin_run_operations_scheduler");
  });

  it("revokes internal helpers from ordinary clients", () => {
    expect(dispatch).toContain("REVOKE ALL ON FUNCTION private.operations_add_event");
    expect(reliability).toContain(
      "REVOKE ALL ON FUNCTION public.operations_scheduler_tick(text,text) FROM PUBLIC, anon, authenticated",
    );
    expect(foundation).toContain("REVOKE INSERT, UPDATE, DELETE ON");
  });

  it("keeps validated search inputs optional for generic navigation", () => {
    for (const route of [
      "src/routes/app.support.tsx",
      "src/routes/app.admin.vehicle-profiles.tsx",
      "src/routes/app.admin.maintenance.tsx",
      "src/routes/app.admin.driver-assignments.tsx",
      "src/routes/app.admin.drivers.tsx",
      "src/routes/app.admin.index.tsx",
      "src/routes/app.admin.trip-history.tsx",
      "src/routes/app.admin.support.tsx",
      "src/routes/app.admin.trips.tsx",
      "src/routes/app.admin.passengers.tsx",
    ]) {
      expect(source(route)).toContain("SearchSchemaInput");
    }
  });
});
