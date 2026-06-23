# Access — Ride-hailing MVP Plan

A mobile-first ride-hailing web app for South Africa with Passenger, Driver, and Admin roles. Built on TanStack Start + Supabase (Lovable Cloud) + Google Maps.

## Scope (MVP only)
- Email/password auth with role selection on first login
- Passenger: request ride, see status, trip history
- Driver: go online, see nearby requests, accept, update status, complete
- Admin: view users, drivers, trips, basic metrics
- Pricing: R20 base + R13.5/km (computed client-side from Google distance)
- Payments + WhatsApp: schema/structure only, no integration

## Tech decisions
- **Stack**: TanStack Start (template default) + Tailwind + shadcn
- **Backend**: Lovable Cloud (Supabase) — auth, DB, RLS
- **Maps**: Google Maps via the Lovable Google Maps connector (gateway for geocoding/routes, browser key for map + autocomplete). Will prompt the user to connect it after enabling Cloud.
- **Realtime**: Supabase realtime on `rides` so drivers see new requests and passengers see status updates
- **Polling fallback** for driver location (no live tracking in MVP)

## Database (with RLS + GRANTs)

```text
profiles(id, user_id FK auth.users, full_name, phone, role enum[passenger|driver|admin], created_at)
driver_profiles(id, user_id FK, vehicle_type, vehicle_model, license_plate, is_available, current_lat, current_lng, created_at)
rides(id, passenger_id, driver_id nullable, pickup_address, pickup_lat/lng, destination_address, destination_lat/lng, distance_km, estimated_price, status enum, created_at, updated_at)
payments(id, ride_id, passenger_id, driver_id, amount, status, payment_method, created_at)  -- structure only
user_roles(user_id, role) + has_role() SECURITY DEFINER  -- for admin checks (per security rules; roles NOT trusted from profiles)
```

RLS summary:
- profiles: user reads/updates own; admins read all
- driver_profiles: driver manages own row; passengers can read available drivers (lat/lng/vehicle only via view)
- rides: passenger sees own; driver sees own + open unassigned requests; admin sees all
- payments: passenger/driver see own; admin sees all
- Trigger auto-creates `profiles` row on signup

## Routes

```text
/                          → landing/redirect by role
/auth                      → sign in / sign up
/onboarding/role           → first-login role picker
/_authenticated/passenger  → request ride + status + history
/_authenticated/driver     → online toggle, requests feed, active ride
/_authenticated/admin      → metrics + tables (users/drivers/trips)
```

## UI / design
- Mobile-first, max-width container, bottom-sheet style cards
- Palette: white bg, near-black text, single blue primary (the DAATS-style blue from the uploaded logo)
- Inter or similar clean sans (not the AI-default Inter+purple combo — committed blue/white/black system)
- App name: **Access** (logo uploaded is reference for blue tone only, not embedded)

## Pricing
`estimated_price = 20 + distance_km * 13.5` (ZAR), computed when destination set via Google Distance Matrix (Routes API).

## Out of scope (explicitly)
- Real payment processing (Stripe/Paystack)
- WhatsApp bot
- Live driver-to-passenger tracking on map (status updates only)
- Push notifications
- Ratings/reviews
- Multi-language

## Order of work
1. Enable Lovable Cloud
2. Migration: tables, enums, RLS, GRANTs, signup trigger, user_roles + has_role
3. Prompt user to connect Google Maps connector
4. Design system tokens (blue primary, typography) in `styles.css`
5. Auth pages + role onboarding + `_authenticated` gate
6. Shared components: MapView, AddressAutocomplete, RideStatusBadge, BottomNav
7. Passenger flow
8. Driver flow (with realtime subscription on rides)
9. Admin dashboard
10. README setup notes

## What I need from you after approval
- Approve plan → I'll enable Cloud and start the migration
- After Cloud is up I'll trigger the Google Maps connector dialog for you to connect
