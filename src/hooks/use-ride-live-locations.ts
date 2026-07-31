import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type LiveLocationRow = Database["public"]["Tables"]["ride_live_locations"]["Row"];

/**
 * Subscribe to live location rows for a single ride. Returns the latest row
 * per (ride_id, user_id). Driven by Postgres Changes for MVP; the call site
 * doesn't need to know how the data arrives.
 */
export function useRideLiveLocations(rideId: string | null | undefined) {
  const [rows, setRows] = useState<LiveLocationRow[]>([]);

  useEffect(() => {
    if (!rideId) {
      setRows([]);
      return;
    }
    let cancelled = false;

    supabase
      .from("ride_live_locations")
      .select("*")
      .eq("ride_id", rideId)
      .then(({ data }) => {
        if (!cancelled) setRows((data ?? []) as LiveLocationRow[]);
      });

    const ch = supabase
      .channel(`ride-live-${rideId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "ride_live_locations",
          filter: `ride_id=eq.${rideId}`,
        },
        (payload) => {
          setRows((prev) => {
            if (payload.eventType === "DELETE") {
              const old = payload.old as LiveLocationRow;
              return prev.filter((r) => r.id !== old.id);
            }
            const next = payload.new as LiveLocationRow;
            const idx = prev.findIndex((r) => r.user_id === next.user_id);
            if (idx === -1) return [...prev, next];
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
