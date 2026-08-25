/**
 * SPR-003/004 — SOM fallback FULL lifecycle integration tests.
 *
 * Unlike the other author-gate suites, this file does NOT mock the
 * currentUser middleware module: the real requirePerm / permissionsFor run,
 * so these tests verify actual production middleware authorization:
 *
 *  - SOM (vacancy confirmed) can CREATE → EDIT (PATCH) → SUBMIT their own SPR
 *  - SOM cannot edit or submit someone else's report, or non-SPR reports
 *  - SOM cannot perform any review/approve/reject transition
 *  - SOM remains denied on project / activity / hq_sector creation
 *  - ED / viewer are still blocked at the real outer gates
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

const mockQuery = vi.fn();
vi.mock("@workspace/db", () => ({
  pool: {
    query: mockQuery,
    connect: vi.fn().mockResolvedValue({ query: mockQuery, release: vi.fn() }),
  },
}));

vi.mock("../lib/realtime.js", () => ({
  realtime: { emit: vi.fn(), to: vi.fn().mockReturnThis() },
}));

vi.mock("../lib/notifications.js", () => ({
  notifyEntityActorsDeduped: vi.fn().mockResolvedValue(undefined),
  notifyNextApprover: vi.fn().mockResolvedValue(undefined),
}));

// NOTE: no vi.mock of ../middlewares/currentUser.js — real middleware runs.

const SOM_USER = { id: 40, name: "SOM", email: "som@example.com", role: "state_office_manager", stateId: 1, sector: null, sectors: [] } as const;
const ED_USER = { id: 41, name: "ED", email: "ed@example.com", role: "executive_director", stateId: null, sector: null, sectors: [] } as const;
const VIEWER_USER = { id: 42, name: "V", email: "v@example.com", role: "viewer", stateId: null, sector: null, sectors: [] } as const;

const REPORT_ID = 500;

/** A fully valid draft SPR row (passes validateProgramStateReportForSubmission). */
function sprRow(overrides: Record<string, unknown> = {}) {
  return {
    id: REPORT_ID,
    status: "draft",
    reportType: "program_state",
    report_type: "program_state",
    stateId: 1,
    state_id: 1,
    sector: null,
    projectId: null,
    project_id: null,
    activityId: null,
    workflowPath: null,
    authorId: SOM_USER.id,
    author_id: SOM_USER.id,
    title: "SPR May",
    kind: "monthly",
    period: "2031-05",
    period_start: null,
    period_end: null,
    on_demand_reason: null,
    sections: {
      sectors: ["Health"],
      localitiesCovered: ["Locality A"],
      humanitarianContext: {
        securitySituation: "stable",
        populationMovements: "low",
        diseaseOutbreaks: "none",
        accessConstraints: "none",
      },
      keyAchievements: "a",
      mainChallenges: "b",
      mitigationMeasures: "c",
      nextPeriodPriorities: "d",
    },
    activities: [
      {
        title: "Vaccination drive",
        sector: "Health",
        activityDate: "2031-05-10",
        achievementSummary: "done",
        beneficiariesMen: 10,
        beneficiariesWomen: 12,
        beneficiariesBoys: 0,
        beneficiariesGirls: 0,
      },
    ],
    ...overrides,
  };
}

/** Generic SQL routing covering create, PATCH, and transition flows. */
function mockRouting(opts: { activeSpoCount?: number; row?: Record<string, unknown> } = {}) {
  const { activeSpoCount = 0, row = sprRow() } = opts;
  mockQuery.mockImplementation((sql: string) => {
    if (typeof sql !== "string") return Promise.resolve({ rows: [] });
    if (sql.includes("role = 'state_program_officer'") && sql.includes("status = 'active'")) {
      return Promise.resolve({ rows: [{ count: activeSpoCount }] });
    }
    if (/FROM states[\s\S]*WHERE id = \$1/.test(sql)) {
      return Promise.resolve({ rows: [{ id: 1, name: "Khartoum", nameAr: "الخرطوم", code: "KRT", operationalStatus: "active", officeStatus: "present" }] });
    }
    if (sql.includes("INSERT INTO reports")) {
      return Promise.resolve({ rows: [{ id: REPORT_ID }] });
    }
    if (sql.includes("UPDATE reports")) {
      return Promise.resolve({ rows: [{ id: REPORT_ID }], rowCount: 1 });
    }
    // getReportSector JOIN query
    if (sql.includes("LEFT JOIN projects")) {
      return Promise.resolve({
        rows: [{ reportType: row.reportType, projectId: null, projectSector: null, activitySector: null, effectiveSector: null }],
      });
    }
    // SPR-008 duplicate pre-check (POST create guard) — no existing duplicate
    if (sql.includes("report_type = 'program_state'") && sql.includes("status NOT IN ('rejected','archived')")) {
      return Promise.resolve({ rows: [] });
    }
    if (sql.includes("FROM reports") && sql.includes("$1")) {
      return Promise.resolve({ rows: [row] });
    }
    return Promise.resolve({ rows: [] });
  });
}

