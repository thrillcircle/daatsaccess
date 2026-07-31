import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import type { DriverProfile } from "@/components/driver/driver-utils";

export function DriverOnboarding({
  userId,
  onCreated,
}: {
  userId: string;
  onCreated: (p: DriverProfile) => void;
}) {
  const [vehicleType, setVehicleType] = useState("Sedan");
  const [vehicleModel, setVehicleModel] = useState("");
  const [licensePlate, setLicensePlate] = useState("");
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const { data, error } = await supabase
      .from("driver_profiles")
      .insert({
        user_id: userId,
        vehicle_type: vehicleType,
        vehicle_model: vehicleModel,
        license_plate: licensePlate,
        is_available: false,
      })
      .select()
      .single();
    setSaving(false);
    if (error) toast.error(error.message);
    else if (data) {
      onCreated(data);
      toast.success("Driver profile created");
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border bg-card p-4">
      <div>
        <h2 className="text-lg font-semibold">Driver setup</h2>
        <p className="text-sm text-muted-foreground">Tell us about your vehicle.</p>
      </div>
      <div className="space-y-1.5">
        <Label>Vehicle type</Label>
        <Input value={vehicleType} onChange={(e) => setVehicleType(e.target.value)} required />
      </div>
      <div className="space-y-1.5">
        <Label>Vehicle model</Label>
        <Input
          value={vehicleModel}
          onChange={(e) => setVehicleModel(e.target.value)}
          placeholder="Toyota Corolla 2020"
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label>License plate</Label>
        <Input
          value={licensePlate}
          onChange={(e) => setLicensePlate(e.target.value.toUpperCase())}
          placeholder="ABC 123 GP"
          required
        />
      </div>
      <Button type="submit" className="w-full" disabled={saving}>
        {saving ? "Saving…" : "Save and continue"}
      </Button>
    </form>
  );
}

export function OnlineToggle({
  profile,
  onChange,
}: {
  profile: DriverProfile;
  onChange: (p: DriverProfile) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [rating, setRating] = useState<{ avg: number; count: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("ride_reviews")
        .select("rating")
        .eq("driver_id", profile.user_id);
      if (cancelled) return;
      const rows = (data ?? []) as { rating: number }[];
      if (!rows.length) setRating({ avg: 0, count: 0 });
      else {
        const sum = rows.reduce((a, r) => a + r.rating, 0);
        setRating({ avg: sum / rows.length, count: rows.length });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profile.user_id]);

  async function toggle(checked: boolean) {
    setBusy(true);
    const { data, error } = await supabase
      .from("driver_profiles")
      .update({ is_available: checked })
      .eq("user_id", profile.user_id)
      .select()
      .single();
    setBusy(false);
    if (error) toast.error(error.message);
    else if (data) onChange(data);
  }

  return (
    <section className="flex items-center justify-between rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)]">
      <div>
        <p className="font-medium">{profile.is_available ? "Online" : "Offline"}</p>
        <p className="text-xs text-muted-foreground">
          {profile.vehicle_model} · {profile.license_plate}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {rating == null
            ? "Loading rating…"
            : rating.count === 0
              ? "No ratings yet"
              : `★ ${rating.avg.toFixed(2)} from ${rating.count} rating${rating.count === 1 ? "" : "s"}`}
        </p>
      </div>
      <Switch checked={profile.is_available} onCheckedChange={toggle} disabled={busy} />
    </section>
  );
}
