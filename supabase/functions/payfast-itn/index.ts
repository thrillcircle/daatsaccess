import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.108.2";
import {
  amountMatches,
  getPayfastConfig,
  isPayfastSourceIp,
  parseItnBody,
  sanitizedItnPayload,
  sha256Hex,
  validItnSignature,
} from "../_shared/payfast.ts";

function secretKey(): string {
  const modern = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (modern) {
    try {
      const keys = JSON.parse(modern) as Record<string, string>;
      if (keys.default) return keys.default;
    } catch {
      // Continue to compatibility fallbacks below.
    }
  }

  const fallback =
    Deno.env.get("SUPABASE_SECRET_KEY") ??
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!fallback) throw new Error("Supabase secret/service-role key is unavailable");
  return fallback;
}

function callerIp(req: Request): string | null {
  return (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")
  );
}

type PaymentLookup = {
  id: string;
  amount: number | string;
  environment: string | null;
  merchant_payment_id: string | null;
};

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const config = getPayfastConfig();
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!supabaseUrl) return new Response("Server configuration error", { status: 500 });

  const admin = createClient(supabaseUrl, secretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const rawBody = await req.text();
  const eventKey = await sha256Hex(rawBody);
  const { entries, data, signature, validationBody } = parseItnBody(rawBody);
  const merchantPaymentId = data.m_payment_id?.trim() ?? "";
  const providerPaymentId = data.pf_payment_id?.trim() ?? "";
  const providerStatus = data.payment_status?.trim() ?? "";
  const receivedAmount = Number(data.amount_gross);
  const payload = sanitizedItnPayload(data);

  let payment: PaymentLookup | null = null;
  if (merchantPaymentId) {
    const { data: row, error } = await admin
      .from("payments")
      .select("id, amount, environment, merchant_payment_id")
      .eq("merchant_payment_id", merchantPaymentId)
      .eq("provider", "payfast")
      .maybeSingle();

    if (!error) payment = row as PaymentLookup | null;
  }

  const checks = {
    merchant: data.merchant_id === config.merchantId,
    signature: validItnSignature(entries, signature, config.passphrase),
    source: isPayfastSourceIp(callerIp(req)),
    amount: payment ? amountMatches(Number(payment.amount), receivedAmount) : false,
    environment: payment ? payment.environment === config.mode : false,
    server_confirmation: false,
  };

  if (checks.merchant && checks.signature && checks.source && checks.amount && checks.environment) {
    try {
      const confirmation = await fetch(config.validationUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: validationBody,
        redirect: "error",
      });
      checks.server_confirmation = confirmation.ok && (await confirmation.text()).trim() === "VALID";
    } catch (error) {
      console.error("PayFast server confirmation failed", {
        merchantPaymentId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const allValid = Object.values(checks).every(Boolean);

  if (!allValid) {
    const { error: eventError } = await admin.from("payment_gateway_events").upsert(
      {
        payment_id: payment?.id ?? null,
        provider: "payfast",
        environment: config.mode,
        event_key: eventKey,
        event_type: "itn",
        provider_payment_id: providerPaymentId || null,
        validation_status: "invalid",
        validation_checks: checks,
        payload,
      },
      { onConflict: "provider,environment,event_key", ignoreDuplicates: true },
    );

    if (eventError) {
      console.error("Unable to record rejected PayFast ITN", {
        merchantPaymentId,
        message: eventError.message,
      });
    }

    console.warn("Rejected PayFast ITN", { merchantPaymentId, checks });
    return new Response("INVALID", { status: 400, headers: { "Content-Type": "text/plain" } });
  }

  const { data: result, error: processError } = await admin.rpc("process_payfast_itn", {
    p_event_key: eventKey,
    p_environment: config.mode,
    p_merchant_payment_id: merchantPaymentId,
    p_provider_payment_id: providerPaymentId,
    p_provider_status: providerStatus,
    p_amount_gross: receivedAmount,
    p_payload: payload,
  });

  if (processError) {
    console.error("PayFast ITN reconciliation failed", {
      merchantPaymentId,
      message: processError.message,
    });
    // A non-200 response lets PayFast retry a valid notification after a
    // transient database or application failure.
    return new Response("RETRY", { status: 500, headers: { "Content-Type": "text/plain" } });
  }

  console.info("PayFast ITN processed", {
    merchantPaymentId,
    providerPaymentId,
    providerStatus,
    result,
  });

  return new Response("OK", { status: 200, headers: { "Content-Type": "text/plain" } });
});
