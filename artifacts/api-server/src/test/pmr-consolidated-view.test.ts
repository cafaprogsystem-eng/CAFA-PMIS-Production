/**
 * Consolidated Project View (BD-5 Option B) — GET /reports/consolidated
 *
 * Tests PMR-CONS-01..32:
 *   CONS-01..05  identity (project + kind + period grouping, no cross-mixing)
 *   CONS-06..10  expected-location derivation
 *   CONS-11..16  completeness statuses + cross-endpoint consistency
 *   CONS-17..22  security / scope enforcement
 *   CONS-23..26  beneficiary + currency rules (no cross-location totals)
 *   CONS-27..31  period parameter validation
 *   CONS-32      location report links carry the real reportId
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

// ─── Module mocks — before any dynamic import of the routes ─────────────────

const mockQuery = vi.fn();
mockQuery.mockResolvedValue({ rows: [] });
vi.mock("@workspace/db", () => ({ pool: { query: mockQuery } }));

vi.mock("../lib/realtime.js", () => ({
  realtime: { emit: vi.fn(), to: vi.fn().mockReturnThis() },
}));

vi.mock("../lib/notifications.js", () => ({
  notifyEntityActorsDeduped: vi.fn().mockResolvedValue(undefined),
  notifyNextApprover: vi.fn().mockResolvedValue(undefined),
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

// ─── Users ───────────────────────────────────────────────────────────────────

const PM_USER = {
  id: 1, name: "PM", email: "pm@x.org", role: "program_manager",
  roleLabel: "Programme Manager", scope: "global",
  stateId: null, stateName: null, sector: null, sectors: null, avatarUrl: null,
};

const SPO_USER = {
  id: 2, name: "SPO", email: "spo@x.org", role: "state_program_officer",
  roleLabel: "State Programme Officer", scope: "state",
  stateId: 5, stateName: "South Kordofan", sector: null, sectors: null, avatarUrl: null,
};

const TC_HEALTH = {
  id: 3, name: "TC", email: "tc@x.org", role: "technical_coordinator",
  roleLabel: "Technical Coordinator", scope: "sector",
  stateId: null, stateName: null, sector: "Health", sectors: ["Health"], avatarUrl: null,
};

const TC_NO_SECTOR = { ...TC_HEALTH, id: 4, sector: null, sectors: [] };

// ─── App factories ───────────────────────────────────────────────────────────

async function buildApp(user: Record<string, unknown>) {
  const { default: router } = await import("../routes/reports.js");
  const app = express();
  app.use(express.json());
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

/** App with BOTH routers mounted — used for the cross-endpoint consistency test. */
async function buildDualApp(user: Record<string, unknown>) {
  const { default: reportsRouter } = await import("../routes/reports.js");
  const { default: dashboardRouter } = await import("../routes/dashboard.js");
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { currentUser: Record<string, unknown> }).currentUser = user;
    next();
  });
  app.use("/api", reportsRouter);
  app.use("/api", dashboardRouter);
  return app;
}

// ─── SQL-dispatching pool mock ───────────────────────────────────────────────

interface ReportRow {
  id: number;
  project_id: number;
  report_type: string;
  kind: string;
  reporting_year: number;
  reporting_month: number | null;
  quarter: number | null;
  state_id: number | null;
  location_type: string | null;
  status: string;
  submitted_at: string | null;
  title: string;
  narrative: string | null;
  executive_summary: string | null;
  challenges: string | null;
  recommendations: string | null;
  activities: unknown;
  indicator_progress: unknown;
  beneficiaries_male: number | null;
  beneficiaries_female: number | null;
  beneficiaries_boys: number | null;
  beneficiaries_girls: number | null;
  planned_budget: string | null;
  actual_expenditure: string | null;
  currency: string | null;
  // dashboard endpoint shape
  report_id: number;
}

interface Fixture {
  assignments?: number[];
  project: {
    id: number; title: string; code: string; sector: string | null;
    hasHqOperations: boolean;
  } | null;
  states: { project_id: number; state_id: number; state_name: string }[];
  reports: ReportRow[];
}

