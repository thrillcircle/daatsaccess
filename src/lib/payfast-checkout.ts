import { supabase } from "@/integrations/supabase/client";

type CheckoutResponse = {
  payment: {
    payment_id: string;
    ride_id: string;
    merchant_payment_id: string;
    amount: number | string;
    currency: string;
    status: string;
    purpose: "trip_fare" | "trip_adjustment" | "cancellation_charge";
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

function paymentStorageKey(kind: "ride" | "edit", id: string) {
  return `access:payfast:${kind}:idempotency:${id}`;
}

function getIdempotencyKey(kind: "ride" | "edit", id: string): string {
  if (typeof window === "undefined") return crypto.randomUUID();
  const key = paymentStorageKey(kind, id);
  const existing = window.sessionStorage.getItem(key);
  if (existing) return existing;
  const value = crypto.randomUUID();
  window.sessionStorage.setItem(key, value);
  return value;
}

function clearIdempotencyKey(kind: "ride" | "edit", id: string) {
  if (typeof window !== "undefined") {
    window.sessionStorage.removeItem(paymentStorageKey(kind, id));
  }
}

export function getPayfastIdempotencyKey(rideId: string): string {
  return getIdempotencyKey("ride", rideId);
}

export function clearPayfastIdempotencyKey(rideId: string) {
  clearIdempotencyKey("ride", rideId);
}

export function clearRideEditPayfastIdempotencyKey(changeRequestId: string) {
  clearIdempotencyKey("edit", changeRequestId);
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

async function openCheckout(
  body: Record<string, string>,
  kind: "ride" | "edit",
  id: string,
): Promise<"submitted" | "already_paid"> {
  const { data, error } = await supabase.functions.invoke("payfast-create-payment", { body });
  if (error) throw error;
  const checkout = data as CheckoutResponse;

  if (checkout.payment.already_paid || checkout.payment.status === "paid") {
    clearIdempotencyKey(kind, id);
    return "already_paid";
  }
  if (!checkout.checkout_url || !checkout.fields) {
    throw new Error("PayFast checkout is unavailable");
  }
  submitPayfastForm(checkout.checkout_url, checkout.fields);
  return "submitted";
}

export async function startPayfastCheckout(rideId: string): Promise<"submitted" | "already_paid"> {
  return openCheckout(
    {
      ride_id: rideId,
      idempotency_key: getIdempotencyKey("ride", rideId),
    },
    "ride",
    rideId,
  );
}

export async function startRideEditPayfastCheckout(
  changeRequestId: string,
): Promise<"submitted" | "already_paid"> {
  return openCheckout(
    {
      ride_change_request_id: changeRequestId,
      idempotency_key: getIdempotencyKey("edit", changeRequestId),
    },
    "edit",
    changeRequestId,
  );
}