async function buildApp(user: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { currentUser: typeof user }).currentUser = user;
    next();
  });
  const { default: reportsRouter } = await import("../routes/reports.js");
  app.use("/api/projects", reportsRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: "internal", message: err.message });
  });
  return app;
}

const CREATE_BODY = {
  title: "SPR May",
  reportType: "program_state",
  kind: "monthly",
  reportingMonth: 5,
  reportingYear: 2031,
  period: "2031-05",
  sector: "Health",
} as const;

// ─────────────────────────────────────────────────────────────────────────────

describe("SOM fallback lifecycle — real middleware (create → edit → submit)", () => {
  beforeEach(() => { mockQuery.mockReset(); });

  it("SOM-LC-01: SOM creates an SPR when no active SPO covers their state → 201", async () => {
    mockRouting({ activeSpoCount: 0 });
    const app = await buildApp(SOM_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send({ ...CREATE_BODY });
    expect(res.status).toBe(201);
  });

  it("SOM-LC-02: SOM edits their own SPR draft via PATCH → 200", async () => {
    mockRouting();
    const app = await buildApp(SOM_USER as unknown as Record<string, unknown>);
    const res = await request(app)
      .patch(`/api/projects/reports/${REPORT_ID}`)
      .send({ title: "SPR May (updated)" });
    expect(res.status).toBe(200);
  });

  it("SOM-LC-03: SOM submits their own SPR draft via transitions → success", async () => {
    mockRouting();
    const app = await buildApp(SOM_USER as unknown as Record<string, unknown>);
    const res = await request(app)
      .post(`/api/projects/reports/${REPORT_ID}/transitions`)
      .send({ action: "submit" });
    expect(res.status).toBeLessThan(300);
    // status update executed
    const upd = mockQuery.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].includes("UPDATE reports") && c[0].includes("SET status"),
    );
    expect(upd).toBeDefined();
  });

  it("SOM-LC-04: SOM cannot edit a draft authored by someone else → 403 som_program_state_author_only", async () => {
    mockRouting({ row: sprRow({ authorId: 999, author_id: 999 }) });
    const app = await buildApp(SOM_USER as unknown as Record<string, unknown>);
    const res = await request(app)
      .patch(`/api/projects/reports/${REPORT_ID}`)
      .send({ title: "hijack" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("som_program_state_author_only");
  });

  it("SOM-LC-05: SOM cannot edit a non-program_state draft (even own-authored) → 403", async () => {
    mockRouting({ row: sprRow({ reportType: "project", report_type: "project" }) });
    const app = await buildApp(SOM_USER as unknown as Record<string, unknown>);
    const res = await request(app)
      .patch(`/api/projects/reports/${REPORT_ID}`)
      .send({ title: "nope" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("som_program_state_author_only");
  });

  it("SOM-LC-06: SOM cannot edit a null-author historical draft → 403 (loophole closed)", async () => {
    mockRouting({ row: sprRow({ authorId: null, author_id: null }) });
    const app = await buildApp(SOM_USER as unknown as Record<string, unknown>);
    const res = await request(app)
      .patch(`/api/projects/reports/${REPORT_ID}`)
      .send({ title: "nope" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("som_program_state_author_only");
  });

  it("SOM-LC-16: reassigned SOM (state 2) cannot edit an own-authored SPR from state 1 → 403", async () => {
    mockRouting(); // report state_id = 1
    const app = await buildApp({ ...SOM_USER, stateId: 2 } as unknown as Record<string, unknown>);
    const res = await request(app)
      .patch(`/api/projects/reports/${REPORT_ID}`)
      .send({ title: "nope" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("som_program_state_author_only");
  });

  it("SOM-LC-17: null-state SOM cannot edit an own-authored SPR → 403 (fail closed)", async () => {
    mockRouting();
    const app = await buildApp({ ...SOM_USER, stateId: null } as unknown as Record<string, unknown>);
    const res = await request(app)
      .patch(`/api/projects/reports/${REPORT_ID}`)
      .send({ title: "nope" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("som_program_state_author_only");
  });

  it("SOM-LC-18: reassigned SOM (state 2) cannot submit an own-authored SPR from state 1 → 403", async () => {
    mockRouting();
    const app = await buildApp({ ...SOM_USER, stateId: 2 } as unknown as Record<string, unknown>);
    const res = await request(app)
      .post(`/api/projects/reports/${REPORT_ID}/transitions`)
      .send({ action: "submit" });
    expect(res.status).toBe(403);
  });

  it("SOM-LC-19: null-state SOM cannot submit an own-authored SPR → 403 (fail closed)", async () => {
    mockRouting();
    const app = await buildApp({ ...SOM_USER, stateId: null } as unknown as Record<string, unknown>);
    const res = await request(app)
      .post(`/api/projects/reports/${REPORT_ID}/transitions`)
      .send({ action: "submit" });
    expect(res.status).toBe(403);
  });

  it("SOM-LC-20: null-state report (historical) cannot be submitted by SOM → 403 (fail closed)", async () => {
    mockRouting({ row: sprRow({ stateId: null, state_id: null }) });
    const app = await buildApp(SOM_USER as unknown as Record<string, unknown>);
    const res = await request(app)
      .post(`/api/projects/reports/${REPORT_ID}/transitions`)
      .send({ action: "submit" });
    expect(res.status).toBe(403);
  });

  it("SOM-LC-07: SOM cannot submit someone else's SPR → 403 forbidden", async () => {
    mockRouting({ row: sprRow({ authorId: 999, author_id: 999 }) });
    const app = await buildApp(SOM_USER as unknown as Record<string, unknown>);
    const res = await request(app)
      .post(`/api/projects/reports/${REPORT_ID}/transitions`)
      .send({ action: "submit" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("forbidden");
  });

  it("SOM-LC-08: SOM cannot perform review/approve/reject transitions → 403", async () => {
    const actionFromStatus: Record<string, string> = {
      coordination_review: "submitted",
      final_approve: "coordination_approved",
      request_revision: "submitted",
      reject: "submitted",
    };
    for (const action of ["coordination_review", "final_approve", "request_revision", "reject"]) {
      mockQuery.mockReset();
      mockRouting({ row: sprRow({ status: actionFromStatus[action], authorId: 999, author_id: 999 }) });
      const app = await buildApp(SOM_USER as unknown as Record<string, unknown>);
      const res = await request(app)
        .post(`/api/projects/reports/${REPORT_ID}/transitions`)
        .send({ action, comment: "x" });
      expect(res.status, action).toBe(403);
      expect(res.body.error, action).toBe("forbidden");
    }
  });

  it("SOM-LC-09: SOM even on their OWN report cannot approve it (submit-only allowance)", async () => {
    mockRouting({ row: sprRow({ status: "submitted" }) });
    const app = await buildApp(SOM_USER as unknown as Record<string, unknown>);
    const res = await request(app)
      .post(`/api/projects/reports/${REPORT_ID}/transitions`)
      .send({ action: "coordination_review" });
    expect(res.status).toBe(403);
  });
});

describe("SOM fallback lifecycle — other routes stay locked (real middleware)", () => {
  beforeEach(() => { mockQuery.mockReset(); mockQuery.mockResolvedValue({ rows: [] }); });

  it("SOM-LC-10: SOM cannot create a project report → 403 role gate", async () => {
    const app = await buildApp(SOM_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send({
      title: "PMR", reportType: "project", kind: "monthly", reportingMonth: 5, reportingYear: 2031, period: "2031-05", projectId: 1, stateId: 1,
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("project_report_author_role_required");
  });

  it("SOM-LC-11: SOM cannot create an activity report → 403 role gate", async () => {
    const app = await buildApp(SOM_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send({
      title: "AR", reportType: "activity", reportingMonth: 5, reportingYear: 2031, period: "2031-05", activityName: "X",
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("activity_report_author_role_required");
  });

  it("SOM-LC-12: SOM cannot create an hq_sector report → 403 role gate", async () => {
    const app = await buildApp(SOM_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send({
      title: "HQSR", reportType: "hq_sector", kind: "monthly", reportingMonth: 5, reportingYear: 2031, period: "2031-05", sector: "Health",
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("hq_sector_author_role_required");
  });

  it("SOM-LC-13: SOM cannot delete a report → 403 forbidden (reports.delete gate untouched)", async () => {
    const app = await buildApp(SOM_USER as unknown as Record<string, unknown>);
    const res = await request(app).delete(`/api/projects/reports/${REPORT_ID}`);
    expect(res.status).toBe(403);
  });

  it("SOM-LC-14: ED blocked at the real outer gates for create / edit / transitions", async () => {
    const app = await buildApp(ED_USER as unknown as Record<string, unknown>);
    const create = await request(app).post("/api/projects/reports").send({ ...CREATE_BODY });
    expect(create.status).toBe(403);
    const patch = await request(app).patch(`/api/projects/reports/${REPORT_ID}`).send({ title: "x" });
    expect(patch.status).toBe(403);
    const trans = await request(app).post(`/api/projects/reports/${REPORT_ID}/transitions`).send({ action: "submit" });
    expect(trans.status).toBe(403);
  });

  it("SOM-LC-15: viewer blocked at the real outer gates for create / edit / transitions", async () => {
    const app = await buildApp(VIEWER_USER as unknown as Record<string, unknown>);
    const create = await request(app).post("/api/projects/reports").send({ ...CREATE_BODY });
    expect(create.status).toBe(403);
    const patch = await request(app).patch(`/api/projects/reports/${REPORT_ID}`).send({ title: "x" });
    expect(patch.status).toBe(403);
    const trans = await request(app).post(`/api/projects/reports/${REPORT_ID}/transitions`).send({ action: "submit" });
    expect(trans.status).toBe(403);
  });
});
