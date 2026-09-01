/**
 * BUDGET-ALLOC-EXPORT — the Project Budget Workbook's "State Allocations" sheet
 * was a permanent stub: buildProjectBudgetWorkbook hardcoded ["No state
 * allocations recorded yet"] and its only caller (budget.tsx's Excel export)
 * never supplied real data, even for a project with real
 * project_state_allocations rows. budget.tsx now fetches
 * useListProjectStateAllocations(projectId) and threads it through to the
 * workbook builder; the builder renders real rows when present and falls back
 * to the original stub only when there truly are none.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildProjectBudgetWorkbook } from "@/lib/budget-workbook";

const budgetSrc = readFileSync(resolve(__dirname, "../pages/budget.tsx"), "utf8");

describe("BUDGET-ALLOC-EXPORT: State Allocations sheet uses real project_state_allocations data", () => {
  it("budget.tsx fetches useListProjectStateAllocations and threads it into the Excel export", () => {
    expect(budgetSrc).toContain("useListProjectStateAllocations");
    expect(budgetSrc).toMatch(/const \{ data: stateAllocations \} = useListProjectStateAllocations\(projectId\)/);
    expect(budgetSrc).toContain("stateAllocations,");
  });

  it("ExcelExportData carries an optional stateAllocations field through to buildProjectBudgetWorkbook", () => {
    expect(budgetSrc).toContain("stateAllocations?: Array<{");
    expect(budgetSrc).toContain("stateAllocations: opts.stateAllocations,");
  });

  it("real allocations render as actual rows instead of the stub message", () => {
    const sheets = buildProjectBudgetWorkbook({
      projectCode: "CAFA-PRJ-01",
      projectTitle: "Safe water access",
      currency: "USD",
      total: 1000,
      spent: 200,
      remaining: 800,
      burnRatePct: 20,
      alerts: [],
      lines: [],
      stateAllocations: [
        { stateName: "Khartoum", budgetAllocation: 600, beneficiaryTarget: 500, notes: "Primary site" },
        { stateName: "Kassala", budgetAllocation: 400, beneficiaryTarget: 300, notes: null },
      ],
    });
    const allocationSheet = sheets.find((s) => s.sheet === "State Allocations");
    expect(allocationSheet).toBeDefined();
    expect(allocationSheet!.data).toContainEqual(["Khartoum", 600, 500, "Primary site"]);
    expect(allocationSheet!.data).toContainEqual(["Kassala", 400, 300, ""]);
    expect(allocationSheet!.data).not.toContainEqual(["No state allocations recorded yet", "", "", ""]);
  });

  it("falls back to the original stub message when there are genuinely no allocations", () => {
    const sheets = buildProjectBudgetWorkbook({
      projectCode: "CAFA-PRJ-02",
      projectTitle: "No allocations project",
      currency: "USD",
      total: 1000,
      spent: 0,
      remaining: 1000,
      burnRatePct: 0,
      alerts: [],
      lines: [],
      stateAllocations: [],
    });
    const allocationSheet = sheets.find((s) => s.sheet === "State Allocations");
    expect(allocationSheet!.data).toContainEqual(["No state allocations recorded yet", "", "", ""]);
  });

  it("also falls back to the stub when stateAllocations is omitted entirely (backward compatible)", () => {
    const sheets = buildProjectBudgetWorkbook({
      projectCode: "CAFA-PRJ-03",
      projectTitle: "Omitted field project",
      currency: "USD",
      total: 1000,
      spent: 0,
      remaining: 1000,
      burnRatePct: 0,
      alerts: [],
      lines: [],
    });
    const allocationSheet = sheets.find((s) => s.sheet === "State Allocations");
    expect(allocationSheet!.data).toContainEqual(["No state allocations recorded yet", "", "", ""]);
  });

  it("formats budget allocation as '—' when the project currency is unavailable, matching every other money column", () => {
    const sheets = buildProjectBudgetWorkbook({
      projectCode: "CAFA-PRJ-04",
      projectTitle: "No currency project",
      currency: null,
      total: 1000,
      spent: 0,
      remaining: 1000,
      burnRatePct: 0,
      alerts: [],
      lines: [],
      stateAllocations: [{ stateName: "Khartoum", budgetAllocation: 600, beneficiaryTarget: 500 }],
    });
    const allocationSheet = sheets.find((s) => s.sheet === "State Allocations");
    expect(allocationSheet!.data).toContainEqual(["Khartoum", "—", 500, ""]);
  });
});
