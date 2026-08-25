/**
 * BUD-DETAIL-VIS — Project Budget Detail and State Allocations visual contract.
 *
 * These sentinels intentionally inspect presentation only. Financial calculations,
 * access rules, allocation cap validation, and API contracts remain owned by the
 * existing functional suites and Task #628.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatPercent } from "@/lib/format";

const here = (p: string) => resolve(__dirname, p);
const detailSrc = readFileSync(here("../pages/project-detail.tsx"), "utf8");
const formSrc = readFileSync(here("../components/project-registration-form.tsx"), "utf8");

describe("BUD-DETAIL-VIS-01 — Project Budget and State Allocation are visibly distinct", () => {
  it("uses explicit project-budget and recorded-allocation headings", () => {
    expect(detailSrc).toContain('t("detail.projectBudget")');
    expect(detailSrc).toContain('t("detail.allocationTitle")');
    expect(detailSrc).toContain('t("detail.stateAllocationContext")');
  });
});

describe("BUD-DETAIL-VIS-02 — Project currency is adjacent to money displays", () => {
  it("keeps the Project currency visible in the budget header and allocation headings", () => {
    expect(detailSrc).toContain('t("detail.projectCurrency")');
    expect(detailSrc).toContain('t("detail.budgetAllocation")}{projectCurrency ? ` (${projectCurrency})` : ""}');
    expect(detailSrc).toContain('t("detail.allocationDescription", { currency: projectCurrency || "—" })');
  });
});

describe("BUD-DETAIL-VIS-03 — zero and unavailable values remain distinct", () => {
  it("preserves a genuine 0% while an undefined denominator is an em dash", () => {
    const utilisation = (spent: number, total: number) =>
      total > 0 ? Math.round((spent / total) * 100) : null;
    expect(formatPercent(utilisation(0, 100))).toBe("0%");
    expect(formatPercent(utilisation(0, 0))).toBe("—");
  });
  it("does not replace a stored zero allocation with an unavailable marker", () => {
    expect(detailSrc).toContain('alloc.budgetAllocation != null ? formatCurrency(alloc.budgetAllocation, projectCurrency) : "—"');
  });
});

describe("BUD-DETAIL-VIS-04 — overspend remains visible", () => {
  it("does not clamp the displayed utilisation value and adds non-colour warning copy", () => {
    expect(detailSrc).toContain("const isOverspent = utilisation !== null && utilisation > 100;");
    expect(detailSrc).toContain('t("detail.overBudget")');
    expect(detailSrc).toContain("{formatPercent(utilisation)}");
  });
});

describe("BUD-DETAIL-VIS-05 — negative remaining remains visible", () => {
  it("renders the signed remaining currency value with explanatory text", () => {
    expect(detailSrc).toContain("const hasNegativeRemaining = remaining < 0;");
    expect(detailSrc).toContain("formatCurrency(remaining, projectCurrency)");
    expect(detailSrc).toContain('t("detail.negativeRemaining")');
  });
});

describe("BUD-DETAIL-VIS-06 — State expenditure is not fabricated", () => {
  it("does not derive spend, remaining, or utilisation from an allocation row", () => {
    expect(detailSrc).not.toMatch(/alloc\.(spent|budgetSpent|remaining|utilisation|utilization)/i);
    expect(detailSrc).toContain('t("detail.stateRoleInfo")');
  });
});

describe("BUD-DETAIL-VIS-07 — allocation amounts use Project currency only", () => {
  it("formats allocation amounts with projectCurrency and exposes no allocation currency control", () => {
    expect(detailSrc).toContain("formatCurrency(alloc.budgetAllocation, projectCurrency)");
    expect(detailSrc).not.toMatch(/allocationCurrency|stateAllocationCurrency|FX|foreign exchange/i);
  });
});

describe("BUD-DETAIL-VIS-08 — no equal-share or automatic division is presented", () => {
  it("states that records are explicit and contains no per-state division logic", () => {
    expect(detailSrc).toContain('t("detail.noAllocationsDescription")');
    expect(detailSrc).not.toMatch(/budgetTotal\s*\/\s*stateAllocations\.length|equal share|per-state budget/i);
  });
});

describe("BUD-DETAIL-VIS-09 — large allocation tables stay locally scrollable and scannable", () => {
  it("uses a local overflow guard, bounded State names, and tabular numeric cells", () => {
    expect(detailSrc).toContain('<div className="overflow-x-auto">');
    expect(detailSrc).toContain('className="block max-w-[280px] break-words" title={getLinkedStateLabel(alloc, i18n?.language)}');
    expect(detailSrc).toContain("whitespace-nowrap text-end font-medium tabular-nums");
    expect(detailSrc).toContain('aria-label={t("detail.allocationTableAria")}');
  });
});

describe("BUD-DETAIL-VIS-10 — backend allocation-cap authority remains intact", () => {
  it("does not add a new allocation-management mutation, adjustment, or cap calculation", () => {
    expect(detailSrc).not.toMatch(/useUpsertProjectStateAllocations|over_allocation|auto-?adjust|redistribut/i);
    expect(formSrc).not.toMatch(/stateAllocations\.reduce|reduce\([^)]*stateAllocations/);
  });
});

describe("BUD-DETAIL-VIS-11 — allocation empty, loading, and error states are truthful", () => {
  it("keeps allocation loading/error separate from the project query and provides retry", () => {
    expect(detailSrc).toContain("isLoading: isStateAllocationsLoading");
    expect(detailSrc).toContain("isError: isStateAllocationsError");
    expect(detailSrc).toContain("refetch: refetchStateAllocations");
    expect(detailSrc).toContain('aria-busy="true"');
    expect(detailSrc).toContain('onRetry={() => refetchStateAllocations()}');
    expect(detailSrc).toContain('t("detail.noAllocationsDescription")');
  });
});

describe("BUD-DETAIL-VIS-12 — this phase does not change functional, API, or permission contracts", () => {
  it("retains the existing dedicated data hook and permission gates without new backend calls", () => {
    expect(detailSrc).toContain("useListProjectStateAllocations(projectId)");
    expect(detailSrc).toContain('hasPerm(me?.permissions, "projects.update")');
    expect(detailSrc).not.toMatch(/fetch\([^)]*state-allocations/);
  });
});