import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Crown, Search, ShieldCheck, UserRoundX } from "lucide-react";
import { toast } from "sonner";
import { AdminShell } from "@/components/AdminShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getAdminCapabilities,
  listManagedUsers,
  setUserRoles,
  setUserStatus,
  type AdminCapabilities,
  type AppRole,
  type ManagedUser,
} from "@/lib/architecture-closeout";

export const Route = createFileRoute("/app/admin/users")({
  head: () => ({ meta: [{ title: "Users & Roles — Access Admin" }] }),
  component: UsersPage,
});

const ALL_ROLES: AppRole[] = ["passenger", "driver", "admin"];

function UsersPage() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [capabilities, setCapabilities] = useState<AdminCapabilities | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [managedUsers, adminCapabilities] = await Promise.all([
        listManagedUsers(),
        getAdminCapabilities(),
      ]);
      setUsers(managedUsers);
      setCapabilities(adminCapabilities);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load users");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? users.filter((u) =>
          [u.full_name, u.email, u.phone, ...u.roles, u.is_master_admin ? "master admin" : null]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q)),
        )
      : users;
  }, [query, users]);

  function canManageRole(user: ManagedUser, role: AppRole) {
    if (!capabilities?.is_admin) return false;
    if (user.is_master_admin) return false;
    if (user.roles.includes("admin") && !capabilities.can_manage_admins) return false;
    if (role === "admin" && !capabilities.can_manage_admins) return false;
    return true;
  }

  function canManageStatus(user: ManagedUser) {
    if (!capabilities?.is_admin || user.is_master_admin) return false;
    if (user.roles.includes("admin") && !capabilities.can_manage_admins) return false;
    return true;
  }

  async function toggleRole(user: ManagedUser, role: AppRole, checked: boolean) {
    if (!canManageRole(user, role)) return;
    const roles = checked
      ? [...new Set([...user.roles, role])]
      : user.roles.filter((item) => item !== role);
    try {
      await setUserRoles(user.user_id, roles);
      toast.success("Roles updated");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update roles");
    }
  }

  async function toggleStatus(user: ManagedUser) {
    if (!canManageStatus(user)) return;
    const next = user.status === "active" ? "suspended" : "active";
    const reason =
      next === "suspended"
        ? window.prompt("Reason for suspension (required for the audit record):")
        : "Account reactivated";
    if (next === "suspended" && !reason) return;
    try {
      await setUserStatus(user.user_id, next, reason ?? "");
      toast.success(`Account ${next}`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update account");
    }
  }

  return (
    <AdminShell
      title="Users & Roles"
      subtitle="Public registration creates Passenger accounts. Driver onboarding is Admin-controlled; Admin entitlement is Master Admin-controlled."
    >
      {capabilities && (
        <div className="mb-4 rounded-xl border bg-muted/30 p-3 text-sm">
          {capabilities.is_master_admin ? (
            <div className="flex items-start gap-2">
              <Crown className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <p>
                <strong>Master Admin controls enabled.</strong> You can manage passengers and
                drivers, and you can grant, revoke, suspend or reactivate administrator access. The
                Master Admin account itself is protected.
              </p>
            </div>
          ) : (
            <div className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <p>
                <strong>Regular Admin.</strong> You can onboard Drivers and manage Passenger/Driver
                accounts. Administrator accounts and Admin entitlement can only be changed by the
                Master Admin.
              </p>
            </div>
          )}
        </div>
      )}

      <div className="relative mb-4 max-w-xl">
        <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, email, phone or role"
        />
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading users…</p>
      ) : (
        <div className="space-y-3">
          {visible.map((user) => {
            const statusManageable = canManageStatus(user);
            const adminProtected =
              user.roles.includes("admin") && !capabilities?.can_manage_admins;

            return (
              <article key={user.user_id} className="rounded-2xl border bg-card p-4 shadow-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate font-semibold">{user.full_name || "Unnamed user"}</h2>
                      <Badge variant={user.status === "active" ? "secondary" : "destructive"}>
                        {user.status}
                      </Badge>
                      {user.is_master_admin && (
                        <Badge className="gap-1">
                          <Crown className="h-3 w-3" /> Master Admin
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {user.email || "No email"} · {user.phone || "No phone"}
                    </p>
                    {user.is_master_admin ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Protected account. Ordinary administrators cannot change its roles or
                        status.
                      </p>
                    ) : adminProtected ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Administrator account. Master Admin approval is required for changes.
                      </p>
                    ) : null}
                  </div>

                  <fieldset className="flex flex-wrap gap-4">
                    <legend className="sr-only">Roles for {user.full_name}</legend>
                    {ALL_ROLES.map((role) => (
                      <Label key={role} className="flex items-center gap-2 capitalize">
                        <Checkbox
                          checked={user.roles.includes(role)}
                          disabled={!canManageRole(user, role)}
                          onCheckedChange={(value) => void toggleRole(user, role, value === true)}
                        />
                        {role}
                      </Label>
                    ))}
                  </fieldset>

                  <Button
                    variant={user.status === "active" ? "destructive" : "outline"}
                    size="sm"
                    disabled={!statusManageable}
                    onClick={() => void toggleStatus(user)}
                  >
                    {user.status === "active" ? (
                      <>
                        <UserRoundX className="mr-2 h-4 w-4" />
                        {user.is_master_admin ? "Protected" : "Suspend"}
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="mr-2 h-4 w-4" />
                        Reactivate
                      </>
                    )}
                  </Button>
                </div>
              </article>
            );
          })}
          {!visible.length && (
            <p className="rounded-xl border p-6 text-center text-sm text-muted-foreground">
              No users match your search.
            </p>
          )}
        </div>
      )}
    </AdminShell>
  );
}
