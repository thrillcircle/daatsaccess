# Access

Access is a mobile-first South African transport and mobility-management platform for passengers, drivers and Access administrators.

## Architecture

- Frontend: React, TypeScript, TanStack Start/Router and Tailwind
- Backend, database and authentication: Lovable Cloud/Supabase
- Maps and location: Google Maps APIs
- Realtime trip and operational updates: Supabase Realtime
- Payments and WhatsApp: planned for later commercial-readiness phases

## Roles

### Passenger
- Request immediate and scheduled rides
- Book Access Transport, Assisted, Appointment and Extended Journey services
- View active, upcoming, quoted and historical trips
- Maintain profile photo, personal details, saved addresses and assistance preferences
- Create and track support tickets

### Driver
- Go online or offline
- View and accept suitable ride requests
- Progress assigned trips through their operational lifecycle
- View read-only identity and current vehicle information
- View rating and operational trip history without customer fares or earnings
- Report trip, account or vehicle issues through Access Support

### Administrator
- Monitor overview metrics, trips and live operations
- Manage passenger and driver operational records
- Manage specialised service bookings and quotations
- Manage service pricing through Admin → Pricing & Services
- Triage, assign, reply to and resolve support tickets
- Maintain audit visibility over support status, priority and assignment changes

## Pricing

The confirmed standard formula remains:

```text
R20.00 base fare + R13.50 per kilometre
```

Normal Ride and Access Transport retain this confirmed formula. Specialised service rates are controlled through Admin → Pricing & Services and remain editable mock values until approved business figures are available.

## Phase status

- Phase 1: navigation, role visibility, terminology and pricing-control foundation
- Phase 2: passenger profiles, saved addresses, passenger operations and support workflows
- Phase 3: fleet consolidation, daily driver vehicle assignment and maintenance separation
- Phase 4: specialised service pricing and quotation automation
- Phase 5: trip reliability, reconnection, idempotency and scheduling controls
- Phase 6: controlled production-readiness testing
- Phase 7: payments, safety, compliance and commercial readiness

## Phase 2 database foundation

Phase 2 adds:

- `passenger_saved_addresses`
- `passenger_preferences`
- `support_tickets`
- `support_messages`
- `support_ticket_events`
- Support-linked in-app notifications
- Protected support RPCs
- RLS and table-boundary identity, internal-note and resolution guards

Apply these migrations after merge:

- `supabase/migrations/20260730183000_phase2_profiles_support.sql`
- `supabase/migrations/20260730184500_phase2_support_hardening.sql`

After the migrations are live, regenerate Supabase TypeScript database types from the deployed Lovable Cloud schema.

## Build and verification

```sh
bun install --frozen-lockfile
bun run test
bun run build
```

Pull requests run the permanent Access CI workflow, which lints changed TypeScript files, runs the full test suite and creates a production build.

## Lovable

**Live app:** https://daatsaccess.lovable.app

Continue development in the linked Lovable project. Changes merged into `main` synchronise back to Lovable for publication.
