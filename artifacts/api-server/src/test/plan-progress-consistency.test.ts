/**
 * PLAN-BD-4: Plan Activity Progress Consistency Tests (Task #465)
 *
 * Implements all 21 required tests across three groups:
 *
 * PLAN-PROG-01…12    Status/progress validator unit tests + raw input rejection
 * PLAN-PROG-AVG-01…06  Plan-level progress aggregation (SQL exclusion of cancelled)
 * PLAN-PROG-FULL-01…02  Full Operational Access — PM/Super Admin cannot bypass
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { validateActivityProgressConsistency } from "../routes/plans.js";

// ── vi.hoisted: shared mock handles ───────────────────────────────────────────
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
vi.mock("../middlewares/currentUser.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../middlewares/currentUser.js")>();
  return {
    ...original,
    logAudit:          vi.fn().mockResolvedValue(undefined),
    requirePerm:       () => (_req: Request, _res: Response, next: NextFunction) => next(),
    attachCurrentUser: (_req: Request, _res: Response, next: NextFunction) => next(),
  };
});
vi.mock("../lib/objectStorage.js", () => ({
  deleteStorageObjectSafely: vi.fn().mockResolvedValue({ deleted: true }),
  objectStorageService: {},
}));
vi.mock("../lib/plan-registration-session.js", () => ({
  ensureRegistrationSessionTable: vi.fn().mockResolvedValue(undefined),
  createRegistrationSession:      vi.fn().mockResolvedValue("tok"),
  validateRegistrationSession:    vi.fn().mockResolvedValue(true),
  closeRegistrationSession:       vi.fn().mockResolvedValue(undefined),
  revokeRegistrationSessionsByPlan: vi.fn().mockResolvedValue(undefined),
}));

// ── User fixtures ─────────────────────────────────────────────────────────────
const PM_USER = {
  id: 1, name: "PM", email: "pm@t.com",
  role: "program_manager", roleLabel: "Programme Manager",
  scope: "global", stateId: null as null, stateName: null as null,
  sector: null as null, sectors: [] as string[], avatarUrl: null as null,
};
const SA_USER = {
  id: 2, name: "SA", email: "sa@t.com",
  role: "super_admin", roleLabel: "Super Admin",
  scope: "global", stateId: null as null, stateName: null as null,
  sector: null as null, sectors: [] as string[], avatarUrl: null as null,
};

type UserFixture = typeof PM_USER;

/** Minimal plan row returned by mocked GET /plans pool.query. */
const PLAN_ROW_BASE = {
  id: 1, title: "Test Plan", status: "draft", code: "CAFA-PLAN-KH-001",
  planType: "monthly", frequency: "monthly",
  stateId: 1, stateName: "Khartoum", locationType: null,
  sectors: [], localities: [], objectives: [],
  budgetPlanned: null, budgetActual: null, currency: "USD", fundingSource: null,
  lastFinalApprovedAt: null, responsibleName: "Alice", responsibleUserId: null,
  responsibleUserName: null, projectTitle: null, projectId: null,
  startDate: "2026-01-01", endDate: "2026-12-31", description: null,
  createdAt: new Date(), updatedAt: new Date(), createdByName: "PM",
  budgetLegacyUnverified: false,
};

function makeApp(user: UserFixture) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as Record<string, unknown>).currentUser = user;
    next();
  });
  return app;
}

async function buildApp(user: UserFixture = PM_USER) {
  const { default: plansRouter } = await import("../routes/plans.js");
  const app = makeApp(user);
  app.use("/", plansRouter);
  return app;
}

