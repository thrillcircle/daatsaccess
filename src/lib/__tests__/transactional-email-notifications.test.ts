import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workerMigration = readFileSync(
  new URL(
    "../../../supabase/migrations/20260902001000_transactional_email_notification_worker.sql",
    import.meta.url,
  ),
  "utf8",
);
const workerRoute = readFileSync(
  new URL("../../routes/api.internal.notification-email-worker.ts", import.meta.url),
  "utf8",
);
const confirmationRoute = readFileSync(
  new URL("../../routes/api.passenger.email-confirmation.ts", import.meta.url),
  "utf8",
);
const authWebhook = readFileSync(
  new URL("../../routes/lovable/email/auth/webhook.ts", import.meta.url),
  "utf8",
);

describe("Access noreply transactional email", () => {
  it("uses the same Access by DAATS sender for auth, confirmation and transactional email", () => {
    expect(authWebhook).toContain("noreply@${FROM_DOMAIN}");
    expect(authWebhook).toContain('const FROM_DOMAIN = "daats.app"');
    expect(authWebhook).toContain('const SENDER_DOMAIN = "notify.daats.app"');
    expect(confirmationRoute).toContain("Access by DAATS <noreply@daats.app>");
    expect(workerRoute).toContain("Access by DAATS <noreply@daats.app>");
    expect(workerRoute).toContain('const SENDER_DOMAIN = "notify.daats.app"');
  });

  it("emails financial and cancellation records while avoiding live trip-status email noise", () => {
    for (const type of [
      "payment_received",
      "payment_failed",
      "refund_queued",
      "refund_processed",
      "cancellation_balance_due",
      "ride_cancelled",
    ]) {
      expect(workerMigration).toContain(`'${type}'`);
    }
    expect(workerMigration).not.toContain("'operation_driver_arrived',");
    expect(workerMigration).not.toContain("'driver_accepted',");
    expect(workerMigration).not.toContain("'ride_route_updated',");
  });

  it("respects the passenger email preference for optional quote and 24-hour reminder emails", () => {
    expect(workerMigration).toContain("'service_quote_ready'");
    expect(workerMigration).toContain("'service_reminder_24h'");
    expect(workerMigration).toContain("v_email_optional AND COALESCE(v_pref.email,true)");
  });

  it("uses a queue worker with retry, idempotency and a vault-protected scheduler token", () => {
    expect(workerMigration).toContain("service_claim_email_notification_deliveries");
    expect(workerMigration).toContain("d.attempt_count < 5");
    expect(workerMigration).toContain("FOR UPDATE SKIP LOCKED");
    expect(workerMigration).toContain("access_notification_worker_token");
    expect(workerMigration).toContain("net.http_post");
    expect(workerMigration).toContain("access-transactional-email-worker");
    expect(workerRoute).toContain("service_validate_notification_worker_token");
    expect(workerRoute).toContain("notification-email-${delivery.delivery_id}");
  });

  it("includes payment amount and reference without exposing card or driver finance data", () => {
    expect(workerMigration).toContain("'payment_amount',p.amount");
    expect(workerMigration).toContain("'payment_reference',p.merchant_payment_id");
    expect(workerRoute).toContain("Payment reference:");
    expect(workerRoute).not.toContain("card_number");
    expect(workerRoute).not.toContain("driver_payout");
  });
});
