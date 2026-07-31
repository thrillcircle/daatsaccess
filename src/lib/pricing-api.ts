import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type {
  PricingCalculationType,
  PricingInputs,
  PricingServiceCode,
} from "@/lib/pricing-engine";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue | undefined }
  | JsonValue[];

export type PricingVersionStatus = "draft" | "published" | "retired";

export type PricingVersionRow = {
  id: string;
  service_code: PricingServiceCode;
  version_number: number;
  name: string;
  description: string | null;
  currency: string;
  status: PricingVersionStatus;
  effective_from: string | null;
  effective_to: string | null;
  is_mock: boolean;
  source_rule_id: string | null;
  created_by: string | null;
  published_by: string | null;
  published_at: string | null;
  retired_at: string | null;
  row_version: number;
  created_at: string;
  updated_at: string;
};

export type PricingComponentRow = {
  id: string;
  pricing_version_id: string;
  service_code: PricingServiceCode;
  component_code: string;
  customer_label: string;
  internal_description: string | null;
  calculation_type: PricingCalculationType;
  amount: number;
  minimum_quantity: number;
  maximum_quantity: number | null;
  applicability_conditions: JsonValue;
  calculation_order: number;
  customer_visible: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type PricingAuditRow = {
  id: string;
  pricing_version_id: string | null;
  event_type: string;
  previous_value: JsonValue;
  new_value: JsonValue;
  reason: string | null;
  performed_by: string | null;
  created_at: string;
};

export type PricingCalculationSnapshot = {
  engine_version: string;
  calculated_at: string;
  pricing_version_id: string;
  pricing_version_number: number;
  service_code: PricingServiceCode;
  currency: "ZAR";
  is_mock: boolean;
  inputs: PricingInputs;
  warnings: string[];
  lines: Array<{
    component_id?: string;
    component_code: string;
    label: string;
    calculation_type: PricingCalculationType;
    quantity: number;
    unit: string;
    unit_price: number;
    line_subtotal: number;
    adjustment: number;
    line_total: number;
    customer_visible: boolean;
    calculation_order: number;
  }>;
  subtotal: number;
  margin_amount: number;
  adjustments_total: number;
  total: number;
};

export type PassengerEstimate = {
  engine_version: string;
  calculated_at: string;
  pricing_version_id: string;
  pricing_version_number: number;
  service_code: "ride" | "transport";
  currency: "ZAR";
  distance_km: number;
  warnings: string[];
  lines: Array<{
    component_code: string;
    label: string;
    quantity: number;
    unit: string;
    unit_price: number;
    line_total: number;
  }>;
  total: number;
};

export type QuoteSummary = {
  id: string;
  booking_id: string;
  quote_reference: string;
  status: string;
  revision_number: number;
  currency: string;
  subtotal?: number;
  adjustments_total?: number;
  final_total: number;
  valid_until: string | null;
  sent_at: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  expired_at: string | null;
  superseded_at: string | null;
  row_version: number;
};

export type PricingDatabase = {
  public: {
    Tables: {
      pricing_versions: {
        Row: PricingVersionRow;
        Insert: Partial<PricingVersionRow>;
        Update: Partial<PricingVersionRow>;
        Relationships: [];
      };
      pricing_components: {
        Row: PricingComponentRow;
        Insert: Partial<PricingComponentRow>;
        Update: Partial<PricingComponentRow>;
        Relationships: [];
      };
      pricing_audit_events: {
        Row: PricingAuditRow;
        Insert: Partial<PricingAuditRow>;
        Update: Partial<PricingAuditRow>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      admin_pricing_calculate: {
        Args: {
          p_service_code: string;
          p_inputs?: JsonValue;
          p_effective_at?: string;
          p_pricing_version_id?: string;
        };
        Returns: JsonValue;
      };
      passenger_pricing_estimate: {
        Args: {
          p_service_code: string;
          p_distance_km: number;
          p_effective_at?: string;
          p_additional_inputs?: JsonValue;
        };
        Returns: JsonValue;
      };
      passenger_create_priced_ride: {
        Args: {
          p_pickup_address: string;
          p_pickup_lat: number;
          p_pickup_lng: number;
          p_pickup_place_id: string | null;
          p_destination_address: string;
          p_destination_lat: number;
          p_destination_lng: number;
          p_destination_place_id: string | null;
          p_distance_km: number;
          p_duration_seconds: number | null;
          p_request_type: string;
          p_scheduled_at: string | null;
          p_idempotency_key?: string;
        };
        Returns: JsonValue;
      };
      passenger_create_transport_booking: {
        Args: {
          p_pickup_address: string;
          p_pickup_lat: number;
          p_pickup_lng: number;
          p_pickup_place_id: string | null;
          p_destination_address: string;
          p_destination_lat: number;
          p_destination_lng: number;
          p_destination_place_id: string | null;
          p_distance_km: number;
          p_duration_seconds: number | null;
          p_request_type: string;
          p_scheduled_at: string | null;
          p_traveller_is_self: boolean;
          p_traveller_name: string;
          p_traveller_phone: string;
          p_relationship: string;
          p_assistance_codes?: string[];
          p_passenger_notes?: string;
          p_idempotency_key?: string;
        };
        Returns: JsonValue;
      };
      passenger_update_priced_ride_route: {
        Args: {
          p_ride_id: string;
          p_pickup: JsonValue | null;
          p_destination: JsonValue | null;
          p_distance_km: number;
          p_duration_seconds: number | null;
          p_expected_route_version: number;
        };
        Returns: JsonValue;
      };
      admin_create_pricing_draft: {
        Args: {
          p_service_code: string;
          p_clone_from_version_id?: string;
          p_name?: string;
          p_effective_from?: string;
          p_idempotency_key?: string;
        };
        Returns: JsonValue;
      };
      admin_save_pricing_draft: {
        Args: {
          p_version_id: string;
          p_name: string;
          p_description: string;
          p_effective_from: string | null;
          p_effective_to: string | null;
          p_is_mock: boolean;
          p_components: JsonValue;
          p_expected_row_version: number;
        };
        Returns: JsonValue;
      };
      admin_validate_pricing_version: {
        Args: { p_version_id: string };
        Returns: JsonValue;
      };
      admin_publish_pricing_version: {
        Args: { p_version_id: string; p_expected_row_version: number; p_confirmation: string };
        Returns: JsonValue;
      };
      admin_delete_pricing_draft: {
        Args: { p_version_id: string; p_reason: string; p_expected_row_version: number };
        Returns: JsonValue;
      };
      admin_retire_pricing_version: {
        Args: { p_version_id: string; p_reason: string; p_expected_row_version: number };
        Returns: JsonValue;
      };
      admin_quote_summaries: {
        Args: { p_booking_ids?: string[] };
        Returns: JsonValue;
      };
      admin_quote_workspace: {
        Args: { p_booking_id: string };
        Returns: JsonValue;
      };
      passenger_quote_summaries: { Args: Record<string, never>; Returns: JsonValue };
      passenger_quote_workspace: { Args: { p_booking_id: string }; Returns: JsonValue };
      admin_generate_service_quote: {
        Args: {
          p_booking_id: string;
          p_inputs: JsonValue;
          p_valid_until: string;
          p_expected_booking_status?: string;
          p_idempotency_key?: string;
        };
        Returns: JsonValue;
      };
      admin_apply_quote_override: {
        Args: {
          p_quote_id: string;
          p_adjustment: number;
          p_reason: string;
          p_expected_row_version: number;
        };
        Returns: JsonValue;
      };
      admin_recalculate_service_quote: {
        Args: {
          p_quote_id: string;
          p_inputs: JsonValue;
          p_valid_until: string;
          p_expected_row_version: number;
          p_idempotency_key?: string;
        };
        Returns: JsonValue;
      };
      admin_cancel_service_quote: {
        Args: {
          p_quote_id: string;
          p_reason: string;
          p_expected_row_version: number;
          p_idempotency_key?: string;
        };
        Returns: JsonValue;
      };
      admin_send_service_quote: {
        Args: {
          p_quote_id: string;
          p_valid_until: string;
          p_expected_row_version: number;
          p_idempotency_key?: string;
        };
        Returns: JsonValue;
      };
      passenger_accept_service_quote: {
        Args: { p_quote_id: string; p_expected_row_version: number; p_idempotency_key?: string };
        Returns: JsonValue;
      };
      passenger_decline_service_quote: {
        Args: { p_quote_id: string; p_expected_row_version: number; p_reason?: string };
        Returns: JsonValue;
      };
      admin_set_quote_deposit: {
        Args: {
          p_quote_id: string;
          p_required: boolean;
          p_amount: number;
          p_reason: string;
          p_expected_row_version: number;
        };
        Returns: JsonValue;
      };
      admin_expire_service_quotes: { Args: Record<string, never>; Returns: number };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export const pricingDb = supabase as unknown as SupabaseClient<PricingDatabase>;

export function asCalculationSnapshot(value: JsonValue | null): PricingCalculationSnapshot | null {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const candidate = value as unknown as PricingCalculationSnapshot;
  return Array.isArray(candidate.lines) && Array.isArray(candidate.warnings) ? candidate : null;
}

export function asPassengerEstimate(value: JsonValue | null): PassengerEstimate | null {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const candidate = value as unknown as PassengerEstimate;
  return typeof candidate.total === "number" && Array.isArray(candidate.lines) ? candidate : null;
}

export function asQuoteSummaries(value: JsonValue | null): QuoteSummary[] {
  return Array.isArray(value) ? (value as unknown as QuoteSummary[]) : [];
}