function makeReport(over: Partial<ReportRow> & { id: number }): ReportRow {
  return {
    project_id: 10,
    report_type: "project",
    kind: "monthly",
    reporting_year: 2026,
    reporting_month: 7,
    quarter: null,
    state_id: 5,
    location_type: "state",
    status: "submitted",
    submitted_at: "2026-08-05T09:00:00.000Z",
    title: "PMR",
    narrative: "Key achievements text",
    executive_summary: null,
    challenges: null,
    recommendations: null,
    activities: null,
    indicator_progress: null,
    beneficiaries_male: 10,
    beneficiaries_female: 20,
    beneficiaries_boys: 5,
    beneficiaries_girls: 8,
    planned_budget: null,
    actual_expenditure: null,
    currency: null,
    ...over,
    report_id: over.id,
  };
}

/** Dispatch by SQL shape, filtering reports like the real WHERE clause would. */
function installFixture(fx: Fixture) {
  const captured: { sql: string; params: unknown[] }[] = [];
  mockQuery.mockReset();
  mockQuery.mockImplementation((sql: string, params: unknown[] = []) => {
    captured.push({ sql, params });
    if (/project_assignments/i.test(sql)) {
      return Promise.resolve({ rows: (fx.assignments ?? []).map((id) => ({ project_id: id })) });
    }
    if (/FROM\s+projects\s+p/i.test(sql)) {
      if (!fx.project) return Promise.resolve({ rows: [] });
      // Consolidated: WHERE p.id = $1 — honour it. Dashboard: scope params vary.
      if (/WHERE\s+p\.id\s*=\s*\$1/i.test(sql) && params[0] !== fx.project.id) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({
        rows: [{ ...fx.project, name: fx.project.title, hasHqOperations: fx.project.hasHqOperations }],
      });
    }
    if (/FROM\s+project_states\s+ps/i.test(sql)) {
      const ids = (Array.isArray(params[0]) ? params[0] : [params[0]]) as number[];
      let rows = fx.states.filter((s) => ids.includes(s.project_id));
      if (/ps\.state_id = \$2/.test(sql)) rows = rows.filter((s) => s.state_id === params[1]);
      return Promise.resolve({ rows });
    }
    if (/FROM\s+reports\s+r/i.test(sql)) {
      const pid = params[0];
      const pids = Array.isArray(pid) ? (pid as number[]) : [pid as number];
      let rows = fx.reports.filter(
        (r) =>
          pids.includes(r.project_id) &&
          r.report_type === "project" &&
          r.status !== "archived" &&
          r.kind === params[1] &&
          r.reporting_year === params[2],
      );
      if (/r\.reporting_month = \$4/.test(sql)) rows = rows.filter((r) => r.reporting_month === params[3]);
      if (/r\.quarter = \$4/.test(sql)) rows = rows.filter((r) => r.quarter === params[3]);
      const clampMatch = sql.match(/r\.state_id = \$(\d+)/);
      if (clampMatch) {
        const clamp = params[Number(clampMatch[1]) - 1];
        rows = rows.filter((r) => r.state_id === clamp);
      }
      return Promise.resolve({ rows });
    }
    return Promise.resolve({ rows: [] });
  });
  return captured;
}

const PROJECT = { id: 10, title: "Project A", code: "CAFA-A", sector: "Health", hasHqOperations: false };
const STATE_SK = { project_id: 10, state_id: 5, state_name: "South Kordofan" };
const STATE_KA = { project_id: 10, state_id: 6, state_name: "Kassala" };
const STATE_RS = { project_id: 10, state_id: 7, state_name: "Red Sea" };

const BASE_QS = "projectId=10&kind=monthly&reportingYear=2026&reportingMonth=7";

function get(app: express.Express, qs = BASE_QS) {
  return request(app).get(`/api/reports/consolidated?${qs}`);
}

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
});

