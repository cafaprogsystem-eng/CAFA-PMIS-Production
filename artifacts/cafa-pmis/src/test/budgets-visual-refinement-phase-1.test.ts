/**
 * Budgets Visual Refinement Phase 1 — visual contract sentinels.
 *
 * These source-level assertions protect presentation-only requirements without
 * duplicating the Budget module's financial calculations or API contracts.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sourcePath = (file: string) => resolve(process.cwd(), "src", file);
const budgetSource = readFileSync(sourcePath("pages/budget.tsx"), "utf8");
const dashboardSource = readFileSync(sourcePath("pages/dashboard.tsx"), "utf8");
const budgetLocale = readFileSync(sourcePath("locales/en/budget.json"), "utf8");

describe("BUD-VIS — Budget visual refinement phase 1", () => {
  it("BUD-VIS-01: keeps the landing hierarchy compact and grouped", () => {
    const pageBody = budgetSource.slice(budgetSource.indexOf("export default function BudgetPage"));
    expect(pageBody).toContain('<div className="space-y-4">');
    expect(pageBody).toContain('className="text-2xl font-medium tracking-tight"');
  });

  it("BUD-VIS-02: preserves genuine zero while unavailable currency remains a neutral marker", () => {
    expect(budgetSource).toContain('if (val == null) return "—";');
    expect(budgetSource).toContain('if (!curr) return "—";');
    expect(budgetSource).toContain('return formatCurrency(val, curr);');
  });

  it("BUD-VIS-03: does not present mixed currencies as a fabricated total", () => {
    expect(budgetLocale).toContain('"mixedCurrencyNotice": "Figures span multiple currencies — values cannot be combined.');
    expect(budgetSource).toContain('selectedCurrency !== "all"');
    expect(dashboardSource).toContain('if (activeCurrency === "all") return null;');
    expect(budgetSource).toContain('showMultiCurrency ? multiValue("totalBudget")');
  });

  it("BUD-VIS-04: gives every visible financial figure a currency basis", () => {
    expect(budgetSource).toContain('formatCurrency(val, curr)');
    expect(dashboardSource).toContain('t("budgetWorkspace.displayCurrency")');
  });

  it("BUD-VIS-05: takes selected-currency donor values from the per-currency breakdown", () => {
    expect(budgetSource).toContain('activeCurrency={selectedCurrency}');
    expect(budgetSource).toContain('onActiveCurrencyChange={setSelectedCurrency}');
    expect(dashboardSource).toContain('const bc = d.budgetByCurrency.find(b => b.currency === effectiveCurrency);');
  });

  it("BUD-VIS-06: keeps Project-Level Budget and State Allocation visibly distinct", () => {
    expect(dashboardSource).toContain('label={t("budgetWorkspace.budgetBasis")}');
    expect(dashboardSource).toContain('value="Project-Level Budget"');
    expect(dashboardSource).toContain('value="State Allocation"');
    expect(dashboardSource).toContain('t("budgetWorkspace.projectBasisContext")');
  });

  it("BUD-VIS-07: bounds identities and aligns scan-friendly numeric columns", () => {
    expect(dashboardSource).toContain('className="min-w-[900px]"');
    expect(dashboardSource).toContain('max-w-[16rem]');
    expect(dashboardSource).toContain('tabular-nums');
    expect(dashboardSource).toContain('max-w-[16rem]');
  });

  it("BUD-VIS-08: uses flexible, labelled filter controls", () => {
    expect(budgetSource).toContain('grid grid-cols-1 gap-2');
    expect(budgetSource).toContain('aria-label={t("filters.donor")}');
    expect(budgetSource).toContain('aria-label={t("filters.state")}');
    expect(budgetSource).toContain('aria-label={t("filters.sector")}');
    expect(budgetSource).toContain('aria-label={t("filters.projectStatus")}');
    expect(budgetSource).toContain('aria-label={t("filters.clear")}');
    expect(dashboardSource).toContain('aria-label={t("budgetWorkspace.filterDataAvailability")}');
  });

  it("BUD-VIS-09: protects wide budget tables with local overflow", () => {
    expect(dashboardSource).toContain('overflow-hidden overflow-x-auto" role="region" aria-label={t("budgetWorkspace.donorTable")}');
    expect(dashboardSource).toContain('aria-label={t("budgetWorkspace.projectTable")}');
  });

  it("BUD-VIS-10: distinguishes loading, error, filtered-empty, and genuine-empty states", () => {
    expect(budgetSource).toContain('isLoading ? (');
    expect(budgetSource).toContain(') : isError ? (');
    expect(budgetSource).toContain('t("sector.noDataForSector")');
    expect(dashboardSource).toContain('t("budgetWorkspace.noDonorsFiltered")');
    expect(dashboardSource).toContain('t("budgetWorkspace.noProjectsFiltered")');
  });

  it("BUD-VIS-11: does not restore a fabricated State budget proxy", () => {
    expect(dashboardSource).not.toMatch(/State Budget Utilisation Score|Budget Component|15% Budget Weight/i);
    expect(dashboardSource).toContain('t("budgetWorkspace.stateExpenditureUnavailable")');
    expect(budgetSource).toContain('t("sector.spo.scopeNote")');
  });

  it("BUD-VIS-12: keeps visual copy in the translation layer and leaves API behaviour untouched", () => {
    expect(budgetLocale).toContain('"mixedCurrencyNotice"');
    expect(budgetLocale).toContain('"summaryLoadError"');
    expect(budgetLocale).toContain('"donorLoadError"');
    expect(budgetSource).not.toContain("useMutation");
    expect(dashboardSource).not.toContain("useMutation");
  });
});