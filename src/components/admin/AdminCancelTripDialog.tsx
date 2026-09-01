import { useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CANCELLATION_CATEGORIES,
  categoryCharges,
  computeCancellationCharge,
  lockedRatesFromSnapshot,
  type CancellationCategory,
} from "@/lib/cancellation";
import { listRideRefunds, processPayfastRefund } from "@/lib/phase7-commercial";
import { formatZAR } from "@/lib/pricing";

type Props = {
  rideId: string;
  /** The trip's stored estimate snapshot — the locked pricing for this trip. */
  estimateSnapshot: unknown;
  /** Distance already travelled by the driver, when known. */
  actualDistanceKm?: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCancelled?: () => void;
};

export function AdminCancelTripDialog({
  rideId,
  estimateSnapshot,
  actualDistanceKm,
  open,
  onOpenChange,
  onCancelled,
}: Props) {
  const [category, setCategory] = useState<CancellationCategory | "">("");
  const [reason, setReason] = useState("");
  const [distance, setDistance] = useState<string>(
    actualDistanceKm != null ? String(actualDistanceKm) : "",
  );
  const [busy, setBusy] = useState(false);

  const rates = useMemo(() => lockedRatesFromSnapshot(estimateSnapshot), [estimateSnapshot]);
  const preview = category
    ? computeCancellationCharge(category, Number(distance) || 0, rates)
    : null;

  async function processAutomaticRefunds() {
    try {
      const refunds = await listRideRefunds(rideId);
      const queued = refunds.filter(
        (refund) => refund.automatic && ["requested", "failed"].includes(refund.status),
      );
      for (const refund of queued) {
        await processPayfastRefund(refund.id);
      }
      if (queued.length) toast.success("Unused prepaid balance sent for refund processing");
    } catch (error) {
      console.error("Automatic cancellation refund processing did not complete", error);
      toast.warning("Trip cancelled. Any queued refund remains available in Commercial Readiness.");
    }
  }

  async function submit() {
    if (!category || !reason.trim()) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc("admin_cancel_ride", {
        p_ride_id: rideId,
        p_category: category,
        p_reason: reason.trim(),
        p_actual_distance_km: distance === "" ? undefined : Number(distance),
      });
      if (error) throw new Error(error.message);
      toast.success("Trip cancelled");
      await processAutomaticRefunds();
      onOpenChange(false);
      onCancelled?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not cancel this trip");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancel this trip</DialogTitle>
          <DialogDescription>
            A category and reason are required. The charge is calculated on the trip&apos;s locked
            pricing. Any prepaid fare is applied before a refund or additional balance is created.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Category</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as CancellationCategory)}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="Select a cancellation category" />
              </SelectTrigger>
              <SelectContent>
                {CANCELLATION_CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                    {c.charges ? "" : " · R0"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {category && categoryCharges(category) && (
            <div className="space-y-1">
              <Label className="text-xs" htmlFor="cancel-distance">
                Distance already travelled (km)
              </Label>
              <input
                id="cancel-distance"
                inputMode="decimal"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={distance}
                onChange={(e) => setDistance(e.target.value)}
                placeholder="0.00"
              />
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-xs" htmlFor="cancel-reason">
              Reason
            </Label>
            <Textarea
              id="cancel-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain why this trip is being cancelled"
              rows={3}
            />
          </div>

          {preview && (
            <div className="rounded-lg border bg-secondary/40 p-3 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Distance × locked rate</span>
                <span>
                  {preview.actualDistanceKm.toFixed(2)} km × {formatZAR(preview.perKmRate)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Locked service fee</span>
                <span>{formatZAR(preview.serviceFee)}</span>
              </div>
              <div className="mt-1 flex justify-between border-t pt-1 text-sm font-semibold">
                <span>Cancellation charge</span>
                <span>{formatZAR(preview.total)}</span>
              </div>
              <p className="mt-2 text-muted-foreground">
                If this trip was prepaid, Access settles this amount against the prepaid balance
                before creating any refund or additional payment.
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Keep trip
          </Button>
          <Button
            variant="destructive"
            onClick={submit}
            disabled={busy || !category || reason.trim().length < 3}
          >
            {busy ? "Cancelling & settling…" : "Confirm cancellation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
