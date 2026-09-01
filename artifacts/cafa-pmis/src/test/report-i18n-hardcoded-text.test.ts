/**
 * REPORT-I18N-HARDCODED-TEXT — reports.tsx had a scattered set of hardcoded
 * English strings that never went through i18n: the CSV/"accepted formats"
 * helper text, the "Copy of {title}" duplicate-report prefix, the Indicator
 * Progress and Project Risks panel headings/subtitles/empty-states, and
 * ~25 aria-label wrapper phrases (Activity Name, Achievement Summary,
 * beneficiary counts, remove/download buttons, etc.). All now resolve
 * through t("formExtra.*"/"list.copyOfTitle") with the interpolated data
 * (row label, file name, report title) still passed through as a variable —
 * only the surrounding chrome text moved to the locale files.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(__dirname, "../pages/reports.tsx"), "utf8");
const en = JSON.parse(readFileSync(resolve(__dirname, "../locales/en/reports.json"), "utf8"));
const ar = JSON.parse(readFileSync(resolve(__dirname, "../locales/ar/reports.json"), "utf8"));

describe("REPORT-I18N-HARDCODED-TEXT: reports.tsx routes former hardcoded strings through t()", () => {
  it("the duplicate-report title prefix", () => {
    expect(src).toContain('title: t("list.copyOfTitle", { title: report.title })');
    expect(src).not.toContain("title: `Copy of ${report.title}`");
  });

  it("the Indicator Progress panel heading, subtitle, and its two aria-labels", () => {
    expect(src).toContain('{t("formExtra.indicatorProgressTitle")}');
    expect(src).toContain('{t("formExtra.indicatorProgressSubtitle")}');
    expect(src).toContain('aria-label={t("formExtra.thisPeriodAchievementAria", { name: entry.name })}');
    expect(src).toContain('{t("formExtra.remarksOptional")}');
    expect(src).toContain('aria-label={t("formExtra.remarksAria", { name: entry.name })}');
  });

  it("the Project Risks panel heading, subtitle, empty/loading states, and Save button", () => {
    expect(src).toContain('{t("formExtra.projectRisksTitle")}');
    expect(src).toContain('{t("formExtra.projectRisksSubtitle")}');
    expect(src).toContain('{t("formExtra.loadingRisks")}');
    expect(src).toContain('{t("formExtra.noLinkedRisks")}');
    expect(src).toContain('t("savingData", { ns: "common" })');
    expect(src).toContain('t("save", { ns: "common" })');
    expect(src).not.toMatch(/>Project Risks</);
    expect(src).not.toContain("Loading risks…");
  });

  it("the two accepted-formats (incl. CSV) strings and the attach-document label", () => {
    expect(src).toContain('{t("formExtra.acceptedFormatsWithSize")}');
    expect(src).toContain('{t("formExtra.acceptedFormatsCsv")}');
    expect(src).toContain('{t("formExtra.attachDocument")}');
    expect(src).not.toMatch(/>Accepted formats:/);
  });

  it("no hardcoded aria-label template literals remain in reports.tsx", () => {
    expect(src).not.toMatch(/aria-label=\{`/);
  });

  it("every formExtra.*Aria / list.copyOfTitle key referenced in reports.tsx exists in both locale files", () => {
    const keys = new Set<string>();
    for (const m of src.matchAll(/t\("(formExtra\.\w+|list\.copyOfTitle)"/g)) keys.add(m[1]);
    expect(keys.size).toBeGreaterThan(15);
    for (const key of keys) {
      const [ns, prop] = key.split(".");
      expect(en[ns]?.[prop], `en missing ${key}`).toBeTypeOf("string");
      expect(ar[ns]?.[prop], `ar missing ${key}`).toBeTypeOf("string");
    }
  });
});
