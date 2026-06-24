import { useEffect, useState } from "react";
import { Check, Copy, KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

/**
 * Shows the 4-digit trip-start PIN to the passenger. The PIN is read directly
 * from `public.ride_pins`; RLS scopes the row to the matched passenger and
 * admins, so unrelated users (including the assigned driver) get nothing.
 *
 * The PIN is never persisted to local storage; it lives only in component
 * state for the duration of this mount.
 */
export function PassengerStartPin({
  rideId,
  status,
}: {
  rideId: string;
  status: string;
}) {
  const [pin, setPin] = useState<string | null | undefined>(undefined);
  const [copied, setCopied] = useState(false);

  // Only relevant before the trip is in progress.
  const visiblePhase = ["accepted", "driver_arriving", "arrived"].includes(
    status,
  );

  useEffect(() => {
    if (!visiblePhase) return;
    let cancelled = false;
    setPin(undefined);
    supabase
      .from("ride_pins")
      .select("pin")
      .eq("ride_id", rideId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) setPin(null);
        else setPin(data.pin);
      });
    return () => {
      cancelled = true;
    };
  }, [rideId, visiblePhase]);

  async function copyPin() {
    if (!pin) return;
    try {
      await navigator.clipboard.writeText(pin);
      setCopied(true);
      toast.success("PIN copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy PIN — read it out instead");
    }
  }

  if (!visiblePhase) return null;

  return (
    <div
      className="mt-4 rounded-xl border border-primary/30 bg-primary/5 p-4"
      aria-label="Trip start PIN"
    >
      <div className="flex items-center gap-2 text-sm font-medium text-primary">
        <KeyRound className="h-4 w-4" />
        Your trip start PIN
      </div>
      <div className="mt-2 flex items-center justify-between gap-3">
        <div
          className="font-mono text-4xl font-bold tracking-[0.4em] tabular-nums"
          aria-live="polite"
        >
          {pin === undefined ? (
            <span className="inline-flex items-center gap-2 text-base font-normal text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </span>
          ) : pin ? (
            pin
          ) : (
            <span className="text-base font-normal text-muted-foreground">
              PIN not available
            </span>
          )}
        </div>
        {pin && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={copyPin}
            aria-label="Copy PIN to clipboard"
          >
            {copied ? (
              <>
                <Check className="mr-1 h-4 w-4" /> Copied
              </>
            ) : (
              <>
                <Copy className="mr-1 h-4 w-4" /> Copy PIN
              </>
            )}
          </Button>
        )}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Give this PIN to your driver only after you have checked their vehicle
        and number plate. The driver must enter it before the trip can start.
      </p>
    </div>
  );
}

