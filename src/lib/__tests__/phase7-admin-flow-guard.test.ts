import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const adminTrips = readFileSync(join(process.cwd(), "src/routes/app.admin.trips.tsx"), "utf8");
const submissionMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260901190100_phase7_automatic_payfast_submission.sql"),
  "utf8",
);

describe("Phase 7 admin flow guard", () => {
  it("never lets unpaid internal drafts enter the admin trip queue", () => {
    expect(submissionMigration).toContain('CREATE POLICY "admin sees submitted rides"');
    expect(submissionMigration).toContain("AND submitted_at IS NOT NULL");
    expect(submissionMigration).toContain("SET status = 'requested'::public.ride_status");
  });

  it("does not expose manual payment mutation controls to admin", () => {
    expect(adminTrips).not.toContain("onUpdatePayment");
    expect(adminTrips).not.toContain("Payment status");
    expect(adminTrips).not.toContain("Payment marked");
  });
});
