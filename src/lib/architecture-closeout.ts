import { supabase } from "@/integrations/supabase/client";

type RpcError = { message: string } | null;
type RpcResult<T> = Promise<{ data: T | null; error: RpcError }>;
type Rpc = <T>(name: string, args?: Record<string, unknown>) => RpcResult<T>;

const rpc = supabase.rpc.bind(supabase) as unknown as Rpc;

export type AppRole = "passenger" | "driver" | "admin";
export type ManagedUser = {
  user_id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  roles: AppRole[];
  status: "active" | "suspended";
  created_at: string;
};

export type AppSetting = {
  key: string;
  value: unknown;
  category: string;
  description: string | null;
  updated_at: string;
};

export type AuditEvent = {
  id: string;
  actor_user_id: string | null;
  action: string;
  module: string;
  target_type: string | null;
  target_id: string | null;
  outcome: string;
  before_data: unknown;
  after_data: unknown;
  context: unknown;
  created_at: string;
};

export type ShiftVehicle = {
  id: string;
  vehicle_name: string;
  license_plate: string;
  make?: string | null;
  model?: string | null;
};

export type VehicleShift = {
  id: string;
  status: "active" | "completed";
  vehicle_id: string;
  started_at: string;
  ended_at: string | null;
  start_odometer_km: number;
  end_odometer_km: number | null;
  start_notes: string | null;
  end_notes: string | null;
  handover_notes: string | null;
  vehicle?: ShiftVehicle;
};

export type ShiftDashboard = {
  activeShift: VehicleShift | null;
  vehicles: ShiftVehicle[];
  history: VehicleShift[];
};

function unwrap<T>(result: { data: T | null; error: RpcError }): T {
  if (result.error) throw new Error(result.error.message);
  if (result.data === null) throw new Error("The server returned no data");
  return result.data;
}

export async function listManagedUsers(): Promise<ManagedUser[]> {
  return unwrap(await rpc<ManagedUser[]>("admin_list_users"));
}

export async function getCurrentAccountStatus(): Promise<"active" | "suspended"> {
  return unwrap(await rpc<"active" | "suspended">("current_account_status"));
}

export type AdminVehicleShift = {
  id: string;
  status: string;
  driverUserId: string;
  driverName: string | null;
  vehicleId: string;
  vehicleName: string;
  licensePlate: string;
  startedAt: string;
  endedAt: string | null;
  startOdometerKm: number;
  endOdometerKm: number | null;
  startNotes: string | null;
  endNotes: string | null;
  handoverNotes: string | null;
};

export async function listAdminVehicleShifts(): Promise<AdminVehicleShift[]> {
  return unwrap(await rpc<AdminVehicleShift[]>("admin_list_vehicle_shifts"));
}

export async function setUserStatus(
  userId: string,
  status: "active" | "suspended",
  reason: string,
) {
  const result = await rpc<null>("admin_set_user_status", {
    p_user_id: userId,
    p_status: status,
    p_reason: reason || null,
  });
  if (result.error) throw new Error(result.error.message);
}

export async function setUserRoles(userId: string, roles: AppRole[]) {
  const result = await rpc<null>("admin_set_user_roles", { p_user_id: userId, p_roles: roles });
  if (result.error) throw new Error(result.error.message);
}

export async function updateSetting(key: string, value: unknown) {
  const result = await rpc<null>("admin_update_setting", { p_key: key, p_value: value });
  if (result.error) throw new Error(result.error.message);
}

export async function listSettings(): Promise<AppSetting[]> {
  return unwrap(await rpc<AppSetting[]>("admin_list_settings"));
}

export async function listAuditEvents(limit = 250): Promise<AuditEvent[]> {
  return unwrap(await rpc<AuditEvent[]>("admin_list_audit_events", { p_limit: limit }));
}

export async function getShiftDashboard(): Promise<ShiftDashboard> {
  return unwrap(await rpc<ShiftDashboard>("driver_shift_dashboard"));
}

export async function startVehicleShift(
  vehicleId: string,
  odometer: number,
  checklist: Record<string, boolean>,
  notes: string,
) {
  return unwrap(
    await rpc<string>("driver_start_vehicle_shift", {
      p_vehicle_id: vehicleId,
      p_odometer: odometer,
      p_checklist: checklist,
      p_notes: notes || null,
    }),
  );
}

export async function endVehicleShift(
  shiftId: string,
  odometer: number,
  checklist: Record<string, boolean>,
  notes: string,
  handover: string,
) {
  const result = await rpc<null>("driver_end_vehicle_shift", {
    p_shift_id: shiftId,
    p_odometer: odometer,
    p_checklist: checklist,
    p_notes: notes || null,
    p_handover: handover || null,
  });
  if (result.error) throw new Error(result.error.message);
}
