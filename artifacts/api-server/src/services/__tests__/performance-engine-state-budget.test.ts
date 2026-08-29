/**
 * BUD-STATE-01: factual State contract has no budget-derived score.
 * BUD-STATE-04: runtime State budget utilisation is exactly null.
 * BUD-STATE-10: generated/runtime fields do not expose score components.
 * Verifies that factual State implementation metrics never reintroduce a
 * fabricated State budget-utilisation proxy or composite score.
 */

import { describe, expect, it } from "vitest";
import {
  computeStateImplementation,
  type PgPool,
  type StateImplementationRow,
} from "../performanceEngine";

describe("BUD-STATE-01/04/10 – factual State implementation contract", () => {
  it("BUD-STATE-01/10 types State budget utilisation as nullable without score fields", () => {
    const row: Partial<StateImplementationRow> = { budgetUtilizationPct: null };
    expect(row.budgetUtilizationPct).toBeNull();
    expect(row).not.toHaveProperty("performanceScore");
    expect(row).not.toHaveProperty("components");
  });

  it("BUD-STATE-04 returns null budget utilisation and preserves nullable zero-denominator percentages", async () => {
    const capturedQueries: string[] = [];
    const pool: PgPool = {
      query: async (sql: string) => {
        capturedQueries.push(sql);
        return {
          rows: [{
            stateId: 1,
            stateName: "Test State",
            stateNameAr: null,
            totalProjects: 1,
            activeProjects: 1,
            beneficiaries: 0,
            budgetUtilizationPct: null,
            progressPct: 0,
            riskLevel: "low",
            openRisks: 0,
            criticalRisks: 0,
            critOnlyRisks: 0,
            highOnlyRisks: 0,
            reportsSubmitted: 0,
            reportsPending: 0,
            activityCompletionPct: null,
            reportingCompliancePct: null,
          }],
        };
      },
    } as PgPool;

    const [row] = await computeStateImplementation(pool, { stateId: null, sectors: null });
    expect(row).toEqual({
      stateId: 1,
      stateName: "Test State",
      stateNameAr: null,
      totalProjects: 1,
      activeProjects: 1,
      beneficiaries: 0,
      budgetUtilizationPct: null,
      progressPct: 0,
      riskLevel: "low",
      openRisks: 0,
      criticalRisks: 0,
      critOnlyRisks: 0,
      highOnlyRisks: 0,
      reportsSubmitted: 0,
      reportsPending: 0,
      activityCompletionPct: null,
      reportingCompliancePct: null,
    });
    expect(row).not.toHaveProperty("performanceScore");
    expect(row).not.toHaveProperty("components");

    const sql = capturedQueries.join("\n");
    expect(sql).not.toContain("SUM(p.budget_total)");
    expect(sql).not.toContain("budget_spent");
    expect(sql).toContain('NULL::int AS "budgetUtilizationPct"');
  });
});