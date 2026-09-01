import { createFileRoute } from "@tanstack/react-router";

const FROM = "Access by DAATS <noreply@daats.app>";
const SENDER_DOMAIN = "notify.daats.app";
const APP_URL = "https://daats.app";

type RpcResult<T> = Promise<{ data: T | null; error: { message: string } | null }>;
type UntypedRpc = <T>(name: string, args?: Record<string, unknown>) => RpcResult<T>;

type EmailDelivery = {
  delivery_id: string;
  outbox_id: string;
  recipient_user_id: string;
  recipient_email: string;
  notification_type: string;
  title: string;
  message: string | null;
  ride_id: string | null;
  service_booking_id: string | null;
  deduplication_key: string;
  attempt_count: number;
  payment_amount: number | string | null;
  payment_currency: string | null;
  payment_reference: string | null;
  provider_payment_id: string | null;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(amount: EmailDelivery["payment_amount"], currency: string | null) {
  if (amount === null || amount === undefined) return null;
  const value = Number(amount);
  if (!Number.isFinite(value)) return null;
  try {
    return new Intl.NumberFormat("en-ZA", {
      style: "currency",
      currency: currency || "ZAR",
      minimumFractionDigits: 2,
    }).format(value);
  } catch {
    return `R ${value.toFixed(2)}`;
  }
}

function destination(delivery: EmailDelivery) {
  if (delivery.ride_id) return `${APP_URL}/app/trip/${delivery.ride_id}`;
  if (delivery.service_booking_id) return `${APP_URL}/app/passenger/bookings`;
  return `${APP_URL}/app/passenger`;
}

function emailBody(delivery: EmailDelivery) {
  const amount = money(delivery.payment_amount, delivery.payment_currency);
  const title = escapeHtml(delivery.title);
  const message = escapeHtml(delivery.message || "There is an update on your Access account.");
  const reference = delivery.payment_reference ? escapeHtml(delivery.payment_reference) : null;
  const url = destination(delivery);
  const financialPanel =
    amount || reference
      ? `<div style="margin:20px 0;background:#f4f4f5;border-radius:12px;padding:16px">
          ${amount ? `<p style="margin:0 0 6px;font-size:20px;font-weight:700">${escapeHtml(amount)}</p>` : ""}
          ${reference ? `<p style="margin:0;font-size:12px;color:#71717a">Payment reference: ${reference}</p>` : ""}
        </div>`
      : "";

  return {
    html: `<!doctype html>
<html>
  <body style="margin:0;background:#f7f7f8;font-family:Arial,sans-serif;color:#18181b">
    <div style="max-width:560px;margin:0 auto;padding:32px 20px">
      <div style="background:#ffffff;border:1px solid #e4e4e7;border-radius:16px;padding:28px">
        <p style="margin:0 0 8px;font-size:14px;color:#71717a">Access by DAATS</p>
        <h1 style="margin:0 0 14px;font-size:24px">${title}</h1>
        <p style="margin:0;line-height:1.55">${message}</p>
        ${financialPanel}
        <a href="${url}" style="display:inline-block;margin-top:22px;background:#18181b;color:#ffffff;text-decoration:none;border-radius:10px;padding:12px 18px;font-weight:600">Open Access</a>
        <p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#71717a">This is an automated transactional message about your Access account, booking or payment. For help, open Support in Access. Do not reply to this address.</p>
      </div>
    </div>
  </body>
</html>`,
    text: [
      "Access by DAATS",
      "",
      delivery.title,
      delivery.message || "There is an update on your Access account.",
      amount ? `Amount: ${amount}` : null,
      delivery.payment_reference ? `Payment reference: ${delivery.payment_reference}` : null,
      "",
      `Open Access: ${url}`,
      "",
      "This is an automated transactional message. For help, open Support in Access.",
    ]
      .filter((line): line is string => line !== null)
      .join("\n"),
  };
}

export const Route = createFileRoute("/api/internal/notification-email-worker")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const workerToken = request.headers.get("x-access-worker-token") ?? "";
        if (!workerToken) return json({ error: "Not found" }, 404);

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const rpc = supabaseAdmin.rpc.bind(supabaseAdmin) as unknown as UntypedRpc;
          const validation = await rpc<boolean>("service_validate_notification_worker_token", {
            p_token: workerToken,
          });
          if (validation.error) throw new Error(validation.error.message);
          if (validation.data !== true) return json({ error: "Not found" }, 404);

          const claimed = await rpc<EmailDelivery[]>("service_claim_email_notification_deliveries", {
            p_limit: 25,
          });
          if (claimed.error) throw new Error(claimed.error.message);
          const deliveries = claimed.data ?? [];
          if (!deliveries.length) return json({ processed: 0, delivered: 0, failed: 0 });

          const apiKey = process.env.LOVABLE_API_KEY;
          if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");
          const { sendLovableEmail } = await import("@lovable.dev/email-js");

          let delivered = 0;
          let failed = 0;

          for (const delivery of deliveries) {
            try {
              const body = emailBody(delivery);
              await sendLovableEmail(
                {
                  to: delivery.recipient_email,
                  from: FROM,
                  sender_domain: SENDER_DOMAIN,
                  subject: delivery.title,
                  html: body.html,
                  text: body.text,
                  purpose: "transactional",
                  idempotency_key: `notification-email-${delivery.delivery_id}`,
                },
                { apiKey },
              );

              const finish = await rpc<void>("service_finish_email_notification_delivery", {
                p_delivery_id: delivery.delivery_id,
                p_success: true,
                p_provider_message_id: null,
                p_error: null,
              });
              if (finish.error) throw new Error(finish.error.message);
              delivered += 1;
            } catch (error) {
              failed += 1;
              const message = error instanceof Error ? error.message : "Email delivery failed";
              const finish = await rpc<void>("service_finish_email_notification_delivery", {
                p_delivery_id: delivery.delivery_id,
                p_success: false,
                p_provider_message_id: null,
                p_error: message,
              });
              if (finish.error) console.error("[notification-email-worker:finish]", finish.error);
            }
          }

          return json({ processed: deliveries.length, delivered, failed });
        } catch (error) {
          console.error("[notification-email-worker]", error);
          return json({ error: "Notification email worker failed" }, 500);
        }
      },
    },
  },
});
