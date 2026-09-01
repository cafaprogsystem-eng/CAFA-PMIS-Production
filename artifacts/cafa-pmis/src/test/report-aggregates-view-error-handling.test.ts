/**
 * REPORT-AGGREGATES-VIEW — ReportAggregatesView (reports.tsx) previously only
 * checked isLoading/data and silently rendered nothing on a fetch failure
 * (e.g. the now-fixed backend querying a nonexistent table always threw).
 * It now checks isError and shows a translated error message. burnRatePct is
 * also nullable now (backend fix), so the display must show "—" instead of
 * the literal string "null%".
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(__dirname, "../pages/reports.tsx"), "utf8");
const enReports = JSON.parse(readFileSync(resolve(__dirname, "../locales/en/reports.json"), "utf8"));
const arReports = JSON.parse(readFileSync(resolve(__dirname, "../locales/ar/reports.json"), "utf8"));

describe("REPORT-AGGREGATES-VIEW: isError is handled instead of silently rendering nothing", () => {
  it("destructures isError from useGetReportAggregates and renders a message on failure", () => {
    expect(src).toMatch(/const \{ data, isLoading, isError \} = useGetReportAggregates\(reportId\)/);
    expect(src).toContain('if (isError) {');
    expect(src).toContain('t("aggregates.loadError")');
  });

  it("the loadError key exists in both English and Arabic locale files", () => {
    expect(enReports.aggregates.loadError).toBeTruthy();
    expect(arReports.aggregates.loadError).toBeTruthy();
  });

  it("burnRatePct renders '—' instead of the literal 'null%' when the backend returns null", () => {
    expect(src).toContain('{bg.burnRatePct == null ? "—" : `${bg.burnRatePct}%`}');
    expect(src).not.toContain("{bg.burnRatePct}%</bdi>");
  });
});
