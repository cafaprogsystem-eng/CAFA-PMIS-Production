/**
 * PMR Reporting Completeness — Phase 1 (PMR-015 Option C)
 *
 * Tests PMR-COMP-01..22 for GET /dashboard/pmr-reporting-completeness:
 *   COMP-01..05  expected-location derivation (states + has_hq_operations)
 *   COMP-06..10  exact report matching (period, state, HQ, draft)
 *   COMP-WF      workflow status counting (submitted vs approved vs returned)
 *   COMP-11..13  missing locations
 *   COMP-14..17  scope enforcement (SPO / TC / org-wide)
 *   COMP-18      zero expected locations → completenessPercent null
 *   COMP-19..22  no cross-frequency mixing
 *   COMP-VAL     param validation (400s)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

// ─── Module mocks — before any dynamic import of the route ──────────────────

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

// ─── App factory ─────────────────────────────────────────────────────────────

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

// ─── SQL-dispatching pool mock ───────────────────────────────────────────────

interface Fixture {
  assignments?: number[]; // SPO project_assignments
  projects: { id: number; name: string; code: string; hasHqOperations: boolean }[];
  states: { project_id: number; state_id: number; state_name: string }[];
  reports: {
    project_id: number; state_id: number | null; location_type: string | null;
    status: string; report_id: number; submitted_at: string | null;
  }[];
}

/** Route mock queries by SQL shape; also records the params each query got. */
function installFixture(fx: Fixture) {
  const captured: { sql: string; params: unknown[] }[] = [];
  mockQuery.mockReset();
  mockQuery.mockImplementation((sql: string, params: unknown[] = []) => {
    captured.push({ sql, params });
    if (/project_assignments/i.test(sql)) {
      return Promise.resolve({ rows: (fx.assignments ?? []).map((id) => ({ project_id: id })) });
    }
    if (/FROM\s+projects\s+p/i.test(sql)) {
      return Promise.resolve({ rows: fx.projects });
    }
    if (/FROM\s+project_states\s+ps/i.test(sql)) {
      const ids = (params[0] ?? []) as number[];
      return Promise.resolve({ rows: fx.states.filter((s) => ids.includes(s.project_id)) });
    }
    if (/FROM\s+reports\s+r/i.test(sql)) {
      return Promise.resolve({ rows: fx.reports });
    }
    return Promise.resolve({ rows: [] });
  });
  return captured;
}

const PROJ_A = { id: 10, name: "Project A", code: "CAFA-A", hasHqOperations: false };

const BASE_QS = "kind=monthly&reportingYear=2026&reportingMonth=8";

function get(app: express.Express, qs = BASE_QS) {
  return request(app).get(`/api/dashboard/pmr-reporting-completeness?${qs}`);
}

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
});

// ─── COMP-VAL: parameter validation ─────────────────────────────────────────

describe("COMP-VAL — parameter validation", () => {
  it("400 when kind missing or invalid", async () => {
    const app = await buildApp(PM_USER);
    expect((await get(app, "reportingYear=2026")).status).toBe(400);
    expect((await get(app, "kind=weekly&reportingYear=2026")).status).toBe(400);
    expect((await get(app, "kind=on_demand&reportingYear=2026")).status).toBe(400);
  });

  it("400 when reportingYear missing", async () => {
    const app = await buildApp(PM_USER);
    expect((await get(app, "kind=monthly&reportingMonth=8")).status).toBe(400);
  });

  it("400 when kind=monthly without reportingMonth", async () => {
    const app = await buildApp(PM_USER);
    expect((await get(app, "kind=monthly&reportingYear=2026")).status).toBe(400);
  });

  it("400 when kind=quarterly without quarter", async () => {
    const app = await buildApp(PM_USER);
    expect((await get(app, "kind=quarterly&reportingYear=2026")).status).toBe(400);
  });

  it("annual requires only year", async () => {
    installFixture({ projects: [], states: [], reports: [] });
    const app = await buildApp(PM_USER);
    expect((await get(app, "kind=annual&reportingYear=2026")).status).toBe(200);
  });
});

// ─── COMP-01..05: expected locations ────────────────────────────────────────

