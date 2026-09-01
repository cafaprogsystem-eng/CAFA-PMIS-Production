/**
 * PROJ-SPENT-SOURCE — project-detail.tsx must show "amount spent" from one
 * source only: budgetSpent (the project's own budget ledger).
 *
 * The KPI strip used to switch sources depending on whether the project had
 * submitted reports: kpis.totalActualExpenditure (aggregated from Project
 * Reports) when reportCount > 0, or budgetSpent otherwise. Those two could
 * diverge, so the same project could show a different "amount spent" on
 * this KPI strip than on its own Budget tab a few tabs over, with no
 * indication to the user that they came from different places.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(resolve(__dirname, "../pages/project-detail.tsx"), "utf8");

describe("PROJ-SPENT-SOURCE — single spend source in project-detail.tsx", () => {
  it("no longer reads kpis.burnRatePct or kpis.totalActualExpenditure for display", () => {
    expect(SRC).not.toContain("kpis.burnRatePct");
    expect(SRC).not.toContain("kpis.totalActualExpenditure");
  });

  it("computes burn rate from budgetSpent/budgetTotal and shows budgetSpent as the spent amount", () => {
    expect(SRC).toContain(
      "const budgetUtilizationPct = budgetTotal > 0 ? Math.round((budgetSpent / budgetTotal) * 100) : null;",
    );
    expect(SRC).toContain("value={budgetUtilizationPct !== null ? `${budgetUtilizationPct}%` : \"—\"}");
    expect(SRC).toContain('sub={`${formatCurrency(budgetSpent, projectCurrency)} ${t("detail.spentLabel").toLowerCase()}`}');
  });
});
