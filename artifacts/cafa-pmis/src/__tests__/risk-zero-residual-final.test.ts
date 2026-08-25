/**
 * Risk Register final closure sentinels (RISK-ZR-01..22, frontend portion).
 * These guards protect shareable register state and accessible navigation.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const risksPage = readFileSync(join(ROOT, "pages/risks.tsx"), "utf8");

describe("RISK-ZR frontend: shareable register state", () => {
  it("ZR-01/02 exports a canonical parser and URL builder", () => {
    expect(risksPage).toContain("export function parseRiskRegisterState");
    expect(risksPage).toContain("export function buildRiskRegisterLocation");
  });
  it("ZR-03 initialises every supported filter and page from the current location", () => {
    expect(risksPage).toContain("parseRiskRegisterState(location)");
    for (const key of ["search", "status", "riskLevel", "category", "projectId", "stateId", "assignedToId", "page"]) {
      expect(risksPage).toContain(`["${key}"`);
    }
  });
  it("ZR-04 rejects malformed numeric IDs and non-positive pages", () => {
    expect(risksPage).toContain("/^\\d+$/");
    expect(risksPage).toContain('Number(rawPage) > 0 ? Number(rawPage) : 1');
  });
  it("ZR-05 preserves the active-only KPI entry context", () => {
    expect(risksPage).toContain('params.get("activeOnly") === "1"');
    expect(risksPage).toContain('["activeOnly", next.activeOnly ? "1" : ""]');
  });
  it("ZR-06 updates through Wouter navigation rather than a URL-writing effect", () => {
    // useLocation + useSearch are both imported from wouter for full reactive URL state
    expect(risksPage).toContain('from "wouter"');
    expect(risksPage).toContain("useLocation");
    expect(risksPage).toContain("useSearch");
    expect(risksPage).toContain("navigate(nextLocation, { replace })");
    expect(risksPage).not.toContain("window.history.pushState");
  });
  it("ZR-07 filter changes and search reset the URL page atomically", () => {
    expect(risksPage).toContain('updateRegisterState({ search: e.target.value, page: 1 })');
    expect(risksPage).toContain('updateRegisterState({ status: v, page: 1 })');
    expect(risksPage).toContain('updateRegisterState({ riskLevel: v, page: 1 })');
  });
  it("ZR-08 recovers an empty or stale page with a replace navigation", () => {
    expect(risksPage).toContain("if (tp !== undefined && page > tp)");
    expect(risksPage).toContain("updateRegisterState({ page: 1 }, true)");
  });
});

describe("RISK-ZR frontend: accessible register interaction", () => {
  it("ZR-09/10 makes each clickable risk row keyboard reachable and operable", () => {
    expect(risksPage).toContain('role="button"');
    expect(risksPage).toContain("tabIndex={0}");
    expect(risksPage).toContain('event.key === "Enter" || event.key === " "');
    // aria-label must use the localised translation key, not hard-coded English
    expect(risksPage).toContain('t("accessibility.openRisk"');
    expect(risksPage).toContain("title: r.title");
    // must NOT use hard-coded English string
    expect(risksPage).not.toContain('aria-label={`Open risk: ${r.title}`}');
  });
  it("ZR-11/12 gives pagination an announced current page and localised controls", () => {
    expect(risksPage).toContain('aria-current="page"');
    expect(risksPage).toContain('t("pagination.previous"');
    expect(risksPage).toContain('t("pagination.next"');
    expect(risksPage).toContain("disabled={page <= 1}");
    expect(risksPage).toContain("disabled={page >= totalPages}");
  });
  it("ZR-13 retains server-scoped, cross-page summaries", () => {
    expect(risksPage).toContain("risksRaw?.summary");
    expect(risksPage).toContain("risksRaw?.total");
  });
  it("ZR-14 retains canonical 3x3 display inputs", () => {
    expect(risksPage).toContain("const PROBABILITIES = [\"low\", \"medium\", \"high\"]");
    expect(risksPage).toContain("const IMPACTS = [\"low\", \"medium\", \"high\"]");
  });
});
