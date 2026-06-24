# Access — Setup Notes

Access is a mobile-first ride-hailing MVP for South Africa.

## Technology stack

- Frontend: React, Tailwind CSS, and shadcn/ui
- Application framework: TanStack Start
- Authentication: Lovable Cloud / Supabase Auth
- Database: PostgreSQL through Lovable Cloud / Supabase
- Realtime updates: Supabase Realtime
- Maps and routing: Google Maps connector
- Authentication method: Email and password

## MVP scope

The current MVP includes:

- Passenger registration and authentication
- Passenger ride requests (immediate and scheduled)
- Pickup and destination selection with Google Places autocomplete
- Route, distance, and duration calculation
- Estimated fare calculation
- Active-trip editing (pickup before driver arrives, destination through in-progress)
- Driver onboarding and vehicle details
- Driver online/offline availability
- Available ride requests
- Atomic driver ride acceptance
- Ride-status updates across the full lifecycle (requested → accepted → driver_arriving → arrived → in_progress → completed)
- Live driver location sharing and live trip map for the passenger
- Passenger trip history (completed and cancelled)
- Driver trip and earnings history
- Driver ratings and reviews submitted by the passenger
- In-app notifications (driver accepted, trip edited, trip approaching, trip completed, review submitted, cancellation)
- Admin dashboard with live operations, trip filtering across all statuses, and user/driver search
- Realtime ride-status, location, and change-log updates
- Profile photo, name and phone editing backed by the private `avatars` storage bucket

The following features are not included yet:

- Payment-gateway integration
- WhatsApp integration
- Push notifications (in-app notifications only)
- Passenger ratings (driver-rating only)
- Advanced proximity-based driver matching
- Automatic driver dispatch
- Production-ready identity and document verification


## Database tables

The application uses the following primary tables:

- `profiles`
- `user_roles`
- `driver_profiles`
- `rides`
- `payments`

The `payments` table is reserved for future payment integration. No payment gateway is connected in the current MVP.

## User roles

The supported roles are:

- `passenger`
- `driver`
- `admin`

### New accounts

Every new account receives the `passenger` role automatically.

A passenger may promote their account to `driver` through the application. Driver promotion must use a protected server-side or database operation.

Users must not be able to:

- Assign themselves the `admin` role
- Insert unrestricted records into `user_roles`
- Update their role directly from the browser
- Delete protected role records
- Promote another user

### Driver onboarding

Before a driver can go online, the following information is required:

- Vehicle type
- Vehicle model
- Licence plate

A driver profile with incomplete vehicle details must remain offline.

## Granting administrator access

Administrator access must be granted manually by an existing authorised administrator or through Lovable Cloud SQL.

First, obtain the user's UUID from the Lovable Cloud or Supabase authentication user list.

Run the following SQL:

```sql
INSERT INTO public.user_roles (user_id, role)
SELECT '<USER-UUID>', 'admin'
WHERE NOT EXISTS (
  SELECT 1
  FROM public.user_roles
  WHERE user_id = '<USER-UUID>'
    AND role = 'admin'
);
```

Replace `<USER-UUID>` with the authenticated user's UUID.

Do not grant the admin role to a normal passenger or driver testing account. Use a separate admin test account so that Row Level Security can be tested correctly.

## Google Maps integration

The Google Maps connector is used for:

- Address geocoding through the server function `geocodeAddress`
- Route distance and duration through the server function `computeRoute`
- Route preview through a Google Maps Embed iframe

The browser key must be used only for browser-compatible map services.

The server Google Maps API key must never be exposed to the browser.

### Required Google Maps services

Confirm that the Google Cloud project used by Access has the services required by the connector enabled, including:

- Maps Embed API
- Geocoding API
- Routes API

Restrict the browser key to the approved Access development and production domains.

Restrict the server key to only the APIs required by Access.

## Environment variables

The following environment variables are already wired into the project.

