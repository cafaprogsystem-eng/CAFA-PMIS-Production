/**
 * Risk Register — Pagination UI (RISK-PAGE-01 through RISK-PAGE-10)
 * Structural source-level tests for the server-side pagination controls.
 * Updated to reflect the URL-state architecture (Task #604):
 * filters and page are managed via URL search params; updateRegisterState()
 * replaces direct setter calls.
 * British English throughout.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const risksPage = readFileSync(join(ROOT, "pages/risks.tsx"), "utf8");
const planDetail = readFileSync(join(ROOT, "pages/plan-detail.tsx"), "utf8");
const reportsPage = readFileSync(join(ROOT, "pages/reports.tsx"), "utf8");
const hqSrForm = readFileSync(join(ROOT, "components/hq-sector-report-form.tsx"), "utf8");
const sprForm = readFileSync(join(ROOT, "components/program-state-report-form.tsx"), "utf8");
const createPlanDialog = readFileSync(join(ROOT, "components/create-plan-registration-dialog.tsx"), "utf8");

// ── RISK-PAGE-01: First-page renders from paginated envelope ─────────────────
describe("RISK-PAGE-01: envelope shape consumed correctly", () => {
  it("risks page reads items from the paginated envelope", () => {
    expect(risksPage).toContain("risksRaw?.items");
  });
  it("total is read from the server envelope, not inferred from items length alone", () => {
    expect(risksPage).toContain("risksRaw as { total?: number }");
  });
});

// ── RISK-PAGE-02 / RISK-PAGE-03: Next and Previous page transitions ──────────
describe("RISK-PAGE-02/03: Next and Previous page controls", () => {
  it("clicking Next increments page using Math.min guard", () => {
    expect(risksPage).toContain("Math.min(totalPages, page + 1)");
  });
  it("clicking Previous decrements page using Math.max guard", () => {
    expect(risksPage).toContain("Math.max(1, page - 1)");
  });
  it("Next button carries localised aria-label via t()", () => {
    expect(risksPage).toContain('t("pagination.next"');
  });
  it("Previous button carries localised aria-label via t()", () => {
    expect(risksPage).toContain('t("pagination.previous"');
  });
  it("query passes page param to useListRisks (via Record cast)", () => {
    expect(risksPage).toContain(".page = page");
  });
  it("query passes limit param to useListRisks (via Record cast)", () => {
    expect(risksPage).toContain(".limit = DEFAULT_LIMIT");
  });
});

// ── RISK-PAGE-04: Single-page result — controls hidden ───────────────────────
describe("RISK-PAGE-04: controls hidden when totalPages <= 1", () => {
  it("pagination section only renders when totalPages > 1", () => {
    expect(risksPage).toContain("if (totalPages <= 1) return null");
  });
});

// ── RISK-PAGE-05: total in display matches scoped server envelope ─────────────
describe("RISK-PAGE-05: page / totalPages display from server envelope", () => {
  it("page indicator uses localised translation key with page, totalPages, and total from server envelope", () => {
    expect(risksPage).toContain('t("pagination.pageOf"');
    expect(risksPage).toContain("totalPages,");
    expect(risksPage).toContain("total,");
  });
});

// ── RISK-PAGE-06: Filter change resets to page 1 atomically ──────────────────
describe("RISK-PAGE-06: filter change resets page to 1 atomically via URL", () => {
  it("risk level Select updateRegisterState resets page to 1", () => {
    expect(risksPage).toContain("updateRegisterState({ riskLevel: v, page: 1 })");
  });
  it("status Select updateRegisterState resets page to 1", () => {
    expect(risksPage).toContain("updateRegisterState({ status: v, page: 1 })");
  });
  it("category Select updateRegisterState resets page to 1", () => {
    expect(risksPage).toContain("updateRegisterState({ category: v, page: 1 })");
  });
  it("project Select updateRegisterState resets page to 1", () => {
    expect(risksPage).toContain("updateRegisterState({ projectId: v, page: 1 })");
  });
  it("state Select updateRegisterState resets page to 1", () => {
    expect(risksPage).toContain("updateRegisterState({ stateId: v, page: 1 })");
  });
  it("assignee Select updateRegisterState resets page to 1", () => {
    expect(risksPage).toContain("updateRegisterState({ assignedToId: v, page: 1 })");
  });
  it("search input onChange updateRegisterState resets page to 1 atomically", () => {
    expect(risksPage).toContain("updateRegisterState({ search: e.target.value, page: 1 })");
  });
  it("clearFilters updateRegisterState resets page to 1 alongside all filter resets", () => {
    const clearBlock = risksPage.slice(
      risksPage.indexOf("function clearFilters"),
      risksPage.indexOf("function clearFilters") + 400,
    );
    expect(clearBlock).toContain("page: 1");
  });
  it("StatCard onClick handlers reset page to 1 atomically when toggling risk level filter via URL", () => {
    expect(risksPage).toContain('updateRegisterState({ riskLevel: riskLevelFilter === "critical" ? "all" : "critical", page: 1 })');
    expect(risksPage).toContain('updateRegisterState({ riskLevel: riskLevelFilter === "high" ? "all" : "high", page: 1 })');
  });
  it("no useEffect with combined filter dependency array is used for page reset", () => {
    // The old double-request pattern must be gone
    expect(risksPage).not.toContain("search, status, riskLevelFilter, projectId, stateId, categoryFilter, assignedToFilter, activeOnly");
  });
});

// ── RISK-PAGE-07: total reflects actor-scoped count ───────────────────────────
describe("RISK-PAGE-07: total is from server envelope (actor-scoped)", () => {
  it("no client-side total inference from inaccessible counts", () => {
    // total must come from risksRaw (server-scoped), not a separate global count call
    expect(risksPage).not.toContain("globalTotal");
    expect(risksPage).not.toContain("allRisks.length");
  });
  it("risks page does not fetch a separate unscoped count endpoint", () => {
    expect(risksPage).not.toContain("/api/risks/count");
    expect(risksPage).not.toContain("useRisksCount");
  });
});

// ── RISK-PAGE-08: ordering preserved across pages ─────────────────────────────
describe("RISK-PAGE-08: identified_at DESC ordering", () => {
  it("ordering is handled server-side — frontend does not sort the items array", () => {
    // If the page sorted client-side it would use .sort(); confirm it doesn't sort risks
    const itemsBlock = risksPage.slice(risksPage.indexOf("risksRaw?.items"), risksPage.indexOf("useListProjects"));
    expect(itemsBlock).not.toContain(".sort(");
  });
});

// ── RISK-PAGE-09: bounded consumers unchanged ────────────────────────────────
describe("RISK-PAGE-09: bounded selectors retain limit cap without pagination controls", () => {
  it("plan-detail risk selector uses limit: 200 cap (intentional)", () => {
    expect(planDetail).toContain("limit: 200");
  });
  it("hq-sector-report-form manages risks as local state, no useListRisks pagination controls", () => {
    // These forms embed risks as local arrays (not via useListRisks), so no pagination controls
    expect(hqSrForm).not.toContain('aria-label="Next page"');
    expect(hqSrForm).not.toContain('aria-label="Previous page"');
  });
  it("program-state-report-form manages risks as local state, no useListRisks pagination controls", () => {
    expect(sprForm).not.toContain('aria-label="Next page"');
    expect(sprForm).not.toContain('aria-label="Previous page"');
  });
  it("create-plan dialog uses bounded limit (intentional selector)", () => {
    expect(createPlanDialog).toContain("limit: 200");
  });
  it("plan-detail does not render Previous/Next pagination controls for risk selector", () => {
    expect(planDetail).not.toContain('aria-label="Next page"');
    expect(planDetail).not.toContain('aria-label="Previous page"');
  });
  it("reports page uses bounded limit for inline project risk selector (intentional)", () => {
    // reports.tsx fetches via URL string with limit=200
    expect(reportsPage).toContain("limit=200");
  });
});

// ── RISK-PAGE-10: no risk data semantics changed ─────────────────────────────
describe("RISK-PAGE-10: no semantic or lifecycle changes", () => {
  it("riskLevel scoring fields unchanged in risks page", () => {
    expect(risksPage).toContain("riskLevel");
    expect(risksPage).toContain("likelihood");
    expect(risksPage).toContain("severity");
  });
  it("risk status values unchanged", () => {
    expect(risksPage).toContain('"closed"');
    expect(risksPage).toContain('"open"');
  });
  it("no new lifecycle transitions added to risks page", () => {
    // Should not have introduced transition mutation
    expect(risksPage).not.toContain("useTransitionRisk");
  });
  it("DEFAULT_LIMIT is a sensible value (not excessively large)", () => {
    // DEFAULT_LIMIT should be <=100 (task specifies 50)
    const match = risksPage.match(/const DEFAULT_LIMIT\s*=\s*(\d+)/);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeLessThanOrEqual(100);
  });
  it("empty-page recovery replaces history with a page-1 URL (including when totalPages is 0)", () => {
    // URL-state pattern: updateRegisterState({ page: 1 }, true) with replace=true
    expect(risksPage).toContain("page > tp");
    expect(risksPage).toContain("updateRegisterState({ page: 1 }, true)");
    // Must NOT use the old pattern that excluded totalPages=0
    expect(risksPage).not.toContain("page > totalPages && totalPages > 0");
  });
});