describe("COMP-01..05 — expected locations", () => {
  it("COMP-01: single-state project → expectedLocations = 1", async () => {
    installFixture({
      projects: [PROJ_A],
      states: [{ project_id: 10, state_id: 5, state_name: "South Kordofan" }],
      reports: [],
    });
    const app = await buildApp(PM_USER);
    const res = await get(app);
    expect(res.status).toBe(200);
    expect(res.body.projects[0].expectedLocations).toBe(1);
    expect(res.body.summary.expectedLocations).toBe(1);
  });

  it("COMP-02: multi-state project → all states counted for org-wide role", async () => {
    installFixture({
      projects: [PROJ_A],
      states: [
        { project_id: 10, state_id: 5, state_name: "South Kordofan" },
        { project_id: 10, state_id: 6, state_name: "Kassala" },
        { project_id: 10, state_id: 7, state_name: "Red Sea" },
      ],
      reports: [],
    });
    const app = await buildApp(PM_USER);
    const res = await get(app);
    expect(res.body.projects[0].expectedLocations).toBe(3);
  });

  it("COMP-03: HQ-only project (has_hq_operations=true, no states) → expectedLocations = 1", async () => {
    installFixture({
      projects: [{ ...PROJ_A, hasHqOperations: true }],
      states: [],
      reports: [],
    });
    const app = await buildApp(PM_USER);
    const res = await get(app);
    const p = res.body.projects[0];
    expect(p.expectedLocations).toBe(1);
    expect(p.locations[0]).toMatchObject({ locationType: "hq", stateId: null, locationName: "HQ" });
  });

  it("COMP-04: HQ + N states → expectedLocations = 1 + N", async () => {
    installFixture({
      projects: [{ ...PROJ_A, hasHqOperations: true }],
      states: [
        { project_id: 10, state_id: 5, state_name: "South Kordofan" },
        { project_id: 10, state_id: 6, state_name: "Kassala" },
      ],
      reports: [],
    });
    const app = await buildApp(PM_USER);
    const res = await get(app);
    expect(res.body.projects[0].expectedLocations).toBe(3);
  });

  it("COMP-05: has_hq_operations=false → HQ is NOT an expected location", async () => {
    installFixture({
      projects: [PROJ_A],
      states: [{ project_id: 10, state_id: 5, state_name: "South Kordofan" }],
      reports: [],
    });
    const app = await buildApp(PM_USER);
    const res = await get(app);
    const types = res.body.projects[0].locations.map((l: { locationType: string }) => l.locationType);
    expect(types).not.toContain("hq");
  });
});

// ─── COMP-06..10: report matching ───────────────────────────────────────────

describe("COMP-06..10 — report matching", () => {
  const twoStates = [
    { project_id: 10, state_id: 5, state_name: "South Kordofan" },
    { project_id: 10, state_id: 6, state_name: "Kassala" },
  ];

  it("COMP-06: matching PMR by exact project+location+period counts as submitted", async () => {
    installFixture({
      projects: [PROJ_A],
      states: twoStates,
      reports: [{ project_id: 10, state_id: 5, location_type: "state", status: "submitted", report_id: 100, submitted_at: "2026-08-10T09:00:00Z" }],
    });
    const app = await buildApp(PM_USER);
    const res = await get(app);
    const p = res.body.projects[0];
    expect(p.reportsSubmitted).toBe(1);
    const loc = p.locations.find((l: { stateId: number | null }) => l.stateId === 5);
    expect(loc).toMatchObject({ reportId: 100, reportStatus: "submitted", isMissing: false });
  });

  it("COMP-07: the SQL period filter matches kind + year + month exactly", async () => {
    const captured = installFixture({ projects: [PROJ_A], states: twoStates, reports: [] });
    const app = await buildApp(PM_USER);
    await get(app);
    const repQ = captured.find((c) => /FROM\s+reports\s+r/i.test(c.sql));
    expect(repQ).toBeDefined();
    expect(repQ!.sql).toMatch(/r\.kind = \$2/);
    expect(repQ!.sql).toMatch(/r\.reporting_year = \$3/);
    expect(repQ!.sql).toMatch(/r\.reporting_month = \$4/);
    expect(repQ!.params.slice(1)).toEqual(["monthly", 2026, 8]);
  });

  it("COMP-08: a report for a different state does not count for the target location", async () => {
    installFixture({
      projects: [PROJ_A],
      states: twoStates,
      reports: [{ project_id: 10, state_id: 6, location_type: "state", status: "approved", report_id: 101, submitted_at: null }],
    });
    const app = await buildApp(PM_USER);
    const res = await get(app);
    const loc5 = res.body.projects[0].locations.find((l: { stateId: number | null }) => l.stateId === 5);
    expect(loc5.isMissing).toBe(true);
    expect(loc5.reportId).toBeNull();
  });

  it("COMP-09: HQ report (location_type=hq) matches HQ only, not any state", async () => {
    installFixture({
      projects: [{ ...PROJ_A, hasHqOperations: true }],
      states: twoStates,
      reports: [{ project_id: 10, state_id: null, location_type: "hq", status: "approved", report_id: 102, submitted_at: "2026-08-10T09:00:00Z" }],
    });
    const app = await buildApp(PM_USER);
    const res = await get(app);
    const p = res.body.projects[0];
    const hq = p.locations.find((l: { locationType: string }) => l.locationType === "hq");
    expect(hq).toMatchObject({ reportId: 102, reportStatus: "approved", isMissing: false });
    for (const l of p.locations.filter((x: { locationType: string }) => x.locationType === "state")) {
      expect(l.isMissing).toBe(true);
    }
  });

  it("COMP-10: draft does not count as submitted (but is not a fabricated missing row)", async () => {
    installFixture({
      projects: [PROJ_A],
      states: twoStates,
      reports: [{ project_id: 10, state_id: 5, location_type: "state", status: "draft", report_id: 103, submitted_at: null }],
    });
    const app = await buildApp(PM_USER);
    const res = await get(app);
    const p = res.body.projects[0];
    expect(p.reportsSubmitted).toBe(0);
    const loc = p.locations.find((l: { stateId: number | null }) => l.stateId === 5);
    expect(loc).toMatchObject({ reportStatus: "draft", isMissing: true });
  });
});

