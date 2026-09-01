import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../../supabase/migrations/20260901233000_passenger_onboarding_gate.sql",
    import.meta.url,
  ),
  "utf8",
);
const onboardingRoute = readFileSync(
  new URL("../../routes/app.passenger.onboarding.tsx", import.meta.url),
  "utf8",
);
const passengerLayout = readFileSync(
  new URL("../../routes/app.passenger.tsx", import.meta.url),
  "utf8",
);
const bookingLayout = readFileSync(
  new URL("../../routes/app.passenger.book.tsx", import.meta.url),
  "utf8",
);
const appRoute = readFileSync(new URL("../../routes/app.tsx", import.meta.url), "utf8");

describe("passenger onboarding gate", () => {
  it("requires the complete passenger identity and care profile", () => {
    expect(migration).toContain("'full_name'");
    expect(migration).toContain("'phone'");
    expect(migration).toContain("'email'");
    expect(migration).toContain("'saved_address'");
    expect(migration).toContain("'travel_preferences'");
    expect(migration).toContain("'emergency_contact'");
    expect(migration).toContain("'notification_preferences'");
    expect(migration).toContain("preferences_confirmed_at");
    expect(migration).toContain("confirmed_at");
  });

  it("prefills common Google and Apple name metadata without guessing a phone number", () => {
    expect(migration).toContain("NEW.raw_user_meta_data->>'full_name'");
    expect(migration).toContain("NEW.raw_user_meta_data->>'name'");
    expect(migration).toContain("NEW.raw_user_meta_data->>'given_name'");
    expect(migration).toContain("NEW.raw_user_meta_data->>'family_name'");
    expect(migration).toContain("v_phone := NULLIF(trim(NEW.raw_user_meta_data->>'phone'), '')");
  });

  it("enforces onboarding server-side for both rides and service bookings", () => {
    expect(migration).toContain("CREATE TRIGGER rides_require_passenger_onboarding");
    expect(migration).toContain("CREATE TRIGGER service_bookings_require_passenger_onboarding");
    expect(migration).toContain("Complete your Access passenger profile before booking");
    expect(migration).toContain("private.passenger_onboarding_complete");
  });

  it("provides one protected completion RPC and an onboarding status RPC", () => {
    expect(migration).toContain("public.passenger_onboarding_status()");
    expect(migration).toContain("public.passenger_complete_onboarding(");
    expect(migration).toContain("passenger.onboarding_completed");
    expect(migration).toContain("Your Access profile is ready");
  });

  it("routes passenger-only sign-ins into onboarding before service access", () => {
    expect(appRoute).toContain('"/app/passenger/onboarding"');
    expect(appRoute).toContain("getPassengerOnboardingStatus");
    expect(bookingLayout).toContain("getPassengerOnboardingStatus");
    expect(bookingLayout).toContain('throw redirect({ to: "/app/passenger/onboarding" })');
  });

  it("keeps existing trips accessible while gating new passenger service entry", () => {
    expect(passengerLayout).toContain('pathname.startsWith("/app/passenger/bookings")');
    expect(passengerLayout).toContain("activeRides?.length");
    expect(passengerLayout).toContain(
      'navigate({ to: "/app/passenger/onboarding", replace: true })',
    );
  });

  it("collects all five onboarding sections in the passenger UI", () => {
    expect(onboardingRoute).toContain("Personal details");
    expect(onboardingRoute).toContain("Primary saved address");
    expect(onboardingRoute).toContain("Travel & assistance preferences");
    expect(onboardingRoute).toContain("Emergency contact");
    expect(onboardingRoute).toContain("Notification preferences");
    expect(onboardingRoute).toContain("Complete onboarding & continue");
  });
});
