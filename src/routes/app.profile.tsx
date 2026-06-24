import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useUserRoles } from "@/hooks/use-auth";
import { AppShell, NAV_ICONS } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Camera, Loader2 } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

export const Route = createFileRoute("/app/profile")({
  head: () => ({ meta: [{ title: "Profile — Access" }] }),
  component: ProfilePage,
});

function ProfilePage() {
  const { user } = useAuth();
  const { roles } = useUserRoles(user?.id);

  const nav = useMemo(() => {
    const items: { to: string; label: string; icon: React.ReactNode }[] = [];
    if (roles?.includes("passenger"))
      items.push({ to: "/app/passenger", label: "Ride", icon: NAV_ICONS.Passenger });
    if (roles?.includes("driver"))
      items.push({ to: "/app/driver", label: "Drive", icon: NAV_ICONS.Driver });
    if (roles?.includes("admin"))
      items.push({ to: "/app/admin", label: "Admin", icon: NAV_ICONS.Admin });
    items.push({ to: "/app/profile", label: "Profile", icon: NAV_ICONS.Profile });
    return items;
  }, [roles]);

  return (
    <AppShell title="Profile" nav={nav}>
      {user ? <ProfileEditor userId={user.id} /> : null}
      {user && roles?.includes("driver") ? (
        <DriverVehicleEditor userId={user.id} />
      ) : null}
    </AppShell>
  );
}

// E.164-ish, allows local SA formats too (07xxxxxxxx). 7–15 digits with optional leading +.
const PHONE_RE = /^\+?[0-9 ()-]{7,20}$/;

