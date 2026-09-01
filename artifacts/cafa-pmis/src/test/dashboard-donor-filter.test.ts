/**
 * DASH-DONOR-FILTER — the Dashboard's donor query filter (filters.donor) already
 * existed in the query-building and fail-closed "unsupported filter" logic, but
 * no UI control ever set it. This adds a Donor Select next to the Sector Select.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(__dirname, "../pages/dashboard.tsx"), "utf8");

describe("DASH-DONOR-FILTER — donor filter has a UI control", () => {
  it("imports and calls useListDonors in FilterBar", () => {
    expect(src).toContain("useListDonors");
    expect(src).toMatch(/const\s*\{\s*data:\s*donorsData\s*\}\s*=\s*useListDonors\(\)/);
  });

  it("renders a Select bound to filters.donor with a distinguishing aria-label", () => {
    expect(src).toMatch(/value=\{filters\.donor \?\? "all"\}/);
    expect(src).toContain('onChange({ ...filters, donor: v === "all" ? undefined : v })');
    expect(src).toContain('aria-label={t("filters.allDonors")}');
  });

  it("keeps the sector Select's aria-label distinct so tests/assistive tech can tell the two Selects apart", () => {
    expect(src).toContain('aria-label={t("filters.allSectors")}');
  });
});
