import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps } from "@/lib/google-maps";

export function RouteMap({
  origin,
  destination,
  className,
}: {
  origin?: { lat: number; lng: number };
  destination?: { lat: number; lng: number };
  className?: string;
}) {
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
          center: origin ?? { lat: -26.2041, lng: 28.0473 },
          zoom: 11,
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

  // Sync markers + route line whenever inputs change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !window.google?.maps) return;
    const g = window.google;

    const upsertMarker = (
      key: string,
      pos: { lat: number; lng: number } | undefined,
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

    upsertMarker("origin", origin, { label: "Pickup", color: "#10b981" });
    upsertMarker("destination", destination, { label: "Destination", color: "#ef4444" });

    if (origin && destination) {
      if (lineRef.current) {
        lineRef.current.setPath([origin, destination]);
      } else {
        lineRef.current = new g.maps.Polyline({
          map,
          path: [origin, destination],
          geodesic: true,
          strokeColor: "#2563eb",
          strokeOpacity: 0.85,
          strokeWeight: 4,
        });
      }
      const bounds = new g.maps.LatLngBounds();
      bounds.extend(origin);
      bounds.extend(destination);
      map.fitBounds(bounds, 64);
    } else if (origin) {
      lineRef.current?.setMap(null);
      lineRef.current = null;
      map.setCenter(origin);
      map.setZoom(15);
    } else {
      lineRef.current?.setMap(null);
      lineRef.current = null;
      map.setCenter({ lat: -26.2041, lng: 28.0473 });
      map.setZoom(11);
    }
  }, [origin, destination]);

  if (error) {
    return (
      <div
        className={
          "grid place-items-center rounded-xl border bg-muted text-sm text-muted-foreground " +
          (className ?? "h-48")
        }
      >
        {error}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={"w-full rounded-xl border " + (className ?? "h-48")}
      aria-label="Route map"
    />
  );
}
