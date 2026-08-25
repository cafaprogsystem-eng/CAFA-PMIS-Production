/**
 * BUD-DETAIL closure suite — Project Detail budget semantics & currency (BUD-006).
 *
 * Sentinel-style source-shape assertions (same pattern as the BUD-AUD suite)
 * plus pure-formula tests for the utilisation semantics:
 *  - zero-budget projects show "—", never "100% unspent"
 *  - all monetary figures carry the Project ISO currency (no USD fallback)
 *  - no hardcoded "$" in Budget tab amounts or chart axes
 *  - State Allocation shows no fabricated State expenditure
 *  - genuine 0% (budget > 0, spend = 0) preserved
 *
 * Test IDs: BUD-DETAIL-01 through BUD-DETAIL-05
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatCurrency, formatPercent } from "@/lib/format";

const here = (p: string) => resolve(__dirname, p);
const detailSrc = readFileSync(here("../pages/project-detail.tsx"), "utf8");
const budgetSrc = readFileSync(here("../pages/budget.tsx"), "utf8");

describe("BUD-DETAIL-01 zero-budget utilisation renders — (never 100% unspent)", () => {
  it("source no longer fabricates 100% unspent for zero budgets", () => {
    expect(detailSrc).not.toMatch(/:\s*100\s*}%\s*\{t\("detail\.unspent"\)/);
    // The canonical utilisation display has a null denominator fallback.
    expect(detailSrc).toContain("const utilisation = budgetTotal > 0 ? Math.round((budgetSpent / budgetTotal) * 100) : null;");
  });
  it("pure formula: 0/0 utilisation is undefined → —", () => {
    const unspent = (spent: number, total: number) =>
      total > 0 ? 100 - Math.round((spent / total) * 100) : null;
    expect(formatPercent(unspent(0, 0))).toBe("—");
    expect(formatPercent(unspent(500, 0))).toBe("—");
  });
  it("overview utilisation card also returns null (—) for zero budget", () => {
    expect(detailSrc).toMatch(/const pct = budgetTotal > 0 \? Math\.round\(\(budgetSpent \/ budgetTotal\) \* 100\) : null;/);
  });
});

describe("BUD-DETAIL-02 monetary figures use the Project ISO currency", () => {
  it("project-detail threads projectCurrency into every budget formatCurrency call", () => {
    expect(detailSrc).toMatch(/const projectCurrency = \(project as \{ currency\?: string \}\)\.currency;/);
    // No remaining single-argument formatCurrency calls on budget figures
    expect(detailSrc).not.toMatch(/formatCurrency\(budgetTotal\)/);
    expect(detailSrc).not.toMatch(/formatCurrency\(budgetSpent\)/);
    expect(detailSrc).toContain("formatCurrency(remaining, projectCurrency)");
    expect(detailSrc).not.toMatch(/formatCurrency\(a\.budgetSpent\)/);
    expect(detailSrc).not.toMatch(/formatCurrency\(alloc\.budgetAllocation\)[^,]/);
    expect(detailSrc).not.toMatch(/formatCurrency\(totalBudget\)/);
  });
  it("formatCurrency with an ISO code renders that code, not $", () => {
    const out = formatCurrency(1500, "EUR");
    expect(out).toContain("EUR");
    expect(out).not.toContain("$");
  });
  it("ProjectBudgetView KPI cards use the null-aware fmtMoney with projectInfo currency", () => {
    expect(budgetSrc).toMatch(/fmtMoney\(data\.total, projectInfo\?\.currency\)/);
    expect(budgetSrc).toMatch(/fmtMoney\(data\.spent, projectInfo\?\.currency\)/);
    expect(budgetSrc).toMatch(/fmtMoney\(data\.remaining, projectInfo\?\.currency\)/);
  });
});

describe("BUD-DETAIL-03 no hardcoded $ in Budget tab amounts or chart axes", () => {
  it("budget page chart axis/tooltip no longer hardcode $", () => {
    expect(budgetSrc).not.toMatch(/\$\$\{/); // `$${...}k` template
    expect(budgetSrc).toContain("const displayCurrency = resolveProjectCurrency(projectInfo?.currency);");
    expect(budgetSrc).toContain('displayCurrency ? `${displayCurrency} ${(v / 1000).toFixed(0)}k` : "—"');
    expect(budgetSrc).toMatch(/formatter=\{\(v: number\) => fmtMoney\(v, projectInfo\?\.currency\)\}/);
  });
  it("project-detail budget sections contain no literal dollar-prefixed amounts", () => {
    expect(detailSrc).not.toMatch(/\$\$\{/);
    expect(detailSrc).not.toMatch(/>\s*\$\s*\{/);
  });
});

describe("BUD-DETAIL-04 State Allocation shows no fabricated State expenditure", () => {
  it("allocation rows expose only budgetAllocation and targets — never spend/remaining/utilisation", () => {
    expect(detailSrc).not.toMatch(/alloc\.(spent|budgetSpent|remaining|utilisation|utilization)/i);
  });
  it("allocation headings carry the Project currency context (BUD-BD-02 open)", () => {
    expect(detailSrc).toMatch(/\{t\("detail\.budgetAllocation"\)\}\{projectCurrency \? ` \(\$\{projectCurrency\}\)` : ""\}/);
  });
});

describe("BUD-DETAIL-05 genuine 0% utilisation preserved when budget > 0", () => {
  it("budget > 0 with zero spend renders 0%, not —", () => {
    const pct = (spent: number, total: number) =>
      total > 0 ? Math.round((spent / total) * 100) : null;
    expect(formatPercent(pct(0, 100_000))).toBe("0%");
    expect(formatPercent(pct(25_000, 100_000))).toBe("25%");
  });
});
