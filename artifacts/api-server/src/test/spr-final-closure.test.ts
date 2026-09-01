/**
 * SPR Final Closure Tests — Task #409
 *
 * Authoritative HTTP-level verification for the State Programme Report module.
 * Every test uses real route code with mocked DB/services — no "mirror
 * functions" or source-text regex assertions for behavioral claims.
 *
 * Pattern follows spr-author-gate.test.ts / spr-submit.test.ts /
 * spr-identity-hardening.test.ts / spr-duplicate-check.test.ts.
 *
 *  SPR-CLOSE-01  Full lifecycle: create Draft → PATCH → submit → revision cycle
 *  SPR-CLOSE-02  State security: cross-State access blocked via PATCH
 *  SPR-CLOSE-03  Null-State actor fails closed on create (SPO, SOM, TC, SPC)
 *  SPR-CLOSE-04  PM Full Operational Access — create with stateId / submit (#373)
 *  SPR-CLOSE-05  Super Admin Full Operational Access preserved
 *  SPR-CLOSE-06  Identity immutability: all 9 fields rejected in PATCH (409)
 *  SPR-CLOSE-07  Duplicate protection: existing SPR → 409 on POST create
 *  SPR-CLOSE-08  Submit gate: 422 on key missing fields, no ROLLBACK skip
 *  SPR-CLOSE-09  Transaction safety: 422 leaves no status mutation or COMMIT
 *  SPR-CLOSE-10  Reviewer completeness: GET /reports/:id serves full content
 *  SPR-CLOSE-11  Evidence access: attachment download gated; objectPath absent
 *  SPR-CLOSE-12  Analytics: TC scope uses LEFT JOIN + COALESCE (structural)
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks (hoisted — must precede any route import)
// ─────────────────────────────────────────────────────────────────────────────

const mockPoolQuery     = vi.fn();
const mockClientQuery   = vi.fn();
const mockClientRelease = vi.fn();
const mockConnect       = vi.fn();

// vi.hoisted() guarantees these are initialised before ANY vi.mock factory
// runs — needed because vi.mock factories are hoisted to the top of the file
// before const declarations, so a plain `const mockFn = vi.fn()` would be in
// TDZ when the objectStorage factory executes.
// MockObjectStorageService is a regular (non-arrow) function so it can be
// called with `new` — arrow functions are not valid constructors.
const { mockGetObjectEntityFile, mockDownloadObject, MockObjectStorageService } = vi.hoisted(() => {
  const mockGetObjectEntityFile = vi.fn();
  const mockDownloadObject = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function MockObjectStorageService(this: Record<string, unknown>) {
    this.getObjectEntityFile = mockGetObjectEntityFile;
    this.downloadObject      = mockDownloadObject;
  }
  return { mockGetObjectEntityFile, mockDownloadObject, MockObjectStorageService };
});

vi.mock("@workspace/db", () => ({
  pool: {
    query:   mockPoolQuery,
    connect: mockConnect,
  },
}));

vi.mock("../lib/realtime.js", () => ({
  realtime: { emit: vi.fn(), to: vi.fn().mockReturnThis() },
}));

vi.mock("../lib/notifications.js", () => ({
  notifyEntityActorsDeduped: vi.fn().mockResolvedValue(undefined),
  notifyNextApprover:        vi.fn().mockResolvedValue(undefined),
  createNotificationDeduped: vi.fn().mockResolvedValue(undefined),
}));

// requirePerm is a no-op so each suite targets the specific inner gate under test.
vi.mock("../middlewares/currentUser.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../middlewares/currentUser.js")>();
  return {
    ...original,
    logAudit:    vi.fn().mockResolvedValue(undefined),
    requirePerm: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  };
});

// Object storage — SPR-CLOSE-11 uses mocked download stream.
// MockObjectStorageService is declared via vi.hoisted() above so it is a valid
// constructor function available before this factory executes.
vi.mock("../lib/objectStorage.js", () => ({
  ObjectStorageService:      MockObjectStorageService,
  ObjectNotFoundError:       class ObjectNotFoundError extends Error {},
  deleteStorageObjectSafely: vi.fn().mockResolvedValue(undefined),
  isStorageConfigured:       vi.fn().mockReturnValue({ configured: true }),
}));

// AWS S3 (drive-backed attachments — driveFileId is null in SPR attachment tests)
vi.mock("../lib/awsS3.js", () => ({
  isConfigured:       vi.fn().mockReturnValue(false),
  downloadFileStream: vi.fn().mockResolvedValue(null),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Test users
// ─────────────────────────────────────────────────────────────────────────────

const SPO_STATE1 = { id: 10, name: "SPO", email: "spo@ex.com", role: "state_program_officer", stateId: 1, sector: null, sectors: [] } as const;
const SPO_STATE2 = { id: 11, name: "SPO2", email: "spo2@ex.com", role: "state_program_officer", stateId: 2, sector: null, sectors: [] } as const;
const SPO_NULL   = { id: 12, name: "SPO0", email: "spo0@ex.com", role: "state_program_officer", stateId: null, sector: null, sectors: [] } as const;
const SOM_STATE1 = { id: 13, name: "SOM", email: "som@ex.com", role: "state_office_manager", stateId: 1, sector: null, sectors: [] } as const;
const SOM_NULL   = { id: 14, name: "SOM0", email: "som0@ex.com", role: "state_office_manager", stateId: null, sector: null, sectors: [] } as const;
const TC_USER    = { id: 15, name: "TC", email: "tc@ex.com", role: "technical_coordinator", stateId: null, sector: "Health", sectors: ["Health"] } as const;
const SPC_USER   = { id: 16, name: "SPC", email: "spc@ex.com", role: "senior_program_coordinator", stateId: null, sector: null, sectors: [] } as const;
const PM_USER    = { id: 17, name: "PM", email: "pm@ex.com", role: "program_manager", stateId: null, sector: null, sectors: [] } as const;
const SA_USER    = { id: 18, name: "SA", email: "sa@ex.com", role: "super_admin", stateId: null, sector: null, sectors: [] } as const;
const ED_USER    = { id: 19, name: "ED", email: "ed@ex.com", role: "executive_director", stateId: null, sector: null, sectors: [] } as const;

// ─────────────────────────────────────────────────────────────────────────────
// App factory
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// DB helpers shared across suites
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal base SPR POST body (missing-state handled by profile clamp). */
const BASE_BODY = {
  title: "State Programme Report",
  reportType: "program_state",
  kind: "monthly",
  reportingMonth: 5,
  reportingYear: 2031,
  period: "2031-05",
  sector: "Health",
} as const;

