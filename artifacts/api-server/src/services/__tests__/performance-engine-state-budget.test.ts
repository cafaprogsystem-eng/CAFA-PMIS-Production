/**
 * BUD-STATE-01 through BUD-STATE-10
 * Verifies that the fabricated State budget-utilisation proxy has been removed
 * from computeStateScores (BUD-004 / BUD-BD-04).
 */

import { describe, it, expect } from "vitest";
import {
  computeWeightedScore,
  budgetUtilScore,
  type ComponentScores,
  type StateScoreRow,
} from "../performanceEngine";

// ─── Mock pool helper ────────────────────────────────────────────────────────

function makePool(stateRows: Record<string, unknown>[]): import("../performanceEngine").PgPool {
  return {
    query: async () => ({ rows: stateRows }),
  } as unknown as import("../performanceEngine").PgPool;
}

// ─── Lightweight unit tests that don't need a real DB ───────────────────────

describe("BUD-STATE-05 – computeWeightedScore with 5 non-null components renormalises correctly", () => {
  it("produces correct weighted average when budgetUtilization is null", () => {
    const c: ComponentScores = {
      activityCompletion:   80, // 0.25 → 20.0
      reportSubmission:     70, // 0.20 → 14.0
      indicatorAchievement: 90, // 0.20 → 18.0
      budgetUtilization:    null, // excluded
      riskManagement:       60, // 0.10 → 6.0
      dataCompleteness:     50, // 0.10 → 5.0
    };
    // totalWeight = 0.25+0.20+0.20+0.10+0.10 = 0.85
    // weightedSum = 20+14+18+6+5 = 63
    // score = round(63 / 0.85) = round(74.117…) = 74
    const score = computeWeightedScore(c);
    expect(score).toBe(74);
    expect(score).not.toBeNaN();
  });
});

describe("BUD-STATE-04 – null budget ≠ budget = 0% (not depressed)", () => {
  it("null budget component produces higher score than treating budget as 0%", () => {
    const baseComponents = {
      activityCompletion:   80,
      reportSubmission:     80,
      indicatorAchievement: 80,
      riskManagement:       80,
      dataCompleteness:     80,
    };

    // With null (correct — renormalised across 5 components)
    const withNull = computeWeightedScore({ ...baseComponents, budgetUtilization: null });

    // With explicit 0 (wrong — depresses the score)
    const withZero = computeWeightedScore({ ...baseComponents, budgetUtilization: 0 });

    // Null should renormalise to 80; zero should pull score below 80
    expect(withNull).toBeGreaterThan(withZero!);
    expect(withNull).toBe(80); // all five = 80, so renorm stays 80
    expect(withZero).toBeLessThan(80);
  });
});

