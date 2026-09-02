/**
 * GLOBAL-SEARCH-REPORT-DEEP-LINK — clicking a report search result navigated
 * to the generic reports list for that report type, dropping the ?open=<id>
 * the reports page already supports (used by the PMR completeness panel and
 * consolidated view "View" links) and that this global-search component
 * already imports the reportTypePath() helper for. The user landed on the
 * list, not the report they searched for and clicked.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(__dirname, "../components/global-search.tsx"), "utf8");

describe("GLOBAL-SEARCH-REPORT-DEEP-LINK", () => {
  it("appends ?open=<reportId> when navigating to a report search result", () => {
    expect(src).toContain("setLocation(`${reportTypePath(item.data.reportType)}?open=${item.data.id}`)");
  });

  it("does not regress to the bare reportTypePath() call with no query string", () => {
    expect(src).not.toMatch(/setLocation\(reportTypePath\(item\.data\.reportType\)\);/);
  });
});
