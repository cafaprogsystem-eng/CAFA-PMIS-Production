/**
 * PROJ-STATUS-CONST — "active project" status checks share one constant.
 *
 * Before this file existed, dashboard.ts and performanceEngine.ts each
 * hand-wrote the "active/operational project" status list independently.
 * Two of those copies drifted to a narrower 2-status set
 * ('approved','active') while the rest — and the real per-state table in
 * the very same API response — used the correct 4-status set, so a single
 * sector-snapshot response could show two different "active projects"
 * counts for the same sector. Centralizing the list closes that drift at
 * the source: every consumer now imports the same constant, so a future
 * change to the definition can't silently apply to only some of them.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ACTIVE_PROJECT_STATUSES_SQL, AWAITING_PROJECT_APPROVAL_STATUSES_SQL } from "./projectStatusConstants";

const dashboardSrc = readFileSync(resolve(__dirname, "../routes/dashboard.ts"), "utf8");
const performanceEngineSrc = readFileSync(resolve(__dirname, "../services/performanceEngine.ts"), "utf8");

describe("PROJ-STATUS-CONST — shared active-project-status constant", () => {
  it("defines the canonical 4-status active set and 3-status awaiting-approval set", () => {
    expect(ACTIVE_PROJECT_STATUSES_SQL).toBe(
      "ARRAY['approved','coordination_approved','technically_approved','active']",
    );
    expect(AWAITING_PROJECT_APPROVAL_STATUSES_SQL).toBe(
      "ARRAY['submitted','technically_approved','coordination_approved']",
    );
  });

  it("dashboard.ts imports and uses the shared constant, not a re-written literal list", () => {
    expect(dashboardSrc).toContain("ACTIVE_PROJECT_STATUSES_SQL");
    expect(dashboardSrc).toContain("AWAITING_PROJECT_APPROVAL_STATUSES_SQL");
    // The narrower, previously-drifted 2-status set must not reappear anywhere.
    expect(dashboardSrc).not.toContain("p.status IN ('approved','active')");
    expect(dashboardSrc).not.toContain("p.status IN ('approved','coordination_approved','technically_approved','active')");
  });

  it("performanceEngine.ts imports and uses the shared constant, not a re-written literal list", () => {
    expect(performanceEngineSrc).toContain("ACTIVE_PROJECT_STATUSES_SQL");
    expect(performanceEngineSrc).not.toContain(
      "p.status IN ('approved','coordination_approved','technically_approved','active')",
    );
  });
});
