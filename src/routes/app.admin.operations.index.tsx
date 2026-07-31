import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, RefreshCw } from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import {
  DispatchStatusBadge,
  OperationStatusBadge,
} from "@/components/operations/OperationStatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth, useUserRoles } from "@/hooks/use-auth";
import {
  asRows,
  formatOperationTime,
  operationsDb,
  type OperationRun,
} from "@/lib/operations";
import { toast } from "sonner";

export const Route = createFileRoute("/app/admin/operations/")({
  head: () => ({
    meta: [
      { title: "Operations — Access Admin" },
      {
        name: "description",
        content:
          "Browse every Access operation run, review dispatch state and open a run for full operational detail.",
      },
      { property: "og:title", content: "Operations — Access Admin" },
      {
        property: "og:description",
        content: "Browse every Access operation run and open a run for full operational detail.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OperationsIndexPage,
});

type Profile = { user_id: string; full_name: string | null };

function OperationsIndexPage() {
  const { user, loading: authLoading } = useAuth();
  const { roles, loading: rolesLoading } = useUserRoles(user?.id);
  const navigate = useNavigate();
  const isAdmin = !!roles?.includes("admin");
  const [runs, setRuns] = useState<OperationRun[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (authLoading || rolesLoading || roles === null) return;
    if (!user || !isAdmin) navigate({ to: "/app" });
  }, [authLoading, rolesLoading, roles, user, isAdmin, navigate]);

  const load = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    const [runRes, profileRes] = await Promise.all([
      operationsDb
        .from("operation_runs")
        .select("*")
        .order("planned_start_at", { ascending: false })
        .limit(200),
      operationsDb.from("profiles").select("user_id,full_name"),
    ]);
    const error = runRes.error || profileRes.error;
    if (error) toast.error(error.message);
    else {
      setRuns(asRows<OperationRun>(runRes.data));
      setProfiles(
        Object.fromEntries(asRows<Profile>(profileRes.data).map((p) => [p.user_id, p])),
      );
    }
    setLoading(false);
  }, [isAdmin]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return runs;
    return runs.filter((run) =>
      [
        run.run_reference,
        run.pickup_address ?? "",
        run.destination_address ?? "",
        profiles[run.passenger_id]?.full_name ?? "",
        run.operational_status,
      ]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [runs, query, profiles]);

  return (
    <AdminShell
      title="Operations"
      description="Every planned, live and completed operation run."
      actions={
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className="mr-2 h-4 w-4" /> Refresh
        </Button>
      }
    >
      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base">Operation runs ({filtered.length})</CardTitle>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search reference, passenger or address"
            className="sm:max-w-xs"
          />
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading operations…</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">No operation runs found.</p>
          ) : (
            filtered.map((run) => (
              <Link
                key={run.id}
                to="/app/admin/operations/$runId"
                params={{ runId: run.id }}
                className="flex flex-col gap-2 rounded-lg border p-3 transition-colors hover:bg-muted/50 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{run.run_reference}</span>
                    <OperationStatusBadge status={run.operational_status} />
                    <DispatchStatusBadge status={run.dispatch_status} />
                  </div>
                  <p className="truncate text-sm text-muted-foreground">
                    {profiles[run.passenger_id]?.full_name ?? "Passenger"} ·{" "}
                    {run.pickup_address ?? "No pickup"} → {run.destination_address ?? "No destination"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatOperationTime(run.planned_start_at)}
                  </p>
                </div>
                <ArrowRight className="hidden h-4 w-4 shrink-0 text-muted-foreground sm:block" />
              </Link>
            ))
          )}
        </CardContent>
      </Card>
    </AdminShell>
  );
}