// Dispatcher for the deep-link endpoint GET /reports/:reportId — the route
// that ?open=<id> links resolve through. Mocks the sector lookup, the
// state/project scope check, project_assignments, and the final select.
function installDeepLinkFixture(fx: {
  report: { id: number; state_id: number | null; project_id: number | null; sector: string | null; title: string };
  assignments?: number[];
}) {
  mockQuery.mockReset();
  mockQuery.mockImplementation((sql: string, params: unknown[] = []) => {
    if (/project_assignments/i.test(sql)) {
      return Promise.resolve({ rows: (fx.assignments ?? []).map((id) => ({ project_id: id })) });
    }
    if (/"projectSector"/.test(sql)) {
      // getReportSector
      if (params[0] !== fx.report.id) return Promise.resolve({ rows: [] });
      return Promise.resolve({
        rows: [{
          reportType: "project", projectId: fx.report.project_id,
          projectSector: fx.report.sector, activitySector: null, effectiveSector: fx.report.sector,
        }],
      });
    }
    if (/SELECT\s+state_id,\s*project_id\s+FROM\s+reports/i.test(sql)) {
      if (params[0] !== fx.report.id) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [{ state_id: fx.report.state_id, project_id: fx.report.project_id }] });
    }
    if (/FROM\s+approvals\s+a/i.test(sql)) {
      return Promise.resolve({ rows: [] });
    }
    if (/FROM\s+reports\s+r/i.test(sql) && /WHERE\s+r\.id\s*=\s*\$1/i.test(sql)) {
      if (params[0] !== fx.report.id) return Promise.resolve({ rows: [] });
      return Promise.resolve({
        rows: [{ id: fx.report.id, title: fx.report.title, reportType: "project", status: "submitted" }],
      });
    }
    return Promise.resolve({ rows: [] });
  });
}

describe("Deep-link GET /reports/:reportId — same scope as the list/completeness panel", () => {
  const DEEP_REPORT = { id: 700, state_id: 5, project_id: 10, sector: "Health", title: "Deep link PMR" };

  it("SPO assigned to the project and in the same state → 200", async () => {
    installDeepLinkFixture({ report: DEEP_REPORT, assignments: [10] });
    const app = await buildApp(SPO_USER);
    const res = await request(app).get("/api/reports/700");
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(700);
  });

  it("SPO in the same state but NOT assigned to the project → 403", async () => {
    installDeepLinkFixture({ report: DEEP_REPORT, assignments: [99] });
    const app = await buildApp(SPO_USER);
    const res = await request(app).get("/api/reports/700");
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain("Deep link PMR");
  });

  it("SPO from a different state → 403", async () => {
    installDeepLinkFixture({ report: { ...DEEP_REPORT, state_id: 6 }, assignments: [10] });
    const app = await buildApp(SPO_USER);
    expect((await request(app).get("/api/reports/700")).status).toBe(403);
  });

  it("state-scoped user with stateId=null → 403 (fails closed)", async () => {
    installDeepLinkFixture({ report: DEEP_REPORT, assignments: [10] });
    const app = await buildApp({ ...SPO_USER, stateId: null });
    expect((await request(app).get("/api/reports/700")).status).toBe(403);
  });

  it("HQ manager (PM) → 200 regardless of assignments", async () => {
    installDeepLinkFixture({ report: DEEP_REPORT });
    const app = await buildApp(PM_USER);
    expect((await request(app).get("/api/reports/700")).status).toBe(200);
  });
});

// ─── PMR-CONS-01..05: identity ───────────────────────────────────────────────

