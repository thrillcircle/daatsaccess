import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import type { ExtendedJourneyMetadata } from "@/lib/booking-types";
import { Calculator, UserPlus } from "lucide-react";
import { toast } from "sonner";

export type EJBooking = {
  id: string;
  booked_by_user_id: string;
  booking_reference: string;
  start_at: string | null;
  end_at: string | null;
  status: string;
  quoted_total: number | null;
  deposit_amount: number | null;
  deposit_status: "none" | "pending" | "paid" | "refunded" | "waived";
  metadata: unknown;
};

type DriverProfile = { user_id: string; full_name: string | null };

function isMetadata(value: unknown): value is Partial<ExtendedJourneyMetadata> {
  return !!value && typeof value === "object";
}

export function ExtendedJourneyAdminPanel({
  booking,
  drivers,
  primaryDriverId,
  onChanged,
  actorId,
}: {
  booking: EJBooking;
  drivers: DriverProfile[];
  primaryDriverId: string | null;
  onChanged: () => void;
  actorId: string;
}) {
  const [reliefId, setReliefId] = useState("");
  const [reliefExisting, setReliefExisting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const meta = isMetadata(booking.metadata) ? booking.metadata : {};

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from("booking_driver_assignments")
        .select("driver_user_id,assignment_role")
        .eq("booking_id", booking.id)
        .eq("assignment_role", "relief")
        .maybeSingle();
      if (data) {
        setReliefExisting(data.driver_user_id);
        setReliefId(data.driver_user_id);
      }
    })();
  }, [booking.id]);

  const logEvent = async (eventType: string, payload: Record<string, unknown>) => {
    await supabase.from("service_booking_events").insert({
      booking_id: booking.id,
      actor_user_id: actorId,
      event_type: eventType,
      payload: payload as never,
    });
  };

  const saveRelief = async () => {
    if (!reliefId) return toast.error("Pick a relief driver");
    if (reliefId === primaryDriverId) {
      return toast.error("Relief must differ from the primary driver");
    }
    setBusy(true);
    try {
      await supabase
        .from("booking_driver_assignments")
        .delete()
        .eq("booking_id", booking.id)
        .eq("assignment_role", "relief");
      const { error } = await supabase.from("booking_driver_assignments").insert({
        booking_id: booking.id,
        driver_user_id: reliefId,
        status: "confirmed",
        assignment_role: "relief",
      });
      if (error) throw error;
      setReliefExisting(reliefId);
      await logEvent("relief_driver_assigned", { driver_user_id: reliefId });
      toast.success("Relief driver assigned");
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Relief assignment failed");
    } finally {
      setBusy(false);
    }
  };

  const clearRelief = async () => {
    setBusy(true);
    try {
      await supabase
        .from("booking_driver_assignments")
        .delete()
        .eq("booking_id", booking.id)
        .eq("assignment_role", "relief");
      setReliefExisting(null);
      setReliefId("");
      await logEvent("relief_driver_cleared", {});
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <section className="rounded-lg border p-3 text-sm">
        <h4 className="font-semibold">Extended Journey details</h4>
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
          <div className="col-span-2">
            <dt className="text-muted-foreground">Dates</dt>
            <dd>
              {booking.start_at
                ? new Date(booking.start_at).toLocaleDateString("en-ZA", {
                    dateStyle: "medium",
                  })
                : "—"}
              {" → "}
              {booking.end_at
                ? new Date(booking.end_at).toLocaleDateString("en-ZA", {
                    dateStyle: "medium",
                  })
                : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Group size</dt>
            <dd>{meta.group_size ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Wheelchairs</dt>
            <dd>{meta.wheelchair_count ?? 0}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Other equipment</dt>
            <dd>{meta.mobility_equipment_count ?? 0}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-muted-foreground">Starting location</dt>
            <dd>{meta.starting_location || "—"}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-muted-foreground">Main destination</dt>
            <dd>{meta.main_destination || "—"}</dd>
          </div>
          {meta.planned_destinations?.length ? (
            <div className="col-span-2">
              <dt className="text-muted-foreground">Planned stops</dt>
              <dd>{meta.planned_destinations.join(", ")}</dd>
            </div>
          ) : null}
          {meta.luggage_requirements ? (
            <div className="col-span-2">
              <dt className="text-muted-foreground">Luggage</dt>
              <dd>{meta.luggage_requirements}</dd>
            </div>
          ) : null}
          {meta.accommodation_requirements ? (
            <div className="col-span-2">
              <dt className="text-muted-foreground">Accommodation</dt>
              <dd>{meta.accommodation_requirements}</dd>
            </div>
          ) : null}
          {meta.overnight_support_requirements ? (
            <div className="col-span-2">
              <dt className="text-muted-foreground">Overnight support</dt>
              <dd>{meta.overnight_support_requirements}</dd>
            </div>
          ) : null}
          {meta.general_support_instructions ? (
            <div className="col-span-2">
              <dt className="text-muted-foreground">General support</dt>
              <dd>{meta.general_support_instructions}</dd>
            </div>
          ) : null}
          {meta.emergency_contact?.name ? (
            <div className="col-span-2">
              <dt className="text-muted-foreground">Emergency contact</dt>
              <dd>
                {meta.emergency_contact.name}
                {meta.emergency_contact.relationship
                  ? ` (${meta.emergency_contact.relationship})`
                  : ""}
                {" · "}
                {meta.emergency_contact.phone}
              </dd>
            </div>
          ) : null}
          {meta.additional_travellers?.length ? (
            <div className="col-span-2">
              <dt className="text-muted-foreground">Additional travellers</dt>
              <dd>{meta.additional_travellers.map((traveller) => traveller.full_name).join(", ")}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section className="rounded-lg border border-primary/25 bg-primary/5 p-3">
        <h4 className="flex items-center gap-1 text-sm font-semibold">
          <Calculator className="h-3.5 w-3.5" />
          Calculated quote workspace
        </h4>
        <p className="mt-1 text-xs text-muted-foreground">
          Quote totals, adjustments and deposit terms are controlled through protected pricing
          operations. Direct booking-level financial edits are disabled.
        </p>
        <Button asChild size="sm" className="mt-3">
          <Link to="/app/admin/bookings/$bookingId/quote" params={{ bookingId: booking.id }}>
            Open quote workspace
          </Link>
        </Button>
      </section>

      <section className="rounded-lg border p-3">
        <h4 className="flex items-center gap-1 text-sm font-semibold">
          <UserPlus className="h-3.5 w-3.5" />
          Relief driver (optional)
        </h4>
        <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
          <Select value={reliefId} onValueChange={setReliefId}>
            <SelectTrigger>
              <SelectValue placeholder="Assign relief driver" />
            </SelectTrigger>
            <SelectContent>
              {drivers
                .filter((driver) => driver.user_id !== primaryDriverId)
                .map((driver) => (
                  <SelectItem key={driver.user_id} value={driver.user_id}>
                    {driver.full_name ?? driver.user_id.slice(0, 8)}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <Button size="sm" disabled={busy || !reliefId} onClick={() => void saveRelief()}>
            Save relief
          </Button>
          {reliefExisting ? (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void clearRelief()}>
              Clear
            </Button>
          ) : null}
        </div>
        {reliefExisting ? (
          <Badge variant="secondary" className="mt-1 text-[10px]">
            Relief assigned
          </Badge>
        ) : null}
      </section>
    </div>
  );
}