// ─── COMP-WF: workflow status counting ──────────────────────────────────────

describe("COMP-WF — workflow status counting", () => {
  const oneState = [{ project_id: 10, state_id: 5, state_name: "South Kordofan" }];

  async function statusCase(status: string) {
    installFixture({
      projects: [PROJ_A],
      states: oneState,
      reports: [{ project_id: 10, state_id: 5, location_type: "state", status, report_id: 200, submitted_at: "2026-08-10T09:00:00Z" }],
    });
    const app = await buildApp(PM_USER);
    const res = await get(app);
    return res.body.projects[0];
  }

  it("submitted counts in reportsSubmitted but not reportsApproved", async () => {
    const p = await statusCase("submitted");
    expect(p.reportsSubmitted).toBe(1);
    expect(p.reportsApproved).toBe(0);
  });

  it("in-review statuses count in reportsSubmitted", async () => {
    for (const s of ["technically_approved", "coordination_approved", "state_reviewed"]) {
      const p = await statusCase(s);
      expect(p.reportsSubmitted, s).toBe(1);
      expect(p.reportsApproved, s).toBe(0);
    }
  });

  it("approved counts in both reportsSubmitted and reportsApproved", async () => {
    const p = await statusCase("approved");
    expect(p.reportsSubmitted).toBe(1);
    expect(p.reportsApproved).toBe(1);
  });

  it("rejected/returned counts as neither submitted nor approved, but is not missing-with-no-report", async () => {
    const p = await statusCase("rejected");
    expect(p.reportsSubmitted).toBe(0);
    expect(p.reportsApproved).toBe(0);
    expect(p.locations[0]).toMatchObject({ reportStatus: "rejected", isMissing: false });
  });
});

// ─── COMP-11..13: missing locations ─────────────────────────────────────────

describe("COMP-11..13 — missing locations", () => {
  const threeStates = [
    { project_id: 10, state_id: 5, state_name: "South Kordofan" },
    { project_id: 10, state_id: 6, state_name: "Kassala" },
    { project_id: 10, state_id: 7, state_name: "Red Sea" },
  ];

  it("COMP-11: expected state with no PMR → isMissing=true", async () => {
    installFixture({ projects: [PROJ_A], states: threeStates.slice(0, 1), reports: [] });
    const app = await buildApp(PM_USER);
    const res = await get(app);
    expect(res.body.projects[0].locations[0]).toMatchObject({
      isMissing: true, reportId: null, reportStatus: null, submittedAt: null,
    });
  });

  it("COMP-12: 1 of 3 missing → summary counts 2/3 with 66.7%", async () => {
    installFixture({
      projects: [PROJ_A],
      states: threeStates,
      reports: [
        { project_id: 10, state_id: 5, location_type: "state", status: "approved", report_id: 300, submitted_at: null },
        { project_id: 10, state_id: 6, location_type: "state", status: "submitted", report_id: 301, submitted_at: null },
      ],
    });
    const app = await buildApp(PM_USER);
    const res = await get(app);
    expect(res.body.summary).toMatchObject({
      expectedLocations: 3, reportsSubmitted: 2, reportsApproved: 1,
      missingLocations: 1, completenessPercent: 66.7,
    });
  });

  it("COMP-13: no reports at all → 0 submitted, all missing, 0%", async () => {
    installFixture({ projects: [PROJ_A], states: threeStates, reports: [] });
    const app = await buildApp(PM_USER);
    const res = await get(app);
    expect(res.body.summary).toMatchObject({
      reportsSubmitted: 0, missingLocations: 3, completenessPercent: 0,
    });
  });
});