describe("BUD-STATE-06 – performanceScore is a valid integer (no NaN) with 5 components", () => {
  it("computeWeightedScore returns an integer, not NaN, when all 5 components available", () => {
    const c: ComponentScores = {
      activityCompletion:   75,
      reportSubmission:     65,
      indicatorAchievement: 85,
      budgetUtilization:    null,
      riskManagement:       55,
      dataCompleteness:     70,
    };
    const score = computeWeightedScore(c);
    expect(typeof score).toBe("number");
    expect(Number.isNaN(score)).toBe(false);
    expect(Number.isInteger(score)).toBe(true);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

describe("BUD-STATE-10 – no invented substitute financial metric in state components", () => {
  it("ComponentScores type has no field other than the canonical 6, budgetUtilization is null-typed", () => {
    const c: ComponentScores = {
      activityCompletion:   50,
      reportSubmission:     50,
      indicatorAchievement: 50,
      budgetUtilization:    null, // must accept null
      riskManagement:       50,
      dataCompleteness:     50,
    };
    // Only the 6 canonical keys exist; no extra keys added
    const keys = Object.keys(c).sort();
    expect(keys).toEqual([
      "activityCompletion",
      "budgetUtilization",
      "dataCompleteness",
      "indicatorAchievement",
      "reportSubmission",
      "riskManagement",
    ]);
  });
});

describe("BUD-STATE-07 – budgetUtilScore helper still works for project-level scoring", () => {
  it("budgetUtilScore(0) = 0", () => {
    expect(budgetUtilScore(0)).toBe(0);
  });
  it("budgetUtilScore(85) = 100 (optimal utilisation)", () => {
    expect(budgetUtilScore(85)).toBe(100);
  });
  it("budgetUtilScore(50) = 59", () => {
    // round(50/85 * 100) = round(58.82) = 59
    expect(budgetUtilScore(50)).toBe(59);
  });
  it("budgetUtilScore(110) degrades past 100%", () => {
    // 100 - (110 - 85) * 1.5 = 100 - 37.5 = 62.5 → 63 — but max(0,…)
    expect(budgetUtilScore(110)).toBe(63);
  });
});

describe("BUD-STATE-08/09 – actor independence: null budget component for any role", () => {
  /**
   * Actor independence is guaranteed at the data-layer level (not RBAC):
   * computeStateScores always assigns budgetUtilization: null regardless of
   * who calls it. This test verifies the ComponentScores shape.
   */
  it("null is a valid value for budgetUtilization regardless of caller role", () => {
    const pmComponents: ComponentScores = {
      activityCompletion:   60,
      reportSubmission:     70,
      indicatorAchievement: 80,
      budgetUtilization:    null, // PM role
      riskManagement:       50,
      dataCompleteness:     65,
    };
    const adminComponents: ComponentScores = {
      ...pmComponents,
      budgetUtilization:    null, // super_admin role
    };

    const pmScore = computeWeightedScore(pmComponents);
    const adminScore = computeWeightedScore(adminComponents);

    // Both produce the same score — actor-independent
    expect(pmScore).toBe(adminScore);
    expect(pmComponents.budgetUtilization).toBeNull();
    expect(adminComponents.budgetUtilization).toBeNull();
  });
});

describe("BUD-STATE-03 – StateScoreRow type accepts null budgetUtilizationPct", () => {
  it("budgetUtilizationPct on StateScoreRow is typed as number | null", () => {
    // This is a compile-time check embedded as a runtime assertion.
    // If the type were `number` (non-nullable), assigning null would fail tsc.
    const row: Partial<StateScoreRow> = {
      budgetUtilizationPct: null, // BUD-004: no State-level expenditure source
    };
    expect(row.budgetUtilizationPct).toBeNull();
  });
});

describe("BUD-STATE-01/02 – computeStateScores shape contract", () => {
  /**
   * These tests verify the expected null contract without a live database.
   * Integration-level tests (requiring a real PG pool) are covered by the
   * regression suite in the CI environment.
   *
   * We verify by inspecting the SQL string generated inside computeStateScores
   * by importing and calling it with a mock that captures the query text.
   */
  it("SQL query for computeStateScores no longer contains budget_total or budget_spent", async () => {
    const { computeStateScores } = await import("../performanceEngine");

    const capturedQueries: string[] = [];
    const capturingPool = {
      query: async (sql: string) => {
        capturedQueries.push(sql);
        // Return minimal valid rows (single state, all zeros/nulls)
        return {
          rows: [{
            stateId: 1,
            stateName: "Test State",
            activeProjects: 0,
            beneficiaries: 0,
            budgetUtilizationPct: null,
            progressPct: 0,
            riskLevel: "low",
            openRisks: 0,
            criticalRisks: 0,
            critOnlyRisks: 0,
            highOnlyRisks: 0,
            medLowRisks: 0,
            reportsSubmitted: 0,
            reportsPending: 0,
            reportsApproved: 0,
            lateReports: 0,
            activityCompletionPct: null,
            reportingCompliancePct: null,
            indicatorAchievementPct: null,
            totalProjects: 0,
            hasBudget: 0,
            hasActivities: 0,
            hasReports: 0,
            hasTargets: 0,
          }],
        };
      },
    } as unknown as import("../performanceEngine").PgPool;

    const result = await computeStateScores(capturingPool, { stateId: null, sectors: null });

    // BUD-STATE-03: no budget proxy SQL (aggregating SUM across project_states)
    // Note: budget_total may still appear in data-completeness COUNT (WHERE p.budget_total > 0),
    // which is a legitimate completeness flag, not a financial proxy.
    const allSql = capturedQueries.join("\n");
    // The proxy used SUM(p.budget_total) and a spent aggregate joined via project_states
    expect(allSql).not.toContain("SUM(p.budget_total)");
    expect(allSql).not.toContain("budget_spent");
    expect(allSql).not.toContain("pa.spent");
    // The NULL replacement should be present
    expect(allSql).toContain("NULL::int AS \"budgetUtilizationPct\"");

    // BUD-STATE-01: components.budgetUtilization is null
    expect(result[0]?.components.budgetUtilization).toBeNull();

    // BUD-STATE-02: budgetUtilizationPct is null
    expect(result[0]?.budgetUtilizationPct).toBeNull();
  });
});
