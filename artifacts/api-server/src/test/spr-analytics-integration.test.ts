/**
 * SPR-012 Analytics Integration — Sentinel Tests
 *
 * State Programme Reports (report_type = program_state) have project_id = NULL
 * by design. Any analytics query that reaches sector scope through an INNER
 * JOIN to projects (or a project_id subquery) silently drops SPR (and HQSR,
 * which shares project_id = NULL). These static source assertions encode the
 * fixed query shapes and the intentional project-only boundaries so a future
 * change cannot silently reintroduce the undercount.
 *
 * Covers: SPR-AN-01..07, SPR-AN-10/11, SPR-AN-SEC-01..06 (as source-level
 * invariants on the scope predicates rather than live-DB counts — the same
 * approach used by pmr-analytics-boundary.test.ts).
 */

import { describe, it, expect, vi } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// ─── Module mocks for the execution-level endpoint tests ────────────────────

const mockQuery = vi.fn();
mockQuery.mockResolvedValue({ rows: [] });
vi.mock("@workspace/db", () => ({ pool: { query: mockQuery } }));
vi.mock("../lib/realtime.js", () => ({
  realtime: { emit: vi.fn(), to: vi.fn().mockReturnThis() },
}));
vi.mock("../middlewares/currentUser.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../middlewares/currentUser.js")>();
  return {
    ...original,
    logAudit: vi.fn().mockResolvedValue(undefined),
    requirePerm: () => (_req: Request, _res: Response, next: NextFunction) => next(),
    permissionsFor: vi.fn().mockReturnValue(["reports.view"]),
  };
});

async function buildApp(user: Record<string, unknown>) {
  const { default: router } = await import("../routes/dashboard.js");
  const app = express();
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { currentUser: Record<string, unknown> }).currentUser = user;
    next();
  });
  app.use("/api", router);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: "internal", message: err.message });
  });
  return app;
}

const TC_HEALTH = {
  id: 3, name: "TC", email: "tc@x.org", role: "technical_coordinator",
  roleLabel: "Technical Coordinator", scope: "sector",
  stateId: null, stateName: null, sector: "Health", sectors: ["Health"], avatarUrl: null,
};

const SPO_USER = {
  id: 2, name: "SPO", email: "spo@x.org", role: "state_program_officer",
  roleLabel: "State Programme Officer", scope: "state",
  stateId: 5, stateName: "South Kordofan", sector: null, sectors: null, avatarUrl: null,
};

const here = path.dirname(fileURLToPath(import.meta.url));
const dashboardSrc = readFileSync(
  path.join(here, "..", "routes", "dashboard.ts"),
  "utf8",
);

