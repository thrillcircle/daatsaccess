import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const paymentCard = readFileSync(
  join(process.cwd(), "src/components/payments/PassengerPaymentCard.tsx"),
  "utf8",
);
const tripPage = readFileSync(join(process.cwd(), "src/routes/app.trip.$rideId.tsx"), "utf8");

describe("Phase 7 passenger PayFast UX", () => {
  it("submits only the ride reference and idempotency key to the payment initializer", () => {
    const invocationStart = paymentCard.indexOf('supabase.functions.invoke("payfast-create-payment"');
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

  it("keeps requested trips non-payable until admin acceptance", () => {
    expect(paymentCard).toContain('if (ride.status === "requested")');
    expect(paymentCard).toContain("Payment becomes available after DAATS accepts your trip request.");
    expect(paymentCard).not.toContain('"requested",\n  "accepted"');
  });

  it("supports accepted through completed trips and cancellation-charge checkout", () => {
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
    expect(paymentCard).toContain("Operational or driver/vehicle failure");
  });

  it("does not trust the browser return redirect as payment confirmation", () => {
    expect(paymentCard).toContain('returnState === "success" && !paid');
    expect(paymentCard).toContain("confirming the payment securely from the PayFast");
    expect(paymentCard).toContain('payment?.status === "paid"');
  });

  it("listens for server-confirmed payment changes and offers a receipt state", () => {
    expect(paymentCard).toContain('table: "payments"');
    expect(paymentCard).toContain("postgres_changes");
    expect(paymentCard).toContain("Payment confirmed");
    expect(paymentCard).toContain("merchant_payment_id");
    expect(paymentCard).toContain("paid_at");
  });

  it("renders payment controls only for the passenger in the existing trip page", () => {
    expect(tripPage).toContain("const isPassenger = !!user && !!ride && ride.passenger_id === user.id");
    expect(tripPage).toContain("{isPassenger ? <PassengerPaymentCard ride={ride} /> : null}");
    expect(tripPage).not.toContain("NAV_ICONS.Payment");
  });
});
