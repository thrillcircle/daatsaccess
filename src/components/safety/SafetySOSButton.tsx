import { useRef, useState } from "react";
import { AlertTriangle, Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  reportSafetyIncident,
  type SafetyCategory,
  type SafetyReporterRole,
} from "@/lib/phase7-commercial";

const HOLD_MS = 1200;

const passengerCategories: { value: SafetyCategory; label: string }[] = [
  { value: "medical_emergency", label: "Medical emergency" },
  { value: "driver_concern", label: "Driver concern" },
  { value: "vehicle_problem", label: "Vehicle problem" },
  { value: "accident", label: "Accident" },
  { value: "unsafe_situation", label: "Unsafe situation" },
  { value: "other_emergency", label: "Other emergency" },
];

const driverCategories: { value: SafetyCategory; label: string }[] = [
  { value: "passenger_medical_emergency", label: "Passenger medical emergency" },
  { value: "accident", label: "Accident" },
  { value: "vehicle_breakdown", label: "Vehicle breakdown" },
  { value: "safety_security", label: "Safety or security concern" },
  { value: "unable_to_continue", label: "Unable to continue trip" },
  { value: "other_emergency", label: "Other emergency" },
];

type Props = {
  rideId: string;
  role: SafetyReporterRole;
};

export function SafetySOSButton({ rideId, role }: Props) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<SafetyCategory | "">("");
  const [description, setDescription] = useState("");
  const [holding, setHolding] = useState(false);
  const [sending, setSending] = useState(false);
  const timerRef = useRef<number | null>(null);

  const categories = role === "driver" ? driverCategories : passengerCategories;

  function stopHold() {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setHolding(false);
  }

  async function sendSOS() {
    stopHold();
    if (!category || sending) return;
    setSending(true);
    try {
      let position: GeolocationPosition | null = null;
      if ("geolocation" in navigator) {
        position = await new Promise<GeolocationPosition | null>((resolve) => {
          navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), {
            enableHighAccuracy: true,
            timeout: 5000,
            maximumAge: 30_000,
          });
        });
      }
      const result = await reportSafetyIncident({
        rideId,
        category,
        latitude: position?.coords.latitude ?? null,
        longitude: position?.coords.longitude ?? null,
        accuracyM: position?.coords.accuracy ?? null,
        description: description.trim() || null,
      });
      toast.success(`SOS sent · ${result.reference}`);
      setOpen(false);
      setCategory("");
      setDescription("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not send SOS");
    } finally {
      setSending(false);
    }
  }

  function startHold() {
    if (!category || sending || timerRef.current != null) return;
    setHolding(true);
    timerRef.current = window.setTimeout(() => void sendSOS(), HOLD_MS);
  }

  return (
    <>
      <Button
        type="button"
        variant="destructive"
        className="mt-3 w-full"
        onClick={() => setOpen(true)}
      >
        <ShieldAlert className="mr-2 h-4 w-4" /> Safety / SOS
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          stopHold();
          setOpen(next);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" /> Safety / SOS
            </DialogTitle>
            <DialogDescription>
              Choose the emergency type, then press and hold the red button to alert Access
              Operations.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor={`sos-category-${role}`}>Emergency type</Label>
              <select
                id={`sos-category-${role}`}
                value={category}
                onChange={(event) => setCategory(event.target.value as SafetyCategory)}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              >
                <option value="">Select an emergency</option>
                {categories.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`sos-description-${role}`}>Details (optional)</Label>
              <Textarea
                id={`sos-description-${role}`}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
                maxLength={1000}
                placeholder="Add information that may help Operations respond."
              />
            </div>

            <Button
              type="button"
              variant="destructive"
              size="lg"
              className={`w-full select-none ${holding ? "animate-pulse" : ""}`}
              disabled={!category || sending}
              onPointerDown={startHold}
              onPointerUp={stopHold}
              onPointerLeave={stopHold}
              onPointerCancel={stopHold}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  startHold();
                }
              }}
              onKeyUp={(event) => {
                if (event.key === "Enter" || event.key === " ") stopHold();
              }}
            >
              {sending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ShieldAlert className="mr-2 h-4 w-4" />
              )}
              {sending ? "Sending SOS…" : holding ? "Keep holding…" : "Press and hold to send SOS"}
            </Button>
            <p className="text-center text-[11px] text-muted-foreground">
              Releasing early cancels the SOS. Your current location is included when available.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
