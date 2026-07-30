from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text()


def write(path: str, text: str) -> None:
    Path(path).write_text(text)


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"Expected one match in {path}, found {count}: {old[:160]!r}")
    write(path, text.replace(old, new, 1))


def replace_all(path: str, old: str, new: str, minimum: int = 1) -> None:
    text = read(path)
    count = text.count(old)
    if count < minimum:
        raise RuntimeError(f"Expected at least {minimum} matches in {path}, found {count}: {old[:160]!r}")
    write(path, text.replace(old, new))


def replace_between(path: str, start_marker: str, end_marker: str, replacement: str) -> None:
    text = read(path)
    start = text.find(start_marker)
    if start < 0:
        raise RuntimeError(f"Start marker not found in {path}: {start_marker!r}")
    end = text.find(end_marker, start)
    if end < 0:
        raise RuntimeError(f"End marker not found in {path}: {end_marker!r}")
    write(path, text[:start] + replacement + text[end:])


# Vehicle Profiles type-only React import.
replace_once(
    "src/routes/app.admin.vehicle-profiles.tsx",
    'import { useEffect, useMemo, useState } from "react";\n',
    'import { useEffect, useMemo, useState, type ReactNode } from "react";\n',
)
replace_once(
    "src/routes/app.admin.vehicle-profiles.tsx",
    "function Field({ label, children }: { label: string; children: React.ReactNode }) {",
    "function Field({ label, children }: { label: string; children: ReactNode }) {",
)

# Support ticket domain gains a canonical vehicle reference.
replace_once(
    "src/lib/support.ts",
    "  service_booking_id: string | null;\n  category: SupportCategory;",
    "  service_booking_id: string | null;\n  vehicle_id: string | null;\n  category: SupportCategory;",
)

# Admin Support exposes canonical vehicle linking and maintenance conversion.
support_path = "src/routes/app.admin.support.$ticketId.tsx"
replace_once(
    support_path,
    'import { AdminShell } from "@/components/AdminShell";\n',
    'import { AdminShell } from "@/components/AdminShell";\nimport { AdminSupportVehicleActions } from "@/components/support/AdminSupportVehicleActions";\n',
)
replace_once(
    support_path,
    '''        {ticket.service_booking_id ? (
          <Button asChild size="sm" variant="outline">
            <Link to="/app/admin/bookings">Service bookings</Link>
          </Button>
        ) : null}
''',
    '''        {ticket.service_booking_id ? (
          <Button asChild size="sm" variant="outline">
            <Link to="/app/admin/bookings">Service bookings</Link>
          </Button>
        ) : null}
        <AdminSupportVehicleActions
          ticketId={ticket.id}
          vehicleId={ticket.vehicle_id}
          description={ticket.description}
        />
''',
)
replace_once(
    support_path,
    '''            <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
              <p>Trip: {ticket.ride_id ?? "Not linked"}</p>
              <p>Service booking: {ticket.service_booking_id ?? "Not linked"}</p>
            </div>
''',
    '''            <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
              <p>Trip: {ticket.ride_id ?? "Not linked"}</p>
              <p>Service booking: {ticket.service_booking_id ?? "Not linked"}</p>
              <p>Vehicle: {ticket.vehicle_id ?? "Not linked"}</p>
            </div>
''',
)

