/**
 * Singleton loader for the Google Maps JavaScript API.
 * Uses the referrer-restricted browser key + the connector tracking ID.
 * Loads with `loading=async&callback=` so we know exactly when the API is ready.
 */

declare global {
  interface Window {
    google?: typeof google;
    __accessMapsCb?: () => void;
  }
}

let loaderPromise: Promise<typeof google> | null = null;

export function loadGoogleMaps(): Promise<typeof google> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Google Maps requires a browser"));
  }
  if (window.google?.maps) return Promise.resolve(window.google);
  if (loaderPromise) return loaderPromise;

  const key = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY as
    | string
    | undefined;
  const channel = import.meta.env
    .VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID as string | undefined;

  if (!key) {
    return Promise.reject(new Error("Google Maps browser key not configured"));
  }

  loaderPromise = new Promise<typeof google>((resolve, reject) => {
    window.__accessMapsCb = () => {
      if (window.google?.maps) resolve(window.google);
      else reject(new Error("Google Maps failed to initialize"));
    };
    const params = new URLSearchParams({
      key,
      v: "weekly",
      loading: "async",
      libraries: "places,marker",
      callback: "__accessMapsCb",
    });
    if (channel) params.set("channel", channel);

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.defer = true;
    script.onerror = () => reject(new Error("Failed to load Google Maps"));
    document.head.appendChild(script);
  });

  return loaderPromise;
}