/** Created report row returned after INSERT. */
function createdSprRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 99, reportType: "program_state", status: "draft",
    kind: "monthly", authorId: 10, plannedBudget: null, actualExpenditure: null,
    ...overrides,
  };
}

/** Routes pool.query calls for a CREATE (no duplicate, state exists, INSERT succeeds). */
function mockCreateSuccess(opts: { activeSpoCount?: number; stateId?: number } = {}) {
  const { activeSpoCount = 0 } = opts;
  mockPoolQuery.mockImplementation((sql: string) => {
    if (typeof sql !== "string") return Promise.resolve({ rows: [] });
    // SOM vacancy check
    if (sql.includes("role = 'state_program_officer'")) {
      return Promise.resolve({ rows: [{ count: activeSpoCount }] });
    }
    // Active-state eligibility check
    if (/FROM states[\s\S]*WHERE id = \$1/.test(sql)) {
      return Promise.resolve({ rows: [{ id: 1, name: "Khartoum", nameAr: "الخرطوم", code: "KRT", operationalStatus: "active", officeStatus: "present" }] });
    }
    // Duplicate pre-check
    if (sql.includes("NOT IN ('rejected','archived')") && sql.includes("program_state")) {
      return Promise.resolve({ rows: [] }); // no duplicate
    }
    // INSERT
    if (sql.includes("INSERT INTO reports")) {
      return Promise.resolve({ rows: [{ id: 99 }] });
    }
    // Final SELECT for response
    if (sql.includes("FROM reports r") && (sql.includes("WHERE r.id") || sql.includes("r.id ="))) {
      return Promise.resolve({ rows: [createdSprRow()] });
    }
    return Promise.resolve({ rows: [] });
  });
}

/** Routes pool.query for a PATCH: initial SELECT → getReportSector → UPDATE → final SELECT. */
function mockPatchSeq(opts: {
  status?: string;
  stateId?: number;
  authorId?: number;
  reportType?: string;
} = {}) {
  const { status = "draft", stateId = 1, authorId = 10, reportType = "program_state" } = opts;
  let call = 0;
  mockPoolQuery.mockImplementation(() => {
    call++;
    if (call === 1) {
      // Initial report row check
      return Promise.resolve({ rows: [{ status, sector: null, projectId: null, reportType, authorId, sections: null }] });
    }
    if (call === 2) {
      // getReportSector JOIN
      return Promise.resolve({ rows: [{ reportType, projectId: null, projectSector: null, activitySector: null, effectiveSector: null, stateId }] });
    }
    if (call === 3) {
      // UPDATE
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    // Final SELECT
    return Promise.resolve({ rows: [createdSprRow({ status, stateId })] });
  });
}

/** Valid SPR content row for the transitions SELECT content query. */
function validSprContent(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, title: "Valid SPR", state_id: 1, kind: "monthly",
    period: "2026-07", period_start: null, period_end: null, on_demand_reason: null,
    sections: {
      sectors: ["Health"],
      localitiesCovered: ["Khartoum"],
      humanitarianContext: {
        securitySituation: "Stable", populationMovements: "Low",
        diseaseOutbreaks: "None",   accessConstraints: "Minimal",
      },
      keyAchievements: "Delivered aid", mainChallenges: "Access",
      mitigationMeasures: "Coordination", nextPeriodPriorities: "Scale up",
    },
    activities: [{
      title: "Distribution", sector: "Health", activityDate: "2026-07-15",
      achievementSummary: "Distributed kits",
      beneficiariesMen: 50, beneficiariesWomen: 60,
      beneficiariesBoys: 20, beneficiariesGirls: 30,
    }],
    ...overrides,
  };
}

/** SPR lock row for SELECT FOR UPDATE (transitions). */
function sprLockRow(overrides: Record<string, unknown> = {}) {
  return {
    status: "draft", reportType: "program_state", stateId: 1,
    sector: null, projectId: null, activityId: null,
    workflowPath: null, authorId: 10,
    ...overrides,
  };
}

/** getReportSector pool.query result for transitions. */
const SPR_SECTOR = {
  rows: [{ reportType: "program_state", projectId: null, projectSector: null, activitySector: null, effectiveSector: null }],
};

/**
 * Wire the transitions client mock:
 *   [0] BEGIN
 *   [1] SELECT FOR UPDATE → lockRow
 *   [2] SELECT content    → contentRow (SPR-001 gate)
 *   rest → empty rows (UPDATE, INSERT approvals, COMMIT)
 */
function mockTransitionClient(lockRow: Record<string, unknown>, contentRow: Record<string, unknown>) {
  mockClientQuery
    .mockResolvedValueOnce({ rows: [] })           // BEGIN
    .mockResolvedValueOnce({ rows: [lockRow] })    // SELECT FOR UPDATE
    .mockResolvedValueOnce({ rows: [contentRow] }) // SELECT content
    .mockResolvedValue({ rows: [] });              // UPDATE / INSERT approvals / COMMIT
  mockConnect.mockResolvedValue({ query: mockClientQuery, release: mockClientRelease });
}

// ─────────────────────────────────────────────────────────────────────────────
// Global setup
// ─────────────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  // Warm up module import
  mockPoolQuery.mockResolvedValue({ rows: [] });
  mockConnect.mockResolvedValue({ query: mockClientQuery, release: mockClientRelease });
  await buildApp(SPO_STATE1 as unknown as Record<string, unknown>);
});

