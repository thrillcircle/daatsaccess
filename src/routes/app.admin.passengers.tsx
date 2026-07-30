import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Search, Phone, UserCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useUserRoles } from "@/hooks/use-auth";
import { AdminShell } from "@/components/AdminShell";
import { Input } from "@/components/ui/input";
import type { Database } from "@/integrations/supabase/types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

export const Route = createFileRoute("/app/admin/passengers")({
  head: () => ({ meta: [{ title: "Passengers — Admin" }] }),
  component: PassengersPage,
});

function PassengersPage() {
  const { user, loading: authLoading } = useAuth();
  const { roles, loading: rolesLoading } = useUserRoles(user?.id);
  const navigate = useNavigate();
  const isAdmin = !!roles?.includes("admin");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || rolesLoading || roles === null) return;
    if (!user || !isAdmin) navigate({ to: "/app" });
  }, [authLoading, rolesLoading, roles, user, isAdmin, navigate]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      const { data: roleRows, error: roleError } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "passenger");
      if (cancelled) return;
      if (roleError) {
        setError(roleError.message);
        setLoading(false);
        return;
      }
      const ids = Array.from(new Set((roleRows ?? []).map((row) => row.user_id)));
      if (!ids.length) {
        setProfiles([]);
        setLoading(false);
        return;
      }
      const { data, error: profileError } = await supabase
        .from("profiles")
        .select("*")
        .in("user_id", ids)
        .order("full_name", { ascending: true, nullsFirst: false });
      if (cancelled) return;
      if (profileError) setError(profileError.message);
      setProfiles((data ?? []) as Profile[]);
      setLoading(false);
    };
    void load();
    const channel = supabase
      .channel("admin-passengers")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "profiles" },
        () => void load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_roles" },
        () => void load(),
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [isAdmin]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return profiles;
    return profiles.filter(
      (profile) =>
        (profile.full_name?.toLowerCase().includes(q) ?? false) ||
        (profile.phone?.toLowerCase().includes(q) ?? false) ||
        profile.user_id.toLowerCase().includes(q),
    );
  }, [profiles, query]);

  if (authLoading || rolesLoading || (user && roles === null)) {
    return (
      <AdminShell title="Passengers">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </AdminShell>
    );
  }
  if (!isAdmin) return null;

  return (
    <AdminShell
      title="Passengers"
      subtitle="Passenger profiles are managed separately from driver operations."
    >
      <div className="relative mb-4 max-w-xl">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name, phone, or user ID…"
          className="pl-9"
        />
      </div>

      {error ? (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : loading ? (
        <div className="rounded-2xl border bg-card p-8 text-center text-sm text-muted-foreground">
          Loading passengers…
        </div>
      ) : !filtered.length ? (
        <div className="rounded-2xl border bg-card p-8 text-center text-sm text-muted-foreground">
          {profiles.length ? "No passengers match your search." : "No passenger profiles found."}
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((profile) => (
            <li key={profile.user_id} className="rounded-2xl border bg-card p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                  <UserCircle2 className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{profile.full_name ?? "Unnamed passenger"}</p>
                  {profile.phone ? (
                    <a
                      href={`tel:${profile.phone}`}
                      className="mt-1 inline-flex items-center gap-1 text-xs text-primary"
                    >
                      <Phone className="h-3 w-3" /> {profile.phone}
                    </a>
                  ) : (
                    <p className="mt-1 text-xs text-muted-foreground">No phone on profile</p>
                  )}
                  <p className="mt-2 font-mono text-[10px] text-muted-foreground">
                    {profile.user_id}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </AdminShell>
  );
}
