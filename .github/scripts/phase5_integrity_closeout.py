from pathlib import Path
import re


def read(path: str) -> str:
    return Path(path).read_text()


def write(path: str, content: str) -> None:
    Path(path).write_text(content)


# Remove the legacy ride-id-only claim server function.
path = "src/lib/ride-driver.functions.ts"
text = read(path)
start = text.index("/** Atomically claim")
end = text.index("/** Start pickup")
write(path, text[:start] + text[end:])

# Remove the legacy unsynchronised cancellation client helper.
path = "src/lib/driver-rides.ts"
text = read(path)
marker = "\nexport async function cancelDriverRide"
start = text.index(marker)
write(path, text[:start].rstrip() + "\n")

# Remove the generic Driver cancellation action from the active-ride UI.
path = "src/components/driver/DriverActiveRide.tsx"
text = read(path)
text = text.replace(
    'import { cancelDriverRide, fetchDriverRide } from "@/lib/driver-rides";',
    'import { fetchDriverRide } from "@/lib/driver-rides";',
)
text, count = re.subn(
    r"\n  async function cancel\(\) \{.*?\n  \}\n\n  const fetchPassenger",
    "\n  const fetchPassenger",
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit("Could not remove the legacy Driver cancel handler")
text, count = re.subn(
    r"\n      \{ride\.status !== \"in_progress\" && \(\n        <Button variant=\"outline\" className=\"mt-2 w-full\" onClick=\{cancel\} disabled=\{busy\}>\n          Cancel\n        </Button>\n      \)\}",
    "",
    text,
    count=1,
)
if count != 1:
    raise SystemExit("Could not remove the generic Driver cancel button")
guidance = """
      <p className="mt-3 text-center text-xs text-muted-foreground">
        Need to stop or change the service? Use the operational decline, no-show, incident, or
        support actions so Operations can keep the Ride and operation run synchronized.
      </p>"""
anchor = """
      {ride.status === "in_progress" && (
        <Button className="mt-4 w-full" size="lg" onClick={onComplete} disabled={busy}>
          Complete trip
        </Button>
      )}"""
if anchor not in text:
    raise SystemExit("Could not locate active-ride completion action")
text = text.replace(anchor, anchor + guidance, 1)
write(path, text)

# Generated database types reflect the final schema after the closeout migration.
path = "src/integrations/supabase/types.ts"
text = read(path)
text = re.sub(
    r"^\s*driver_accept_ride: \{ Args: \{ p_ride_id: string \}; Returns: Json \}\n",
    "",
    text,
    flags=re.M,
)
text = re.sub(
    r"^\s*driver_cancel_ride: \{ Args: \{ p_ride_id: string \}; Returns: Json \}\n",
    "",
    text,
    flags=re.M,
)
write(path, text)

migration = r'''-- Phase 5 dispatch and cancellation integrity closeout.
-- Immediate Driver assignment is authoritative through dispatch offers only.
-- Drivers cannot independently cancel a Ride outside the operation state machine.

DO $closeout$
BEGIN
  IF to_regprocedure('public.driver_accept_ride(uuid)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.driver_accept_ride(uuid) FROM PUBLIC, anon, authenticated';
  END IF;
  IF to_regprocedure('public.driver_cancel_ride(uuid)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.driver_cancel_ride(uuid) FROM PUBLIC, anon, authenticated';
  END IF;
END
$closeout$;

DROP FUNCTION IF EXISTS public.driver_accept_ride(uuid);
DROP FUNCTION IF EXISTS public.driver_cancel_ride(uuid);

-- Keep the established dispatch-offer acceptance RPC as the only immediate
-- Driver assignment entry point.
REVOKE ALL ON FUNCTION public.driver_accept_dispatch_offer(uuid, integer, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_accept_dispatch_offer(uuid, integer, text)
  TO authenticated;

-- Inline Driver ownership checks into audit policies so no private helper must
-- be executable by ordinary authenticated clients.
DROP POLICY IF EXISTS "participants read status events" ON public.ride_status_events;
CREATE POLICY "participants read status events"
ON public.ride_status_events
FOR SELECT
TO authenticated
USING (
  private.has_role(auth.uid(), 'admin')
  OR EXISTS (
    SELECT 1
    FROM public.rides ride
    WHERE ride.id = ride_status_events.ride_id
      AND ride.passenger_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1
    FROM public.rides ride
    WHERE ride.id = ride_status_events.ride_id
      AND ride.driver_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "participants read change log" ON public.ride_change_log;
CREATE POLICY "participants read change log"
ON public.ride_change_log
FOR SELECT
TO authenticated
USING (
  private.has_role(auth.uid(), 'admin')
  OR EXISTS (
    SELECT 1
    FROM public.rides ride
    WHERE ride.id = ride_change_log.ride_id
      AND ride.passenger_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1
    FROM public.rides ride
    WHERE ride.id = ride_change_log.ride_id
      AND ride.driver_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "assigned driver acks change log" ON public.ride_change_log;
CREATE POLICY "assigned driver acks change log"
ON public.ride_change_log
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.rides ride
    WHERE ride.id = ride_change_log.ride_id
      AND ride.driver_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.rides ride
    WHERE ride.id = ride_change_log.ride_id
      AND ride.driver_id = auth.uid()
  )
);

DO $closeout$
BEGIN
  IF to_regprocedure('private.is_ride_driver(uuid,uuid)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION private.is_ride_driver(uuid,uuid) FROM PUBLIC, anon, authenticated';
  END IF;
END
$closeout$;

DROP FUNCTION IF EXISTS private.is_ride_driver(uuid, uuid);

NOTIFY pgrst, 'reload schema';
'''
write(
    "supabase/migrations/20260731184500_phase5_dispatch_cancellation_integrity.sql",
    migration,
)

tests = r'''import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = source(
  "supabase/migrations/20260731184500_phase5_dispatch_cancellation_integrity.sql",
);
const dispatchMigration = source("supabase/migrations/20260731131000_phase5_planning_dispatch.sql");
const driverFunctions = source("src/lib/ride-driver.functions.ts");
const driverReads = source("src/lib/driver-rides.ts");
const activeRide = source("src/components/driver/DriverActiveRide.tsx");
const operationsPanel = source("src/components/operations/DriverOperationsPanel.tsx");
const generatedTypes = source("src/integrations/supabase/types.ts");

function functionSection(sql: string, name: string) {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}`;
  const start = sql.indexOf(marker);
  expect(start, `${name} must exist`).toBeGreaterThanOrEqual(0);
  const rest = sql.slice(start + marker.length);
  const next = rest.search(/\nCREATE OR REPLACE FUNCTION /);
  return next === -1 ? sql.slice(start) : sql.slice(start, start + marker.length + next);
}

describe("Phase 5 dispatch and cancellation integrity closeout", () => {
  it("drops and revokes both legacy Driver ride-id mutation RPCs", () => {
    expect(migration).toContain("DROP FUNCTION IF EXISTS public.driver_accept_ride(uuid)");
    expect(migration).toContain("DROP FUNCTION IF EXISTS public.driver_cancel_ride(uuid)");
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.driver_accept_ride(uuid) FROM PUBLIC, anon, authenticated",
    );
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.driver_cancel_ride(uuid) FROM PUBLIC, anon, authenticated",
    );
  });

  it("removes every runtime source call to the legacy claim and cancel paths", () => {
    const runtime = [driverFunctions, driverReads, activeRide, operationsPanel].join("\n");
    expect(runtime).not.toContain("driver_accept_ride");
    expect(runtime).not.toContain("acceptRide");
    expect(runtime).not.toContain("driver_cancel_ride");
    expect(runtime).not.toContain("cancelDriverRide");
    expect(generatedTypes).not.toContain("driver_accept_ride:");
    expect(generatedTypes).not.toContain("driver_cancel_ride:");
  });

  it("keeps dispatch-offer acceptance as the sole immediate acceptance path", () => {
    expect(operationsPanel).toContain('rpc("driver_accept_dispatch_offer"');
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.driver_accept_dispatch_offer(uuid, integer, text)",
    );
    const acceptance = functionSection(dispatchMigration, "driver_accept_dispatch_offer");
    for (const contract of [
      "FOR UPDATE",
      "driver_user_id",
      "expires_at",
      "Another Driver accepted first",
      "operation_run_assignments",
      "dispatch_offer_events",
    ]) {
      expect(acceptance).toContain(contract);
    }
  });

  it("removes the generic Driver cancellation UI and preserves operational alternatives", () => {
    expect(activeRide).not.toContain("onClick={cancel}");
    expect(activeRide).not.toMatch(/>\s*Cancel\s*</);
    expect(activeRide).toContain("operational decline, no-show, incident");
    expect(operationsPanel).toContain('rpc("driver_decline_operation"');
    expect(operationsPanel).toContain('rpc("driver_report_no_show"');
    expect(operationsPanel).toContain('rpc("driver_report_incident"');
  });

  it("keeps Admin cancellation inside the operation state machine", () => {
    const cancellation = functionSection(dispatchMigration, "admin_cancel_operation");
    for (const contract of [
      "FOR UPDATE",
      "operation_runs",
      "operation_run_assignments",
      "dispatch_offers",
      "operation_run_events",
      "notification_outbox",
      "rides",
    ]) {
      expect(cancellation).toContain(contract);
    }
  });

  it("inlines Driver ownership and removes authenticated access to the private helper", () => {
    expect(migration).toContain("ride.driver_id = auth.uid()");
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION private.is_ride_driver(uuid,uuid) FROM PUBLIC, anon, authenticated",
    );
    expect(migration).toContain("DROP FUNCTION IF EXISTS private.is_ride_driver(uuid, uuid)");
    const policyDefinitions = migration.slice(
      migration.indexOf('DROP POLICY IF EXISTS "participants read status events"'),
      migration.indexOf("DO $closeout$", migration.indexOf('assigned driver acks change log')),
    );
    expect(policyDefinitions).not.toContain("private.is_ride_driver");
  });

  it("preserves Driver financial exclusion and reloads PostgREST", () => {
    expect(driverReads).toContain('supabase.rpc("driver_rides"');
    expect(driverReads).toContain('supabase.rpc("driver_ride"');
    for (const financial of [
      "estimated_price",
      "pricing_version_id",
      "estimate_snapshot",
      "deposit_amount",
      "payment",
    ]) {
      expect(driverReads).not.toContain(financial);
      expect(activeRide).not.toContain(financial);
    }
    expect(migration).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
'''
write("src/lib/phase5-dispatch-cancellation-integrity.test.ts", tests)
