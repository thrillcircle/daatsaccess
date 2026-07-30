export type SupportRole = "passenger" | "driver" | "admin";
export type SupportPriority = "low" | "normal" | "high" | "urgent";
export type SupportStatus =
  | "open"
  | "triage"
  | "assigned"
  | "waiting_for_user"
  | "in_progress"
  | "resolved"
  | "closed";
export type SupportCategory =
  | "trip_issue"
  | "scheduled_trip"
  | "service_booking"
  | "quote_question"
  | "driver_issue"
  | "vehicle_issue"
  | "account_profile"
  | "accessibility_assistance"
  | "complaint"
  | "lost_property"
  | "other";

export type SupportTicket = {
  id: string;
  ticket_reference: string;
  created_by: string;
  requester_role: SupportRole;
  passenger_id: string | null;
  driver_id: string | null;
  assigned_admin_id: string | null;
  ride_id: string | null;
  service_booking_id: string | null;
  category: SupportCategory;
  priority: SupportPriority;
  status: SupportStatus;
  subject: string;
  description: string;
  resolution_summary: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  closed_at: string | null;
};

export type SupportMessage = {
  id: string;
  ticket_id: string;
  sender_id: string;
  sender_role: SupportRole;
  message: string;
  is_internal_note: boolean;
  created_at: string;
};

export type SupportEvent = {
  id: string;
  ticket_id: string;
  event_type: string;
  previous_value: unknown;
  new_value: unknown;
  performed_by: string | null;
  created_at: string;
};

export const SUPPORT_CATEGORIES: { value: SupportCategory; label: string }[] = [
  { value: "trip_issue", label: "Trip issue" },
  { value: "scheduled_trip", label: "Scheduled trip" },
  { value: "service_booking", label: "Service booking" },
  { value: "quote_question", label: "Quote question" },
  { value: "driver_issue", label: "Driver issue" },
  { value: "vehicle_issue", label: "Vehicle issue" },
  { value: "account_profile", label: "Account or profile" },
  { value: "accessibility_assistance", label: "Accessibility assistance" },
  { value: "complaint", label: "Complaint" },
  { value: "lost_property", label: "Lost property" },
  { value: "other", label: "Other" },
];

export const SUPPORT_STATUSES: { value: SupportStatus; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "triage", label: "Triage" },
  { value: "assigned", label: "Assigned" },
  { value: "waiting_for_user", label: "Waiting for user" },
  { value: "in_progress", label: "In progress" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
];

export const SUPPORT_PRIORITIES: { value: SupportPriority; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

export const SUPPORT_FAQS = [
  {
    question: "My driver has not arrived",
    category: "trip_issue" as SupportCategory,
    subject: "Driver has not arrived",
    answer:
      "Check the live trip status and driver location first. If the pickup time has passed or the location is not updating, create a trip-linked support ticket so Access Operations can review it.",
  },
  {
    question: "How do I change a pickup?",
    category: "trip_issue" as SupportCategory,
    subject: "Change pickup location",
    answer:
      "Use the trip edit option before collection when it is available. The driver must receive and acknowledge route changes after assignment.",
  },
  {
    question: "How do I change a destination?",
    category: "trip_issue" as SupportCategory,
    subject: "Change destination",
    answer:
      "Use the destination edit option on the active trip. The route and passenger estimate are recalculated, and the driver receives a change alert.",
  },
  {
    question: "How do scheduled trips work?",
    category: "scheduled_trip" as SupportCategory,
    subject: "Scheduled trip question",
    answer:
      "Scheduled rides appear under My Trips. Access Operations will add automated late-trip monitoring in the reliability phase.",
  },
  {
    question: "Where do I find my quote?",
    category: "quote_question" as SupportCategory,
    subject: "Find or review service quote",
    answer:
      "Open My Trips and select the specialised service request. Quotes appear after Access Operations completes the resource and pricing review.",
  },
  {
    question: "How do I accept a quote?",
    category: "quote_question" as SupportCategory,
    subject: "Accept service quote",
    answer:
      "Open the quoted service request in My Trips and use the quote acceptance action when it is available. Payments are not yet active.",
  },
  {
    question: "How do I update my profile?",
    category: "account_profile" as SupportCategory,
    subject: "Update profile",
    answer:
      "Open Profile to update passenger or administrator personal details. Driver operational and vehicle records are managed by Access administration.",
  },
  {
    question: "How do I report a vehicle issue?",
    category: "vehicle_issue" as SupportCategory,
    subject: "Vehicle issue",
    answer:
      "Create a vehicle issue ticket and state whether the vehicle is safe to continue. Access Operations will review it; drivers cannot change maintenance status themselves.",
  },
] as const;

export function supportCategoryLabel(value: string): string {
  return (
    SUPPORT_CATEGORIES.find((item) => item.value === value)?.label ?? value.replaceAll("_", " ")
  );
}

export function supportStatusLabel(value: string): string {
  return SUPPORT_STATUSES.find((item) => item.value === value)?.label ?? value.replaceAll("_", " ");
}

export function supportPriorityLabel(value: string): string {
  return SUPPORT_PRIORITIES.find((item) => item.value === value)?.label ?? value;
}

export function containsUrgentSupportLanguage(value: string): boolean {
  return /(immediate danger|unsafe|stranded|assault|emergency|threat|medical crisis)/i.test(value);
}

export function supportAge(createdAt: string): string {
  const milliseconds = Date.now() - new Date(createdAt).getTime();
  if (milliseconds < 60_000) return "just now";
  if (milliseconds < 3_600_000) return `${Math.floor(milliseconds / 60_000)}m`;
  if (milliseconds < 86_400_000) return `${Math.floor(milliseconds / 3_600_000)}h`;
  return `${Math.floor(milliseconds / 86_400_000)}d`;
}