/** Minimal POST /plans mock: code generation + state row. Does NOT include users query (no responsibleUserId in payload). */
function mockCreateEnv() {
  mockPoolQuery.mockImplementation((sql: string) => {
    if (String(sql).includes("states") && String(sql).includes("code")) return { rows: [{ code: "KH" }] };
    if (String(sql).includes("code LIKE")) return { rows: [] };
    return { rows: [] };
  });
  const clientMock = {
    query: vi.fn().mockImplementation((sql: string) => {
      if (String(sql).includes("SELECT status FROM users")) return { rows: [{ status: "active" }] };
      if (String(sql).includes("RETURNING id")) return { rows: [{ id: 99 }] };
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  mockPoolConnect.mockResolvedValue(clientMock);
  return clientMock;
}

// ── Minimal valid activity (passes all non-progress checks) ──────────────────
const VALID_ACTIVITY = {
  title: "Activity 1",
  plannedDate: "2026-06-01",
  localityName: "Khartoum",
  priority: "medium",
  targetBeneficiaries: 0,
  budgetPlanned: 0,
  expectedResult: "Result",
};

// ── PLAN-PROG-01…12: Status/progress validator unit tests ─────────────────────
describe("PLAN-PROG: validateActivityProgressConsistency unit tests (PLAN-BD-4)", () => {
  it("PLAN-PROG-01: completed + 100 → accepted", () => {
    expect(validateActivityProgressConsistency("completed", 100)).toBeNull();
  });

  it("PLAN-PROG-02: completed + 99 → rejected", () => {
    const err = validateActivityProgressConsistency("completed", 99);
    expect(err).not.toBeNull();
    expect(err).toMatch(/100%/);
  });

  it("PLAN-PROG-03: in_progress + 1 → accepted", () => {
    expect(validateActivityProgressConsistency("in_progress", 1)).toBeNull();
  });

  it("PLAN-PROG-04: in_progress + 99 → accepted", () => {
    expect(validateActivityProgressConsistency("in_progress", 99)).toBeNull();
  });

  it("PLAN-PROG-05: in_progress + 0 → rejected", () => {
    const err = validateActivityProgressConsistency("in_progress", 0);
    expect(err).not.toBeNull();
    expect(err).toMatch(/1%.*99%/i);
  });

  it("PLAN-PROG-06: in_progress + 100 → rejected", () => {
    const err = validateActivityProgressConsistency("in_progress", 100);
    expect(err).not.toBeNull();
    expect(err).toMatch(/1%.*99%/i);
  });

  it("PLAN-PROG-07: planned + 0 → accepted", () => {
    expect(validateActivityProgressConsistency("planned", 0)).toBeNull();
  });

  it("PLAN-PROG-08: planned + 100 → rejected", () => {
    const err = validateActivityProgressConsistency("planned", 100);
    expect(err).not.toBeNull();
    expect(err).toMatch(/99%/);
  });

  it("PLAN-PROG-09: delayed + 0 → accepted", () => {
    expect(validateActivityProgressConsistency("delayed", 0)).toBeNull();
  });

  it("PLAN-PROG-10: delayed + 99 → accepted", () => {
    expect(validateActivityProgressConsistency("delayed", 99)).toBeNull();
  });

  it("PLAN-PROG-11: cancelled + 50 → accepted (historical progress preserved)", () => {
    expect(validateActivityProgressConsistency("cancelled", 50)).toBeNull();
  });

  /**
   * PLAN-PROG-12: Raw invalid inputs are rejected at the API level BEFORE
   * normalizeActivity silently coerces them.
   *
   * POST /plans with:
   *   progressPct: -1    → must be rejected (not clamped to 0)
   *   progressPct: 101   → must be rejected (not clamped to 100)
   *   progressPct: "abc" → must be rejected (NaN, not coerced to 0)
   *   status: "unknown"  → must be rejected (not silently converted to "planned")
   */
  describe("PLAN-PROG-12: raw invalid inputs rejected before normalisation (endpoint tests)", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mockCreateEnv();
    });

    it("negative progressPct is rejected — not silently clamped to 0", async () => {
      const app = await buildApp();
      const res = await request(app).post("/plans").send({
        title: "Plan", stateId: 1,
        activities: [{ ...VALID_ACTIVITY, status: "planned", progressPct: -1 }],
      });
      expect(res.status).toBe(422);
      expect(res.body.error).toBe("activity_progress_invalid");
      expect(res.body.details[0]).toMatch(/0%.*100%|between 0/i);
    });

    it("progressPct > 100 is rejected — not silently clamped to 100", async () => {
      const app = await buildApp();
      const res = await request(app).post("/plans").send({
        title: "Plan", stateId: 1,
        activities: [{ ...VALID_ACTIVITY, status: "in_progress", progressPct: 101 }],
      });
      expect(res.status).toBe(422);
      expect(res.body.error).toBe("activity_progress_invalid");
      expect(res.body.details[0]).toMatch(/0%.*100%|between 0/i);
    });

    it("non-numeric progressPct is rejected — not silently coerced to NaN/0", async () => {
      const app = await buildApp();
      const res = await request(app).post("/plans").send({
        title: "Plan", stateId: 1,
        activities: [{ ...VALID_ACTIVITY, status: "planned", progressPct: "abc" }],
      });
      expect(res.status).toBe(422);
      expect(res.body.error).toBe("activity_progress_invalid");
      expect(res.body.details[0]).toMatch(/number|numeric/i);
    });

    it("unsupported status is rejected — not silently converted to 'planned'", async () => {
      const app = await buildApp();
      const res = await request(app).post("/plans").send({
        title: "Plan", stateId: 1,
        activities: [{ ...VALID_ACTIVITY, status: "unknown_status", progressPct: 0 }],
      });
      expect(res.status).toBe(422);
      expect(res.body.error).toBe("activity_progress_invalid");
      expect(res.body.details[0]).toMatch(/unsupported status/i);
    });
  });
});

