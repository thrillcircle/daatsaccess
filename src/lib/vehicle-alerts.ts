import type { Database } from "@/integrations/supabase/types";

export type VehicleProfile = Database["public"]["Tables"]["vehicle_profiles"]["Row"];

export type VehicleAlertSeverity = "warning" | "urgent";
export type VehicleAlert = {
  label: string;
  severity: VehicleAlertSeverity;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const SERVICE_WARN_KM = 1000;
const DOC_WARN_DAYS = 30;

function daysUntil(date: string | null | undefined): number | null {
  if (!date) return null;
  const t = new Date(date + "T00:00:00").getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((t - Date.now()) / DAY_MS);
}

export function getVehicleAlerts(
  v: Pick<
    VehicleProfile,
    | "current_odometer_km"
    | "next_service_due_km"
    | "roadworthy_expiry_date"
    | "license_disc_expiry_date"
    | "insurance_expiry_date"
  >,
): VehicleAlert[] {
  const alerts: VehicleAlert[] = [];

  const odo = Number(v.current_odometer_km ?? 0);
  const due = v.next_service_due_km != null ? Number(v.next_service_due_km) : null;
  if (due != null && due > 0) {
    if (odo >= due) alerts.push({ label: "Service overdue", severity: "urgent" });
    else if (due - odo <= SERVICE_WARN_KM)
      alerts.push({ label: "Service due soon", severity: "warning" });
  }

  const docs: Array<[string, string | null | undefined]> = [
    ["License", v.license_disc_expiry_date],
    ["Insurance", v.insurance_expiry_date],
    ["Roadworthy", v.roadworthy_expiry_date],
  ];
  for (const [name, d] of docs) {
    const days = daysUntil(d);
    if (days == null) continue;
    if (days < 0) alerts.push({ label: `${name} expired`, severity: "urgent" });
    else if (days <= DOC_WARN_DAYS)
      alerts.push({ label: `${name} expiring soon`, severity: "warning" });
  }

  return alerts;
}

export function highestSeverity(alerts: VehicleAlert[]): VehicleAlertSeverity | null {
  if (alerts.some((a) => a.severity === "urgent")) return "urgent";
  if (alerts.length) return "warning";
  return null;
}
