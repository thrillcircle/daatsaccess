import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DRIVER_NAV, isNavActive } from "@/components/AppShell";
import {
  DRIVER_TERMINAL_OPERATION_STATUSES,
  DRIVER_UPCOMING_ASSIGNMENT_STATUSES,
  dayBucket,
} from "@/components/driver/driver-utils";
import { DRIVER_RIDE_COLUMNS } from "@/hooks/use-driver-work";

const read = (p: string) => readFileSync(p, "utf8");

describe("Phase 5 driver hub navigation closeout", () => {
  it("exposes three distinct driver routes plus profile", () => {
    const targets = DRIVER_NAV.map((n) => n.to);
    expect(targets).toEqual([
      "/app/driver",
      "/app/driver/upcoming",
      "/app/driver/history",
      "/app/profile",
    ]);
    expect(new Set(targets).size).toBe(4);
  });

  it("has no driver hash navigation left", () => {
    expect(DRIVER_NAV.some((n) => n.hash)).toBe(false);
    expect(read("src/components/AppShell.tsx")).not.toContain('hash: "upcoming"');
    expect(read("src/components/AppShell.tsx")).not.toContain('hash: "history"');
  });

  it("highlights only the matching driver tab", () => {
    const drive = DRIVER_NAV[0];
    const upcoming = DRIVER_NAV[1];
    const history = DRIVER_NAV[2];
    expect(isNavActive("/app/driver", drive)).toBe(true);
    expect(isNavActive("/app/driver/upcoming", drive)).toBe(false);
    expect(isNavActive("/app/driver/upcoming", upcoming)).toBe(true);
    expect(isNavActive("/app/driver/history", history)).toBe(true);
    expect(isNavActive("/app/driver/history", upcoming)).toBe(false);
  });

  it("keeps the full history list off the Drive page", () => {
    const drive = read("src/routes/app.driver.index.tsx");
    expect(drive).not.toContain("useDriverHistory");
    expect(drive).not.toContain("DriverHistory");
    expect(drive).toContain("limit={3}");
    expect(drive).toContain("/app/driver/upcoming");
  });

  it("keeps the protected Phase 5 driver APIs in use", () => {
    const panel = read("src/components/operations/DriverOperationsPanel.tsx");
    for (const rpc of [
      "driver_accept_dispatch_offer",
      "driver_decline_dispatch_offer",
      "driver_acknowledge_operation",
      "driver_transition_operation",
    ]) {
      expect(panel).toContain(rpc);
    }
    expect(read("src/routes/app.driver.index.tsx")).toContain("DriverOperationsPanel");
    expect(read("src/hooks/use-live-location.ts")).toContain("driver_update_location");
  });

  it("excludes terminal statuses from upcoming work", () => {
    for (const status of DRIVER_TERMINAL_OPERATION_STATUSES) {
      expect(DRIVER_UPCOMING_ASSIGNMENT_STATUSES).not.toContain(
        status as unknown as (typeof DRIVER_UPCOMING_ASSIGNMENT_STATUSES)[number],
      );
    }
    const hook = read("src/hooks/use-driver-work.ts");
    expect(hook).toContain("DRIVER_TERMINAL_OPERATION_STATUSES");
    // upcoming filters terminal runs out, history keeps only terminal runs
    expect(hook).toContain(
      "!(DRIVER_TERMINAL_OPERATION_STATUSES as readonly string[]).includes(r.operational_status)",
    );
  });

  it("excludes active and future work from history", () => {
    const history = read("src/routes/app.driver.history.tsx");
    expect(history).toContain("useDriverHistory");
    expect(history).not.toContain("useDriverUpcoming");
    const hook = read("src/hooks/use-driver-work.ts");
    expect(hook).toContain('.in("status", ["completed", "cancelled"])');
  });

  it("keeps financial fields out of driver views", () => {
    const financial = ["estimated_price", "estimate_snapshot", "pricing_version_id", "deposit"];
    for (const field of financial) {
      expect(DRIVER_RIDE_COLUMNS).not.toContain(field);
    }
    for (const file of [
      "src/routes/app.driver.tsx",
      "src/routes/app.driver.index.tsx",
      "src/routes/app.driver.upcoming.tsx",
      "src/routes/app.driver.history.tsx",
      "src/hooks/use-driver-work.ts",
    ]) {
      const src = read(file);
      for (const field of [...financial, "commission", "earnings", "quote_total"]) {
        expect(src).not.toContain(field);
      }
    }
  });

  it("buckets upcoming work by day", () => {
    const now = Date.parse("2026-07-31T09:00:00Z");
    expect(dayBucket("2026-07-31T18:00:00Z", now)).toBe("today");
    expect(dayBucket("2026-08-01T06:00:00Z", now)).toBe("tomorrow");
    expect(dayBucket("2026-08-05T06:00:00Z", now)).toBe("later");
    expect(dayBucket(null, now)).toBe("later");
  });
});
