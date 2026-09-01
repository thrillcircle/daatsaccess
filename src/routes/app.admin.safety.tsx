import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, MapPin, RefreshCcw, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { AdminShell } from "@/components/AdminShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  listSafetyIncidents,
  updateSafetyIncident,
  type SafetyIncident,
  type SafetyStatus,
} from "@/lib/phase7-commercial";

export const Route = createFileRoute("/app/admin/safety")({
  head: () => ({ meta: [{ title: "Safety & SOS — Access Admin" }] }),
  component: AdminSafetyPage,
});

const statusOptions: SafetyStatus[] = ["open", "acknowledged", "responding", "resolved", "closed"];

function AdminSafetyPage() {
  const [incidents, setIncidents] = useState<SafetyIncident[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"active" | "all">("active");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [responseNotes, setResponseNotes] = useState("");
  const [resolution, setResolution] = useState("");

  async function load() {
    setLoading(true);
    try {
      const data = await listSafetyIncidents();
      setIncidents(data);
      if (selectedId && !data.some((item) => item.id === selectedId)) setSelectedId(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load safety incidents");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = useMemo(
    () =>
      filter === "active"
        ? incidents.filter((item) => !["resolved", "closed"].includes(item.status))
        : incidents,
    [filter, incidents],
  );
  const selected = incidents.find((item) => item.id === selectedId) ?? null;

  async function update(status: SafetyStatus, assignToSelf = false) {
    if (!selected) return;
    setSaving(true);
    try {
      await updateSafetyIncident({
        incidentId: selected.id,
        status,
        assignToSelf,
        responseNotes: responseNotes.trim() || null,
        resolutionSummary: resolution.trim() || null,
      });
      toast.success(`Incident ${status.replaceAll("_", " ")}`);
      setResponseNotes("");
      if (status === "resolved" || status === "closed") setResolution("");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update incident");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminShell title="Safety & SOS">
      <div className="space-y-4">
        <section className="rounded-2xl border bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-destructive" />
                <h1 className="text-xl font-semibold">Safety & SOS response centre</h1>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Passenger and driver emergency reports from active trips appear here for immediate operational response.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCcw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>
          <div className="mt-4 flex gap-2">
            <Button size="sm" variant={filter === "active" ? "default" : "outline"} onClick={() => setFilter("active")}>
              Active ({incidents.filter((item) => !["resolved", "closed"].includes(item.status)).length})
            </Button>
            <Button size="sm" variant={filter === "all" ? "default" : "outline"} onClick={() => setFilter("all")}>
              All ({incidents.length})
            </Button>
          </div>
        </section>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
          <section className="rounded-2xl border bg-card p-4 shadow-sm">
            {loading ? (
              <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading incidents…
              </p>
            ) : !visible.length ? (
              <p className="py-10 text-center text-sm text-muted-foreground">No safety incidents match this view.</p>
            ) : (
              <div className="space-y-2">
                {visible.map((incident) => (
                  <button
                    key={incident.id}
                    type="button"
                    onClick={() => {
                      setSelectedId(incident.id);
                      setResponseNotes(incident.response_notes ?? "");
                      setResolution(incident.resolution_summary ?? "");
                    }}
                    className={`w-full rounded-xl border p-3 text-left transition hover:bg-muted/40 ${
                      selectedId === incident.id ? "border-primary bg-primary/5" : ""
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold">{incident.incident_reference}</p>
                        <p className="mt-0.5 text-sm capitalize">{incident.category.replaceAll("_", " ")}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {incident.reporter_name ?? incident.reporter_role} · {new Date(incident.created_at).toLocaleString("en-ZA")}
                        </p>
                      </div>
                      <div className="text-right">
                        <span className={`rounded-full px-2 py-1 text-[11px] font-medium ${incident.severity === "critical" ? "bg-destructive/10 text-destructive" : "bg-amber-500/10 text-amber-800"}`}>
                          {incident.severity}
                        </span>
                        <p className="mt-2 text-xs capitalize text-muted-foreground">{incident.status}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>

          <aside className="rounded-2xl border bg-card p-4 shadow-sm">
            {!selected ? (
              <div className="flex min-h-48 flex-col items-center justify-center text-center text-sm text-muted-foreground">
                <AlertTriangle className="mb-2 h-6 w-6" /> Select an incident to manage it.
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Incident</p>
                  <h2 className="text-lg font-semibold">{selected.incident_reference}</h2>
                  <p className="text-sm capitalize">{selected.category.replaceAll("_", " ")}</p>
                </div>

                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <Detail label="Reporter" value={selected.reporter_name ?? selected.reporter_role} />
                  <Detail label="Status" value={selected.status} />
                  <Detail label="Passenger" value={selected.passenger_name ?? "—"} />
                  <Detail label="Driver" value={selected.driver_name ?? "—"} />
                  <Detail label="Vehicle" value={[selected.vehicle_name, selected.license_plate].filter(Boolean).join(" · ") || "—"} />
                  <Detail label="Reported" value={new Date(selected.created_at).toLocaleString("en-ZA")} />
                </dl>

                {selected.latitude != null && selected.longitude != null ? (
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${selected.latitude},${selected.longitude}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 rounded-xl border p-3 text-sm text-primary hover:bg-muted/40"
                  >
                    <MapPin className="h-4 w-4" /> Open reported location
                  </a>
                ) : null}

                {selected.description ? (
                  <div className="rounded-xl bg-secondary/50 p-3 text-sm">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Details</p>
                    <p className="mt-1 whitespace-pre-wrap">{selected.description}</p>
                  </div>
                ) : null}

                <Button asChild variant="outline" className="w-full">
                  <Link to="/app/admin/trips" search={{ status: "all", q: selected.ride_id }}>
                    Open linked trip
                  </Link>
                </Button>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium" htmlFor="safety-response-notes">Response notes</label>
                  <Textarea id="safety-response-notes" value={responseNotes} onChange={(event) => setResponseNotes(event.target.value)} rows={3} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium" htmlFor="safety-resolution">Resolution summary</label>
                  <Textarea id="safety-resolution" value={resolution} onChange={(event) => setResolution(event.target.value)} rows={3} />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" disabled={saving} onClick={() => void update("acknowledged", true)}>
                    Acknowledge & assign
                  </Button>
                  <Button variant="outline" disabled={saving} onClick={() => void update("responding", true)}>
                    Responding
                  </Button>
                  <Button disabled={saving || !resolution.trim()} onClick={() => void update("resolved", true)}>
                    Resolve incident
                  </Button>
                  <Button variant="secondary" disabled={saving || !resolution.trim()} onClick={() => void update("closed", true)}>
                    Close
                  </Button>
                </div>
              </div>
            )}
          </aside>
        </div>
      </div>
    </AdminShell>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words capitalize">{value}</dd>
    </div>
  );
}