describe("PMR-CONS-01..05 — identity (project + kind + period)", () => {
  it("PMR-CONS-01: same project + kind + period, multiple locations → all grouped", async () => {
    installFixture({
      project: PROJECT,
      states: [STATE_SK, STATE_KA],
      reports: [
        makeReport({ id: 100, state_id: 5 }),
        makeReport({ id: 101, state_id: 6, status: "approved" }),
      ],
    });
    const app = await buildApp(PM_USER);
    const res = await get(app);
    expect(res.status).toBe(200);
    expect(res.body.locations).toHaveLength(2);
    const byState = Object.fromEntries(
      res.body.locations.map((l: { stateId: number; report: { reportId: number } | null }) => [l.stateId, l]),
    );
    expect(byState[5].report.reportId).toBe(100);
    expect(byState[6].report.reportId).toBe(101);
  });

  it("PMR-CONS-02: a report for a different projectId is excluded", async () => {
    installFixture({
      project: PROJECT,
      states: [STATE_SK],
      reports: [makeReport({ id: 200, project_id: 99, state_id: 5 })],
    });
    const app = await buildApp(PM_USER);
    const res = await get(app);
    expect(res.status).toBe(200);
    expect(res.body.locations[0].report).toBeNull();
    expect(res.body.locations[0].isMissing).toBe(true);
  });

  it("PMR-CONS-03: a report for a different reportingYear is excluded", async () => {
    installFixture({
      project: PROJECT,
      states: [STATE_SK],
      reports: [makeReport({ id: 201, reporting_year: 2025 })],
    });
    const app = await buildApp(PM_USER);
    const res = await get(app);
    expect(res.body.locations[0].report).toBeNull();
  });

  it("PMR-CONS-04: a quarterly report is excluded from a monthly view (no cross-kind mixing)", async () => {
    installFixture({
      project: PROJECT,
      states: [STATE_SK],
      reports: [makeReport({ id: 202, kind: "quarterly", reporting_month: null, quarter: 3 })],
    });
    const app = await buildApp(PM_USER);
    const res = await get(app);
    expect(res.body.locations[0].report).toBeNull();
    expect(res.body.completeness.reportsSubmitted).toBe(0);
  });

  it("PMR-CONS-05: on_demand excluded from monthly view; on_demand view returns only on_demand", async () => {
    installFixture({
      project: PROJECT,
      states: [STATE_SK],
      reports: [
        makeReport({ id: 203, kind: "on_demand", reporting_month: null }),
        makeReport({ id: 204, kind: "monthly", reporting_month: 7 }),
      ],
    });
    const app = await buildApp(PM_USER);
    const monthly = await get(app);
    expect(monthly.body.locations[0].report.reportId).toBe(204);

    const onDemand = await get(app, "projectId=10&kind=on_demand&reportingYear=2026");
    expect(onDemand.status).toBe(200);
    expect(onDemand.body.locations[0].report.reportId).toBe(203);
  });
});

// ─── PMR-CONS-06..10: expected locations ─────────────────────────────────────

describe("PMR-CONS-06..10 — expected locations", () => {
  it("PMR-CONS-06: single-state project → one state location", async () => {
    installFixture({ project: PROJECT, states: [STATE_SK], reports: [] });
    const app = await buildApp(PM_USER);
    const res = await get(app);
    expect(res.body.locations).toHaveLength(1);
    expect(res.body.locations[0]).toMatchObject({
      locationType: "state", stateId: 5, locationName: "South Kordofan",
    });
  });

  it("PMR-CONS-07: multi-state project → all states appear (submitted + missing)", async () => {
    installFixture({
      project: PROJECT,
      states: [STATE_SK, STATE_KA, STATE_RS],
      reports: [makeReport({ id: 300, state_id: 5 })],
    });
    const app = await buildApp(PM_USER);
    const res = await get(app);
    expect(res.body.locations).toHaveLength(3);
    expect(res.body.completeness).toMatchObject({
      expectedLocations: 3, reportsSubmitted: 1, missingLocations: 2,
    });
  });

  it("PMR-CONS-08: HQ-only project (has_hq_operations=true, no states) → HQ location", async () => {
    installFixture({
      project: { ...PROJECT, hasHqOperations: true },
      states: [],
      reports: [],
    });
    const app = await buildApp(PM_USER);
    const res = await get(app);
    expect(res.body.locations).toHaveLength(1);
    expect(res.body.locations[0]).toMatchObject({
      locationType: "hq", stateId: null, locationName: "HQ",
    });
  });

  it("PMR-CONS-09: HQ + multiple states → HQ first, then states; each independent", async () => {
    installFixture({
      project: { ...PROJECT, hasHqOperations: true },
      states: [STATE_KA, STATE_SK],
      reports: [makeReport({ id: 301, state_id: null, location_type: "hq", status: "approved" })],
    });
    const app = await buildApp(PM_USER);
    const res = await get(app);
    expect(res.body.locations[0].locationType).toBe("hq");
    expect(res.body.locations[0].report.reportId).toBe(301);
    const stateLocs = res.body.locations.slice(1);
    expect(stateLocs).toHaveLength(2);
    for (const l of stateLocs) {
      expect(l.locationType).toBe("state");
      expect(l.isMissing).toBe(true);
    }
  });

  it("PMR-CONS-10: has_hq_operations=false → HQ NOT expected (regardless of hq management)", async () => {
    installFixture({
      project: { ...PROJECT, hasHqOperations: false },
      states: [STATE_SK],
      reports: [],
    });
    const app = await buildApp(PM_USER);
    const res = await get(app);
    const types = res.body.locations.map((l: { locationType: string }) => l.locationType);
    expect(types).not.toContain("hq");
  });
});