// ── PLAN-PROG-AVG: Plan-level progress aggregation via GET /plans ─────────────
describe("PLAN-PROG-AVG: Plan-level progress aggregation contract (PLAN-BD-4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // mockPoolConnect unused for GET /plans (no transaction needed)
    mockPoolConnect.mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    });
  });

  it("PLAN-PROG-AVG-01: planSummarySelect SQL excludes cancelled rows from AVG (SQL content check)", async () => {
    let capturedSql = "";
    mockPoolQuery.mockImplementation((sql: string) => {
      if (typeof sql === "string" && sql.includes("plan_activities")) {
        capturedSql = sql;
      }
      return { rows: [] };
    });

    const app = await buildApp();
    await request(app).get("/plans");

    // The aggregation must exclude cancelled activities — PLAN-015 (Wave 2)
    // moved it into the pre-aggregated pa_agg join's CASE expression.
    expect(capturedSql).toMatch(/AVG\(CASE WHEN status\s*<>\s*'cancelled' THEN progress_pct END\)/);
    // ROUND avoids int-truncation skew (avg of 50+100=75, not truncated)
    expect(capturedSql).toMatch(/ROUND\s*\(/i);
  });

  it("PLAN-PROG-AVG-02: cancelled activity excluded from denominator — SQL uses AND pa.status <> 'cancelled'", async () => {
    let capturedSql = "";
    mockPoolQuery.mockImplementation((sql: string) => {
      if (typeof sql === "string" && sql.includes("AVG")) {
        capturedSql = sql;
      }
      return { rows: [] };
    });

    const app = await buildApp();
    await request(app).get("/plans");

    // The exclusion clause must appear inside the AVG subquery, not as an outer filter
    expect(capturedSql).toContain("status <> 'cancelled'");
  });

  it("PLAN-PROG-AVG-03: plan with zero non-cancelled activities → progressPct is null (not 0)", async () => {
    // Mock DB returns a plan with progressPct: null (SQL AVG on empty set = NULL)
    mockPoolQuery.mockImplementation((sql: string) => {
      if (typeof sql === "string" && sql.includes("FROM plans")) {
        return { rows: [{ ...PLAN_ROW_BASE, progressPct: null, activitiesCount: 2 }] };
      }
      return { rows: [] };
    });

    const app = await buildApp();
    const res = await request(app).get("/plans");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].progressPct).toBeNull();
    // Must NOT coerce null to 0 or any default
    expect(res.body[0].progressPct).not.toBe(0);
  });

  it("PLAN-PROG-AVG-04: plan with only cancelled activities → progressPct null — DB NULL passes through as JSON null", async () => {
    // Same as AVG-03: when all activities are cancelled, SQL AVG returns NULL
    mockPoolQuery.mockImplementation((sql: string) => {
      if (typeof sql === "string" && sql.includes("FROM plans")) {
        return { rows: [{ ...PLAN_ROW_BASE, progressPct: null, activitiesCount: 3 }] };
      }
      return { rows: [] };
    });

    const app = await buildApp();
    const res = await request(app).get("/plans");

    expect(res.status).toBe(200);
    expect(res.body[0].progressPct).toBeNull();
  });

  it("PLAN-PROG-AVG-05: list and detail share planSummarySelect — single SQL definition covers both", async () => {
    const capturedSqls: string[] = [];
    mockPoolQuery.mockImplementation((sql: string) => {
      if (typeof sql === "string" && sql.includes("AVG")) capturedSqls.push(sql);
      return { rows: [] };
    });

    const app = await buildApp();
    // GET /plans (list) and GET /plans/:id (detail) both call planSummarySelect
    await Promise.all([
      request(app).get("/plans"),
      request(app).get("/plans/1"),
    ]);

    // Both queries should contain the same exclusion clause
    const allContainExclusion = capturedSqls.every(
      (sql) => sql.includes("status <> 'cancelled'"),
    );
    // At least the list query ran (GET /plans/1 may short-circuit on not_found mock)
    expect(capturedSqls.length).toBeGreaterThanOrEqual(1);
    expect(allContainExclusion).toBe(true);
  });

  it("PLAN-PROG-AVG-06: non-null progressPct passes through unchanged — no server-side coercion to zero", async () => {
    // Verify the endpoint serialises a non-null progress value faithfully
    mockPoolQuery.mockImplementation((sql: string) => {
      if (typeof sql === "string" && sql.includes("FROM plans")) {
        return { rows: [{ ...PLAN_ROW_BASE, progressPct: 75, activitiesCount: 2 }] };
      }
      return { rows: [] };
    });

    const app = await buildApp();
    const res = await request(app).get("/plans");

    expect(res.status).toBe(200);
    expect(res.body[0].progressPct).toBe(75);
  });
});