function normalizePhone(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

function ProfileEditor({ userId }: { userId: string }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Load profile; create a safe empty row if missing (handle_new_user trigger
  // normally inserts on signup, this is just a self-heal for legacy accounts).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        setLoadError(error.message);
        setLoading(false);
        return;
      }
      let row = data;
      if (!row) {
        const { data: created, error: insertErr } = await supabase
          .from("profiles")
          .insert({ user_id: userId })
          .select()
          .single();
        if (cancelled) return;
        if (insertErr) {
          setLoadError(insertErr.message);
          setLoading(false);
          return;
        }
        row = created;
      }
      setProfile(row);
      setFullName(row?.full_name ?? "");
      setPhone(row?.phone ?? "");
      if (row?.avatar_url) await refreshAvatar(row.avatar_url);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  async function refreshAvatar(path: string) {
    const { data } = await supabase.storage
      .from("avatars")
      .createSignedUrl(path, 60 * 60);
    setAvatarUrl(data?.signedUrl ?? null);
  }

  function validate(): { name: string | null; phone: string | null; ok: boolean } {
    const name = fullName.trim();
    let nErr: string | null = null;
    let pErr: string | null = null;
    if (!name) nErr = "Name is required";
    else if (name.length > 80) nErr = "Name must be 80 characters or fewer";
    const p = normalizePhone(phone);
    if (!p) pErr = "Phone is required";
    else if (!PHONE_RE.test(p)) pErr = "Enter a valid phone number";
    setNameError(nErr);
    setPhoneError(pErr);
    return { name: nErr, phone: pErr, ok: !nErr && !pErr };
  }

  async function onSave() {
    if (!validate().ok) return;
    setSaving(true);
    const name = fullName.trim();
    const p = normalizePhone(phone);
    const { data, error } = await supabase
      .from("profiles")
      .update({ full_name: name, phone: p })
      .eq("user_id", userId)
      .select()
      .single();
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setProfile(data);
    setFullName(data.full_name ?? "");
    setPhone(data.phone ?? "");
    toast.success("Profile saved");
  }

  async function onAvatarChange(file: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file (JPG, PNG, WebP)");
      return;
    }
    const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!ALLOWED.includes(file.type)) {
      toast.error("Unsupported image format");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be under 5 MB");
      return;
    }
    setUploading(true);
    const previousPath = profile?.avatar_url ?? null;
    try {
      const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
      const path = `${userId}/avatar-${Date.now()}.${ext || "jpg"}`;
      const { error: upErr } = await supabase.storage
        .from("avatars")
        .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type });
      if (upErr) throw upErr;

      const { data: updated, error: profErr } = await supabase
        .from("profiles")
        .update({ avatar_url: path })
        .eq("user_id", userId)
        .select()
        .single();
      if (profErr) {
        // Rollback the orphaned upload so storage stays tidy.
        await supabase.storage.from("avatars").remove([path]);
        throw profErr;
      }

      // Best-effort: remove the previous avatar object now that the new one is live.
      if (previousPath && previousPath !== path) {
        await supabase.storage.from("avatars").remove([previousPath]);
      }

      setProfile(updated);
      await refreshAvatar(path);
      toast.success("Photo updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  if (loading) {
    return (
      <section className="space-y-3 rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)]">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading profile…
        </div>
      </section>
    );
  }

  if (loadError) {
    return (
      <section className="space-y-3 rounded-2xl border border-destructive/40 bg-destructive/5 p-4">
        <p className="text-sm font-medium text-destructive">Couldn't load your profile</p>
        <p className="text-xs text-muted-foreground">{loadError}</p>
        <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
          Try again
        </Button>
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-4">
        <div className="relative">
          <div className="grid h-20 w-20 place-items-center overflow-hidden rounded-full bg-secondary text-2xl font-semibold text-muted-foreground">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt="Profile photo"
                className="h-full w-full object-cover"
              />
            ) : (
              (fullName || "?").slice(0, 1).toUpperCase()
            )}
          </div>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="absolute -bottom-1 -right-1 grid h-8 w-8 place-items-center rounded-full border bg-background shadow disabled:opacity-60"
            aria-label="Change photo"
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Camera className="h-4 w-4" />
            )}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onAvatarChange(f);
              e.target.value = "";
            }}
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{profile?.full_name || "Unnamed"}</p>
          <p className="truncate text-xs text-muted-foreground">{profile?.phone || "No phone"}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {uploading ? "Uploading photo…" : "JPG, PNG or WebP · up to 5 MB"}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="full_name">Full name</Label>
          <Input
            id="full_name"
            value={fullName}
            onChange={(e) => {
              setFullName(e.target.value);
              if (nameError) setNameError(null);
            }}
            placeholder="Your name"
            maxLength={80}
            autoComplete="name"
            aria-invalid={!!nameError}
          />
          {nameError && <p className="text-xs text-destructive">{nameError}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phone">Phone</Label>
          <Input
            id="phone"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              if (phoneError) setPhoneError(null);
            }}
            placeholder="+27 71 234 5678"
            inputMode="tel"
            autoComplete="tel"
            maxLength={20}
            aria-invalid={!!phoneError}
          />
          {phoneError ? (
            <p className="text-xs text-destructive">{phoneError}</p>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              Drivers see this only once they've accepted your ride.
            </p>
          )}
        </div>
        <Button className="w-full" onClick={onSave} disabled={saving || uploading}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </section>
  );
}

type DriverProfile = Database["public"]["Tables"]["driver_profiles"]["Row"];

const PLATE_RE = /^[A-Z0-9 -]{2,12}$/;

