import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Clock3, Loader2, MapPin, Radio, Siren, X } from "lucide-react";
import { DispatchStatusBadge, OperationStatusBadge } from "./OperationStatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  asRows,
  formatOperationTime,
  nextDriverActions,
  operationsDb,
  type DispatchOffer,
  type OperationAssignment,
  type OperationRun,
  type OperationStatus,
} from "@/lib/operations";
import { toast } from "sonner";

export function DriverOperationsPanel({
  driverId,
  online,
  onTrackingRunChange,
}: {
  driverId: string;
  online: boolean;
  onTrackingRunChange?: (runId: string | null, rideId: string | null) => void;
}) {
  const [offers, setOffers] = useState<DispatchOffer[]>([]);
  const [assignments, setAssignments] = useState<OperationAssignment[]>([]);
  const [runs, setRuns] = useState<OperationRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [declineTarget, setDeclineTarget] = useState<{
    kind: "offer" | "assignment";
    id: string;
    rowVersion: number;
  } | null>(null);
  const [declineReason, setDeclineReason] = useState("");
  const [incidentRun, setIncidentRun] = useState<OperationRun | null>(null);
  const [incidentType, setIncidentType] = useState("delay");
  const [incidentSeverity, setIncidentSeverity] = useState("medium");
  const [incidentTitle, setIncidentTitle] = useState("");
  const [incidentNotes, setIncidentNotes] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [offerRes, assignmentRes, runRes] = await Promise.all([
      operationsDb
        .from("dispatch_offers")
        .select("*")
        .eq("driver_user_id", driverId)
        .in("status", ["offered", "accepted"])
        .order("offered_at", { ascending: false }),
      operationsDb
        .from("operation_run_assignments")
        .select("*")
        .eq("driver_user_id", driverId)
        .in("status", ["proposed", "reserved", "assigned", "acknowledged", "completed"])
        .order("planned_start_at", { ascending: true }),
      operationsDb
        .from("operation_runs")
        .select("*")
        .not("operational_status", "in", "(cancelled,failed)")
        .order("planned_start_at", { ascending: true }),
    ]);
    const error = offerRes.error || assignmentRes.error || runRes.error;
    if (error) toast.error(error.message);
    else {
      setOffers(asRows<DispatchOffer>(offerRes.data));
      setAssignments(asRows<OperationAssignment>(assignmentRes.data));
      setRuns(asRows<OperationRun>(runRes.data));
    }
    setLoading(false);
  }, [driverId]);

  useEffect(() => {
    void load();
    const channel = operationsDb
      .channel(`driver-phase5-${driverId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "dispatch_offers",
          filter: `driver_user_id=eq.${driverId}`,
        },
        () => void load(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "operation_run_assignments",
          filter: `driver_user_id=eq.${driverId}`,
        },
        () => void load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "operation_runs" },
        () => void load(),
      )
      .subscribe();
    return () => {
      void operationsDb.removeChannel(channel);
    };
  }, [driverId, load]);

  const runById = useMemo(() => new Map(runs.map((run) => [run.id, run])), [runs]);
  const activeAssignments = useMemo(
    () =>
      assignments.filter((assignment) =>
        ["proposed", "reserved", "assigned", "acknowledged"].includes(assignment.status),
      ),
    [assignments],
  );
  const activeRuns = useMemo(
    () =>
      activeAssignments
        .map((assignment) => ({ assignment, run: runById.get(assignment.operation_run_id) }))
        .filter(
          (item): item is { assignment: OperationAssignment; run: OperationRun } => !!item.run,
        )
        .sort(
          (a, b) =>
            new Date(a.run.planned_start_at ?? 0).getTime() -
            new Date(b.run.planned_start_at ?? 0).getTime(),
        ),
    [activeAssignments, runById],
  );
  const tracking = activeRuns.find(({ run }) =>
    [
      "dispatched",
      "driver_en_route",
      "driver_arrived",
      "passenger_on_board",
      "in_service",
      "waiting",
      "interrupted",
    ].includes(run.operational_status),
  );

  useEffect(() => {
    onTrackingRunChange?.(tracking?.run.id ?? null, tracking?.run.ride_id ?? null);
  }, [onTrackingRunChange, tracking?.run.id, tracking?.run.ride_id]);

  async function acceptOffer(offer: DispatchOffer) {
    setBusy(`offer:${offer.id}`);
    const { data, error } = await operationsDb.rpc("driver_accept_dispatch_offer", {
      p_offer_id: offer.id,
      p_expected_offer_version: offer.row_version,
      p_idempotency_key: crypto.randomUUID(),
    });
    setBusy(null);
    if (error) toast.error(error.message);
    else {
      const accepted = (data as { accepted?: boolean; reason?: string } | null)?.accepted;
      if (accepted) toast.success("Dispatch offer accepted");
      else
        toast.info(`Offer not accepted: ${(data as { reason?: string })?.reason ?? "unavailable"}`);
      await load();
    }
  }

  async function submitDecline() {
    if (!declineTarget) return;
    setBusy(`decline:${declineTarget.id}`);
    const result =
      declineTarget.kind === "offer"
        ? await operationsDb.rpc("driver_decline_dispatch_offer", {
            p_offer_id: declineTarget.id,
            p_expected_offer_version: declineTarget.rowVersion,
            p_reason: declineReason || undefined,
          })
        : await operationsDb.rpc("driver_decline_operation", {
            p_assignment_id: declineTarget.id,
            p_expected_assignment_version: declineTarget.rowVersion,
            p_reason: declineReason,
          });
    setBusy(null);
    if (result.error) toast.error(result.error.message);
    else {
      toast.success("Response recorded");
      setDeclineTarget(null);
      setDeclineReason("");
      await load();
    }
  }

  async function acknowledge(assignment: OperationAssignment) {
    setBusy(`ack:${assignment.id}`);
    const { error } = await operationsDb.rpc("driver_acknowledge_operation", {
      p_assignment_id: assignment.id,
      p_expected_assignment_version: assignment.row_version,
      p_idempotency_key: crypto.randomUUID(),
    });
    setBusy(null);
    if (error) toast.error(error.message);
    else {
      toast.success("Assignment acknowledged");
      await load();
    }
  }

  async function transition(run: OperationRun, target: OperationStatus) {
    setBusy(`transition:${run.id}`);
    const { error } = await operationsDb.rpc("driver_transition_operation", {
      p_run_id: run.id,
      p_target_status: target,
      p_expected_run_version: run.row_version,
      p_reason: undefined,
      p_idempotency_key: crypto.randomUUID(),
    });
    setBusy(null);
    if (error) toast.error(error.message);
    else {
      toast.success(`Operation marked ${target.replaceAll("_", " ")}`);
      await load();
    }
  }

  async function reportIncident() {
    if (!incidentRun || !incidentTitle.trim() || !incidentNotes.trim()) return;
    setBusy(`incident:${incidentRun.id}`);
    const { error } = await operationsDb.rpc("driver_report_incident", {
      p_run_id: incidentRun.id,
      p_incident_type: incidentType,
      p_severity: incidentSeverity,
      p_title: incidentTitle.trim(),
      p_internal_notes: incidentNotes.trim(),
      p_passenger_visible_summary:
        incidentType === "delay" ? "Your service is delayed. Operations has been notified." : undefined,
    });
    setBusy(null);
    if (error) toast.error(error.message);
    else {
      toast.success("Incident reported to operations");
      setIncidentRun(null);
      setIncidentTitle("");
      setIncidentNotes("");
      await load();
    }
  }

  const liveOffers = offers.filter(
    (offer) => offer.status === "offered" && new Date(offer.expires_at) > new Date(),
  );

  return (
    <section className="mt-4 space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Radio className="h-4 w-4 text-primary" />
            Dispatch offers
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!online ? (
            <p className="text-sm text-muted-foreground">
              Go online to become eligible for immediate dispatch offers.
            </p>
          ) : null}
          {loading ? <p className="text-sm text-muted-foreground">Loading operations…</p> : null}
          {!loading && online && !liveOffers.length ? (
            <p className="text-sm text-muted-foreground">No active dispatch offers.</p>
          ) : null}
          {liveOffers.map((offer) => {
            const run = runById.get(offer.operation_run_id);
            if (!run) return null;
            return (
              <div key={offer.id} className="rounded-xl border border-primary/30 bg-primary/5 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge>Wave {offer.dispatch_wave}</Badge>
                      <span className="text-xs text-muted-foreground">
                        Expires{" "}
                        {new Date(offer.expires_at).toLocaleTimeString("en-ZA", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <p className="mt-3 flex items-start gap-2 text-sm">
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      {run.pickup_address || "Pickup details available after acceptance"} →{" "}
                      {run.destination_address || "Destination"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      No Passenger private profile or financial information is included.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() =>
                        setDeclineTarget({
                          kind: "offer",
                          id: offer.id,
                          rowVersion: offer.row_version,
                        })
                      }
                    >
                      <X className="mr-2 h-4 w-4" />
                      Decline
                    </Button>
                    <Button
                      onClick={() => void acceptOffer(offer)}
                      disabled={busy === `offer:${offer.id}`}
                    >
                      <Check className="mr-2 h-4 w-4" />
                      Accept
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock3 className="h-4 w-4" />
            Today and upcoming
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!activeRuns.length ? (
            <p className="text-sm text-muted-foreground">No Phase 5 assignments yet.</p>
          ) : null}
          {activeRuns.map(({ assignment, run }) => {
            const actions = nextDriverActions(run.operational_status);
            return (
              <div key={assignment.id} className="rounded-xl border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{run.run_reference}</p>
                      <OperationStatusBadge status={run.operational_status} />
                      <DispatchStatusBadge status={run.dispatch_status} />
                      <Badge variant="outline">{assignment.status}</Badge>
                    </div>
                    <p className="mt-2 text-sm">
                      {run.pickup_address || "Pickup pending"} →{" "}
                      {run.destination_address || "Destination pending"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatOperationTime(run.planned_start_at)}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setIncidentRun(run)}>
                    <Siren className="mr-2 h-4 w-4" />
                    Report issue
                  </Button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {["proposed", "reserved", "assigned"].includes(assignment.status) ? (
                    <>
                      <Button
                        onClick={() => void acknowledge(assignment)}
                        disabled={busy === `ack:${assignment.id}`}
                      >
                        <Check className="mr-2 h-4 w-4" />
                        Acknowledge
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() =>
                          setDeclineTarget({
                            kind: "assignment",
                            id: assignment.id,
                            rowVersion: assignment.row_version,
                          })
                        }
                      >
                        <X className="mr-2 h-4 w-4" />
                        Decline
                      </Button>
                    </>
                  ) : null}
                  {assignment.status === "acknowledged"
                    ? actions.map((target) => (
                        <Button
                          key={target}
                          variant={
                            target === "interrupted" || target === "failed"
                              ? "destructive"
                              : "outline"
                          }
                          onClick={() => void transition(run, target)}
                          disabled={busy === `transition:${run.id}`}
                        >
                          {target.replaceAll("_", " ")}
                        </Button>
                      ))
                    : null}
                </div>
                {run.operational_status === "driver_arrived" && run.ride_id ? (
                  <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    Use the existing Start Trip PIN flow below before marking transport in service.
                  </div>
                ) : null}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Dialog open={!!declineTarget} onOpenChange={(open) => !open && setDeclineTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Decline operational work</DialogTitle>
            <DialogDescription>
              A reason is required for scheduled assignments and helps Operations find a
              replacement.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Reason</Label>
            <Textarea
              value={declineReason}
              onChange={(event) => setDeclineReason(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeclineTarget(null)}>
              Back
            </Button>
            <Button
              variant="destructive"
              onClick={() => void submitDecline()}
              disabled={
                (declineTarget?.kind === "assignment" && !declineReason.trim()) ||
                busy === `decline:${declineTarget?.id}`
              }
            >
              Decline
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!incidentRun} onOpenChange={(open) => !open && setIncidentRun(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Report operational incident</DialogTitle>
            <DialogDescription>
              Internal notes go to Operations and are not shown to the Passenger.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={incidentType} onValueChange={setIncidentType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[
                      "delay",
                      "breakdown",
                      "passenger_no_show",
                      "safety_concern",
                      "accessibility_failure",
                      "medical_escalation",
                      "route_disruption",
                      "service_interruption",
                      "other",
                    ].map((value) => (
                      <SelectItem key={value} value={value}>
                        {value.replaceAll("_", " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Severity</Label>
                <Select value={incidentSeverity} onValueChange={setIncidentSeverity}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["low", "medium", "high", "critical"].map((value) => (
                      <SelectItem key={value} value={value}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input
                value={incidentTitle}
                onChange={(event) => setIncidentTitle(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>What happened?</Label>
              <Textarea
                value={incidentNotes}
                onChange={(event) => setIncidentNotes(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIncidentRun(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => void reportIncident()}
              disabled={
                !incidentTitle.trim() ||
                !incidentNotes.trim() ||
                busy === `incident:${incidentRun?.id}`
              }
            >
              <Siren className="mr-2 h-4 w-4" />
              Report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
