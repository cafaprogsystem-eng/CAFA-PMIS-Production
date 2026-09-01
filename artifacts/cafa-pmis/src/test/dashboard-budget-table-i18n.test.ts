/**
 * DASH-BUDGET-I18N — the Project Budget Performance table (table view mode)
 * had several hardcoded English strings that bypassed the translation system:
 * the two Project-Level-Budget tooltip sentences, the raw "Project-Level
 * Budget"/"State Allocation" budgetBasis value shown verbatim instead of a
 * translated label, the "Project-Level Expenditure" label + note, and the
 * "State-level Expenditure data is unavailable…" notice. These are now all
 * routed through t().
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const dashboardSrc = readFileSync(resolve(__dirname, "../pages/dashboard.tsx"), "utf8");
const enDashboard = JSON.parse(readFileSync(resolve(__dirname, "../locales/en/dashboard.json"), "utf8"));
const arDashboard = JSON.parse(readFileSync(resolve(__dirname, "../locales/ar/dashboard.json"), "utf8"));

describe("DASH-BUDGET-I18N — budget workspace table strings are translated", () => {
  it("no longer hardcodes the Project-Level Budget tooltip sentences", () => {
    expect(dashboardSrc).not.toContain("The displayed amount is the complete Project Budget and does not represent an exclusive Sector allocation.");
    expect(dashboardSrc).not.toContain("The displayed Budget and Expenditure are Project-level financial values and do not represent amounts allocated or spent exclusively in this State.");
    expect(dashboardSrc).toContain('t("budgetWorkspace.projectLevelBudgetTcTooltip")');
    expect(dashboardSrc).toContain('t("budgetWorkspace.projectLevelBudgetSpoTooltip")');
  });

  it("displays a translated budgetBasis label instead of the raw value, without changing the underlying comparisons", () => {
    expect(dashboardSrc).toContain("const formatBudgetBasisLabel = (basis: string) =>");
    expect(dashboardSrc).toContain("formatBudgetBasisLabel(row.budgetBasis)");
    // The comparison against the raw English value must still work — it drives
    // conditional tooltip rendering and must not be translated.
    expect(dashboardSrc).toContain('row.budgetBasis === "Project-Level Budget"');
  });

  it("no longer hardcodes the Project-Level Expenditure label/note or the state-expenditure-unavailable notice", () => {
    expect(dashboardSrc).not.toContain(">Project-Level Expenditure<");
    expect(dashboardSrc).not.toContain("Complete Project — not exclusive to this State.");
    expect(dashboardSrc).not.toContain("State-level Expenditure data is unavailable. Spent, Remaining Balance and Utilisation Rate are not shown for State Allocation rows.");
    expect(dashboardSrc).toContain('t("budgetWorkspace.projectLevelExpenditureLabel")');
    expect(dashboardSrc).toContain('t("budgetWorkspace.projectLevelExpenditureNote")');
    expect(dashboardSrc).toContain('t("budgetWorkspace.stateExpenditureUnavailableNote")');
  });

  it("every new key exists in both English and Arabic locale files", () => {
    for (const key of [
      "projectLevelBudgetTcTooltip", "projectLevelBudgetSpoTooltip",
      "projectLevelExpenditureLabel", "projectLevelExpenditureNote",
      "stateExpenditureUnavailableNote",
    ]) {
      expect(enDashboard.budgetWorkspace[key]).toBeTruthy();
      expect(arDashboard.budgetWorkspace[key]).toBeTruthy();
    }
  });
});
