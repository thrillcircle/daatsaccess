import { supabase } from "@/integrations/supabase/client";

type RpcResult<T> = { data: T | null; error: { message: string } | null };
type UntypedRpc = (name: string, args?: Record<string, unknown>) => Promise<RpcResult<unknown>>;
const rpc = supabase.rpc.bind(supabase) as unknown as UntypedRpc;

async function call<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export type SafetyReporterRole = "passenger" | "driver";
export type SafetyStatus = "open" | "acknowledged" | "responding" | "resolved" | "closed";
export type SafetyCategory =
  | "medical_emergency"
  | "driver_concern"
  | "vehicle_problem"
  | "accident"
  | "unsafe_situation"
  | "passenger_medical_emergency"
  | "vehicle_breakdown"
  | "safety_security"
  | "unable_to_continue"
  | "other_emergency";

export type SafetyIncident = {
  id: string;
  incident_reference: string;
  reported_by: string;
  reporter_role: SafetyReporterRole;
  passenger_id: string | null;
  driver_id: string | null;
  ride_id: string;
  vehicle_id: string | null;
  category: SafetyCategory;
  severity: "high" | "critical";
  status: SafetyStatus;
  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
  description: string | null;
  assigned_admin_id: string | null;
  response_notes: string | null;
  resolution_summary: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  reporter_name?: string | null;
  passenger_name?: string | null;
  driver_name?: string | null;
  vehicle_name?: string | null;
  license_plate?: string | null;
};

export async function reportSafetyIncident(input: {
  rideId: string;
  category: SafetyCategory;
  latitude?: number | null;
  longitude?: number | null;
  accuracyM?: number | null;
  description?: string | null;
}) {
  return call<{ id: string; reference: string; status: SafetyStatus; severity: string }>(
    "report_safety_incident",
    {
      p_ride_id: input.rideId,
      p_category: input.category,
      p_latitude: input.latitude ?? undefined,
      p_longitude: input.longitude ?? undefined,
      p_accuracy_m: input.accuracyM ?? undefined,
      p_description: input.description ?? undefined,
    },
  );
}

export function listSafetyIncidents(limit = 250) {
  return call<SafetyIncident[]>("admin_list_safety_incidents", { p_limit: limit });
}

export function updateSafetyIncident(input: {
  incidentId: string;
  status: SafetyStatus;
  responseNotes?: string | null;
  resolutionSummary?: string | null;
  assignToSelf?: boolean;
}) {
  return call<SafetyIncident>("admin_update_safety_incident", {
    p_incident_id: input.incidentId,
    p_status: input.status,
    p_response_notes: input.responseNotes ?? undefined,
    p_resolution_summary: input.resolutionSummary ?? undefined,
    p_assign_to_self: input.assignToSelf ?? false,
  });
}

export type PaymentRefund = {
  id: string;
  payment_id: string;
  amount: number | string;
  currency: string;
  reason: string;
  status: "requested" | "processing" | "completed" | "failed" | "cancelled" | "action_required";
  automatic?: boolean;
  settlement_type?: string | null;
  action_required_reason?: string | null;
  provider_status?: string | null;
  failure_reason?: string | null;
  completed_at?: string | null;
  created_at: string;
  ride_id?: string | null;
  passenger_id?: string | null;
  passenger_name?: string | null;
  merchant_payment_id?: string | null;
  provider_payment_id?: string | null;
};

export function listRideRefunds(rideId: string) {
  return call<PaymentRefund[]>("list_ride_refunds", { p_ride_id: rideId });
}

export function adminListPaymentRefunds(limit = 250) {
  return call<PaymentRefund[]>("admin_list_payment_refunds", { p_limit: limit });
}

