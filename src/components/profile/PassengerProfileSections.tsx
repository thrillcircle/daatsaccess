import { useCallback, useEffect, useMemo, useState } from "react";
import { HeartHandshake, Home, Loader2, MapPin, Pencil, Plus, Shield, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AddressAutocomplete, type AddressPick } from "@/components/AddressAutocomplete";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

const db = supabase;

type SavedAddress = {
  id: string;
  passenger_id: string;
  label: "Home" | "Work" | "Medical Facility" | "Family" | "Other";
  formatted_address: string;
  place_id: string | null;
  latitude: number;
  longitude: number;
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

type PassengerPreferences = {
  passenger_id: string;
  preferred_contact_method: "in_app" | "phone" | "email";
  wheelchair_user: boolean;
  mobility_device_notes: string | null;
  communication_support_notes: string | null;
  general_assistance_notes: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relationship: string | null;
};

const ADDRESS_LABELS: SavedAddress["label"][] = [
  "Home",
  "Work",
  "Medical Facility",
  "Family",
  "Other",
];

export function PassengerProfileSections({ userId }: { userId: string }) {
  return (
    <>
      <SavedAddressesCard userId={userId} />
      <PassengerPreferencesCard userId={userId} />
    </>
  );
}

function SavedAddressesCard({ userId }: { userId: string }) {
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [label, setLabel] = useState<SavedAddress["label"]>("Home");
  const [pick, setPick] = useState<AddressPick | null>(null);
  const [isDefault, setIsDefault] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await db
      .from("passenger_saved_addresses")
      .select("*")
      .eq("passenger_id", userId)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: true });
    if (error) toast.error(error.message);
    setAddresses((data ?? []) as SavedAddress[]);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  function resetForm() {
    setEditingId(null);
    setLabel("Home");
    setPick(null);
    setIsDefault(false);
    setShowForm(false);
  }

  function edit(address: SavedAddress) {
    setEditingId(address.id);
    setLabel(address.label);
    setPick({
      address: address.formatted_address,
      placeId: address.place_id,
      lat: address.latitude,
      lng: address.longitude,
    });
    setIsDefault(address.is_default);
    setShowForm(true);
  }

  async function save() {
    if (!pick) {
      toast.error("Choose a complete address from the address search");
      return;
    }
    setSaving(true);
    const payload = {
      passenger_id: userId,
      label,
      formatted_address: pick.address,
      place_id: pick.placeId,
      latitude: pick.lat,
      longitude: pick.lng,
      is_default: isDefault || addresses.length === 0,
    };
    const result = editingId
      ? await db.from("passenger_saved_addresses").update(payload).eq("id", editingId)
      : await db.from("passenger_saved_addresses").insert(payload);
    setSaving(false);
    if (result.error) {
      toast.error(result.error.message);
      return;
    }
    toast.success(editingId ? "Saved address updated" : "Saved address added");
    resetForm();
    await load();
  }

  async function makeDefault(address: SavedAddress) {
    const { error } = await db
      .from("passenger_saved_addresses")
      .update({ is_default: true })
      .eq("id", address.id);
    if (error) toast.error(error.message);
    else {
      toast.success(`${address.label} is now your default pickup`);
      await load();
    }
  }

  async function remove(address: SavedAddress) {
    if (!window.confirm(`Remove ${address.label} from saved addresses?`)) return;
    const { error } = await db.from("passenger_saved_addresses").delete().eq("id", address.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Saved address removed");
      await load();
    }
  }

  return (
    <section className="mt-4 rounded-2xl border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Home className="h-4 w-4 text-primary" />
            <h2 className="font-semibold">Saved addresses</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Use a saved address as a faster pickup shortcut on Ride and Services.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setShowForm((value) => !value)}>
          <Plus className="mr-1 h-4 w-4" /> Add
        </Button>
      </div>

      {showForm ? (
        <div className="mt-4 space-y-3 rounded-xl border bg-secondary/40 p-3">
          <div className="space-y-1.5">
            <Label htmlFor="saved-address-label">Label</Label>
            <select
              id="saved-address-label"
              value={label}
              onChange={(event) => setLabel(event.target.value as SavedAddress["label"])}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            >
              {ADDRESS_LABELS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
          <AddressAutocomplete
            id="saved-profile-address"
            label="Address"
            value={pick}
            onChange={setPick}
            placeholder="Search for a South African address"
            enableCurrentLocation
          />
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={isDefault}
              onCheckedChange={(value) => setIsDefault(value === true)}
            />
            Use as my default pickup address
          </label>
          <div className="flex gap-2">
            <Button className="flex-1" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {editingId ? "Update address" : "Save address"}
            </Button>
            <Button variant="outline" onClick={resetForm}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading addresses…
        </p>
      ) : !addresses.length ? (
        <p className="mt-4 rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
          No saved addresses yet.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {addresses.map((address) => (
            <li key={address.id} className="rounded-xl border p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{address.label}</p>
                    {address.is_default ? <Badge>Default pickup</Badge> : null}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{address.formatted_address}</p>
                </div>
                <MapPin className="h-4 w-4 shrink-0 text-primary" />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {!address.is_default ? (
                  <Button size="sm" variant="outline" onClick={() => makeDefault(address)}>
                    Make default
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" onClick={() => edit(address)}>
                  <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => remove(address)}>
                  <Trash2 className="mr-1 h-3.5 w-3.5" /> Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PassengerPreferencesCard({ userId }: { userId: string }) {
  const empty = useMemo<PassengerPreferences>(
    () => ({
      passenger_id: userId,
      preferred_contact_method: "in_app",
      wheelchair_user: false,
      mobility_device_notes: null,
      communication_support_notes: null,
      general_assistance_notes: null,
      emergency_contact_name: null,
      emergency_contact_phone: null,
      emergency_contact_relationship: null,
    }),
    [userId],
  );
  const [form, setForm] = useState<PassengerPreferences>(empty);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data, error } = await db
        .from("passenger_preferences")
        .select("*")
        .eq("passenger_id", userId)
        .maybeSingle();
      if (cancelled) return;
      if (error) toast.error(error.message);
      setForm((data ?? empty) as PassengerPreferences);
      setLoading(false);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [userId, empty]);

  async function save() {
    setSaving(true);
    const { error } = await db.from("passenger_preferences").upsert(
      {
        passenger_id: userId,
        preferred_contact_method: form.preferred_contact_method,
        wheelchair_user: form.wheelchair_user,
        mobility_device_notes: form.mobility_device_notes?.trim() || null,
        communication_support_notes: form.communication_support_notes?.trim() || null,
        general_assistance_notes: form.general_assistance_notes?.trim() || null,
        emergency_contact_name: form.emergency_contact_name?.trim() || null,
        emergency_contact_phone: form.emergency_contact_phone?.trim() || null,
        emergency_contact_relationship: form.emergency_contact_relationship?.trim() || null,
      },
      { onConflict: "passenger_id" },
    );
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success("Passenger preferences saved");
  }

  if (loading) {
    return (
      <section className="mt-4 rounded-2xl border bg-card p-4 shadow-sm">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading preferences…
        </p>
      </section>
    );
  }

  return (
    <section className="mt-4 space-y-4 rounded-2xl border bg-card p-4 shadow-sm">
      <div>
        <div className="flex items-center gap-2">
          <HeartHandshake className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">Travel and assistance preferences</h2>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          These preferences help Access plan suitable support. They are not treated as medical
          diagnoses.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="preferred-contact">Preferred contact method</Label>
        <select
          id="preferred-contact"
          value={form.preferred_contact_method}
          onChange={(event) =>
            setForm((previous) => ({
              ...previous,
              preferred_contact_method: event.target
                .value as PassengerPreferences["preferred_contact_method"],
            }))
          }
          className="h-10 w-full rounded-md border bg-background px-3 text-sm"
        >
          <option value="in_app">In-app notifications</option>
          <option value="phone">Phone call</option>
          <option value="email">Email</option>
        </select>
      </div>

      <label className="flex items-start gap-3 rounded-xl border p-3 text-sm">
        <Checkbox
          checked={form.wheelchair_user}
          onCheckedChange={(value) =>
            setForm((previous) => ({ ...previous, wheelchair_user: value === true }))
          }
        />
        <span>
          <span className="font-medium">Wheelchair user</span>
          <span className="block text-xs text-muted-foreground">
            Specific vehicle and transfer requirements must still be selected for each booking.
          </span>
        </span>
      </label>

      <div className="space-y-1.5">
        <Label htmlFor="mobility-notes">Mobility device notes</Label>
        <Textarea
          id="mobility-notes"
          value={form.mobility_device_notes ?? ""}
          onChange={(event) =>
            setForm((previous) => ({ ...previous, mobility_device_notes: event.target.value }))
          }
          rows={3}
          placeholder="Wheelchair type, walker, folding requirements, dimensions where relevant…"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="communication-notes">Communication support notes</Label>
        <Textarea
          id="communication-notes"
          value={form.communication_support_notes ?? ""}
          onChange={(event) =>
            setForm((previous) => ({
              ...previous,
              communication_support_notes: event.target.value,
            }))
          }
          rows={3}
          placeholder="Preferred communication approach or support needs…"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="assistance-notes">General assistance notes</Label>
        <Textarea
          id="assistance-notes"
          value={form.general_assistance_notes ?? ""}
          onChange={(event) =>
            setForm((previous) => ({ ...previous, general_assistance_notes: event.target.value }))
          }
          rows={3}
          placeholder="General door-to-door or boarding preferences…"
        />
      </div>

      <div className="rounded-xl border p-3">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-primary" />
          <h3 className="font-medium">Emergency contact</h3>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          This contact is visible only to authorised Access administrators where operationally
          necessary.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="emergency-name">Name</Label>
            <Input
              id="emergency-name"
              value={form.emergency_contact_name ?? ""}
              onChange={(event) =>
                setForm((previous) => ({ ...previous, emergency_contact_name: event.target.value }))
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="emergency-phone">Phone</Label>
            <Input
              id="emergency-phone"
              value={form.emergency_contact_phone ?? ""}
              onChange={(event) =>
                setForm((previous) => ({
                  ...previous,
                  emergency_contact_phone: event.target.value,
                }))
              }
              inputMode="tel"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="emergency-relationship">Relationship</Label>
            <Input
              id="emergency-relationship"
              value={form.emergency_contact_relationship ?? ""}
              onChange={(event) =>
                setForm((previous) => ({
                  ...previous,
                  emergency_contact_relationship: event.target.value,
                }))
              }
            />
          </div>
        </div>
      </div>

      <Button className="w-full" onClick={save} disabled={saving}>
        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        Save passenger preferences
      </Button>
    </section>
  );
}
