import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { AdminShell } from "@/components/AdminShell";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { listAuditEvents, type AuditEvent } from "@/lib/architecture-closeout";

export const Route = createFileRoute("/app/admin/audit-logs")({
  head: () => ({ meta: [{ title: "Audit Logs — Access Admin" }] }),
  component: AuditLogsPage,
});
function AuditLogsPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    listAuditEvents()
      .then(setEvents)
      .catch((e: unknown) =>
        toast.error(e instanceof Error ? e.message : "Could not load audit logs"),
      )
      .finally(() => setLoading(false));
  }, []);
  const visible = useMemo(() => {
    const q = query.toLowerCase().trim();
    return q
      ? events.filter((e) =>
          [e.action, e.module, e.target_type, e.target_id, e.actor_user_id, e.outcome]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q)),
        )
      : events;
  }, [events, query]);
  return (
    <AdminShell
      title="Audit Logs"
      subtitle="Read-only history of important security and operational changes."
    >
      <div className="relative mb-4 max-w-xl">
        <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search action, module, user or record"
        />
      </div>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading audit logs…</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border bg-card">
          <table className="w-full min-w-[780px] text-left text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="p-3">Date</th>
                <th className="p-3">Module</th>
                <th className="p-3">Action</th>
                <th className="p-3">Actor</th>
                <th className="p-3">Record</th>
                <th className="p-3">Result</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((e) => (
                <tr key={e.id} className="border-b last:border-0">
                  <td className="whitespace-nowrap p-3">
                    {new Date(e.created_at).toLocaleString()}
                  </td>
                  <td className="p-3 capitalize">{e.module.replaceAll("_", " ")}</td>
                  <td className="p-3 font-medium">{e.action}</td>
                  <td className="p-3 font-mono text-xs">
                    {e.actor_user_id?.slice(0, 8) ?? "System"}
                  </td>
                  <td className="p-3">
                    {e.target_type ?? "—"}{" "}
                    {e.target_id ? (
                      <span className="font-mono text-xs">{e.target_id.slice(0, 12)}</span>
                    ) : null}
                  </td>
                  <td className="p-3">
                    <Badge variant={e.outcome === "success" ? "secondary" : "destructive"}>
                      {e.outcome}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!visible.length && (
            <p className="p-8 text-center text-muted-foreground">
              No audit events match your search.
            </p>
          )}
        </div>
      )}
    </AdminShell>
  );
}
