/**
 * DASH-TREND-UNIFY — the Monthly Achievement Trend chart used to be
 * implemented twice: once as the shared MonthlyTrendChart component
 * (Overview tab) and once as a hand-rolled AreaChart in the Performance tab
 * with hardcoded English legend names ("Target"/"Achieved" instead of the
 * translated labels) and its own divergent title/description/empty-state
 * i18n keys. The Performance tab now reuses the same component.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(__dirname, "../pages/dashboard.tsx"), "utf8");

describe("DASH-TREND-UNIFY — single MonthlyTrendChart component used by both tabs", () => {
  it("Performance tab renders MonthlyTrendChart instead of its own AreaChart", () => {
    expect(src).toContain('gradientSuffix="PT"');
    expect(src).toContain('titleKey="performanceTab.monthlyAchievementTrend"');
    expect(src).toContain('descriptionKey="performanceTab.compareTargets"');
    expect(src).toContain('emptyMessageKey="chartEmpty.monthlyAchievement"');
  });

  it("no longer hardcodes English legend names bypassing i18n", () => {
    expect(src).not.toContain('name="Target"');
    expect(src).not.toContain('name="Achieved"');
  });

  it("the shared component supports overriding its title/description/empty-state keys and a loading state", () => {
    expect(src).toMatch(/titleKey = "sections\.monthlyTrend"/);
    expect(src).toMatch(/descriptionKey = "sections\.monthlyTrendDesc"/);
    expect(src).toMatch(/emptyMessageKey = "noData"/);
    expect(src).toContain("isLoading?: boolean;");
  });
});
