/**
 * PRJ-STATUS-FILTER-COMPLETE — the Projects page status filter dropdown was
 * missing completed/on_hold/returned/cancelled, even though the dashboard's
 * own STATUS_COLORS map already treats them as real, displayable project
 * statuses. Data in any of these statuses could never be found via the filter.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(__dirname, "../pages/projects.tsx"), "utf8");

describe("PRJ-STATUS-FILTER-COMPLETE — STATUSES includes every known project status", () => {
  it("includes completed, on_hold, returned and cancelled alongside the existing statuses", () => {
    const match = src.match(/const STATUSES = \[([^\]]+)\];/);
    expect(match).not.toBeNull();
    const statuses = match![1].split(",").map(s => s.trim().replace(/"/g, ""));
    for (const s of [
      "draft", "submitted", "state_reviewed", "technically_approved",
      "coordination_approved", "approved", "active", "completed",
      "on_hold", "returned", "closed", "cancelled", "rejected",
    ]) {
      expect(statuses).toContain(s);
    }
  });
});
