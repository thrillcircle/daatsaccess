from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"Expected one match in {path}, found {count}: {old[:180]!r}")
    file.write_text(text.replace(old, new, 1))


def remove_between(path: str, start: str, end: str) -> None:
    file = Path(path)
    text = file.read_text()
    start_at = text.find(start)
    if start_at < 0:
        raise RuntimeError(f"Start marker not found in {path}: {start!r}")
    end_at = text.find(end, start_at)
    if end_at < 0:
        raise RuntimeError(f"End marker not found in {path}: {end!r}")
    file.write_text(text[:start_at] + text[end_at:])


# Type-only React helper in the protected vehicle actions component.
replace_once(
    "src/components/fleet/AdminVehicleRecordActions.tsx",
    'import { useState, type ChangeEvent } from "react";\n',
    'import { useState, type ChangeEvent, type ReactNode } from "react";\n',
)
replace_once(
    "src/components/fleet/AdminVehicleRecordActions.tsx",
    "function Field({ label, children }: { label: string; children: React.ReactNode }) {",
    "function Field({ label, children }: { label: string; children: ReactNode }) {",
)

# Vehicle detail exposes canonical editing and private document upload/replace.
vehicle_detail = "src/routes/app.admin.vehicle-profiles.$vehicleId.tsx"
replace_once(
    vehicle_detail,
    'import { AdminShell } from "@/components/AdminShell";\n',
    'import { AdminShell } from "@/components/AdminShell";\nimport { AdminVehicleRecordActions } from "@/components/fleet/AdminVehicleRecordActions";\n',
)
replace_once(
    vehicle_detail,
    '''        <div className="flex flex-wrap gap-2">
          <StatusDialog vehicle={vehicle} onChanged={() => setReload((value) => value + 1)} />''',
    '''        <div className="flex flex-wrap gap-2">
          <AdminVehicleRecordActions
            vehicle={vehicle}
            documents={data.documents}
            onChanged={() => setReload((value) => value + 1)}
          />
          <StatusDialog vehicle={vehicle} onChanged={() => setReload((value) => value + 1)} />''',
)

# Driver compliance uses a restricted RPC that never returns document numbers
# or private storage paths.
driver_profile = "src/components/profile/DriverProfileSections.tsx"
replace_once(
    driver_profile,
    '''          fleetDb
            .from("vehicle_documents")
            .select("*")
            .eq("vehicle_id", assignment.vehicle_id)
            .eq("is_current", true),''',
    '''          fleetDb.rpc("driver_current_vehicle_document_status"),''',
)

# Maintenance actions require real completion information.
maintenance = "src/routes/app.admin.maintenance.tsx"
replace_once(
    maintenance,
    'import { AdminShell } from "@/components/AdminShell";\n',
    'import { AdminShell } from "@/components/AdminShell";\nimport { AdminMaintenanceActions } from "@/components/fleet/AdminMaintenanceActions";\n',
)
replace_once(
    maintenance,
    "  type MaintenanceStatus,\n",
    "",
)
replace_once(
    maintenance,
    '<WorkOrderActions order={order} onChanged={() => setReload((value) => value + 1)} />',
    '<AdminMaintenanceActions order={order} onChanged={() => setReload((value) => value + 1)} />',
)
remove_between(
    maintenance,
    "function WorkOrderActions({",
    "function CreateMaintenanceDialog({",
)

# Assignments can be scheduled against all active resources. The protected
# server operation remains authoritative for overlap rejection.
assignments = "src/routes/app.admin.driver-assignments.tsx"
replace_once(
    assignments,
    "  Unplug,\n",
    "",
)
replace_once(
    assignments,
    'import { AdminShell } from "@/components/AdminShell";\n',
    'import { AdminShell } from "@/components/AdminShell";\nimport { AdminEndVehicleAssignmentDialog } from "@/components/fleet/AdminEndVehicleAssignmentDialog";\n',
)
replace_once(
    assignments,
    '''        <CreateAssignmentDialog
          vehicles={unassignedVehicles}
          drivers={unassignedDrivers}
          onCreated={() => setReload((value) => value + 1)}
        />''',
    '''        <CreateAssignmentDialog
          vehicles={vehicles.filter((vehicle) => vehicle.status === "active")}
          drivers={drivers}
          onCreated={() => setReload((value) => value + 1)}
        />''',
)
replace_once(
    assignments,
    '''                  <EndAssignmentButton
                    assignment={assignment}
                    onEnded={() => setReload((value) => value + 1)}
                  />''',
    '''                  <AdminEndVehicleAssignmentDialog
                    assignment={assignment}
                    onEnded={() => setReload((value) => value + 1)}
                  />''',
)
remove_between(
    assignments,
    "function EndAssignmentButton({",
    "function Metric(",
)

print("Phase 3 closeout wiring applied")
