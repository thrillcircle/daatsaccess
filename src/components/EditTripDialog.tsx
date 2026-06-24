import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AddressAutocomplete, type AddressPick } from "@/components/AddressAutocomplete";
import { computeRoute } from "@/lib/maps.functions";
import { updateRideTrip } from "@/lib/ride-edit.functions";
import { estimatePrice, formatZAR } from "@/lib/pricing";
import type { Database } from "@/integrations/supabase/types";
import { ArrowRight, AlertCircle } from "lucide-react";

type Ride = Database["public"]["Tables"]["rides"]["Row"];

type Props = {
  ride: Ride;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (ride: Ride) => void;
};

const PICKUP_EDITABLE = new Set(["requested", "accepted", "driver_arriving"]);

function rideToPick(
  ride: Ride,
  kind: "pickup" | "destination",
): AddressPick {
  return kind === "pickup"
    ? {
        address: ride.pickup_address,
        placeId: ride.pickup_place_id,
        lat: ride.pickup_lat,
        lng: ride.pickup_lng,
      }
    : {
        address: ride.destination_address,
        placeId: ride.destination_place_id,
        lat: ride.destination_lat,
        lng: ride.destination_lng,
      };
}

function pickEquals(a: AddressPick, b: AddressPick) {
  return (
    a.lat === b.lat &&
    a.lng === b.lng &&
    a.address.trim() === b.address.trim() &&
    (a.placeId ?? null) === (b.placeId ?? null)
  );
}

export function EditTripDialog({ ride, open, onOpenChange, onSaved }: Props) {
  const route = useServerFn(computeRoute);
  const save = useServerFn(updateRideTrip);

  const canEditPickup = PICKUP_EDITABLE.has(ride.status);
  const originalPickup = rideToPick(ride, "pickup");
  const originalDest = rideToPick(ride, "destination");

  const [pickup, setPickup] = useState<AddressPick | null>(originalPickup);
  const [dest, setDest] = useState<AddressPick | null>(originalDest);
  const [distanceKm, setDistanceKm] = useState<number | null>(
    Number(ride.distance_km),
  );
  const [durationMin, setDurationMin] = useState<number | null>(
    ride.estimated_duration_seconds != null
      ? Math.round(ride.estimated_duration_seconds / 60)
      : null,
  );
  const [estimating, setEstimating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);

  // Reset when the dialog opens for a fresh ride.
  useEffect(() => {
    if (!open) return;
    setPickup(originalPickup);
    setDest(originalDest);
    setDistanceKm(Number(ride.distance_km));
    setDurationMin(
      ride.estimated_duration_seconds != null
        ? Math.round(ride.estimated_duration_seconds / 60)
        : null,
    );
    setRouteError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ride.id]);

  const pickupChanged = !!pickup && !pickEquals(pickup, originalPickup);
  const destChanged = !!dest && !pickEquals(dest, originalDest);
  const dirty = pickupChanged || destChanged;

  // Recompute the route preview whenever either endpoint changes.
  useEffect(() => {
    if (!pickup || !dest || !dirty) return;
    let cancelled = false;
    setEstimating(true);
    setRouteError(null);
    route({
      data: {
        originLat: pickup.lat,
        originLng: pickup.lng,
        destLat: dest.lat,
        destLng: dest.lng,
      },
    })
      .then((r) => {
        if (cancelled) return;
        setDistanceKm(r.distanceKm);
        setDurationMin(r.durationMin);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setRouteError(e instanceof Error ? e.message : "Could not compute route");
        setDistanceKm(null);
      })
      .finally(() => !cancelled && setEstimating(false));
    return () => {
      cancelled = true;
    };
  }, [pickup, dest, dirty, route]);

  const newPrice = distanceKm != null ? estimatePrice(distanceKm) : null;
  const originalPrice = Number(ride.estimated_price);
  const priceDelta = newPrice != null ? newPrice - originalPrice : null;
  const canSave = dirty && !estimating && !saving && newPrice != null && !routeError;

  async function onConfirm() {
    if (!canSave || !pickup || !dest || distanceKm == null) return;
    setSaving(true);
    try {
      const res = await save({
        data: {
          rideId: ride.id,
          pickup: pickupChanged ? pickup : null,
          destination: destChanged ? dest : null,
          distanceKm,
          durationMin,
        },
      });
      toast.success("Trip updated — your driver has been notified");
      onSaved?.(res.ride as Ride);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update trip");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit trip</DialogTitle>
          <DialogDescription>
            {canEditPickup
              ? "Update your pickup or destination. Your driver will see the change immediately."
              : "Your driver is already at pickup, so only the destination can be changed."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {canEditPickup ? (
            <AddressAutocomplete
              id="edit-pickup"
              label="Pickup"
              value={pickup}
              onChange={setPickup}
              bias={pickup}
            />
          ) : (
            <div className="rounded-lg border bg-muted/40 p-3 text-sm">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Pickup (locked)
              </p>
              <p className="truncate">{originalPickup.address}</p>
            </div>
          )}
          <AddressAutocomplete
            id="edit-dest"
            label="Destination"
            value={dest}
            onChange={setDest}
            bias={pickup ?? dest}
          />
        </div>

        {dirty && (
          <div className="space-y-2 rounded-xl border bg-secondary/40 p-3 text-sm">
            {pickupChanged && (
              <DiffRow
                label="Pickup"
                from={originalPickup.address}
                to={pickup!.address}
              />
            )}
            {destChanged && (
              <DiffRow
                label="Destination"
                from={originalDest.address}
                to={dest!.address}
              />
            )}
            <div className="border-t pt-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Distance · time</span>
                <span>
                  {estimating
                    ? "Estimating…"
                    : distanceKm != null
                      ? `${distanceKm.toFixed(2)} km${durationMin != null ? ` · ~${durationMin} min` : ""}`
                      : "—"}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-muted-foreground">New fare</span>
                <span className="text-base font-semibold">
                  {newPrice != null ? formatZAR(newPrice) : "—"}
                </span>
              </div>
              {priceDelta != null && Math.abs(priceDelta) >= 0.01 && (
                <p
                  className={
                    "text-xs " +
                    (priceDelta > 0 ? "text-destructive" : "text-emerald-600")
                  }
                >
                  {priceDelta > 0 ? "+" : "−"}
                  {formatZAR(Math.abs(priceDelta))} vs original{" "}
                  {formatZAR(originalPrice)}
                </p>
              )}
            </div>
          </div>
        )}

        {routeError && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{routeError}</span>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={!canSave}>
            {saving ? "Saving…" : "Confirm changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DiffRow({ label, from, to }: { label: string; from: string; to: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="flex items-start gap-2 text-sm">
        <span className="min-w-0 flex-1 truncate text-muted-foreground line-through">
          {from}
        </span>
        <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium">{to}</span>
      </div>
    </div>
  );
}
