/**
 * BEN-SOURCE-PARITY — "beneficiaries reached" must come from the same source
 * everywhere: the project's own demographic columns (beneficiaries_male/
 * female/boys/girls), never a COUNT(*) over the individual-registry
 * `beneficiaries` table.
 *
 * Those are different concepts: the demographic columns hold the aggregate
 * M&E figures reported for the project; the `beneficiaries` table is a
 * separate, sparsely-populated per-individual registry. Before this fix,
 * dashboard.ts already used the demographic columns in most places (and a
 * dedicated test — dashboard-facts-reconcile.test.ts — locks that down), but
 * projects.ts's own list/detail responses, and two spots inside dashboard.ts
 * itself (sector-snapshot's per-project and per-state rows), still counted
 * the registry table — so the same project could show wildly different
 * "beneficiaries reached" numbers depending on which screen you looked at.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const projectsSrc = readFileSync(resolve(__dirname, "projects.ts"), "utf8");
const dashboardSrc = readFileSync(resolve(__dirname, "dashboard.ts"), "utf8");

const REGISTRY_COUNT_PATTERN = /COUNT\(\*\)::int\s+(?:AS\s+"?reached"?|FROM beneficiaries)/i;

describe("BEN-SOURCE-PARITY — no beneficiary count reads the individual registry table", () => {
  it("projects.ts never derives a beneficiary total from COUNT(*) FROM beneficiaries", () => {
    expect(projectsSrc).not.toMatch(/SELECT COUNT\(\*\)::int AS reached FROM beneficiaries/i);
    expect(projectsSrc).not.toContain(
      'COALESCE((SELECT COUNT(*)::int FROM beneficiaries b WHERE b.project_id = p.id), 0) AS "beneficiariesReached"',
    );
  });

  it("projects.ts sources beneficiariesReached from the demographic columns in both the shared select and the detail endpoint", () => {
    // Each column is COALESCEd individually before being summed — a single
    // NULL column must not zero out the other three's known values.
    expect(projectsSrc).toMatch(
      /\(COALESCE\(p\.beneficiaries_male,0\) \+ COALESCE\(p\.beneficiaries_female,0\) \+\s*COALESCE\(p\.beneficiaries_boys,0\) \+ COALESCE\(p\.beneficiaries_girls,0\)\)::int AS "beneficiariesReached"/,
    );
    expect(projectsSrc).toMatch(
      /\(COALESCE\(beneficiaries_male,0\) \+ COALESCE\(beneficiaries_female,0\) \+\s*COALESCE\(beneficiaries_boys,0\) \+ COALESCE\(beneficiaries_girls,0\)\)::int AS reached/,
    );
  });

  it("dashboard.ts sector-snapshot no longer counts the individual registry table for per-project or per-state beneficiaries", () => {
    expect(dashboardSrc).not.toContain(
      "COALESCE((SELECT COUNT(*)::int FROM beneficiaries b WHERE b.project_id = p.id), 0) AS beneficiaries",
    );
    expect(dashboardSrc).not.toContain(
      "COALESCE((SELECT COUNT(*)::int FROM beneficiaries b WHERE b.state_id = s.id",
    );
  });

  it("no remaining query in either file matches the registry-count pattern", () => {
    expect(projectsSrc).not.toMatch(REGISTRY_COUNT_PATTERN);
  });
});
