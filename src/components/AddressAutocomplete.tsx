import { useEffect, useMemo, useRef, useState } from "react";
import { loadGoogleMaps } from "@/lib/google-maps";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, LocateFixed, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type AddressPick = {
  address: string;
  placeId: string | null;
  lat: number;
  lng: number;
};

type Props = {
  label: string;
  id: string;
  value: AddressPick | null;
  onChange: (pick: AddressPick | null) => void;
  /** Bias search results around this location (passenger's current location). */
  bias?: { lat: number; lng: number } | null;
  placeholder?: string;
  /** Show the "Use my current location" shortcut. */
  enableCurrentLocation?: boolean;
};

type Suggestion = {
  placeId: string;
  primary: string;
  secondary: string;
  /** Lazy-fetched on select. */
  raw: google.maps.places.AutocompleteSuggestion;
};

export function AddressAutocomplete({
  label,
  id,
  value,
  onChange,
  bias,
  placeholder,
  enableCurrentLocation,
}: Props) {
  const [text, setText] = useState(value?.address ?? "");
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mapsReady, setMapsReady] = useState(false);
  const [dirty, setDirty] = useState(false);
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const placesLibRef = useRef<google.maps.PlacesLibrary | null>(null);
  const debounceRef = useRef<number | null>(null);

  // Keep input in sync if parent clears value.
  useEffect(() => {
    setText(value?.address ?? "");
    if (value) setDirty(false);
  }, [value]);

  // Load Maps JS once.
  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then(async (g) => {
        if (cancelled) return;
        placesLibRef.current = (await g.maps.importLibrary(
          "places",
        )) as google.maps.PlacesLibrary;
        const { AutocompleteSessionToken } = placesLibRef.current;
        sessionTokenRef.current = new AutocompleteSessionToken();
        setMapsReady(true);
      })
      .catch((err) => {
        console.warn("Maps load failed", err);
        setError("Address search unavailable — type a full address.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounced suggestion fetch.
  const queryKey = useMemo(
    () => `${text}|${bias?.lat ?? ""}|${bias?.lng ?? ""}`,
    [text, bias?.lat, bias?.lng],
  );

  useEffect(() => {
    if (!mapsReady) return;
    if (text.trim().length < 3) {
      setSuggestions([]);
      setLoading(false);
      return;
    }
    if (value && value.address === text) {
      setSuggestions([]);
      return;
    }
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      const lib = placesLibRef.current;
      if (!lib) return;
      setLoading(true);
      setError(null);
      try {
        const req: google.maps.places.AutocompleteRequest = {
          input: text.trim(),
          sessionToken: sessionTokenRef.current ?? undefined,
          includedRegionCodes: ["za"],
          language: "en",
        };
        if (bias) {
          // 30km circle around the passenger as a soft bias.
          req.locationBias = {
            center: { lat: bias.lat, lng: bias.lng },
            radius: 30000,
          } as google.maps.CircleLiteral;
        }
        const { suggestions: raw } =
          await lib.AutocompleteSuggestion.fetchAutocompleteSuggestions(req);
        const mapped: Suggestion[] = raw
          .map((s) => {
            const p = s.placePrediction;
            if (!p) return null;
            return {
              placeId: p.placeId,
              primary: p.mainText?.text ?? p.text.text,
              secondary: p.secondaryText?.text ?? "",
              raw: s,
            } as Suggestion;
          })
          .filter((x): x is Suggestion => x !== null);
        setSuggestions(mapped);
        setOpen(true);
      } catch (err) {
        console.warn("Autocomplete failed", err);
        const msg = err instanceof Error ? err.message : String(err);
        if (/referer .* blocked/i.test(msg)) {
          setError(
            "Address search isn't available on this domain — open the published preview link to test it.",
          );
        } else {
          setError("Couldn't load suggestions. Type a full address.");
        }
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey, mapsReady]);

  async function selectSuggestion(s: Suggestion) {
    const lib = placesLibRef.current;
    if (!lib) return;
    setOpen(false);
    setLoading(true);
    try {
      const place = s.raw.placePrediction!.toPlace();
      await place.fetchFields({ fields: ["formattedAddress", "location", "id"] });
      const loc = place.location;
      if (!loc) throw new Error("Place has no coordinates");
      const pick: AddressPick = {
        address: place.formattedAddress ?? `${s.primary}, ${s.secondary}`,
        placeId: place.id ?? s.placeId,
        lat: loc.lat(),
        lng: loc.lng(),
      };
      setText(pick.address);
      setDirty(false);
      onChange(pick);
      // Start a fresh session for the next search (Places billing convention).
      const { AutocompleteSessionToken } = lib;
      sessionTokenRef.current = new AutocompleteSessionToken();
    } catch (err) {
      console.warn(err);
      setError("Could not load that place. Try another.");
    } finally {
      setLoading(false);
    }
  }

  async function useCurrentLocation() {
    if (!("geolocation" in navigator)) {
      setError("Your browser doesn't expose location.");
      return;
    }
    setLoading(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        // Reverse-geocode via Maps JS Geocoder.
        try {
          const g = await loadGoogleMaps();
          const geocoder = new g.maps.Geocoder();
          const { results } = await geocoder.geocode({ location: { lat, lng } });
          const r = results[0];
          const pick: AddressPick = {
            address: r?.formatted_address ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
            placeId: r?.place_id ?? null,
            lat,
            lng,
          };
          setText(pick.address);
          setDirty(false);
          onChange(pick);
        } catch (err) {
          console.warn(err);
          // Still let the user proceed with raw coords as the address.
          const pick: AddressPick = {
            address: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
            placeId: null,
            lat,
            lng,
          };
          setText(pick.address);
          setDirty(false);
          onChange(pick);
        } finally {
          setLoading(false);
        }
      },
      (err) => {
        setLoading(false);
        if (err.code === err.PERMISSION_DENIED) {
          setError("Location permission denied.");
        } else {
          setError("Couldn't get your location.");
        }
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor={id}>{label}</Label>
        {enableCurrentLocation && (
          <button
            type="button"
            onClick={useCurrentLocation}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            <LocateFixed className="h-3 w-3" />
            Use my location
          </button>
        )}
      </div>
      <div className="relative">
        <Input
          id={id}
          autoComplete="off"
          placeholder={placeholder}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setDirty(true);
            if (value) onChange(null);
          }}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          className={cn(value && "pr-8")}
        />
        {loading && (
          <Loader2 className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
        {open && suggestions.length > 0 && (
          <ul className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-lg border bg-popover p-1 text-sm shadow-lg">
            {suggestions.map((s) => (
              <li key={s.placeId}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => selectSuggestion(s)}
                  className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-accent"
                >
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{s.primary}</span>
                    {s.secondary && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {s.secondary}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {dirty && !value && text.trim().length >= 3 && !loading && (
        <p className="text-xs text-warning-foreground">
          Pick an address from the suggestions to continue.
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