function DriverVehicleEditor({ userId }: { userId: string }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [vehicleType, setVehicleType] = useState("");
  const [vehicleModel, setVehicleModel] = useState("");
  const [licensePlate, setLicensePlate] = useState("");
  const [errors, setErrors] = useState<{ type?: string; model?: string; plate?: string }>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      const { data, error } = await supabase
        .from("driver_profiles")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        setLoadError(error.message);
        setLoading(false);
        return;
      }
      setProfile(data);
      setVehicleType(data?.vehicle_type ?? "");
      setVehicleModel(data?.vehicle_model ?? "");
      setLicensePlate(data?.license_plate ?? "");
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  function validate(): boolean {
    const next: { type?: string; model?: string; plate?: string } = {};
    if (!vehicleType.trim()) next.type = "Vehicle type is required";
    else if (vehicleType.length > 40) next.type = "Vehicle type is too long";
    if (!vehicleModel.trim()) next.model = "Vehicle model is required";
    else if (vehicleModel.length > 80) next.model = "Vehicle model is too long";
    const plate = licensePlate.trim().toUpperCase();
    if (!plate) next.plate = "License plate is required";
    else if (!PLATE_RE.test(plate)) next.plate = "2–12 letters, numbers, spaces or hyphens";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function onSave() {
    if (!validate()) return;
    if (!profile) {
      // No row yet — driver hasn't gone through onboarding. Send them there.
      toast.error("Finish driver setup on the Drive tab first");
      return;
    }
    setSaving(true);
    const { data, error } = await supabase
      .from("driver_profiles")
      .update({
        vehicle_type: vehicleType.trim(),
        vehicle_model: vehicleModel.trim(),
        license_plate: licensePlate.trim().toUpperCase(),
      })
      .eq("user_id", userId)
      .select()
      .single();
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setProfile(data);
    setVehicleType(data.vehicle_type ?? "");
    setVehicleModel(data.vehicle_model ?? "");
    setLicensePlate(data.license_plate ?? "");
    toast.success("Vehicle details saved");
  }

  if (loading) {
    return (
      <section className="mt-4 rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)]">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading vehicle…
        </p>
      </section>
    );
  }
  if (loadError) {
    return (
      <section className="mt-4 rounded-2xl border border-destructive/40 bg-destructive/5 p-4">
        <p className="text-sm font-medium text-destructive">Couldn't load vehicle details</p>
        <p className="text-xs text-muted-foreground">{loadError}</p>
      </section>
    );
  }
  if (!profile) {
    return (
      <section className="mt-4 rounded-2xl border border-dashed bg-card p-4 text-sm text-muted-foreground">
        Finish driver setup on the Drive tab to add your vehicle details.
      </section>
    );
  }

  return (
    <section className="mt-4 space-y-3 rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)]">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Vehicle
        </h2>
        <p className="text-xs text-muted-foreground">
          Shown to passengers on rides you accept.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="vehicle_type">Vehicle type</Label>
        <Input
          id="vehicle_type"
          value={vehicleType}
          maxLength={40}
          onChange={(e) => {
            setVehicleType(e.target.value);
            if (errors.type) setErrors((p) => ({ ...p, type: undefined }));
          }}
          placeholder="Sedan, SUV, Hatchback…"
          aria-invalid={!!errors.type}
        />
        {errors.type && <p className="text-xs text-destructive">{errors.type}</p>}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="vehicle_model">Vehicle model</Label>
        <Input
          id="vehicle_model"
          value={vehicleModel}
          maxLength={80}
          onChange={(e) => {
            setVehicleModel(e.target.value);
            if (errors.model) setErrors((p) => ({ ...p, model: undefined }));
          }}
          placeholder="Toyota Corolla 2020"
          aria-invalid={!!errors.model}
        />
        {errors.model && <p className="text-xs text-destructive">{errors.model}</p>}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="license_plate">License plate</Label>
        <Input
          id="license_plate"
          value={licensePlate}
          maxLength={12}
          onChange={(e) => {
            setLicensePlate(e.target.value.toUpperCase());
            if (errors.plate) setErrors((p) => ({ ...p, plate: undefined }));
          }}
          placeholder="ABC 123 GP"
          aria-invalid={!!errors.plate}
        />
        {errors.plate && <p className="text-xs text-destructive">{errors.plate}</p>}
      </div>
      <Button className="w-full" onClick={onSave} disabled={saving}>
        {saving ? "Saving…" : "Save vehicle"}
      </Button>
    </section>
  );
}
