from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    if old not in text:
        raise RuntimeError(f"Expected text not found in {path}: {old[:120]!r}")
    file.write_text(text.replace(old, new, 1))


def replace_all(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    if old not in text:
        return
    file.write_text(text.replace(old, new))


# Admin-originated passenger support cases.
passenger_detail = "src/routes/app.admin.passengers.$passengerId.tsx"
replace_once(
    passenger_detail,
    'import { AdminShell } from "@/components/AdminShell";\n',
    'import { AdminShell } from "@/components/AdminShell";\nimport { AdminCreateSupportTicketDialog } from "@/components/support/AdminCreateSupportTicketDialog";\n',
)
replace_once(
    passenger_detail,
    '''      actions={
        profile.phone ? (
          <Button asChild size="sm" variant="outline">
            <a href={`tel:${profile.phone}`}>
              <Phone className="mr-1 h-4 w-4" /> Call passenger
            </a>
          </Button>
        ) : null
      }
''',
    '''      actions={
        <div className="flex flex-wrap gap-2">
          <AdminCreateSupportTicketDialog
            passengerId={profile.user_id}
            passengerName={profile.full_name ?? "Passenger"}
          />
          {profile.phone ? (
            <Button asChild size="sm" variant="outline">
              <a href={`tel:${profile.phone}`}>
                <Phone className="mr-1 h-4 w-4" /> Call passenger
              </a>
            </Button>
          ) : null}
        </div>
      }
''',
)

# Context-aware Support page search values.
support_route = "src/routes/app.support.tsx"
replace_once(
    support_route,
    '''type BookingOption = {
  id: string;
  booking_reference: string;
  service_type: string;
  status: string;
};

export const Route = createFileRoute("/app/support")({
  head: () => ({ meta: [{ title: "Support — Access" }] }),
  component: SupportPage,
});
''',
    '''type BookingOption = {
  id: string;
  booking_reference: string;
  service_type: string;
  status: string;
};

type SupportSearch = {
  rideId: string;
  bookingId: string;
  category: SupportCategory | "";
  subject: string;
};

const SUPPORT_CATEGORY_VALUES = new Set(SUPPORT_CATEGORIES.map((item) => item.value));

export const Route = createFileRoute("/app/support")({
  validateSearch: (search: Record<string, unknown>): SupportSearch => ({
    rideId: typeof search.rideId === "string" ? search.rideId : "",
    bookingId: typeof search.bookingId === "string" ? search.bookingId : "",
    category:
      typeof search.category === "string" &&
      SUPPORT_CATEGORY_VALUES.has(search.category as SupportCategory)
        ? (search.category as SupportCategory)
        : "",
    subject: typeof search.subject === "string" ? search.subject.slice(0, 160) : "",
  }),
  head: () => ({ meta: [{ title: "Support — Access" }] }),
  component: SupportPage,
});
''',
)
replace_once(
    support_route,
    '''  const { user, loading: authLoading } = useAuth();
  const { roles, loading: rolesLoading } = useUserRoles(user?.id);
  const navigate = useNavigate();
''',
    '''  const { user, loading: authLoading } = useAuth();
  const { roles, loading: rolesLoading } = useUserRoles(user?.id);
  const navigate = useNavigate();
  const search = Route.useSearch();
''',
)
replace_once(
    support_route,
    '''  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [assistantAnswer, setAssistantAnswer] = useState<string | null>(null);
  const [requesterRole, setRequesterRole] = useState<SupportRole>("passenger");
  const [category, setCategory] = useState<SupportCategory>("trip_issue");
  const [priority, setPriority] = useState<Extract<SupportPriority, "normal" | "high">>("normal");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [rideId, setRideId] = useState("");
  const [bookingId, setBookingId] = useState("");
''',
    '''  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(
    Boolean(search.rideId || search.bookingId || search.category || search.subject),
  );
  const [assistantAnswer, setAssistantAnswer] = useState<string | null>(null);
  const [requesterRole, setRequesterRole] = useState<SupportRole>("passenger");
  const [category, setCategory] = useState<SupportCategory>(search.category || "trip_issue");
  const [priority, setPriority] = useState<Extract<SupportPriority, "normal" | "high">>("normal");
  const [subject, setSubject] = useState(search.subject);
  const [description, setDescription] = useState("");
  const [rideId, setRideId] = useState(search.rideId);
  const [bookingId, setBookingId] = useState(search.bookingId);
''',
)
replace_once(
    support_route,
    '''  useEffect(() => {
    if (!availableRoles.includes(requesterRole)) setRequesterRole(availableRoles[0]);
  }, [availableRoles, requesterRole]);
''',
    '''  useEffect(() => {
    if (!availableRoles.includes(requesterRole)) setRequesterRole(availableRoles[0]);
  }, [availableRoles, requesterRole]);

  useEffect(() => {
    if (search.rideId) setRideId(search.rideId);
    if (search.bookingId) setBookingId(search.bookingId);
    if (search.category) setCategory(search.category);
    if (search.subject) setSubject(search.subject);
    if (search.rideId || search.bookingId || search.category || search.subject) setShowForm(true);
  }, [search.bookingId, search.category, search.rideId, search.subject]);
''',
)

# Trip-level Support access for both passengers and drivers.
trip_route = "src/routes/app.trip.$rideId.tsx"
replace_once(
    trip_route,
    'import { useEffect, useState } from "react";\n',
    'import { useEffect, useState } from "react";\nimport { LifeBuoy } from "lucide-react";\n',
)
replace_once(
    trip_route,
    '''          <section className="rounded-2xl border bg-card p-4">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Rating
            </h3>
''',
    '''          <section className="rounded-2xl border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Support
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Open a case already linked to this trip.
                </p>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link
                  to="/app/support"
                  search={{
                    rideId: ride.id,
                    bookingId: "",
                    category: "trip_issue",
                    subject: `Trip support · ${ride.id.slice(0, 8)}`,
                  }}
                >
                  <LifeBuoy className="mr-1 h-4 w-4" /> Get help
                </Link>
              </Button>
            </div>
          </section>

          <section className="rounded-2xl border bg-card p-4">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Rating
            </h3>
''',
)

# Booking-level Support access.
bookings_route = "src/routes/app.passenger.bookings.tsx"
replace_once(
    bookings_route,
    'import { Plus, ChevronRight } from "lucide-react";\n',
    'import { ChevronRight, LifeBuoy, Plus } from "lucide-react";\n',
)
replace_once(
    bookings_route,
    '''                {b.status === "quoted" && q ? (
                  <div className="mt-2 flex flex-wrap gap-2">
''',
    '''                <div className="mt-2 flex justify-end">
                  <Button asChild size="sm" variant="ghost">
                    <Link
                      to="/app/support"
                      search={{
                        rideId: ride?.id ?? "",
                        bookingId: b.id,
                        category: "service_booking",
                        subject: `Service booking · ${b.booking_reference}`,
                      }}
                    >
                      <LifeBuoy className="mr-1 h-4 w-4" /> Support
                    </Link>
                  </Button>
                </div>

                {b.status === "quoted" && q ? (
                  <div className="mt-2 flex flex-wrap gap-2">
''',
)

# Driver vehicle/status Support access.
driver_profile = "src/components/profile/DriverProfileSections.tsx"
replace_once(
    driver_profile,
    'import { useEffect, useMemo, useState, type ReactNode } from "react";\n',
    'import { useEffect, useMemo, useState, type ReactNode } from "react";\nimport { Link } from "@tanstack/react-router";\n',
)
replace_once(
    driver_profile,
    'import { CalendarRange, Car, Loader2, MapPinned, ShieldCheck, Star } from "lucide-react";\n',
    'import { CalendarRange, Car, LifeBuoy, Loader2, MapPinned, ShieldCheck, Star } from "lucide-react";\n',
)
replace_once(
    driver_profile,
    'import { Badge } from "@/components/ui/badge";\n',
    'import { Badge } from "@/components/ui/badge";\nimport { Button } from "@/components/ui/button";\n',
)
replace_once(
    driver_profile,
    '''        <p className="mt-4 flex items-start gap-2 rounded-xl bg-secondary p-3 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Vehicle and driver records are managed by Access administration. Drivers can report issues through Support but cannot edit vehicle master data or maintenance status.
        </p>
''',
    '''        <p className="mt-4 flex items-start gap-2 rounded-xl bg-secondary p-3 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Vehicle and driver records are managed by Access administration. Drivers can report issues through Support but cannot edit vehicle master data or maintenance status.
        </p>
        <Button asChild variant="outline" className="mt-3 w-full">
          <Link
            to="/app/support"
            search={{
              rideId: "",
              bookingId: "",
              category: "vehicle_issue",
              subject: driver?.license_plate
                ? `Vehicle issue · ${driver.license_plate}`
                : "Vehicle or driver operations issue",
            }}
          >
            <LifeBuoy className="mr-1 h-4 w-4" /> Report a vehicle or operational issue
          </Link>
        </Button>
''',
)

# Refresh the generated Supabase types with Phase 1 pricing and Phase 2 profile/support schema.
types_path = Path("src/integrations/supabase/types.ts")
types = types_path.read_text()

passenger_tables = '''      passenger_preferences: {
        Row: {
          communication_support_notes: string | null
          created_at: string
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          emergency_contact_relationship: string | null
          general_assistance_notes: string | null
          mobility_device_notes: string | null
          passenger_id: string
          preferred_contact_method: string
          updated_at: string
          wheelchair_user: boolean
        }
        Insert: {
          communication_support_notes?: string | null
          created_at?: string
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          emergency_contact_relationship?: string | null
          general_assistance_notes?: string | null
          mobility_device_notes?: string | null
          passenger_id: string
          preferred_contact_method?: string
          updated_at?: string
          wheelchair_user?: boolean
        }
        Update: {
          communication_support_notes?: string | null
          created_at?: string
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          emergency_contact_relationship?: string | null
          general_assistance_notes?: string | null
          mobility_device_notes?: string | null
          passenger_id?: string
          preferred_contact_method?: string
          updated_at?: string
          wheelchair_user?: boolean
        }
        Relationships: []
      }
      passenger_saved_addresses: {
        Row: {
          created_at: string
          formatted_address: string
          id: string
          is_default: boolean
          label: string
          latitude: number
          longitude: number
          passenger_id: string
          place_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          formatted_address: string
          id?: string
          is_default?: boolean
          label: string
          latitude: number
          longitude: number
          passenger_id: string
          place_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          formatted_address?: string
          id?: string
          is_default?: boolean
          label?: string
          latitude?: number
          longitude?: number
          passenger_id?: string
          place_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
'''
if "      passenger_preferences: {" not in types:
    types = types.replace("      payments: {", passenger_tables + "      payments: {", 1)

pricing_table = '''      service_pricing_rules: {
        Row: {
          base_fare: number
          companion_daily_rate: number
          companion_hourly_rate: number
          companion_minimum_hours: number
          created_at: string
          currency: string
          driver_daily_rate: number
          driver_overnight_rate: number
          effective_from: string
          id: string
          is_active: boolean
          is_mock: boolean
          per_km_rate: number
          per_minute_rate: number
          platform_margin_percent: number
          service_type: string
          specialist_vehicle_fee: number
          updated_at: string
          updated_by: string | null
          vehicle_daily_rate: number
          waiting_hourly_rate: number
        }
        Insert: {
          base_fare?: number
          companion_daily_rate?: number
          companion_hourly_rate?: number
          companion_minimum_hours?: number
          created_at?: string
          currency?: string
          driver_daily_rate?: number
          driver_overnight_rate?: number
          effective_from?: string
          id?: string
          is_active?: boolean
          is_mock?: boolean
          per_km_rate?: number
          per_minute_rate?: number
          platform_margin_percent?: number
          service_type: string
          specialist_vehicle_fee?: number
          updated_at?: string
          updated_by?: string | null
          vehicle_daily_rate?: number
          waiting_hourly_rate?: number
        }
        Update: {
          base_fare?: number
          companion_daily_rate?: number
          companion_hourly_rate?: number
          companion_minimum_hours?: number
          created_at?: string
          currency?: string
          driver_daily_rate?: number
          driver_overnight_rate?: number
          effective_from?: string
          id?: string
          is_active?: boolean
          is_mock?: boolean
          per_km_rate?: number
          per_minute_rate?: number
          platform_margin_percent?: number
          service_type?: string
          specialist_vehicle_fee?: number
          updated_at?: string
          updated_by?: string | null
          vehicle_daily_rate?: number
          waiting_hourly_rate?: number
        }
        Relationships: []
      }
'''
if "      service_pricing_rules: {" not in types:
    types = types.replace("      service_quote_items: {", pricing_table + "      service_quote_items: {", 1)

support_tables = '''      support_messages: {
        Row: {
          created_at: string
          id: string
          is_internal_note: boolean
          message: string
          sender_id: string
          sender_role: string
          ticket_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_internal_note?: boolean
          message: string
          sender_id: string
          sender_role: string
          ticket_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_internal_note?: boolean
          message?: string
          sender_id?: string
          sender_role?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_messages_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_ticket_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          new_value: Json | null
          performed_by: string | null
          previous_value: Json | null
          ticket_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          new_value?: Json | null
          performed_by?: string | null
          previous_value?: Json | null
          ticket_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          new_value?: Json | null
          performed_by?: string | null
          previous_value?: Json | null
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_ticket_events_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          assigned_admin_id: string | null
          category: string
          closed_at: string | null
          created_at: string
          created_by: string
          description: string
          driver_id: string | null
          id: string
          passenger_id: string | null
          priority: string
          requester_role: string
          resolution_summary: string | null
          resolved_at: string | null
          ride_id: string | null
          service_booking_id: string | null
          status: string
          subject: string
          ticket_reference: string
          updated_at: string
        }
        Insert: {
          assigned_admin_id?: string | null
          category: string
          closed_at?: string | null
          created_at?: string
          created_by: string
          description: string
          driver_id?: string | null
          id?: string
          passenger_id?: string | null
          priority?: string
          requester_role: string
          resolution_summary?: string | null
          resolved_at?: string | null
          ride_id?: string | null
          service_booking_id?: string | null
          status?: string
          subject: string
          ticket_reference?: string
          updated_at?: string
        }
        Update: {
          assigned_admin_id?: string | null
          category?: string
          closed_at?: string | null
          created_at?: string
          created_by?: string
          description?: string
          driver_id?: string | null
          id?: string
          passenger_id?: string | null
          priority?: string
          requester_role?: string
          resolution_summary?: string | null
          resolved_at?: string | null
          ride_id?: string | null
          service_booking_id?: string | null
          status?: string
          subject?: string
          ticket_reference?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_service_booking_id_fkey"
            columns: ["service_booking_id"]
            isOneToOne: false
            referencedRelation: "service_bookings"
            referencedColumns: ["id"]
          },
        ]
      }
'''
if "      support_tickets: {" not in types:
    types = types.replace("      user_roles: {", support_tables + "      user_roles: {", 1)

# Notifications gained a support ticket foreign key in Phase 2.
types = types.replace(
    "          ride_id: string | null\n          title: string\n",
    "          ride_id: string | null\n          support_ticket_id: string | null\n          title: string\n",
    1,
)
types = types.replace(
    "          ride_id?: string | null\n          title: string\n",
    "          ride_id?: string | null\n          support_ticket_id?: string | null\n          title: string\n",
    1,
)
types = types.replace(
    "          ride_id?: string | null\n          title?: string\n",
    "          ride_id?: string | null\n          support_ticket_id?: string | null\n          title?: string\n",
    1,
)
notification_relationship = '''          {
            foreignKeyName: "notifications_support_ticket_id_fkey"
            columns: ["support_ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
'''
if "notifications_support_ticket_id_fkey" not in types:
    marker = '''          {
            foreignKeyName: "notifications_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
'''
    types = types.replace(marker, marker + notification_relationship, 1)

support_functions = '''      support_add_message: {
        Args: {
          p_is_internal_note?: boolean
          p_message: string
          p_ticket_id: string
        }
        Returns: Database["public"]["Tables"]["support_messages"]["Row"]
      }
      support_admin_update_ticket: {
        Args: {
          p_assigned_admin_id?: string | null
          p_priority?: string | null
          p_resolution_summary?: string | null
          p_status?: string | null
          p_ticket_id: string
        }
        Returns: Database["public"]["Tables"]["support_tickets"]["Row"]
      }
      support_create_ticket: {
        Args: {
          p_category: string
          p_description: string
          p_driver_id?: string | null
          p_passenger_id?: string | null
          p_priority?: string
          p_requester_role: string
          p_ride_id?: string | null
          p_service_booking_id?: string | null
          p_subject: string
        }
        Returns: Database["public"]["Tables"]["support_tickets"]["Row"]
      }
'''
if "      support_create_ticket: {" not in types:
    types = types.replace("      verify_ride_start_pin: {", support_functions + "      verify_ride_start_pin: {", 1)

types_path.write_text(types)

# Remove the broad compatibility casts now that the generated schema is refreshed.
for path in [
    "src/components/AddressAutocomplete.tsx",
    "src/components/profile/PassengerProfileSections.tsx",
    "src/routes/app.admin.passengers.tsx",
    "src/routes/app.admin.passengers.$passengerId.tsx",
    "src/routes/app.admin.pricing-services.tsx",
    "src/routes/app.admin.support.tsx",
    "src/routes/app.admin.support.$ticketId.tsx",
    "src/routes/app.support.tsx",
    "src/routes/app.support.$ticketId.tsx",
]:
    replace_all(path, 'import type { SupabaseClient } from "@supabase/supabase-js";\n', "")
    replace_all(path, "const db = supabase as unknown as SupabaseClient;", "const db = supabase;")
    replace_all(path, "const profileDb = supabase as unknown as SupabaseClient;", "const profileDb = supabase;")
