/**
 * OFFLINE-REPORT-DRAFT-STALENESS — offline/report-drafts.ts had no
 * staleness/expiry check at all: a local draft restored any snapshot on mount
 * with no signal that the reporting period it targets, or the user's scope,
 * might have changed since it was last saved. isDraftStale() flags a draft
 * untouched for more than 30 days; useOfflineReportDraft() exposes this as
 * isStale, and OfflineReportDraftStatus renders a visible warning for it
 * (skipped when the failed/conflict recovery banner is already showing, to
 * avoid stacking two alerts).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isDraftStale, DRAFT_STALE_AFTER_MS } from "@/lib/offline/report-drafts";

const hqsrSrc = readFileSync(resolve(__dirname, "../components/hq-sector-report-form.tsx"), "utf8");
const sprSrc = readFileSync(resolve(__dirname, "../components/program-state-report-form.tsx"), "utf8");
const reportsSrc = readFileSync(resolve(__dirname, "../pages/reports.tsx"), "utf8");

describe("OFFLINE-REPORT-DRAFT-STALENESS: isDraftStale flags drafts older than the threshold", () => {
  it("is exactly 30 days", () => {
    expect(DRAFT_STALE_AFTER_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("a draft saved just now is not stale", () => {
    const now = Date.now();
    expect(isDraftStale(now, now)).toBe(false);
    expect(isDraftStale(now - 1000, now)).toBe(false);
  });

  it("a draft saved 29 days ago is not yet stale", () => {
    const now = Date.now();
    expect(isDraftStale(now - 29 * 24 * 60 * 60 * 1000, now)).toBe(false);
  });

  it("a draft saved 31 days ago is stale", () => {
    const now = Date.now();
    expect(isDraftStale(now - 31 * 24 * 60 * 60 * 1000, now)).toBe(true);
  });
});

describe("OFFLINE-REPORT-DRAFT-STALENESS: wired into all three report-authoring surfaces", () => {
  it("HQSR passes isStale through to OfflineReportDraftStatus", () => {
    expect(hqsrSrc).toContain("isStale={localDraft.isStale}");
  });
  it("SPR passes isStale through to OfflineReportDraftStatus", () => {
    expect(sprSrc).toContain("isStale={localDraft.isStale}");
  });
  it("reports.tsx (PMR/Activity inline forms) passes isStale through too", () => {
    expect(reportsSrc).toContain("isStale={localDraft.isStale}");
  });
});
