import { useCallback, useEffect, useState } from "react";
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
import { parseRideStops } from "@/lib/driver-ride-projection";
import { formatZAR } from "@/lib/pricing";
import type { Database } from "@/integrations/supabase/types";
import { ArrowRight, AlertCircle, ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";

type Ride = Database["public"]["Tables"]["rides"]["Row"];

type Props = {
  ride: Ride;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (ride: Ride) => void;
};

const PICKUP_EDITABLE = new Set(["requested", "accepted", "driver_arriving"]);
export const MAX_TRIP_STOPS = 5;

function rideToPick(ride: Ride, kind: "pickup" | "destination"): AddressPick {
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

function rideToStops(ride: Ride): AddressPick[] {
  return parseRideStops(ride.route_stops).map((stop) => ({
    address: stop.address,
    placeId: stop.placeId,
    lat: stop.lat,
    lng: stop.lng,
  }));
}

function pickEquals(a: AddressPick, b: AddressPick) {
  return (
    a.lat === b.lat &&
    a.lng === b.lng &&
    a.address.trim() === b.address.trim() &&
    (a.placeId ?? null) === (b.placeId ?? null)
  );
}

function stopsEqual(a: AddressPick[], b: AddressPick[]) {
  return a.length === b.length && a.every((stop, index) => pickEquals(stop, b[index]));
}

function stopsKey(stops: AddressPick[]) {
  return stops.map((s) => `${s.lat.toFixed(6)},${s.lng.toFixed(6)}`).join("|");
}

export function EditTripDialog({ ride, open, onOpenChange, onSaved }: Props) {
  const route = useServerFn(computeRoute);
  const save = useServerFn(updateRideTrip);

  const canEditPickup = PICKUP_EDITABLE.has(ride.status);
  const originalPickup = rideToPick(ride, "pickup");
  const originalDest = rideToPick(ride, "destination");
  const originalStops = rideToStops(ride);

  const [pickup, setPickup] = useState<AddressPick | null>(originalPickup);
  const [dest, setDest] = useState<AddressPick | null>(originalDest);
  const [stops, setStops] = useState<(AddressPick | null)[]>(originalStops);
  const [distanceKm, setDistanceKm] = useState<number | null>(Number(ride.distance_km));
  const [durationMin, setDurationMin] = useState<number | null>(
    ride.estimated_duration_seconds != null
      ? Math.round(ride.estimated_duration_seconds / 60)
      : null,
  );
  const [estimating, setEstimating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPickup(rideToPick(ride, "pickup"));
    setDest(rideToPick(ride, "destination"));
    setStops(rideToStops(ride));
    setDistanceKm(Number(ride.distance_km));
    setDurationMin(
      ride.estimated_duration_seconds != null
        ? Math.round(ride.estimated_duration_seconds / 60)
        : null,
    );
    setRouteError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ride.id]);

  const filledStops = stops.filter((s): s is AddressPick => s !== null);
  const allStopsFilled = stops.every((s) => s !== null);

  const pickupChanged = !!pickup && !pickEquals(pickup, originalPickup);
  const destChanged = !!dest && !pickEquals(dest, originalDest);
  const stopsChanged = !stopsEqual(filledStops, originalStops);
  const dirty = pickupChanged || destChanged || stopsChanged;

  const stopsSignature = stopsKey(filledStops);
  useEffect(() => {
    if (!pickup || !dest || !dirty || !allStopsFilled) return;
    let cancelled = false;
    setEstimating(true);
    setRouteError(null);
    route({
      data: {
        originLat: pickup.lat,
        originLng: pickup.lng,
        destLat: dest.lat,
        destLng: dest.lng,
        waypoints: filledStops.map((s) => ({ lat: s.lat, lng: s.lng })),
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickup, dest, stopsSignature, allStopsFilled, dirty]);

  const originalPrice = Number(ride.estimated_price);
  const canSave = dirty && !estimating && !saving && distanceKm != null && !routeError;

  const setStopAt = useCallback((index: number, value: AddressPick | null) => {
    setStops((prev) => prev.map((stop, i) => (i === index ? value : stop)));
  }, []);

  const moveStop = useCallback((index: number, direction: -1 | 1) => {
    setStops((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }, []);

  async function onConfirm() {
    if (!canSave || !pickup || !dest || distanceKm == null) return;
    setSaving(true);
    try {
      const res = await save({
        data: {
          rideId: ride.id,
          pickup: pickupChanged ? pickup : null,
          destination: destChanged ? dest : null,
          stops: stopsChanged
            ? filledStops.map((s) => ({
                address: s.address,
                placeId: s.placeId ?? null,
                lat: s.lat,
                lng: s.lng,
              }))
            : null,
          distanceKm,
          durationMin,
        },
      });
      const result = res as unknown as {
        ride: Ride;
        requires_payment?: boolean;
        amount_due?: number | string;
      };

      if (result.requires_payment) {
        toast.success(
          `Trip changes prepared. Opening PayFast for ${formatZAR(Number(result.amount_due ?? 0))}.`,
        );
        // The global payment boundary watches the staged edit and opens PayFast
        // automatically. The current ride remains unchanged until trusted ITN.
        onOpenChange(false);
        return;
      }

      toast.success("Trip updated — your driver has been notified");
      onSaved?.(result.ride);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update trip");
    } finally {
      setSaving(false);
    }
  }

  const currentSnapshotTotal = (() => {
    const estimate = (ride.estimate_snapshot ?? null) as { total?: number } | null;
    return estimate?.total ?? null;
  })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit trip</DialogTitle>
          <DialogDescription>
            {canEditPickup
              ? "Update your pickup, stops or destination. If the fare increases, PayFast opens automatically and the change is applied only after payment."
              : "Your driver is already at pickup, so only stops and destination can be changed. Any additional fare must be paid before the change is applied."}
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

          {stops.map((stop, index) => (
            <div key={`stop-${index}`} className="space-y-1">
              <AddressAutocomplete
                id={`edit-stop-${index}`}
                label={`Stop ${index + 1}`}
                value={stop}
                onChange={(value) => setStopAt(index, value)}
                bias={pickup ?? dest}
              />
              <div className="flex justify-end gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2"
                  aria-label={`Move stop ${index + 1} up`}
                  disabled={index === 0}
                  onClick={() => moveStop(index, -1)}
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2"
                  aria-label={`Move stop ${index + 1} down`}
                  disabled={index === stops.length - 1}
                  onClick={() => moveStop(index, 1)}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-destructive"
                  aria-label={`Remove stop ${index + 1}`}
                  onClick={() => setStops((prev) => prev.filter((_, i) => i !== index))}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full"
            disabled={stops.length >= MAX_TRIP_STOPS}
            onClick={() => setStops((prev) => [...prev, null])}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            {stops.length >= MAX_TRIP_STOPS
              ? `Maximum ${MAX_TRIP_STOPS} stops`
              : `Add a stop (${stops.length}/${MAX_TRIP_STOPS})`}
          </Button>

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
              <DiffRow label="Pickup" from={originalPickup.address} to={pickup!.address} />
            )}
            {stopsChanged && (
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Stops</p>
                {filledStops.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No stops</p>
                ) : (
                  <ol className="list-decimal space-y-0.5 pl-4 text-sm">
                    {filledStops.map((stop, index) => (
                      <li key={`diff-stop-${index}`} className="truncate">
                        {stop.address}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}
            {destChanged && (
              <DiffRow label="Destination" from={originalDest.address} to={dest!.address} />
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
                <span className="text-muted-foreground">Current paid fare</span>
                <span className="text-base font-semibold">
                  {formatZAR(currentSnapshotTotal ?? originalPrice)}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Access recalculates the edited route on your trip&apos;s locked pricing. Any
                additional fare is opened automatically in PayFast before the edit is accepted.
              </p>
            </div>
          </div>
        )}

        {!allStopsFilled && (
          <p className="text-xs text-muted-foreground">Choose an address for every stop.</p>
        )}

        {routeError && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{routeError}</span>
          </div>
        )}

        <DialogFooter className="flex-row justify-end gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={!canSave || !allStopsFilled}>
            {saving ? "Preparing changes…" : "Confirm changes"}
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
        <span className="min-w-0 flex-1 truncate text-muted-foreground line-through">{from}</span>
        <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium">{to}</span>
      </div>
    </div>
  );
}
