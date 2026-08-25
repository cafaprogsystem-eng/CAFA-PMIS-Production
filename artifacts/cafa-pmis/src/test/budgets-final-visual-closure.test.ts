/**
 * BUD-FINAL-VIS — Current-head cross-phase visual closure sentinels.
 *
 * These assertions protect the user-visible financial truth and accessibility
 * contracts established by the two visual-refinement phases. They deliberately
 * avoid API, mutation, permission, calculation, and data-contract behaviour.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { formatPercent } from "@/lib/format";
import {
  formatBudgetLineLevel,
  formatProjectBudgetMoney,
  projectBurnRate,
  resolveProjectCurrency,
} from "@/lib/budget-presentation";

const here = (file: string) => resolve(__dirname, file);
const budgetSource = readFileSync(here("../pages/budget.tsx"), "utf8");
const dashboardSource = readFileSync(here("../pages/dashboard.tsx"), "utf8");
const detailSource = readFileSync(here("../pages/project-detail.tsx"), "utf8");

describe("BUD-FINAL-VIS — Budgets final visual closure", () => {
  it("BUD-FINAL-VIS-01: preserves the compact landing, labelled filters, and local table overflow from Phase 1", () => {
    expect(budgetSource).toContain('className="text-2xl font-medium tracking-tight"');
    expect(dashboardSource).toContain('aria-label={t("budgetWorkspace.donorToolbar")}');
    expect(budgetSource).toContain('aria-label={t("filters.clear")}');
    expect(dashboardSource).toContain('aria-label={t("budgetWorkspace.donorTable")}');
  });

  it("BUD-FINAL-VIS-02: preserves Project Budget and Recorded State Allocation hierarchy from Phase 2", () => {
    expect(detailSource).toContain('t("detail.projectBudget")');
    expect(detailSource).toContain('t("detail.allocationTitle")');
    expect(detailSource).toContain('t("detail.stateAllocationContextDescription")');
  });

  it("BUD-FINAL-VIS-03: keeps Project-Level Budget and State Allocation explicit without an equal-share presentation", () => {
    expect(dashboardSource).toContain('value="Project-Level Budget"');
    expect(dashboardSource).toContain('value="State Allocation"');
    expect(detailSource).not.toMatch(/budgetTotal\s*\/\s*stateAllocations\.length|equal share|per-state budget/i);
  });

  it("BUD-FINAL-VIS-04: never presents a State expenditure, remaining balance, or utilisation from allocation rows", () => {
    expect(detailSource).not.toMatch(/alloc\.(spent|budgetSpent|remaining|utilisation|utilization)/i);
    expect(dashboardSource).toContain('t("budgetWorkspace.stateExpenditureUnavailable")');
  });

  it("BUD-FINAL-VIS-05: gives money a known Project currency basis and fails closed for unsupported codes", () => {
    expect(resolveProjectCurrency(" usd ")).toBe("USD");
    expect(resolveProjectCurrency("INVALID")).toBeNull();
    expect(formatProjectBudgetMoney(1_250, undefined)).toBe("—");
    expect(formatProjectBudgetMoney(1_250, "INVALID")).toBe("—");
    expect(formatProjectBudgetMoney(1_250, "USD")).toContain("USD");
  });

  it("BUD-FINAL-VIS-06: keeps unavailable, zero, and zero-denominator utilisation distinct", () => {
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(0)).toBe("0%");
    expect(projectBurnRate(0, 0)).toBeNull();
    expect(projectBurnRate(0, 101)).toBeNull();
    expect(projectBurnRate(100, 0)).toBe(0);
    expect(projectBurnRate(100, 120)).toBe(120);
  });

  it("BUD-FINAL-VIS-07: preserves overspend and negative remaining values with non-colour text", () => {
    expect(detailSource).toContain("const isOverspent = utilisation !== null && utilisation > 100;");
    expect(detailSource).toContain('t("detail.overBudget")');
    expect(detailSource).toContain("const hasNegativeRemaining = remaining < 0;");
    expect(detailSource).toContain('t("detail.negativeRemaining")');
  });

  it("BUD-FINAL-VIS-08: keeps mixed-currency values separated instead of inventing a combined total", () => {
    expect(budgetSource).toContain('selectedCurrency !== "all"');
    expect(dashboardSource).toContain('if (activeCurrency === "all") return null;');
    expect(budgetSource).toContain('showMultiCurrency ? multiValue("totalBudget")');
    expect(dashboardSource).toContain('t("budgetTab.multipleCurrencies")');
  });

  it("BUD-FINAL-VIS-09: distinguishes loading, error, empty, and retry states across the Budget journey", () => {
    expect(budgetSource).toContain(') : isError ? (');
    expect(budgetSource).toContain('t("sector.loadError")');
    expect(dashboardSource).toContain('t("budgetWorkspace.donorLoadTitle")');
    expect(detailSource).toContain('aria-busy="true"');
    expect(detailSource).toContain('onRetry={() => refetchStateAllocations()}');
  });

  it("BUD-FINAL-VIS-10: retains responsive overflow boundaries and accessible controls", () => {
    expect(dashboardSource).toContain('aria-label={t("budgetWorkspace.donorTable")}');
    expect(dashboardSource).toContain('aria-label={t("budgetWorkspace.projectTable")}');
    expect(detailSource).toContain('<div className="overflow-x-auto">');
    expect(dashboardSource).toContain('aria-label={t("budgetWorkspace.filterBudgetBasis")}');
  });

  it("BUD-FINAL-VIS-11: maps project budget-line levels to readable labels instead of exposing raw enum values", () => {
    expect(formatBudgetLineLevel("output")).toBe("Output");
    expect(formatBudgetLineLevel("activity")).toBe("Activity");
    expect(formatBudgetLineLevel("custom_level")).toBe("custom level");
  });

  it("BUD-FINAL-VIS-12: leaves the visual closure free of new mutation or direct backend request paths", () => {
    expect(budgetSource).not.toContain("useMutation");
    expect(dashboardSource).not.toContain("useMutation");
    expect(detailSource).not.toMatch(/fetch\([^)]*state-allocations/);
  });
});