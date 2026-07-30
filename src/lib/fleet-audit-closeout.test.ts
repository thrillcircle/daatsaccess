import { describe, expect, it } from "vitest";
import { isAssignmentEffective } from "@/lib/fleet";

describe("Phase 3 fleet audit closeout", () => {
  it("treats scheduled assignments as effective only inside their time window", () => {
    const assignment = {
      status: "scheduled" as const,
      start_at: "2026-07-30T10:00:00.000Z",
      end_at: "2026-07-30T14:00:00.000Z",
    };

    expect(isAssignmentEffective(assignment, new Date("2026-07-30T09:59:59.999Z"))).toBe(false);
    expect(isAssignmentEffective(assignment, new Date("2026-07-30T10:00:00.000Z"))).toBe(true);
    expect(isAssignmentEffective(assignment, new Date("2026-07-30T13:59:59.999Z"))).toBe(true);
    expect(isAssignmentEffective(assignment, new Date("2026-07-30T14:00:00.000Z"))).toBe(false);
  });
});
