import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const paymentCard = readFileSync(
  join(process.cwd(), "src/components/payments/PassengerPaymentCard.tsx"),
  "utf8",
);
const automaticCheckout = readFileSync(
  join(process.cwd(), "src/components/payments/AutomaticPayfastCheckout.tsx"),
  "utf8",
);
const passengerPayments = readFileSync(
  join(process.cwd(), "src/components/profile/PassengerPaymentsCard.tsx"),
  "utf8",
);
const adminPaymentSummary = readFileSync(
  join(process.cwd(), "src/components/admin/AdminTripPaymentSummary.tsx"),
  "utf8",
);
const checkoutHelper = readFileSync(join(process.cwd(), "src/lib/payfast-checkout.ts"), "utf8");
const tripPage = readFileSync(join(process.cwd(), "src/routes/app.trip.$rideId.tsx"), "utf8");
const createPayment = readFileSync(
  join(process.cwd(), "supabase/functions/payfast-create-payment/index.ts"),
  "utf8",
);
const submissionMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260901190100_phase7_automatic_payfast_submission.sql"),
  "utf8",
);
const editMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260901190200_phase7_paid_trip_edits.sql"),
  "utf8",
);

describe("Phase 7 automatic passenger PayFast UX", () => {
  it("submits only server references and idempotency keys to the payment initializer", () => {
    expect(checkoutHelper).toContain("ride_id: rideId");
    expect(checkoutHelper).toContain("ride_change_request_id: changeRequestId");
    expect(checkoutHelper).toContain('idempotency_key: getIdempotencyKey("ride", rideId)');
    expect(checkoutHelper).not.toMatch(/amount\s*:/i);
    expect(checkoutHelper).not.toMatch(/price\s*:/i);
  });

  it("posts signed checkout fields only to official PayFast endpoints", () => {
    expect(checkoutHelper).toContain("https://sandbox.payfast.co.za/eng/process");
    expect(checkoutHelper).toContain("https://www.payfast.co.za/eng/process");
    expect(checkoutHelper).toContain("ALLOWED_PAYFAST_CHECKOUTS.has(checkoutUrl)");
    expect(checkoutHelper).toContain('form.method = "POST"');
    expect(checkoutHelper).toContain("form.submit()");
  });

  it("keeps unpaid new trips internal until trusted PayFast confirmation", () => {
    expect(submissionMigration).toContain("'payment_pending'::public.ride_status");
    expect(submissionMigration).toContain("submitted_at");
    expect(submissionMigration).toContain('CREATE POLICY "admin sees submitted rides"');
    expect(submissionMigration).toContain("AND submitted_at IS NOT NULL");
    expect(submissionMigration).toContain(
      "DROP TRIGGER IF EXISTS rides_payment_before_acceptance_trigger",
    );
    expect(submissionMigration).toContain(
      "DROP FUNCTION IF EXISTS private.enforce_payment_before_ride_acceptance",
    );
  });

  it("promotes a paid draft to Requested only from the confirmed payment trigger", () => {
    expect(submissionMigration).toContain(
      "CREATE OR REPLACE FUNCTION private.submit_paid_pending_ride",
    );
    expect(submissionMigration).toContain("NEW.status <> 'paid'");
    expect(submissionMigration).toContain("upper(COALESCE(NEW.provider_status, '')) <> 'COMPLETE'");
    expect(submissionMigration).toContain("NEW.paid_at IS NULL");
    expect(submissionMigration).toContain("SET status = 'requested'::public.ride_status");
    expect(submissionMigration).toContain("submitted_at = now()");
  });

  it("opens PayFast automatically for unpaid rides and staged fare-increasing edits", () => {
    expect(automaticCheckout).toContain('next.status !== "payment_pending"');
    expect(automaticCheckout).toContain("void launchRide(ride)");
    expect(automaticCheckout).toContain('next.status !== "awaiting_payment"');
    expect(automaticCheckout).toContain("void launchEdit(edit)");
    expect(automaticCheckout).toContain("fallback poll");
    expect(automaticCheckout).toContain("Opening PayFast");
  });

  it("returns PayFast to the exact trip and waits for trusted ITN confirmation", () => {
    expect(createPayment).toContain(
      "const returnUrl = `${appUrl}/app/trip/${intent.ride_id}?${returnQuery}`",
    );
    expect(createPayment).toContain(
      "const cancelUrl = `${appUrl}/app/trip/${intent.ride_id}?${cancelQuery}`",
    );
    expect(paymentCard).toContain('returnState !== "success" || payment?.status === "paid"');
    expect(paymentCard).toContain("confirming the payment securely from the");
    expect(paymentCard).toContain("window.setInterval");
    expect(paymentCard).toContain('payment?.status === "paid"');
  });

  it("stages fare-increasing edits and applies them only after a confirmed PayFast adjustment", () => {
    expect(editMigration).toContain("CREATE TABLE IF NOT EXISTS public.ride_change_requests");
    expect(editMigration).toContain(
      "v_amount_due := greatest(v_proposed_total - v_previous_total, 0)",
    );
    expect(editMigration).toContain(
      "CASE WHEN v_amount_due > 0.01 THEN 'awaiting_payment' ELSE 'applying' END",
    );
    expect(editMigration).toContain("CREATE OR REPLACE FUNCTION public.create_ride_change_payment");
    expect(editMigration).toContain("CREATE OR REPLACE FUNCTION private.apply_paid_trip_edit");
    expect(editMigration).toContain("PERFORM private.apply_ride_change_request(v_request.id)");
  });

  it("keeps admin payment information read-only instead of making it an admin gate", () => {
    expect(adminPaymentSummary).toContain('roles?.includes("admin")');
    expect(adminPaymentSummary).toContain(
      "if (rolesLoading || !isAdmin || loading || !payment) return null",
    );
    expect(adminPaymentSummary).toContain("Paid with PayFast");
    expect(adminPaymentSummary).not.toContain("Awaiting passenger payment");
    expect(adminPaymentSummary).not.toContain("acceptance remains locked");
    expect(tripPage).toContain("<AdminTripPaymentSummary rideId={ride.id} />");
  });

  it("shows PayFast and recent payment records in the passenger profile", () => {
    expect(passengerPayments).toContain("Access uses PayFast for secure trip payments.");
    expect(passengerPayments).toContain("Recent payments");
    expect(passengerPayments).toContain("Trip edit payment");
    expect(passengerPayments).toContain("not stored in your Access profile");
  });
});
