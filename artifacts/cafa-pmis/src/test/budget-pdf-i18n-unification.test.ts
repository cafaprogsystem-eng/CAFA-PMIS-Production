/**
 * BUDGET-PDF-I18N — printBudgetPdf and printSectorPdf (budget.tsx) mixed
 * translated strings (routed through i18n.getFixedT("en", "budget")) with
 * hardcoded English literals in the same template, so an English-wording
 * revision to the locale file could silently miss the hardcoded half. Every
 * user-facing label/heading/disclaimer in both PDF templates now routes
 * through t() and a matching en/budget.json + ar/budget.json key. The fixed
 * bilingual "CAFA Development Organisation · منظمة كافا للتنمية · ... ·
 * CONFIDENTIAL" footer is deliberately left as a constant watermark (not
 * locale-dependent report content) in both templates.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const budgetSrc = readFileSync(resolve(__dirname, "../pages/budget.tsx"), "utf8");
const enBudget = JSON.parse(readFileSync(resolve(__dirname, "../locales/en/budget.json"), "utf8"));
const arBudget = JSON.parse(readFileSync(resolve(__dirname, "../locales/ar/budget.json"), "utf8"));

describe("BUDGET-PDF-I18N: both PDF export templates route every label through t()", () => {
  it("printBudgetPdf no longer hardcodes its eyebrow, Generated label, or section headings", () => {
    expect(budgetSrc).not.toContain("CAFA Development Organisation — Budget Report</div>");
    expect(budgetSrc).not.toContain("· Generated: ${now}</div>");
    expect(budgetSrc).not.toContain('<h3 style="margin-bottom:8px">⚠ Budget Alerts</h3>');
    expect(budgetSrc).not.toContain('<h3 style="margin:20px 0 0">Budget Breakdown by Output &amp; Activity</h3>');
    expect(budgetSrc).toContain('t("report.eyebrowProjectReport")');
    expect(budgetSrc).toContain('t("report.generatedLabel")');
    expect(budgetSrc).toContain('t("report.budgetAlertsHeading")');
    expect(budgetSrc).toContain('t("report.budgetBreakdownHeading")');
  });

  it("printSectorPdf no longer hardcodes its eyebrow, disclaimer, activity counts, or project-count text", () => {
    expect(budgetSrc).not.toContain("CAFA Development Organisation — Sector Budget Report</div>");
    expect(budgetSrc).not.toContain('"No activities"');
    expect(budgetSrc).not.toContain("incomplete`");
    expect(budgetSrc).not.toContain("Sector Budgets use each Project's Primary Sector");
    expect(budgetSrc).not.toContain("overallocated</span>");
    expect(budgetSrc).not.toMatch(/\$\{entry\.projectCount\} project\$\{entry\.projectCount !== 1/);
    expect(budgetSrc).not.toContain("Projects in this Sector (${entry.projectCount})");
    expect(budgetSrc).toContain('t("report.eyebrowSectorReport")');
    expect(budgetSrc).toContain('t("report.sectorBudgetDisclaimer")');
    expect(budgetSrc).toContain('t("report.noActivitiesShort")');
    expect(budgetSrc).toContain('t("report.incompleteActivitiesCount"');
    expect(budgetSrc).toContain('t("report.projectCount"');
    expect(budgetSrc).toContain('t("report.projectsInSectorHeading"');
    expect(budgetSrc).toContain('t("report.overallocatedBadge"');
  });

  it("no longer renders 'No activities activities' (the pre-existing duplicated-word bug fixed alongside the i18n routing)", () => {
    expect(budgetSrc).not.toMatch(/incompleteLabel\}\s*activities/);
  });

  it("the deliberate bilingual CONFIDENTIAL footer watermark is unchanged in both templates", () => {
    expect(budgetSrc).toContain("CAFA Development Organisation · منظمة كافا للتنمية · Budget Report · ${now} · CONFIDENTIAL");
    expect(budgetSrc).toContain("CAFA Development Organisation · منظمة كافا للتنمية · Sector Budget Report · ${now} · CONFIDENTIAL");
  });

  it("every new report.* key exists in both English and Arabic locale files", () => {
    for (const key of [
      "generatedLabel", "eyebrowProjectReport", "eyebrowSectorReport",
      "budgetAlertsHeading", "budgetBreakdownHeading", "noActivitiesShort",
      "incompleteActivitiesCount", "sectorBudgetDisclaimer",
      "projectsInSectorHeading", "overallocatedBadge",
      "projectCount_one", "projectCount_other",
    ]) {
      expect(enBudget.report[key], `en.report.${key}`).toBeTruthy();
      expect(arBudget.report[key], `ar.report.${key}`).toBeTruthy();
    }
  });
});
