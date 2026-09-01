import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260901153000_phase7_payment_foundation.sql"),
  "utf8",
);
const syncedMigration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260901140524_2649f6c2-3650-4716-ad2c-1255d321ee87.sql",
  ),
  "utf8",
);
const itnStateHardening = readFileSync(
  join(process.cwd(), "supabase/migrations/20260901163000_phase7_payfast_itn_state_hardening.sql"),
  "utf8",
);
const payBeforeAcceptance = readFileSync(
  join(process.cwd(), "supabase/migrations/20260901180000_phase7_pay_before_admin_acceptance.sql"),
  "utf8",
);
const shared = readFileSync(join(process.cwd(), "supabase/functions/_shared/payfast.ts"), "utf8");
const createPayment = readFileSync(
  join(process.cwd(), "supabase/functions/payfast-create-payment/index.ts"),
  "utf8",
);
const itn = readFileSync(join(process.cwd(), "supabase/functions/payfast-itn/index.ts"), "utf8");

describe("Phase 7 PayFast payment foundation", () => {
  it("uses the PayFast documentation sandbox merchant only in sandbox mode", () => {
    expect(shared).toContain('merchantId: "10000100"');
    expect(shared).toContain('merchantKey: "46f0cd694581a"');
    expect(shared).toContain('passphrase: "jt7NOE43FZPn"');
    expect(shared).toContain("https://sandbox.payfast.co.za/eng/process");
    expect(shared).toContain("https://sandbox.payfast.co.za/eng/query/validate");
    expect(shared).toContain('requiredEnv("PAYFAST_MERCHANT_ID")');
    expect(shared).toContain('requiredEnv("PAYFAST_MERCHANT_KEY")');
    expect(shared).toContain('requiredEnv("PAYFAST_PASSPHRASE")');
  });

  it("never accepts a browser-provided authoritative payment amount", () => {
    const start = payBeforeAcceptance.indexOf(
      "CREATE OR REPLACE FUNCTION public.create_ride_payment",
    );
    const end = payBeforeAcceptance.indexOf(
      "REVOKE ALL ON FUNCTION public.create_ride_payment",
      start,
    );
    const functionBody = payBeforeAcceptance.slice(start, end);
    expect(functionBody).toContain("v_ride.estimated_price");
    expect(functionBody).toContain("v_charge.total_amount");
    expect(functionBody).not.toMatch(/p_amount\s+numeric/i);
    expect(createPayment).not.toMatch(/body\.amount/);
  });

  it("allows requested trips to be paid before administrator acceptance", () => {
    expect(payBeforeAcceptance).toContain(
      "v_ride.status IN ('requested', 'accepted', 'driver_arriving', 'arrived', 'in_progress', 'completed')",
    );
    expect(payBeforeAcceptance).toContain("v_ride.estimated_price");
    expect(payBeforeAcceptance).toContain("'trip_fare'");
    expect(payBeforeAcceptance).toContain("'cancellation_charge'");
  });

  it("blocks admin acceptance until PayFast has securely confirmed the current fare", () => {
    expect(payBeforeAcceptance).toContain("rides_payment_before_acceptance_trigger");
    expect(payBeforeAcceptance).toContain("private.ride_has_confirmed_trip_payment");
    expect(payBeforeAcceptance).toContain("p.provider = 'payfast'");
    expect(payBeforeAcceptance).toContain("p.status = 'paid'");
    expect(payBeforeAcceptance).toContain("upper(COALESCE(p.provider_status, '')) = 'COMPLETE'");
    expect(payBeforeAcceptance).toContain("p.paid_at IS NOT NULL");
    expect(payBeforeAcceptance).toContain(
      "Payment must be confirmed by PayFast before this trip can be accepted",
    );
  });

  it("locks fare-affecting edits after requested-trip payment confirmation", () => {
    expect(payBeforeAcceptance).toContain("rides_lock_paid_requested_route_trigger");
    expect(payBeforeAcceptance).toContain("OLD.status = 'requested'");
    expect(payBeforeAcceptance).toContain("OLD.stops IS DISTINCT FROM NEW.stops");
    expect(payBeforeAcceptance).toContain("OLD.estimated_price IS DISTINCT FROM NEW.estimated_price");
    expect(payBeforeAcceptance).toContain(
      "This trip is already paid. Contact support to change the route before acceptance",
    );
  });

  it("protects payment mutation behind RPC/service-role boundaries", () => {
    expect(migration).toMatch(
      /REVOKE INSERT, UPDATE, DELETE ON public\.payments FROM authenticated/i,
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.process_payfast_itn[\s\S]*FROM authenticated/i,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.process_payfast_itn[\s\S]*TO service_role/i,
    );
    expect(migration).toMatch(
      /passenger_id = auth\.uid\(\)[\s\S]*private\.has_role\(auth\.uid\(\), 'admin'/i,
    );
    expect(migration).not.toMatch(
      /passenger_id = auth\.uid\(\)[\s\S]{0,120}driver_id = auth\.uid\(\)/i,
    );
  });

  it("replays safely after the Lovable-synchronised payment migration", () => {
    const policyName = '"passenger or admin reads payments"';
    const policyDrop = `DROP POLICY IF EXISTS ${policyName} ON public.payments;`;
    const policyCreate = `CREATE POLICY ${policyName}`;

    expect(syncedMigration).toContain(policyCreate);
    expect(migration).toContain(policyDrop);
    expect(migration.indexOf(policyDrop)).toBeLessThan(migration.indexOf(policyCreate));
  });

  it("requires all PayFast ITN security checks before reconciliation", () => {
    expect(itn).toContain("validItnSignature");
    expect(itn).toContain("isPayfastSourceIp");
    expect(itn).toContain("amountMatches");
    expect(itn).toContain("config.validationUrl");
    expect(itn).toContain('=== "VALID"');
    expect(itn).toContain("Object.values(checks).every(Boolean)");
    expect(shared).toContain("197.97.145.144/28");
    expect(shared).toContain("41.74.179.192/27");
    expect(shared).toContain("102.216.36.0/28");
    expect(shared).toContain("102.216.36.128/28");
    expect(shared).toContain("144.126.193.139/32");
  });

  it("is idempotent and refuses to resurrect superseded payment intents", () => {
    expect(migration).toContain("payments_passenger_idempotency_uidx");
    expect(migration).toContain("payment_gateway_events");
    expect(migration).toContain("ON CONFLICT (provider, environment, event_key) DO NOTHING");
    expect(migration).toContain("A superseded / already-failed intent must never be resurrected");
  });

  it("re-applies the guarded ITN state machine after backend synchronisation", () => {
    expect(itnStateHardening).toContain("CREATE OR REPLACE FUNCTION public.process_payfast_itn");
    expect(itnStateHardening).toContain("v_payment.status NOT IN ('pending', 'paid')");
    expect(itnStateHardening).toContain("validation_status = 'ignored'");
    expect(itnStateHardening).toContain("'payment_state_allowed', false");
    expect(itnStateHardening).toMatch(
      /REVOKE ALL ON FUNCTION public\.process_payfast_itn[\s\S]*FROM authenticated/i,
    );
    expect(itnStateHardening).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.process_payfast_itn[\s\S]*TO service_role/i,
    );
  });

  it("creates a refund ledger without allowing direct passenger/admin writes", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.payment_refunds");
    expect(migration).toContain("public.admin_request_payment_refund");
    expect(migration).toContain("Refund amount exceeds the available balance");
    expect(migration).not.toMatch(
      /GRANT (INSERT|UPDATE|DELETE)[^;]*payment_refunds TO authenticated/i,
    );
  });

  it("does not expose the service-role key from the authenticated checkout function", () => {
    expect(createPayment).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(createPayment).not.toContain("SUPABASE_SECRET_KEY");
    expect(itn).toContain("SUPABASE_SERVICE_ROLE_KEY");
  });
});
