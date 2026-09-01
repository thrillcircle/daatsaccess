import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.108.2";
import md5 from "npm:blueimp-md5@2.19.0";
import { getPayfastConfig, payfastEncode } from "../_shared/payfast.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function apiTimestamp(): string {
  const shifted = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString().slice(0, 19);
  return `${shifted}+02:00`;
}

function apiSignature(values: Record<string, string>, passphrase: string): string {
  const data = { ...values, passphrase };
  delete data.testing;
  const parameterString = Object.entries(data)
    .filter(([, value]) => value !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${payfastEncode(key)}=${payfastEncode(value)}`)
    .join("&");
  return md5(parameterString);
}

function serviceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Supabase service configuration is unavailable");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

type PreparedRefund = {
  already_completed?: boolean;
  refund_id: string;
  payment_id: string;
  passenger_id: string;
  ride_id: string;
  amount: number | string;
  reason: string;
  provider_payment_id: string;
  environment: "sandbox" | "live" | null;
};

type RefundQuery = {
  token?: string;
  funding_type?: string;
  amount_original?: number | string;
  amount_available_for_refund?: number | string;
  status?: string;
  errors?: string[];
  refund_full?: { method?: string };
  refund_partial?: { method?: string };
};

function extractQueryPayload(value: unknown): RefundQuery {
  if (!value || typeof value !== "object") return {};
  const root = value as Record<string, unknown>;
  const data = root.data;
  if (data && typeof data === "object") {
    const dataRecord = data as Record<string, unknown>;
    const response = dataRecord.response;
    if (response && typeof response === "object") return response as RefundQuery;
    return dataRecord as RefundQuery;
  }
  return root as RefundQuery;
}

async function payfastRequest(
  method: "GET" | "POST",
  path: string,
  config: ReturnType<typeof getPayfastConfig>,
  body: Record<string, string> = {},
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const timestamp = apiTimestamp();
  const signatureValues: Record<string, string> = {
    "merchant-id": config.merchantId,
    timestamp,
    version: "v1",
    ...body,
  };
  const signature = apiSignature(signatureValues, config.passphrase);
  const url = new URL(`https://api.payfast.co.za${path}`);
  if (config.mode === "sandbox") url.searchParams.set("testing", "true");

  const response = await fetch(url, {
    method,
    headers: {
      "merchant-id": config.merchantId,
      version: "v1",
      timestamp,
      signature,
      ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: method === "POST" ? new URLSearchParams(body).toString() : undefined,
  });

  const text = await response.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    // Keep the provider response text for controlled diagnostics.
  }
  return { ok: response.ok, status: response.status, data };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.toLowerCase().startsWith("bearer ")) {
    return json({ error: "Authentication required" }, 401);
  }

  let refundId = "";
  const admin = serviceClient();
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const publishable = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !publishable) throw new Error("Supabase public configuration is unavailable");

    const caller = createClient(supabaseUrl, publishable, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const token = authHeader.slice(7).trim();
    const { data: userData, error: userError } = await caller.auth.getUser(token);
    if (userError || !userData.user) return json({ error: "Invalid or expired session" }, 401);

    const body = (await req.json()) as { refund_id?: string };
    refundId = body.refund_id?.trim() ?? "";
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(refundId)) {
      return json({ error: "A valid refund_id is required" }, 400);
    }

    const { data: preparedData, error: prepareError } = await caller.rpc("prepare_payment_refund", {
      p_refund_id: refundId,
    });
    if (prepareError) return json({ error: prepareError.message }, 403);
    const prepared = preparedData as PreparedRefund;
    if (prepared.already_completed) return json({ status: "completed", idempotent: true });

    const config = getPayfastConfig();
    if (prepared.environment && prepared.environment !== config.mode) {
      throw new Error(`Refund environment mismatch: payment is ${prepared.environment}, function is ${config.mode}`);
    }

    const queryResult = await payfastRequest(
      "GET",
      `/refunds/query/${encodeURIComponent(prepared.provider_payment_id)}`,
      config,
    );
    if (!queryResult.ok) {
      throw new Error(`PayFast refund query failed with HTTP ${queryResult.status}`);
    }

    const query = extractQueryPayload(queryResult.data);
    const amountCents = Math.round(Number(prepared.amount) * 100);
    const availableCents = Number(query.amount_available_for_refund ?? 0);
    const originalCents = Number(query.amount_original ?? 0);
    if (!Number.isFinite(amountCents) || amountCents <= 0) throw new Error("Invalid refund amount");
    if (!Number.isFinite(availableCents) || availableCents < amountCents) {
      throw new Error("PayFast does not have enough refundable balance for this request");
    }

    const isTrueFullRefund = amountCents === originalCents && availableCents === originalCents;
    const method = (isTrueFullRefund ? query.refund_full?.method : query.refund_partial?.method) ?? "NOT_AVAILABLE";

    if (method !== "PAYMENT_SOURCE") {
      const reason = method === "BANK_PAYOUT"
        ? "PayFast requires a bank payout for this refund. Administrator handling is required."
        : `PayFast cannot automatically refund this payment${query.errors?.length ? `: ${query.errors.join("; ")}` : "."}`;
      await admin.rpc("finalize_payment_refund", {
        p_refund_id: refundId,
        p_outcome: "action_required",
        p_provider_refund_id: null,
        p_provider_status: query.status ?? method,
        p_failure_reason: reason,
        p_metadata: { refund_method: method, query_status: query.status ?? null },
      });
      return json({ status: "action_required", method, message: reason });
    }

    const createBody = {
      amount: String(amountCents),
      notify_buyer: "1",
      notify_merchant: "0",
      reason: prepared.reason.slice(0, 255),
    };
    const createResult = await payfastRequest(
      "POST",
      `/refunds/${encodeURIComponent(prepared.provider_payment_id)}`,
      config,
      createBody,
    );
    if (!createResult.ok) {
      throw new Error(`PayFast refund creation failed with HTTP ${createResult.status}`);
    }

    const root = createResult.data as Record<string, unknown> | null;
    const success = root?.status === "success" || (root?.data as Record<string, unknown> | undefined)?.response === true;
    if (!success) throw new Error("PayFast did not confirm the refund request");

    const { data: finalized, error: finalizeError } = await admin.rpc("finalize_payment_refund", {
      p_refund_id: refundId,
      p_outcome: "completed",
      p_provider_refund_id: null,
      p_provider_status: "REFUNDED",
      p_failure_reason: null,
      p_metadata: { refund_method: method, provider_response: createResult.data },
    });
    if (finalizeError) throw finalizeError;
    return json({ status: "completed", refund: finalized });
  } catch (error) {
    console.error("payfast-refund failed", error);
    if (refundId) {
      await admin.rpc("finalize_payment_refund", {
        p_refund_id: refundId,
        p_outcome: "failed",
        p_provider_refund_id: null,
        p_provider_status: null,
        p_failure_reason: error instanceof Error ? error.message : "Refund processing failed",
        p_metadata: {},
      }).catch(() => undefined);
    }
    return json({ error: error instanceof Error ? error.message : "Unable to process refund" }, 500);
  }
});
