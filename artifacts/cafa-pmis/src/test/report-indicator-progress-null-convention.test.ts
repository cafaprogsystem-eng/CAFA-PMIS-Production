/**
 * REPORT-INDICATOR-PROGRESS-NULL-CONVENTION — the Indicator Progress panel
 * (reports.tsx, Project reports) defaulted its percentage to 0 (styled with
 * the destructive/red badge) when an indicator had no target configured
 * (target === 0), contradicting the null-vs-zero convention used everywhere
 * else in this app (budget-presentation.ts's projectBurnRate, Dashboard,
 * Plans): a manufactured 0% implies severe under-performance, not "no target
 * to measure against". It now renders null → "—" with a neutral style.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(__dirname, "../pages/reports.tsx"), "utf8");

describe("REPORT-INDICATOR-PROGRESS-NULL-CONVENTION: progressPct is null, not 0, when target is not positive", () => {
  it("progressPct computation returns null instead of 0 for a zero/invalid target", () => {
    expect(src).toContain("entry.target > 0 ? Math.round(((entry.cumAchieved + Number(entry.currentAchievement || 0)) / entry.target) * 100) : null");
    expect(src).not.toContain("entry.target > 0 ? Math.round(((entry.cumAchieved + Number(entry.currentAchievement || 0)) / entry.target) * 100) : 0");
  });

  it("the display renders '—' with a neutral style instead of a destructive-red '0%'", () => {
    expect(src).toContain('progressPct == null ? "bg-muted/30 border-muted"');
    expect(src).toContain('progressPct == null ? "text-muted-foreground"');
    expect(src).toContain('progressPct == null ? "—" : `${progressPct}%`');
  });
});
