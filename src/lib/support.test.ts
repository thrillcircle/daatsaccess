import { describe, expect, it } from "vitest";
import {
  containsUrgentSupportLanguage,
  supportCategoryLabel,
  supportPriorityLabel,
  supportStatusLabel,
} from "@/lib/support";

describe("support helpers", () => {
  it("maps support values to readable labels", () => {
    expect(supportCategoryLabel("vehicle_issue")).toBe("Vehicle issue");
    expect(supportStatusLabel("waiting_for_user")).toBe("Waiting for user");
    expect(supportPriorityLabel("urgent")).toBe("Urgent");
  });

  it("detects urgent safety language", () => {
    expect(containsUrgentSupportLanguage("I am stranded and feel unsafe")).toBe(true);
    expect(containsUrgentSupportLanguage("I need help updating my profile")).toBe(false);
  });
});
