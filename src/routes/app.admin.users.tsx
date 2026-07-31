import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Search, ShieldCheck, UserRoundX } from "lucide-react";
import { toast } from "sonner";
import { AdminShell } from "@/components/AdminShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  listManagedUsers,
  setUserRoles,
  setUserStatus,
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
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      setUsers(await listManagedUsers());
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
          [u.full_name, u.email, u.phone, ...u.roles]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q)),
        )
      : users;
  }, [query, users]);

  async function toggleRole(user: ManagedUser, role: AppRole, checked: boolean) {
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
    <AdminShell title="Users & Roles" subtitle="Manage Access accounts, roles and account status.">
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
          {visible.map((user) => (
            <article key={user.user_id} className="rounded-2xl border bg-card p-4 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate font-semibold">{user.full_name || "Unnamed user"}</h2>
                    <Badge variant={user.status === "active" ? "secondary" : "destructive"}>
                      {user.status}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {user.email || "No email"} · {user.phone || "No phone"}
                  </p>
                </div>
                <fieldset className="flex flex-wrap gap-4">
                  <legend className="sr-only">Roles for {user.full_name}</legend>
                  {ALL_ROLES.map((role) => (
                    <Label key={role} className="flex items-center gap-2 capitalize">
                      <Checkbox
                        checked={user.roles.includes(role)}
                        onCheckedChange={(value) => void toggleRole(user, role, value === true)}
                      />
                      {role}
                    </Label>
                  ))}
                </fieldset>
                <Button
                  variant={user.status === "active" ? "destructive" : "outline"}
                  size="sm"
                  onClick={() => void toggleStatus(user)}
                >
                  {user.status === "active" ? (
                    <>
                      <UserRoundX className="mr-2 h-4 w-4" />
                      Suspend
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
          ))}
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
