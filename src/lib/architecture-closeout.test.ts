import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../../supabase/migrations/20260801120000_architecture_closeout.sql", import.meta.url),
  "utf8",
);
const auth = readFileSync(new URL("../routes/auth.tsx", import.meta.url), "utf8");
const adminShell = readFileSync(new URL("../components/AdminShell.tsx", import.meta.url), "utf8");

describe("Access architecture closeout", () => {
  it("protects the final administrator and audits role changes", () => {
    expect(migration).toContain("The final administrator role cannot be removed");
    expect(migration).toContain("user.roles_changed");
    expect(migration).toContain("revoke insert,update,delete on public.system_audit_events");
  });

  it("enforces one active shift and critical safety checks", () => {
    expect(migration).toContain("one_active_shift_per_driver");
    expect(migration).toContain("one_active_shift_per_vehicle");
    expect(migration).toContain("Every critical safety item must pass");
    expect(migration).toContain("Ending odometer cannot be lower");
  });

  it("supports URL sign-in mode and Google and Apple OAuth", () => {
    expect(auth).toContain('search.mode === "signin"');
    expect(auth).toContain('provider: "google" | "apple"');
    expect(auth).toContain("signInWithOAuth");
  });

  it("exposes completed admin modules without Soon placeholders", () => {
    expect(adminShell).toContain('label: "Users & Roles"');
    expect(adminShell).toContain('label: "Settings"');
    expect(adminShell).toContain('label: "Audit Logs"');
    expect(adminShell).not.toContain("soon: true");
  });
});