// ─── PMR-CONS-11..16: completeness ───────────────────────────────────────────

describe("PMR-CONS-11..16 — completeness statuses", () => {
  it("PMR-CONS-11: missing location → isMissing=true and report=null", async () => {
    installFixture({ project: PROJECT, states: [STATE_SK], reports: [] });
    const app = await buildApp(PM_USER);
    const res = await get(app);
    expect(res.body.locations[0]).toMatchObject({ isMissing: true, report: null });
  });

  it("PMR-CONS-12: draft report → isMissing=true (never entered workflow), status=draft returned", async () => {
    installFixture({
      project: PROJECT,
      states: [STATE_SK],
      reports: [makeReport({ id: 400, status: "draft", submitted_at: null })],
    });
    const app = await buildApp(PM_USER);
    const res = await get(app);
    const loc = res.body.locations[0];
    expect(loc.isMissing).toBe(true);
    expect(loc.report.status).toBe("draft");
    expect(res.body.completeness.reportsSubmitted).toBe(0);
  });

  it("PMR-CONS-13: submitted / in-review statuses count as submitted", async () => {
    for (const status of ["submitted", "technically_approved", "coordination_approved"]) {
      installFixture({
        project: PROJECT,
        states: [STATE_SK],
        reports: [makeReport({ id: 401, status })],
      });
      const app = await buildApp(PM_USER);
      const res = await get(app);
      expect(res.body.completeness.reportsSubmitted, status).toBe(1);
      expect(res.body.completeness.reportsApproved, status).toBe(0);
      expect(res.body.locations[0].isMissing, status).toBe(false);
    }
  });

  it("PMR-CONS-14: approved counts in both submitted and approved", async () => {
    installFixture({
      project: PROJECT,
      states: [STATE_SK],
      reports: [makeReport({ id: 402, status: "approved" })],
    });
    const app = await buildApp(PM_USER);
    const res = await get(app);
    expect(res.body.completeness).toMatchObject({ reportsSubmitted: 1, reportsApproved: 1 });
  });

  it("PMR-CONS-15: returned/rejected does NOT count as submitted or approved", async () => {
    installFixture({
      project: PROJECT,
      states: [STATE_SK],
      reports: [makeReport({ id: 403, status: "rejected" })],
    });
    const app = await buildApp(PM_USER);
    const res = await get(app);
    expect(res.body.completeness).toMatchObject({ reportsSubmitted: 0, reportsApproved: 0 });
    expect(res.body.locations[0]).toMatchObject({ isMissing: false });
    expect(res.body.locations[0].report.status).toBe("rejected");
  });

  it("PMR-CONS-16: completeness block agrees with pmr-reporting-completeness for same params + scope", async () => {
    const fixture: Fixture = {
      project: { ...PROJECT, hasHqOperations: true },
      states: [STATE_SK, STATE_KA, STATE_RS],
      reports: [
        makeReport({ id: 500, state_id: 5, status: "approved" }),
        makeReport({ id: 501, state_id: 6, status: "submitted" }),
        makeReport({ id: 502, state_id: 7, status: "draft", submitted_at: null }),
      ],
    };
    installFixture(fixture);
    const app = await buildDualApp(PM_USER);
    const cons = await get(app);
    installFixture(fixture); // fresh capture for second endpoint
    const comp = await request(app).get(
      "/api/dashboard/pmr-reporting-completeness?projectId=10&kind=monthly&reportingYear=2026&reportingMonth=7",
    );
    expect(cons.status).toBe(200);
    expect(comp.status).toBe(200);
    const compProj = comp.body.projects[0];
    expect(cons.body.completeness).toEqual({
      expectedLocations: compProj.expectedLocations,
      reportsSubmitted: compProj.reportsSubmitted,
      reportsApproved: compProj.reportsApproved,
      missingLocations: compProj.missingLocations,
      completenessPercent: compProj.completenessPercent,
    });

    // Same agreement under SPO scope (project_assignments + state clamp)
    const spoFixture: Fixture = { ...fixture, assignments: [10] };
    installFixture(spoFixture);
    const spoApp = await buildDualApp(SPO_USER);
    const spoCons = await get(spoApp);
    installFixture(spoFixture);
    const spoComp = await request(spoApp).get(
      "/api/dashboard/pmr-reporting-completeness?projectId=10&kind=monthly&reportingYear=2026&reportingMonth=7",
    );
    expect(spoCons.status).toBe(200);
    const spoProj = spoComp.body.projects[0];
    expect(spoCons.body.completeness).toEqual({
      expectedLocations: spoProj.expectedLocations,
      reportsSubmitted: spoProj.reportsSubmitted,
      reportsApproved: spoProj.reportsApproved,
      missingLocations: spoProj.missingLocations,
      completenessPercent: spoProj.completenessPercent,
    });
  });
});

