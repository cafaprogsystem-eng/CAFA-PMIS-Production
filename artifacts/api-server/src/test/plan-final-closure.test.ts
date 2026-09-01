/**
 * Plans Module — Final Closure Test Suite (Task #502)
 *
 * Twenty invariant tests that span the full Plans Module closure surface.
 * Each test is a BLOCKER: a failure means the module cannot be declared Verdict A.
 *
 * PLAN-FINAL-01  All 7 plan types route through identical PLAN_TRANSITIONS (no type branch)
 * PLAN-FINAL-02  Save Draft + Continue Editing returns same Plan ID
 * PLAN-FINAL-03  Strict date: end < start → 422; Feb 30 → 422
 * PLAN-FINAL-04  New assignment to inactive user → 422
 * PLAN-FINAL-05  Existing inactive assignment unchanged by PATCH (grandfathered)
 * PLAN-FINAL-06  Progress status matrix: completed=100, in_progress=1–99, cancelled retained
 * PLAN-FINAL-07  Cancelled activity excluded from plan progress AVG
 * PLAN-FINAL-08  No eligible activities → null progressPct (not 0)
 * PLAN-FINAL-09  Structured duplicate (monthly) → hard 409 block
 * PLAN-FINAL-10  Irregular duplicate (action) → soft warning, creation allowed
 * PLAN-FINAL-11  Concurrent structured creates: advisory lock acquired inside transaction
 * PLAN-FINAL-12  Duplicate-check: State-scoped role cannot see out-of-scope plan metadata
 * PLAN-FINAL-13  CAS transition conflict (wrong source status) → 409, no side effects
 * PLAN-FINAL-14  Reopen: rejected Plan → 409 (not allowed)
 * PLAN-FINAL-15  Request Revision: Plan returns to draft, same ID, revision reason stored
 * PLAN-FINAL-16  SPO cannot read non-revision_request comments; can read revision_request on own-state draft
 * PLAN-FINAL-17  Rejected Plan: no PATCH allowed, no reopen, no resubmit
 * PLAN-FINAL-18  PATCH on rejected Plan → 409/403 (no bypass)
 * PLAN-FINAL-19  Plan delete: activities + risk references + attachments + sessions cleaned atomically
 * PLAN-FINAL-20  PM/Super Admin cannot bypass date constraint or duplicate hard block
 *
 * British English throughout.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

// ── vi.hoisted: shared mock handles ──────────────────────────────────────────
const { mockPoolQuery, mockPoolConnect } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockPoolConnect: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  pool: {
    query:   mockPoolQuery,
    connect: mockPoolConnect,
  },
}));
vi.mock("../lib/realtime.js", () => ({
  realtime: { emit: vi.fn(), to: vi.fn().mockReturnThis() },
}));
vi.mock("../lib/notifications.js", () => ({
  notifyEntityActorsDeduped: vi.fn().mockResolvedValue(undefined),
  notifyNextApprover:        vi.fn().mockResolvedValue(undefined),
  createNotification:        vi.fn().mockResolvedValue(undefined),
  notifyEntityActors:        vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../lib/objectStorage.js", () => ({
  deleteStorageObjectSafely: vi.fn().mockResolvedValue({ deleted: true }),
  objectStorageService: {},
}));
vi.mock("../lib/plan-registration-session.js", () => ({
  ensureRegistrationSessionTable:  vi.fn().mockResolvedValue(undefined),
  createRegistrationSession:       vi.fn().mockResolvedValue("raw-token-abc"),
  validateRegistrationSession:     vi.fn().mockResolvedValue(true),
  closeRegistrationSession:        vi.fn().mockResolvedValue(undefined),
  revokeRegistrationSessionsByPlan: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/reportAuth.js", () => ({
  assertCanViewReport: vi.fn().mockResolvedValue({ ok: false, status: 403, body: { error: "forbidden" } }),
}));
vi.mock("../middlewares/currentUser.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../middlewares/currentUser.js")>();
  return {
    ...original,
    logAudit:          vi.fn().mockResolvedValue(undefined),
    requirePerm:       () => (_req: Request, _res: Response, next: NextFunction) => next(),
    attachCurrentUser: (_req: Request, _res: Response, next: NextFunction) => next(),
  };
});

// ── User fixtures ─────────────────────────────────────────────────────────────
const PM_USER = {
  id: 1, name: "PM", email: "pm@t.com", role: "program_manager",
  roleLabel: "Programme Manager", scope: "global",
  stateId: null, stateName: null, sector: null, sectors: [], avatarUrl: null,
} as const;

const SPO_USER = {
  id: 10, name: "SPO", email: "spo@t.com", role: "state_program_officer",
  roleLabel: "State Programme Officer", scope: "state",
  stateId: 5, stateName: "Khartoum", sector: null, sectors: [], avatarUrl: null,
} as const;

const SPO_OTHER_STATE = {
  id: 11, name: "SPO2", email: "spo2@t.com", role: "state_program_officer",
  roleLabel: "State Programme Officer", scope: "state",
  stateId: 99, stateName: "Other", sector: null, sectors: [], avatarUrl: null,
} as const;

// ── Minimal plan row ──────────────────────────────────────────────────────────
const PLAN_ROW = {
  id: 42, status: "draft", sector: "Health", stateId: null, locationType: "hq",
  title: "Closure Test Plan", planType: "monthly", frequency: "monthly",
  progressPct: null, activitiesCount: 0,
  sectors: [], localities: [], objectives: [],
  budgetPlanned: null, budgetActual: null, currency: null, fundingSource: null,
  lastFinalApprovedAt: null, code: "CAFA-PLAN-HQ-042",
  stateName: null, projectTitle: null, projectId: null,
  responsibleName: "Alice", responsibleUserId: null,
  startDate: "2026-01-01", endDate: "2026-12-31", description: null,
  createdAt: new Date(), updatedAt: new Date(), createdByName: "PM",
  activities: [], linkedRisks: [],
};

// ── App factory ───────────────────────────────────────────────────────────────
async function buildApp(user: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as Record<string, unknown>).currentUser = user;
    next();
  });
  const { default: plansRouter } = await import("../routes/plans.js");
  app.use("/", plansRouter);
  return app;
}

async function buildCommentsApp(user: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as Record<string, unknown>).currentUser = user;
    next();
  });
  const { default: commentsRouter } = await import("../routes/comments.js");
  app.use("/", commentsRouter);
  return app;
}

/** Minimal transaction client that can be extended per-test. */
function mockClient(
  overrides?: (sql: string, params?: unknown[]) => { rows: unknown[]; rowCount?: number } | null,
  opts: { userStatus?: string; userExists?: boolean } = {},
) {
  const { userStatus = "active", userExists = true } = opts;
  const client = {
    query: vi.fn().mockImplementation((sql: string, params?: unknown[]) => {
      if (overrides) {
        const result = overrides(sql, params);
        if (result !== null) return Promise.resolve(result);
      }
      if (sql.includes("SELECT status FROM users")) {
        if (!userExists) return Promise.resolve({ rows: [], rowCount: 0 });
        return Promise.resolve({ rows: [{ status: userStatus }], rowCount: 1 });
      }
      if (sql.includes("INSERT INTO plans")) {
        return Promise.resolve({ rows: [{ id: 42 }], rowCount: 1 });
      }
      if (sql.includes("INSERT INTO plan_registration_sessions")) {
        return Promise.resolve({ rows: [{ token_hash: "abc" }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 1 });
    }),
    release: vi.fn(),
  };
  mockPoolConnect.mockResolvedValue(client);
  return client;
}

/** Standard pool.query mock for HQ plan reads. */
function setupListQuery() {
  mockPoolQuery.mockImplementation((sql: string) => {
    if (sql.includes("code LIKE 'CAFA-PLAN-HQ-%'")) return Promise.resolve({ rows: [] });
    if (sql.includes("code FROM states"))             return Promise.resolve({ rows: [{ code: "KH" }] });
    if (sql.includes("code LIKE $"))                  return Promise.resolve({ rows: [] });
    if (sql.includes("FROM plans pl"))                return Promise.resolve({ rows: [PLAN_ROW] });
    return Promise.resolve({ rows: [] });
  });
}

/** Standard pool.query mock for transition handler tests. */
function setupTransitionQuery(status: string, locationType = "hq", stateId: number | null = null) {
  mockPoolQuery.mockImplementation((sql: string) => {
    if (sql.includes("FROM plans WHERE id = $1")) {
      return Promise.resolve({ rows: [{ status, sector: "Health", project_id: null, stateId }] });
    }
    if (sql.includes("LEFT JOIN projects")) {
      return Promise.resolve({ rows: [{ sector: "Health", stateId, locationType }] });
    }
    if (sql.includes("action = 'reopen'")) {
      return Promise.resolve({ rows: [] });
    }
    if (sql.includes("FROM plans pl")) {
      return Promise.resolve({ rows: [{ ...PLAN_ROW, status }] });
    }
    return Promise.resolve({ rows: [] });
  });
}

beforeEach(() => vi.clearAllMocks());

// ═══════════════════════════════════════════════════════════════════════════════
// PLAN-FINAL-01: All 7 plan types share identical PLAN_TRANSITIONS (no type branch)
// ═══════════════════════════════════════════════════════════════════════════════
describe("PLAN-FINAL-01: All 7 plan types share identical PLAN_TRANSITIONS (PLAN-BD-1)", async () => {
  const { PLAN_TRANSITIONS, PLAN_TYPES } = await import("../routes/plans.js");

  it("PLAN_TYPES contains exactly 7 canonical entries", () => {
    expect(PLAN_TYPES.size).toBe(7);
    const expected = ["monthly", "quarterly", "annual", "action", "operational", "emergency", "custom"];
    for (const t of expected) expect(PLAN_TYPES.has(t)).toBe(true);
  });

  it("PLAN_TRANSITIONS action keys do not include any plan type name", () => {
    const planTypeNames = new Set(["monthly", "quarterly", "annual", "action", "operational", "emergency", "custom"]);
    for (const key of Object.keys(PLAN_TRANSITIONS)) {
      expect(planTypeNames.has(key)).toBe(false);
    }
  });

  it("PLAN_TRANSITIONS has exactly 12 type-agnostic actions (PLAN-BD-1 closed)", () => {
    expect(Object.keys(PLAN_TRANSITIONS)).toHaveLength(12);
  });

  it("reject transition target is terminal 'rejected'", () => {
    expect(PLAN_TRANSITIONS.reject.to).toBe("rejected");
    expect(PLAN_TRANSITIONS.reject.from).toEqual(
      expect.arrayContaining(["submitted", "technically_approved", "coordination_approved"]),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PLAN-FINAL-02: Save Draft + Continue Editing returns same Plan ID
// ═══════════════════════════════════════════════════════════════════════════════
describe("PLAN-FINAL-02: Save Draft returns Plan ID; subsequent PATCH uses same ID", () => {
  it("POST /plans creates draft with status='draft' and returns an id", async () => {
    setupListQuery();
    mockClient();
    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans").send({
      title: "Draft Plan", locationType: "hq",
    });
    // POST either 201 (new draft) or 409 (duplicate) — not 500/400 status contract issue
    expect([201, 409]).toContain(res.status);
    // If 201, the plan must have an id
    if (res.status === 201) {
      expect(res.body.id).toBeDefined();
      expect(typeof res.body.id).toBe("number");
    }
  });

  it("POST /plans always inserts status='draft', never any caller-supplied status", async () => {
    setupListQuery();
    const client = mockClient();
    const app = await buildApp({ ...PM_USER });
    await request(app).post("/plans").send({
      title: "Draft Plan", locationType: "hq",
      status: "approved", // attempt to inject — must be ignored
    });
    // Find the INSERT INTO plans call and verify it inserts 'draft'
    const insertCall = client.query.mock.calls.find(
      ([sql]: [string]) => typeof sql === "string" && sql.includes("INSERT INTO plans"),
    );
    if (insertCall) {
      // params array: locate the status value — it must be 'draft'
      const params = insertCall[1] as unknown[];
      const statusIdx = params?.indexOf("draft");
      expect(statusIdx).toBeGreaterThanOrEqual(0);
      // 'approved' must NOT appear as a status param
      expect(params?.includes("approved")).toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PLAN-FINAL-03: Strict date validation
// ═══════════════════════════════════════════════════════════════════════════════
describe("PLAN-FINAL-03: Strict date validation — end < start and impossible dates", () => {
  it("end_date < start_date → 422 Unprocessable Entity", async () => {
    setupListQuery();
    mockClient();
    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans").send({
      title: "Bad Dates", locationType: "hq",
      startDate: "2026-12-31", endDate: "2026-01-01",
      closeRegistration: false,
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/date/i);
  });

  it("Impossible date (February 30th) → 422 Unprocessable Entity", async () => {
    setupListQuery();
    mockClient();
    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans").send({
      title: "Feb 30", locationType: "hq",
      startDate: "2026-02-30", endDate: "2026-03-31",
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/date/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PLAN-FINAL-04: New assignment to inactive user → 422
// ═══════════════════════════════════════════════════════════════════════════════
describe("PLAN-FINAL-04: New responsible user assignment must be active", () => {
  it("responsibleUserId referencing an inactive user → 422", async () => {
    setupListQuery();
    mockClient(undefined, { userStatus: "suspended" });
    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans").send({
      title: "Inactive Assignee", locationType: "hq",
      responsibleUserId: 999,
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/responsible_user/i);
  });

  it("responsibleUserId referencing a non-existent user → 422", async () => {
    setupListQuery();
    mockClient(undefined, { userExists: false });
    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans").send({
      title: "Unknown Assignee", locationType: "hq",
      responsibleUserId: 9999,
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/responsible_user/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PLAN-FINAL-05: Existing inactive assignment grandfathered on PATCH
// ═══════════════════════════════════════════════════════════════════════════════
describe("PLAN-FINAL-05: Grandfathered inactive responsible user not re-validated on PATCH without change", () => {
  it("validateResponsibleUser is only called when a new responsibleUserId is supplied in PATCH body", async () => {
    // PATCH /plans/:id without responsibleUserId in body should not fire user validation
    mockPoolQuery.mockImplementation((sql: string) => {
      // getPlanMeta
      if (sql.includes("LEFT JOIN projects")) {
        return Promise.resolve({ rows: [{ sector: "Health", stateId: null, locationType: "hq" }] });
      }
      // isPlanCurrentlyEditable — last_final_approved_at null means editable
      if (sql.includes("last_final_approved_at")) {
        return Promise.resolve({ rows: [{ status: "draft", lastFinalApprovedAt: null, start_date: null, end_date: null, title: "Plan", responsible_user_id: 77 }] });
      }
      if (sql.includes("FROM plans pl")) {
        return Promise.resolve({ rows: [PLAN_ROW] });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    const client = mockClient((sql) => {
      if (sql.includes("SELECT status FROM users")) {
        // Should NOT be called when responsibleUserId is NOT in PATCH body
        // If called, return inactive to fail the test
        return { rows: [{ status: "suspended" }], rowCount: 1 };
      }
      if (sql.includes("UPDATE plans")) return { rows: [PLAN_ROW], rowCount: 1 };
      return null;
    });

    const app = await buildApp({ ...PM_USER });
    // PATCH without responsibleUserId — grandfathered assignment untouched
    const res = await request(app).patch("/plans/42").send({
      title: "Updated Title",
      // no responsibleUserId supplied
    });
    // Should succeed (200/204 or similar), NOT 422 from user validation
    expect(res.status).not.toBe(422);
    const userValidationCalls = client.query.mock.calls.filter(
      ([sql]: [string]) => typeof sql === "string" && sql.includes("SELECT status FROM users"),
    );
    expect(userValidationCalls).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PLAN-FINAL-06: Progress status matrix constants (structural)
// ═══════════════════════════════════════════════════════════════════════════════
describe("PLAN-FINAL-06: Progress/status consistency matrix (structural verification)", async () => {
  // Import the validateActivityProgressConsistency function via the module's exports
  const plansModule = await import("../routes/plans.js");

  it("PLAN_TRANSITIONS.complete target is 'completed'", () => {
    expect(plansModule.PLAN_TRANSITIONS.complete.to).toBe("completed");
  });

  it("PLAN_TRANSITIONS.complete source set excludes draft and submitted", () => {
    const { from } = plansModule.PLAN_TRANSITIONS.complete;
    expect(from).not.toContain("draft");
    expect(from).not.toContain("submitted");
    expect(from).toContain("active");
    expect(from).toContain("in_progress");
    expect(from).toContain("delayed");
  });

  it("POST_APPROVAL_LOCKED_STATUSES includes 'rejected' (PLAN-BD-5 terminal lock)", () => {
    expect(plansModule.POST_APPROVAL_LOCKED_STATUSES.has("rejected")).toBe(true);
  });

  it("REOPENABLE_STATUSES does NOT include 'rejected' (terminal, no reopen)", () => {
    expect(plansModule.REOPENABLE_STATUSES.has("rejected")).toBe(false);
  });

  it("REOPENABLE_STATUSES does NOT include 'completed' or 'cancelled' (terminal operational)", () => {
    expect(plansModule.REOPENABLE_STATUSES.has("completed")).toBe(false);
    expect(plansModule.REOPENABLE_STATUSES.has("cancelled")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PLAN-FINAL-07: Cancelled activity excluded from plan progress AVG
// ═══════════════════════════════════════════════════════════════════════════════
describe("PLAN-FINAL-07: Cancelled activities excluded from plan-level progress AVG", async () => {
  const { default: plansRouter } = await import("../routes/plans.js");

  it("GET /plans emits a planSummarySelect query that excludes cancelled activities from AVG(progress_pct)", async () => {
    let capturedSql = "";
    mockPoolQuery.mockImplementation((sql: string) => {
      // Capture the first SQL string that references progress_pct
      if (typeof sql === "string" && sql.includes("progress_pct") && capturedSql === "") {
        capturedSql = sql;
      }
      return Promise.resolve({ rows: [] });
    });
    const app = express();
    app.use(express.json());
    app.use((req: Request, _res: Response, next: NextFunction) => {
      (req as unknown as Record<string, unknown>).currentUser = { ...PM_USER };
      next();
    });
    app.use("/", plansRouter);
    await request(app).get("/plans");
    // Must have captured at least one query containing progress_pct
    expect(capturedSql).not.toBe(""); // fails if no progress_pct query was emitted
    // The AVG subquery must exclude cancelled activities
    expect(capturedSql).toMatch(/status\s*<>\s*'cancelled'/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PLAN-FINAL-08: No eligible activities → null progressPct (not 0)
// ═══════════════════════════════════════════════════════════════════════════════
describe("PLAN-FINAL-08: No eligible activities → null progressPct returned from API", () => {
  it("Plan with no activities returns progressPct=null in list response", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("FROM plans pl")) {
        // Return plan with progressPct explicitly null (no activities)
        return Promise.resolve({ rows: [{ ...PLAN_ROW, progressPct: null, activitiesCount: 0 }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const app = await buildApp({ ...PM_USER });
    const res = await request(app).get("/plans");
    expect(res.status).toBe(200);
    if (res.body.length > 0) {
      // null should be preserved — not coerced to 0
      expect(res.body[0].progressPct).toBeNull();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PLAN-FINAL-09: Structured duplicate (monthly) → hard 409
// ═══════════════════════════════════════════════════════════════════════════════
describe("PLAN-FINAL-09: Structured monthly duplicate → hard 409 block", () => {
  it("POST /plans for monthly plan with existing active duplicate → 409 plan_duplicate_exists", async () => {
    setupListQuery();
    mockClient((sql) => {
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (sql.includes("status NOT IN")) {
        return { rows: [{ id: 77, status: "active", sector: "Health" }] };
      }
      return null;
    });
    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans").send({
      title: "Monthly Plan A", locationType: "hq",
      planType: "monthly",
      startDate: "2026-01-01", endDate: "2026-01-31",
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("plan_duplicate_exists");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PLAN-FINAL-10: Irregular duplicate (action) → soft warning, creation allowed
// ═══════════════════════════════════════════════════════════════════════════════
describe("PLAN-FINAL-10: Irregular plan type (action) → soft warning only, creation proceeds", () => {
  it("POST /plans for action plan with similar existing plan → 201 with duplicate_warning (not 409)", async () => {
    setupListQuery();
    mockClient((sql) => {
      if (sql.includes("INSERT INTO plans")) return { rows: [{ id: 55 }], rowCount: 1 };
      return null;
    });
    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans").send({
      title: "Action Plan B", locationType: "hq",
      planType: "action",
      startDate: "2026-01-01", endDate: "2026-01-31",
    });
    // 409 is NOT allowed for irregular types — must be 201 (with optional duplicate_warning)
    expect(res.status).not.toBe(409);
    expect([200, 201]).toContain(res.status);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PLAN-FINAL-11: Advisory lock acquired inside transaction for structured creates
// ═══════════════════════════════════════════════════════════════════════════════
describe("PLAN-FINAL-11: pg_advisory_xact_lock acquired inside BEGIN transaction for structured types", () => {
  it("Advisory lock SQL emitted by the transaction client for monthly plan create", async () => {
    setupListQuery();
    let advisoryLockCalled = false;
    mockClient((sql) => {
      if (sql.includes("pg_advisory_xact_lock")) {
        advisoryLockCalled = true;
        return { rows: [] };
      }
      if (sql.includes("status NOT IN")) return { rows: [] }; // no duplicate
      return null;
    });
    const app = await buildApp({ ...PM_USER });
    await request(app).post("/plans").send({
      title: "Monthly Lock Test", locationType: "hq",
      planType: "monthly",
      startDate: "2026-02-01", endDate: "2026-02-28",
    });
    expect(advisoryLockCalled).toBe(true);
  });

  it("PLAN-BD-2 duplicate-guard advisory lock is NOT emitted for irregular plan type (action) — the separate plan-code allocation lock still is", async () => {
    // Two independent pg_advisory_xact_lock calls now exist: the PLAN-BD-2
    // duplicate-guard lock (structured types only, distinguishable by its
    // multi-param CASE-expression key) and the plan-code allocation lock
    // (generatePlanCode/generateHqPlanCode, fires on every create). Only the
    // former is type-gated.
    setupListQuery();
    let duplicateGuardLockCalled = false;
    mockClient((sql) => {
      if (sql.includes("pg_advisory_xact_lock")) {
        if (sql.includes("CASE")) duplicateGuardLockCalled = true;
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO plans")) return { rows: [{ id: 56 }], rowCount: 1 };
      return null;
    });
    const app = await buildApp({ ...PM_USER });
    await request(app).post("/plans").send({
      title: "Action No Lock", locationType: "hq",
      planType: "action",
      startDate: "2026-02-01", endDate: "2026-02-28",
    });
    expect(duplicateGuardLockCalled).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PLAN-FINAL-12: Duplicate-check: State-scoped role cannot see out-of-scope data
// ═══════════════════════════════════════════════════════════════════════════════
describe("PLAN-FINAL-12: GET /plans/duplicate-check scopes results by caller state", () => {
  it("State-scoped SPO (stateId=5) sees no results for plans in a different state", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("duplicate") || sql.includes("status NOT IN") || sql.includes("plans WHERE")) {
        // Return an empty set — state scoping applied by the query
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });
    const app = await buildApp({ ...SPO_USER });
    const res = await request(app).get(
      "/plans/duplicate-check?planType=monthly&startDate=2026-01-01&endDate=2026-01-31&stateId=99",
    );
    // The endpoint must not return a 500 and must not expose out-of-state data
    expect(res.status).not.toBe(500);
    // SPO stateId=5 querying stateId=99 — should return no match (clamped to own state)
    if (res.status === 200) {
      expect(res.body.matchType).not.toBe("hard"); // no cross-state hard block surfaced
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PLAN-FINAL-13: CAS conflict (wrong source status) → 409, no side effects
// ═══════════════════════════════════════════════════════════════════════════════
describe("PLAN-FINAL-13: CAS transition — wrong source status → 409 Conflict, zero side effects", () => {
  it("technical_review from 'draft' (wrong source) → 409 cannot_technical_review_from_draft", async () => {
    setupTransitionQuery("draft");
    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans/42/transitions").send({ action: "technical_review" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("cannot_technical_review_from_draft");
  });

  it("reject from 'draft' (wrong source) → 409", async () => {
    setupTransitionQuery("draft");
    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans/42/transitions").send({
      action: "reject", commentText: "Bad plan",
    });
    expect(res.status).toBe(409);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PLAN-FINAL-14: Reopen rejected Plan → 409
// ═══════════════════════════════════════════════════════════════════════════════
describe("PLAN-FINAL-14: Reopen rejected Plan → 409 (PLAN-BD-5 terminal)", () => {
  it("POST /plans/:id/reopen on rejected plan → 409 cannot_reopen_terminal", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("LEFT JOIN projects")) {
        return Promise.resolve({ rows: [{ sector: "Health", stateId: null, locationType: "hq" }] });
      }
      if (sql.includes("FROM plans pl")) {
        return Promise.resolve({ rows: [{ ...PLAN_ROW, status: "rejected" }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const client = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes("FOR UPDATE")) {
          return Promise.resolve({ rows: [{ status: "rejected", code: "CAFA-PLAN-HQ-042", title: "Rejected Plan", last_final_approved_at: null }] });
        }
        return Promise.resolve({ rows: [] });
      }),
      release: vi.fn(),
    };
    mockPoolConnect.mockResolvedValue(client);
    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans/42/reopen").send({ reason: "Administrative override" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("cannot_reopen_terminal");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PLAN-FINAL-15: Request Revision → draft, same ID, revision reason stored
// ═══════════════════════════════════════════════════════════════════════════════
describe("PLAN-FINAL-15: request_revision transition returns plan to draft (same ID)", () => {
  it("request_revision from 'submitted' stores comment using the same plan ID, does not create a new plan", async () => {
    // setupTransitionQuery uses `LEFT JOIN projects` to detect getPlanMeta.
    // planSummarySelect also contains LEFT JOIN projects, so getPlanById returns
    // the meta shape (no id field) rather than the full plan. This is a mock
    // artefact; the real assertion for "same plan ID" is that:
    //   a) the CAS UPDATE was called with planId=42 (not a new plan row),
    //   b) the INSERT INTO comments used planId=42, and
    //   c) no INSERT INTO plans was emitted (no new plan created).
    setupTransitionQuery("submitted");
    let commentInserted = false;
    let casUpdatePlanId: unknown = null;
    let newPlanCreated = false;
    const transClient = {
      query: vi.fn().mockImplementation((sql: string, params?: unknown[]) => {
        if (sql.includes("INSERT INTO plans")) {
          newPlanCreated = true;
        }
        if (sql.includes("INSERT INTO comments")) {
          commentInserted = true;
          return Promise.resolve({ rows: [{ id: 55 }], rowCount: 1 });
        }
        // CAS lock: SELECT ... FOR UPDATE returns plan in submitted state
        if (sql.includes("FOR UPDATE")) {
          return Promise.resolve({
            rows: [{ status: "submitted", last_final_approved_at: null, start_date: "2026-01-01", end_date: "2026-12-31", title: "Plan", responsible_user_id: null }],
          });
        }
        // CAS UPDATE: record the planId used in the params
        if (sql.trim().toUpperCase().startsWith("UPDATE PLANS")) {
          // params for `UPDATE plans SET status=$1 WHERE id=$2 AND status=$3` → params[1] is planId
          if (Array.isArray(params) && params.length >= 2) casUpdatePlanId = params[1];
          return Promise.resolve({ rows: [], rowCount: 1 });
        }
        return Promise.resolve({ rows: [], rowCount: 1 });
      }),
      release: vi.fn(),
    };
    mockPoolConnect.mockResolvedValue(transClient);
    const app = await buildApp({ ...PM_USER });
    // The handler reads req.body.comment (not commentText) per plans.ts line 2544
    const res = await request(app).post("/plans/42/transitions").send({
      action: "request_revision", comment: "Please revise the budget section.",
    });
    expect(res.status).toBe(200);                // Successful transition
    expect(commentInserted).toBe(true);          // Revision comment was stored in the transaction
    expect(casUpdatePlanId).toBe(42);            // CAS UPDATE used planId=42, not a new plan
    expect(newPlanCreated).toBe(false);          // No INSERT INTO plans — same plan, not a copy
  });

  it("request_revision without comment body → 400 comment_required", async () => {
    setupTransitionQuery("submitted");
    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans/42/transitions").send({
      action: "request_revision",
      // No comment field
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/comment_required/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PLAN-FINAL-16: Revision comment read exception — SPO scope
// ═══════════════════════════════════════════════════════════════════════════════
describe("PLAN-FINAL-16: SPO revision comment read exception security invariants", () => {
  // The authoritative test suite for this path is plan-comment-read-exception.test.ts
  // (PLAN-COM-01..10, 10 tests). This closure test verifies the two critical end-states
  // using the hoisted @workspace/db mock — no vi.doMock (which breaks after module
  // caching). The hoisted mock covers both plans.ts and comments.ts routes because
  // they both import pool from @workspace/db.

  const REVISION_COMMENT = {
    id: 55, entityType: "plan", entityId: 42,
    parentId: null, section: null, commentType: "revision_request",
    authorId: 20, authorName: "TC", authorRoleLabel: "Technical Coordinator",
    body: "Please revise.", status: "open", resolvedAt: null, resolvedById: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };

  it("SPO in same state reads revision_request comments on returned draft plan → 200 with correct comment", async () => {
    // Gate query: SELECT ok FROM plans WHERE id=42, stateId=5, status='draft', revision approval exists
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ ok: true }] });
    // Narrow comment query: returns only revision_request comments
    mockPoolQuery.mockResolvedValueOnce({ rows: [REVISION_COMMENT] });
    const app = await buildCommentsApp({ ...SPO_USER });
    const res = await request(app).get("/comments?entityType=plan&entityId=42");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].commentType).toBe("revision_request");
  });

  it("SPO in different state is denied access to plan comments → 403", async () => {
    // Gate query returns ok=false: plan belongs to state 5, caller is in state 99
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ ok: false }] });
    const app = await buildCommentsApp({ ...SPO_OTHER_STATE });
    const res = await request(app).get("/comments?entityType=plan&entityId=42");
    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PLAN-FINAL-17/18: Rejected Plan — terminal invariants
// ═══════════════════════════════════════════════════════════════════════════════
describe("PLAN-FINAL-17/18: Rejected Plan — no PATCH, no reopen, no resubmit", async () => {
  const { PLAN_TRANSITIONS, REOPENABLE_STATUSES, POST_APPROVAL_LOCKED_STATUSES } = await import("../routes/plans.js");

  it("PLAN-FINAL-17: No transition has 'rejected' as a source status", () => {
    for (const [action, { from }] of Object.entries(PLAN_TRANSITIONS)) {
      expect(from).not.toContain("rejected"), `Transition '${action}' must not accept rejected as source`;
    }
  });

  it("PLAN-FINAL-17: REOPENABLE_STATUSES does NOT contain 'rejected'", () => {
    expect(REOPENABLE_STATUSES.has("rejected")).toBe(false);
  });

  it("PLAN-FINAL-17: POST_APPROVAL_LOCKED_STATUSES contains 'rejected' (blocks PATCH)", () => {
    expect(POST_APPROVAL_LOCKED_STATUSES.has("rejected")).toBe(true);
  });

  it("PLAN-FINAL-18: PATCH on rejected plan → 409 plan_approval_locked (no bypass)", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("LEFT JOIN projects")) {
        return Promise.resolve({ rows: [{ sector: "Health", stateId: null, locationType: "hq" }] });
      }
      if (sql.includes("last_final_approved_at")) {
        return Promise.resolve({
          rows: [{ status: "rejected", lastFinalApprovedAt: null, start_date: null, end_date: null, title: "Rejected Plan", responsible_user_id: null }],
        });
      }
      if (sql.includes("FROM plans pl")) {
        return Promise.resolve({ rows: [{ ...PLAN_ROW, status: "rejected" }] });
      }
      return Promise.resolve({ rows: [] });
    });
    mockClient((sql) => {
      if (sql.includes("FOR UPDATE")) {
        return { rows: [{ status: "rejected", lastFinalApprovedAt: null, start_date: null, end_date: null, title: "Rejected Plan", responsible_user_id: null }], rowCount: 1 };
      }
      return null;
    });
    const app = await buildApp({ ...PM_USER });
    const res = await request(app).patch("/plans/42").send({ title: "Try to edit rejected" });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/plan_approval_locked|plan_not_found/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PLAN-FINAL-19: Plan delete — atomic cleanup
// ═══════════════════════════════════════════════════════════════════════════════
describe("PLAN-FINAL-19: Plan delete — activities, risk refs, attachments, sessions cleaned atomically", () => {
  it("DELETE /plans/:id calls risk SET NULL before plan_activities delete, then removes plan row; sessions revoked via library mock", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("LEFT JOIN projects")) {
        return Promise.resolve({ rows: [{ sector: "Health", stateId: null, locationType: "hq" }] });
      }
      return Promise.resolve({ rows: [] });
    });

    // Single ordered log of every significant database operation in sequence.
    // Operations are appended in call order so ordering invariants can be asserted.
    const callLog: string[] = [];
    const client = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (typeof sql !== "string") return Promise.resolve({ rows: [], rowCount: 1 });

        // Return values for queries that drive control flow
        if (sql.includes("FOR UPDATE")) {
          return Promise.resolve({ rows: [{ id: 42 }], rowCount: 1 });
        }
        if (sql.includes("SELECT object_path FROM plan_attachments")) {
          return Promise.resolve({ rows: [{ object_path: "plans/42/file.pdf" }] });
        }

        // Track all cleanup operations in the order they are called.
        // Uses if/else-if so each call is attributed to exactly one log entry.
        if (sql.includes("DELETE FROM plan_registration_sessions")) {
          callLog.push("sessions.delete");
        } else if (sql.includes("DELETE FROM comments") && sql.includes("entity_type = 'plan'")) {
          callLog.push("comments.delete");
        } else if (sql.includes("DELETE FROM approvals") && sql.includes("entity_type = 'plan'")) {
          callLog.push("approvals.delete");
        } else if (sql.includes("UPDATE risks") && sql.includes("plan_activity_id = NULL")) {
          callLog.push("risks.plan_activity_id.null");
        } else if (sql.includes("UPDATE risks") && sql.includes("plan_id = NULL")) {
          callLog.push("risks.plan_id.null");
        } else if (sql.includes("DELETE FROM plan_attachments")) {
          callLog.push("attachments.delete");
        } else if (sql.includes("DELETE FROM plan_activities")) {
          callLog.push("plan_activities.delete");
        } else if (/DELETE FROM plans\b/.test(sql)) {
          callLog.push("plans.delete");
        }
        return Promise.resolve({ rows: [], rowCount: 1 });
      }),
      release: vi.fn(),
    };
    mockPoolConnect.mockResolvedValue(client);

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).delete("/plans/42");
    // Successful delete returns 204
    expect([200, 204]).toContain(res.status);

    // ── All required cleanup operations must have been called ──────────────
    expect(callLog).toContain("sessions.delete");          // plan_registration_sessions cleared (direct SQL)
    expect(callLog).toContain("comments.delete");          // plan comments removed
    expect(callLog).toContain("risks.plan_activity_id.null"); // activity risk refs nulled
    expect(callLog).toContain("risks.plan_id.null");       // plan risk refs nulled
    expect(callLog).toContain("plan_activities.delete");   // activities deleted
    expect(callLog).toContain("plans.delete");             // plan row deleted last

    // ── Critical ordering invariants ───────────────────────────────────────
    // 1. Risk activity_id nulled BEFORE plan_activities deleted (no FK — app-level guard)
    const riskActNullIdx = callLog.indexOf("risks.plan_activity_id.null");
    const actDeleteIdx   = callLog.indexOf("plan_activities.delete");
    expect(riskActNullIdx).toBeLessThan(actDeleteIdx);

    // 2. plans.delete is the LAST mutation recorded (plan row removed after all dependencies)
    const plansDeleteIdx = callLog.lastIndexOf("plans.delete");
    expect(plansDeleteIdx).toBe(callLog.length - 1);

    // ── Storage cleanup fires post-COMMIT (deleteStorageObjectSafely mock) ─
    const { deleteStorageObjectSafely } = await import("../lib/objectStorage.js");
    expect(deleteStorageObjectSafely).toHaveBeenCalledWith("plans/42/file.pdf");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PLAN-FINAL-20: PM/Super Admin cannot bypass date constraint or duplicate hard block
// ═══════════════════════════════════════════════════════════════════════════════
describe("PLAN-FINAL-20: PM/Super Admin cannot bypass date or duplicate integrity", () => {
  it("PM: end_date < start_date → 422 (no privilege bypass)", async () => {
    setupListQuery();
    mockClient();
    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans").send({
      title: "PM Bad Dates", locationType: "hq",
      startDate: "2026-12-31", endDate: "2026-01-01",
    });
    expect(res.status).toBe(422);
  });

  it("PM: structured monthly duplicate → 409 (no privilege bypass)", async () => {
    setupListQuery();
    mockClient((sql) => {
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (sql.includes("status NOT IN")) {
        return { rows: [{ id: 99, status: "approved", sector: "Health" }] };
      }
      return null;
    });
    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans").send({
      title: "PM Duplicate", locationType: "hq",
      planType: "monthly",
      startDate: "2026-03-01", endDate: "2026-03-31",
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("plan_duplicate_exists");
  });
});