/** Extract the source of a single route handler starting at its registration. */
function routeSegment(source: string, routePath: string): string {
  const start = source.indexOf(`"${routePath}"`);
  expect(start, `route ${routePath} should exist in dashboard.ts`).toBeGreaterThan(-1);
  const rest = source.slice(start);
  const next = rest.slice(10).search(/router\.(get|post|patch|put|delete)\(/);
  return next === -1 ? rest : rest.slice(0, next + 10);
}

const reportsSummary = routeSegment(dashboardSrc, "/dashboard/reports-summary");

describe("SPR-AN-05 — /dashboard/reports-summary main KPI keeps SPR under TC scope", () => {
  it("TC sector join to projects is a LEFT JOIN", () => {
    // joinProject builds the project join used by the main KPI and by-type
    // queries. An INNER JOIN here drops every project_id=NULL report (SPR, HQSR).
    expect(reportsSummary).toContain("LEFT JOIN projects p2 ON p2.id = r.project_id");
    expect(reportsSummary).toContain("LEFT JOIN activities act ON act.id = r.activity_id");
    expect(reportsSummary).not.toMatch(/(?<!LEFT )JOIN projects p2 ON p2\.id = r\.project_id/);
  });

  it("TC sector predicate is canonical and type-aware", () => {
    expect(reportsSummary).toContain("r.report_type = 'project' AND p2.sector = ANY");
    expect(reportsSummary).toContain("r.report_type = 'activity' AND r.project_id IS NOT NULL AND p2.sector = ANY");
    expect(reportsSummary).toContain("r.report_type = 'activity' AND r.project_id IS NULL AND act.sector = ANY");
    expect(reportsSummary).toContain("r.report_type NOT IN ('project', 'activity')");
    expect(reportsSummary).not.toContain("COALESCE(NULLIF(r.sector,''), p2.sector)");
  });

  it("preserves the operational-population filter (SPR-AN-10/11)", () => {
    expect(reportsSummary).toMatch(/operationalPopulationSQL\(\)/);
    expect(reportsSummary).toMatch(/migration_is_duplicate\s*=\s*FALSE/i);
    expect(reportsSummary).toMatch(/migration_status_unverified\s*=\s*FALSE/i);
  });

  it("preserves the state scope predicate (SPR-AN-SEC-01/02/06)", () => {
    // State filtering is parameterised through the route's shared stateFilter,
    // rather than interpolating a request-derived ID into SQL.
    expect(reportsSummary).toContain("const stateFilter");
    expect(reportsSummary).toContain("reportScope.push(`AND r.state_id = $${nextParam}`)");
  });

  it("fails closed for a TC with zero sectors", () => {
    expect(reportsSummary).toMatch(/tcSectors\.length === 0\s*\?\s*"AND FALSE"/);
  });
});

describe("SPR-AN-03 — by-sector breakdown retains project_id=NULL reports", () => {
  it("uses LEFT JOIN projects, never INNER JOIN", () => {
    expect(reportsSummary).toMatch(/FROM reports r\s+LEFT JOIN projects p ON p\.id = r\.project_id/);
    expect(reportsSummary).not.toMatch(/FROM reports r JOIN projects p ON p\.id = r\.project_id/);
  });

  it("groups standalone activity reports by activity sector", () => {
    expect(reportsSummary).toContain("WHEN r.report_type = 'activity' THEN act.sector");
    expect(reportsSummary).toContain("ELSE COALESCE(NULLIF(r.sector,''), p.sector)");
  });
});

describe("SPR-AN-04 — by-state breakdown counts SPR via canonical r.state_id", () => {
  it("joins reports to states on r.state_id (no INNER project join)", () => {
    expect(reportsSummary).toMatch(/LEFT JOIN reports r\s*\n\s*ON r\.state_id = s\.id/);
  });

  it("applies type-aware TC scope inside the LEFT JOIN ON clause", () => {
    const byState = reportsSummary.slice(
      reportsSummary.indexOf("LEFT JOIN reports r"),
      reportsSummary.indexOf("GROUP BY s.id"),
    );
    expect(byState).toContain("${byStateSectorFilter}");
    expect(reportsSummary).toContain("const byStateSectorFilter");
    expect(reportsSummary).toContain("r.report_type = 'project'");
    expect(reportsSummary).toContain("SELECT a.sector FROM activities a WHERE a.id = r.activity_id");
    expect(reportsSummary).toContain("r.report_type NOT IN ('project', 'activity')");
    expect(reportsSummary).toMatch(/tcSectors !== null && tcSectors\.length === 0\s*\n?\s*\?\s*"AND FALSE"/);
  });
});

describe("SPR-AN-01/02 — /dashboard/summary report counts keep SPR under TC scope", () => {
  const summary = routeSegment(dashboardSrc, "/dashboard/summary");

  it("pending-approvals scope uses the canonical type-aware helper", () => {
    expect(summary).not.toMatch(/r\.project_id IN \(SELECT id FROM projects pf/);
    expect(summary).toContain('reportScopeWhere(\n          reportEffectiveScope, "r", "rp", "ra"');
    expect(summary).toContain("LEFT JOIN projects rp ON rp.id = r.project_id");
    expect(summary).toContain("LEFT JOIN activities ra ON ra.id = r.activity_id");
  });

  it("submitted/pending scope uses type-aware project and activity joins", () => {
    expect(summary).toContain("LEFT JOIN projects rp ON rp.id = r.project_id");
    expect(summary).toContain("LEFT JOIN activities ra ON ra.id = r.activity_id");
    expect(dashboardSrc).toContain("function technicalCoordinatorReportSectorSQL");
  });

  it("state-scoped report counts still use canonical state_id (SEC-01/02)", () => {
    expect(dashboardSrc).toContain("parts.push(`${reportAlias}.state_id = $${idx++}`)");
  });

  it("report counts apply the operational-population filter (SPR-AN-10/11)", () => {
    expect(summary).toMatch(/operationalPopulationSQL\(\)/);
  });
});

describe("SPR-AN-01 — /dashboard/pending-approvals approval queue keeps project_id=NULL reports", () => {
  const seg = routeSegment(dashboardSrc, "/dashboard/pending-approvals");

  it("reports list uses LEFT JOIN projects (SPR appears in SPC/PM/super_admin queue)", () => {
    expect(seg).toMatch(/LEFT JOIN projects p ON p\.id = r\.project_id/);
    expect(seg).not.toMatch(/(?<!LEFT )JOIN projects p ON p\.id = r\.project_id/);
  });

  it("states and users joins are LEFT JOINs (HQSR has state_id NULL)", () => {
    expect(seg).toMatch(/LEFT JOIN states s ON s\.id = r\.state_id/);
    expect(seg).toMatch(/LEFT JOIN users u ON u\.id = r\.submitted_by_id/);
  });

  it("TC sector predicate uses the canonical type-aware helper and activity join", () => {
    expect(seg).toContain('reportScopeConditions(canonicalReportScope, "r", "p", "act", 1)');
    expect(seg).toContain("LEFT JOIN activities act ON act.id = r.activity_id");
  });

  it("excludes migration duplicates/unverified rows from the queue", () => {
    expect(seg).toMatch(/operationalPopulationSQL\(\)/);
  });
});

describe("SPR-AN-01 — /dashboard/recent-activity TC scope keeps project_id=NULL reports", () => {
  it("report activity filter uses type-aware project and activity LEFT JOINs", () => {
    const seg = routeSegment(dashboardSrc, "/dashboard/recent-activity");
    expect(seg).toMatch(/FROM reports r2\s+LEFT JOIN projects p2 ON p2\.id = r2\.project_id\s+LEFT JOIN activities act2 ON act2\.id = r2\.activity_id/);
    expect(seg).toContain('technicalCoordinatorReportSectorSQL("r2", "p2", "act2", 1)');
    expect(seg).not.toMatch(/reports r2 JOIN projects p2/);
  });

  it("TC request executes: scope WHERE clause placed after all joins, before ORDER BY", async () => {
    mockQuery.mockClear();
    const app = await buildApp(TC_HEALTH);
    const res = await request(app).get("/api/dashboard/recent-activity");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    const sql = String(mockQuery.mock.calls.find(c => String(c[0]).includes("FROM audit_log a"))?.[0]);
    // Structural SQL validity: FROM audit_log … all LEFT JOINs … WHERE … ORDER BY
    const fromIdx = sql.indexOf("FROM audit_log");
    // The scope clause starts with "WHERE (a.module" for sector-scoped users.
    // It must come after the last top-level join (the LATERAL, ending at
    // ") ps ON TRUE") and before ORDER BY. Note: the scope subquery itself
    // contains a LEFT JOIN, so lastIndexOf("LEFT JOIN") cannot be used.
    const whereIdx = sql.indexOf("WHERE (a.module");
    const lateralEnd = sql.indexOf(") ps ON TRUE");
    const orderIdx = sql.indexOf("ORDER BY");
    expect(fromIdx).toBeGreaterThan(-1);
    expect(lateralEnd).toBeGreaterThan(fromIdx);
    expect(whereIdx).toBeGreaterThan(lateralEnd);
    expect(orderIdx).toBeGreaterThan(whereIdx);
    expect(sql).toContain("r2.report_type = 'project' AND p2.sector = ANY($1::text[])");
    expect(sql).toContain("r2.report_type = 'activity' AND r2.project_id IS NULL AND act2.sector = ANY($1::text[])");
    expect(mockQuery.mock.calls.at(-1)?.[1]).toEqual([["Health"]]);
  });

  it("SPO request keeps parent records assignment-scoped but reports state-scoped", async () => {
    mockQuery.mockClear();
    const app = await buildApp(SPO_USER);
    const res = await request(app).get("/api/dashboard/recent-activity");
    expect(res.status).toBe(200);
    const sql = String(mockQuery.mock.calls.find(c => String(c[0]).includes("FROM audit_log a"))?.[0]);
    expect(sql.indexOf("WHERE (a.module IN ('projects', 'project')")).toBeGreaterThan(sql.indexOf(") ps ON TRUE"));
    expect(sql).toContain("SELECT id FROM reports r2 WHERE r2.state_id = $2");
    expect(sql).toContain("SELECT id FROM risks WHERE project_id = ANY($1::int[])");
    expect(sql).toContain("SELECT id FROM beneficiaries WHERE project_id = ANY($1::int[])");
    expect(mockQuery.mock.calls.at(-1)?.[1]).toEqual([[], 5]);
  });
});

describe("SPR-AN-06/07/09 — project-only metrics remain project-only", () => {
  it("/dashboard/attention-projects stays keyed on project_id", () => {
    const seg = routeSegment(dashboardSrc, "/dashboard/attention-projects");
    // Reports/risks join to projects via INNER JOIN on project_id — SPR
    // (project_id = NULL) can never appear in this project-specific metric.
    expect(seg).toMatch(/JOIN reports r ON r\.project_id = p\.id/);
    expect(seg).not.toMatch(/LEFT JOIN reports r/);
  });

  it("/dashboard/pmr-reporting-completeness remains PMR-only", () => {
    const seg = routeSegment(dashboardSrc, "/dashboard/pmr-reporting-completeness");
    expect(seg).toMatch(/report_type\s*=\s*'project'/);
    expect(seg).not.toMatch(/program_state/);
  });

  it("/dashboard/beneficiaries does not aggregate report rows (no SPR double-count)", () => {
    const seg = routeSegment(dashboardSrc, "/dashboard/beneficiaries");
    expect(seg).not.toMatch(/\bFROM\s+reports\b/i);
    expect(seg).not.toMatch(/\bJOIN\s+reports\b/i);
  });
});

describe("SPR-AN-08 — no completeness model for SPR", () => {
  it("no SPR/program_state completeness route or expected-submission model exists", () => {
    expect(dashboardSrc).not.toMatch(/spr[-_]?(reporting[-_]?)?completeness/i);
    expect(dashboardSrc).not.toMatch(/program[-_]state[-_]completeness/i);
  });
});
