import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../../supabase/migrations/20260901225500_master_admin_governance.sql", import.meta.url),
  "utf8",
);
const signupMigration = readFileSync(
  new URL(
    "../../../supabase/migrations/20260623183609_245b6007-56bf-4f79-bc5e-cdf517ed4aff.sql",
    import.meta.url,
  ),
  "utf8",
);
const usersPage = readFileSync(new URL("../../routes/app.admin.users.tsx", import.meta.url), "utf8");
const authPage = readFileSync(new URL("../../routes/auth.tsx", import.meta.url), "utf8");
const architecture = readFileSync(new URL("../architecture-closeout.ts", import.meta.url), "utf8");

describe("master admin governance", () => {
  it("keeps public registration passenger-only and removes driver self-enrolment messaging", () => {
    expect(signupMigration).toContain("auto-create profile + default passenger role on signup");
    expect(signupMigration).toContain("VALUES (NEW.id, 'passenger')");
    expect(authPage).toContain("Create your passenger account");
    expect(authPage).toContain("Driver and Admin access is assigned internally by DAATS");
    expect(authPage).not.toContain("Sign up to request rides or drive");
  });

  it("uses a separate protected Master Admin entitlement without changing the app role enum", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.master_admin_entitlement");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION private.is_master_admin");
    expect(migration).toContain("vernondyondzo@gmail.com");
    expect(migration).toContain("The Master Admin must retain administrator access");
    expect(migration).not.toContain("ALTER TYPE public.app_role ADD VALUE");
  });

  it("makes role writes RPC-only and reserves Admin entitlement changes for the Master Admin", () => {
    expect(migration).toContain(
      "REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.user_roles FROM PUBLIC, anon, authenticated",
    );
    expect(migration).toContain('DROP POLICY IF EXISTS "admins insert roles"');
    expect(migration).toContain('DROP POLICY IF EXISTS "admins update roles"');
    expect(migration).toContain('DROP POLICY IF EXISTS "admins delete roles"');
    expect(migration).toContain(
      "Only the Master Admin can grant, revoke, or manage administrator access",
    );
  });

  it("allows regular admins to manage passenger/driver accounts but protects administrator status", () => {
    expect(migration).toContain(
      "Only the Master Admin can suspend or reactivate administrator accounts",
    );
    expect(migration).toContain("The Master Admin account cannot be suspended");
    expect(usersPage).toContain("Regular Admin.");
    expect(usersPage).toContain("canManageRole");
    expect(usersPage).toContain('role === "admin" && !capabilities.can_manage_admins');
    expect(usersPage).toContain("Master Admin controls enabled");
  });

  it("exposes Master Admin identity and capabilities without trusting browser metadata", () => {
    expect(architecture).toContain('"admin_list_users_v2"');
    expect(architecture).toContain('"current_admin_capabilities"');
    expect(usersPage).toContain("user.is_master_admin");
    expect(usersPage).toContain("Master Admin");
    expect(migration).not.toContain("raw_user_meta_data");
    expect(migration).not.toContain("user_metadata");
  });

  it("cleans the production baseline by suspending retired build accounts instead of deleting users", () => {
    expect(migration).toContain("caroline@daats.co.za");
    expect(migration).toContain("metafluxea@gmail.com");
    expect(migration).toContain("thrillcircle@gmail.com");
    expect(migration).toContain("godaats@gmail.com");
    expect(migration).toContain("cmalatji65@gmail.com");
    expect(migration).toContain("vernon@thrillcircle.tech");
    expect(migration).toContain("routetest1785534664@example.com");
    expect(migration).toContain("Build/test account retired at production role-governance closeout");
    expect(migration).not.toContain("DELETE FROM auth.users");
  });
});
