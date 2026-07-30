import { describe, expect, it } from "vitest";
import type { Database } from "@/integrations/supabase/types";

const phase3Tables = [
  "vehicle_legacy_mappings",
  "fleet_consolidation_issues",
  "fleet_operation_requests",
  "vehicle_driver_assignments",
  "vehicle_documents",
  "vehicle_maintenance_work_orders",
  "vehicle_maintenance_events",
  "vehicle_odometer_events",
  "vehicle_status_events",
] as const satisfies readonly (keyof Database["public"]["Tables"])[];

const phase3Functions = [
  "admin_create_vehicle",
  "admin_update_vehicle",
  "admin_change_vehicle_status",
  "admin_assign_ride_resources",
  "admin_end_vehicle_assignment",
  "admin_transition_maintenance_work_order",
  "admin_save_vehicle_document",
  "admin_link_support_vehicle",
  "driver_current_vehicle_document_status",
] as const satisfies readonly (keyof Database["public"]["Functions"])[];

describe("Phase 3 generated database types", () => {
  it("includes the canonical fleet tables", () => {
    expect(phase3Tables).toHaveLength(9);
  });

  it("includes the protected fleet operations", () => {
    expect(phase3Functions).toHaveLength(9);
  });
});
