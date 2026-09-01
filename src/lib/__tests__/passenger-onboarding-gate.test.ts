import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const originalMigration = readFileSync(
  new URL(
    "../../../supabase/migrations/20260901233000_passenger_onboarding_gate.sql",
    import.meta.url,
  ),
  "utf8",
);
const simplifiedMigration = readFileSync(
  new URL(
    "../../../supabase/migrations/20260901235900_simplify_passenger_onboarding_email_confirmation.sql",
    import.meta.url,
  ),
  "utf8",
);
const emailServiceMigration = readFileSync(
  new URL(
    "../../../supabase/migrations/20260901235910_passenger_email_confirmation_service.sql",
    import.meta.url,
  ),
  "utf8",
);
const onboardingRoute = readFileSync(
  new URL("../../routes/app.passenger.onboarding.tsx", import.meta.url),
  "utf8",
);
const emailConfirmationRoute = readFileSync(
  new URL("../../routes/api.passenger.email-confirmation.ts", import.meta.url),
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
  it("reduces booking eligibility to personal details, one address and account confirmation", () => {
    expect(simplifiedMigration).toContain("v_personal_ok AND v_address_ok AND v_confirmation_ok");
    expect(simplifiedMigration).toContain("'email_confirmation'");
    expect(simplifiedMigration).toContain("/ 3.0");
    expect(simplifiedMigration).not.toContain("array_append(v_missing, 'travel_preferences')");
    expect(simplifiedMigration).not.toContain("array_append(v_missing, 'emergency_contact')");
    expect(simplifiedMigration).not.toContain(
      "array_append(v_missing, 'notification_preferences')",
    );
  });

  it("keeps Google and Apple verified email ownership frictionless", () => {
    expect(simplifiedMigration).toContain("i.provider IN ('google','apple')");
    expect(simplifiedMigration).toContain("'oauth_google'");
    expect(simplifiedMigration).toContain("'oauth_apple'");
  });

  it("removes the former long completion RPC instead of leaving an overload behind", () => {
    expect(simplifiedMigration).toContain(
      "DROP FUNCTION IF EXISTS public.passenger_complete_onboarding(",
    );
    expect(simplifiedMigration).toContain("p_full_name text");
    expect(simplifiedMigration).toContain("p_longitude double precision");
    expect(simplifiedMigration).not.toContain("p_emergency_contact_name");
    expect(simplifiedMigration).not.toContain("p_push boolean");
  });

  it("keeps the original server-side Ride and Service booking backstops", () => {
    expect(originalMigration).toContain("CREATE TRIGGER rides_require_passenger_onboarding");
    expect(originalMigration).toContain(
      "CREATE TRIGGER service_bookings_require_passenger_onboarding",
    );
    expect(originalMigration).toContain("private.passenger_onboarding_complete");
    expect(simplifiedMigration).toContain("private.passenger_onboarding_complete");
  });

  it("protects email challenges from client access and brute-force reuse", () => {
    expect(emailServiceMigration).toContain("TO service_role");
    expect(emailServiceMigration).toContain("FROM PUBLIC, anon, authenticated");
    expect(emailServiceMigration).toContain("interval '60 seconds'");
    expect(emailServiceMigration).toContain("v_row.attempt_count >= 5");
    expect(emailServiceMigration).toContain("code_expires_at");
  });

  it("sends only a server-side digest while noreply sends the raw verification code", () => {
    expect(emailConfirmationRoute).toContain("Access by DAATS <noreply@daats.app>");
    expect(emailConfirmationRoute).toContain('const SENDER_DOMAIN = "notify.daats.app"');
    expect(emailConfirmationRoute).toContain('purpose: "transactional"');
    expect(emailConfirmationRoute).toContain('name: "HMAC", hash: "SHA-256"');
    expect(emailConfirmationRoute).toContain("service_begin_passenger_email_challenge");
    expect(emailConfirmationRoute).toContain("service_verify_passenger_email_challenge");
    expect(emailConfirmationRoute).not.toContain("p_code: code");
  });

  it("routes passenger-only sign-ins into onboarding before service access", () => {
    expect(appRoute).toContain('"/app/passenger/onboarding"');
    expect(appRoute).toContain("getPassengerOnboardingStatus");
    expect(bookingLayout).toContain("getPassengerOnboardingStatus");
    expect(bookingLayout).toContain('throw redirect({ to: "/app/passenger/onboarding" })');
  });

  it("keeps existing trips accessible while gating only new passenger service entry", () => {
    expect(passengerLayout).toContain('pathname.startsWith("/app/passenger/bookings")');
    expect(passengerLayout).toContain("activeRides?.length");
    expect(passengerLayout).toContain(
      'navigate({ to: "/app/passenger/onboarding", replace: true })',
    );
  });

  it("shows only three quick onboarding steps and moves optional profile data out", () => {
    expect(onboardingRoute).toContain("3 quick steps");
    expect(onboardingRoute).toContain("Personal details");
    expect(onboardingRoute).toContain("Primary saved address");
    expect(onboardingRoute).toContain("Confirm your account");
    expect(onboardingRoute).toContain("6-digit code");
    expect(onboardingRoute).not.toContain('title="Travel & assistance preferences"');
    expect(onboardingRoute).not.toContain('title="Emergency contact"');
    expect(onboardingRoute).not.toContain('title="Notification preferences"');
  });
});