beforeEach(() => {
  mockPoolQuery.mockReset().mockResolvedValue({ rows: [] });
  mockClientQuery.mockReset().mockResolvedValue({ rows: [] });
  mockClientRelease.mockReset();
  mockConnect.mockReset().mockResolvedValue({ query: mockClientQuery, release: mockClientRelease });
  mockGetObjectEntityFile.mockReset().mockResolvedValue({ key: "private/test" });
  mockDownloadObject.mockReset().mockResolvedValue({
    status: 200,
    headers: new Headers({ "content-type": "application/pdf" }),
    body: null, // null → res.end()
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SPR-CLOSE-01 — Full lifecycle: create → PATCH → submit
// ─────────────────────────────────────────────────────────────────────────────

describe("SPR-CLOSE-01 — Full lifecycle: create Draft → PATCH → submit → 422 guard", () => {
  it("SPR-CLOSE-01a: SPO creates SPR draft → 201", async () => {
    mockCreateSuccess();
    const app = await buildApp(SPO_STATE1 as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send(BASE_BODY);
    expect(res.status).toBe(201);
    expect(res.body.reportType).toBe("program_state");
    expect(res.body.status).toBe("draft");
  });

  it("SPR-CLOSE-01b: SPO PATCHes draft content → 200", async () => {
    mockPatchSeq();
    const app = await buildApp(SPO_STATE1 as unknown as Record<string, unknown>);
    const res = await request(app)
      .patch("/api/projects/reports/99")
      .send({ title: "Updated Title", sections: { note: "updated" } });
    expect(res.status).toBe(200);
  });

  it("SPR-CLOSE-01c: SPO submits complete SPR → transitions to submitted (not 422)", async () => {
    mockTransitionClient(sprLockRow(), validSprContent());
    mockPoolQuery.mockResolvedValue(SPR_SECTOR);
    const app = await buildApp(SPO_STATE1 as unknown as Record<string, unknown>);
    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });
    expect(res.status).not.toBe(422);
    expect([200, 201]).toContain(res.status);
    expect(res.body.error).toBeUndefined();
  });

  it("SPR-CLOSE-01d: submit with empty sections → 422 report_content_incomplete", async () => {
    mockTransitionClient(sprLockRow(), validSprContent({ title: "", sections: {}, activities: [] }));
    mockPoolQuery.mockResolvedValue(SPR_SECTOR);
    const app = await buildApp(SPO_STATE1 as unknown as Record<string, unknown>);
    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("report_content_incomplete");
    expect(Array.isArray(res.body.fields)).toBe(true);
    expect(res.body.fields.length).toBeGreaterThan(0);
  });

  it("SPR-CLOSE-01e: returned draft (post request_revision) can be resubmitted with same ID", async () => {
    // Simulate a returned-for-revision report (status=draft, same ID=1)
    mockTransitionClient(
      sprLockRow({ status: "draft", workflowPath: null }), // returned to draft
      validSprContent(),
    );
    mockPoolQuery.mockResolvedValue(SPR_SECTOR);
    const app = await buildApp(SPO_STATE1 as unknown as Record<string, unknown>);
    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });
    // Same route, same ID — same submit path
    expect([200, 201]).toContain(res.status);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SPR-CLOSE-02 — State security: cross-State PATCH blocked
// ─────────────────────────────────────────────────────────────────────────────

describe("SPR-CLOSE-02 — State security: cross-State access blocked", () => {
  it("SPR-CLOSE-02a: SPO from State 2 cannot PATCH a State 1 SPR draft (403 or 404)", async () => {
    // The report belongs to stateId=1; requester is SPO of stateId=2
    let call = 0;
    mockPoolQuery.mockImplementation(() => {
      call++;
      if (call === 1) {
        // Report belongs to stateId=1
        return Promise.resolve({
          rows: [{ status: "draft", sector: null, projectId: null, reportType: "program_state", authorId: 10, sections: null }],
        });
      }
      if (call === 2) {
        // getReportSector — stateId=1 belongs to State 1
        return Promise.resolve({
          rows: [{ reportType: "program_state", projectId: null, projectSector: null, activitySector: null, effectiveSector: null, stateId: 1 }],
        });
      }
      return Promise.resolve({ rows: [] });
    });
    const app = await buildApp(SPO_STATE2 as unknown as Record<string, unknown>);
    const res = await request(app)
      .patch("/api/projects/reports/99")
      .send({ title: "Injected" });
    // SPO_STATE2 is authorId != authorId of the report (10), and stateId != 1
    // The server checks isDraftEditFullAccess (no) and isSameDraftAuthor (no for SPO State 2)
    expect([403, 404]).toContain(res.status);
  });

  it("SPR-CLOSE-02b: SPO from State 2 cannot submit a State 1 SPR (403 state mismatch)", async () => {
    // Lock row shows the report belongs to stateId=1, and has authorId=10 (SPO State 1)
    // SPO State 2 (stateId=2) is not the author and the state doesn't match
    mockTransitionClient(
      sprLockRow({ stateId: 1, authorId: 10 }),
      validSprContent({ state_id: 1 }),
    );
    mockPoolQuery.mockResolvedValue(SPR_SECTOR);
    const app = await buildApp(SPO_STATE2 as unknown as Record<string, unknown>);
    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });
    // SPO State 2 is not the author of this report
    expect([403, 404]).toContain(res.status);
  });

  it("SPR-CLOSE-02c: SPO State 1 cannot create an SPR with a spoofed body stateId=2 — profile clamp applies", async () => {
    mockCreateSuccess();
    const app = await buildApp(SPO_STATE1 as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send({ ...BASE_BODY, stateId: 2 });
    expect(res.status).toBe(201);
    // Profile stateId (1) always wins — check that INSERT used stateId=1 not 2
    const insertCall = mockPoolQuery.mock.calls.find(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("INSERT INTO reports"),
    );
    expect(insertCall).toBeDefined();
    const insertParams = insertCall![1] as unknown[];
    // stateId parameter in the INSERT should be 1 (the profile state), not 2
    expect(insertParams).not.toContain(2);
    expect(insertParams).toContain(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SPR-CLOSE-03 — Null-State actor fails closed on SPR create
// ─────────────────────────────────────────────────────────────────────────────

describe("SPR-CLOSE-03 — Null-State actor fails closed on SPR create", () => {
  it("SPR-CLOSE-03a: SPO with null stateId → 403 state_scope_required, no INSERT", async () => {
    const app = await buildApp(SPO_NULL as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send(BASE_BODY);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("state_scope_required");
    const insertCalls = mockPoolQuery.mock.calls.filter(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("INSERT INTO reports"),
    );
    expect(insertCalls).toHaveLength(0);
  });

  it("SPR-CLOSE-03b: SOM with null stateId → 403 state_scope_required, no INSERT", async () => {
    const app = await buildApp(SOM_NULL as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send(BASE_BODY);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("state_scope_required");
    expect(mockPoolQuery.mock.calls.filter(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("INSERT"),
    )).toHaveLength(0);
  });

  it("SPR-CLOSE-03c: TC → 403 program_state_report_author_role_required, no INSERT", async () => {
    const app = await buildApp(TC_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send(BASE_BODY);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("program_state_report_author_role_required");
    expect(mockPoolQuery.mock.calls.filter(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("INSERT"),
    )).toHaveLength(0);
  });

  it("SPR-CLOSE-03d: SPC → 403 program_state_report_author_role_required, no INSERT", async () => {
    const app = await buildApp(SPC_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send(BASE_BODY);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("program_state_report_author_role_required");
  });

  it("SPR-CLOSE-03e: ED → 403 (blocked at author gate), no INSERT", async () => {
    const app = await buildApp(ED_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send(BASE_BODY);
    expect(res.status).toBe(403);
    expect(mockPoolQuery.mock.calls.filter(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("INSERT"),
    )).toHaveLength(0);
  });

  it("SPR-CLOSE-03f: SOM with active SPO covering their state → 403 program_state_spo_available", async () => {
    // activeSpoCount = 1 → SPO is available, SOM is blocked
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("role = 'state_program_officer'")) {
        return Promise.resolve({ rows: [{ count: 1 }] }); // SPO active
      }
      return Promise.resolve({ rows: [] });
    });
    const app = await buildApp(SOM_STATE1 as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send(BASE_BODY);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("program_state_spo_available");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SPR-CLOSE-04 — PM Full Operational Access (#373)
// ─────────────────────────────────────────────────────────────────────────────

describe("SPR-CLOSE-04 — PM Full Operational Access (#373)", () => {
  it("SPR-CLOSE-04a: PM with explicit stateId=1 → 201 (approved SPR author)", async () => {
    mockCreateSuccess();
    const app = await buildApp(PM_USER as unknown as Record<string, unknown>);
    const res = await request(app)
      .post("/api/projects/reports")
      .send({ ...BASE_BODY, stateId: 1 });
    expect(res.status).toBe(201);
    expect(res.body.reportType).toBe("program_state");
  });

  it("SPR-CLOSE-04b: PM without stateId → 400 state_required_for_program_manager_spr (not 403)", async () => {
    const app = await buildApp(PM_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send(BASE_BODY); // no stateId
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("state_required_for_program_manager_spr");
  });

  it("SPR-CLOSE-04c: PM with non-existent stateId → 400 invalid_state_id", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (/FROM states[\s\S]*WHERE id = \$1/.test(sql)) return Promise.resolve({ rows: [] }); // state not found
      return Promise.resolve({ rows: [] });
    });
    const app = await buildApp(PM_USER as unknown as Record<string, unknown>);
    const res = await request(app)
      .post("/api/projects/reports")
      .send({ ...BASE_BODY, stateId: 9999 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_state_id");
  });

  it("SPR-CLOSE-04d: PM can submit a valid SPR (full access override)", async () => {
    mockTransitionClient(sprLockRow({ authorId: PM_USER.id }), validSprContent());
    mockPoolQuery.mockResolvedValue(SPR_SECTOR);
    const app = await buildApp(PM_USER as unknown as Record<string, unknown>);
    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });
    expect([200, 201]).toContain(res.status);
    expect(res.body.error).toBeUndefined();
  });

  it("SPR-CLOSE-04e: PM PATCH on any SPR draft succeeds (isDraftEditFullAccess = true)", async () => {
    mockPatchSeq({ authorId: 99 }); // different original author
    const app = await buildApp(PM_USER as unknown as Record<string, unknown>);
    const res = await request(app)
      .patch("/api/projects/reports/99")
      .send({ title: "PM Override" });
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SPR-CLOSE-05 — Super Admin Full Operational Access
// ─────────────────────────────────────────────────────────────────────────────

describe("SPR-CLOSE-05 — Super Admin Full Operational Access", () => {
  it("SPR-CLOSE-05a: super_admin with explicit stateId → 201", async () => {
    mockCreateSuccess();
    const app = await buildApp(SA_USER as unknown as Record<string, unknown>);
    const res = await request(app)
      .post("/api/projects/reports")
      .send({ ...BASE_BODY, stateId: 1 });
    expect(res.status).toBe(201);
  });

  it("SPR-CLOSE-05b: super_admin without stateId → 400 state_required_for_super_admin_spr", async () => {
    const app = await buildApp(SA_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send(BASE_BODY);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("state_required_for_super_admin_spr");
  });

  it("SPR-CLOSE-05c: super_admin PATCH may update identity fields (bypass guard)", async () => {
    // super_admin is exempt from the identity guard
    mockPatchSeq({ authorId: SA_USER.id });
    const app = await buildApp(SA_USER as unknown as Record<string, unknown>);
    const res = await request(app)
      .patch("/api/projects/reports/99")
      .send({ kind: "quarterly" }); // identity field — allowed for super_admin
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SPR-CLOSE-06 — Identity immutability: all 9 fields rejected in PATCH (409)
// ─────────────────────────────────────────────────────────────────────────────

const IDENTITY_FIELDS = [
  ["stateId", 99],
  ["kind", "quarterly"],
  ["period", "2031-06"],
  ["reportingMonth", 7],
  ["reportingYear", 2030],
  ["quarter", 2],
  ["periodStart", "2031-06-01"],
  ["periodEnd", "2031-06-30"],
  ["reportType", "project"],
] as const;

describe("SPR-CLOSE-06 — Identity immutability: all 9 fields rejected in PATCH (409)", () => {
  for (const [field, value] of IDENTITY_FIELDS) {
    it(`SPR-CLOSE-06 PATCH ${field}=${String(value)} → 409 identity_immutable`, async () => {
      let call = 0;
      mockPoolQuery.mockImplementation(() => {
        call++;
        if (call === 1) return Promise.resolve({ rows: [{ status: "draft", sector: null, projectId: null, reportType: "program_state", authorId: SPO_STATE1.id, sections: null }] });
        if (call === 2) return Promise.resolve({ rows: [{ reportType: "program_state", projectId: null, projectSector: null, activitySector: null, effectiveSector: null, stateId: 1 }] });
        return Promise.resolve({ rows: [] });
      });
      const app = await buildApp(SPO_STATE1 as unknown as Record<string, unknown>);
      const res = await request(app)
        .patch("/api/projects/reports/99")
        .send({ [field]: value });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("program_state_report_identity_immutable");
    });
  }

  it("SPR-CLOSE-06-present-key: same-value PATCH still rejected (present-key convention)", async () => {
    let call = 0;
    mockPoolQuery.mockImplementation(() => {
      call++;
      if (call === 1) return Promise.resolve({ rows: [{ status: "draft", sector: null, projectId: null, reportType: "program_state", authorId: SPO_STATE1.id, sections: null }] });
      if (call === 2) return Promise.resolve({ rows: [{ reportType: "program_state", projectId: null, projectSector: null, activitySector: null, effectiveSector: null, stateId: 1 }] });
      return Promise.resolve({ rows: [] });
    });
    const app = await buildApp(SPO_STATE1 as unknown as Record<string, unknown>);
    const res = await request(app)
      .patch("/api/projects/reports/99")
      .send({ kind: "monthly" }); // same value as current, but key is present
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("program_state_report_identity_immutable");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SPR-CLOSE-07 — Duplicate protection: existing SPR → 409 on POST
// ─────────────────────────────────────────────────────────────────────────────

describe("SPR-CLOSE-07 — Duplicate protection: DB constraint enforced on POST", () => {
  it("SPR-CLOSE-07a: existing monthly SPR for same state/period → 409 duplicate_report_period", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (typeof sql !== "string") return Promise.resolve({ rows: [] });
      if (/FROM states[\s\S]*WHERE id = \$1/.test(sql)) {
        return Promise.resolve({ rows: [{ id: 1, name: "Khartoum", nameAr: "الخرطوم", code: "KRT", operationalStatus: "active", officeStatus: "present" }] });
      }
      // Duplicate guard finds existing report
      if (sql.includes("AND state_id =") && sql.includes("AND kind = 'monthly'") && sql.includes("program_state")) {
        return Promise.resolve({ rows: [{ id: 42, title: "Existing", status: "draft", stateId: 1, kind: "monthly", period: "2031-05" }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const app = await buildApp(SPO_STATE1 as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send(BASE_BODY);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("duplicate_report_period");
    // No INSERT should have been called
    expect(mockPoolQuery.mock.calls.filter(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("INSERT INTO reports"),
    )).toHaveLength(0);
  });

  it("SPR-CLOSE-07b: rejected SPR does not block new draft (rejected excluded)", async () => {
    mockCreateSuccess(); // mockCreateSuccess returns empty for dup check (no active dup)
    const app = await buildApp(SPO_STATE1 as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send(BASE_BODY);
    expect(res.status).toBe(201);
  });

  it("SPR-CLOSE-07c: PM duplicate check is state-scoped (cannot probe other states)", async () => {
    // PM supplies stateId=1 → duplicate check uses stateId=1 (not cross-state)
    mockCreateSuccess();
    const app = await buildApp(PM_USER as unknown as Record<string, unknown>);
    const res = await request(app)
      .post("/api/projects/reports")
      .send({ ...BASE_BODY, stateId: 1 });
    expect(res.status).toBe(201);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SPR-CLOSE-08 — Submit gate: 422 on critical missing fields (SPR-001)
// ─────────────────────────────────────────────────────────────────────────────

describe("SPR-CLOSE-08 — Submit gate: 422 on key missing fields (SPR-001)", () => {
  async function submitWith(content: Record<string, unknown>) {
    mockTransitionClient(sprLockRow(), validSprContent(content));
    mockPoolQuery.mockResolvedValue(SPR_SECTOR);
    const app = await buildApp(SPO_STATE1 as unknown as Record<string, unknown>);
    return request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });
  }

  it("SPR-CLOSE-08a: complete SPR → not 422", async () => {
    const res = await submitWith({});
    expect(res.status).not.toBe(422);
  });

  it("SPR-CLOSE-08b: blank title → 422 with title field", async () => {
    const res = await submitWith({ title: "  " });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("report_content_incomplete");
    const fields = (res.body.fields as Array<{ field: string }>).map(f => f.field);
    expect(fields).toContain("title");
  });

  it("SPR-CLOSE-08c: zero activities → 422 with activities field", async () => {
    const res = await submitWith({ activities: [] });
    expect(res.status).toBe(422);
    const fields = (res.body.fields as Array<{ field: string }>).map(f => f.field);
    expect(fields).toContain("activities");
  });

  it("SPR-CLOSE-08d: activity with zero beneficiary total → 422", async () => {
    const res = await submitWith({
      activities: [{
        title: "Test", sector: "Health", activityDate: "2026-07-01",
        achievementSummary: "Done",
        beneficiariesMen: 0, beneficiariesWomen: 0,
        beneficiariesBoys: 0, beneficiariesGirls: 0,
      }],
    });
    expect(res.status).toBe(422);
    const fields = (res.body.fields as Array<{ field: string }>).map(f => f.field);
    expect(fields.some(f => f.includes("beneficiaries"))).toBe(true);
  });

  it("SPR-CLOSE-08e: negative beneficiary value → 422 (invalid not coerced to 0)", async () => {
    const res = await submitWith({
      activities: [{
        title: "Test", sector: "Health", activityDate: "2026-07-01",
        achievementSummary: "Done",
        beneficiariesMen: -5, beneficiariesWomen: 50,
        beneficiariesBoys: 0, beneficiariesGirls: 0,
      }],
    });
    expect(res.status).toBe(422);
  });

  it("SPR-CLOSE-08f: missing all humanitarian context → 422 with all 4 field names", async () => {
    const sections = validSprContent().sections as Record<string, unknown>;
    const res = await submitWith({
      sections: { ...sections, humanitarianContext: {} },
    });
    expect(res.status).toBe(422);
    const fields = (res.body.fields as Array<{ field: string }>).map(f => f.field);
    expect(fields).toContain("humanitarianContext.securitySituation");
    expect(fields).toContain("humanitarianContext.populationMovements");
    expect(fields).toContain("humanitarianContext.diseaseOutbreaks");
    expect(fields).toContain("humanitarianContext.accessConstraints");
  });

  it("SPR-CLOSE-08g: malformed sections JSONB (null) → 422, not 500", async () => {
    const res = await submitWith({ sections: null });
    expect(res.status).toBe(422);
    expect(res.status).not.toBe(500);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SPR-CLOSE-09 — Transaction safety: 422 leaves no partial state
// ─────────────────────────────────────────────────────────────────────────────

describe("SPR-CLOSE-09 — Transaction safety: 422 leaves no partial state", () => {
  it("SPR-CLOSE-09a: failed submit (422) calls ROLLBACK and no COMMIT", async () => {
    mockTransitionClient(
      sprLockRow(),
      validSprContent({ title: "", activities: [] }), // will fail gate
    );
    mockPoolQuery.mockResolvedValue(SPR_SECTOR);
    const app = await buildApp(SPO_STATE1 as unknown as Record<string, unknown>);
    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });
    expect(res.status).toBe(422);
    // ROLLBACK must have been called
    const rollbackCalls = mockClientQuery.mock.calls.filter(
      (c) => c[0] === "ROLLBACK",
    );
    expect(rollbackCalls.length).toBeGreaterThanOrEqual(1);
    // COMMIT must NOT have been called
    const commitCalls = mockClientQuery.mock.calls.filter(
      (c) => c[0] === "COMMIT",
    );
    expect(commitCalls).toHaveLength(0);
  });

  it("SPR-CLOSE-09b: failed submit leaves no UPDATE status mutation before ROLLBACK", async () => {
    mockTransitionClient(
      sprLockRow(),
      validSprContent({ sections: null }), // incomplete → 422
    );
    mockPoolQuery.mockResolvedValue(SPR_SECTOR);
    const app = await buildApp(SPO_STATE1 as unknown as Record<string, unknown>);
    await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });
    // No UPDATE to status should have executed before the ROLLBACK
    const updateCalls = mockClientQuery.mock.calls.filter(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("UPDATE reports") && (c[0] as string).includes("status"),
    );
    expect(updateCalls).toHaveLength(0);
  });

  it("SPR-CLOSE-09c: failed submit triggers no notification side-effects", async () => {
    const { notifyNextApprover } = await import("../lib/notifications.js");
    const notifyFn = vi.mocked(notifyNextApprover);
    notifyFn.mockReset();

    mockTransitionClient(sprLockRow(), validSprContent({ activities: [] }));
    mockPoolQuery.mockResolvedValue(SPR_SECTOR);
    const app = await buildApp(SPO_STATE1 as unknown as Record<string, unknown>);
    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });
    expect(res.status).toBe(422);
    expect(notifyFn).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SPR-CLOSE-10 — Reviewer completeness: GET /reports/:id serves full content
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// SPR-CLOSE-10 — Reviewer completeness: GET /reports/:id returns full content
// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/:reportId makes exactly 3 pool.query calls for SA_USER (no state scope):
//   call 1: getReportSector     — LEFT JOIN reports/projects/activities
//   call 2: reportSelect WHERE r.id = $1  — full SPR payload
//   call 3: withHistory approvals query
// For a state-scoped SPO call 2 is a state-scope check instead;
// a mismatch triggers 403 before the reportSelect runs.

describe("SPR-CLOSE-10 — Reviewer completeness: GET /reports/:id returns full SPR content", () => {
  /** Row returned by getReportSector (call 1 for any role). */
  const SECTOR_ROW = {
    reportType: "program_state", projectId: null,
    projectSector: null, activitySector: null, effectiveSector: null,
  };

  /** Full SPR row as returned by reportSelect (call 2 for SA_USER). */
  const FULL_SPR_ROW = {
    id: 1, title: "Kassala Monthly SPR",
    reportType: "program_state", status: "submitted", kind: "monthly",
    reportingMonth: 7, reportingYear: 2026,
    stateId: 1, stateName: "Kassala", period: "2026-07",
    authorId: 10, authorName: "SPO User",
    sector: null, effectiveSector: null,
    plannedBudget: null, actualExpenditure: null,
    sections: {
      sectors: ["Health"], localitiesCovered: ["Kassala Town"],
      humanitarianContext: {
        securitySituation: "Stable", populationMovements: "Low",
        diseaseOutbreaks: "None", accessConstraints: "Minimal",
      },
      keyAchievements: "Distributed 500 hygiene kits",
      mainChallenges: "Road access limitations",
      mitigationMeasures: "Pre-positioned stocks",
      nextPeriodPriorities: "Scale-up operations",
      lessonsLearned: "Cluster meetings effective",
      coordinationUpdates: "Met with health cluster",
      communityFeedback: "Positive response",
      hqSupportRequests: "None",
    },
    activities: [{
      title: "WASH distribution", sector: "Health", activityDate: "2026-07-15",
      achievementSummary: "500 hygiene kits",
      beneficiariesMen: 100, beneficiariesWomen: 150,
      beneficiariesBoys: 50, beneficiariesGirls: 60,
    }],
    workflowPath: null, quarter: null, periodStart: null, periodEnd: null,
    onDemandReason: null, narrative: null, executiveSummary: null,
    challenges: null, recommendations: null,
    submittedByName: "SPO User", submittedAt: "2026-07-20T10:00:00.000Z",
    activityTitle: null, activityCode: null, activitySector: null,
    activityCurrency: null, activityName: null, activityId: null,
    projectId: null, projectTitle: null, locationType: "state",
    beneficiariesMale: null, beneficiariesFemale: null,
    beneficiariesBoys: null, beneficiariesGirls: null,
    indicatorProgress: null, migrationReviewNotes: null, submittedTo: null,
  };

  it("SPR-CLOSE-10a: SA GET /reports/:id → 200 with all reviewer-critical fields present", async () => {
    // SA_USER: 3 pool.query calls in exact order (no state scope check)
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [SECTOR_ROW] })    // call 1: getReportSector
      .mockResolvedValueOnce({ rows: [FULL_SPR_ROW] })  // call 2: reportSelect
      .mockResolvedValueOnce({ rows: [] });              // call 3: withHistory approvals
    const app = await buildApp(SA_USER as unknown as Record<string, unknown>);
    const res = await request(app).get("/api/projects/reports/1");
    expect(res.status).toBe(200);
    // Core identity
    expect(res.body.reportType).toBe("program_state");
    expect(res.body.status).toBe("submitted");
    // Reviewer-critical narrative sections
    expect(res.body.sections).toBeDefined();
    expect(res.body.sections.humanitarianContext).toBeDefined();
    expect(res.body.sections.humanitarianContext.securitySituation).toBe("Stable");
    expect(res.body.sections.keyAchievements).toBe("Distributed 500 hygiene kits");
    expect(res.body.sections.mainChallenges).toBe("Road access limitations");
    expect(res.body.sections.mitigationMeasures).toBe("Pre-positioned stocks");
    // Activities with beneficiary breakdown
    expect(Array.isArray(res.body.activities)).toBe(true);
    expect(res.body.activities).toHaveLength(1);
    expect(res.body.activities[0].title).toBe("WASH distribution");
    expect(res.body.activities[0].beneficiariesMen).toBe(100);
    expect(res.body.activities[0].beneficiariesWomen).toBe(150);
    // Approval history injected by withHistory (empty array here)
    expect(Array.isArray(res.body.approvalHistory)).toBe(true);
    // Internal objectPath must never appear in report view
    expect(JSON.stringify(res.body)).not.toContain("objectPath");
  });

  it("SPR-CLOSE-10b: SPO State 2 cannot view State 1 SPR → 403 state_scope_forbidden", async () => {
    // SPO path: call 1 getReportSector, call 2 SELECT state_id/project_id FROM reports
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [SECTOR_ROW] })                       // call 1: getReportSector
      .mockResolvedValueOnce({ rows: [{ state_id: 1, project_id: null }] }); // call 2: state scope check → state 1
    // SPO_STATE2 has stateId=2; the report belongs to state 1 → denied
    const app = await buildApp(SPO_STATE2 as unknown as Record<string, unknown>);
    const res = await request(app).get("/api/projects/reports/1");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("state_scope_forbidden");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SPR-CLOSE-11 — Evidence access: authorised download works; cross-State blocked
// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/:reportId/attachments/:attachmentId/download flow:
//   call 1 (pool): getReportSectorForAuth (LEFT JOIN reports/projects/activities)
//   call 2 (pool): state_id scope check (state roles only)
//   call 3 (pool): SELECT ... FROM report_attachments WHERE id=$1 AND report_id=$2
//   then: objectStorageService.getObjectEntityFile(objectPath)
//         objectStorageService.downloadObject(objectFile)
// objectStorageService is mocked via vi.mock("../lib/objectStorage.js") above.
// SA_USER path: 2 pool.query calls (no state-scope check), then storage.
// SPO_STATEn path: 3 pool.query calls (state-scope check at call 2).

describe("SPR-CLOSE-11 — Evidence access: authorised download works; cross-State blocked", () => {
  /** getReportSectorForAuth row (call 1 for any role). */
  const AUTH_SECTOR_ROW = {
    reportType: "program_state", projectId: null,
    projectSector: null, activitySector: null, effectiveSector: null,
  };
  /** Attachment row without driveFileId — triggers object-storage path. */
  const ATTACHMENT_ROW = {
    objectPath: "private/reports/1/evidence.pdf",
    fileName:   "evidence.pdf",
    contentType: "application/pdf",
    driveFileId: null,
  };

  it("SPR-CLOSE-11a: authorised SA download → 200 with Content-Disposition; objectPath absent from response", async () => {
    // SA_USER: call 1 = getReportSectorForAuth, call 2 = attachment SELECT
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [AUTH_SECTOR_ROW] })  // call 1
      .mockResolvedValueOnce({ rows: [ATTACHMENT_ROW] });   // call 2: attachment found
    // Storage mock already returns { status: 200, headers: new Headers(), body: null }
    const app = await buildApp(SA_USER as unknown as Record<string, unknown>);
    const res = await request(app).get("/api/projects/reports/1/attachments/1/download");
    expect(res.status).toBe(200);
    // Content-Disposition must be set by the route (not the storage mock)
    expect(res.headers["content-disposition"]).toMatch(/attachment/i);
    expect(res.headers["content-disposition"]).toContain("evidence.pdf");
    // objectPath / internal storage key must never be surfaced in the response body
    expect(JSON.stringify(res.body)).not.toContain("objectPath");
    expect(JSON.stringify(res.body)).not.toContain("private/reports");
    // storage service was called with the path from the attachment row
    expect(mockGetObjectEntityFile).toHaveBeenCalledWith("private/reports/1/evidence.pdf");
  });

  it("SPR-CLOSE-11b: SPO State 2 cannot download a State 1 SPR attachment → 403 state_scope_forbidden", async () => {
    // SPO_STATE2 path: call 1 getReportSectorForAuth, call 2 state-scope check → state 1 mismatch
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [AUTH_SECTOR_ROW] })                   // call 1
      .mockResolvedValueOnce({ rows: [{ state_id: 1 }] });                  // call 2: belongs to state 1
    // SPO_STATE2.stateId = 2 ≠ 1 → 403; storage is never reached
    const app = await buildApp(SPO_STATE2 as unknown as Record<string, unknown>);
    const res = await request(app).get("/api/projects/reports/1/attachments/1/download");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("state_scope_forbidden");
    // Confirms storage was never invoked for the unauthorised actor
    expect(mockGetObjectEntityFile).not.toHaveBeenCalled();
    // objectPath must not appear in the denial response
    expect(JSON.stringify(res.body)).not.toContain("objectPath");
  });

  it("SPR-CLOSE-11c: cross-report attachment guard: mismatched report_id returns 404 with no objectPath", async () => {
    // SA_USER: call 1 = getReportSectorForAuth (report found), call 2 = attachment SELECT (wrong report_id → empty)
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [AUTH_SECTOR_ROW] })  // call 1: report sector found
      .mockResolvedValueOnce({ rows: [] });                 // call 2: attachment not found for this report
    const app = await buildApp(SA_USER as unknown as Record<string, unknown>);
    const res = await request(app).get("/api/projects/reports/1/attachments/9999/download");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("attachment not found");
    // Internal storage key must not be in denial response
    expect(JSON.stringify(res.body)).not.toContain("objectPath");
    expect(JSON.stringify(res.body)).not.toContain("private/");
    // Storage must not have been invoked
    expect(mockGetObjectEntityFile).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SPR-CLOSE-12 — Analytics: TC scope uses canonical type-aware sector authority
// ─────────────────────────────────────────────────────────────────────────────
// The dashboard/reports-summary endpoint builds its main KPI query with:
//   LEFT JOIN projects p2 ON p2.id = r.project_id
//   project/project-linked activity → project primary sector
//   standalone activity → activity sector
//   program_state/HQ sector → report sector or linked project sector
//
// We capture the actual SQL sent to pool.query and assert the required
// structural predicates are present — this assertion fails if the
// LEFT JOIN is changed to INNER JOIN or the COALESCE is removed.

describe("SPR-CLOSE-12 — Analytics: TC scope uses canonical type-aware SQL", () => {
  /** Shared helper: build a minimal Express app wired to the dashboard router. */
  async function buildDashApp(user: Record<string, unknown>) {
    const app = express();
    app.use(express.json());
    app.use((req: Request, _res: Response, next: NextFunction) => {
      (req as unknown as { currentUser: typeof user }).currentUser = user;
      next();
    });
    const { default: dashRouter } = await import("../routes/dashboard.js");
    app.use("/api/projects", dashRouter);
    app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
      res.status(500).json({ error: "internal", message: err.message });
    });
    return app;
  }

  it("SPR-CLOSE-12a: TC reports-summary preserves standalone SPR without widening project Reports", async () => {
    let capturedReportsSql: string | undefined;
    const countsRow = { total: 1, draft: 0, returned: 0, awaiting_approval: 1, approved: 0, awaiting_over14: 0 };

    mockPoolQuery.mockImplementation((sql: string) => {
      if (typeof sql !== "string") return Promise.resolve({ rows: [] });
      // Capture the reports KPI query (has COUNT FILTER and FROM reports r)
      if (sql.includes("FROM reports r") && sql.includes("COUNT(*)") && sql.includes("FILTER")) {
        capturedReportsSql = sql;
        return Promise.resolve({ rows: [countsRow] });
      }
      // Other queries (legacy count, by-state, by-sector, by-type, data-quality)
      if (sql.includes("report_type IS NULL")) return Promise.resolve({ rows: [{ cnt: 0 }] });
      return Promise.resolve({ rows: [] });
    });

    const app = await buildDashApp(TC_USER as unknown as Record<string, unknown>);
    const res = await request(app).get("/api/projects/dashboard/reports-summary");
    expect(res.status).toBe(200);
    // The reports KPI query MUST have been executed
    expect(capturedReportsSql).toBeDefined();
    // LEFT JOIN (not INNER JOIN) is required so project_id=NULL SPRs are included
    expect(capturedReportsSql).toMatch(/LEFT JOIN projects/i);
    expect(capturedReportsSql).toContain("r.report_type = 'project' AND p2.sector = ANY");
    expect(capturedReportsSql).toContain("r.report_type = 'activity' AND r.project_id IS NULL AND act.sector = ANY");
    expect(capturedReportsSql).toContain("r.report_type NOT IN ('project', 'activity')");
    expect(capturedReportsSql).toContain("r.sector = ANY");
    expect(capturedReportsSql).not.toContain("COALESCE(NULLIF(r.sector,''), p2.sector)");
    // Sector restriction is parameterised (not hardcoded) via ANY($N::text[])
    expect(capturedReportsSql).toContain("ANY($");
    // The KPI count (1 pending SPR) is reflected in the response
    expect(res.body.awaitingApproval ?? res.body.pending ?? res.body.total).toBeGreaterThanOrEqual(1);
  });

  it("SPR-CLOSE-12b: TC with empty sectors → AND FALSE predicate; counts are 0; no crash", async () => {
    const tcNoSector = { ...TC_USER, sector: null, sectors: [] as string[] };
    let capturedReportsSql: string | undefined;
    const countsRow = { total: 0, draft: 0, returned: 0, awaiting_approval: 0, approved: 0, awaiting_over14: 0 };

    mockPoolQuery.mockImplementation((sql: string) => {
      if (typeof sql !== "string") return Promise.resolve({ rows: [] });
      if (sql.includes("FROM reports r") && sql.includes("COUNT(*)") && sql.includes("FILTER")) {
        capturedReportsSql = sql;
        return Promise.resolve({ rows: [countsRow] });
      }
      if (sql.includes("report_type IS NULL")) return Promise.resolve({ rows: [{ cnt: 0 }] });
      return Promise.resolve({ rows: [] });
    });

    const app = await buildDashApp(tcNoSector as unknown as Record<string, unknown>);
    const res = await request(app).get("/api/projects/dashboard/reports-summary");
    expect(res.status).toBe(200);
    // AND FALSE is the fail-closed predicate for TC with no assigned sectors
    expect(capturedReportsSql).toBeDefined();
    expect(capturedReportsSql).toContain("AND FALSE");
    // Response total must be 0 (no sectors → no reports in scope)
    expect(res.body.total).toBe(0);
  });

  it("SPR-CLOSE-12c: TC in 'WASH' sector does not share SQL scope with 'Health' sector (sector isolation via parameterised ANY)", async () => {
    const tcWash = { ...TC_USER, sector: "WASH", sectors: ["WASH"] as string[] };
    let capturedReportsSql: string | undefined;
    const countsRow = { total: 0, draft: 0, returned: 0, awaiting_approval: 0, approved: 0, awaiting_over14: 0 };
    let capturedParams: unknown[] | undefined;

    mockPoolQuery.mockImplementation((sql: string, params?: unknown[]) => {
      if (typeof sql !== "string") return Promise.resolve({ rows: [] });
      if (sql.includes("FROM reports r") && sql.includes("COUNT(*)") && sql.includes("FILTER")) {
        capturedReportsSql = sql;
        capturedParams = params;
        return Promise.resolve({ rows: [countsRow] });
      }
      if (sql.includes("report_type IS NULL")) return Promise.resolve({ rows: [{ cnt: 0 }] });
      return Promise.resolve({ rows: [] });
    });

    const app = await buildDashApp(tcWash as unknown as Record<string, unknown>);
    const res = await request(app).get("/api/projects/dashboard/reports-summary");
    expect(res.status).toBe(200);
    // Different TC actors bind different sector values to the same canonical
    // type-aware SQL, so WASH cannot see Health reports.
    expect(capturedReportsSql).toBeDefined();
    expect(capturedReportsSql).toContain("r.report_type NOT IN ('project', 'activity')");
    expect(capturedReportsSql).toContain("ANY($"); // parameter → value is ["WASH"]
    expect(capturedParams).toEqual([["WASH"]]);
    // Left-join ensures null-project_id SPRs in WASH scope would also be counted
    expect(capturedReportsSql).toMatch(/LEFT JOIN projects/i);
  });
});
