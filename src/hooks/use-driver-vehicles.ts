import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type DriverProfile = Database["public"]["Tables"]["driver_profiles"]["Row"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];

export type DriverVehicle = {
  id: string;                    // driver_profiles.id
  user_id: string;               // owner of the record
  vehicle_type: string | null;
  vehicle_model: string | null;
  license_plate: string | null;
  is_available: boolean;
  current_lat: number | null;
  current_lng: number | null;
  location_updated_at: string | null;
  isValidDriver: boolean;        // user_roles contains 'driver'
  ownerRole: "driver" | "admin" | "passenger" | "other" | "unknown";
  ownerName: string | null;
  ownerPhone: string | null;
};

type Row = {
  driver: DriverProfile;
  profile: Profile | null;
  roles: string[];
};

const ROLE_PRIORITY = ["driver", "admin", "passenger"] as const;

function pickRole(roles: string[]): DriverVehicle["ownerRole"] {
  for (const r of ROLE_PRIORITY) if (roles.includes(r)) return r;
  return roles.length ? "other" : "unknown";
}

export function useDriverVehicles(enabled: boolean) {
  const [data, setData] = useState<DriverVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: drv } = await supabase
        .from("driver_profiles")
        .select("*")
        .order("location_updated_at", { ascending: false, nullsFirst: false });
      const drivers = (drv ?? []) as DriverProfile[];
      const userIds = drivers.map((d) => d.user_id);
      if (!userIds.length) {
        if (!cancelled) {
          setData([]);
          setLoading(false);
        }
        return;
      }
      const [{ data: profs }, { data: roleRows }] = await Promise.all([
        supabase.from("profiles").select("*").in("user_id", userIds),
        supabase.from("user_roles").select("user_id, role").in("user_id", userIds),
      ]);
      const profMap = new Map<string, Profile>();
      for (const p of (profs ?? []) as Profile[]) profMap.set(p.user_id, p);
      const roleMap = new Map<string, string[]>();
      for (const r of (roleRows ?? []) as { user_id: string; role: string }[]) {
        const arr = roleMap.get(r.user_id) ?? [];
        arr.push(r.role);
        roleMap.set(r.user_id, arr);
      }
      const merged: DriverVehicle[] = drivers.map((d) => {
        const profile = profMap.get(d.user_id) ?? null;
        const roles = roleMap.get(d.user_id) ?? [];
        return {
          id: d.id,
          user_id: d.user_id,
          vehicle_type: d.vehicle_type,
          vehicle_model: d.vehicle_model,
          license_plate: d.license_plate,
          is_available: d.is_available,
          current_lat: d.current_lat,
          current_lng: d.current_lng,
          location_updated_at: d.location_updated_at,
          isValidDriver: roles.includes("driver"),
          ownerRole: pickRole(roles),
          ownerName: profile?.full_name ?? null,
          ownerPhone: profile?.phone ?? null,
        };
      });
      if (!cancelled) {
        setData(merged);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [enabled, tick]);

  // Realtime: any change to driver_profiles or user_roles triggers refresh.
  useEffect(() => {
    if (!enabled) return;
    const ch = supabase
      .channel("driver-vehicles-shared")
      .on("postgres_changes", { event: "*", schema: "public", table: "driver_profiles" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "user_roles" }, refresh)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [enabled, refresh]);

  return { vehicles: data, loading, refresh };
}

/** List of valid driver users available for reassignment selection. */
export type ValidDriverOption = {
  user_id: string;
  full_name: string | null;
  hasVehicle: boolean;
};

export function useValidDrivers(enabled: boolean) {
  const [drivers, setDrivers] = useState<ValidDriverOption[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "driver");
      const ids = (roles ?? []).map((r) => r.user_id);
      if (!ids.length) {
        if (!cancelled) { setDrivers([]); setLoading(false); }
        return;
      }
      const [{ data: profs }, { data: dps }] = await Promise.all([
        supabase.from("profiles").select("user_id, full_name").in("user_id", ids),
        supabase.from("driver_profiles").select("user_id").in("user_id", ids),
      ]);
      const profMap = new Map((profs ?? []).map((p) => [p.user_id, p.full_name] as const));
      const has = new Set((dps ?? []).map((d) => d.user_id));
      const out: ValidDriverOption[] = ids.map((id) => ({
        user_id: id,
        full_name: profMap.get(id) ?? null,
        hasVehicle: has.has(id),
      }));
      out.sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? ""));
      if (!cancelled) { setDrivers(out); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [enabled]);
  return { drivers, loading };
}
