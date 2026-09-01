import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const paymentCard = readFileSync(
  join(process.cwd(), "src/components/payments/PassengerPaymentCard.tsx"),
  "utf8",
);
const adminPaymentSummary = readFileSync(
  join(process.cwd(), "src/components/admin/AdminTripPaymentSummary.tsx"),
  "utf8",
);
const tripPage = readFileSync(join(process.cwd(), "src/routes/app.trip.$rideId.tsx"), "utf8");
const createPayment = readFileSync(
  join(process.cwd(), "supabase/functions/payfast-create-payment/index.ts"),
  "utf8",
);

describe("Phase 7 passenger PayFast UX", () => {
  it("submits only the ride reference and idempotency key to the payment initializer", () => {
    const invocationStart = paymentCard.indexOf(
      'supabase.functions.invoke("payfast-create-payment"',
    );
    const invocationEnd = paymentCard.indexOf("});", invocationStart);
    const invocation = paymentCard.slice(invocationStart, invocationEnd);

    expect(invocation).toContain("ride_id: ride.id");
    expect(invocation).toContain("idempotency_key: getIdempotencyKey(ride.id)");
    expect(invocation).not.toMatch(/amount\s*:/i);
    expect(invocation).not.toMatch(/price\s*:/i);
  });

  it("only posts signed checkout fields to the two official PayFast checkout endpoints", () => {
    expect(paymentCard).toContain("https://sandbox.payfast.co.za/eng/process");
    expect(paymentCard).toContain("https://www.payfast.co.za/eng/process");
    expect(paymentCard).toContain("ALLOWED_PAYFAST_CHECKOUTS.has(checkoutUrl)");
    expect(paymentCard).toContain('form.method = "POST"');
    expect(paymentCard).toContain("form.submit()");
  });

  it("makes requested trips payable before admin acceptance", () => {
    expect(paymentCard).toContain('"requested",\n  "accepted"');
    expect(paymentCard).toContain(
      "Payment is required before DAATS can accept this trip request.",
    );
    expect(paymentCard).toContain(
      "Payment confirmed. Your trip is now waiting for DAATS admin acceptance.",
    );
    expect(paymentCard).not.toContain(
      "Payment becomes available after DAATS accepts your trip request.",
    );
  });

  it("supports the remaining trip states and cancellation-charge checkout", () => {
    for (const status of [
      '"accepted"',
      '"driver_arriving"',
      '"arrived"',
      '"in_progress"',
      '"completed"',
      '"cancelled"',
    ]) {
      expect(paymentCard).toContain(status);
    }
    expect(paymentCard).toContain("Check & pay cancellation charge");
    expect(paymentCard).toContain("Operational or driver/vehicle");
    expect(paymentCard).toContain("failure cancellations remain R0.");
  });

  it("returns from PayFast to the exact trip window and waits for trusted ITN confirmation", () => {
    expect(createPayment).toContain(
      'const returnUrl = `${appUrl}/app/trip/${rideId}?payment=success`',
    );
    expect(createPayment).toContain(
      'const cancelUrl = `${appUrl}/app/trip/${rideId}?payment=cancelled`',
    );
    expect(paymentCard).toContain('returnState === "success" && !paid');
    expect(paymentCard).toContain("confirming the payment securely from the");
    expect(paymentCard).toContain("You can stay on this screen.");
    expect(paymentCard).toContain("window.setInterval");
    expect(paymentCard).toContain("void reloadPayment()");
    expect(paymentCard).toContain('payment?.status === "paid"');
  });

  it("listens for server-confirmed payment changes and offers both PayFast references", () => {
    expect(paymentCard).toContain('table: "payments"');
    expect(paymentCard).toContain("postgres_changes");
    expect(paymentCard).toContain("Payment confirmed");
    expect(paymentCard).toContain("merchant_payment_id");
    expect(paymentCard).toContain("provider_payment_id");
    expect(paymentCard).toContain("paid_at");
  });

  it("shows confirmed PayFast references to admins without exposing them to drivers", () => {
    expect(adminPaymentSummary).toContain('roles?.includes("admin")');
    expect(adminPaymentSummary).toContain("if (rolesLoading || !isAdmin) return null");
    expect(adminPaymentSummary).toContain("PayFast payment confirmed");
    expect(adminPaymentSummary).toContain("Access reference");
    expect(adminPaymentSummary).toContain("PayFast reference");
    expect(adminPaymentSummary).toContain("provider_payment_id");
    expect(adminPaymentSummary).toContain("provider_status");
    expect(adminPaymentSummary).toContain("This trip is eligible for admin acceptance.");
    expect(tripPage).toContain("<AdminTripPaymentSummary rideId={ride.id} />");
  });

  it("keeps passenger payment controls scoped to the passenger in the existing trip page", () => {
    expect(tripPage).toContain(
      "const isPassenger = !!user && !!ride && ride.passenger_id === user.id",
    );
    expect(tripPage).toContain("{isPassenger ? <PassengerPaymentCard ride={ride} /> : null}");
    expect(tripPage).not.toContain("NAV_ICONS.Payment");
  });
});
