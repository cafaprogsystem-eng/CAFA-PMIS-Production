/**
 * REPORT-PAGINATION-FOOTER-DEDUP — the §21–22 result-count + prev/next
 * pagination footer was hand-duplicated across all four Reports view modes
 * (Table/Card/List/Compact); Kanban has none. All four now render the same
 * <ReportPaginationFooter> component instead of their own inline copy, so a
 * future fix (e.g. adding a page-size selector) only needs to happen once.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const reportsSrc = readFileSync(resolve(__dirname, "../pages/reports.tsx"), "utf8");
const footerSrc = readFileSync(resolve(__dirname, "../components/report-pagination-footer.tsx"), "utf8");

describe("REPORT-PAGINATION-FOOTER-DEDUP: reports.tsx uses the shared component everywhere", () => {
  it("imports ReportPaginationFooter", () => {
    expect(reportsSrc).toContain('import { ReportPaginationFooter } from "@/components/report-pagination-footer";');
  });

  it("renders it in exactly 4 places (Table/Card/List/Compact; Kanban has none)", () => {
    const usages = [...reportsSrc.matchAll(/<ReportPaginationFooter/g)];
    expect(usages.length).toBe(4);
  });

  it("no view mode still inlines its own pagination.showing/pagination.totalCount JSX", () => {
    expect(reportsSrc).not.toMatch(/t\("pagination\.showing"/);
    expect(reportsSrc).not.toMatch(/t\("pagination\.totalCount"/);
  });

  it("each call site passes the same PAGE_SIZE and meta.label", () => {
    const calls = [...reportsSrc.matchAll(/<ReportPaginationFooter[\s\S]*?\/>/g)];
    expect(calls.length).toBe(4);
    for (const [call] of calls) {
      expect(call).toContain("total={reportsRaw.total}");
      expect(call).toContain("totalPages={reportsRaw.totalPages}");
      expect(call).toContain("page={page}");
      expect(call).toContain("pageSize={PAGE_SIZE}");
      expect(call).toContain("label={meta.label}");
      expect(call).toContain("t={t}");
    }
  });
});

describe("REPORT-PAGINATION-FOOTER-DEDUP: the shared component itself", () => {
  it("shows a result-count-only sentence when there is a single page", () => {
    expect(footerSrc).toContain('t("pagination.totalCount", { total, type: label })');
  });

  it("shows the from/to/total sentence plus prev/next controls when there is more than one page", () => {
    expect(footerSrc).toContain('t("pagination.showing", { from: (page - 1) * pageSize + 1, to: Math.min(page * pageSize, total), total, type: label })');
    expect(footerSrc).toContain("disabled={page <= 1}");
    expect(footerSrc).toContain("disabled={page >= totalPages}");
  });
});
