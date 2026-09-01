import type { Database } from "@/integrations/supabase/types";

type Status = Database["public"]["Enums"]["ride_status"] | "payment_pending";

const LABEL: Record<Status, string> = {
  payment_pending: "Confirming payment",
  requested: "Requested",
  accepted: "Accepted",
  driver_arriving: "Driver arriving",
  arrived: "Driver arrived",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

const CLASS: Record<Status, string> = {
  payment_pending: "bg-warning/15 text-warning-foreground border-warning/30",
  requested: "bg-warning/15 text-warning-foreground border-warning/30",
  accepted: "bg-primary/10 text-primary border-primary/30",
  driver_arriving: "bg-primary/10 text-primary border-primary/30",
  arrived: "bg-primary/15 text-primary border-primary/30",
  in_progress: "bg-primary/15 text-primary border-primary/30",
  completed: "bg-success/15 text-success border-success/30",
  cancelled: "bg-destructive/10 text-destructive border-destructive/30",
};

export function RideStatusBadge({ status }: { status: Status }) {
  return (
    <span
      className={
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium " +
        CLASS[status]
      }
    >
      {LABEL[status]}
    </span>
  );
}
