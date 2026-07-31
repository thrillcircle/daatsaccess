import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps } from "@/lib/google-maps";

type LatLng = { lat: number; lng: number };

type Props = {
  pickup: LatLng;
  destination: LatLng;
  driver?: LatLng | null;
  passenger?: LatLng | null;
  /** Which leg to draw: driver→pickup before pickup, pickup→destination once in progress. */
  phase: "beforePickup" | "inProgress";
  className?: string;
};

/**
 * Interactive Google Map for an active trip. Renders pickup + destination
 * markers, the driver and passenger live markers (when available), and a
 * polyline showing the active leg. Marker positions update in place — the
 * map is created once and reused across renders to avoid flicker.
 */
export function LiveTripMap({ pickup, destination, driver, passenger, phase, className }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<Record<string, google.maps.Marker>>({});
  const lineRef = useRef<google.maps.Polyline | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Initialize the map once.
  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then((g) => {
        if (cancelled || !containerRef.current) return;
        mapRef.current = new g.maps.Map(containerRef.current, {
          center: pickup,
          zoom: 13,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: "greedy",
          clickableIcons: false,
        });
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Map unavailable");
      });
    return () => {
      cancelled = true;
      Object.values(markersRef.current).forEach((m) => m.setMap(null));
      markersRef.current = {};
      lineRef.current?.setMap(null);
      lineRef.current = null;
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync markers + route line + viewport whenever inputs change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !window.google?.maps) return;
    const g = window.google;

    const upsertMarker = (
      key: string,
      pos: LatLng | null | undefined,
      opts: { label: string; color: string },
    ) => {
      const existing = markersRef.current[key];
      if (!pos) {
        if (existing) {
          existing.setMap(null);
          delete markersRef.current[key];
        }
        return;
      }
      if (existing) {
        existing.setPosition(pos);
        return;
      }
      markersRef.current[key] = new g.maps.Marker({
        map,
        position: pos,
        title: opts.label,
        icon: {
          path: g.maps.SymbolPath.CIRCLE,
          scale: 9,
          fillColor: opts.color,
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 2,
        },
      });
    };

    upsertMarker("pickup", pickup, { label: "Pickup", color: "#10b981" });
    upsertMarker("destination", destination, { label: "Destination", color: "#ef4444" });
    upsertMarker("driver", driver ?? null, { label: "Driver", color: "#2563eb" });
    upsertMarker("passenger", passenger ?? null, { label: "You", color: "#f59e0b" });

    // Active route leg: from → to.
    const from = phase === "inProgress" ? pickup : (driver ?? pickup);
    const to = phase === "inProgress" ? destination : pickup;
    const path = [from, to];
    if (lineRef.current) {
      lineRef.current.setPath(path);
    } else {
      lineRef.current = new g.maps.Polyline({
        map,
        path,
        geodesic: true,
        strokeColor: "#2563eb",
        strokeOpacity: 0.85,
        strokeWeight: 4,
      });
    }

    // Fit viewport around everything that's visible.
    const bounds = new g.maps.LatLngBounds();
    bounds.extend(pickup);
    bounds.extend(destination);
    if (driver) bounds.extend(driver);
    if (passenger) bounds.extend(passenger);
    map.fitBounds(bounds, 64);
  }, [pickup, destination, driver, passenger, phase]);

  if (error) {
    return (
      <div
        className={
          "grid place-items-center rounded-xl border bg-muted text-sm text-muted-foreground " +
          (className ?? "h-56")
        }
      >
        {error}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={"w-full rounded-xl border " + (className ?? "h-56")}
      aria-label="Live trip map"
    />
  );
}