# Passenger My Trips shows only a canonical vehicle attached to an authorised ride.
passenger_path = "src/routes/app.passenger.bookings.tsx"
replace_once(
    passenger_path,
    'import { formatZAR } from "@/lib/pricing";\n',
    'import { formatZAR } from "@/lib/pricing";\nimport { fleetDb } from "@/lib/fleet";\n',
)
replace_once(
    passenger_path,
    'type VehicleAssign = { id: string; booking_id: string; fleet_vehicle_id: string; status: string };',
    'type VehicleAssign = { id: string; booking_id: string; vehicle_id: string | null; fleet_vehicle_id: string | null; status: string };',
)
replace_once(
    passenger_path,
    '''type FleetVehicle = {
  id: string;
  registration_number: string;
  make: string | null;
  model: string | null;
};''',
    '''type FleetVehicle = {
  id: string;
  vehicle_name: string;
  license_plate: string;
  make: string | null;
  model: string | null;
};''',
)
replace_once(
    passenger_path,
    '''type Ride = {
  id: string;
  service_booking_id: string | null;
  status: string;
  driver_id: string | null;
};''',
    '''type Ride = {
  id: string;
  service_booking_id: string | null;
  status: string;
  driver_id: string | null;
  vehicle_id: string | null;
};''',
)
replace_once(
    passenger_path,
    '          supabase.from("booking_vehicle_assignments").select("*").in("booking_id", ids),',
    '          fleetDb.from("booking_vehicle_assignments").select("*").in("booking_id", ids),',
)
replace_once(
    passenger_path,
    '.select("id,service_booking_id,status,driver_id")',
    '.select("id,service_booking_id,status,driver_id,vehicle_id")',
)
replace_once(
    passenger_path,
    '        const vIds = Array.from(new Set((vr.data ?? []).map((v) => v.fleet_vehicle_id)));',
    '''        const vIds = Array.from(
          new Set(
            ((rr.data ?? []) as Ride[])
              .map((ride) => ride.vehicle_id)
              .filter((value): value is string => !!value),
          ),
        );''',
)
replace_once(
    passenger_path,
    '''            ? supabase
                .from("fleet_vehicles")
                .select("id,registration_number,make,model")
                .in("id", vIds)''',
    '''            ? fleetDb
                .from("vehicle_profiles")
                .select("id,vehicle_name,license_plate,make,model")
                .in("id", vIds)''',
)
replace_once(
    passenger_path,
    '''            const vAssign = vehicleAssigns.find((x) => x.booking_id === b.id);
            const cAssigns = companionAssigns.filter((x) => x.booking_id === b.id);
            const ride = rides.find((r) => r.service_booking_id === b.id);''',
    '''            const cAssigns = companionAssigns.filter((x) => x.booking_id === b.id);
            const ride = rides.find((r) => r.service_booking_id === b.id);''',
)
replace_once(
    passenger_path,
    '''            const veh = vAssign
              ? fleetVehicles.find((v) => v.id === vAssign.fleet_vehicle_id)
              : null;''',
    '''            const veh = ride?.vehicle_id
              ? fleetVehicles.find((vehicle) => vehicle.id === ride.vehicle_id)
              : null;''',
)
replace_all(passenger_path, ".registration_number", ".license_plate", minimum=1)

