import { useState } from "react";
import { CheckCircle2, Loader2, PauseCircle, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { fleetDb, type MaintenanceStatus, type MaintenanceWorkOrder } from "@/lib/fleet";
import { toast } from "sonner";

export function AdminMaintenanceActions({
  order,
  onChanged,
}: {
  order: MaintenanceWorkOrder;
  onChanged: () => void;
}) {
  const [saving, setSaving] = useState(false);

  async function transition(status: MaintenanceStatus) {
    setSaving(true);
    const { error } = await fleetDb.rpc("admin_transition_maintenance_work_order", {
      p_work_order_id: order.id,
      p_new_status: status,
      p_expected_status: order.status,
      p_diagnosis: null,
      p_work_performed: null,
      p_outcome: null,
      p_odometer_at_completion: null,
      p_next_service_due_date: null,
      p_next_service_due_km: null,
      p_actual_cost: null,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Work order ${status.replaceAll("_", " ")}`);
    onChanged();
  }

  return (
    <div className="flex shrink-0 flex-wrap gap-2 lg:max-w-72 lg:justify-end">
      {order.status === "open" || order.status === "scheduled" ? (
        <Button size="sm" onClick={() => transition("in_progress")} disabled={saving}>
          {saving ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <PlayCircle className="mr-1 h-4 w-4" />
          )}
          Start
        </Button>
      ) : null}
      {order.status === "in_progress" ? (
        <>
          <Button
            size="sm"
            variant="outline"
            onClick={() => transition("waiting_for_parts")}
            disabled={saving}
          >
            <PauseCircle className="mr-1 h-4 w-4" /> Waiting for parts
          </Button>
          <CompleteMaintenanceDialog order={order} onChanged={onChanged} />
        </>
      ) : null}
      {order.status === "waiting_for_parts" ? (
        <Button size="sm" onClick={() => transition("in_progress")} disabled={saving}>
          {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
          Resume
        </Button>
      ) : null}
    </div>
  );
}

function CompleteMaintenanceDialog({
  order,
  onChanged,
}: {
  order: MaintenanceWorkOrder;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [diagnosis, setDiagnosis] = useState(order.diagnosis ?? "");
  const [workPerformed, setWorkPerformed] = useState(order.work_performed ?? "");
  const [outcome, setOutcome] = useState(order.outcome ?? "");
  const [odometer, setOdometer] = useState(
    order.odometer_at_completion == null
      ? order.odometer_at_report == null
        ? ""
        : String(order.odometer_at_report)
      : String(order.odometer_at_completion),
  );
  const [nextServiceDate, setNextServiceDate] = useState(order.next_service_due_date ?? "");
  const [nextServiceKm, setNextServiceKm] = useState(
    order.next_service_due_km == null ? "" : String(order.next_service_due_km),
  );
  const [actualCost, setActualCost] = useState(
    order.actual_cost == null ? "" : String(order.actual_cost),
  );

  async function complete() {
    if (workPerformed.trim().length < 3 || outcome.trim().length < 3) {
      toast.error("Record the work performed and the maintenance outcome");
      return;
    }
    if (!odometer || !Number.isFinite(Number(odometer)) || Number(odometer) < 0) {
      toast.error("Record a valid completion odometer reading");
      return;
    }
    if (order.maintenance_type === "scheduled_service" && !nextServiceKm && !nextServiceDate) {
      toast.error("Set the next service date or odometer for a scheduled service");
      return;
    }

    setSaving(true);
    const { error } = await fleetDb.rpc("admin_transition_maintenance_work_order", {
      p_work_order_id: order.id,
      p_new_status: "completed",
      p_expected_status: order.status,
      p_diagnosis: diagnosis.trim() || null,
      p_work_performed: workPerformed.trim(),
      p_outcome: outcome.trim(),
      p_odometer_at_completion: Number(odometer),
      p_next_service_due_date: nextServiceDate || null,
      p_next_service_due_km: nextServiceKm ? Number(nextServiceKm) : null,
      p_actual_cost: actualCost ? Number(actualCost) : null,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Maintenance completed and canonical vehicle state updated");
    setOpen(false);
    onChanged();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <CheckCircle2 className="mr-1 h-4 w-4" /> Complete
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Complete maintenance work order</DialogTitle>
          <DialogDescription>
            Completion updates the work order, odometer history and service values in one protected
            transaction. Costs remain administrator-only.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1.5 text-sm sm:col-span-2">
            <span className="font-medium">Diagnosis</span>
            <Textarea value={diagnosis} onChange={(event) => setDiagnosis(event.target.value)} rows={3} />
          </label>
          <label className="space-y-1.5 text-sm sm:col-span-2">
            <span className="font-medium">Work performed</span>
            <Textarea
              value={workPerformed}
              onChange={(event) => setWorkPerformed(event.target.value)}
              rows={4}
              required
            />
          </label>
          <label className="space-y-1.5 text-sm sm:col-span-2">
            <span className="font-medium">Outcome</span>
            <Textarea value={outcome} onChange={(event) => setOutcome(event.target.value)} rows={3} required />
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="font-medium">Completion odometer (km)</span>
            <Input
              type="number"
              min="0"
              value={odometer}
              onChange={(event) => setOdometer(event.target.value)}
            />
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="font-medium">Actual cost (admin only)</span>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={actualCost}
              onChange={(event) => setActualCost(event.target.value)}
            />
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="font-medium">Next service date</span>
            <Input
              type="date"
              value={nextServiceDate}
              onChange={(event) => setNextServiceDate(event.target.value)}
            />
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="font-medium">Next service due (km)</span>
            <Input
              type="number"
              min="0"
              value={nextServiceKm}
              onChange={(event) => setNextServiceKm(event.target.value)}
            />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={complete} disabled={saving}>
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            Complete work order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
