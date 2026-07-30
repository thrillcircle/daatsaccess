import { useState, type ChangeEvent } from "react";
import { FileUp, Loader2, PencilLine } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  fleetDb,
  type CanonicalVehicle,
  type VehicleDocument,
  type VehicleDocumentType,
} from "@/lib/fleet";
import { toast } from "sonner";

export function AdminVehicleRecordActions({
  vehicle,
  documents,
  onChanged,
}: {
  vehicle: CanonicalVehicle;
  documents: VehicleDocument[];
  onChanged: () => void;
}) {
  return (
    <>
      <EditVehicleDialog vehicle={vehicle} onChanged={onChanged} />
      <VehicleDocumentDialog vehicle={vehicle} documents={documents} onChanged={onChanged} />
    </>
  );
}

function EditVehicleDialog({
  vehicle,
  onChanged,
}: {
  vehicle: CanonicalVehicle;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [vehicleName, setVehicleName] = useState(vehicle.vehicle_name);
  const [licensePlate, setLicensePlate] = useState(vehicle.license_plate);
  const [vehicleType, setVehicleType] = useState(vehicle.vehicle_type ?? "");
  const [make, setMake] = useState(vehicle.make ?? "");
  const [model, setModel] = useState(vehicle.model ?? "");
  const [year, setYear] = useState(vehicle.year == null ? "" : String(vehicle.year));
  const [vin, setVin] = useState(vehicle.vin_number ?? "");
  const [passengerCapacity, setPassengerCapacity] = useState(
    vehicle.passenger_capacity == null ? "" : String(vehicle.passenger_capacity),
  );
  const [wheelchairAccessible, setWheelchairAccessible] = useState(
    vehicle.wheelchair_accessible,
  );
  const [wheelchairCapacity, setWheelchairCapacity] = useState(
    vehicle.wheelchair_capacity == null ? "" : String(vehicle.wheelchair_capacity),
  );
  const [rampOrLift, setRampOrLift] = useState(vehicle.ramp_or_lift_available);
  const [serviceInterval, setServiceInterval] = useState(String(vehicle.service_interval_km));
  const [notes, setNotes] = useState(vehicle.admin_notes ?? "");

  async function save() {
    if (vehicleName.trim().length < 2 || licensePlate.trim().length < 2) {
      toast.error("Vehicle name and registration are required");
      return;
    }
    setSaving(true);
    const { error } = await fleetDb.rpc("admin_update_vehicle", {
      p_vehicle_id: vehicle.id,
      p_expected_updated_at: vehicle.updated_at,
      p_vehicle_name: vehicleName.trim(),
      p_vehicle_type: vehicleType.trim() || null,
      p_make: make.trim() || null,
      p_model: model.trim() || null,
      p_year: year ? Number(year) : null,
      p_vin_number: vin.trim() || null,
      p_license_plate: licensePlate.trim(),
      p_passenger_capacity: passengerCapacity ? Number(passengerCapacity) : null,
      p_wheelchair_accessible: wheelchairAccessible,
      p_wheelchair_capacity: wheelchairCapacity ? Number(wheelchairCapacity) : null,
      p_ramp_or_lift_available: rampOrLift,
      p_accessibility_features: vehicle.accessibility_features,
      p_service_interval_km: serviceInterval ? Number(serviceInterval) : null,
      p_admin_notes: notes.trim() || null,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Canonical vehicle updated");
    setOpen(false);
    onChanged();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <PencilLine className="mr-1 h-4 w-4" /> Edit vehicle
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit canonical vehicle</DialogTitle>
          <DialogDescription>
            This updates the authoritative vehicle record. Registration changes are normalised and
            checked for duplicates on the server.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Vehicle name">
            <Input value={vehicleName} onChange={(event) => setVehicleName(event.target.value)} />
          </Field>
          <Field label="Registration">
            <Input value={licensePlate} onChange={(event) => setLicensePlate(event.target.value)} />
          </Field>
          <Field label="Vehicle type">
            <Input value={vehicleType} onChange={(event) => setVehicleType(event.target.value)} />
          </Field>
          <Field label="Make">
            <Input value={make} onChange={(event) => setMake(event.target.value)} />
          </Field>
          <Field label="Model">
            <Input value={model} onChange={(event) => setModel(event.target.value)} />
          </Field>
          <Field label="Year">
            <Input type="number" value={year} onChange={(event) => setYear(event.target.value)} />
          </Field>
          <Field label="VIN">
            <Input value={vin} onChange={(event) => setVin(event.target.value)} />
          </Field>
          <Field label="Passenger capacity">
            <Input
              type="number"
              min="0"
              value={passengerCapacity}
              onChange={(event) => setPassengerCapacity(event.target.value)}
            />
          </Field>
          <Field label="Wheelchair capacity">
            <Input
              type="number"
              min="0"
              value={wheelchairCapacity}
              onChange={(event) => setWheelchairCapacity(event.target.value)}
            />
          </Field>
          <Field label="Service interval (km)">
            <Input
              type="number"
              min="1"
              value={serviceInterval}
              onChange={(event) => setServiceInterval(event.target.value)}
            />
          </Field>
          <label className="flex items-center justify-between rounded-xl border p-3 text-sm">
            <span>Wheelchair accessible</span>
            <Switch checked={wheelchairAccessible} onCheckedChange={setWheelchairAccessible} />
          </label>
          <label className="flex items-center justify-between rounded-xl border p-3 text-sm">
            <span>Ramp or lift available</span>
            <Switch checked={rampOrLift} onCheckedChange={setRampOrLift} />
          </label>
          <label className="space-y-1.5 text-sm sm:col-span-2">
            <span className="font-medium">Admin notes</span>
            <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={4} />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            Save vehicle
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VehicleDocumentDialog({
  vehicle,
  documents,
  onChanged,
}: {
  vehicle: CanonicalVehicle;
  documents: VehicleDocument[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [type, setType] = useState<VehicleDocumentType>("roadworthy");
  const [number, setNumber] = useState("");
  const [issuedAt, setIssuedAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const current = documents.find(
    (document) => document.document_type === type && document.is_current,
  );

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    if (selected && selected.size > 10 * 1024 * 1024) {
      toast.error("Vehicle documents may not exceed 10 MB");
      event.target.value = "";
      setFile(null);
      return;
    }
    setFile(selected);
  }

  async function save() {
    if (!file) {
      toast.error("Choose a PDF or image to upload");
      return;
    }
    if (["roadworthy", "license_disc", "insurance", "permit"].includes(type) && !expiresAt) {
      toast.error("An expiry date is required for this document type");
      return;
    }

    setSaving(true);
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
    const storagePath = `${vehicle.id}/${type}/${crypto.randomUUID()}-${safeName}`;
    const upload = await supabase.storage.from("vehicle-documents").upload(storagePath, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || undefined,
    });
    if (upload.error) {
      setSaving(false);
      toast.error(upload.error.message);
      return;
    }

    const { error } = await fleetDb.rpc("admin_save_vehicle_document", {
      p_vehicle_id: vehicle.id,
      p_document_type: type,
      p_document_number: number.trim() || null,
      p_issued_at: issuedAt || null,
      p_expires_at: expiresAt || null,
      p_storage_path: storagePath,
      p_idempotency_key: crypto.randomUUID(),
    });
    if (error) {
      await supabase.storage.from("vehicle-documents").remove([storagePath]);
      setSaving(false);
      toast.error(error.message);
      return;
    }

    setSaving(false);
    toast.success(current ? "Vehicle document replaced" : "Vehicle document uploaded");
    setOpen(false);
    setNumber("");
    setIssuedAt("");
    setExpiresAt("");
    setFile(null);
    onChanged();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <FileUp className="mr-1 h-4 w-4" /> Upload document
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Upload or replace vehicle document</DialogTitle>
          <DialogDescription>
            Files are stored in a private administrator-only bucket. Replacing a current document
            preserves its history and marks the previous record as replaced.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1.5 text-sm sm:col-span-2">
            <span className="font-medium">Document type</span>
            <select
              value={type}
              onChange={(event) => setType(event.target.value as VehicleDocumentType)}
              className="h-10 w-full rounded-md border bg-background px-3"
            >
              <option value="roadworthy">Roadworthy certificate</option>
              <option value="license_disc">Licence disc</option>
              <option value="insurance">Insurance</option>
              <option value="registration">Registration</option>
              <option value="permit">Permit</option>
              <option value="other">Other</option>
            </select>
          </label>
          <Field label="Document number">
            <Input value={number} onChange={(event) => setNumber(event.target.value)} />
          </Field>
          <Field label="Issued date">
            <Input type="date" value={issuedAt} onChange={(event) => setIssuedAt(event.target.value)} />
          </Field>
          <Field label="Expiry date">
            <Input type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
          </Field>
          <Field label="File">
            <Input
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              onChange={selectFile}
            />
          </Field>
          {current ? (
            <p className="rounded-xl border border-amber-400/40 bg-amber-50 p-3 text-xs text-amber-900 sm:col-span-2 dark:bg-amber-950/20 dark:text-amber-100">
              A current {type.replaceAll("_", " ")} document exists. Saving will replace its current
              status without deleting its audit record.
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            {current ? "Replace document" : "Upload document"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}
