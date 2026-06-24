import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type RideChangeRow =
  Database["public"]["Tables"]["ride_change_log"]["Row"];

/**
 * Subscribe to ride_change_log entries for a single ride, newest first.
 * Used by both the passenger (history) and the driver ("Trip updated" alert).
 */
export function useRideChanges(rideId: string | null | undefined) {
  const [rows, setRows] = useState<RideChangeRow[]>([]);

  useEffect(() => {
    if (!rideId) {
      setRows([]);
      return;
    }
    let cancelled = false;

    supabase
      .from("ride_change_log")
      .select("*")
      .eq("ride_id", rideId)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (!cancelled) setRows((data ?? []) as RideChangeRow[]);
      });

    const ch = supabase
      .channel(`ride-changes-${rideId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "ride_change_log",
          filter: `ride_id=eq.${rideId}`,
        },
        (payload) => {
          setRows((prev) => {
            if (payload.eventType === "DELETE") {
              const old = payload.old as RideChangeRow;
              return prev.filter((r) => r.id !== old.id);
            }
            const next = payload.new as RideChangeRow;
            const idx = prev.findIndex((r) => r.id === next.id);
            if (idx === -1) return [next, ...prev];
            const copy = prev.slice();
            copy[idx] = next;
            return copy;
          });
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [rideId]);

  return rows;
}
