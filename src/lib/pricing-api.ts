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

// The generated Supabase types now cover every Phase 4 pricing table and RPC,
// so the manual PricingDatabase bridge has been retired.
export const pricingDb = supabase;

/**
 * Generated RPC argument types cannot express a nullable Postgres parameter,
 * so optional arguments are passed through this identity helper.
 */
export function rpcNullable<T>(value: T | null | undefined): T {
  return (value ?? null) as T;
}




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
