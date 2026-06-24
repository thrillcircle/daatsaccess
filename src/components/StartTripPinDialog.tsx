import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import {
  verifyStartTripPin,
  type VerifyPinResult,
} from "@/lib/ride-pin.functions";
import type { Database } from "@/integrations/supabase/types";

type Ride = Database["public"]["Tables"]["rides"]["Row"];

export function StartTripPinDialog({
  ride,
  open,
  onOpenChange,
  onStarted,
}: {
  ride: Ride;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onStarted: () => void;
}) {
  const verify = useServerFn(verifyStartTripPin);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [locked, setLocked] = useState<number | null>(null);

  async function submit() {
    if (pin.length !== 4 || busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const r = (await verify({
        data: { rideId: ride.id, pin },
      })) as VerifyPinResult;
      if (r.status === "started") {
        toast.success("PIN verified — trip started");
        onStarted();
        onOpenChange(false);
        setPin("");
      } else if (r.status === "wrong") {
        setFeedback(
          `Incorrect PIN. ${r.remaining} attempt${r.remaining === 1 ? "" : "s"} left before lock.`,
        );
        setPin("");
      } else if (r.status === "locked") {
        setLocked(r.lock_seconds);
        setFeedback(
          `Too many failed attempts. Try again in ${Math.ceil(r.lock_seconds / 60)} min, or ask support to reset the PIN.`,
        );
      } else {
        setFeedback("Cannot verify right now. Make sure you have marked arrived.");
      }
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : "Verification failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" /> Enter passenger PIN
          </DialogTitle>
          <DialogDescription>
            Ask the passenger for the 4-digit PIN shown in their app, then enter
            it here to start the trip.
          </DialogDescription>
        </DialogHeader>

        <div className="flex justify-center py-4">
          <InputOTP
            maxLength={4}
            value={pin}
            onChange={setPin}
            disabled={busy || locked !== null}
            inputMode="numeric"
            pattern="^\d*$"
          >
            <InputOTPGroup>
              <InputOTPSlot index={0} />
              <InputOTPSlot index={1} />
              <InputOTPSlot index={2} />
              <InputOTPSlot index={3} />
            </InputOTPGroup>
          </InputOTP>
        </div>

        {feedback && (
          <p
            className={
              "text-center text-sm " +
              (locked !== null ? "text-destructive" : "text-muted-foreground")
            }
          >
            {feedback}
          </p>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={busy || pin.length !== 4 || locked !== null}
          >
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Start trip
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
