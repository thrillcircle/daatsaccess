import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AdminShell } from "@/components/AdminShell";
import { Badge } from "@/components/ui/badge";
import { listAdminVehicleShifts, type AdminVehicleShift } from "@/lib/architecture-closeout";

export const Route = createFileRoute("/app/admin/vehicle-shifts")({
  head: () => ({ meta: [{ title: "Vehicle Shifts — Access Admin" }] }),
  component: AdminVehicleShifts,
});
function AdminVehicleShifts() {
  const [rows, setRows] = useState<AdminVehicleShift[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    listAdminVehicleShifts()
      .then(setRows)
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : "Could not load shifts"))
      .finally(() => setLoading(false));
  }, []);
  return (
    <AdminShell
      title="Vehicle Shifts"
      subtitle="Active and completed driver vehicle checks, mileage and handovers."
    >
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading vehicle shifts…</p>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <article key={row.id} className="rounded-2xl border bg-card p-4 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="font-semibold">
                    {row.driverName || "Unnamed driver"} · {row.vehicleName}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {row.licensePlate} · Started {new Date(row.startedAt).toLocaleString()}
                  </p>
                  <p className="mt-1 text-sm">
                    Mileage: {row.startOdometerKm}
                    {row.endOdometerKm != null ? ` → ${row.endOdometerKm} km` : " km (active)"}
                  </p>
                  {row.startNotes && <p className="mt-2 text-sm">Start: {row.startNotes}</p>}
                  {row.endNotes && <p className="text-sm">End: {row.endNotes}</p>}
                  {row.handoverNotes && <p className="text-sm">Handover: {row.handoverNotes}</p>}
                </div>
                <Badge variant={row.status === "active" ? "default" : "secondary"}>
                  {row.status}
                </Badge>
              </div>
            </article>
          ))}
          {!rows.length && (
            <p className="rounded-xl border p-8 text-center text-sm text-muted-foreground">
              No vehicle shifts recorded yet.
            </p>
          )}
        </div>
      )}
    </AdminShell>
  );
}
