import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { LifeBuoy, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  SUPPORT_CATEGORIES,
  type SupportCategory,
  type SupportPriority,
  type SupportTicket,
} from "@/lib/support";

export function AdminCreateSupportTicketDialog({
  passengerId,
  passengerName,
}: {
  passengerId: string;
  passengerName: string;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [category, setCategory] = useState<SupportCategory>("account_profile");
  const [priority, setPriority] = useState<SupportPriority>("normal");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");

  async function createTicket() {
    if (subject.trim().length < 3 || description.trim().length < 3) {
      toast.error("Add a clear subject and description");
      return;
    }

    setCreating(true);
    const { data, error } = await supabase.rpc("support_create_ticket", {
      p_requester_role: "passenger",
      p_category: category,
      p_subject: subject.trim(),
      p_description: description.trim(),
      p_priority: priority,
      p_ride_id: null,
      p_service_booking_id: null,
      p_passenger_id: passengerId,
      p_driver_id: null,
    });
    setCreating(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    const ticket = data as SupportTicket;
    toast.success(`${ticket.ticket_reference} created for ${passengerName}`);
    setOpen(false);
    setSubject("");
    setDescription("");
    navigate({
      to: "/app/admin/support/$ticketId",
      params: { ticketId: ticket.id },
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <LifeBuoy className="mr-1 h-4 w-4" /> Open support case
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Open a support case</DialogTitle>
          <DialogDescription>
            Create an administrator-originated case for {passengerName}. The passenger will be able
            to view the public conversation, but never internal notes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={category} onValueChange={(value) => setCategory(value as SupportCategory)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUPPORT_CATEGORIES.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={(value) => setPriority(value as SupportPriority)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="admin-support-subject">Subject</Label>
            <Input
              id="admin-support-subject"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              maxLength={160}
              placeholder="Reason for opening this case"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="admin-support-description">Description</Label>
            <Textarea
              id="admin-support-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={5000}
              rows={6}
              placeholder="Record the issue, known context, and the next action required."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={creating}>
            Cancel
          </Button>
          <Button onClick={createTicket} disabled={creating}>
            {creating ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            Create case
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
