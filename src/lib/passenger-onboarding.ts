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

export type OnboardingPreferences = {
  preferred_contact_method: "in_app" | "phone" | "email";
  wheelchair_user: boolean;
  mobility_device_notes: string | null;
  communication_support_notes: string | null;
  general_assistance_notes: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relationship: string | null;
  preferences_confirmed_at: string | null;
};

export type OnboardingNotifications = {
  in_app: boolean;
  push: boolean;
  sms: boolean;
  whatsapp: boolean;
  email: boolean;
  confirmed_at: string | null;
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
  preferences: OnboardingPreferences | null;
  notifications: OnboardingNotifications | null;
};

export type CompletePassengerOnboardingInput = {
  fullName: string;
  phone: string;
  savedAddressId?: string | null;
  addressLabel: OnboardingAddress["label"];
  formattedAddress: string;
  placeId?: string | null;
  latitude: number;
  longitude: number;
  preferredContactMethod: OnboardingPreferences["preferred_contact_method"];
  wheelchairUser: boolean;
  mobilityDeviceNotes?: string | null;
  communicationSupportNotes?: string | null;
  generalAssistanceNotes?: string | null;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelationship: string;
  push: boolean;
  sms: boolean;
  whatsapp: boolean;
  email: boolean;
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
  input: CompletePassengerOnboardingInput,
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
      p_preferred_contact_method: input.preferredContactMethod,
      p_wheelchair_user: input.wheelchairUser,
      p_mobility_device_notes: input.mobilityDeviceNotes ?? null,
      p_communication_support_notes: input.communicationSupportNotes ?? null,
      p_general_assistance_notes: input.generalAssistanceNotes ?? null,
      p_emergency_contact_name: input.emergencyContactName,
      p_emergency_contact_phone: input.emergencyContactPhone,
      p_emergency_contact_relationship: input.emergencyContactRelationship,
      p_push: input.push,
      p_sms: input.sms,
      p_whatsapp: input.whatsapp,
      p_email: input.email,
    }),
  );
}