export async function processPayfastRefund(refundId: string) {
  const { data, error } = await supabase.functions.invoke("payfast-refund", {
    body: { refund_id: refundId },
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(String(data.error));
  return data as { status: "completed" | "action_required"; message?: string };
}

export type NotificationPreferences = {
  user_id: string;
  in_app: boolean;
  push: boolean;
  sms: boolean;
  whatsapp: boolean;
  email: boolean;
  updated_at: string;
};

export function getNotificationPreferences() {
  return call<NotificationPreferences>("get_notification_preferences");
}

export function updateNotificationPreferences(input: {
  push: boolean;
  sms: boolean;
  whatsapp: boolean;
  email: boolean;
}) {
  return call<NotificationPreferences>("update_notification_preferences", {
    p_push: input.push,
    p_sms: input.sms,
    p_whatsapp: input.whatsapp,
    p_email: input.email,
  });
}

export type PolicyDocument = {
  id: string;
  policy_type: "privacy" | "terms" | "cancellation" | "transport_terms";
  version: string;
  title: string;
  content: string | null;
  document_url: string | null;
  effective_at: string | null;
  accepted_at: string | null;
};

export type PrivacyRequest = {
  id: string;
  user_id: string;
  request_type: "data_export" | "account_deletion";
  status: "requested" | "in_progress" | "completed" | "rejected" | "cancelled";
  user_note: string | null;
  admin_note: string | null;
  resolution_summary: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  full_name?: string | null;
  phone?: string | null;
};

export type ComplianceSnapshot = {
  policies: PolicyDocument[];
  privacy_requests: PrivacyRequest[];
};

export function getComplianceSnapshot() {
  return call<ComplianceSnapshot>("user_compliance_snapshot");
}

export function acceptPolicy(policyDocumentId: string) {
  return call("user_accept_policy", { p_policy_document_id: policyDocumentId });
}

export function submitPrivacyRequest(
  requestType: PrivacyRequest["request_type"],
  userNote?: string,
) {
  return call<PrivacyRequest>("user_submit_privacy_request", {
    p_request_type: requestType,
    p_user_note: userNote ?? undefined,
  });
}

export function adminListPrivacyRequests(limit = 250) {
  return call<PrivacyRequest[]>("admin_list_privacy_requests", { p_limit: limit });
}

export function adminUpdatePrivacyRequest(input: {
  requestId: string;
  status: PrivacyRequest["status"];
  adminNote?: string | null;
  resolutionSummary?: string | null;
}) {
  return call<PrivacyRequest>("admin_update_privacy_request", {
    p_request_id: input.requestId,
    p_status: input.status,
    p_admin_note: input.adminNote ?? undefined,
    p_resolution_summary: input.resolutionSummary ?? undefined,
  });
}

export type CommercialSnapshot = {
  generated_at: string;
  operations: {
    trips_today: number;
    requested: number;
    accepted: number;
    in_progress: number;
    completed_today: number;
    cancelled_today: number;
  };
  payments: {
    collected_today: number | string;
    pending: number;
    failed_today: number;
    refunds_requested: number;
    refunds_completed_today: number;
    cancellation_charges_today: number | string;
  };
  system: {
    notification_failures: number;
    external_channels_action_required: number;
    open_safety_incidents: number;
    urgent_support_cases: number;
    open_privacy_requests: number;
    scheduler_failures_24h: number;
    unresolved_operational_alerts: number;
  };
};

export function getCommercialSnapshot() {
  return call<CommercialSnapshot>("admin_commercial_snapshot");
}

export function updateSupportCaseMetadata(input: {
  ticketId: string;
  caseSeverity: "low" | "normal" | "high" | "critical";
  decisionType?: "refund" | "charge" | "no_adjustment" | "operational_resolution" | "other" | null;
  decisionAmount?: number | null;
  evidence?: unknown[];
}) {
  return call("support_admin_update_case_metadata", {
    p_ticket_id: input.ticketId,
    p_case_severity: input.caseSeverity,
    p_decision_type: input.decisionType ?? undefined,
    p_decision_amount: input.decisionAmount ?? undefined,
    p_evidence: input.evidence ?? undefined,
  });
}
