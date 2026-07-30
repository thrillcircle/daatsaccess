# Access

Build a mobile-first web app called Access.

Access is a transport/ride-hailing MVP for South Africa. The goal is to help passengers request rides and help drivers accept and complete trips.

Use this architecture:

Frontend: React + Tailwind

Backend/database/auth: Supabase

Maps/location: Google Maps API

Payments: prepare structure for future integration, but do not fully implement payments yet

WhatsApp chatbot: prepare structure only, do not integrate yet

Build only the MVP features first to reduce cost and complexity.

Core user roles:

Passenger

Driver

Admin

Authentication:

Use Supabase Auth

Allow sign up and login with email/password

On first login, user must choose role: Passenger or Driver

Store user profile in Supabase

Passenger features:

Dashboard

Set pickup location

Set destination

Show route/map using Google Maps

Estimate distance and trip price

Request ride

See ride status: requested, accepted, driver arriving, in progress, completed, cancelled

View basic trip history

Driver features:

Driver dashboard

Toggle availability online/offline

View nearby ride requests

Accept a ride

Update ride status

Complete trip

Admin features:

View completed trip value and trip history

Simple admin dashboard

View passengers

View drivers

View trips

View ride statuses

Manage service pricing rules

Manage passenger and driver support tickets

Basic metrics: total users, total drivers, total trips, completed trips

Database tables:

profiles: id, user_id, full_name, phone, role, created_at

driver_profiles: id, user_id, vehicle_type, vehicle_model, license_plate, is_available, current_lat, current_lng, created_at

rides: id, passenger_id, driver_id, pickup_address, pickup_lat, pickup_lng, destination_address, destination_lat, destination_lng, distance_km, estimated_price, status, created_at, updated_at

payments: id, ride_id, passenger_id, driver_id, amount, status, payment_method, created_at

Phase 2 profile and support foundation:

passenger_saved_addresses: passenger-owned pickup shortcuts with one default address

passenger_preferences: accessibility, communication and emergency-contact preferences

support_tickets: passenger, driver and admin support cases

support_messages: public replies and administrator-only internal notes

support_ticket_events: auditable assignment, priority and status changes

Pricing logic:

Base fare: R20

Per km: R13.5

Estimated price = base fare + distance_km * per_km_rate

Specialised service pricing is controlled through Admin → Pricing & Services. Mock values remain editable until final business rates are approved.

Design:

Clean, modern, mobile-first interface

App name: Access

Use a simple color palette: dark text, white background, blue primary buttons

Make it feel trustworthy and easy to use

Use clear navigation for Passenger, Driver, and Admin

Important implementation instructions:

Do not overbuild

Do not add unnecessary features

Do not integrate payment gateway yet

Do not integrate WhatsApp yet

Create clean reusable components

Add placeholder environment variables for Google Maps API and future payment/WhatsApp integrations

Make sure Supabase RLS policies are included or clearly explained

Make the app functional enough for testing passenger ride requests and driver acceptance

Deliverables:

Working MVP app

Supabase schema

Authentication flow

Passenger ride request flow

Driver accept and complete flow

Admin dashboard

Clear setup notes for environment variables

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://daatsaccess.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/f96f4986-6396-4e06-9fe2-51bdf8c72bd1).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
