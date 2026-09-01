import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const adminTrips = readFileSync(join(process.cwd(), "src/routes/app.admin.trips.tsx"), "utf8");

describe("Phase 7 admin payment-before-acceptance UX", () => {
  it("loads the PayFast references required for admin review", () => {
    expect(adminTrips).toContain("provider_status");
    expect(adminTrips).toContain("merchant_payment_id");
    expect(adminTrips).toContain("provider_payment_id");
    expect(adminTrips).toContain("paid_at");
    expect(adminTrips).toContain("pricing_version_id");
    expect(adminTrips).toContain("purpose");
  });

  it("uses the same confirmation conditions as the database acceptance gate", () => {
    expect(adminTrips).toContain('payment.purpose === "trip_fare"');
    expect(adminTrips).toContain('payment.provider === "payfast"');
    expect(adminTrips).toContain('payment.status === "paid"');
    expect(adminTrips).toContain('payment.provider_status?.toUpperCase() === "COMPLETE"');
    expect(adminTrips).toContain("!!payment.paid_at");
    expect(adminTrips).toContain(
      "Math.abs(Number(payment.amount) - Number(ride.estimated_price)) <= 0.01",
    );
    expect(adminTrips).toContain("payment.pricing_version_id === ride.pricing_version_id");
  });

  it("shows both references before acceptance and makes payment status read-only", () => {
    expect(adminTrips).toContain("Payment confirmation");
    expect(adminTrips).toContain("PayFast payment confirmed");
    expect(adminTrips).toContain("Access reference");
    expect(adminTrips).toContain("PayFast reference");
    expect(adminTrips).toContain("Admin acceptance is unlocked");
    expect(adminTrips).not.toContain("onUpdatePayment");
    expect(adminTrips).not.toContain("Payment marked ${selectedPayment}");
  });

  it("disables requested-trip acceptance and assignment until payment is confirmed", () => {
    expect(adminTrips).toContain("ACCEPTANCE_TARGETS.has(selectedStatus)");
    expect(adminTrips).toContain("acceptanceBlocked");
    expect(adminTrips).toContain('(ride.status === "requested" && !paymentConfirmed)');
    expect(adminTrips).toContain(
      "PayFast payment must be confirmed before this trip can be accepted",
    );
    expect(adminTrips).toContain("Locked until the passenger payment is confirmed by PayFast.");
  });

  it("refreshes the admin trip payment state when the ITN changes payments", () => {
    expect(adminTrips).toContain('channel("admin-trip-payment-confirmations")');
    expect(adminTrips).toContain('table: "payments"');
    expect(adminTrips).toContain("setReloadKey((key) => key + 1)");
  });
});