// ─── PMR-CONS-17..22: security ───────────────────────────────────────────────

describe("PMR-CONS-17..22 — security / scope", () => {
  it("PMR-CONS-17: SPO cannot see another state's PMR or location name", async () => {
    installFixture({
      assignments: [10],
      project: PROJECT,
      states: [STATE_SK, STATE_KA],
      reports: [
        makeReport({ id: 600, state_id: 5 }),
        makeReport({ id: 601, state_id: 6, narrative: "Kassala secret narrative" }),
      ],
    });
    const app = await buildApp(SPO_USER);
    const res = await get(app);
    expect(res.status).toBe(200);
    expect(res.body.locations).toHaveLength(1);
    expect(res.body.locations[0].stateId).toBe(5);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain("Kassala");
    expect(raw).not.toContain("601");
    expect(raw).not.toContain("secret");
  });

  it("PMR-CONS-18: state user with stateId=null → 403", async () => {
    for (const role of ["state_program_officer", "state_office_manager"]) {
      const captured = installFixture({ project: PROJECT, states: [STATE_SK], reports: [] });
      const app = await buildApp({ ...SPO_USER, role, stateId: null });
      const res = await get(app);
      expect(res.status, role).toBe(403);
      // Fails closed before any data query
      expect(
        captured.filter((c) => /FROM\s+(projects|project_states|reports)/i.test(c.sql)),
        role,
      ).toHaveLength(0);
    }
  });

  it("PMR-CONS-19: TC sector scope enforced — in-sector project accessible", async () => {
    installFixture({
      project: PROJECT, // sector: Health
      states: [STATE_SK],
      reports: [makeReport({ id: 602 })],
    });
    const app = await buildApp(TC_HEALTH);
    const res = await get(app);
    expect(res.status).toBe(200);
    expect(res.body.locations[0].report.reportId).toBe(602);
  });

  it("PMR-CONS-20: TC with no assigned sector → 403", async () => {
    installFixture({ project: PROJECT, states: [STATE_SK], reports: [] });
    const app = await buildApp(TC_NO_SECTOR);
    const res = await get(app);
    expect(res.status).toBe(403);
  });

  it("PMR-CONS-21: project not in user scope → 404 (TC out-of-sector; SPO out-of-state)", async () => {
    installFixture({
      project: { ...PROJECT, sector: "WASH" },
      states: [STATE_SK],
      reports: [],
    });
    const tcApp = await buildApp(TC_HEALTH);
    expect((await get(tcApp)).status).toBe(404);

    // SPO whose state is not an operational location of this project
    installFixture({
      assignments: [10],
      project: PROJECT,
      states: [STATE_KA], // state 6 only; SPO is state 5
      reports: [],
    });
    const spoApp = await buildApp(SPO_USER);
    expect((await get(spoApp)).status).toBe(404);

    // SPO NOT assigned to this project → 404 even though their state is an
    // operational location (mirrors buildScope() project_assignments clamp)
    const captured = installFixture({
      assignments: [99], // assigned to a different project only
      project: PROJECT,
      states: [STATE_SK],
      reports: [makeReport({ id: 610, state_id: 5 })],
    });
    const spoUnassigned = await buildApp(SPO_USER);
    const denied = await get(spoUnassigned);
    expect(denied.status).toBe(404);
    // Denied before any report content is queried — no data leakage
    expect(captured.filter((c) => /FROM\s+reports\s+r/i.test(c.sql))).toHaveLength(0);

    // Nonexistent project
    installFixture({ project: null, states: [], reports: [] });
    const pmApp = await buildApp(PM_USER);
    expect((await get(pmApp)).status).toBe(404);
  });

  it("PMR-CONS-22: out-of-scope location existence must not leak (no stateId/name in missing list)", async () => {
    installFixture({
      assignments: [10],
      project: { ...PROJECT, hasHqOperations: true },
      states: [STATE_SK, STATE_KA, STATE_RS],
      reports: [],
    });
    const app = await buildApp(SPO_USER);
    const res = await get(app);
    expect(res.status).toBe(200);
    // Only their own state — no other state rows, and no HQ row for state-clamped users
    expect(res.body.locations).toHaveLength(1);
    expect(res.body.locations[0].stateId).toBe(5);
    const raw = JSON.stringify(res.body.locations);
    expect(raw).not.toContain("Kassala");
    expect(raw).not.toContain("Red Sea");
    expect(raw).not.toContain('"hq"');
    // Completeness reflects the scoped subset only — no leakage via counts
    expect(res.body.completeness.expectedLocations).toBe(1);
  });
});

