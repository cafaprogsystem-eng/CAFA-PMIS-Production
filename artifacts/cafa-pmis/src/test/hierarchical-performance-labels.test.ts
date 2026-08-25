import { describe, expect, it } from "vitest";
import { displayHierarchicalSectorLabel } from "../hooks/use-hierarchical-performance";

describe("hierarchical performance sector labels", () => {
  const unavailable = "Sector unavailable";

  it("preserves valid source labels", () => {
    expect(displayHierarchicalSectorLabel("Health", unavailable)).toBe("Health");
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["blank", "  "],
  ])("uses a localized fallback for a %s source label", (_name, label) => {
    const rendered = displayHierarchicalSectorLabel(label, unavailable);
    expect(rendered).toBe(unavailable);
    expect(rendered).not.toContain("hierarchical.");
    expect(rendered).not.toContain("undefined");
  });
});