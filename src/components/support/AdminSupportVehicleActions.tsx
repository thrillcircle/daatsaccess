import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Car, Loader2, Wrench } from "lucide-react";
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
import { fleetDb, type CanonicalVehicle } from "@/lib/fleet";
import { toast } from "sonner";

export function AdminSupportVehicleActions({
  ticketId,
  vehicleId,
  description,
}: {
  ticketId: string;
  vehicleId: string | null;
  description: string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {vehicleId ? (
        <Button asChild size="sm" variant="outline">
          <Link to="/app/admin/vehicle-profiles/$vehicleId" params={{ vehicleId }}>
            <Car className="mr-1 h-4 w-4" /> View vehicle
          </Link>
        </Button>
      ) : null}
      <LinkVehicleDialog ticketId={ticketId} currentVehicleId={vehicleId} />
      {vehicleId ? (
        <CreateMaintenanceDialog ticketId={ticketId} description={description} />
      ) : null}
    </div>
  );
}

function LinkVehicleDialog({
  ticketId,
  currentVehicleId,
}: {
  ticketId: string;
  currentVehicleId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [vehicles, setVehicles] = useState<CanonicalVehicle[]>([]);
  const [vehicleId, setVehicleId] = useState(currentVehicleId ?? "");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void fleetDb
      .from("vehicle_profiles")
      .select("*")
      .order("vehicle_name")
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) toast.error(error.message);
        setVehicles((data ?? []) as CanonicalVehicle[]);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function save() {
    if (!vehicleId || reason.trim().length < 3) {
      toast.error("Select a canonical vehicle and add a reason");
      return;
    }
    setSaving(true);
    const { error } = await fleetDb.rpc("admin_link_support_vehicle", {
      p_ticket_id: ticketId,
      p_vehicle_id: vehicleId,
      p_reason: reason.trim(),
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Support case linked to canonical vehicle");
    setOpen(false);
    setReason("");
    window.location.reload();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Car className="mr-1 h-4 w-4" /> {currentVehicleId ? "Correct vehicle" : "Link vehicle"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Link canonical vehicle</DialogTitle>
          <DialogDescription>
            The change is recorded in the support audit timeline. Ambiguous legacy registrations are
            not selected automatically.
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading vehicles…
          </p>
        ) : (
          <div className="space-y-4">
            <label className="space-y-1.5 text-sm">
              <span className="font-medium">Vehicle</span>
              <select
                value={vehicleId}
                onChange={(event) => setVehicleId(event.target.value)}
                className="h-10 w-full rounded-md border bg-background px-3"
              >
                <option value="">Select canonical vehicle</option>
                {vehicles.map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>
                    {vehicle.vehicle_name} · {vehicle.license_plate} · {vehicle.status.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5 text-sm">
              <span className="font-medium">Reason for link or correction</span>
              <Textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} />
            </label>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || loading}>
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            Save vehicle link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateMaintenanceDialog({ ticketId, description }: { ticketId: string; description: string }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("repair");
  const [severity, setSeverity] = useState("attention");
  const [workDescription, setWorkDescription] = useState(description);
  const [scheduledAt, setScheduledAt] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (workDescription.trim().length < 3) {
      toast.error("Describe the maintenance requirement");
      return;
    }
    setSaving(true);
    const { error } = await fleetDb.rpc("admin_convert_support_ticket_to_maintenance", {
      p_ticket_id: ticketId,
      p_maintenance_type: type,
      p_severity: severity,
      p_description: workDescription.trim(),
      p_scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
      p_idempotency_key: crypto.randomUUID(),
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Maintenance work order created from support case");
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Wrench className="mr-1 h-4 w-4" /> Create maintenance
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create maintenance work order</DialogTitle>
          <DialogDescription>
            The work order remains linked to this support case and preserves its conversation.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1.5 text-sm">
            <span className="font-medium">Type</span>
            <select
              value={type}
              onChange={(event) => setType(event.target.value)}
              className="h-10 w-full rounded-md border bg-background px-3"
            >
              <option value="scheduled_service">Scheduled service</option>
              <option value="repair">Repair</option>
              <option value="inspection">Inspection</option>
              <option value="tyres">Tyres</option>
              <option value="brakes">Brakes</option>
              <option value="accessibility_equipment">Accessibility equipment</option>
              <option value="ramp_or_lift">Ramp or lift</option>
              <option value="electrical">Electrical</option>
              <option value="bodywork">Bodywork</option>
              <option value="roadworthy">Roadworthy</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="font-medium">Severity</span>
            <select
              value={severity}
              onChange={(event) => setSeverity(event.target.value)}
              className="h-10 w-full rounded-md border bg-background px-3"
            >
              <option value="routine">Routine</option>
              <option value="attention">Attention</option>
              <option value="urgent">Urgent</option>
              <option value="unsafe">Unsafe</option>
            </select>
          </label>
          <label className="space-y-1.5 text-sm sm:col-span-2">
            <span className="font-medium">Schedule</span>
            <Input
              type="datetime-local"
              value={scheduledAt}
              onChange={(event) => setScheduledAt(event.target.value)}
            />
          </label>
          <label className="space-y-1.5 text-sm sm:col-span-2">
            <span className="font-medium">Description</span>
            <Textarea
              value={workDescription}
              onChange={(event) => setWorkDescription(event.target.value)}
              rows={5}
            />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            Create work order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
