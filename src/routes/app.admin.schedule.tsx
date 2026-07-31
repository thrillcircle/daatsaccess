import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, CheckCircle2, Loader2, Plus, RefreshCw, ShieldAlert } from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import {
  DispatchStatusBadge,
  OperationStatusBadge,
} from "@/components/operations/OperationStatusBadge";
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
import { useAuth, useUserRoles } from "@/hooks/use-auth";
import {
  asRows,
  formatOperationTime,
  operationsDb,
  type OperationAssignment,
  type OperationPlan,
  type OperationRun,
} from "@/lib/operations";
import { toast } from "sonner";

export const Route = createFileRoute("/app/admin/schedule")({
  head: () => ({ meta: [{ title: "Operations Schedule — Admin" }] }),
  component: SchedulePage,
});

type Booking = {
  id: string;
  booking_reference: string;
  service_type: string;
  status: string;
  start_at: string | null;
  end_at: string | null;
  admin_notes: string | null;
};
type Resource = { id: string; label: string };

type Validation = {
  is_valid?: boolean;
  blockers?: Array<{ code: string; message: string; run_id?: string }>;
  warnings?: Array<{ code: string; message: string; run_id?: string }>;
};

function SchedulePage() {
  const { user, loading: authLoading } = useAuth();
  const { roles, loading: rolesLoading } = useUserRoles(user?.id);
  const navigate = useNavigate();
  const isAdmin = !!roles?.includes("admin");
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [plans, setPlans] = useState<OperationPlan[]>([]);
  const [runs, setRuns] = useState<OperationRun[]>([]);
  const [assignments, setAssignments] = useState<OperationAssignment[]>([]);
  const [drivers, setDrivers] = useState<Resource[]>([]);
  const [vehicles, setVehicles] = useState<Resource[]>([]);
  const [companions, setCompanions] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [validation, setValidation] = useState<Record<string, Validation>>({});
  const [assignRun, setAssignRun] = useState<OperationRun | null>(null);
  const [resourceType, setResourceType] = useState<"driver" | "vehicle" | "companion">("driver");
  const [resourceId, setResourceId] = useState("");
  const [assignmentReason, setAssignmentReason] = useState("");
  const [publishPlan, setPublishPlan] = useState<OperationPlan | null>(null);
  const [publishReason, setPublishReason] = useState("");

  useEffect(() => {
    if (authLoading || rolesLoading || roles === null) return;
    if (!user || !isAdmin) navigate({ to: "/app" });
  }, [authLoading, rolesLoading, roles, user, isAdmin, navigate]);

  const load = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    const [
      bookingRes,
      planRes,
      runRes,
      assignmentRes,
      roleRes,
      profileRes,
      vehicleRes,
      companionRes,
    ] = await Promise.all([
      operationsDb
        .from("service_bookings")
        .select("id,booking_reference,service_type,status,start_at,end_at,admin_notes")
        .in("status", ["accepted", "resources_assigned", "active"])
        .order("start_at", { ascending: true }),
      operationsDb.from("operation_plans").select("*").order("updated_at", { ascending: false }),
      operationsDb
        .from("operation_runs")
        .select("*")
        .order("planned_start_at", { ascending: true }),
      operationsDb
        .from("operation_run_assignments")
        .select("*")
        .in("status", ["proposed", "reserved", "assigned", "acknowledged"]),
      operationsDb.from("user_roles").select("user_id").eq("role", "driver"),
      operationsDb.from("profiles").select("user_id,full_name"),
      operationsDb
        .from("vehicle_profiles")
        .select("id,vehicle_name,license_plate,status")
        .eq("status", "active")
        .order("vehicle_name"),
      operationsDb
        .from("companion_profiles")
        .select("id,full_name")
        .eq("admin_approved", true)
        .eq("is_available", true)
        .order("full_name"),
    ]);
    const error = [
      bookingRes,
      planRes,
      runRes,
      assignmentRes,
      roleRes,
      profileRes,
      vehicleRes,
      companionRes,
    ]
      .map((result) => result.error)
      .find(Boolean);
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }
    const profileMap = new Map(
      asRows<{ user_id: string; full_name: string | null }>(profileRes.data).map((profile) => [
        profile.user_id,
        profile.full_name,
      ]),
    );
    setBookings(asRows<Booking>(bookingRes.data));
    setPlans(asRows<OperationPlan>(planRes.data));
    setRuns(asRows<OperationRun>(runRes.data));
    setAssignments(asRows<OperationAssignment>(assignmentRes.data));
    setDrivers(
      asRows<{ user_id: string }>(roleRes.data).map((row) => ({
        id: row.user_id,
        label: profileMap.get(row.user_id) || `Driver ${row.user_id.slice(0, 8)}`,
      })),
    );
    setVehicles(
      asRows<{ id: string; vehicle_name: string; license_plate: string }>(vehicleRes.data).map(
        (vehicle) => ({
          id: vehicle.id,
          label: `${vehicle.vehicle_name} · ${vehicle.license_plate}`,
        }),
      ),
    );
    setCompanions(
      asRows<{ id: string; full_name: string }>(companionRes.data).map((companion) => ({
        id: companion.id,
        label: companion.full_name,
      })),
    );
    setLoading(false);
  }, [isAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  const planByBooking = useMemo(
    () => new Map(plans.map((plan) => [plan.service_booking_id, plan])),
    [plans],
  );
  const runsByPlan = useMemo(() => {
    const grouped = new Map<string, OperationRun[]>();
    for (const run of runs) {
      if (!run.operation_plan_id) continue;
      grouped.set(run.operation_plan_id, [...(grouped.get(run.operation_plan_id) ?? []), run]);
    }
    return grouped;
  }, [runs]);

  async function planBooking(booking: Booking) {
    setBusy(`booking:${booking.id}`);
    const includeVerification =
      booking.admin_notes?.toUpperCase().includes("PHASE 4 VERIFICATION RECORD") ?? false;
    const { error } = await operationsDb.rpc("admin_plan_service_booking", {
      p_booking_id: booking.id,
      p_include_verification: includeVerification,
      p_idempotency_key: crypto.randomUUID(),
    });
    setBusy(null);
    if (error) toast.error(error.message);
    else {
      toast.success("Draft operation plan created");
      await load();
    }
  }

  async function validatePlan(plan: OperationPlan) {
    setBusy(`validate:${plan.id}`);
    const { data, error } = await operationsDb.rpc("admin_validate_operation_plan", {
      p_plan_id: plan.id,
    });
    setBusy(null);
    if (error) toast.error(error.message);
    else {
      setValidation((previous) => ({ ...previous, [plan.id]: (data ?? {}) as Validation }));
      toast.success((data as Validation)?.is_valid ? "Plan is valid" : "Plan has blockers");
    }
  }

  async function assignResource() {
    if (!assignRun || !resourceId) return;
    setBusy(`assign:${assignRun.id}`);
    const { error } = await operationsDb.rpc("admin_assign_operation_resource", {
      p_run_id: assignRun.id,
      p_resource_type: resourceType,
      p_resource_id: resourceId,
      p_expected_run_version: assignRun.row_version,
      p_assignment_source: "administrator",
      p_reason: assignmentReason || undefined,
      p_idempotency_key: crypto.randomUUID(),
    });
    setBusy(null);
    if (error) toast.error(error.message);
    else {
      toast.success("Resource assigned");
      setAssignRun(null);
      setResourceId("");
      setAssignmentReason("");
      await load();
    }
  }

  async function publish() {
    if (!publishPlan) return;
    setBusy(`publish:${publishPlan.id}`);
    const { error } = await operationsDb.rpc("admin_publish_operation_plan", {
      p_plan_id: publishPlan.id,
      p_expected_row_version: publishPlan.row_version,
      p_confirmation: "PUBLISH",
      p_warning_override_reason: publishReason || undefined,
      p_idempotency_key: crypto.randomUUID(),
    });
    setBusy(null);
    if (error) toast.error(error.message);
    else {
      toast.success("Operation plan published");
      setPublishPlan(null);
      setPublishReason("");
      await load();
    }
  }

  const availableResources =
    resourceType === "driver" ? drivers : resourceType === "vehicle" ? vehicles : companions;

  if (!isAdmin) return null;
  return (
    <AdminShell
      title="Operations Schedule"
      subtitle="Convert accepted bookings into validated, conflict-free service runs and publish their resource plan."
      actions={
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className="mr-2 h-4 w-4" /> Refresh
        </Button>
      }
    >
      <div className="grid gap-4 md:grid-cols-4">
        <Stat label="Accepted bookings" value={bookings.length} />
        <Stat label="Draft plans" value={plans.filter((plan) => plan.status === "draft").length} />
        <Stat
          label="Unassigned runs"
          value={
            runs.filter(
              (run) => !assignments.some((assignment) => assignment.operation_run_id === run.id),
            ).length
          }
        />
        <Stat
          label="Published plans"
          value={plans.filter((plan) => plan.status === "published").length}
        />
      </div>

      <Card className="mt-5">
        <CardHeader>
          <CardTitle className="text-base">Planning queue</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading operational schedule…</p>
          ) : null}
          {!loading && !bookings.length ? (
            <p className="text-sm text-muted-foreground">
              No accepted bookings are awaiting planning.
            </p>
          ) : null}
          {bookings.map((booking) => {
            const plan = planByBooking.get(booking.id);
            const planRuns = plan ? (runsByPlan.get(plan.id) ?? []) : [];
            const result = plan ? validation[plan.id] : undefined;
            return (
              <div key={booking.id} className="rounded-xl border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{booking.booking_reference}</p>
                      <Badge variant="outline">{booking.service_type.replaceAll("_", " ")}</Badge>
                      <Badge>{booking.status}</Badge>
                      {booking.admin_notes
                        ?.toUpperCase()
                        .includes("PHASE 4 VERIFICATION RECORD") ? (
                        <Badge variant="destructive">Verification record</Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {formatOperationTime(booking.start_at)}
                    </p>
                  </div>
                  {!plan ? (
                    <Button
                      onClick={() => void planBooking(booking)}
                      disabled={busy === `booking:${booking.id}`}
                    >
                      {busy === `booking:${booking.id}` ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Plus className="mr-2 h-4 w-4" />
                      )}
                      Create plan
                    </Button>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        onClick={() => void validatePlan(plan)}
                        disabled={busy === `validate:${plan.id}`}
                      >
                        <ShieldAlert className="mr-2 h-4 w-4" /> Validate
                      </Button>
                      {plan.status !== "published" ? (
                        <Button onClick={() => setPublishPlan(plan)}>
                          <CheckCircle2 className="mr-2 h-4 w-4" /> Publish
                        </Button>
                      ) : null}
                    </div>
                  )}
                </div>

                {result ? (
                  <div
                    className={`mt-3 rounded-lg border p-3 text-sm ${result.is_valid ? "border-emerald-500/30 bg-emerald-500/5" : "border-destructive/30 bg-destructive/5"}`}
                  >
                    <p className="font-medium">
                      {result.is_valid
                        ? "Ready to publish"
                        : `${result.blockers?.length ?? 0} blocker(s)`}
                    </p>
                    {result.blockers?.map((item) => (
                      <p
                        key={`${item.code}-${item.run_id ?? "plan"}`}
                        className="mt-1 text-xs text-destructive"
                      >
                        • {item.message}
                      </p>
                    ))}
                    {result.warnings?.map((item) => (
                      <p
                        key={`${item.code}-${item.run_id ?? "plan"}`}
                        className="mt-1 text-xs text-amber-700"
                      >
                        • {item.message}
                      </p>
                    ))}
                  </div>
                ) : null}

                {plan ? (
                  <div className="mt-4 space-y-2">
                    {planRuns.map((run) => {
                      const runAssignments = assignments.filter(
                        (assignment) => assignment.operation_run_id === run.id,
                      );
                      return (
                        <div
                          key={run.id}
                          className="flex flex-col gap-3 rounded-lg bg-muted/40 p-3 lg:flex-row lg:items-center lg:justify-between"
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <Link
                                to="/app/admin/operations/$runId"
                                params={{ runId: run.id }}
                                className="font-medium text-primary hover:underline"
                              >
                                {run.run_reference}
                              </Link>
                              <OperationStatusBadge status={run.operational_status} />
                              <DispatchStatusBadge status={run.dispatch_status} />
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {run.run_type.replaceAll("_", " ")} ·{" "}
                              {formatOperationTime(run.planned_start_at)}
                            </p>
                            <div className="mt-2 flex flex-wrap gap-1">
                              {runAssignments.map((assignment) => (
                                <Badge key={assignment.id} variant="secondary">
                                  {assignment.resource_type}: {assignment.status}
                                </Badge>
                              ))}
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setAssignRun(run);
                              setResourceId("");
                            }}
                          >
                            Assign resource
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Dialog open={!!assignRun} onOpenChange={(open) => !open && setAssignRun(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign operational resource</DialogTitle>
            <DialogDescription>
              The server checks availability, overlap, maintenance, documents and role eligibility.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Resource type</Label>
              <Select
                value={resourceType}
                onValueChange={(value) => {
                  setResourceType(value as typeof resourceType);
                  setResourceId("");
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="driver">Driver</SelectItem>
                  <SelectItem value="vehicle">Vehicle</SelectItem>
                  <SelectItem value="companion">Companion</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Resource</Label>
              <Select value={resourceId} onValueChange={setResourceId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select an eligible resource" />
                </SelectTrigger>
                <SelectContent>
                  {availableResources.map((resource) => (
                    <SelectItem key={resource.id} value={resource.id}>
                      {resource.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Reason or note</Label>
              <Textarea
                value={assignmentReason}
                onChange={(event) => setAssignmentReason(event.target.value)}
                placeholder="Optional operational context"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignRun(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => void assignResource()}
              disabled={!resourceId || busy === `assign:${assignRun?.id}`}
            >
              Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!publishPlan} onOpenChange={(open) => !open && setPublishPlan(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publish operation plan</DialogTitle>
            <DialogDescription>
              Publishing reserves the validated resources and makes the runs operational.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Warning override reason</Label>
            <Input
              value={publishReason}
              onChange={(event) => setPublishReason(event.target.value)}
              placeholder="Required only when validation reports warnings"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPublishPlan(null)}>
              Cancel
            </Button>
            <Button onClick={() => void publish()} disabled={busy === `publish:${publishPlan?.id}`}>
              Publish plan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminShell>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <p className="text-2xl font-semibold">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}
