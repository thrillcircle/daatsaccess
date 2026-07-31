import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Car,
  Clock3,
  MapPin,
  RefreshCw,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { OperationStatusBadge } from "./OperationStatusBadge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { Textarea } from "@/components/ui/textarea";
import {
  asRows,
  formatOperationTime,
  operationsDb,
  type PassengerOperation,
} from "@/lib/operations";
import { toast } from "sonner";

export function PassengerOperationsTimeline({ userId }: { userId?: string }) {
  const [operations, setOperations] = useState<PassengerOperation[]>([]);
  const [loading, setLoading] = useState(true);
  const [locationByRun, setLocationByRun] = useState<
    Record<
      string,
      { latitude: number; longitude: number; captured_at: string; freshness_state: string }
    >
  >({});
  const [issueRun, setIssueRun] = useState<PassengerOperation | null>(null);
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    const { data, error } = await operationsDb.rpc("passenger_operation_timeline", {
      p_service_booking_id: null,
      p_ride_id: null,
    });
    if (error) {
      // Phase 5 may not be deployed yet while the branch is under review.
      if (!error.message.toLowerCase().includes("function")) toast.error(error.message);
      setOperations([]);
    } else {
      setOperations(
        asRows<PassengerOperation>((data as { operations?: unknown } | null)?.operations),
      );
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void load();
    if (!userId) return;
    const channel = operationsDb
      .channel(`passenger-operations-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "operation_runs" },
        () => void load(),
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        () => void load(),
      )
      .subscribe();
    return () => {
      void operationsDb.removeChannel(channel);
    };
  }, [load, userId]);

  const active = useMemo(
    () =>
      operations.filter(
        (operation) => !["completed", "cancelled", "failed"].includes(operation.status),
      ),
    [operations],
  );

  useEffect(() => {
    const trackable = active.filter((operation) =>
      [
        "dispatched",
        "driver_en_route",
        "driver_arrived",
        "passenger_on_board",
        "in_service",
        "waiting",
      ].includes(operation.status),
    );
    if (!trackable.length) return;
    let cancelled = false;
    const loadLocations = async () => {
      const entries = await Promise.all(
        trackable.map(async (operation) => {
          const { data } = await operationsDb.rpc("passenger_active_driver_location", {
            p_operation_run_id: operation.id,
          });
          const payload = data as {
            available?: boolean;
            latitude?: number;
            longitude?: number;
            captured_at?: string;
            freshness_state?: string;
          } | null;
          return payload?.available &&
            payload.latitude != null &&
            payload.longitude != null &&
            payload.captured_at
            ? ([
                operation.id,
                {
                  latitude: payload.latitude,
                  longitude: payload.longitude,
                  captured_at: payload.captured_at,
                  freshness_state: payload.freshness_state ?? "fresh",
                },
              ] as const)
            : null;
        }),
      );
      if (!cancelled)
        setLocationByRun(
          Object.fromEntries(
            entries.filter((entry): entry is NonNullable<typeof entry> => !!entry),
          ),
        );
    };
    void loadLocations();
    const interval = window.setInterval(() => void loadLocations(), 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [active]);

  async function reportIssue() {
    if (!issueRun || !subject.trim() || !description.trim()) return;
    setBusy(true);
    const { error } = await operationsDb.rpc("passenger_report_operation_issue", {
      p_operation_run_id: issueRun.id,
      p_subject: subject.trim(),
      p_description: description.trim(),
      p_priority: "normal",
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Operations issue sent to Support");
      setIssueRun(null);
      setSubject("");
      setDescription("");
    }
  }

  if (!loading && !active.length) return null;
  return (
    <section className="mt-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock3 className="h-4 w-4" />
              Your service timeline
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading service operations…</p>
          ) : null}
          {active.map((operation) => {
            const location = locationByRun[operation.id];
            return (
              <div key={operation.id} className="rounded-xl border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{operation.run_reference}</p>
                      <OperationStatusBadge status={operation.status} />
                    </div>
                    <p className="mt-2 flex items-start gap-2 text-sm">
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      {operation.pickup_address || "Pickup pending"} →{" "}
                      {operation.destination_address || "Destination pending"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatOperationTime(operation.planned_start_at)}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setIssueRun(operation)}>
                    Get support
                  </Button>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg bg-muted/40 p-3 text-sm">
                    <div className="flex items-center gap-2 font-medium">
                      <UserRound className="h-4 w-4" />
                      Assigned Driver
                    </div>
                    {operation.driver ? (
                      <div className="mt-2 flex items-center gap-2">
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={operation.driver.profile_photo_url || undefined} />
                          <AvatarFallback>
                            {operation.driver.full_name?.slice(0, 2).toUpperCase() || "DR"}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p>{operation.driver.full_name || "Access Driver"}</p>
                          <p className="text-xs text-muted-foreground">
                            {operation.driver.assignment_status}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-muted-foreground">
                        A Driver has not been confirmed yet.
                      </p>
                    )}
                  </div>
                  <div className="rounded-lg bg-muted/40 p-3 text-sm">
                    <div className="flex items-center gap-2 font-medium">
                      <Car className="h-4 w-4" />
                      Assigned vehicle
                    </div>
                    {operation.vehicle ? (
                      <div className="mt-2">
                        <p>{operation.vehicle.vehicle_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {operation.vehicle.make} {operation.vehicle.model} ·{" "}
                          {operation.vehicle.license_plate}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {operation.vehicle.wheelchair_accessible ? (
                            <Badge variant="outline">Wheelchair accessible</Badge>
                          ) : null}
                          {operation.vehicle.ramp_or_lift_available ? (
                            <Badge variant="outline">Ramp or lift</Badge>
                          ) : null}
                        </div>
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-muted-foreground">
                        A vehicle has not been confirmed yet.
                      </p>
                    )}
                  </div>
                </div>

                {location ? (
                  <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
                    <div>
                      <p className="font-medium">Driver location available</p>
                      <p className="text-xs text-muted-foreground">
                        Updated{" "}
                        {new Date(location.captured_at).toLocaleTimeString("en-ZA", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}{" "}
                        · {location.freshness_state}
                      </p>
                    </div>
                    <a
                      className="text-xs font-medium text-primary hover:underline"
                      href={`https://www.google.com/maps/search/?api=1&query=${location.latitude},${location.longitude}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open map
                    </a>
                  </div>
                ) : null}

                {operation.incident_updates?.map((incident) => (
                  <div
                    key={incident.incident_reference}
                    className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm"
                  >
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    <div>
                      <p className="font-medium">Service update</p>
                      <p className="text-xs">{incident.summary}</p>
                    </div>
                  </div>
                ))}
                <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Only your own service and currently assigned resources are shown.
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Dialog open={!!issueRun} onOpenChange={(open) => !open && setIssueRun(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Report an operation issue</DialogTitle>
            <DialogDescription>
              This creates a linked Support ticket for your service.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Subject</Label>
              <Input value={subject} onChange={(event) => setSubject(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>What happened?</Label>
              <Textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIssueRun(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => void reportIssue()}
              disabled={!subject.trim() || !description.trim() || busy}
            >
              Send to Support
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