// ─── COMP-14..17: scope enforcement ─────────────────────────────────────────

describe("COMP-14..17 — scope enforcement", () => {
  it("COMP-14: SPO scope filters projects to assigned project IDs", async () => {
    const captured = installFixture({
      assignments: [10],
      projects: [PROJ_A],
      states: [{ project_id: 10, state_id: 5, state_name: "South Kordofan" }],
      reports: [],
    });
    const app = await buildApp(SPO_USER);
    const res = await get(app);
    expect(res.status).toBe(200);
    const projQ = captured.find((c) => /FROM\s+projects\s+p/i.test(c.sql));
    expect(projQ!.sql).toMatch(/p\.id = ANY\(\$1::int\[\]\)/);
    expect(projQ!.params[0]).toEqual([10]);
  });

  it("COMP-14b: SPO with no assignments fails closed (AND FALSE)", async () => {
    const captured = installFixture({ assignments: [], projects: [], states: [], reports: [] });
    const app = await buildApp(SPO_USER);
    const res = await get(app);
    expect(res.body.summary.projectsInScope).toBe(0);
    const projQ = captured.find((c) => /FROM\s+projects\s+p/i.test(c.sql));
    expect(projQ!.sql).toMatch(/AND FALSE/);
  });

  it("COMP-15: TC sector scope enforced in project query", async () => {
    const captured = installFixture({ projects: [], states: [], reports: [] });
    const app = await buildApp(TC_HEALTH);
    await get(app);
    const projQ = captured.find((c) => /FROM\s+projects\s+p/i.test(c.sql));
    expect(projQ!.sql).toMatch(/p\.sector = ANY\(\$1::text\[\]\)/);
    expect(projQ!.params[0]).toEqual(["Health"]);
  });

  it("COMP-16: TC with no sector assigned fails closed", async () => {
    const captured = installFixture({ projects: [], states: [], reports: [] });
    const app = await buildApp(TC_NO_SECTOR);
    const res = await get(app);
    expect(res.body.summary.projectsInScope).toBe(0);
    const projQ = captured.find((c) => /FROM\s+projects\s+p/i.test(c.sql));
    expect(projQ!.sql).toMatch(/AND FALSE/);
  });

  it("COMP-14c: SOM state role is clamped — locations and reports queries filter to their state", async () => {
    const SOM_USER = { ...SPO_USER, id: 6, role: "state_office_manager", roleLabel: "State Office Manager" };
    const captured = installFixture({
      projects: [{ ...PROJ_A, hasHqOperations: true }],
      states: [{ project_id: 10, state_id: 5, state_name: "South Kordofan" }],
      reports: [],
    });
    const app = await buildApp(SOM_USER);
    const res = await get(app);
    expect(res.status).toBe(200);
    // Locations query clamped to state 5
    const stQ = captured.find((c) => /FROM\s+project_states\s+ps/i.test(c.sql));
    expect(stQ!.sql).toMatch(/ps\.state_id = \$2/);
    expect(stQ!.params[1]).toBe(5);
    // Reports query clamped to state 5
    const repQ = captured.find((c) => /FROM\s+reports\s+r/i.test(c.sql));
    expect(repQ!.sql).toMatch(/r\.state_id = \$5/);
    expect(repQ!.params[4]).toBe(5);
    // HQ is not exposed to state-clamped users even when has_hq_operations=true
    const types = res.body.projects[0].locations.map((l: { locationType: string }) => l.locationType);
    expect(types).not.toContain("hq");
  });

  it("COMP-14d: SPO is clamped to their own state on multi-state assigned projects", async () => {
    const captured = installFixture({
      assignments: [10],
      projects: [PROJ_A],
      states: [{ project_id: 10, state_id: 5, state_name: "South Kordofan" }],
      reports: [],
    });
    const app = await buildApp(SPO_USER);
    const res = await get(app);
    expect(res.status).toBe(200);
    const stQ = captured.find((c) => /FROM\s+project_states\s+ps/i.test(c.sql));
    expect(stQ!.sql).toMatch(/ps\.state_id = \$2/);
    expect(stQ!.params[1]).toBe(5);
    const repQ = captured.find((c) => /FROM\s+reports\s+r/i.test(c.sql));
    expect(repQ!.sql).toMatch(/r\.state_id = \$5/);
  });

  it("COMP-14e: state role with no state assigned fails closed (no queries, empty response)", async () => {
    for (const role of ["state_office_manager", "state_program_officer"]) {
      const captured = installFixture({
        projects: [PROJ_A],
        states: [{ project_id: 10, state_id: 5, state_name: "South Kordofan" }],
        reports: [],
      });
      const user = { ...SPO_USER, id: 7, role, stateId: null };
      const app = await buildApp(user);
      const res = await get(app);
      expect(res.status, role).toBe(200);
      expect(res.body.summary.projectsInScope, role).toBe(0);
      expect(res.body.projects, role).toEqual([]);
      // Fails closed before any data query runs
      expect(captured.filter((c) => /FROM\s+(projects|project_states|reports)/i.test(c.sql)), role).toHaveLength(0);
    }
  });

  it("route is gated by requirePerm('reports.view') server-side", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = await import("node:path");
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(path.join(here, "..", "routes", "dashboard.ts"), "utf8");
    expect(src).toMatch(
      /router\.get\("\/dashboard\/pmr-reporting-completeness",\s*requirePerm\("reports\.view"\)/,
    );
  });

  it("COMP-17: org-wide role has no scope conditions in the project query", async () => {
    const captured = installFixture({
      projects: [PROJ_A],
      states: [{ project_id: 10, state_id: 5, state_name: "South Kordofan" }],
      reports: [],
    });
    const app = await buildApp(PM_USER);
    await get(app);
    const projQ = captured.find((c) => /FROM\s+projects\s+p/i.test(c.sql));
    expect(projQ!.sql).not.toMatch(/AND FALSE|state_id|sector/);
  });
});

