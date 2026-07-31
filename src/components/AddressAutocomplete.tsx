import { useEffect, useMemo, useRef, useState } from "react";
import { loadGoogleMaps } from "@/lib/google-maps";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, LocateFixed, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { geocodeAddress, resolvePlace, searchAddresses } from "@/lib/maps.functions";


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
  bias?: { lat: number; lng: number } | null;
  placeholder?: string;
  enableCurrentLocation?: boolean;
};

type Suggestion = {
  placeId: string;
  primary: string;
  secondary: string;
  /** Present only for browser-side (Maps JS) suggestions; server suggestions resolve via placeId. */
  raw?: google.maps.places.AutocompleteSuggestion;
};


type SavedAddress = {
  id: string;
  label: string;
  formatted_address: string;
  place_id: string | null;
  latitude: number;
  longitude: number;
  is_default: boolean;
};

const profileDb = supabase;

export function AddressAutocomplete({
  label,
  id,
  value,
  onChange,
  bias,
  placeholder,
  enableCurrentLocation,
}: Props) {
  const { user } = useAuth();
  const [text, setText] = useState(value?.address ?? "");
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mapsReady, setMapsReady] = useState(false);
  const [serverOnly, setServerOnly] = useState(false);

  const [dirty, setDirty] = useState(false);
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const placesLibRef = useRef<google.maps.PlacesLibrary | null>(null);
  const debounceRef = useRef<number | null>(null);
  const showSavedAddresses = /pickup/i.test(id);

  useEffect(() => {
    setText(value?.address ?? "");
    if (value) setDirty(false);
  }, [value]);

  useEffect(() => {
    if (!user || !showSavedAddresses) {
      setSavedAddresses([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      const { data } = await profileDb
        .from("passenger_saved_addresses")
        .select("id,label,formatted_address,place_id,latitude,longitude,is_default")
        .eq("passenger_id", user.id)
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: true })
        .limit(6);
      if (!cancelled) setSavedAddresses((data ?? []) as SavedAddress[]);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [user, showSavedAddresses]);

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then(async (googleInstance) => {
        if (cancelled) return;
        placesLibRef.current = (await googleInstance.maps.importLibrary(
          "places",
        )) as google.maps.PlacesLibrary;
        const { AutocompleteSessionToken } = placesLibRef.current;
        sessionTokenRef.current = new AutocompleteSessionToken();
        setMapsReady(true);
      })
      .catch((loadError) => {
        console.warn("Maps load failed — using server-side address search", loadError);
        if (!cancelled) setServerOnly(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const queryKey = useMemo(
    () => `${text}|${bias?.lat ?? ""}|${bias?.lng ?? ""}`,
    [text, bias?.lat, bias?.lng],
  );

  useEffect(() => {
    if (!mapsReady && !serverOnly) return;
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
      const library = placesLibRef.current;
      setLoading(true);
      setError(null);
      if (!library) {
        try {
          const serverSuggestions = await searchAddresses({
            data: { query: text.trim(), lat: bias?.lat, lng: bias?.lng },
          });
          setSuggestions(serverSuggestions);
          setOpen(serverSuggestions.length > 0);
        } catch (fallbackError) {
          console.warn("Server autocomplete failed", fallbackError);
          setError("Couldn't load suggestions. Type a full address.");
        } finally {
          setLoading(false);
        }
        return;
      }

      try {
        const request: google.maps.places.AutocompleteRequest = {
          input: text.trim(),
          sessionToken: sessionTokenRef.current ?? undefined,
          includedRegionCodes: ["za"],
          language: "en",
        };
        if (bias) {
          request.locationBias = {
            center: { lat: bias.lat, lng: bias.lng },
            radius: 30000,
          } as google.maps.CircleLiteral;
        }
        const { suggestions: raw } =
          await library.AutocompleteSuggestion.fetchAutocompleteSuggestions(request);
        const mapped: Suggestion[] = raw
          .map((suggestion) => {
            const prediction = suggestion.placePrediction;
            if (!prediction) return null;
            return {
              placeId: prediction.placeId,
              primary: prediction.mainText?.text ?? prediction.text.text,
              secondary: prediction.secondaryText?.text ?? "",
              raw: suggestion,
            } as Suggestion;
          })
          .filter((item): item is Suggestion => item !== null);
        setSuggestions(mapped);
        setOpen(true);
      } catch (suggestionError) {
        console.warn("Browser autocomplete failed, falling back to server", suggestionError);
        try {
          const serverSuggestions = await searchAddresses({
            data: { query: text.trim(), lat: bias?.lat, lng: bias?.lng },
          });
          setSuggestions(serverSuggestions);
          setOpen(serverSuggestions.length > 0);
          setError(serverSuggestions.length ? null : "No matching addresses found.");
        } catch (fallbackError) {
          console.warn("Server autocomplete failed", fallbackError);
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

  async function selectSuggestion(suggestion: Suggestion) {
    setOpen(false);
    setLoading(true);
    try {
      let pick: AddressPick;
      const library = placesLibRef.current;
      if (suggestion.raw?.placePrediction && library) {
        const place = suggestion.raw.placePrediction.toPlace();
        await place.fetchFields({ fields: ["formattedAddress", "location", "id"] });
        const location = place.location;
        if (!location) throw new Error("Place has no coordinates");
        pick = {
          address: place.formattedAddress ?? `${suggestion.primary}, ${suggestion.secondary}`,
          placeId: place.id ?? suggestion.placeId,
          lat: location.lat(),
          lng: location.lng(),
        };
        const { AutocompleteSessionToken } = library;
        sessionTokenRef.current = new AutocompleteSessionToken();
      } else {
        // Server-side resolution (Places API New via the connector gateway).
        const detail = await resolvePlace({ data: { placeId: suggestion.placeId } });
        pick = {
          address:
            detail.address ||
            [suggestion.primary, suggestion.secondary].filter(Boolean).join(", "),
          placeId: detail.placeId,
          lat: detail.lat,
          lng: detail.lng,
        };
      }
      setText(pick.address);
      setDirty(false);
      setError(null);
      onChange(pick);
    } catch (selectionError) {
      console.warn(selectionError);
      setError("Could not load that place. Try another.");
    } finally {
      setLoading(false);
    }
  }


  function selectSavedAddress(address: SavedAddress) {
    const pick: AddressPick = {
      address: address.formatted_address,
      placeId: address.place_id,
      lat: address.latitude,
      lng: address.longitude,
    };
    setText(pick.address);
    setDirty(false);
    setError(null);
    onChange(pick);
  }

  async function useCurrentLocation() {
    if (!("geolocation" in navigator)) {
      setError("Your browser doesn't expose location.");
      return;
    }
    setLoading(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude: lat, longitude: lng } = position.coords;
        try {
          const googleInstance = await loadGoogleMaps();
          const geocoder = new googleInstance.maps.Geocoder();
          const { results } = await geocoder.geocode({ location: { lat, lng } });
          const result = results[0];
          const pick: AddressPick = {
            address: result?.formatted_address ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
            placeId: result?.place_id ?? null,
            lat,
            lng,
          };
          setText(pick.address);
          setDirty(false);
          onChange(pick);
        } catch (locationError) {
          console.warn(locationError);
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
      (locationError) => {
        setLoading(false);
        if (locationError.code === locationError.PERMISSION_DENIED) {
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
        {enableCurrentLocation ? (
          <button
            type="button"
            onClick={useCurrentLocation}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            <LocateFixed className="h-3 w-3" />
            Use my location
          </button>
        ) : null}
      </div>
      {savedAddresses.length ? (
        <div className="flex flex-wrap gap-1.5" aria-label="Saved pickup addresses">
          {savedAddresses.map((address) => (
            <button
              key={address.id}
              type="button"
              onClick={() => selectSavedAddress(address)}
              className="inline-flex items-center gap-1 rounded-full border bg-secondary px-2.5 py-1 text-[11px] hover:border-primary/40"
            >
              <MapPin className="h-3 w-3 text-primary" />
              {address.label}
              {address.is_default ? " · Default" : ""}
            </button>
          ))}
        </div>
      ) : null}
      <div className="relative">
        <Input
          id={id}
          autoComplete="off"
          placeholder={placeholder}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setDirty(true);
            if (value) onChange(null);
          }}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          className={cn(value && "pr-8")}
        />
        {loading ? (
          <Loader2 className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : null}
        {open && suggestions.length > 0 ? (
          <ul className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-lg border bg-popover p-1 text-sm shadow-lg">
            {suggestions.map((suggestion) => (
              <li key={suggestion.placeId}>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectSuggestion(suggestion)}
                  className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-accent"
                >
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{suggestion.primary}</span>
                    {suggestion.secondary ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {suggestion.secondary}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {dirty && !value && text.trim().length >= 3 && !loading ? (
        <p className="text-xs text-warning-foreground">
          Pick an address from the suggestions to continue.
        </p>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
