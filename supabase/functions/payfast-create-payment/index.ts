import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.108.2";
import {
  checkoutFields,
  getPayfastConfig,
  type PayfastEntry,
} from "../_shared/payfast.ts";

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

function publishableKey(): string {
  const modern = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (modern) {
    try {
      const keys = JSON.parse(modern) as Record<string, string>;
      if (keys.default) return keys.default;
    } catch {
      // Continue to compatibility fallbacks below.
    }
  }

  const fallback =
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
    Deno.env.get("SUPABASE_ANON_KEY");
  if (!fallback) throw new Error("Supabase publishable key is unavailable");
  return fallback;
}

function splitName(fullName: string | null | undefined): { first: string; last: string } {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "Access", last: "Passenger" };
  if (parts.length === 1) return { first: parts[0]!, last: "Passenger" };
  return { first: parts[0]!, last: parts.slice(1).join(" ") };
}

type PaymentIntent = {
  payment_id: string;
  ride_id: string;
  merchant_payment_id: string;
  amount: number | string;
  currency: string;
  status: string;
  purpose: "trip_fare" | "cancellation_charge";
  environment: "sandbox" | "live";
  idempotent: boolean;
  already_paid: boolean;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.toLowerCase().startsWith("bearer ")) {
      return json({ error: "Authentication required" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (!supabaseUrl) throw new Error("SUPABASE_URL is unavailable");

    const token = authHeader.slice(7).trim();
    const supabase = createClient(supabaseUrl, publishableKey(), {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData.user) {
      return json({ error: "Invalid or expired session" }, 401);
    }

    const body = (await req.json()) as {
      ride_id?: string;
      idempotency_key?: string;
    };
    const rideId = body.ride_id?.trim();
    if (!rideId || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(rideId)) {
      return json({ error: "A valid ride_id is required" }, 400);
    }

    const config = getPayfastConfig();
    const idempotencyKey = body.idempotency_key?.trim() || crypto.randomUUID();

    const { data: intentData, error: intentError } = await supabase.rpc(
      "create_ride_payment",
      {
        p_ride_id: rideId,
        p_environment: config.mode,
        p_idempotency_key: idempotencyKey,
      },
    );

    if (intentError) {
      return json({ error: intentError.message }, 400);
    }

    const intent = intentData as PaymentIntent;
    if (intent.already_paid || intent.status === "paid") {
      return json({
        payment: intent,
        checkout_url: null,
        fields: null,
        mode: config.mode,
      });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, phone")
      .eq("user_id", userData.user.id)
      .maybeSingle();

    const name = splitName(profile?.full_name);
    const appUrl = (Deno.env.get("ACCESS_APP_URL") ?? "https://daats.app").replace(/\/$/, "");
    const returnUrl = `${appUrl}/app/trip/${rideId}?payment=success`;
    const cancelUrl = `${appUrl}/app/trip/${rideId}?payment=cancelled`;
    const notifyUrl = `${supabaseUrl}/functions/v1/payfast-itn`;
    const amount = Number(intent.amount).toFixed(2);
    const description =
      intent.purpose === "cancellation_charge"
        ? "Access trip cancellation charge"
        : "Access wheelchair-accessible transport trip";

    // IMPORTANT: PayFast custom-integration signatures use documentation order,
    // not the alphabetic API-signature order.
    const entries: PayfastEntry[] = [
      ["merchant_id", config.merchantId],
      ["merchant_key", config.merchantKey],
      ["return_url", returnUrl],
      ["cancel_url", cancelUrl],
      ["notify_url", notifyUrl],
      ["name_first", name.first],
      ["name_last", name.last],
      ["email_address", userData.user.email ?? ""],
      ["cell_number", profile?.phone ?? ""],
      ["m_payment_id", intent.merchant_payment_id],
      ["amount", amount],
      ["item_name", "DAATS Access payment"],
      ["item_description", description],
      ["custom_str1", intent.payment_id],
    ];

    return json({
      payment: intent,
      checkout_url: config.checkoutUrl,
      fields: checkoutFields(entries, config.passphrase),
      mode: config.mode,
      idempotency_key: idempotencyKey,
    });
  } catch (error) {
    console.error("payfast-create-payment failed", error);
    return json({ error: "Unable to prepare the PayFast payment" }, 500);
  }
});