### Browser-accessible variables

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY=
```

Only publishable browser-safe values may use the `VITE_` prefix.

### Server-only variables

```env
LOVABLE_API_KEY=
GOOGLE_MAPS_API_KEY=
```

Server-only variables must remain in Lovable Cloud secrets or another protected server environment.

Never place server API keys in:

- Frontend components
- Browser JavaScript
- Public repositories
- Client-side environment variables
- Console logs

## Pricing

The Access MVP pricing model is:

- Base fare: **R20.00**
- Distance rate: **R10.00 per kilometre**

The formula is:

```text
Estimated fare = R20.00 + (distance in kilometres × R10.00)
```

Example:

```text
Distance: 5 km
Estimated fare: R20.00 + (5 × R10.00)
Estimated fare: R70.00
```

The shared frontend pricing display is configured in:

```text
src/lib/pricing.ts
```

The frontend calculation is for display purposes only.

The route distance and estimated fare must be recalculated or validated by a protected server function when a ride is created. The application must not trust fare or distance values submitted directly by the browser.

The server-validated values must be stored in the `rides` table.

## Ride lifecycle

The supported normal ride-status sequence is:

```text
requested
→ accepted
→ driver_arriving
→ in_progress
→ completed
```

A requested ride may also transition to:

```text
requested
→ cancelled
```

Invalid status changes must be rejected.

Examples of invalid transitions include:

- `requested` directly to `completed`
- `completed` back to `in_progress`
- A passenger marking a ride as completed
- A driver updating a ride assigned to another driver
- A driver accepting multiple active rides
- Two drivers accepting the same ride

Ride acceptance must use an atomic server-side or database operation to prevent two drivers from accepting the same request.

## Driver availability and ride visibility

Drivers can toggle their availability between online and offline.

Only drivers with complete vehicle information may go online.

The current MVP displays eligible open requests as:

```text
Available ride requests
```

The MVP does not yet provide advanced distance-based driver matching. Open requests should not be described as “nearby” unless the application actually filters requests according to the driver's verified location and a defined search radius.

A driver may have only one ride with an active status such as:

- `accepted`
- `driver_arriving`
- `in_progress`

## Realtime updates

Supabase Realtime is used to update ride information for passengers and drivers.

Passengers should see authorised status changes for their own rides.

Drivers should see authorised updates for available requests and rides assigned to them.

Realtime subscriptions do not replace Row Level Security. Every realtime record must remain protected by the underlying database policies.

## Row Level Security

Row Level Security must be enabled for all user and ride-related tables.

### `profiles`

- A user may read and update their own profile.
- A user must not read another user's private profile.
- An authorised admin may read profiles for administration.

### `user_roles`

- Authenticated users may read only the role information required by the application.
- Normal users must not directly insert, update, or delete role records.
- Passenger-to-driver promotion must use a protected operation.
- Admin assignment must not be available through the normal client.
- The security-definer function `has_role(uid, role)` may be used by policies.
- Security-definer functions must use a safe, explicit `search_path`.

### `driver_profiles`

- A driver may manage their own driver profile.
- A driver must not update another driver's profile.
- Only approved fields for available drivers may be visible to authenticated users.
- Anonymous users must not access private driver information.

### `rides`

- A passenger may create and read their own rides.
- A passenger must not create a ride for another passenger.
- A passenger must not assign a driver directly.
- A passenger must not directly set a protected fare or final distance.
- A passenger must not complete a ride.
- Eligible drivers may read available unassigned requests.
- A driver may read and update only rides assigned to them.
- A driver must not modify unrelated rides.
- An authorised admin may read all rides for administration.
- Anonymous users must not access ride records.

### `payments`

- A passenger may access payment records linked to their rides.
- A driver may access payment records linked to their completed trips where required.
- An authorised admin may access payment records for administration.
- Users must not access unrelated payment records.
- Anonymous users must not access payment records.

Frontend route protection is required for usability, but it does not replace database RLS protection.

## Admin dashboard

The admin dashboard provides basic MVP information such as:

- Total users
- Total drivers
- Total rides
- Completed rides
- User records
- Driver records
- Ride records
- Ride statuses

Only users with the `admin` role may access admin pages and administrative database queries.

Hiding the admin navigation link is not sufficient security. Admin database access must be enforced by RLS or protected server functions.

## Payments

The `payments` table exists as an extension point.

No payment gateway is currently integrated.

Future payment work must:

- Use a protected server-side payment integration
- Verify payment-provider webhook signatures
- Avoid trusting payment status from the browser
- Use idempotency protection
- Store provider references securely
- Avoid storing raw card information
- Update payment and ride states through protected operations

## WhatsApp

WhatsApp automation is not included in the current MVP.

A future WhatsApp integration may add a protected webhook route at:

```text
/api/public/hooks/whatsapp
```

The future endpoint must:

- Verify webhook signatures
- Validate incoming payloads
- Authenticate the provider
- Apply rate limiting
- Prevent replay attacks where applicable
- Avoid exposing private ride information
- Read and write rides only through protected server operations

## Initial setup checklist

Complete these steps before testing:

1. Confirm Lovable Cloud / Supabase is connected.
2. Confirm all database migrations completed successfully.
3. Confirm RLS is enabled on all protected tables.
4. Confirm the required Google Maps APIs are enabled.
5. Confirm the browser and server Google Maps keys are configured.
6. Restrict the browser key to approved domains.
7. Confirm server secrets are not exposed to the frontend.
8. Create separate passenger, driver, and admin test accounts.
9. Grant the admin role manually using the SQL above.
10. Run the application build and type-check.

## End-to-end testing

Use separate accounts and browser sessions.

### Passenger test

1. Register a new passenger account.
2. Sign in.
3. Enter a pickup address.
4. Enter a destination.
5. Confirm the route preview appears.
6. Confirm distance and duration are displayed.
7. Confirm the fare uses R20 plus R10 per kilometre.
8. Request the ride.
9. Confirm the ride status is `requested`.

### Driver test

1. Register a separate account.
2. Promote the passenger account to driver.
3. Complete the required vehicle information.
4. Toggle the driver online.
5. Confirm the request appears under “Available ride requests.”
6. Accept the ride.
7. Confirm another driver cannot accept the same ride.
8. Update the ride to `driver_arriving`.
9. Update the ride to `in_progress`.
10. Complete the ride.
11. Confirm the trip appears in driver history and earnings.

### Passenger completion test

1. Return to the passenger session.
2. Confirm status updates appeared in realtime.
3. Confirm the final status is `completed`.
4. Confirm the ride appears in trip history.
5. Confirm the stored fare matches the server-validated fare.

### Admin test

1. Sign in using the separate admin account.
2. Open the admin dashboard.
3. Confirm users, drivers, and rides are visible.
4. Confirm the completed ride appears.
5. Confirm dashboard metrics update correctly.

### Security test

Confirm that:

- A passenger cannot view another passenger's rides.
- A driver cannot modify an unrelated ride.
- A normal user cannot access admin records.
- A user cannot grant themselves the admin role.
- A browser request cannot replace the validated fare.
- A browser request cannot assign an arbitrary driver.
- An anonymous user cannot access private tables.
- Invalid ride-status transitions are rejected.

## Known MVP limitations

The current MVP does not include:

- True proximity-based ride matching
- Automatic driver dispatch
- Background driver location tracking
- Production push notifications
- Payment processing
- WhatsApp automation
- Driver or passenger ratings
- Driver document verification
- Fraud detection
- Emergency-support workflows
- Production monitoring and alerting

These features should be implemented only after the complete passenger-to-driver ride flow has been tested successfully.
