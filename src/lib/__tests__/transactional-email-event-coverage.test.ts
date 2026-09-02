import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../../supabase/migrations/20260902113000_transactional_email_event_coverage.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("transactional email event coverage", () => {
  it("keeps financial and paid booking records as required email", () => {
    for (const type of [
      "payment_received",
      "payment_failed",
      "refund_queued",
      "refund_processed",
      "cancellation_balance_due",
      "ride_cancelled",
      "payment_confirmed_trip_submitted",
    ]) {
      expect(migration).toContain(`'${type}'`);
    }
  });

  it("adds useful lifecycle email without emailing fast-moving arrival status", () => {
    for (const type of ["driver_accepted", "ride_edit_applied", "ride_completed"]) {
      expect(migration).toContain(`'${type}'`);
    }
    expect(migration).not.toContain("'operation_driver_arrived'");
  });

  it("does not duplicate an in-app notification when mirroring direct notification records", () => {
    expect(migration).toContain("NEW.status='delivered'");
    expect(migration).toContain("'transactional-notification:' || NEW.id::text");
    expect(migration).toContain("'delivered',\n    NEW.created_at");
  });

  it("keeps the mirror trigger and channel planner private", () => {
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION private.mirror_passenger_transactional_notification_to_outbox()",
    );
    expect(migration).toContain("REVOKE ALL ON FUNCTION private.plan_notification_channels()");
  });
});