# Admin Service Bookings uses canonical vehicles and protected booking/ride operations.
admin_bookings_path = "src/routes/app.admin.bookings.tsx"
replace_once(
    admin_bookings_path,
    'import { formatZAR } from "@/lib/pricing";\n',
    'import { formatZAR } from "@/lib/pricing";\nimport { fleetDb } from "@/lib/fleet";\n',
)
replace_once(
    admin_bookings_path,
    'type VehicleAssign = { id: string; booking_id: string; fleet_vehicle_id: string; status: string };',
    'type VehicleAssign = { id: string; booking_id: string; vehicle_id: string | null; fleet_vehicle_id: string | null; status: string };',
)
replace_once(
    admin_bookings_path,
    'type FleetVehicle = { id: string; registration_number: string; make: string | null; model: string | null; passenger_capacity: number; wheelchair_capacity: number; operational_status: string; is_active: boolean };',
    'type FleetVehicle = { id: string; vehicle_name: string; license_plate: string; make: string | null; model: string | null; passenger_capacity: number | null; wheelchair_capacity: number | null; status: string; wheelchair_accessible: boolean; ramp_or_lift_available: boolean };',
)
replace_all(
    admin_bookings_path,
    'supabase.from("booking_vehicle_assignments")',
    'fleetDb.from("booking_vehicle_assignments")',
    minimum=1,
)
replace_all(
    admin_bookings_path,
    'supabase.from("fleet_vehicles").select("*").eq("is_active", true).order("registration_number")',
    'fleetDb.from("vehicle_profiles").select("*").eq("status", "active").order("license_plate")',
    minimum=2,
)
replace_once(
    admin_bookings_path,
    '    setVehicleId(v?.fleet_vehicle_id ?? "");',
    '    setVehicleId(v?.vehicle_id ?? "");',
)
replace_between(
    admin_bookings_path,
    "  async function saveVehicle() {",
    "\n  async function saveDriver() {",
    '''  async function saveVehicle() {
    if (!vehicleId) {
      toast.error("Pick a canonical vehicle");
      return;
    }
    setBusy(true);
    try {
      const { error } = await fleetDb.rpc("admin_assign_booking_vehicle", {
        p_booking_id: booking!.id,
        p_vehicle_id: vehicleId,
        p_itinerary_item_id: null,
        p_notes: "Assigned through Service Bookings",
        p_idempotency_key: crypto.randomUUID(),
      });
      if (error) throw error;
      await logEvent("vehicle_assigned", { vehicle_id: vehicleId });
      toast.success("Canonical vehicle assigned");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }
''',
)
replace_once(
    admin_bookings_path,
    '    if (!driverId) { toast.error("Assign a driver first"); return; }',
    '    if (!driverId) { toast.error("Assign a driver first"); return; }\n    if (!vehicleId) { toast.error("Assign a canonical vehicle first"); return; }',
)
replace_once(
    admin_bookings_path,
    '''      const { error: updErr } = await supabase
        .from("rides")
        .update({ driver_id: driverId, status: "accepted", accepted_at: new Date().toISOString() })
        .eq("id", ins.id);
      if (updErr) throw updErr;''',
    '''      const { error: assignmentError } = await fleetDb.rpc("admin_assign_ride_resources", {
        p_ride_id: ins.id,
        p_driver_id: driverId,
        p_vehicle_id: vehicleId,
        p_expected_status: "requested",
        p_idempotency_key: crypto.randomUUID(),
      });
      if (assignmentError) throw assignmentError;''',
)
replace_all(admin_bookings_path, ".registration_number", ".license_plate", minimum=1)
replace_once(
    admin_bookings_path,
    '{v.registration_number} · {v.make ?? ""} {v.model ?? ""} · {v.passenger_capacity} pax{v.wheelchair_capacity > 0 ? ` · ${v.wheelchair_capacity} wheelchair` : ""}',
    '{v.license_plate} · {v.make ?? ""} {v.model ?? ""} · {v.passenger_capacity ?? "—"} pax{Number(v.wheelchair_capacity ?? 0) > 0 ? ` · ${v.wheelchair_capacity} wheelchair` : ""}',
)

