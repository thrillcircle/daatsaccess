import { useState } from "react";
import { Loader2, Unplug } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { fleetDb, type VehicleAssignment } from "@/lib/fleet";
import { toast } from "sonner";

export function AdminEndVehicleAssignmentDialog({
  assignment,
  onEnded,
}: {
  assignment: VehicleAssignment;
  onEnded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  async function endAssignment() {
    if (reason.trim().length < 3) {
      toast.error("Add a reason for ending or cancelling the assignment");
      return;
    }
    setSaving(true);
    const { error } = await fleetDb.rpc("admin_end_vehicle_assignment", {
      p_assignment_id: assignment.id,
      p_reason: reason.trim(),
      p_expected_status: assignment.status,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(assignment.status === "scheduled" ? "Assignment cancelled" : "Assignment ended");
    setOpen(false);
    setReason("");
    onEnded();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Unplug className="mr-1 h-4 w-4" />
          {assignment.status === "scheduled" ? "Cancel assignment" : "End assignment"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {assignment.status === "scheduled" ? "Cancel scheduled assignment" : "End active assignment"}
          </DialogTitle>
          <DialogDescription>
            Assignment history is preserved. The reason is stored with the completed or cancelled
            record.
          </DialogDescription>
        </DialogHeader>
        <label className="space-y-1.5 text-sm">
          <span className="font-medium">Reason</span>
          <Textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={4} />
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Keep assignment
          </Button>
          <Button onClick={endAssignment} disabled={saving}>
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
