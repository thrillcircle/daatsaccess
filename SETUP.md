# Access — Setup notes

Ride-hailing MVP for South Africa.

## What's included
- React + Tailwind + shadcn (TanStack Start)
- Auth via Lovable Cloud (Supabase) — email/password
- Database tables: `profiles`, `user_roles`, `driver_profiles`, `rides`, `payments`
- Roles: `passenger` (default), `driver`, `admin`
- Google Maps connector wired for:
  - Geocoding (server function `geocodeAddress`)
  - Distance / duration via Routes API (server function `computeRoute`)
  - Embedded route preview via Maps Embed iframe (browser key)
- Realtime ride updates over Supabase realtime
- Pricing: R20 base + R13.50/km (see `src/lib/pricing.ts`)

## Roles & promotion
- New signups get `passenger` role automatically.
- Passengers can self-promote to `driver` from the Passenger screen.
- To grant `admin`, run in Lovable Cloud SQL:
  ```sql
  INSERT INTO public.user_roles (user_id, role)
  VALUES ('<USER-UUID>', 'admin');
  ```

## Environment variables (already wired)
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` — Cloud
- `VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY` — Maps Embed iframe
- Server-only (gateway): `LOVABLE_API_KEY`, `GOOGLE_MAPS_API_KEY`

## Reserved for future work
- **Payments**: `payments` table exists with structure. No gateway integrated.
- **WhatsApp**: No code yet. When ready, add an edge function/route under `/api/public/hooks/whatsapp` that verifies signatures and reads/writes `rides`.

## RLS summary
- `profiles`: user manages own; admins read all
- `driver_profiles`: drivers manage own; available drivers visible to authenticated users
- `rides`: passenger sees own; drivers see open + assigned; admin sees all
- `payments`: passenger/driver involved + admin
- `user_roles`: read-only client-side; `has_role(uid, role)` security-definer used in policies
