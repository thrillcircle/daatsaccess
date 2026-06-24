import type { Database } from "@/integrations/supabase/types";

export type ServiceType = Database["public"]["Enums"]["service_type"];
export type JourneyPattern = Database["public"]["Enums"]["journey_pattern"];
export type BookingStatus = Database["public"]["Enums"]["booking_status"];
export type AssistanceCode = Database["public"]["Enums"]["assistance_requirement_code"];

export const ASSISTANCE_OPTIONS: { code: AssistanceCode; label: string; description: string }[] = [
  { code: "boarding_assistance", label: "Boarding assistance", description: "Help getting in and out of the vehicle." },
  { code: "wheelchair_transfer", label: "Wheelchair transfer", description: "Safe transfer between wheelchair and seat." },
  { code: "door_to_door", label: "Door-to-door support", description: "From front door to vehicle and back." },
  { code: "facility_escort", label: "Facility escort", description: "Walk-in to reception or department." },
  { code: "hospital_assistance", label: "Hospital assistance", description: "Support at hospital admissions and discharge." },
  { code: "airport_assistance", label: "Airport assistance", description: "Check-in, gate transfer and arrivals." },
  { code: "elderly_assistance", label: "Elderly assistance", description: "Patient, calm support for older passengers." },
  { code: "luggage_assistance", label: "Luggage assistance", description: "Carrying and loading bags." },
  { code: "mobility_equipment", label: "Mobility equipment", description: "Transport for wheelchair, walker or scooter." },
  { code: "communication_assistance", label: "Communication assistance", description: "Help if the traveller has speech or hearing needs." },
  { code: "other", label: "Other support", description: "Describe what's needed in the notes." },
];

export const ASSISTANCE_LABEL: Record<AssistanceCode, string> = Object.fromEntries(
  ASSISTANCE_OPTIONS.map((o) => [o.code, o.label]),
) as Record<AssistanceCode, string>;

export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  awaiting_quote: "Awaiting quote",
  quoted: "Quote sent",
  accepted: "Accepted",
  resources_assigned: "Resources assigned",
  active: "Active",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const SERVICE_TYPE_LABEL: Record<ServiceType, string> = {
  transport: "Access Transport",
  assisted: "Access Assisted",
  appointment: "Access Appointment",
  extended_journey: "Access Extended Journey",
};

export function bookingStatusVariant(status: BookingStatus): "default" | "secondary" | "outline" | "destructive" {
  if (status === "cancelled") return "destructive";
  if (status === "completed" || status === "active") return "default";
  if (status === "awaiting_quote" || status === "quoted") return "secondary";
  return "outline";
}

// ============ Appointment journey options (additive, UI-only) ============
export type AppointmentPattern = "dropoff" | "dropoff_collect" | "wait_return" | "recurring";

export const APPOINTMENT_PATTERN_LABEL: Record<AppointmentPattern, string> = {
  dropoff: "Drop-off only",
  dropoff_collect: "Drop-off and later collection",
  wait_return: "Wait and return",
  recurring: "Recurring appointment",
};

export const APPOINTMENT_PATTERN_DESCRIPTION: Record<AppointmentPattern, string> = {
  dropoff: "We drop you at the facility — you arrange your own return.",
  dropoff_collect: "We drop you off, then a separate return ride collects you when you're done.",
  wait_return: "The team waits at the facility while you're seen, then takes you home.",
  recurring: "Repeat the same appointment booking weekly or on a custom schedule.",
};

export type RecurrenceFrequency = "weekly" | "biweekly" | "monthly" | "custom";

export type RecurrenceRule = {
  frequency: RecurrenceFrequency;
  interval: number; // weeks or months between occurrences
  weekdays?: number[]; // 0-6, Sun..Sat (weekly/biweekly/custom only)
  end_date?: string | null;
  occurrences?: number | null;
};

// ============ Extended Journey (Phase 5D) ============
export type ExtendedDurationPreset = "three_days" | "five_days" | "seven_days" | "custom";

export const EXTENDED_DURATION_LABEL: Record<ExtendedDurationPreset, string> = {
  three_days: "3 days",
  five_days: "5 days",
  seven_days: "7 days",
  custom: "Custom",
};

export const EXTENDED_DURATION_DAYS: Record<Exclude<ExtendedDurationPreset, "custom">, number> = {
  three_days: 3,
  five_days: 5,
  seven_days: 7,
};

export type ExtendedItineraryItemType =
  | "ride"
  | "activity"
  | "waiting"
  | "appointment"
  | "accommodation"
  | "other";

export const EXTENDED_ITEM_LABEL: Record<ExtendedItineraryItemType, string> = {
  ride: "Ride leg",
  activity: "Activity / destination",
  waiting: "Waiting period",
  appointment: "Appointment",
  accommodation: "Accommodation",
  other: "Notes",
};

export type ExtendedItineraryItem = {
  day: number;
  sequence: number;
  type: ExtendedItineraryItemType;
  title: string;
  start_time?: string | null; // HH:MM
  end_time?: string | null;
  address?: string | null;
  notes?: string | null;
};

export type ExtendedJourneyMetadata = {
  duration_preset: ExtendedDurationPreset;
  group_size: number;
  additional_travellers: { full_name: string; phone?: string | null; relationship?: string | null }[];
  wheelchair_count: number;
  mobility_equipment_count: number;
  starting_location: string;
  main_destination: string;
  planned_destinations: string[];
  luggage_requirements: string;
  accommodation_requirements: string;
  overnight_support_requirements: string;
  emergency_contact: { name: string; phone: string; relationship?: string | null };
  general_support_instructions: string;
};

// Quote line item categories for Extended Journey
export type QuoteLineCategory =
  | "base_transport"
  | "distance"
  | "driver_time"
  | "companion_hours"
  | "waiting_time"
  | "additional_legs"
  | "parking"
  | "tolls"
  | "overnight"
  | "accommodation"
  | "other"
  | "deposit";

export const QUOTE_LINE_LABEL: Record<QuoteLineCategory, string> = {
  base_transport: "Base transport",
  distance: "Distance",
  driver_time: "Driver time",
  companion_hours: "Companion hours",
  waiting_time: "Waiting time",
  additional_legs: "Additional ride legs",
  parking: "Parking",
  tolls: "Tolls",
  overnight: "Overnight requirements",
  accommodation: "Accommodation",
  other: "Other approved cost",
  deposit: "Deposit",
};
