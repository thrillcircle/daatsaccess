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