// ─── PMR-CONS-23..26: beneficiary + currency rules ───────────────────────────

describe("PMR-CONS-23..26 — beneficiaries and currency", () => {
  it("PMR-CONS-23: beneficiary figures stay per-location; no cross-location sum", async () => {
    installFixture({
      project: PROJECT,
      states: [STATE_SK, STATE_KA],
      reports: [
        makeReport({ id: 700, state_id: 5, beneficiaries_male: 100, beneficiaries_female: 200 }),
        makeReport({ id: 701, state_id: 6, beneficiaries_male: 30, beneficiaries_female: 40 }),
      ],
    });
    const app = await buildApp(PM_USER);
    const res = await get(app);
    const byState = Object.fromEntries(
      res.body.locations.map((l: { stateId: number; report: Record<string, unknown> }) => [l.stateId, l.report]),
    );
    expect(byState[5].beneficiariesMale).toBe(100);
    expect(byState[6].beneficiariesMale).toBe(30);
    // No summed value (130 / 240) anywhere in the payload
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain("130");
    expect(raw).not.toContain("240");
  });

  it("PMR-CONS-24: no uniqueBeneficiaries or totalBeneficiaries field in the response", async () => {
    installFixture({
      project: PROJECT,
      states: [STATE_SK],
      reports: [makeReport({ id: 702 })],
    });
    const app = await buildApp(PM_USER);
    const res = await get(app);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/uniqueBeneficiaries/i);
    expect(raw).not.toMatch(/totalBeneficiaries/i);
  });

  it("PMR-CONS-25: zero-beneficiary HQ PMR returns explicit zeros, not null; location present", async () => {
    installFixture({
      project: { ...PROJECT, hasHqOperations: true },
      states: [],
      reports: [
        makeReport({
          id: 703, state_id: null, location_type: "hq",
          beneficiaries_male: 0, beneficiaries_female: 0,
          beneficiaries_boys: 0, beneficiaries_girls: 0,
        }),
      ],
    });
    const app = await buildApp(PM_USER);
    const res = await get(app);
    const hq = res.body.locations[0];
    expect(hq.locationType).toBe("hq");
    expect(hq.report.beneficiariesMale).toBe(0);
    expect(hq.report.beneficiariesFemale).toBe(0);
    expect(hq.report.beneficiariesBoys).toBe(0);
    expect(hq.report.beneficiariesGirls).toBe(0);
  });

  it("PMR-CONS-26: mixed currencies both returned per-PMR; no combined currency field", async () => {
    installFixture({
      project: PROJECT,
      states: [STATE_SK, STATE_KA],
      reports: [
        makeReport({ id: 704, state_id: 5, currency: "USD", planned_budget: "1000", actual_expenditure: "800" }),
        makeReport({ id: 705, state_id: 6, currency: "SDG", planned_budget: "5000", actual_expenditure: "4000" }),
      ],
    });
    const app = await buildApp(PM_USER);
    const res = await get(app);
    const byState = Object.fromEntries(
      res.body.locations.map((l: { stateId: number; report: Record<string, unknown> }) => [l.stateId, l.report]),
    );
    expect(byState[5].currency).toBe("USD");
    expect(byState[5].plannedBudget).toBe(1000);
    expect(byState[6].currency).toBe("SDG");
    expect(byState[6].actualExpenditure).toBe(4000);
    // Top-level blocks carry no combined currency/financial totals
    expect(res.body.completeness.currency).toBeUndefined();
    expect(res.body.project.currency).toBeUndefined();
  });
});