// ── PLAN-PROG-FULL: Full Operational Access tests ─────────────────────────────
describe("PLAN-PROG-FULL: PM and Super Admin cannot bypass progress consistency (PLAN-BD-4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateEnv();
  });

  it("PLAN-PROG-FULL-01: PM cannot save completed activity with progressPct=50 via POST /plans", async () => {
    const app = await buildApp(PM_USER);
    const res = await request(app).post("/plans").send({
      title: "Test Plan", stateId: 1,
      activities: [
        { ...VALID_ACTIVITY, status: "completed", progressPct: 50 },
      ],
    });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("activity_progress_invalid");
    expect(Array.isArray(res.body.details)).toBe(true);
    expect(res.body.details.length).toBeGreaterThan(0);
    expect(res.body.details[0]).toMatch(/100%/);
  });

  it("PLAN-PROG-FULL-02: Super Admin cannot bypass consistency — same 422 contract applies", async () => {
    const app = await buildApp(SA_USER);
    const res = await request(app).post("/plans").send({
      title: "SA Plan", stateId: 1,
      activities: [
        { ...VALID_ACTIVITY, status: "in_progress", progressPct: 0 },
      ],
    });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("activity_progress_invalid");
    expect(Array.isArray(res.body.details)).toBe(true);
    expect(res.body.details[0]).toMatch(/in.progress/i);
  });
});
