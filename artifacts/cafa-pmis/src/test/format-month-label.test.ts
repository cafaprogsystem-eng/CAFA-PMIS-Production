/**
 * Chart month labels follow the UI language whatever the API sends for the
 * free-string `month` field — "YYYY-MM" keys or English month names.
 */
import { describe, it, expect } from "vitest";
import { formatMonthLabel } from "@/lib/format";

describe("formatMonthLabel", () => {
  it("localises English month names and abbreviations", () => {
    expect(formatMonthLabel("Sep", "ar")).toBe("سبتمبر");
    expect(formatMonthLabel("September", "ar")).toBe("سبتمبر");
    expect(formatMonthLabel("oct", "en")).toBe("Oct");
  });

  it("localises the project budget series' 'Mon YY' labels", () => {
    expect(formatMonthLabel("Sep 26", "ar")).toBe("سبتمبر 26");
    expect(formatMonthLabel("Sep 26", "en")).toBe("Sep 26");
  });

  it("localises YYYY-MM and YYYY-MM-DD keys, optionally with the year", () => {
    expect(formatMonthLabel("2026-01", "ar")).toBe("يناير");
    expect(formatMonthLabel("2026-01-15", "en")).toBe("Jan");
    expect(formatMonthLabel("2026-01", "ar", true)).toBe("يناير 2026");
  });

  it("leaves anything else unchanged", () => {
    expect(formatMonthLabel("Q3", "ar")).toBe("Q3");
    expect(formatMonthLabel("Marathon", "ar")).toBe("Marathon");
    expect(formatMonthLabel(undefined, "ar")).toBe("");
  });
});