# Admin Trips assigns driver and canonical vehicle atomically through the protected RPC.
trips_path = "src/routes/app.admin.trips.tsx"
replace_once(
    trips_path,
    'import { rankVehiclesForTrip, type Suitability } from "@/lib/vehicle-suitability";\n',
    'import { rankVehiclesForTrip, type Suitability } from "@/lib/vehicle-suitability";\nimport { fleetDb } from "@/lib/fleet";\n',
)
replace_between(
    trips_path,
    "  async function onAssignDriver() {",
    "\n  async function onChangeStatus() {",
    '''  async function onAssignResources() {
    if (!selectedDriver || !selectedFleet) {
      toast.error("Select both a driver and a suitable canonical vehicle");
      return;
    }
    const suitability = fleetRanked.find((item) => item.vehicle.id === selectedFleet);
    if (suitability && !suitability.suitable) {
      toast.error("The selected vehicle has blocking suitability conditions");
      return;
    }

    setBusy(true);
    try {
      const { error } = await fleetDb.rpc("admin_assign_ride_resources", {
        p_ride_id: ride.id,
        p_driver_id: selectedDriver,
        p_vehicle_id: selectedFleet,
        p_expected_status: ride.status,
        p_idempotency_key: crypto.randomUUID(),
      });
      if (error) throw error;
      toast.success("Driver and canonical vehicle assigned atomically");
      setOpen(false);
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Resource assignment failed");
    } finally {
      setBusy(false);
    }
  }
''',
)
replace_between(
    trips_path,
    "          {/* Assign driver / vehicle */}",
    "          {/* Change status */}",
    '''          {/* Assign driver and canonical vehicle atomically */}
          <div className="space-y-3">
            <Label className="text-xs">Assign driver and canonical vehicle</Label>
            <Select value={selectedDriver} onValueChange={setSelectedDriver}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="Select a driver" />
              </SelectTrigger>
              <SelectContent>
                {drivers.length === 0 ? (
                  <SelectItem value="__none" disabled>
                    No drivers found
                  </SelectItem>
                ) : null}
                {drivers.map((driverOption) => (
                  <SelectItem key={driverOption.user_id} value={driverOption.user_id}>
                    {driverOption.full_name ?? driverOption.user_id.slice(0, 8)}
                    {driverOption.is_available ? " · available" : " · offline"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={selectedFleet} onValueChange={setSelectedFleet}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="Select a canonical vehicle" />
              </SelectTrigger>
              <SelectContent className="max-h-80">
                {fleetRanked.length === 0 ? (
                  <SelectItem value="__empty" disabled>
                    No canonical vehicles
                  </SelectItem>
                ) : null}
                {fleetRanked.map((suitability) => {
                  const candidate = suitability.vehicle;
                  const tag = suitability.suitable
                    ? suitability.warnings.length
                      ? " ⚠"
                      : " ✓"
                    : " ✕";
                  return (
                    <SelectItem key={candidate.id} value={candidate.id} disabled={!suitability.suitable}>
                      {candidate.vehicle_name} · {candidate.license_plate}
                      {candidate.passenger_capacity != null ? ` · ${candidate.passenger_capacity} pax` : ""}
                      {candidate.wheelchair_accessible ? " · WC" : ""}
                      {tag}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>

            {(() => {
              const picked = fleetRanked.find((item) => item.vehicle.id === selectedFleet);
              if (!picked) return null;
              return (
                <div className="flex flex-wrap gap-1">
                  {picked.blocking.map((reason, index) => (
                    <Badge key={`b${index}`} variant="destructive" className="text-[10px]">
                      {reason.label}
                    </Badge>
                  ))}
                  {picked.warnings.map((reason, index) => (
                    <Badge
                      key={`w${index}`}
                      className="bg-amber-500/20 text-[10px] text-amber-800 dark:text-amber-200"
                    >
                      {reason.label}
                    </Badge>
                  ))}
                  {picked.suitable && picked.warnings.length === 0 ? (
                    <Badge variant="secondary" className="text-[10px]">
                      Suitable
                    </Badge>
                  ) : null}
                </div>
              );
            })()}

            <Button
              size="sm"
              disabled={busy || terminal || !selectedDriver || !selectedFleet}
              onClick={onAssignResources}
              className="h-8 text-xs"
            >
              {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
              Assign resources
            </Button>
            <p className="text-[10px] text-muted-foreground">
              Driver and vehicle are validated and written in one protected transaction.
            </p>
          </div>

''',
)
replace_once(
    trips_path,
    '''          {(ride.vehicle_id || vehicle?.license_plate) && (
            <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
              <Link to="/app/admin/fleet">
                <Car className="mr-1 h-3 w-3" /> Vehicle
              </Link>
            </Button>
          )}''',
    '''          {ride.vehicle_id ? (
            <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
              <Link
                to="/app/admin/vehicle-profiles/$vehicleId"
                params={{ vehicleId: ride.vehicle_id }}
              >
                <Car className="mr-1 h-3 w-3" /> Vehicle
              </Link>
            </Button>
          ) : null}''',
)

print("Phase 3 integration patch applied")
