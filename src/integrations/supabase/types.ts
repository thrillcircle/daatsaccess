export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_trip_notes: {
        Row: {
          admin_id: string
          created_at: string
          id: string
          is_emergency: boolean
          note: string
          ride_id: string
        }
        Insert: {
          admin_id: string
          created_at?: string
          id?: string
          is_emergency?: boolean
          note: string
          ride_id: string
        }
        Update: {
          admin_id?: string
          created_at?: string
          id?: string
          is_emergency?: boolean
          note?: string
          ride_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_trip_notes_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_assistance_requirements: {
        Row: {
          booking_id: string
          id: string
          notes: string | null
          quantity: number
          requirement_code: Database["public"]["Enums"]["assistance_requirement_code"]
        }
        Insert: {
          booking_id: string
          id?: string
          notes?: string | null
          quantity?: number
          requirement_code: Database["public"]["Enums"]["assistance_requirement_code"]
        }
        Update: {
          booking_id?: string
          id?: string
          notes?: string | null
          quantity?: number
          requirement_code?: Database["public"]["Enums"]["assistance_requirement_code"]
        }
        Relationships: [
          {
            foreignKeyName: "booking_assistance_requirements_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "service_bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_companion_assignments: {
        Row: {
          assigned_at: string
          booking_id: string
          companion_id: string
          id: string
          itinerary_item_id: string | null
          notes: string | null
          status: Database["public"]["Enums"]["assignment_status"]
        }
        Insert: {
          assigned_at?: string
          booking_id: string
          companion_id: string
          id?: string
          itinerary_item_id?: string | null
          notes?: string | null
          status?: Database["public"]["Enums"]["assignment_status"]
        }
        Update: {
          assigned_at?: string
          booking_id?: string
          companion_id?: string
          id?: string
          itinerary_item_id?: string | null
          notes?: string | null
          status?: Database["public"]["Enums"]["assignment_status"]
        }
        Relationships: [
          {
            foreignKeyName: "booking_companion_assignments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "service_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_companion_assignments_companion_id_fkey"
            columns: ["companion_id"]
            isOneToOne: false
            referencedRelation: "companion_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_companion_assignments_itinerary_item_id_fkey"
            columns: ["itinerary_item_id"]
            isOneToOne: false
            referencedRelation: "booking_itinerary_items"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_driver_assignments: {
        Row: {
          assigned_at: string
          assignment_role: string
          booking_id: string
          driver_user_id: string
          id: string
          itinerary_item_id: string | null
          notes: string | null
          status: Database["public"]["Enums"]["assignment_status"]
        }
        Insert: {
          assigned_at?: string
          assignment_role?: string
          booking_id: string
          driver_user_id: string
          id?: string
          itinerary_item_id?: string | null
          notes?: string | null
          status?: Database["public"]["Enums"]["assignment_status"]
        }
        Update: {
          assigned_at?: string
          assignment_role?: string
          booking_id?: string
          driver_user_id?: string
          id?: string
          itinerary_item_id?: string | null
          notes?: string | null
          status?: Database["public"]["Enums"]["assignment_status"]
        }
        Relationships: [
          {
            foreignKeyName: "booking_driver_assignments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "service_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_driver_assignments_itinerary_item_id_fkey"
            columns: ["itinerary_item_id"]
            isOneToOne: false
            referencedRelation: "booking_itinerary_items"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_itinerary_items: {
        Row: {
          actual_end_at: string | null
          actual_start_at: string | null
          address: string | null
          booking_id: string
          created_at: string
          day_number: number
          id: string
          item_type: Database["public"]["Enums"]["itinerary_item_type"]
          latitude: number | null
          longitude: number | null
          notes: string | null
          planned_end_at: string | null
          planned_start_at: string | null
          sequence_number: number
          status: string
          title: string | null
        }
        Insert: {
          actual_end_at?: string | null
          actual_start_at?: string | null
          address?: string | null
          booking_id: string
          created_at?: string
          day_number?: number
          id?: string
          item_type: Database["public"]["Enums"]["itinerary_item_type"]
          latitude?: number | null
          longitude?: number | null
          notes?: string | null
          planned_end_at?: string | null
          planned_start_at?: string | null
          sequence_number?: number
          status?: string
          title?: string | null
        }
        Update: {
          actual_end_at?: string | null
          actual_start_at?: string | null
          address?: string | null
          booking_id?: string
          created_at?: string
          day_number?: number
          id?: string
          item_type?: Database["public"]["Enums"]["itinerary_item_type"]
          latitude?: number | null
          longitude?: number | null
          notes?: string | null
          planned_end_at?: string | null
          planned_start_at?: string | null
          sequence_number?: number
          status?: string
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_itinerary_items_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "service_bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_travellers: {
        Row: {
          booking_id: string
          created_at: string
          full_name: string
          id: string
          is_primary: boolean
          linked_user_id: string | null
          phone: string | null
          relationship_to_booker: string | null
        }
        Insert: {
          booking_id: string
          created_at?: string
          full_name: string
          id?: string
          is_primary?: boolean
          linked_user_id?: string | null
          phone?: string | null
          relationship_to_booker?: string | null
        }
        Update: {
          booking_id?: string
          created_at?: string
          full_name?: string
          id?: string
          is_primary?: boolean
          linked_user_id?: string | null
          phone?: string | null
          relationship_to_booker?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_travellers_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "service_bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_vehicle_assignments: {
        Row: {
          assigned_at: string
          booking_id: string
          fleet_vehicle_id: string | null
          id: string
          itinerary_item_id: string | null
          notes: string | null
          status: Database["public"]["Enums"]["assignment_status"]
          vehicle_id: string | null
        }
        Insert: {
          assigned_at?: string
          booking_id: string
          fleet_vehicle_id?: string | null
          id?: string
          itinerary_item_id?: string | null
          notes?: string | null
          status?: Database["public"]["Enums"]["assignment_status"]
          vehicle_id?: string | null
        }
        Update: {
          assigned_at?: string
          booking_id?: string
          fleet_vehicle_id?: string | null
          id?: string
          itinerary_item_id?: string | null
          notes?: string | null
          status?: Database["public"]["Enums"]["assignment_status"]
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_vehicle_assignments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "service_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_vehicle_assignments_fleet_vehicle_id_fkey"
            columns: ["fleet_vehicle_id"]
            isOneToOne: false
            referencedRelation: "fleet_vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_vehicle_assignments_itinerary_item_id_fkey"
            columns: ["itinerary_item_id"]
            isOneToOne: false
            referencedRelation: "booking_itinerary_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_vehicle_assignments_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      companion_profiles: {
        Row: {
          admin_approved: boolean
          created_at: string
          employment_status: string | null
          full_name: string
          id: string
          is_available: boolean
          phone: string | null
          photo_url: string | null
          training_notes: string | null
          updated_at: string
        }
        Insert: {
          admin_approved?: boolean
          created_at?: string
          employment_status?: string | null
          full_name: string
          id?: string
          is_available?: boolean
          phone?: string | null
          photo_url?: string | null
          training_notes?: string | null
          updated_at?: string
        }
        Update: {
          admin_approved?: boolean
          created_at?: string
          employment_status?: string | null
          full_name?: string
          id?: string
          is_available?: boolean
          phone?: string | null
          photo_url?: string | null
          training_notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      dispatch_offer_events: {
        Row: {
          actor_id: string | null
          created_at: string
          dispatch_offer_id: string
          event_type: string
          id: string
          new_state: Json | null
          operation_run_id: string
          previous_state: Json | null
          reason: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          dispatch_offer_id: string
          event_type: string
          id?: string
          new_state?: Json | null
          operation_run_id: string
          previous_state?: Json | null
          reason?: string | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          dispatch_offer_id?: string
          event_type?: string
          id?: string
          new_state?: Json | null
          operation_run_id?: string
          previous_state?: Json | null
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dispatch_offer_events_dispatch_offer_id_fkey"
            columns: ["dispatch_offer_id"]
            isOneToOne: false
            referencedRelation: "dispatch_offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_offer_events_operation_run_id_fkey"
            columns: ["operation_run_id"]
            isOneToOne: false
            referencedRelation: "operation_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      dispatch_offers: {
        Row: {
          accepted_at: string | null
          created_at: string
          declined_at: string | null
          dispatch_wave: number
          driver_user_id: string
          eligibility_snapshot: Json
          expires_at: string
          id: string
          offered_at: string
          operation_run_id: string
          response_reason: string | null
          ride_id: string | null
          row_version: number
          status: string
          suitability_snapshot: Json
          updated_at: string
          vehicle_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          declined_at?: string | null
          dispatch_wave?: number
          driver_user_id: string
          eligibility_snapshot?: Json
          expires_at: string
          id?: string
          offered_at?: string
          operation_run_id: string
          response_reason?: string | null
          ride_id?: string | null
          row_version?: number
          status?: string
          suitability_snapshot?: Json
          updated_at?: string
          vehicle_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          declined_at?: string | null
          dispatch_wave?: number
          driver_user_id?: string
          eligibility_snapshot?: Json
          expires_at?: string
          id?: string
          offered_at?: string
          operation_run_id?: string
          response_reason?: string | null
          ride_id?: string | null
          row_version?: number
          status?: string
          suitability_snapshot?: Json
          updated_at?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dispatch_offers_operation_run_id_fkey"
            columns: ["operation_run_id"]
            isOneToOne: false
            referencedRelation: "operation_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_offers_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_offers_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_location_history: {
        Row: {
          accuracy_meters: number | null
          captured_at: string
          driver_user_id: string
          freshness_state: string
          heading: number | null
          id: string
          latitude: number
          longitude: number
          operation_run_id: string | null
          received_at: string
          ride_id: string | null
          source: string
        }
        Insert: {
          accuracy_meters?: number | null
          captured_at: string
          driver_user_id: string
          freshness_state?: string
          heading?: number | null
          id?: string
          latitude: number
          longitude: number
          operation_run_id?: string | null
          received_at?: string
          ride_id?: string | null
          source?: string
        }
        Update: {
          accuracy_meters?: number | null
          captured_at?: string
          driver_user_id?: string
          freshness_state?: string
          heading?: number | null
          id?: string
          latitude?: number
          longitude?: number
          operation_run_id?: string | null
          received_at?: string
          ride_id?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_location_history_operation_run_id_fkey"
            columns: ["operation_run_id"]
            isOneToOne: false
            referencedRelation: "operation_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_location_history_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_profiles: {
        Row: {
          created_at: string
          current_lat: number | null
          current_lng: number | null
          heading: number | null
          id: string
          is_available: boolean
          license_plate: string | null
          location_accuracy: number | null
          location_updated_at: string | null
          user_id: string
          vehicle_model: string | null
          vehicle_type: string | null
        }
        Insert: {
          created_at?: string
          current_lat?: number | null
          current_lng?: number | null
          heading?: number | null
          id?: string
          is_available?: boolean
          license_plate?: string | null
          location_accuracy?: number | null
          location_updated_at?: string | null
          user_id: string
          vehicle_model?: string | null
          vehicle_type?: string | null
        }
        Update: {
          created_at?: string
          current_lat?: number | null
          current_lng?: number | null
          heading?: number | null
          id?: string
          is_available?: boolean
          license_plate?: string | null
          location_accuracy?: number | null
          location_updated_at?: string | null
          user_id?: string
          vehicle_model?: string | null
          vehicle_type?: string | null
        }
        Relationships: []
      }
      fleet_consolidation_issues: {
        Row: {
          canonical_vehicle_id: string | null
          created_at: string
          details: Json
          id: string
          issue_type: string
          registration_number: string | null
          resolved_at: string | null
          resolved_by: string | null
          source_record_id: string | null
          source_table: string
          status: string
        }
        Insert: {
          canonical_vehicle_id?: string | null
          created_at?: string
          details?: Json
          id?: string
          issue_type: string
          registration_number?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          source_record_id?: string | null
          source_table: string
          status?: string
        }
        Update: {
          canonical_vehicle_id?: string | null
          created_at?: string
          details?: Json
          id?: string
          issue_type?: string
          registration_number?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          source_record_id?: string | null
          source_table?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "fleet_consolidation_issues_canonical_vehicle_id_fkey"
            columns: ["canonical_vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      fleet_operation_requests: {
        Row: {
          actor_id: string
          created_at: string
          id: string
          idempotency_key: string
          operation_type: string
          result: Json
        }
        Insert: {
          actor_id: string
          created_at?: string
          id?: string
          idempotency_key: string
          operation_type: string
          result: Json
        }
        Update: {
          actor_id?: string
          created_at?: string
          id?: string
          idempotency_key?: string
          operation_type?: string
          result?: Json
        }
        Relationships: []
      }
      fleet_vehicles: {
        Row: {
          accessibility_features: Json
          created_at: string
          id: string
          is_active: boolean
          make: string | null
          model: string | null
          operational_status: Database["public"]["Enums"]["fleet_operational_status"]
          passenger_capacity: number
          registration_number: string
          updated_at: string
          wheelchair_capacity: number
        }
        Insert: {
          accessibility_features?: Json
          created_at?: string
          id?: string
          is_active?: boolean
          make?: string | null
          model?: string | null
          operational_status?: Database["public"]["Enums"]["fleet_operational_status"]
          passenger_capacity?: number
          registration_number: string
          updated_at?: string
          wheelchair_capacity?: number
        }
        Update: {
          accessibility_features?: Json
          created_at?: string
          id?: string
          is_active?: boolean
          make?: string | null
          model?: string | null
          operational_status?: Database["public"]["Enums"]["fleet_operational_status"]
          passenger_capacity?: number
          registration_number?: string
          updated_at?: string
          wheelchair_capacity?: number
        }
        Relationships: []
      }
      notification_delivery_attempts: {
        Row: {
          attempt_number: number
          completed_at: string | null
          duration_ms: number | null
          error_message: string | null
          id: string
          notification_outbox_id: string
          started_at: string
          status: string
        }
        Insert: {
          attempt_number: number
          completed_at?: string | null
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          notification_outbox_id: string
          started_at?: string
          status: string
        }
        Update: {
          attempt_number?: number
          completed_at?: string | null
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          notification_outbox_id?: string
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_delivery_attempts_notification_outbox_id_fkey"
            columns: ["notification_outbox_id"]
            isOneToOne: false
            referencedRelation: "notification_outbox"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_outbox: {
        Row: {
          attempt_count: number
          created_at: string
          deduplication_key: string
          delivered_at: string | null
          id: string
          last_error: string | null
          locked_at: string | null
          locked_by: string | null
          message: string | null
          next_retry_at: string | null
          notification_type: string
          operation_run_id: string | null
          recipient_user_id: string
          ride_id: string | null
          scheduled_for: string
          service_booking_id: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          deduplication_key: string
          delivered_at?: string | null
          id?: string
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          message?: string | null
          next_retry_at?: string | null
          notification_type: string
          operation_run_id?: string | null
          recipient_user_id: string
          ride_id?: string | null
          scheduled_for?: string
          service_booking_id?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          deduplication_key?: string
          delivered_at?: string | null
          id?: string
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          message?: string | null
          next_retry_at?: string | null
          notification_type?: string
          operation_run_id?: string | null
          recipient_user_id?: string
          ride_id?: string | null
          scheduled_for?: string
          service_booking_id?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_outbox_operation_run_id_fkey"
            columns: ["operation_run_id"]
            isOneToOne: false
            referencedRelation: "operation_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_outbox_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_outbox_service_booking_id_fkey"
            columns: ["service_booking_id"]
            isOneToOne: false
            referencedRelation: "service_bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          operation_run_id: string | null
          operational_alert_id: string | null
          operational_incident_id: string | null
          read_at: string | null
          ride_id: string | null
          service_booking_id: string | null
          support_ticket_id: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          operation_run_id?: string | null
          operational_alert_id?: string | null
          operational_incident_id?: string | null
          read_at?: string | null
          ride_id?: string | null
          service_booking_id?: string | null
          support_ticket_id?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          operation_run_id?: string | null
          operational_alert_id?: string | null
          operational_incident_id?: string | null
          read_at?: string | null
          ride_id?: string | null
          service_booking_id?: string | null
          support_ticket_id?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_operation_run_id_fkey"
            columns: ["operation_run_id"]
            isOneToOne: false
            referencedRelation: "operation_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_operational_alert_id_fkey"
            columns: ["operational_alert_id"]
            isOneToOne: false
            referencedRelation: "operational_alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_operational_incident_id_fkey"
            columns: ["operational_incident_id"]
            isOneToOne: false
            referencedRelation: "operational_incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_service_booking_id_fkey"
            columns: ["service_booking_id"]
            isOneToOne: false
            referencedRelation: "service_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_support_ticket_id_fkey"
            columns: ["support_ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      operation_plans: {
        Row: {
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          created_by: string | null
          id: string
          plan_reference: string
          published_at: string | null
          published_by: string | null
          row_version: number
          service_booking_id: string
          status: string
          updated_at: string
          updated_by: string | null
          validation_snapshot: Json
        }
        Insert: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          plan_reference?: string
          published_at?: string | null
          published_by?: string | null
          row_version?: number
          service_booking_id: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          validation_snapshot?: Json
        }
        Update: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          plan_reference?: string
          published_at?: string | null
          published_by?: string | null
          row_version?: number
          service_booking_id?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          validation_snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "operation_plans_service_booking_id_fkey"
            columns: ["service_booking_id"]
            isOneToOne: false
            referencedRelation: "service_bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      operation_reconciliation_issues: {
        Row: {
          created_at: string
          details: Json
          id: string
          issue_type: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          source_id: string | null
          source_type: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          details?: Json
          id?: string
          issue_type: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          source_id?: string | null
          source_type: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          details?: Json
          id?: string
          issue_type?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          source_id?: string | null
          source_type?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      operation_run_assignments: {
        Row: {
          acknowledged_at: string | null
          acknowledgement_deadline: string | null
          assigned_by: string | null
          assignment_source: string
          companion_id: string | null
          created_at: string
          decline_reason: string | null
          declined_at: string | null
          driver_user_id: string | null
          id: string
          operation_run_id: string
          planned_end_at: string
          planned_start_at: string
          release_reason: string | null
          released_at: string | null
          resource_type: string
          row_version: number
          status: string
          updated_at: string
          vehicle_id: string | null
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledgement_deadline?: string | null
          assigned_by?: string | null
          assignment_source?: string
          companion_id?: string | null
          created_at?: string
          decline_reason?: string | null
          declined_at?: string | null
          driver_user_id?: string | null
          id?: string
          operation_run_id: string
          planned_end_at: string
          planned_start_at: string
          release_reason?: string | null
          released_at?: string | null
          resource_type: string
          row_version?: number
          status?: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Update: {
          acknowledged_at?: string | null
          acknowledgement_deadline?: string | null
          assigned_by?: string | null
          assignment_source?: string
          companion_id?: string | null
          created_at?: string
          decline_reason?: string | null
          declined_at?: string | null
          driver_user_id?: string | null
          id?: string
          operation_run_id?: string
          planned_end_at?: string
          planned_start_at?: string
          release_reason?: string | null
          released_at?: string | null
          resource_type?: string
          row_version?: number
          status?: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "operation_run_assignments_companion_id_fkey"
            columns: ["companion_id"]
            isOneToOne: false
            referencedRelation: "companion_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operation_run_assignments_operation_run_id_fkey"
            columns: ["operation_run_id"]
            isOneToOne: false
            referencedRelation: "operation_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operation_run_assignments_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      operation_run_events: {
        Row: {
          actor_id: string | null
          actor_role: string | null
          created_at: string
          driver_visible: boolean
          event_type: string
          id: string
          metadata: Json
          new_state: Json | null
          operation_run_id: string
          passenger_visible: boolean
          previous_state: Json | null
          reason: string | null
        }
        Insert: {
          actor_id?: string | null
          actor_role?: string | null
          created_at?: string
          driver_visible?: boolean
          event_type: string
          id?: string
          metadata?: Json
          new_state?: Json | null
          operation_run_id: string
          passenger_visible?: boolean
          previous_state?: Json | null
          reason?: string | null
        }
        Update: {
          actor_id?: string | null
          actor_role?: string | null
          created_at?: string
          driver_visible?: boolean
          event_type?: string
          id?: string
          metadata?: Json
          new_state?: Json | null
          operation_run_id?: string
          passenger_visible?: boolean
          previous_state?: Json | null
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "operation_run_events_operation_run_id_fkey"
            columns: ["operation_run_id"]
            isOneToOne: false
            referencedRelation: "operation_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      operation_runs: {
        Row: {
          accessibility_requirements: Json
          actual_end_at: string | null
          actual_start_at: string | null
          created_at: string
          created_by: string | null
          destination_address: string | null
          destination_lat: number | null
          destination_lng: number | null
          dispatch_status: string
          id: string
          is_verification_record: boolean
          itinerary_item_id: string | null
          operation_plan_id: string | null
          operational_status: string
          passenger_count: number
          passenger_id: string
          pickup_address: string | null
          pickup_lat: number | null
          pickup_lng: number | null
          planned_end_at: string | null
          planned_start_at: string | null
          planning_status: string
          priority: string
          ride_id: string | null
          row_version: number
          run_reference: string
          run_type: string
          service_booking_id: string | null
          service_type: string
          source_id: string
          source_type: string
          updated_at: string
          updated_by: string | null
          wheelchair_count: number
        }
        Insert: {
          accessibility_requirements?: Json
          actual_end_at?: string | null
          actual_start_at?: string | null
          created_at?: string
          created_by?: string | null
          destination_address?: string | null
          destination_lat?: number | null
          destination_lng?: number | null
          dispatch_status?: string
          id?: string
          is_verification_record?: boolean
          itinerary_item_id?: string | null
          operation_plan_id?: string | null
          operational_status?: string
          passenger_count?: number
          passenger_id: string
          pickup_address?: string | null
          pickup_lat?: number | null
          pickup_lng?: number | null
          planned_end_at?: string | null
          planned_start_at?: string | null
          planning_status?: string
          priority?: string
          ride_id?: string | null
          row_version?: number
          run_reference?: string
          run_type: string
          service_booking_id?: string | null
          service_type: string
          source_id: string
          source_type: string
          updated_at?: string
          updated_by?: string | null
          wheelchair_count?: number
        }
        Update: {
          accessibility_requirements?: Json
          actual_end_at?: string | null
          actual_start_at?: string | null
          created_at?: string
          created_by?: string | null
          destination_address?: string | null
          destination_lat?: number | null
          destination_lng?: number | null
          dispatch_status?: string
          id?: string
          is_verification_record?: boolean
          itinerary_item_id?: string | null
          operation_plan_id?: string | null
          operational_status?: string
          passenger_count?: number
          passenger_id?: string
          pickup_address?: string | null
          pickup_lat?: number | null
          pickup_lng?: number | null
          planned_end_at?: string | null
          planned_start_at?: string | null
          planning_status?: string
          priority?: string
          ride_id?: string | null
          row_version?: number
          run_reference?: string
          run_type?: string
          service_booking_id?: string | null
          service_type?: string
          source_id?: string
          source_type?: string
          updated_at?: string
          updated_by?: string | null
          wheelchair_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "operation_runs_itinerary_item_id_fkey"
            columns: ["itinerary_item_id"]
            isOneToOne: false
            referencedRelation: "booking_itinerary_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operation_runs_operation_plan_id_fkey"
            columns: ["operation_plan_id"]
            isOneToOne: false
            referencedRelation: "operation_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operation_runs_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operation_runs_service_booking_id_fkey"
            columns: ["service_booking_id"]
            isOneToOne: false
            referencedRelation: "service_bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      operational_alerts: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          alert_type: string
          created_at: string
          deduplication_key: string
          details: Json
          id: string
          operation_run_id: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          ride_id: string | null
          service_booking_id: string | null
          severity: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          alert_type: string
          created_at?: string
          deduplication_key: string
          details?: Json
          id?: string
          operation_run_id?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          ride_id?: string | null
          service_booking_id?: string | null
          severity?: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          alert_type?: string
          created_at?: string
          deduplication_key?: string
          details?: Json
          id?: string
          operation_run_id?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          ride_id?: string | null
          service_booking_id?: string | null
          severity?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "operational_alerts_operation_run_id_fkey"
            columns: ["operation_run_id"]
            isOneToOne: false
            referencedRelation: "operation_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operational_alerts_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operational_alerts_service_booking_id_fkey"
            columns: ["service_booking_id"]
            isOneToOne: false
            referencedRelation: "service_bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      operational_incident_events: {
        Row: {
          actor_id: string | null
          created_at: string
          event_type: string
          id: string
          internal_note: string | null
          new_state: Json | null
          operational_incident_id: string
          passenger_visible_summary: string | null
          previous_state: Json | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          internal_note?: string | null
          new_state?: Json | null
          operational_incident_id: string
          passenger_visible_summary?: string | null
          previous_state?: Json | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          internal_note?: string | null
          new_state?: Json | null
          operational_incident_id?: string
          passenger_visible_summary?: string | null
          previous_state?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "operational_incident_events_operational_incident_id_fkey"
            columns: ["operational_incident_id"]
            isOneToOne: false
            referencedRelation: "operational_incidents"
            referencedColumns: ["id"]
          },
        ]
      }
      operational_incidents: {
        Row: {
          created_at: string
          id: string
          incident_reference: string
          incident_type: string
          internal_notes: string | null
          maintenance_work_order_id: string | null
          operation_run_id: string | null
          owner_admin_id: string | null
          passenger_visible_summary: string | null
          reported_by: string | null
          resolution_summary: string | null
          resolved_at: string | null
          ride_id: string | null
          service_booking_id: string | null
          severity: string
          status: string
          support_ticket_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          incident_reference?: string
          incident_type: string
          internal_notes?: string | null
          maintenance_work_order_id?: string | null
          operation_run_id?: string | null
          owner_admin_id?: string | null
          passenger_visible_summary?: string | null
          reported_by?: string | null
          resolution_summary?: string | null
          resolved_at?: string | null
          ride_id?: string | null
          service_booking_id?: string | null
          severity?: string
          status?: string
          support_ticket_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          incident_reference?: string
          incident_type?: string
          internal_notes?: string | null
          maintenance_work_order_id?: string | null
          operation_run_id?: string | null
          owner_admin_id?: string | null
          passenger_visible_summary?: string | null
          reported_by?: string | null
          resolution_summary?: string | null
          resolved_at?: string | null
          ride_id?: string | null
          service_booking_id?: string | null
          severity?: string
          status?: string
          support_ticket_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "operational_incidents_maintenance_work_order_id_fkey"
            columns: ["maintenance_work_order_id"]
            isOneToOne: false
            referencedRelation: "vehicle_maintenance_work_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operational_incidents_operation_run_id_fkey"
            columns: ["operation_run_id"]
            isOneToOne: false
            referencedRelation: "operation_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operational_incidents_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operational_incidents_service_booking_id_fkey"
            columns: ["service_booking_id"]
            isOneToOne: false
            referencedRelation: "service_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operational_incidents_support_ticket_id_fkey"
            columns: ["support_ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      operations_operation_requests: {
        Row: {
          actor_id: string
          created_at: string
          id: string
          idempotency_key: string
          operation_type: string
          result: Json
        }
        Insert: {
          actor_id: string
          created_at?: string
          id?: string
          idempotency_key: string
          operation_type: string
          result: Json
        }
        Update: {
          actor_id?: string
          created_at?: string
          id?: string
          idempotency_key?: string
          operation_type?: string
          result?: Json
        }
        Relationships: []
      }
      operations_scheduler_runs: {
        Row: {
          completed_at: string | null
          created_by: string | null
          duration_ms: number | null
          failure_reason: string | null
          id: string
          processed_counts: Json
          scheduler_key: string
          started_at: string
          status: string
          trigger_source: string
        }
        Insert: {
          completed_at?: string | null
          created_by?: string | null
          duration_ms?: number | null
          failure_reason?: string | null
          id?: string
          processed_counts?: Json
          scheduler_key: string
          started_at?: string
          status?: string
          trigger_source: string
        }
        Update: {
          completed_at?: string | null
          created_by?: string | null
          duration_ms?: number | null
          failure_reason?: string | null
          id?: string
          processed_counts?: Json
          scheduler_key?: string
          started_at?: string
          status?: string
          trigger_source?: string
        }
        Relationships: []
      }
      passenger_preferences: {
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
          label?: string
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
      payments: {
        Row: {
          amount: number
          created_at: string
          driver_id: string | null
          id: string
          passenger_id: string
          payment_method: string | null
          ride_id: string
          status: Database["public"]["Enums"]["payment_status"]
        }
        Insert: {
          amount: number
          created_at?: string
          driver_id?: string | null
          id?: string
          passenger_id: string
          payment_method?: string | null
          ride_id: string
          status?: Database["public"]["Enums"]["payment_status"]
        }
        Update: {
          amount?: number
          created_at?: string
          driver_id?: string | null
          id?: string
          passenger_id?: string
          payment_method?: string | null
          ride_id?: string
          status?: Database["public"]["Enums"]["payment_status"]
        }
        Relationships: [
          {
            foreignKeyName: "payments_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
        ]
      }
      pin_access_audit: {
        Row: {
          action: string
          admin_id: string
          created_at: string
          id: string
          ride_id: string
        }
        Insert: {
          action: string
          admin_id: string
          created_at?: string
          id?: string
          ride_id: string
        }
        Update: {
          action?: string
          admin_id?: string
          created_at?: string
          id?: string
          ride_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pin_access_audit_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_audit_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          new_value: Json | null
          performed_by: string | null
          previous_value: Json | null
          pricing_version_id: string | null
          reason: string | null
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          new_value?: Json | null
          performed_by?: string | null
          previous_value?: Json | null
          pricing_version_id?: string | null
          reason?: string | null
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          new_value?: Json | null
          performed_by?: string | null
          previous_value?: Json | null
          pricing_version_id?: string | null
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pricing_audit_events_pricing_version_id_fkey"
            columns: ["pricing_version_id"]
            isOneToOne: false
            referencedRelation: "pricing_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_components: {
        Row: {
          amount: number
          applicability_conditions: Json
          calculation_order: number
          calculation_type: string
          component_code: string
          created_at: string
          customer_label: string
          customer_visible: boolean
          id: string
          internal_description: string | null
          is_active: boolean
          maximum_quantity: number | null
          minimum_quantity: number
          pricing_version_id: string
          service_code: string
          updated_at: string
        }
        Insert: {
          amount?: number
          applicability_conditions?: Json
          calculation_order?: number
          calculation_type: string
          component_code: string
          created_at?: string
          customer_label: string
          customer_visible?: boolean
          id?: string
          internal_description?: string | null
          is_active?: boolean
          maximum_quantity?: number | null
          minimum_quantity?: number
          pricing_version_id: string
          service_code: string
          updated_at?: string
        }
        Update: {
          amount?: number
          applicability_conditions?: Json
          calculation_order?: number
          calculation_type?: string
          component_code?: string
          created_at?: string
          customer_label?: string
          customer_visible?: boolean
          id?: string
          internal_description?: string | null
          is_active?: boolean
          maximum_quantity?: number | null
          minimum_quantity?: number
          pricing_version_id?: string
          service_code?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pricing_components_pricing_version_id_fkey"
            columns: ["pricing_version_id"]
            isOneToOne: false
            referencedRelation: "pricing_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_operation_requests: {
        Row: {
          actor_id: string
          created_at: string
          id: string
          idempotency_key: string
          operation_type: string
          result: Json
        }
        Insert: {
          actor_id: string
          created_at?: string
          id?: string
          idempotency_key: string
          operation_type: string
          result: Json
        }
        Update: {
          actor_id?: string
          created_at?: string
          id?: string
          idempotency_key?: string
          operation_type?: string
          result?: Json
        }
        Relationships: []
      }
      pricing_versions: {
        Row: {
          created_at: string
          created_by: string | null
          currency: string
          description: string | null
          effective_from: string | null
          effective_to: string | null
          id: string
          is_mock: boolean
          name: string
          published_at: string | null
          published_by: string | null
          retired_at: string | null
          row_version: number
          service_code: string
          source_rule_id: string | null
          status: string
          updated_at: string
          version_number: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          is_mock?: boolean
          name: string
          published_at?: string | null
          published_by?: string | null
          retired_at?: string | null
          row_version?: number
          service_code: string
          source_rule_id?: string | null
          status?: string
          updated_at?: string
          version_number: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          is_mock?: boolean
          name?: string
          published_at?: string | null
          published_by?: string | null
          retired_at?: string | null
          row_version?: number
          service_code?: string
          source_rule_id?: string | null
          status?: string
          updated_at?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "pricing_versions_source_rule_id_fkey"
            columns: ["source_rule_id"]
            isOneToOne: false
            referencedRelation: "service_pricing_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          phone: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          phone?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          phone?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      quote_audit_events: {
        Row: {
          booking_id: string | null
          created_at: string
          event_type: string
          id: string
          new_value: Json | null
          performed_by: string | null
          previous_value: Json | null
          quote_id: string | null
          reason: string | null
        }
        Insert: {
          booking_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          new_value?: Json | null
          performed_by?: string | null
          previous_value?: Json | null
          quote_id?: string | null
          reason?: string | null
        }
        Update: {
          booking_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          new_value?: Json | null
          performed_by?: string | null
          previous_value?: Json | null
          quote_id?: string | null
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quote_audit_events_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "service_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_audit_events_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "service_quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      resource_availability_windows: {
        Row: {
          availability_type: string
          companion_id: string | null
          created_at: string
          created_by: string | null
          driver_user_id: string | null
          ends_at: string
          id: string
          override_reason: string | null
          reason: string | null
          recurrence_rule: Json | null
          resource_type: string
          source: string
          starts_at: string
          timezone: string
          updated_at: string
          vehicle_id: string | null
        }
        Insert: {
          availability_type: string
          companion_id?: string | null
          created_at?: string
          created_by?: string | null
          driver_user_id?: string | null
          ends_at: string
          id?: string
          override_reason?: string | null
          reason?: string | null
          recurrence_rule?: Json | null
          resource_type: string
          source?: string
          starts_at: string
          timezone?: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Update: {
          availability_type?: string
          companion_id?: string | null
          created_at?: string
          created_by?: string | null
          driver_user_id?: string | null
          ends_at?: string
          id?: string
          override_reason?: string | null
          reason?: string | null
          recurrence_rule?: Json | null
          resource_type?: string
          source?: string
          starts_at?: string
          timezone?: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "resource_availability_windows_companion_id_fkey"
            columns: ["companion_id"]
            isOneToOne: false
            referencedRelation: "companion_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resource_availability_windows_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ride_change_log: {
        Row: {
          acknowledged_by_driver_at: string | null
          change_type: string
          changed_by: string
          created_at: string
          id: string
          new_values: Json | null
          previous_values: Json | null
          ride_id: string
          route_version: number | null
        }
        Insert: {
          acknowledged_by_driver_at?: string | null
          change_type: string
          changed_by: string
          created_at?: string
          id?: string
          new_values?: Json | null
          previous_values?: Json | null
          ride_id: string
          route_version?: number | null
        }
        Update: {
          acknowledged_by_driver_at?: string | null
          change_type?: string
          changed_by?: string
          created_at?: string
          id?: string
          new_values?: Json | null
          previous_values?: Json | null
          ride_id?: string
          route_version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ride_change_log_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
        ]
      }
      ride_live_locations: {
        Row: {
          accuracy: number | null
          heading: number | null
          id: string
          latitude: number
          longitude: number
          ride_id: string
          updated_at: string
          user_id: string
          user_role: string
        }
        Insert: {
          accuracy?: number | null
          heading?: number | null
          id?: string
          latitude: number
          longitude: number
          ride_id: string
          updated_at?: string
          user_id: string
          user_role: string
        }
        Update: {
          accuracy?: number | null
          heading?: number | null
          id?: string
          latitude?: number
          longitude?: number
          ride_id?: string
          updated_at?: string
          user_id?: string
          user_role?: string
        }
        Relationships: [
          {
            foreignKeyName: "ride_live_locations_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
        ]
      }
      ride_pin_attempts: {
        Row: {
          attempted_at: string
          driver_id: string
          id: string
          ride_id: string
          success: boolean
        }
        Insert: {
          attempted_at?: string
          driver_id: string
          id?: string
          ride_id: string
          success: boolean
        }
        Update: {
          attempted_at?: string
          driver_id?: string
          id?: string
          ride_id?: string
          success?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "ride_pin_attempts_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
        ]
      }
      ride_pins: {
        Row: {
          created_at: string
          pin: string
          ride_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          pin: string
          ride_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          pin?: string
          ride_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ride_pins_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: true
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
        ]
      }
      ride_ratings: {
        Row: {
          comment: string | null
          created_at: string
          driver_id: string
          id: string
          passenger_id: string
          rating: number
          ride_id: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          driver_id: string
          id?: string
          passenger_id: string
          rating: number
          ride_id: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          driver_id?: string
          id?: string
          passenger_id?: string
          rating?: number
          ride_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ride_ratings_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: true
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
        ]
      }
      ride_reviews: {
        Row: {
          comment: string | null
          created_at: string
          driver_id: string
          id: string
          passenger_id: string
          rating: number
          ride_id: string
          updated_at: string | null
        }
        Insert: {
          comment?: string | null
          created_at?: string
          driver_id: string
          id?: string
          passenger_id: string
          rating: number
          ride_id: string
          updated_at?: string | null
        }
        Update: {
          comment?: string | null
          created_at?: string
          driver_id?: string
          id?: string
          passenger_id?: string
          rating?: number
          ride_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ride_reviews_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
        ]
      }
      ride_status_events: {
        Row: {
          changed_by: string
          created_at: string
          id: string
          new_status: string
          previous_status: string | null
          ride_id: string
        }
        Insert: {
          changed_by: string
          created_at?: string
          id?: string
          new_status: string
          previous_status?: string | null
          ride_id: string
        }
        Update: {
          changed_by?: string
          created_at?: string
          id?: string
          new_status?: string
          previous_status?: string | null
          ride_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ride_status_events_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
        ]
      }
      rides: {
        Row: {
          accepted_at: string | null
          actual_distance_km: number
          actual_duration_seconds: number | null
          completed_at: string | null
          created_at: string
          day_number: number | null
          destination_address: string
          destination_lat: number
          destination_lng: number
          destination_place_id: string | null
          distance_km: number
          driver_arrived_at: string | null
          driver_id: string | null
          estimate_snapshot: Json
          estimated_duration_seconds: number | null
          estimated_price: number
          id: string
          itinerary_item_id: string | null
          last_route_updated_at: string | null
          leg_sequence: number | null
          passenger_id: string
          pickup_address: string
          pickup_lat: number
          pickup_lng: number
          pickup_place_id: string | null
          pricing_version_id: string | null
          request_type: string
          route_version: number
          scheduled_at: string | null
          service_booking_id: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["ride_status"]
          updated_at: string
          vehicle_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          actual_distance_km?: number
          actual_duration_seconds?: number | null
          completed_at?: string | null
          created_at?: string
          day_number?: number | null
          destination_address: string
          destination_lat: number
          destination_lng: number
          destination_place_id?: string | null
          distance_km: number
          driver_arrived_at?: string | null
          driver_id?: string | null
          estimate_snapshot?: Json
          estimated_duration_seconds?: number | null
          estimated_price: number
          id?: string
          itinerary_item_id?: string | null
          last_route_updated_at?: string | null
          leg_sequence?: number | null
          passenger_id: string
          pickup_address: string
          pickup_lat: number
          pickup_lng: number
          pickup_place_id?: string | null
          pricing_version_id?: string | null
          request_type?: string
          route_version?: number
          scheduled_at?: string | null
          service_booking_id?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["ride_status"]
          updated_at?: string
          vehicle_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          actual_distance_km?: number
          actual_duration_seconds?: number | null
          completed_at?: string | null
          created_at?: string
          day_number?: number | null
          destination_address?: string
          destination_lat?: number
          destination_lng?: number
          destination_place_id?: string | null
          distance_km?: number
          driver_arrived_at?: string | null
          driver_id?: string | null
          estimate_snapshot?: Json
          estimated_duration_seconds?: number | null
          estimated_price?: number
          id?: string
          itinerary_item_id?: string | null
          last_route_updated_at?: string | null
          leg_sequence?: number | null
          passenger_id?: string
          pickup_address?: string
          pickup_lat?: number
          pickup_lng?: number
          pickup_place_id?: string | null
          pricing_version_id?: string | null
          request_type?: string
          route_version?: number
          scheduled_at?: string | null
          service_booking_id?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["ride_status"]
          updated_at?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rides_itinerary_item_id_fkey"
            columns: ["itinerary_item_id"]
            isOneToOne: false
            referencedRelation: "booking_itinerary_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rides_pricing_version_id_fkey"
            columns: ["pricing_version_id"]
            isOneToOne: false
            referencedRelation: "pricing_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rides_service_booking_id_fkey"
            columns: ["service_booking_id"]
            isOneToOne: false
            referencedRelation: "service_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rides_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      service_booking_events: {
        Row: {
          actor_user_id: string | null
          booking_id: string
          created_at: string
          event_type: string
          id: string
          payload: Json | null
        }
        Insert: {
          actor_user_id?: string | null
          booking_id: string
          created_at?: string
          event_type: string
          id?: string
          payload?: Json | null
        }
        Update: {
          actor_user_id?: string | null
          booking_id?: string
          created_at?: string
          event_type?: string
          id?: string
          payload?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "service_booking_events_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "service_bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      service_bookings: {
        Row: {
          admin_notes: string | null
          booked_by_user_id: string
          booking_reference: string
          created_at: string
          deposit_amount: number | null
          deposit_status: Database["public"]["Enums"]["deposit_status"]
          end_at: string | null
          estimate_snapshot: Json
          estimated_total: number | null
          id: string
          journey_pattern: Database["public"]["Enums"]["journey_pattern"]
          metadata: Json
          parent_booking_id: string | null
          passenger_notes: string | null
          pricing_version_id: string | null
          quoted_total: number | null
          recurrence_rule: Json | null
          requested_companion_count: number
          service_type: Database["public"]["Enums"]["service_type"]
          start_at: string | null
          status: Database["public"]["Enums"]["booking_status"]
          timezone: string
          updated_at: string
        }
        Insert: {
          admin_notes?: string | null
          booked_by_user_id: string
          booking_reference?: string
          created_at?: string
          deposit_amount?: number | null
          deposit_status?: Database["public"]["Enums"]["deposit_status"]
          end_at?: string | null
          estimate_snapshot?: Json
          estimated_total?: number | null
          id?: string
          journey_pattern: Database["public"]["Enums"]["journey_pattern"]
          metadata?: Json
          parent_booking_id?: string | null
          passenger_notes?: string | null
          pricing_version_id?: string | null
          quoted_total?: number | null
          recurrence_rule?: Json | null
          requested_companion_count?: number
          service_type: Database["public"]["Enums"]["service_type"]
          start_at?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          timezone?: string
          updated_at?: string
        }
        Update: {
          admin_notes?: string | null
          booked_by_user_id?: string
          booking_reference?: string
          created_at?: string
          deposit_amount?: number | null
          deposit_status?: Database["public"]["Enums"]["deposit_status"]
          end_at?: string | null
          estimate_snapshot?: Json
          estimated_total?: number | null
          id?: string
          journey_pattern?: Database["public"]["Enums"]["journey_pattern"]
          metadata?: Json
          parent_booking_id?: string | null
          passenger_notes?: string | null
          pricing_version_id?: string | null
          quoted_total?: number | null
          recurrence_rule?: Json | null
          requested_companion_count?: number
          service_type?: Database["public"]["Enums"]["service_type"]
          start_at?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_bookings_parent_booking_id_fkey"
            columns: ["parent_booking_id"]
            isOneToOne: false
            referencedRelation: "service_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_bookings_pricing_version_id_fkey"
            columns: ["pricing_version_id"]
            isOneToOne: false
            referencedRelation: "pricing_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      service_pricing_rules: {
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
      service_quote_items: {
        Row: {
          adjustment: number
          calculation_order: number
          component_code: string | null
          customer_visible: boolean
          description: string | null
          id: string
          internal_explanation: string | null
          label: string
          line_subtotal: number | null
          line_total: number
          quantity: number
          quote_id: string
          sort_order: number
          source_pricing_component_id: string | null
          unit: string | null
          unit_price: number
        }
        Insert: {
          adjustment?: number
          calculation_order?: number
          component_code?: string | null
          customer_visible?: boolean
          description?: string | null
          id?: string
          internal_explanation?: string | null
          label: string
          line_subtotal?: number | null
          line_total?: number
          quantity?: number
          quote_id: string
          sort_order?: number
          source_pricing_component_id?: string | null
          unit?: string | null
          unit_price?: number
        }
        Update: {
          adjustment?: number
          calculation_order?: number
          component_code?: string | null
          customer_visible?: boolean
          description?: string | null
          id?: string
          internal_explanation?: string | null
          label?: string
          line_subtotal?: number | null
          line_total?: number
          quantity?: number
          quote_id?: string
          sort_order?: number
          source_pricing_component_id?: string | null
          unit?: string | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "service_quote_items_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "service_quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_quote_items_source_pricing_component_id_fkey"
            columns: ["source_pricing_component_id"]
            isOneToOne: false
            referencedRelation: "pricing_components"
            referencedColumns: ["id"]
          },
        ]
      }
      service_quotes: {
        Row: {
          accepted_at: string | null
          adjustments_total: number
          admin_override_reason: string | null
          booking_id: string
          calculation_engine_version: string
          calculation_snapshot: Json
          cancelled_at: string | null
          created_at: string
          created_by_user_id: string | null
          currency: string
          declined_at: string | null
          deposit_amount_snapshot: number
          deposit_required: boolean
          expired_at: string | null
          final_total: number | null
          id: string
          margin_amount: number
          notes: string | null
          pricing_version_id: string | null
          quote_reference: string
          revision_number: number
          row_version: number
          sent_at: string | null
          status: Database["public"]["Enums"]["quote_status"]
          subtotal: number
          superseded_at: string | null
          superseded_by_quote_id: string | null
          tax_amount: number
          total: number
          updated_at: string
          updated_by: string | null
          valid_until: string | null
        }
        Insert: {
          accepted_at?: string | null
          adjustments_total?: number
          admin_override_reason?: string | null
          booking_id: string
          calculation_engine_version?: string
          calculation_snapshot?: Json
          cancelled_at?: string | null
          created_at?: string
          created_by_user_id?: string | null
          currency?: string
          declined_at?: string | null
          deposit_amount_snapshot?: number
          deposit_required?: boolean
          expired_at?: string | null
          final_total?: number | null
          id?: string
          margin_amount?: number
          notes?: string | null
          pricing_version_id?: string | null
          quote_reference?: string
          revision_number?: number
          row_version?: number
          sent_at?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          subtotal?: number
          superseded_at?: string | null
          superseded_by_quote_id?: string | null
          tax_amount?: number
          total?: number
          updated_at?: string
          updated_by?: string | null
          valid_until?: string | null
        }
        Update: {
          accepted_at?: string | null
          adjustments_total?: number
          admin_override_reason?: string | null
          booking_id?: string
          calculation_engine_version?: string
          calculation_snapshot?: Json
          cancelled_at?: string | null
          created_at?: string
          created_by_user_id?: string | null
          currency?: string
          declined_at?: string | null
          deposit_amount_snapshot?: number
          deposit_required?: boolean
          expired_at?: string | null
          final_total?: number | null
          id?: string
          margin_amount?: number
          notes?: string | null
          pricing_version_id?: string | null
          quote_reference?: string
          revision_number?: number
          row_version?: number
          sent_at?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          subtotal?: number
          superseded_at?: string | null
          superseded_by_quote_id?: string | null
          tax_amount?: number
          total?: number
          updated_at?: string
          updated_by?: string | null
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "service_quotes_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "service_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_quotes_pricing_version_id_fkey"
            columns: ["pricing_version_id"]
            isOneToOne: false
            referencedRelation: "pricing_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_quotes_superseded_by_quote_id_fkey"
            columns: ["superseded_by_quote_id"]
            isOneToOne: false
            referencedRelation: "service_quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      support_messages: {
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
          vehicle_id: string | null
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
          vehicle_id?: string | null
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
          vehicle_id?: string | null
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
          {
            foreignKeyName: "support_tickets_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vehicle_documents: {
        Row: {
          created_at: string
          document_number: string | null
          document_type: string
          expires_at: string | null
          id: string
          is_current: boolean
          issued_at: string | null
          status: string
          storage_path: string | null
          updated_at: string
          uploaded_by: string | null
          vehicle_id: string
        }
        Insert: {
          created_at?: string
          document_number?: string | null
          document_type: string
          expires_at?: string | null
          id?: string
          is_current?: boolean
          issued_at?: string | null
          status?: string
          storage_path?: string | null
          updated_at?: string
          uploaded_by?: string | null
          vehicle_id: string
        }
        Update: {
          created_at?: string
          document_number?: string | null
          document_type?: string
          expires_at?: string | null
          id?: string
          is_current?: boolean
          issued_at?: string | null
          status?: string
          storage_path?: string | null
          updated_at?: string
          uploaded_by?: string | null
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_documents_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_driver_assignments: {
        Row: {
          assigned_by: string | null
          assignment_reason: string | null
          assignment_type: string
          created_at: string
          driver_id: string
          end_at: string | null
          ended_by: string | null
          id: string
          notes: string | null
          source: string
          start_at: string
          status: string
          updated_at: string
          vehicle_id: string
        }
        Insert: {
          assigned_by?: string | null
          assignment_reason?: string | null
          assignment_type?: string
          created_at?: string
          driver_id: string
          end_at?: string | null
          ended_by?: string | null
          id?: string
          notes?: string | null
          source?: string
          start_at?: string
          status?: string
          updated_at?: string
          vehicle_id: string
        }
        Update: {
          assigned_by?: string | null
          assignment_reason?: string | null
          assignment_type?: string
          created_at?: string
          driver_id?: string
          end_at?: string | null
          ended_by?: string | null
          id?: string
          notes?: string | null
          source?: string
          start_at?: string
          status?: string
          updated_at?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_driver_assignments_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_legacy_mappings: {
        Row: {
          canonical_vehicle_id: string
          conflict_notes: string | null
          created_at: string
          id: string
          legacy_record_id: string
          legacy_registration: string | null
          legacy_source: string
          match_confidence: number
          match_method: string
          migration_status: string
        }
        Insert: {
          canonical_vehicle_id: string
          conflict_notes?: string | null
          created_at?: string
          id?: string
          legacy_record_id: string
          legacy_registration?: string | null
          legacy_source: string
          match_confidence?: number
          match_method: string
          migration_status?: string
        }
        Update: {
          canonical_vehicle_id?: string
          conflict_notes?: string | null
          created_at?: string
          id?: string
          legacy_record_id?: string
          legacy_registration?: string | null
          legacy_source?: string
          match_confidence?: number
          match_method?: string
          migration_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_legacy_mappings_canonical_vehicle_id_fkey"
            columns: ["canonical_vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_maintenance_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          new_value: Json | null
          performed_by: string | null
          previous_value: Json | null
          work_order_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          new_value?: Json | null
          performed_by?: string | null
          previous_value?: Json | null
          work_order_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          new_value?: Json | null
          performed_by?: string | null
          previous_value?: Json | null
          work_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_maintenance_events_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "vehicle_maintenance_work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_maintenance_work_orders: {
        Row: {
          actual_cost: number | null
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          description: string
          diagnosis: string | null
          estimated_cost: number | null
          id: string
          maintenance_type: string
          next_service_due_date: string | null
          next_service_due_km: number | null
          odometer_at_completion: number | null
          odometer_at_report: number | null
          outcome: string | null
          reported_at: string
          reported_by: string | null
          scheduled_at: string | null
          service_provider: string | null
          severity: string
          started_at: string | null
          status: string
          support_ticket_id: string | null
          updated_at: string
          updated_by: string | null
          vehicle_id: string
          work_order_reference: string
          work_performed: string | null
        }
        Insert: {
          actual_cost?: number | null
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description: string
          diagnosis?: string | null
          estimated_cost?: number | null
          id?: string
          maintenance_type: string
          next_service_due_date?: string | null
          next_service_due_km?: number | null
          odometer_at_completion?: number | null
          odometer_at_report?: number | null
          outcome?: string | null
          reported_at?: string
          reported_by?: string | null
          scheduled_at?: string | null
          service_provider?: string | null
          severity?: string
          started_at?: string | null
          status?: string
          support_ticket_id?: string | null
          updated_at?: string
          updated_by?: string | null
          vehicle_id: string
          work_order_reference?: string
          work_performed?: string | null
        }
        Update: {
          actual_cost?: number | null
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          diagnosis?: string | null
          estimated_cost?: number | null
          id?: string
          maintenance_type?: string
          next_service_due_date?: string | null
          next_service_due_km?: number | null
          odometer_at_completion?: number | null
          odometer_at_report?: number | null
          outcome?: string | null
          reported_at?: string
          reported_by?: string | null
          scheduled_at?: string | null
          service_provider?: string | null
          severity?: string
          started_at?: string | null
          status?: string
          support_ticket_id?: string | null
          updated_at?: string
          updated_by?: string | null
          vehicle_id?: string
          work_order_reference?: string
          work_performed?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_maintenance_work_orders_support_ticket_id_fkey"
            columns: ["support_ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_maintenance_work_orders_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_odometer_events: {
        Row: {
          id: string
          notes: string | null
          odometer_km: number
          recorded_at: string
          recorded_by: string | null
          ride_id: string | null
          source: string
          vehicle_id: string
          work_order_id: string | null
        }
        Insert: {
          id?: string
          notes?: string | null
          odometer_km: number
          recorded_at?: string
          recorded_by?: string | null
          ride_id?: string | null
          source: string
          vehicle_id: string
          work_order_id?: string | null
        }
        Update: {
          id?: string
          notes?: string | null
          odometer_km?: number
          recorded_at?: string
          recorded_by?: string | null
          ride_id?: string | null
          source?: string
          vehicle_id?: string
          work_order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_odometer_events_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_odometer_events_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_odometer_events_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "vehicle_maintenance_work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_profiles: {
        Row: {
          accessibility_features: Json
          admin_notes: string | null
          assigned_driver_id: string | null
          created_at: string
          current_odometer_km: number
          id: string
          insurance_expiry_date: string | null
          last_service_date: string | null
          last_service_km: number | null
          legacy_consolidation_status: string
          license_disc_expiry_date: string | null
          license_plate: string
          license_plate_normalized: string | null
          make: string | null
          model: string | null
          next_service_due_km: number | null
          passenger_capacity: number | null
          ramp_or_lift_available: boolean
          roadworthy_expiry_date: string | null
          service_interval_km: number
          status: string
          updated_at: string
          vehicle_name: string
          vehicle_type: string | null
          vin_number: string | null
          wheelchair_accessible: boolean
          wheelchair_capacity: number | null
          year: number | null
        }
        Insert: {
          accessibility_features?: Json
          admin_notes?: string | null
          assigned_driver_id?: string | null
          created_at?: string
          current_odometer_km?: number
          id?: string
          insurance_expiry_date?: string | null
          last_service_date?: string | null
          last_service_km?: number | null
          legacy_consolidation_status?: string
          license_disc_expiry_date?: string | null
          license_plate: string
          license_plate_normalized?: string | null
          make?: string | null
          model?: string | null
          next_service_due_km?: number | null
          passenger_capacity?: number | null
          ramp_or_lift_available?: boolean
          roadworthy_expiry_date?: string | null
          service_interval_km?: number
          status?: string
          updated_at?: string
          vehicle_name: string
          vehicle_type?: string | null
          vin_number?: string | null
          wheelchair_accessible?: boolean
          wheelchair_capacity?: number | null
          year?: number | null
        }
        Update: {
          accessibility_features?: Json
          admin_notes?: string | null
          assigned_driver_id?: string | null
          created_at?: string
          current_odometer_km?: number
          id?: string
          insurance_expiry_date?: string | null
          last_service_date?: string | null
          last_service_km?: number | null
          legacy_consolidation_status?: string
          license_disc_expiry_date?: string | null
          license_plate?: string
          license_plate_normalized?: string | null
          make?: string | null
          model?: string | null
          next_service_due_km?: number | null
          passenger_capacity?: number | null
          ramp_or_lift_available?: boolean
          roadworthy_expiry_date?: string | null
          service_interval_km?: number
          status?: string
          updated_at?: string
          vehicle_name?: string
          vehicle_type?: string | null
          vin_number?: string | null
          wheelchair_accessible?: boolean
          wheelchair_capacity?: number | null
          year?: number | null
        }
        Relationships: []
      }
      vehicle_status_events: {
        Row: {
          created_at: string
          id: string
          new_status: string
          performed_by: string | null
          previous_status: string | null
          reason: string
          vehicle_id: string
          work_order_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          new_status: string
          performed_by?: string | null
          previous_status?: string | null
          reason: string
          vehicle_id: string
          work_order_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          new_status?: string
          performed_by?: string | null
          previous_status?: string | null
          reason?: string
          vehicle_id?: string
          work_order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_status_events_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_status_events_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "vehicle_maintenance_work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_acknowledge_pin_alert: { Args: { _ride_id: string }; Returns: Json }
      admin_apply_quote_override: {
        Args: {
          p_adjustment: number
          p_expected_row_version: number
          p_quote_id: string
          p_reason: string
        }
        Returns: Json
      }
      admin_assign_booking_vehicle: {
        Args: {
          p_booking_id: string
          p_idempotency_key?: string
          p_itinerary_item_id?: string
          p_notes?: string
          p_vehicle_id: string
        }
        Returns: Json
      }
      admin_assign_driver_vehicle: {
        Args: {
          p_assignment_reason?: string
          p_assignment_type?: string
          p_driver_id: string
          p_end_at?: string
          p_idempotency_key?: string
          p_notes?: string
          p_source?: string
          p_start_at?: string
          p_vehicle_id: string
        }
        Returns: Json
      }
      admin_assign_operation_resource: {
        Args: {
          p_assignment_source?: string
          p_expected_run_version: number
          p_idempotency_key?: string
          p_reason?: string
          p_resource_id: string
          p_resource_type: string
          p_run_id: string
        }
        Returns: Json
      }
      admin_assign_ride_resources: {
        Args: {
          p_driver_id: string
          p_expected_status?: Database["public"]["Enums"]["ride_status"]
          p_idempotency_key?: string
          p_ride_id: string
          p_vehicle_id: string
        }
        Returns: Json
      }
      admin_cancel_operation: {
        Args: {
          p_expected_run_version: number
          p_reason: string
          p_run_id: string
        }
        Returns: Json
      }
      admin_cancel_service_quote: {
        Args: {
          p_expected_row_version: number
          p_idempotency_key?: string
          p_quote_id: string
          p_reason: string
        }
        Returns: Json
      }
      admin_change_vehicle_status: {
        Args: {
          p_expected_status?: string
          p_new_status: string
          p_reason: string
          p_vehicle_id: string
          p_work_order_id?: string
        }
        Returns: Json
      }
      admin_convert_support_ticket_to_maintenance: {
        Args: {
          p_description?: string
          p_idempotency_key?: string
          p_maintenance_type: string
          p_scheduled_at?: string
          p_severity: string
          p_ticket_id: string
        }
        Returns: Json
      }
      admin_create_operational_incident: {
        Args: {
          p_incident_type: string
          p_internal_notes?: string
          p_maintenance_work_order_id?: string
          p_passenger_visible_summary?: string
          p_run_id: string
          p_severity: string
          p_support_ticket_id?: string
          p_title: string
        }
        Returns: Json
      }
      admin_create_pricing_draft: {
        Args: {
          p_clone_from_version_id?: string
          p_effective_from?: string
          p_idempotency_key?: string
          p_name?: string
          p_service_code: string
        }
        Returns: Json
      }
      admin_create_vehicle: {
        Args: {
          p_accessibility_features?: Json
          p_admin_notes?: string
          p_idempotency_key?: string
          p_license_plate: string
          p_make?: string
          p_model?: string
          p_passenger_capacity?: number
          p_ramp_or_lift_available?: boolean
          p_service_interval_km?: number
          p_vehicle_name: string
          p_vehicle_type?: string
          p_vin_number?: string
          p_wheelchair_accessible?: boolean
          p_wheelchair_capacity?: number
          p_year?: number
        }
        Returns: Json
      }
      admin_delete_pricing_draft: {
        Args: {
          p_expected_row_version: number
          p_reason: string
          p_version_id: string
        }
        Returns: Json
      }
      admin_dispatch_operation: {
        Args: {
          p_candidate_limit?: number
          p_expected_run_version: number
          p_idempotency_key?: string
          p_offer_minutes?: number
          p_run_id: string
        }
        Returns: Json
      }
      admin_end_vehicle_assignment: {
        Args: {
          p_assignment_id: string
          p_expected_status?: string
          p_reason: string
        }
        Returns: Json
      }
      admin_expire_service_quotes: { Args: never; Returns: number }
      admin_fleet_consolidation_report: {
        Args: never
        Returns: {
          metric: string
          value: number
        }[]
      }
      admin_generate_service_quote: {
        Args: {
          p_booking_id: string
          p_expected_booking_status?: string
          p_idempotency_key?: string
          p_inputs: Json
          p_valid_until: string
        }
        Returns: Json
      }
      admin_link_support_vehicle: {
        Args: { p_reason: string; p_ticket_id: string; p_vehicle_id: string }
        Returns: Json
      }
      admin_open_maintenance_work_order: {
        Args: {
          p_description: string
          p_idempotency_key?: string
          p_maintenance_type: string
          p_odometer_at_report?: number
          p_scheduled_at?: string
          p_service_provider?: string
          p_severity: string
          p_support_ticket_id?: string
          p_vehicle_id: string
        }
        Returns: Json
      }
      admin_plan_service_booking: {
        Args: {
          p_booking_id: string
          p_idempotency_key?: string
          p_include_verification?: boolean
        }
        Returns: Json
      }
      admin_pricing_calculate: {
        Args: {
          p_effective_at?: string
          p_inputs?: Json
          p_pricing_version_id?: string
          p_service_code: string
        }
        Returns: Json
      }
      admin_publish_operation_plan: {
        Args: {
          p_confirmation: string
          p_expected_row_version: number
          p_idempotency_key?: string
          p_plan_id: string
          p_warning_override_reason?: string
        }
        Returns: Json
      }
      admin_publish_pricing_version: {
        Args: {
          p_confirmation: string
          p_expected_row_version: number
          p_version_id: string
        }
        Returns: Json
      }
      admin_quote_summaries: {
        Args: { p_booking_ids?: string[] }
        Returns: Json
      }
      admin_quote_workspace: { Args: { p_booking_id: string }; Returns: Json }
      admin_reassign_operation_resource: {
        Args: {
          p_assignment_id: string
          p_expected_assignment_version: number
          p_idempotency_key?: string
          p_new_resource_id: string
          p_reason: string
        }
        Returns: Json
      }
      admin_recalculate_service_quote: {
        Args: {
          p_expected_row_version: number
          p_idempotency_key?: string
          p_inputs: Json
          p_quote_id: string
          p_valid_until: string
        }
        Returns: Json
      }
      admin_record_vehicle_odometer: {
        Args: {
          p_allow_correction?: boolean
          p_notes?: string
          p_odometer_km: number
          p_ride_id?: string
          p_source?: string
          p_vehicle_id: string
          p_work_order_id?: string
        }
        Returns: Json
      }
      admin_release_operation_resource: {
        Args: {
          p_assignment_id: string
          p_expected_assignment_version: number
          p_reason: string
        }
        Returns: Json
      }
      admin_remove_vehicle_document: {
        Args: { p_document_id: string; p_reason: string }
        Returns: Json
      }
      admin_reset_ride_pin: { Args: { _ride_id: string }; Returns: Json }
      admin_resolve_operational_alert: {
        Args: {
          p_alert_id: string
          p_dismiss?: boolean
          p_resolution_note: string
        }
        Returns: Json
      }
      admin_retire_pricing_version: {
        Args: {
          p_expected_row_version: number
          p_reason: string
          p_version_id: string
        }
        Returns: Json
      }
      admin_run_operations_scheduler: {
        Args: { p_idempotency_key?: string }
        Returns: Json
      }
      admin_save_pricing_draft: {
        Args: {
          p_components: Json
          p_description: string
          p_effective_from: string
          p_effective_to: string
          p_expected_row_version: number
          p_is_mock: boolean
          p_name: string
          p_version_id: string
        }
        Returns: Json
      }
      admin_save_vehicle_document: {
        Args: {
          p_document_number?: string
          p_document_type: string
          p_expires_at?: string
          p_idempotency_key?: string
          p_issued_at?: string
          p_storage_path?: string
          p_vehicle_id: string
        }
        Returns: Json
      }
      admin_send_service_quote: {
        Args: {
          p_expected_row_version: number
          p_idempotency_key?: string
          p_quote_id: string
          p_valid_until: string
        }
        Returns: Json
      }
      admin_set_quote_deposit: {
        Args: {
          p_amount: number
          p_expected_row_version: number
          p_quote_id: string
          p_reason: string
          p_required: boolean
        }
        Returns: Json
      }
      admin_transition_maintenance_work_order: {
        Args: {
          p_actual_cost?: number
          p_diagnosis?: string
          p_expected_status?: string
          p_new_status: string
          p_next_service_due_date?: string
          p_next_service_due_km?: number
          p_odometer_at_completion?: number
          p_outcome?: string
          p_work_order_id: string
          p_work_performed?: string
        }
        Returns: Json
      }
      admin_update_vehicle: {
        Args: {
          p_accessibility_features?: Json
          p_admin_notes?: string
          p_expected_updated_at?: string
          p_license_plate?: string
          p_make?: string
          p_model?: string
          p_passenger_capacity?: number
          p_ramp_or_lift_available?: boolean
          p_service_interval_km?: number
          p_vehicle_id: string
          p_vehicle_name?: string
          p_vehicle_type?: string
          p_vin_number?: string
          p_wheelchair_accessible?: boolean
          p_wheelchair_capacity?: number
          p_year?: number
        }
        Returns: Json
      }
      admin_validate_operation_plan: {
        Args: { p_plan_id: string }
        Returns: Json
      }
      admin_validate_pricing_version: {
        Args: { p_version_id: string }
        Returns: Json
      }
      admin_view_ride_pin: { Args: { _ride_id: string }; Returns: Json }
      driver_accept_dispatch_offer: {
        Args: {
          p_expected_offer_version: number
          p_idempotency_key?: string
          p_offer_id: string
        }
        Returns: Json
      }
      driver_acknowledge_operation: {
        Args: {
          p_assignment_id: string
          p_expected_assignment_version: number
          p_idempotency_key?: string
        }
        Returns: Json
      }
      driver_current_vehicle_document_status: {
        Args: never
        Returns: {
          document_type: string
          expires_at: string
          is_current: boolean
          status: string
          vehicle_id: string
        }[]
      }
      driver_decline_dispatch_offer: {
        Args: {
          p_expected_offer_version: number
          p_offer_id: string
          p_reason?: string
        }
        Returns: Json
      }
      driver_decline_operation: {
        Args: {
          p_assignment_id: string
          p_expected_assignment_version: number
          p_reason: string
        }
        Returns: Json
      }
      driver_report_incident: {
        Args: {
          p_incident_type: string
          p_internal_notes: string
          p_passenger_visible_summary?: string
          p_run_id: string
          p_severity: string
          p_title: string
        }
        Returns: Json
      }
      driver_report_no_show: {
        Args: {
          p_details: string
          p_expected_run_version: number
          p_run_id: string
        }
        Returns: Json
      }
      driver_transition_operation: {
        Args: {
          p_expected_run_version: number
          p_idempotency_key?: string
          p_reason?: string
          p_run_id: string
          p_target_status: string
        }
        Returns: Json
      }
      driver_update_location: {
        Args: {
          p_accuracy?: number
          p_captured_at: string
          p_heading?: number
          p_latitude: number
          p_longitude: number
          p_operation_run_id?: string
          p_source?: string
        }
        Returns: Json
      }
      fleet_require_admin: { Args: never; Returns: string }
      generate_ride_pin: { Args: never; Returns: string }
      my_booking_companions: {
        Args: never
        Returns: {
          full_name: string
          id: string
          is_available: boolean
          photo_url: string
        }[]
      }
      normalize_vehicle_registration: {
        Args: { value: string }
        Returns: string
      }
      notify_approaching_scheduled_rides: { Args: never; Returns: undefined }
      operations_create_due_notifications: { Args: never; Returns: Json }
      operations_deliver_notification_outbox: {
        Args: { p_limit?: number }
        Returns: Json
      }
      operations_detect_conflicts: { Args: never; Returns: Json }
      operations_detect_reliability_alerts: { Args: never; Returns: Json }
      operations_expire_dispatch_offers: { Args: never; Returns: Json }
      operations_require_admin: { Args: never; Returns: string }
      operations_scheduler_tick: {
        Args: { p_scheduler_key?: string; p_trigger_source?: string }
        Returns: Json
      }
      passenger_accept_service_quote: {
        Args: {
          p_expected_row_version: number
          p_idempotency_key?: string
          p_quote_id: string
        }
        Returns: Json
      }
      passenger_active_driver_location: {
        Args: { p_operation_run_id: string }
        Returns: Json
      }
      passenger_create_priced_ride: {
        Args: {
          p_destination_address: string
          p_destination_lat: number
          p_destination_lng: number
          p_destination_place_id: string
          p_distance_km: number
          p_duration_seconds: number
          p_idempotency_key?: string
          p_pickup_address: string
          p_pickup_lat: number
          p_pickup_lng: number
          p_pickup_place_id: string
          p_request_type: string
          p_scheduled_at: string
        }
        Returns: Json
      }
      passenger_create_transport_booking: {
        Args: {
          p_assistance_codes?: string[]
          p_destination_address: string
          p_destination_lat: number
          p_destination_lng: number
          p_destination_place_id: string
          p_distance_km: number
          p_duration_seconds: number
          p_idempotency_key?: string
          p_passenger_notes?: string
          p_pickup_address: string
          p_pickup_lat: number
          p_pickup_lng: number
          p_pickup_place_id: string
          p_relationship: string
          p_request_type: string
          p_scheduled_at: string
          p_traveller_is_self: boolean
          p_traveller_name: string
          p_traveller_phone: string
        }
        Returns: Json
      }
      passenger_decline_service_quote: {
        Args: {
          p_expected_row_version: number
          p_quote_id: string
          p_reason?: string
        }
        Returns: Json
      }
      passenger_operation_timeline: {
        Args: { p_ride_id?: string; p_service_booking_id?: string }
        Returns: Json
      }
      passenger_pricing_estimate: {
        Args: {
          p_additional_inputs?: Json
          p_distance_km: number
          p_effective_at?: string
          p_service_code: string
        }
        Returns: Json
      }
      passenger_quote_summaries: { Args: never; Returns: Json }
      passenger_quote_workspace: {
        Args: { p_booking_id: string }
        Returns: Json
      }
      passenger_report_operation_issue: {
        Args: {
          p_description: string
          p_operation_run_id: string
          p_priority?: string
          p_subject: string
        }
        Returns: Json
      }
      passenger_update_priced_ride_route: {
        Args: {
          p_destination: Json
          p_distance_km: number
          p_duration_seconds: number
          p_expected_route_version: number
          p_pickup: Json
          p_ride_id: string
        }
        Returns: Json
      }
      pricing_assert_draft: {
        Args: { p_expected_row_version?: number; p_version_id: string }
        Returns: {
          created_at: string
          created_by: string | null
          currency: string
          description: string | null
          effective_from: string | null
          effective_to: string | null
          id: string
          is_mock: boolean
          name: string
          published_at: string | null
          published_by: string | null
          retired_at: string | null
          row_version: number
          service_code: string
          source_rule_id: string | null
          status: string
          updated_at: string
          version_number: number
        }
        SetofOptions: {
          from: "*"
          to: "pricing_versions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      pricing_calculate: {
        Args: {
          p_effective_at?: string
          p_inputs?: Json
          p_pricing_version_id?: string
          p_service_code: string
        }
        Returns: Json
      }
      pricing_expire_due_quotes: {
        Args: { p_booking_id?: string }
        Returns: number
      }
      pricing_require_admin: { Args: never; Returns: string }
      pricing_resolve_version: {
        Args: { p_effective_at?: string; p_service_code: string }
        Returns: {
          created_at: string
          created_by: string | null
          currency: string
          description: string | null
          effective_from: string | null
          effective_to: string | null
          id: string
          is_mock: boolean
          name: string
          published_at: string | null
          published_by: string | null
          retired_at: string | null
          row_version: number
          service_code: string
          source_rule_id: string | null
          status: string
          updated_at: string
          version_number: number
        }
        SetofOptions: {
          from: "*"
          to: "pricing_versions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      pricing_round_zar: { Args: { p_amount: number }; Returns: number }
      pricing_validate_version_internal: {
        Args: { p_version_id: string }
        Returns: Json
      }
      refresh_vehicle_assignment_compatibility: {
        Args: { p_driver_id?: string; p_vehicle_id: string }
        Returns: undefined
      }
      short_addr: { Args: { t: string }; Returns: string }
      support_add_message: {
        Args: {
          p_is_internal_note?: boolean
          p_message: string
          p_ticket_id: string
        }
        Returns: {
          created_at: string
          id: string
          is_internal_note: boolean
          message: string
          sender_id: string
          sender_role: string
          ticket_id: string
        }
        SetofOptions: {
          from: "*"
          to: "support_messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      support_admin_update_ticket: {
        Args: {
          p_assigned_admin_id?: string
          p_priority?: string
          p_resolution_summary?: string
          p_status?: string
          p_ticket_id: string
        }
        Returns: {
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
          vehicle_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "support_tickets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      support_create_ticket: {
        Args: {
          p_category: string
          p_description: string
          p_driver_id?: string
          p_passenger_id?: string
          p_priority?: string
          p_requester_role: string
          p_ride_id?: string
          p_service_booking_id?: string
          p_subject: string
        }
        Returns: {
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
          vehicle_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "support_tickets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      vehicle_has_expired_mandatory_document: {
        Args: {
          p_document_type: string
          p_legacy_expiry: string
          p_vehicle_id: string
        }
        Returns: boolean
      }
      verify_ride_start_pin: {
        Args: { _pin: string; _ride_id: string }
        Returns: Json
      }
    }
    Enums: {
      app_role: "passenger" | "driver" | "admin"
      assignment_status: "proposed" | "confirmed" | "cancelled" | "completed"
      assistance_requirement_code:
        | "boarding_assistance"
        | "wheelchair_transfer"
        | "door_to_door"
        | "facility_escort"
        | "hospital_assistance"
        | "airport_assistance"
        | "elderly_assistance"
        | "luggage_assistance"
        | "mobility_equipment"
        | "communication_assistance"
        | "other"
      booking_status:
        | "draft"
        | "submitted"
        | "awaiting_quote"
        | "quoted"
        | "accepted"
        | "resources_assigned"
        | "active"
        | "completed"
        | "cancelled"
      deposit_status: "none" | "pending" | "paid" | "refunded" | "waived"
      fleet_operational_status:
        | "active"
        | "maintenance"
        | "out_of_service"
        | "retired"
      itinerary_item_type:
        | "ride"
        | "waiting"
        | "appointment"
        | "accommodation"
        | "activity"
        | "other"
      journey_pattern:
        | "one_way"
        | "return"
        | "wait_and_return"
        | "recurring"
        | "multi_day"
      payment_status: "pending" | "paid" | "failed" | "refunded"
      quote_status:
        | "draft"
        | "sent"
        | "accepted"
        | "rejected"
        | "expired"
        | "declined"
        | "superseded"
        | "cancelled"
      ride_status:
        | "requested"
        | "accepted"
        | "driver_arriving"
        | "arrived"
        | "in_progress"
        | "completed"
        | "cancelled"
      service_type:
        | "transport"
        | "assisted"
        | "appointment"
        | "extended_journey"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["passenger", "driver", "admin"],
      assignment_status: ["proposed", "confirmed", "cancelled", "completed"],
      assistance_requirement_code: [
        "boarding_assistance",
        "wheelchair_transfer",
        "door_to_door",
        "facility_escort",
        "hospital_assistance",
        "airport_assistance",
        "elderly_assistance",
        "luggage_assistance",
        "mobility_equipment",
        "communication_assistance",
        "other",
      ],
      booking_status: [
        "draft",
        "submitted",
        "awaiting_quote",
        "quoted",
        "accepted",
        "resources_assigned",
        "active",
        "completed",
        "cancelled",
      ],
      deposit_status: ["none", "pending", "paid", "refunded", "waived"],
      fleet_operational_status: [
        "active",
        "maintenance",
        "out_of_service",
        "retired",
      ],
      itinerary_item_type: [
        "ride",
        "waiting",
        "appointment",
        "accommodation",
        "activity",
        "other",
      ],
      journey_pattern: [
        "one_way",
        "return",
        "wait_and_return",
        "recurring",
        "multi_day",
      ],
      payment_status: ["pending", "paid", "failed", "refunded"],
      quote_status: [
        "draft",
        "sent",
        "accepted",
        "rejected",
        "expired",
        "declined",
        "superseded",
        "cancelled",
      ],
      ride_status: [
        "requested",
        "accepted",
        "driver_arriving",
        "arrived",
        "in_progress",
        "completed",
        "cancelled",
      ],
      service_type: [
        "transport",
        "assisted",
        "appointment",
        "extended_journey",
      ],
    },
  },
} as const