// ─── COMP-18: zero expected locations ───────────────────────────────────────

describe("COMP-18 — zero expected locations", () => {
  it("project with no operational locations → completenessPercent = null", async () => {
    installFixture({ projects: [PROJ_A], states: [], reports: [] });
    const app = await buildApp(PM_USER);
    const res = await get(app);
    expect(res.body.projects[0].expectedLocations).toBe(0);
    expect(res.body.projects[0].completenessPercent).toBeNull();
    expect(res.body.summary.completenessPercent).toBeNull();
  });
});

// ─── COMP-19..22: no cross-frequency mixing ─────────────────────────────────

describe("COMP-19..22 — no cross-frequency mixing", () => {
  it("COMP-19/20: quarterly request binds kind=quarterly and quarter param", async () => {
    const captured = installFixture({
      projects: [PROJ_A],
      states: [{ project_id: 10, state_id: 5, state_name: "South Kordofan" }],
      reports: [],
    });
    const app = await buildApp(PM_USER);
    const res = await get(app, "kind=quarterly&reportingYear=2026&quarter=2");
    expect(res.status).toBe(200);
    const repQ = captured.find((c) => /FROM\s+reports\s+r/i.test(c.sql));
    expect(repQ!.sql).toMatch(/r\.kind = \$2/);
    expect(repQ!.sql).toMatch(/r\.quarter = \$4/);
    expect(repQ!.sql).not.toMatch(/reporting_month/);
    expect(repQ!.params.slice(1)).toEqual(["quarterly", 2026, 2]);
    expect(res.body.projects[0].reportingPeriod).toEqual({ year: 2026, quarter: 2 });
  });

  it("COMP-21: annual request binds kind=annual with year only", async () => {
    const captured = installFixture({
      projects: [PROJ_A],
      states: [{ project_id: 10, state_id: 5, state_name: "South Kordofan" }],
      reports: [],
    });
    const app = await buildApp(PM_USER);
    const res = await get(app, "kind=annual&reportingYear=2026");
    expect(res.status).toBe(200);
    const repQ = captured.find((c) => /FROM\s+reports\s+r/i.test(c.sql));
    expect(repQ!.params.slice(1)).toEqual(["annual", 2026]);
    expect(repQ!.sql).not.toMatch(/reporting_month|r\.quarter/);
  });

  it("COMP-22: on-demand kind is rejected — scheduled completeness cannot be satisfied by on-demand", async () => {
    const app = await buildApp(PM_USER);
    const res = await get(app, "kind=on_demand&reportingYear=2026");
    expect(res.status).toBe(400);
  });

  it("reports query is restricted to report_type='project' and excludes archived", async () => {
    const captured = installFixture({
      projects: [PROJ_A],
      states: [{ project_id: 10, state_id: 5, state_name: "South Kordofan" }],
      reports: [],
    });
    const app = await buildApp(PM_USER);
    await get(app);
    const repQ = captured.find((c) => /FROM\s+reports\s+r/i.test(c.sql));
    expect(repQ!.sql).toMatch(/report_type = 'project'/);
    expect(repQ!.sql).toMatch(/status != 'archived'/);
  });
});
