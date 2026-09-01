import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260901211500_phase7_commercial_readiness_closeout.sql",
  ),
  "utf8",
);
const rpcViews = readFileSync(
  join(process.cwd(), "supabase/migrations/20260901211600_phase7_commercial_rpc_views.sql"),
  "utf8",
);
const refundFunction = readFileSync(
  join(process.cwd(), "supabase/functions/payfast-refund/index.ts"),
  "utf8",
);
const passengerPayment = readFileSync(
  join(process.cwd(), "src/components/payments/PassengerPaymentCard.tsx"),
  "utf8",
);
const adminCancel = readFileSync(
  join(process.cwd(), "src/components/admin/AdminCancelTripDialog.tsx"),
  "utf8",
);
const safetyButton = readFileSync(
  join(process.cwd(), "src/components/safety/SafetySOSButton.tsx"),
  "utf8",
);
const driverRide = readFileSync(
  join(process.cwd(), "src/components/driver/DriverActiveRide.tsx"),
  "utf8",
);
const adminShell = readFileSync(join(process.cwd(), "src/components/AdminShell.tsx"), "utf8");
const support = readFileSync(join(process.cwd(), "src/lib/support.ts"), "utf8");
const caseControls = readFileSync(
  join(process.cwd(), "src/components/support/AdminSupportCaseMetadata.tsx"),
  "utf8",
);
const commercialLib = readFileSync(join(process.cwd(), "src/lib/phase7-commercial.ts"), "utf8");

describe("Phase 7 commercial readiness closeout", () => {
  it("nets prepaid fare before refunding or charging a cancellation balance", () => {
    expect(migration).toContain("queue_cancellation_settlement");
    expect(migration).toContain(
      "v_refund_target := GREATEST(round(v_prepaid - COALESCE(NEW.total_amount,0), 2), 0)",
    );
    expect(migration).toContain("v_amount := round(GREATEST(v_charge.total_amount-v_prepaid,0),2)");
    expect(migration).toContain("settlement_type = 'cancellation_settlement'");
    expect(adminCancel).toContain("processAutomaticRefunds");
    expect(passengerPayment).toContain("PassengerCancellationSettlement");
    expect(passengerPayment).toContain("Prepaid fare applied");
    expect(passengerPayment).toContain("Refund status");
  });

  it("protects refund mutation and uses PayFast server-side processing", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.prepare_payment_refund");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.finalize_payment_refund");
    expect(migration).toMatch(/finalize_payment_refund[\s\S]*FROM PUBLIC, anon, authenticated/i);
    expect(migration).toMatch(/finalize_payment_refund[\s\S]*TO service_role/i);
    expect(refundFunction).toContain("prepare_payment_refund");
    expect(refundFunction).toContain("finalize_payment_refund");
    expect(refundFunction).toContain("PAYFAST");
    expect(refundFunction).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(refundFunction).not.toContain("body.amount");
  });

  it("creates participant-only SOS reporting with admin response controls", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.safety_incidents");
    expect(migration).toContain("report_safety_incident");
    expect(migration).toContain("You are not an active participant on this trip");
    expect(migration).toContain("admin_update_safety_incident");
    expect(safetyButton).toContain("press");
    expect(driverRide).toContain("SafetySOSButton");
    expect(adminShell).toContain('label: "Safety & SOS"');
  });

  it("extends the existing notification outbox instead of replacing it", () => {
    expect(migration).toContain("notification_channel_deliveries");
    expect(migration).toContain("notification_outbox_id");
    expect(migration).toContain("plan_notification_channels");
    expect(migration).toContain("External notification provider readiness");
    expect(migration).not.toMatch(/api[_-]?key/i);
  });

  it("records POPIA policy acceptance and privacy requests", () => {
    expect(migration).toContain("policy_documents");
    expect(migration).toContain("policy_acceptances");
    expect(migration).toContain("privacy_requests");
    expect(migration).toContain("user_accept_policy");
    expect(migration).toContain("user_submit_privacy_request");
    expect(commercialLib).toContain("getComplianceSnapshot");
    expect(commercialLib).toContain("adminUpdatePrivacyRequest");
  });

  it("extends Support for disputes without creating a second support system", () => {
    expect(migration).toContain("ALTER TABLE public.support_tickets");
    expect(migration).toContain("payment_dispute");
    expect(migration).toContain("cancellation_dispute");
    expect(migration).toContain("support_admin_update_case_metadata");
    expect(support).toContain('"payment_dispute"');
    expect(support).toContain('"cancellation_dispute"');
    expect(caseControls).toContain("Case assessment");
    expect(caseControls).toContain("Decision amount");
  });

  it("keeps driver payout data admin-only and out of the driver UI", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.driver_payouts");
    expect(migration).toContain('CREATE POLICY "admins only read driver payouts"');
    expect(migration).toContain(
      "REVOKE INSERT,UPDATE,DELETE ON public.driver_payouts FROM authenticated",
    );
    expect(driverRide).not.toMatch(/payout|earnings|commission|payment amount|fare amount/i);
  });

  it("adds commercial monitoring without exposing it outside admin RPCs", () => {
    expect(migration).toContain("admin_commercial_snapshot");
    expect(migration).toContain("Administrator access required");
    expect(adminShell).toContain('label: "Commercial Readiness"');
    expect(rpcViews).toContain("admin_list_payment_refunds");
    expect(rpcViews).toContain("list_ride_refunds");
  });
});
