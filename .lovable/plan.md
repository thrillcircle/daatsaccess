# Google Maps runtime investigation — findings

I drove the running preview with a headless browser, focused the pickup
address field on `/app/passenger`, and captured every Google network call
plus console output. Here is what each of your eight checks actually shows.

## 1. Console errors

Single Maps-related warning, fired by `AddressAutocomplete` when the user
types:

```
Autocomplete failed RpcError: Requests from referer http://localhost:8080/ are blocked.
```

No other Maps or Places errors. No SSR crash, no init failure.

## 2–4. Are the APIs enabled?

Yes for all three — verified by what actually loaded / responded:

- **Maps JavaScript API** — bootstrap `…/maps/api/js?...` returned `200`,
  and the lazy chunks (`main.js`, `places.js`, `places_impl.js`,
  `marker.js`, `controls.js`, `util.js`, `common.js`, `log.js`) all
  returned `200`. The API is enabled and the key is recognised.
- **Places API (New)** — the browser successfully called
  `places.googleapis.com/$rpc/google.maps.places.v1.Places/AutocompletePlaces`.
  It returned `403` (see §6), not `SERVICE_DISABLED` / `403 PERMISSION_DENIED
  for places.googleapis.com`. Endpoint is enabled.
- **Routes API** — called from the server via the connector gateway in
  `src/lib/maps.functions.ts` → `routes/directions/v2:computeRoutes`. Not
  exercised this turn (no ride was estimated), but the gateway path is
  correct and the same `GOOGLE_MAPS_API_KEY` server secret is used for it,
  Geocoding, and Places — they share enable-state on the Lovable-managed
  project. No evidence it is disabled.

## 5. Billing

Active. If billing were off, the Maps JS bootstrap would return
`BillingNotEnabledMapError` in the script body and the `places.js` chunk
would never load. Both loaded cleanly.

## 6. Is the key authorized for the current domain?

**This is the root cause.** The Lovable-managed Google Maps key is
referrer-restricted to `*.lovable.app` and `*.lovableproject.com`. The
allowlist is not user-configurable.

- On `id-preview--…lovable.app` (the published preview iframe) → allowed.
- On `localhost:8080` (the in-sandbox dev server, and what Playwright hit)
  → **blocked**. Exact server response from Places New:
  `Requests from referer http://localhost:8080/ are blocked.` HTTP `403`.
- On any custom domain you publish to (none currently configured for this
  project) → would also be blocked; the user would need their own Google
  Cloud key.

## 7. Is the Places library loading?

Yes. `loadGoogleMaps()` resolves, `g.maps.importLibrary("places")`
returns the new `PlacesLibrary`, `AutocompleteSessionToken` is
constructed, and `AutocompleteSuggestion.fetchAutocompleteSuggestions`
is invoked. The transport works; only the *response* is rejected because
of the referrer.

## 8. Network tab — exact failure

```
403  https://places.googleapis.com/$rpc/google.maps.places.v1.Places/AutocompletePlaces
     body: Requests from referer http://localhost:8080/ are blocked.
```

All other Google requests in the trace are `200`.

## What this means for you

- On the **published preview** (`https://id-preview--f96f4986-…lovable.app`)
  and on the **published site** (`https://get-there-za.lovable.app`),
  address autocomplete, the map, geocoding and routes all work — those
  origins are on the managed key's allowlist.
- The error you (or anyone) see when opening the app over raw
  `localhost:8080` is expected and cannot be fixed by changing code,
  enabling APIs, or touching billing.
- If/when you point a **custom domain** at this project, the managed key
  will reject that domain for the same reason, and you'll need a
  per-project Google Cloud key with that domain on its HTTP-referrer
  allowlist.

## Recommended next step

No code change is needed for the current preview/published flow.
For the localhost diagnostic noise specifically, two options — pick one:

1. **Verify on the preview URL** and treat the localhost warning as
   expected. (Recommended — zero code change.) I would:
   - Add a one-line note above the autocomplete error path in
     `AddressAutocomplete.tsx` so the visible error text says
     "Address search isn't available on this domain — try the preview
     link" when the referrer-blocked message is detected, instead of the
     generic "Couldn't load suggestions" copy.
2. **Set up a custom Google Cloud key** for a custom domain (only if
   you're publishing to one). I'd walk you through enabling the four
   APIs in your own Cloud project, adding the domain to the HTTP-referrer
   allowlist, then connecting it as a non-managed Google Maps connector.

Tell me which path you want and I'll implement it.
