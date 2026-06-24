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
          booking_id: string
          driver_user_id: string
          id: string
          itinerary_item_id: string | null
          notes: string | null
          status: Database["public"]["Enums"]["assignment_status"]
        }
        Insert: {
          assigned_at?: string
          booking_id: string
          driver_user_id: string
          id?: string
          itinerary_item_id?: string | null
          notes?: string | null
          status?: Database["public"]["Enums"]["assignment_status"]
        }
        Update: {
          assigned_at?: string
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
          fleet_vehicle_id: string
          id: string
          itinerary_item_id: string | null
          notes: string | null
          status: Database["public"]["Enums"]["assignment_status"]
        }
        Insert: {
          assigned_at?: string
          booking_id: string
          fleet_vehicle_id: string
          id?: string
          itinerary_item_id?: string | null
          notes?: string | null
          status?: Database["public"]["Enums"]["assignment_status"]
        }
        Update: {
          assigned_at?: string
          booking_id?: string
          fleet_vehicle_id?: string
          id?: string
          itinerary_item_id?: string | null
          notes?: string | null
          status?: Database["public"]["Enums"]["assignment_status"]
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
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          read_at: string | null
          ride_id: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          read_at?: string | null
          ride_id?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          read_at?: string | null
          ride_id?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
        ]
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
          estimated_total: number | null
          id: string
          journey_pattern: Database["public"]["Enums"]["journey_pattern"]
          parent_booking_id: string | null
          passenger_notes: string | null
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
          estimated_total?: number | null
          id?: string
          journey_pattern: Database["public"]["Enums"]["journey_pattern"]
          parent_booking_id?: string | null
          passenger_notes?: string | null
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
          estimated_total?: number | null
          id?: string
          journey_pattern?: Database["public"]["Enums"]["journey_pattern"]
          parent_booking_id?: string | null
          passenger_notes?: string | null
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
        ]
      }
      service_quote_items: {
        Row: {
          description: string | null
          id: string
          label: string
          line_total: number
          quantity: number
          quote_id: string
          sort_order: number
          unit_price: number
        }
        Insert: {
          description?: string | null
          id?: string
          label: string
          line_total?: number
          quantity?: number
          quote_id: string
          sort_order?: number
          unit_price?: number
        }
        Update: {
          description?: string | null
          id?: string
          label?: string
          line_total?: number
          quantity?: number
          quote_id?: string
          sort_order?: number
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
        ]
      }
      service_quotes: {
        Row: {
          booking_id: string
          created_at: string
          created_by_user_id: string | null
          currency: string
          id: string
          notes: string | null
          quote_reference: string
          status: Database["public"]["Enums"]["quote_status"]
          subtotal: number
          tax_amount: number
          total: number
          updated_at: string
          valid_until: string | null
        }
        Insert: {
          booking_id: string
          created_at?: string
          created_by_user_id?: string | null
          currency?: string
          id?: string
          notes?: string | null
          quote_reference?: string
          status?: Database["public"]["Enums"]["quote_status"]
          subtotal?: number
          tax_amount?: number
          total?: number
          updated_at?: string
          valid_until?: string | null
        }
        Update: {
          booking_id?: string
          created_at?: string
          created_by_user_id?: string | null
          currency?: string
          id?: string
          notes?: string | null
          quote_reference?: string
          status?: Database["public"]["Enums"]["quote_status"]
          subtotal?: number
          tax_amount?: number
          total?: number
          updated_at?: string
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
      vehicle_profiles: {
        Row: {
          admin_notes: string | null
          assigned_driver_id: string | null
          created_at: string
          current_odometer_km: number
          id: string
          insurance_expiry_date: string | null
          last_service_date: string | null
          last_service_km: number | null
          license_disc_expiry_date: string | null
          license_plate: string
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
          admin_notes?: string | null
          assigned_driver_id?: string | null
          created_at?: string
          current_odometer_km?: number
          id?: string
          insurance_expiry_date?: string | null
          last_service_date?: string | null
          last_service_km?: number | null
          license_disc_expiry_date?: string | null
          license_plate: string
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
          admin_notes?: string | null
          assigned_driver_id?: string | null
          created_at?: string
          current_odometer_km?: number
          id?: string
          insurance_expiry_date?: string | null
          last_service_date?: string | null
          last_service_km?: number | null
          license_disc_expiry_date?: string | null
          license_plate?: string
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_acknowledge_pin_alert: { Args: { _ride_id: string }; Returns: Json }
      admin_reset_ride_pin: { Args: { _ride_id: string }; Returns: Json }
      admin_view_ride_pin: { Args: { _ride_id: string }; Returns: Json }
      generate_ride_pin: { Args: never; Returns: string }
      notify_approaching_scheduled_rides: { Args: never; Returns: undefined }
      short_addr: { Args: { t: string }; Returns: string }
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
      quote_status: "draft" | "sent" | "accepted" | "rejected" | "expired"
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
      quote_status: ["draft", "sent", "accepted", "rejected", "expired"],
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
