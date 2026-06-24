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
          last_route_updated_at: string | null
          passenger_id: string
          pickup_address: string
          pickup_lat: number
          pickup_lng: number
          pickup_place_id: string | null
          request_type: string
          route_version: number
          scheduled_at: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["ride_status"]
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          actual_distance_km?: number
          actual_duration_seconds?: number | null
          completed_at?: string | null
          created_at?: string
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
          last_route_updated_at?: string | null
          passenger_id: string
          pickup_address: string
          pickup_lat: number
          pickup_lng: number
          pickup_place_id?: string | null
          request_type?: string
          route_version?: number
          scheduled_at?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["ride_status"]
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          actual_distance_km?: number
          actual_duration_seconds?: number | null
          completed_at?: string | null
          created_at?: string
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
          last_route_updated_at?: string | null
          passenger_id?: string
          pickup_address?: string
          pickup_lat?: number
          pickup_lng?: number
          pickup_place_id?: string | null
          request_type?: string
          route_version?: number
          scheduled_at?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["ride_status"]
          updated_at?: string
        }
        Relationships: []
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
      payment_status: "pending" | "paid" | "failed" | "refunded"
      ride_status:
        | "requested"
        | "accepted"
        | "driver_arriving"
        | "arrived"
        | "in_progress"
        | "completed"
        | "cancelled"
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
      payment_status: ["pending", "paid", "failed", "refunded"],
      ride_status: [
        "requested",
        "accepted",
        "driver_arriving",
        "arrived",
        "in_progress",
        "completed",
        "cancelled",
      ],
    },
  },
} as const
