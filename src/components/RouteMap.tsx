/**
 * Embedded Google Maps iframe showing the route from origin -> destination.
 * Uses the referrer-restricted browser key (safe to embed in HTML).
 */
export function RouteMap({
  origin,
  destination,
  className,
}: {
  origin?: { lat: number; lng: number };
  destination?: { lat: number; lng: number };
  className?: string;
}) {
  const key = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY as
    | string
    | undefined;

  if (!key) {
    return (
      <div
        className={
          "grid place-items-center rounded-xl border bg-muted text-sm text-muted-foreground " +
          (className ?? "h-48")
        }
      >
        Map unavailable
      </div>
    );
  }

  const base = "https://www.google.com/maps/embed/v1";
  const src =
    origin && destination
      ? `${base}/directions?key=${key}&origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}&mode=driving`
      : origin
        ? `${base}/place?key=${key}&q=${origin.lat},${origin.lng}`
        : `${base}/view?key=${key}&center=-26.2041,28.0473&zoom=11`; // Johannesburg default

  return (
    <iframe
      title="Route map"
      src={src}
      className={"w-full rounded-xl border " + (className ?? "h-48")}
      loading="lazy"
      referrerPolicy="no-referrer-when-downgrade"
    />
  );
}
