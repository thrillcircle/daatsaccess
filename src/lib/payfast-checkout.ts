import { supabase } from "@/integrations/supabase/client";

type CheckoutResponse = {
  payment: {
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
  checkout_url: string | null;
  fields: Record<string, string> | null;
  mode: "sandbox" | "live";
  idempotency_key?: string;
};

const ALLOWED_PAYFAST_CHECKOUTS = new Set([
  "https://sandbox.payfast.co.za/eng/process",
  "https://www.payfast.co.za/eng/process",
]);

function paymentStorageKey(rideId: string) {
  return `access:payfast:idempotency:${rideId}`;
}

export function getPayfastIdempotencyKey(rideId: string): string {
  if (typeof window === "undefined") return crypto.randomUUID();
  const key = paymentStorageKey(rideId);
  const existing = window.sessionStorage.getItem(key);
  if (existing) return existing;
  const value = crypto.randomUUID();
  window.sessionStorage.setItem(key, value);
  return value;
}

export function clearPayfastIdempotencyKey(rideId: string) {
  if (typeof window !== "undefined") {
    window.sessionStorage.removeItem(paymentStorageKey(rideId));
  }
}

export function submitPayfastForm(checkoutUrl: string, fields: Record<string, string>) {
  if (!ALLOWED_PAYFAST_CHECKOUTS.has(checkoutUrl)) {
    throw new Error("Unexpected PayFast checkout address");
  }

  const form = document.createElement("form");
  form.method = "POST";
  form.action = checkoutUrl;
  form.style.display = "none";

  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }

  document.body.appendChild(form);
  form.submit();
}

export async function startPayfastCheckout(rideId: string): Promise<"submitted" | "already_paid"> {
  const { data, error } = await supabase.functions.invoke("payfast-create-payment", {
    body: {
      ride_id: rideId,
      idempotency_key: getPayfastIdempotencyKey(rideId),
    },
  });

  if (error) throw error;
  const checkout = data as CheckoutResponse;

  if (checkout.payment.already_paid || checkout.payment.status === "paid") {
    clearPayfastIdempotencyKey(rideId);
    return "already_paid";
  }

  if (!checkout.checkout_url || !checkout.fields) {
    throw new Error("PayFast checkout is unavailable");
  }

  submitPayfastForm(checkout.checkout_url, checkout.fields);
  return "submitted";
}
