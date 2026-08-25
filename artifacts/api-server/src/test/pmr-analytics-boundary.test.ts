/**
 * PMR-015 Analytics Boundary — Sentinel Tests
 *
 * These tests encode the analytics-boundary invariants decided in PMR-015
 * (.local/audit-reports/pmr-analytics-integration-decision.md). They are
 * static source/schema assertions — no server bootstrap or DB connection is
 * required — and exist to alert the team if a future change silently crosses
 * a boundary the decision document declared UNSAFE or BLOCKED.
 *
 * Test IDs:
 *   PMR-ANALYTICS-SENTINEL-01  /dashboard/beneficiaries reads project master
 *                              snapshot only — never the reports (PMR) table
 *   PMR-ANALYTICS-SENTINEL-02  beneficiaries register has no report/period
 *                              linkage columns (unique-beneficiary analytics
 *                              remain BLOCKED until schema work is done)
 *   PMR-ANALYTICS-SENTINEL-03  no composite PMR performance-score route exists
 *   PMR-ANALYTICS-SENTINEL-04  reports table has no canonical indicator FK
 *                              (indicator aggregation remains BLOCKED)
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { beneficiariesTable, reportsTable } from "@workspace/db/schema";
import { getTableColumns } from "drizzle-orm";

const here = path.dirname(fileURLToPath(import.meta.url));
const dashboardSrc = readFileSync(
  path.join(here, "..", "routes", "dashboard.ts"),
  "utf8",
);

/** Extract the source of a single route handler starting at its registration. */
function routeSegment(source: string, routePath: string): string {
  const start = source.indexOf(`"${routePath}"`);
  expect(start, `route ${routePath} should exist in dashboard.ts`).toBeGreaterThan(-1);
  // Segment ends at the next router.<method>( registration (or EOF).
  const rest = source.slice(start);
  const next = rest.slice(10).search(/router\.(get|post|patch|put|delete)\(/);
  return next === -1 ? rest : rest.slice(0, next + 10);
}

describe("PMR-ANALYTICS-SENTINEL-01 — /dashboard/beneficiaries is decoupled from PMR data", () => {
  it("does not reference the reports table anywhere in its handler", () => {
    const seg = routeSegment(dashboardSrc, "/dashboard/beneficiaries");
    // Any FROM/JOIN on reports would mean PMR Period Reach data leaked into
    // the beneficiary dashboard — forbidden by PMR-015 §3/§6.
    expect(seg).not.toMatch(/\bFROM\s+reports\b/i);
    expect(seg).not.toMatch(/\bJOIN\s+reports\b/i);
    expect(seg).not.toMatch(/indicator_progress/i);
  });

  it("sources figures from projects master snapshot columns", () => {
    const seg = routeSegment(dashboardSrc, "/dashboard/beneficiaries");
    expect(seg).toMatch(/beneficiaries_male/);
    expect(seg).toMatch(/\bFROM\s+projects\b/i);
  });

  it("calculates State shares from resolved registry links only", () => {
    const seg = routeSegment(dashboardSrc, "/dashboard/beneficiaries");
    expect(seg).toMatch(
      /JOIN states resolved_state ON resolved_state\.id = ps\.state_id/,
    );
  });
});

describe("PMR-ANALYTICS-SENTINEL-02 — Beneficiary Register lacks report/period linkage", () => {
  it("has no report_id, activity_id, period, month, or year columns", () => {
    const cols = Object.values(getTableColumns(beneficiariesTable)).map(
      (c) => c.name,
    );
    // If any of these appear, the register gained PMR linkage and the
    // unique-beneficiary BLOCKED status in PMR-015 §15 must be re-evaluated
    // (and this sentinel updated deliberately).
    for (const forbidden of ["report_id", "activity_id", "period", "month", "year", "reporting_month", "reporting_year"]) {
      expect(cols, `beneficiaries should not yet have ${forbidden}`).not.toContain(forbidden);
    }
  });
});

describe("PMR-ANALYTICS-SENTINEL-03 — no composite PMR performance score route", () => {
  it("dashboard.ts registers no pmr-score / performance-score / rag route", () => {
    expect(dashboardSrc).not.toMatch(/pmr[-_]?score/i);
    // /dashboard/pmr-reporting-completeness is the one approved PMR analytics
    // route (PMR-015 Option C Phase 1 — operational completeness, not a score).
    // Any other /dashboard/pmr* route remains forbidden.
    const pmrRoutes = dashboardSrc.match(/dashboard\/pmr[a-z0-9-]*/gi) ?? [];
    for (const route of pmrRoutes) {
      expect(route).toBe("dashboard/pmr-reporting-completeness");
    }
    expect(dashboardSrc).not.toMatch(/red[-_]amber[-_]green/i);
  });
});

describe("PMR-ANALYTICS-SENTINEL-04 — no canonical indicator FK on reports", () => {
  it("reports stores indicator progress as JSONB snapshot only", () => {
    const cols = getTableColumns(reportsTable);
    const names = Object.values(cols).map((c) => c.name);
    expect(names).toContain("indicator_progress");
    // A relational per-indicator link would unlock indicator aggregation —
    // until then it is BLOCKED (PMR-015 §12).
    expect(names).not.toContain("indicator_id");
  });
});
