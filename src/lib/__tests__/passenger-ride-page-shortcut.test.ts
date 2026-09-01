import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "src/routes/app.passenger.index.tsx"), "utf8");

describe("passenger Ride page", () => {
  it("no longer advertises becoming a driver", () => {
    expect(source).not.toContain("Drive with Access");
    expect(source).not.toContain("Become a driver");
  });

  it("no longer self-inserts a driver role", () => {
    expect(source).not.toContain('.from("user_roles")');
  });

  it("shows an active-trip shortcut linking to Trip Details", () => {
    expect(source).toContain("Your active trip");
    expect(source).toContain("Open Trip Details for your driver, journey and payment information.");
    expect(source).toContain("View trip details");
    expect(source).toContain("`/app/trip/${ride.id}`");
  });
});
