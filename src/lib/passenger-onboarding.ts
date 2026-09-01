import { supabase } from "@/integrations/supabase/client";

type RpcError = { message: string } | null;
type RpcResult<T> = Promise<{ data: T | null; error: RpcError }>;
type Rpc = <T>(name: string, args?: Record<string, unknown>) => RpcResult<T>;

const rpc = supabase.rpc.bind(supabase) as unknown as Rpc;

export type OnboardingAddress = {
  id: string;
  label: "Home" | "Work" | "Medical Facility" | "Family" | "Other";
  formatted_address: string;
  place_id: string | null;
  latitude: number;
  longitude: number;
  is_default: boolean;
};

export type PassengerOnboardingStatus = {
  complete: boolean;
  missing: string[];
  completion_percent: number;
  profile: {
    full_name: string | null;
    phone: string | null;
    email: string | null;
  };
  saved_address: OnboardingAddress | null;
  email_confirmation: {
    confirmed: boolean;
    confirmed_at: string | null;
    method: "email_code" | "oauth_google" | "oauth_apple" | null;
    last_sent_at: string | null;
  };
};

export type SavePassengerOnboardingInput = {
  fullName: string;
  phone: string;
  savedAddressId?: string | null;
  addressLabel: OnboardingAddress["label"];
  formattedAddress: string;
  placeId?: string | null;
  latitude: number;
  longitude: number;
};

function unwrap<T>(result: { data: T | null; error: RpcError }): T {
  if (result.error) throw new Error(result.error.message);
  if (result.data === null) throw new Error("The server returned no onboarding data");
  return result.data;
}

export async function getPassengerOnboardingStatus(): Promise<PassengerOnboardingStatus> {
  return unwrap(await rpc<PassengerOnboardingStatus>("passenger_onboarding_status"));
}

export async function completePassengerOnboarding(
  input: SavePassengerOnboardingInput,
): Promise<PassengerOnboardingStatus> {
  return unwrap(
    await rpc<PassengerOnboardingStatus>("passenger_complete_onboarding", {
      p_full_name: input.fullName,
      p_phone: input.phone,
      p_saved_address_id: input.savedAddressId ?? null,
      p_address_label: input.addressLabel,
      p_formatted_address: input.formattedAddress,
      p_place_id: input.placeId ?? null,
      p_latitude: input.latitude,
      p_longitude: input.longitude,
    }),
  );
}

async function emailConfirmationRequest(body: { action: "request" | "verify"; code?: string }) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sign in again to confirm your email");

  const response = await fetch("/api/passenger/email-confirmation", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => ({}))) as {
    error?: string;
    sent?: boolean;
    verified?: boolean;
    expiresInMinutes?: number;
    retryAfterSeconds?: number;
    attemptsRemaining?: number;
  };
  if (!response.ok) throw new Error(result.error ?? "Email confirmation failed");
  return result;
}

export function requestPassengerEmailConfirmation() {
  return emailConfirmationRequest({ action: "request" });
}

export function verifyPassengerEmailConfirmation(code: string) {
  return emailConfirmationRequest({ action: "verify", code });
}