// ─── PMR-CONS-27..31: period validation ──────────────────────────────────────

describe("PMR-CONS-27..31 — period parameter validation", () => {
  it("PMR-CONS-27: missing kind → 400", async () => {
    const app = await buildApp(PM_USER);
    expect((await get(app, "projectId=10&reportingYear=2026")).status).toBe(400);
    expect((await get(app, "projectId=10&kind=weekly&reportingYear=2026")).status).toBe(400);
  });

  it("PMR-CONS-28: kind=monthly without reportingMonth → 400", async () => {
    const app = await buildApp(PM_USER);
    expect((await get(app, "projectId=10&kind=monthly&reportingYear=2026")).status).toBe(400);
    expect((await get(app, "projectId=10&kind=monthly&reportingYear=2026&reportingMonth=13")).status).toBe(400);
  });

  it("PMR-CONS-29: kind=quarterly without quarter → 400", async () => {
    const app = await buildApp(PM_USER);
    expect((await get(app, "projectId=10&kind=quarterly&reportingYear=2026")).status).toBe(400);
    expect((await get(app, "projectId=10&kind=quarterly&reportingYear=2026&quarter=5")).status).toBe(400);
  });

  it("PMR-CONS-30: cross-kind params rejected → 400", async () => {
    const app = await buildApp(PM_USER);
    expect(
      (await get(app, "projectId=10&kind=monthly&reportingYear=2026&reportingMonth=7&quarter=2")).status,
    ).toBe(400);
    expect(
      (await get(app, "projectId=10&kind=quarterly&reportingYear=2026&quarter=2&reportingMonth=7")).status,
    ).toBe(400);
    expect(
      (await get(app, "projectId=10&kind=annual&reportingYear=2026&reportingMonth=7")).status,
    ).toBe(400);
    expect(
      (await get(app, "projectId=10&kind=on_demand&reportingYear=2026&quarter=1")).status,
    ).toBe(400);
  });

  it("PMR-CONS-31: reportingYear out of range → 400; projectId required", async () => {
    const app = await buildApp(PM_USER);
    expect((await get(app, "projectId=10&kind=monthly&reportingYear=1999&reportingMonth=7")).status).toBe(400);
    expect((await get(app, "projectId=10&kind=monthly&reportingYear=2101&reportingMonth=7")).status).toBe(400);
    expect((await get(app, "kind=monthly&reportingYear=2026&reportingMonth=7")).status).toBe(400);
    expect((await get(app, "projectId=abc&kind=monthly&reportingYear=2026&reportingMonth=7")).status).toBe(400);
  });
});

// ─── PMR-CONS-32: report link integrity ──────────────────────────────────────

describe("PMR-CONS-32 — location report link integrity", () => {
  it("report.reportId in a location row matches the PMR from the reports query", async () => {
    const fixtureReports = [
      makeReport({ id: 800, state_id: 5, status: "approved" }),
      makeReport({ id: 801, state_id: 6, status: "submitted" }),
    ];
    installFixture({
      project: PROJECT,
      states: [STATE_SK, STATE_KA],
      reports: fixtureReports,
    });
    const app = await buildApp(PM_USER);
    const res = await get(app);
    for (const loc of res.body.locations as Array<{ stateId: number; report: { reportId: number } | null }>) {
      expect(loc.report).not.toBeNull();
      const source = fixtureReports.find((r) => r.state_id === loc.stateId);
      expect(loc.report!.reportId).toBe(source!.id);
    }
  });
});
