import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Car, CheckCircle2, Gauge, History } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  endVehicleShift,
  getShiftDashboard,
  startVehicleShift,
  type ShiftDashboard,
} from "@/lib/architecture-closeout";

export const Route = createFileRoute("/app/driver/vehicle-shift")({
  head: () => ({ meta: [{ title: "Vehicle Shift — Access Driver" }] }),
  component: VehicleShiftPage,
});

const CHECKS = [
  ["brakes", "Brakes respond correctly"],
  ["tyres", "Tyres appear safe and inflated"],
  ["lights", "Lights and indicators work"],
  ["wheelchairRestraints", "Wheelchair restraints are present and secure"],
  ["rampOrLift", "Ramp or lift operates safely"],
] as const;

function VehicleShiftPage() {
  const [data, setData] = useState<ShiftDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [vehicleId, setVehicleId] = useState("");
  const [odometer, setOdometer] = useState("");
  const [notes, setNotes] = useState("");
  const [handover, setHandover] = useState("");
  const [checks, setChecks] = useState<Record<string, boolean>>(
    Object.fromEntries(CHECKS.map(([key]) => [key, false])),
  );
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await getShiftDashboard();
      setData(next);
      if (next.vehicles[0]) setVehicleId((current) => current || next.vehicles[0].id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load shift");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const allSafe = CHECKS.every(([key]) => checks[key]);
  async function submit() {
    const km = Number(odometer);
    if (!Number.isFinite(km) || km < 0) {
      toast.error("Enter a valid odometer reading");
      return;
    }
    setSaving(true);
    try {
      if (data?.activeShift) {
        await endVehicleShift(data.activeShift.id, km, checks, notes, handover);
        toast.success("Vehicle shift ended");
      } else {
        if (!vehicleId) {
          toast.error("Select your assigned vehicle");
          return;
        }
        await startVehicleShift(vehicleId, km, checks, notes);
        toast.success("Vehicle shift started");
      }
      setOdometer("");
      setNotes("");
      setHandover("");
      setChecks(Object.fromEntries(CHECKS.map(([key]) => [key, false])));
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update shift");
    } finally {
      setSaving(false);
    }
  }
  if (loading)
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">Loading vehicle shift…</p>
    );
  const active = data?.activeShift;
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Vehicle Shift</h1>
        <p className="text-sm text-muted-foreground">
          Confirm the vehicle, complete safety checks and record mileage.
        </p>
      </header>
      {active ? (
        <section className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Active vehicle</p>
              <h2 className="font-semibold">
                {active.vehicle?.vehicle_name ?? "Assigned vehicle"}
              </h2>
              <p className="text-sm">
                Started {new Date(active.started_at).toLocaleString()} · {active.start_odometer_km}{" "}
                km
              </p>
            </div>
            <Badge>Active</Badge>
          </div>
        </section>
      ) : (
        <section className="rounded-2xl border bg-card p-4">
          <Label htmlFor="vehicle">Assigned vehicle</Label>
          <select
            id="vehicle"
            className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm"
            value={vehicleId}
            onChange={(e) => setVehicleId(e.target.value)}
          >
            <option value="">Select vehicle</option>
            {data?.vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.vehicle_name} · {v.license_plate}
              </option>
            ))}
          </select>
          {!data?.vehicles.length && (
            <p className="mt-2 text-sm text-destructive">
              No currently assigned active vehicle. Contact dispatch.
            </p>
          )}
        </section>
      )}
      <section className="rounded-2xl border bg-card p-4">
        <h2 className="flex items-center gap-2 font-semibold">
          <CheckCircle2 className="h-5 w-5" />
          Safety and condition checklist
        </h2>
        <div className="mt-4 space-y-3">
          {CHECKS.map(([key, label]) => (
            <Label key={key} className="flex items-start gap-3">
              <Checkbox
                className="mt-0.5"
                checked={checks[key]}
                onCheckedChange={(value) =>
                  setChecks((current) => ({ ...current, [key]: value === true }))
                }
              />
              <span>{label}</span>
            </Label>
          ))}
        </div>
      </section>
      <section className="rounded-2xl border bg-card p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="odometer">{active ? "Ending" : "Starting"} odometer (km)</Label>
            <div className="relative mt-2">
              <Gauge className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                id="odometer"
                className="pl-9"
                inputMode="decimal"
                value={odometer}
                onChange={(e) => setOdometer(e.target.value)}
                placeholder={active ? String(active.start_odometer_km) : "0"}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="notes">Condition notes or problems</Label>
            <Textarea
              id="notes"
              className="mt-2"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Record damage, warning lights or concerns"
            />
          </div>
          {active && (
            <div className="sm:col-span-2">
              <Label htmlFor="handover">Handover notes</Label>
              <Textarea
                id="handover"
                className="mt-2"
                value={handover}
                onChange={(e) => setHandover(e.target.value)}
                placeholder="Information for dispatch or the next driver"
              />
            </div>
          )}
        </div>
        <Button
          className="mt-4 w-full"
          size="lg"
          disabled={saving || !allSafe || (!active && !vehicleId)}
          onClick={() => void submit()}
        >
          <Car className="mr-2 h-4 w-4" />
          {saving ? "Saving…" : active ? "End vehicle shift" : "Start vehicle shift"}
        </Button>
        {!allSafe && (
          <p className="mt-2 text-center text-xs text-muted-foreground">
            All critical safety checks must pass.
          </p>
        )}
      </section>
      <section className="rounded-2xl border bg-card p-4">
        <h2 className="flex items-center gap-2 font-semibold">
          <History className="h-5 w-5" />
          Recent shifts
        </h2>
        <div className="mt-3 space-y-2">
          {data?.history.map((shift) => (
            <div
              key={shift.id}
              className="flex items-center justify-between rounded-lg bg-muted/50 p-3 text-sm"
            >
              <span>
                {new Date(shift.started_at).toLocaleDateString()} · {shift.start_odometer_km}
                {shift.end_odometer_km != null ? `–${shift.end_odometer_km}` : ""} km
              </span>
              <Badge variant="outline">{shift.status}</Badge>
            </div>
          ))}
          {!data?.history.length && (
            <p className="text-sm text-muted-foreground">No vehicle shifts recorded yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}
