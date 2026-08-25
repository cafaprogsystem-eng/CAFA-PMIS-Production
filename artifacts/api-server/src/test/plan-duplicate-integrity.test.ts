/**
 * Plan Duplicate Integrity — Backend Tests (Task #474)
 *
 * Implements PLAN-BD-2: hard backend guard for structured plan types,
 * soft warning for irregular types, advisory lock concurrency safety.
 *
 * PLAN-DUP-01   Monthly same scope+period → 409
 * PLAN-DUP-02   Quarterly duplicate → 409
 * PLAN-DUP-03   Annual duplicate → 409
 * PLAN-DUP-04   Different title, same identity → 409 (title excluded)
 * PLAN-DUP-05   Different period → 201 (allowed)
 * PLAN-DUP-06   Different project_id scope → 201
 * PLAN-DUP-07   Different state/HQ scope → 201
 * PLAN-DUP-08   Existing Draft blocks new structured duplicate
 * PLAN-DUP-09   Submitted/review-stage blocks duplicate
 * PLAN-DUP-10   Approved blocks duplicate
 * PLAN-DUP-11   Active/in_progress/completed block
 * PLAN-DUP-12   Rejected does NOT block → 201
 * PLAN-DUP-13   Cancelled does NOT block → 201
 * PLAN-DUP-14   Archived does NOT block → 201 (per PLAN-BD-2 §11)
 *
 * PLAN-DUP-SOFT-01  Action plan creates despite similar existing → soft warning
 * PLAN-DUP-SOFT-02  Operational soft warning
 * PLAN-DUP-SOFT-03  Emergency soft warning
 * PLAN-DUP-SOFT-04  Custom soft warning
 * PLAN-DUP-SOFT-05  Explicit continue creates irregular → 201
 *
 * PLAN-DUP-RACE-01  Two concurrent identical structured creates: exactly one 409
 *
 * PLAN-DUP-SEC-01  Cross-State actor cannot enumerate duplicate metadata
 * PLAN-DUP-SEC-02  TC outside scope receives no sensitive matching Plan data
 * PLAN-DUP-SEC-03  Null-State scoped user fails closed
 * PLAN-DUP-SEC-04  PM Full Access cannot bypass duplicate block
 * PLAN-DUP-SEC-05  Super Admin cannot bypass hard duplicate block
 *
 * PLAN-DUP-CHECK-01  GET /plans/duplicate-check returns hard for structured match
 * PLAN-DUP-CHECK-02  GET /plans/duplicate-check returns none when no match
 * PLAN-DUP-CHECK-03  GET /plans/duplicate-check returns soft for irregular match
 * PLAN-DUP-CHECK-04  GET /plans/duplicate-check returns planId for accessible draft
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
vi.mock("../middlewares/currentUser.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../middlewares/currentUser.js")>();
  return {
    ...original,
    logAudit:           vi.fn().mockResolvedValue(undefined),
    requirePerm:        () => (_req: Request, _res: Response, next: NextFunction) => next(),
    attachCurrentUser:  (_req: Request, _res: Response, next: NextFunction) => next(),
    // tcSectorRestriction — real implementation (from ...original spread) is active;
    // Wave 1's assertAnySectorAllowed in plans.ts calls it directly, so the previous
    // pass-through middleware stub (wrong signature) had to be removed.
  };
});
vi.mock("../lib/objectStorage.js", () => ({
  deleteStorageObjectSafely: vi.fn().mockResolvedValue({ deleted: true }),
  objectStorageService: {},
}));
vi.mock("../lib/plan-registration-session.js", () => ({
  ensureRegistrationSessionTable: vi.fn().mockResolvedValue(undefined),
  createRegistrationSession: vi.fn().mockResolvedValue("mock-token"),
  validateRegistrationSession: vi.fn().mockResolvedValue(true),
  closeRegistrationSession: vi.fn().mockResolvedValue(true),
  revokeRegistrationSessionsByPlan: vi.fn().mockResolvedValue(undefined),
}));

// ── User fixtures ─────────────────────────────────────────────────────────────
const PM_USER  = { id: 1, name: "PM", email: "pm@t.com", role: "program_manager", scope: "global", stateId: null, stateName: null, sector: null, sectors: [], avatarUrl: null } as const;
const SA_USER  = { id: 2, name: "SA", email: "sa@t.com", role: "super_admin",     scope: "global", stateId: null, stateName: null, sector: null, sectors: [], avatarUrl: null } as const;
// TC_HEALTH: TC assigned to Health sector only — cannot see Education plans
const TC_USER  = { id: 3, name: "TC", email: "tc@t.com", role: "technical_coordinator", scope: "sector", stateId: null, stateName: null, sector: "Health", sectors: ["Health"], avatarUrl: null } as const;
// TC_EDU: TC assigned to Education sector — used for cross-sector security tests
const TC_EDU   = { id: 10, name: "TCEdu", email: "tcedu@t.com", role: "technical_coordinator", scope: "sector", stateId: null, stateName: null, sector: "Education", sectors: ["Education"], avatarUrl: null } as const;
const SPO_USER = { id: 4, name: "SPO", email: "spo@t.com", role: "state_program_officer", scope: "state", stateId: 5, stateName: "Khartoum", sector: null, sectors: [], avatarUrl: null } as const;
const SPO_CROSS = { id: 8, name: "SPO2", email: "spo2@t.com", role: "state_program_officer", scope: "state", stateId: 7, stateName: "Kassala", sector: null, sectors: [], avatarUrl: null } as const;
const SOM_NULL = { id: 9, name: "SOM", email: "som@t.com", role: "state_office_manager", scope: "state", stateId: null, stateName: null, sector: null, sectors: [], avatarUrl: null } as const;

// ── Plan INSERT result fixture ─────────────────────────────────────────────────
const PLAN_INSERT_RESULT = { id: 99, code: "CAFA-PLAN-KH-001", status: "draft" };

/** Full plan row returned by getPlanById's planSummarySelect query */
const PLAN_SUMMARY_ROW = {
  id: 99, status: "draft", code: "CAFA-PLAN-KH-001", title: "Test Plan",
  planType: "monthly", frequency: "monthly", sector: "Health", stateId: 5,
  stateName: "Khartoum", locationType: "state", projectId: null, projectTitle: null,
  localityId: null, localities: [], sectors: ["Health"], responsibleName: "Alice",
  responsibleUserId: null, responsibleUserName: null,
  startDate: "2026-01-01", endDate: "2026-01-31",
  budgetPlanned: null, budgetActual: null, currency: null, fundingSource: null,
  budgetLegacyUnverified: false, lastFinalApprovedAt: null, progressPct: null, activitiesCount: 0,
};

// ── App builder ───────────────────────────────────────────────────────────────
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

/**
 * Builds a mock transaction client for CREATE tests.
 *
 * By default returns empty rows for every SQL call, making the happy path succeed.
 * Use `overrides` to inject specific SQL results (e.g., simulate a duplicate row).
 */
function mockTransactionClient(
  overrides?: (sql: string, params?: unknown[]) => { rows: unknown[]; rowCount?: number } | null,
) {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const client = {
    calls,
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      const override = overrides?.(sql, params);
      if (override !== null && override !== undefined) return override;
      return { rows: [], rowCount: 1 };
    }),
    release: vi.fn(),
  };
  return client;
}

/**
 * Returns true when ANY query called on the client matches the SQL fragment.
 */
function clientCalledWith(client: ReturnType<typeof mockTransactionClient>, fragment: string) {
  return client.calls.some((c) => c.sql.toLowerCase().includes(fragment.toLowerCase()));
}

const PLAN_EXTRAS_ROW = {
  description: null, objectives: [], createdById: 1,
  createdByName: "Test User", createdAt: new Date(), updatedAt: new Date(),
};

/**
 * Standard pool.query mock for the "happy path" (CREATE succeeds).
 *
 * Covers all non-transactional queries that getPlanById and the code generator
 * issue via pool.query (not the transaction client).
 * IMPORTANT: Must return Promise.resolve() to satisfy await pool.query().
 */
function defaultPoolResponses(sql: string) {
  // State code lookup for generatePlanCode
  if (sql.includes("FROM states WHERE id") || sql.includes("FROM states")) {
    return Promise.resolve({ rows: [{ code: "KH" }] });
  }
  // Plan code sequence lookups (both HQ and state variants)
  if (sql.includes("FROM plans WHERE code LIKE")) return Promise.resolve({ rows: [] });
  // getPlanById extras query — SELECT pl.description, pl.objectives … FROM plans pl LEFT JOIN users cu
  // Must match BEFORE the planSummarySelect branch (which also contains "FROM plans pl")
  if (sql.includes("createdByName") || (sql.includes("FROM plans pl") && sql.includes("LEFT JOIN users"))) {
    return Promise.resolve({ rows: [PLAN_EXTRAS_ROW] });
  }
  // getPlanById main summary select (planSummarySelect): FROM plans pl … LEFT JOIN projects
  if (sql.includes("FROM plans pl") && sql.includes("LEFT JOIN projects")) {
    return Promise.resolve({ rows: [PLAN_SUMMARY_ROW] });
  }
  // Plan activities
  if (sql.includes("FROM plan_activities")) return Promise.resolve({ rows: [] });
  // Linked risks
  if (sql.includes("FROM risks")) return Promise.resolve({ rows: [] });
  // Project sector fallback
  if (sql.includes("FROM projects WHERE id")) return Promise.resolve({ rows: [{ sector: "Health" }] });
  return Promise.resolve({ rows: [], rowCount: 0 });
}

// ── Base POST body for structured plan creation ────────────────────────────
const BASE_MONTHLY_BODY = {
  title: "January Operations",
  planType: "monthly",
  stateId: 5,
  startDate: "2026-01-01",
  endDate: "2026-01-31",
  sectors: ["Health"],
  responsibleName: "Alice",
};

// ─────────────────────────────────────────────────────────────────────────────
// HARD DUPLICATE TESTS — POST /plans CREATE GUARD
// ─────────────────────────────────────────────────────────────────────────────

describe("PLAN-DUP-01 through PLAN-DUP-03: Structured types hard block on duplicate", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("PLAN-DUP-01: Monthly plan with same scope+period → 409", async () => {
    const client = mockTransactionClient((sql) => {
      // Advisory lock: return empty (success)
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
      // Duplicate check: return a matching row (include sector so assertSectorAllowed can run)
      if (sql.includes("status NOT IN") && sql.includes("FROM plans")) {
        return { rows: [{ id: 55, status: "submitted", sector: "Health" }] };
      }
      return null;
    });
    mockPoolConnect.mockResolvedValueOnce(client);
    mockPoolQuery.mockImplementation(defaultPoolResponses);

    const app = await buildApp(SPO_USER);
    const res = await request(app).post("/plans").send(BASE_MONTHLY_BODY);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("plan_duplicate_exists");
    expect(res.body.existing).toBeDefined();
    // ROLLBACK must have been called
    expect(clientCalledWith(client, "ROLLBACK")).toBe(true);
  });

  it("PLAN-DUP-02: Quarterly plan with same scope+period → 409", async () => {
    const client = mockTransactionClient((sql) => {
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (sql.includes("status NOT IN") && sql.includes("FROM plans")) {
        return { rows: [{ id: 56, status: "technically_approved", sector: "Health" }] };
      }
      return null;
    });
    mockPoolConnect.mockResolvedValueOnce(client);
    mockPoolQuery.mockImplementation(defaultPoolResponses);

    const app = await buildApp(SPO_USER);
    const res = await request(app).post("/plans").send({
      ...BASE_MONTHLY_BODY, planType: "quarterly",
      startDate: "2026-01-01", endDate: "2026-03-31",
    });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("plan_duplicate_exists");
  });

  it("PLAN-DUP-03: Annual plan with same scope+period → 409", async () => {
    const client = mockTransactionClient((sql) => {
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (sql.includes("status NOT IN") && sql.includes("FROM plans")) {
        return { rows: [{ id: 57, status: "approved", sector: "Health" }] };
      }
      return null;
    });
    mockPoolConnect.mockResolvedValueOnce(client);
    mockPoolQuery.mockImplementation(defaultPoolResponses);

    const app = await buildApp(SPO_USER);
    const res = await request(app).post("/plans").send({
      ...BASE_MONTHLY_BODY, planType: "annual",
      startDate: "2026-01-01", endDate: "2026-12-31",
    });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("plan_duplicate_exists");
  });
});

describe("PLAN-DUP-04: Different title, same identity → 409 (title excluded from key)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("PLAN-DUP-04: Title difference does not prevent 409", async () => {
    const client = mockTransactionClient((sql) => {
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (sql.includes("status NOT IN") && sql.includes("FROM plans")) {
        return { rows: [{ id: 58, status: "draft", sector: "Health" }] };
      }
      return null;
    });
    mockPoolConnect.mockResolvedValueOnce(client);
    mockPoolQuery.mockImplementation(defaultPoolResponses);

    const app = await buildApp(SPO_USER);
    const res = await request(app).post("/plans").send({
      ...BASE_MONTHLY_BODY,
      title: "Completely Different Title — Same Identity",
    });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("plan_duplicate_exists");
  });
});

describe("PLAN-DUP-05 through PLAN-DUP-07: Allowed scenarios (different scope/period)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("PLAN-DUP-05: Different period → 201 (no duplicate)", async () => {
    const client = mockTransactionClient((sql) => {
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (sql.includes("status NOT IN") && sql.includes("FROM plans")) {
        // No duplicate for this different period
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO plans")) return { rows: [PLAN_INSERT_RESULT], rowCount: 1 };
      return null;
    });
    mockPoolConnect.mockResolvedValueOnce(client);
    mockPoolQuery.mockImplementation(defaultPoolResponses);

    const app = await buildApp(SPO_USER);
    const res = await request(app).post("/plans").send({
      ...BASE_MONTHLY_BODY,
      startDate: "2026-02-01", endDate: "2026-02-28",
    });

    expect(res.status).toBe(201);
  });

  it("PLAN-DUP-06: Different project_id scope → 201", async () => {
    const client = mockTransactionClient((sql) => {
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (sql.includes("status NOT IN") && sql.includes("FROM plans")) return { rows: [] };
      if (sql.includes("INSERT INTO plans")) return { rows: [PLAN_INSERT_RESULT], rowCount: 1 };
      if (sql.includes("FROM projects WHERE id")) return { rows: [{ sector: "Health" }] };
      return null;
    });
    mockPoolConnect.mockResolvedValueOnce(client);
    mockPoolQuery.mockImplementation(defaultPoolResponses);

    const app = await buildApp(SPO_USER);
    // A different projectId creates a distinct scope
    const res = await request(app).post("/plans").send({
      ...BASE_MONTHLY_BODY,
      projectId: 99,
    });

    expect(res.status).toBe(201);
  });

  it("PLAN-DUP-07: HQ scope does not collide with state scope → 201", async () => {
    const client = mockTransactionClient((sql) => {
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (sql.includes("status NOT IN") && sql.includes("FROM plans")) return { rows: [] };
      if (sql.includes("INSERT INTO plans")) return { rows: [PLAN_INSERT_RESULT], rowCount: 1 };
      return null;
    });
    mockPoolConnect.mockResolvedValueOnce(client);
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("FROM plans WHERE code LIKE 'CAFA-PLAN-HQ")) return { rows: [] };
      return defaultPoolResponses(sql);
    });

    const app = await buildApp(PM_USER);
    const res = await request(app).post("/plans").send({
      ...BASE_MONTHLY_BODY,
      locationType: "hq",
      stateId: undefined,
    });

    expect(res.status).toBe(201);
  });
});

describe("PLAN-DUP-08 through PLAN-DUP-11: Status blocking matrix", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  const blockingStatuses = ["draft", "submitted", "technically_approved", "coordination_approved",
    "approved", "active", "in_progress", "delayed", "completed"];

  for (const status of blockingStatuses) {
    it(`PLAN-DUP: status='${status}' blocks new duplicate → 409`, async () => {
      const client = mockTransactionClient((sql) => {
        if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
        if (sql.includes("status NOT IN") && sql.includes("FROM plans")) {
          return { rows: [{ id: 60, status, sector: "Health" }] };
        }
        return null;
      });
      mockPoolConnect.mockResolvedValueOnce(client);
      mockPoolQuery.mockImplementation(defaultPoolResponses);

      const app = await buildApp(SPO_USER);
      const res = await request(app).post("/plans").send(BASE_MONTHLY_BODY);

      expect(res.status, `status='${status}' should block with 409`).toBe(409);
      expect(res.body.error).toBe("plan_duplicate_exists");
    });
  }
});

describe("PLAN-DUP-12 through PLAN-DUP-14: Non-blocking statuses (rejected/cancelled/archived)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("PLAN-DUP-12: Rejected plan does NOT block → 201", async () => {
    const client = mockTransactionClient((sql) => {
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
      // Hard check returns empty (rejected is excluded from status NOT IN clause)
      if (sql.includes("status NOT IN") && sql.includes("FROM plans")) return { rows: [] };
      if (sql.includes("INSERT INTO plans")) return { rows: [PLAN_INSERT_RESULT], rowCount: 1 };
      return null;
    });
    mockPoolConnect.mockResolvedValueOnce(client);
    mockPoolQuery.mockImplementation(defaultPoolResponses);

    const app = await buildApp(SPO_USER);
    const res = await request(app).post("/plans").send(BASE_MONTHLY_BODY);

    expect(res.status).toBe(201);
  });

  it("PLAN-DUP-13: Cancelled plan does NOT block → 201", async () => {
    const client = mockTransactionClient((sql) => {
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (sql.includes("status NOT IN") && sql.includes("FROM plans")) return { rows: [] };
      if (sql.includes("INSERT INTO plans")) return { rows: [PLAN_INSERT_RESULT], rowCount: 1 };
      return null;
    });
    mockPoolConnect.mockResolvedValueOnce(client);
    mockPoolQuery.mockImplementation(defaultPoolResponses);

    const app = await buildApp(SPO_USER);
    const res = await request(app).post("/plans").send(BASE_MONTHLY_BODY);

    expect(res.status).toBe(201);
  });

  it("PLAN-DUP-14: Archived plan does NOT block → 201 (PLAN-BD-2 §11)", async () => {
    // Per PLAN-BD-2 business decision: archived = historical record, replacement is legitimate.
    const client = mockTransactionClient((sql) => {
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (sql.includes("status NOT IN") && sql.includes("FROM plans")) return { rows: [] };
      if (sql.includes("INSERT INTO plans")) return { rows: [PLAN_INSERT_RESULT], rowCount: 1 };
      return null;
    });
    mockPoolConnect.mockResolvedValueOnce(client);
    mockPoolQuery.mockImplementation(defaultPoolResponses);

    const app = await buildApp(SPO_USER);
    const res = await request(app).post("/plans").send(BASE_MONTHLY_BODY);

    expect(res.status).toBe(201);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DRAFT CONTINUATION: planId returned when existing is draft
// ─────────────────────────────────────────────────────────────────────────────

describe("Draft continuation: planId returned for accessible draft duplicate", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("PLAN-DUP-08 explicit: Draft duplicate returns planId for continuation", async () => {
    const client = mockTransactionClient((sql) => {
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (sql.includes("status NOT IN") && sql.includes("FROM plans")) {
        return { rows: [{ id: 72, status: "draft", sector: "Health" }] };
      }
      return null;
    });
    mockPoolConnect.mockResolvedValueOnce(client);
    mockPoolQuery.mockImplementation(defaultPoolResponses);

    const app = await buildApp(SPO_USER);
    const res = await request(app).post("/plans").send(BASE_MONTHLY_BODY);

    expect(res.status).toBe(409);
    expect(res.body.existing.planId).toBe(72);
    expect(res.body.existing.status).toBe("draft");
  });

  it("Non-draft duplicate returns null planId (no navigation suggestion)", async () => {
    const client = mockTransactionClient((sql) => {
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (sql.includes("status NOT IN") && sql.includes("FROM plans")) {
        return { rows: [{ id: 73, status: "approved", sector: "Health" }] };
      }
      return null;
    });
    mockPoolConnect.mockResolvedValueOnce(client);
    mockPoolQuery.mockImplementation(defaultPoolResponses);

    const app = await buildApp(SPO_USER);
    const res = await request(app).post("/plans").send(BASE_MONTHLY_BODY);

    expect(res.status).toBe(409);
    expect(res.body.existing.planId).toBeNull();
    expect(res.body.existing.status).toBe("approved");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IRREGULAR TYPE TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe("PLAN-DUP-SOFT: Irregular types — no hard block, creation always permitted", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  const irregularTypes = ["action", "operational", "emergency", "custom"];
  const typeTestIds = ["PLAN-DUP-SOFT-01", "PLAN-DUP-SOFT-02", "PLAN-DUP-SOFT-03", "PLAN-DUP-SOFT-04"];

  irregularTypes.forEach((planType, idx) => {
    it(`${typeTestIds[idx]}: ${planType} plan creates despite similar existing → 201`, async () => {
      // For irregular types the advisory lock and hard check are NOT called.
      const client = mockTransactionClient((sql) => {
        if (sql.includes("INSERT INTO plans")) return { rows: [PLAN_INSERT_RESULT], rowCount: 1 };
        return null;
      });
      mockPoolConnect.mockResolvedValueOnce(client);
      mockPoolQuery.mockImplementation(defaultPoolResponses);

      const app = await buildApp(SPO_USER);
      const res = await request(app).post("/plans").send({
        ...BASE_MONTHLY_BODY, planType,
      });

      expect(res.status).toBe(201);
      // Advisory lock must NOT have been called for irregular types
      expect(clientCalledWith(client, "pg_advisory_xact_lock")).toBe(false);
    });
  });

  it("PLAN-DUP-SOFT-05: Explicit continue creates irregular → 201 (no block)", async () => {
    const client = mockTransactionClient((sql) => {
      if (sql.includes("INSERT INTO plans")) return { rows: [PLAN_INSERT_RESULT], rowCount: 1 };
      return null;
    });
    mockPoolConnect.mockResolvedValueOnce(client);
    mockPoolQuery.mockImplementation(defaultPoolResponses);

    const app = await buildApp(SPO_USER);
    const res = await request(app).post("/plans").send({
      ...BASE_MONTHLY_BODY, planType: "action",
    });

    expect(res.status).toBe(201);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CONCURRENCY TEST
// ─────────────────────────────────────────────────────────────────────────────

describe("PLAN-DUP-RACE-01: Advisory lock serialises concurrent identical creates", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("PLAN-DUP-RACE-01: pg_advisory_xact_lock is called before the duplicate check", async () => {
    // This test confirms the lock is acquired BEFORE the duplicate check,
    // ensuring correct serialisation order.
    const sqlOrder: string[] = [];
    const client = mockTransactionClient((sql) => {
      if (sql.includes("pg_advisory_xact_lock")) { sqlOrder.push("lock"); return { rows: [] }; }
      if (sql.includes("status NOT IN") && sql.includes("FROM plans")) {
        sqlOrder.push("dup_check");
        return { rows: [] }; // no duplicate — allow INSERT
      }
      if (sql.includes("INSERT INTO plans")) { sqlOrder.push("insert"); return { rows: [PLAN_INSERT_RESULT], rowCount: 1 }; }
      return null;
    });
    mockPoolConnect.mockResolvedValueOnce(client);
    mockPoolQuery.mockImplementation(defaultPoolResponses);

    const app = await buildApp(SPO_USER);
    await request(app).post("/plans").send(BASE_MONTHLY_BODY);

    const lockIdx     = sqlOrder.indexOf("lock");
    const dupCheckIdx = sqlOrder.indexOf("dup_check");
    const insertIdx   = sqlOrder.indexOf("insert");

    expect(lockIdx).toBeGreaterThanOrEqual(0);
    expect(dupCheckIdx).toBeGreaterThan(lockIdx);
    expect(insertIdx).toBeGreaterThan(dupCheckIdx);
  });

  it("PLAN-DUP-RACE-01b: Second create finds first plan after advisory lock — returns 409", async () => {
    // Simulates the second concurrent create: lock acquired, then duplicate found.
    const client = mockTransactionClient((sql) => {
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (sql.includes("status NOT IN") && sql.includes("FROM plans")) {
        // The first create already inserted — second now finds it.
        return { rows: [{ id: 88, status: "draft", sector: "Health" }] };
      }
      return null;
    });
    mockPoolConnect.mockResolvedValueOnce(client);
    mockPoolQuery.mockImplementation(defaultPoolResponses);

    const app = await buildApp(SPO_USER);
    const res = await request(app).post("/plans").send(BASE_MONTHLY_BODY);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("plan_duplicate_exists");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECURITY TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe("PLAN-DUP-SEC: Security — scope enforcement and metadata safety", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("PLAN-DUP-SEC-TC-GET: TC receives sanitized conflict (no title/status/planId) for cross-sector plan in GET", async () => {
    // TC_EDU (Education sector) queries for a plan that exists in Health sector.
    // The plan matches by scope+period, but TC_EDU cannot see its metadata.
    // Expected: matchType="hard" with null title/status/planId (safe conflict, no enumeration).
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{
        id: 90, title: "Health Plan Jan", status: "draft", sector: "Health",
        plan_type: "monthly", start_date: new Date("2026-01-01"), end_date: new Date("2026-01-31"),
      }],
    });

    const app = await buildApp(TC_EDU);
    const res = await request(app)
      .get("/plans/duplicate-check")
      .query({ planType: "monthly", startDate: "2026-01-01", endDate: "2026-01-31", stateId: "5" });

    expect(res.status).toBe(200);
    expect(res.body.matchType).toBe("hard");
    // Sanitized — TC_EDU cannot see Health-sector plan metadata
    expect(res.body.existing.title).toBeNull();
    expect(res.body.existing.status).toBeNull();
    expect(res.body.existing.planId).toBeNull();
  });

  it("PLAN-DUP-SEC-TC-POST: TC receives null planId/status in 409 for cross-sector existing plan", async () => {
    // TC_USER (Health sector) creates a plan. The hard duplicate check finds an
    // Education-sector plan (cross-sector for this TC). The 409 response must
    // return null planId and null status — no metadata leak.
    const client = mockTransactionClient((sql) => {
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (sql.includes("status NOT IN") && sql.includes("FROM plans")) {
        return { rows: [{ id: 91, status: "draft", sector: "Education" }] };
      }
      return null;
    });
    mockPoolConnect.mockResolvedValueOnce(client);
    // PLAN-009: the 409 path resolves the existing plan's effective sectors via
    // the authoritative helper (pool query) — return the Education-sector meta.
    mockPoolQuery.mockImplementation((sql: string, params?: unknown[]) => {
      if (sql.includes("FROM plans pl") && sql.includes("LEFT JOIN projects") && Array.isArray(params) && params[0] === 91) {
        return Promise.resolve({ rows: [{ sector: "Education", sectors: ["Education"], stateId: 5, locationType: "state" }] });
      }
      return defaultPoolResponses(sql);
    });

    // TC_USER has sectors: ["Health"]; the duplicate is in "Education" — cross-sector
    const app = await buildApp(TC_USER);
    const res = await request(app).post("/plans").send(BASE_MONTHLY_BODY);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("plan_duplicate_exists");
    // TC_USER (Health) cannot see Education sector plan — metadata sanitized
    expect(res.body.existing.planId).toBeNull();
    expect(res.body.existing.status).toBeNull();
  });

  it("PLAN-DUP-SEC-TC-OWN: TC gets full metadata for duplicate in their own sector", async () => {
    // TC_USER (Health sector) sees full metadata for a Health-sector duplicate.
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{
        id: 92, title: "Health Draft Plan", status: "draft", sector: "Health",
        plan_type: "monthly", start_date: new Date("2026-01-01"), end_date: new Date("2026-01-31"),
      }],
    });

    const app = await buildApp(TC_USER);
    const res = await request(app)
      .get("/plans/duplicate-check")
      .query({ planType: "monthly", startDate: "2026-01-01", endDate: "2026-01-31", stateId: "5" });

    expect(res.status).toBe(200);
    expect(res.body.matchType).toBe("hard");
    // Full metadata visible to TC_USER (Health sector matches)
    expect(res.body.existing.title).toBe("Health Draft Plan");
    expect(res.body.existing.status).toBe("draft");
    expect(res.body.existing.planId).toBe(92);
  });

  it("PLAN-DUP-SEC-04: PM Full Access cannot bypass hard duplicate block", async () => {
    const client = mockTransactionClient((sql) => {
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (sql.includes("status NOT IN") && sql.includes("FROM plans")) {
        return { rows: [{ id: 80, status: "approved", sector: "Health" }] };
      }
      return null;
    });
    mockPoolConnect.mockResolvedValueOnce(client);
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("FROM plans WHERE code LIKE 'CAFA-PLAN-HQ")) return { rows: [] };
      return defaultPoolResponses(sql);
    });

    const app = await buildApp(PM_USER);
    const res = await request(app).post("/plans").send({
      ...BASE_MONTHLY_BODY,
      locationType: "hq",
      stateId: undefined,
    });

    // PM with full access still gets 409
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("plan_duplicate_exists");
  });

  it("PLAN-DUP-SEC-05: Super Admin cannot bypass hard duplicate block", async () => {
    const client = mockTransactionClient((sql) => {
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (sql.includes("status NOT IN") && sql.includes("FROM plans")) {
        return { rows: [{ id: 81, status: "in_progress", sector: "Health" }] };
      }
      return null;
    });
    mockPoolConnect.mockResolvedValueOnce(client);
    mockPoolQuery.mockImplementation(defaultPoolResponses);

    const app = await buildApp(SA_USER);
    const res = await request(app).post("/plans").send(BASE_MONTHLY_BODY);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("plan_duplicate_exists");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /plans/duplicate-check ENDPOINT TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe("PLAN-DUP-CHECK: GET /plans/duplicate-check preflight endpoint", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("PLAN-DUP-CHECK-01: Returns hard match for structured type with existing non-rejected plan", async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{
        id: 55, title: "Jan Plan", status: "submitted", sector: "Health",
        plan_type: "monthly", start_date: new Date("2026-01-01"), end_date: new Date("2026-01-31"),
      }],
    });

    const app = await buildApp(SPO_USER);
    const res = await request(app)
      .get("/plans/duplicate-check")
      .query({ planType: "monthly", startDate: "2026-01-01", endDate: "2026-01-31", stateId: "5" });

    expect(res.status).toBe(200);
    expect(res.body.matchType).toBe("hard");
    expect(res.body.existing).toBeDefined();
    expect(res.body.existing.status).toBe("submitted");
    // Non-draft → planId should be null
    expect(res.body.existing.planId).toBeNull();
  });

  it("PLAN-DUP-CHECK-02: Returns none when no match exists", async () => {
    // hard check returns empty, soft check returns 0
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [] })   // hard check
      .mockResolvedValueOnce({ rows: [{ n: 0 }] }); // soft check

    const app = await buildApp(SPO_USER);
    const res = await request(app)
      .get("/plans/duplicate-check")
      .query({ planType: "monthly", startDate: "2026-02-01", endDate: "2026-02-28", stateId: "5" });

    expect(res.status).toBe(200);
    expect(res.body.matchType).toBe("none");
  });

  it("PLAN-DUP-CHECK-03: Returns soft for irregular plan type", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ n: 2 }] });

    const app = await buildApp(SPO_USER);
    const res = await request(app)
      .get("/plans/duplicate-check")
      .query({ planType: "action", startDate: "2026-01-01", endDate: "2026-01-31", stateId: "5" });

    expect(res.status).toBe(200);
    expect(res.body.matchType).toBe("soft");
    expect(res.body.count).toBeGreaterThan(0);
  });

  it("PLAN-DUP-CHECK-04: Returns planId for accessible draft match", async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{
        id: 72, title: "Draft Plan", status: "draft", sector: "Health",
        plan_type: "monthly", start_date: new Date("2026-01-01"), end_date: new Date("2026-01-31"),
      }],
    });

    const app = await buildApp(SPO_USER);
    const res = await request(app)
      .get("/plans/duplicate-check")
      .query({ planType: "monthly", startDate: "2026-01-01", endDate: "2026-01-31", stateId: "5" });

    expect(res.status).toBe(200);
    expect(res.body.matchType).toBe("hard");
    expect(res.body.existing.planId).toBe(72);
    expect(res.body.existing.status).toBe("draft");
  });

  it("PLAN-DUP-SEC-01: Cross-State actor (SPO-CROSS) gets no data for state 5 scope", async () => {
    // SPO_CROSS has stateId=7, trying to check scope for stateId=5 — should return "none"
    const app = await buildApp(SPO_CROSS);
    const res = await request(app)
      .get("/plans/duplicate-check")
      .query({ planType: "monthly", startDate: "2026-01-01", endDate: "2026-01-31", stateId: "5" });

    expect(res.status).toBe(200);
    // assertStateAllowed fails for cross-state — returns "none" without leaking data
    expect(res.body.matchType).toBe("none");
    // pool.query should not have been called (scope denied before DB hit)
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });

  it("PLAN-DUP-SEC-02: HQ duplicate check returns none for state-scoped role", async () => {
    const app = await buildApp(SPO_USER);
    const res = await request(app)
      .get("/plans/duplicate-check")
      .query({ planType: "monthly", startDate: "2026-01-01", endDate: "2026-01-31", locationType: "hq" });

    expect(res.status).toBe(200);
    expect(res.body.matchType).toBe("none");
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });

  it("PLAN-DUP-SEC-03: Null-State SOM fails closed — returns none", async () => {
    // SOM_NULL has stateId=null — state plan check without stateId fails closed
    const app = await buildApp(SOM_NULL);
    const res = await request(app)
      .get("/plans/duplicate-check")
      .query({ planType: "monthly", startDate: "2026-01-01", endDate: "2026-01-31" });
    // No stateId provided — fails closed
    expect(res.status).toBe(200);
    expect(res.body.matchType).toBe("none");
  });

  it("PLAN-DUP-CHECK: Missing required params → 400", async () => {
    const app = await buildApp(SPO_USER);
    const res = await request(app)
      .get("/plans/duplicate-check")
      .query({ planType: "monthly", startDate: "2026-01-01" }); // missing endDate

    expect(res.status).toBe(400);
  });

  it("PLAN-DUP-CHECK: Invalid planType → 400", async () => {
    const app = await buildApp(SPO_USER);
    const res = await request(app)
      .get("/plans/duplicate-check")
      .query({ planType: "invalid_type", startDate: "2026-01-01", endDate: "2026-01-31" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_plan_type");
  });

  // ── Input validation hardening ────────────────────────────────────────────

  it("PLAN-DUP-VAL-01: Malformed startDate (not YYYY-MM-DD) → 400", async () => {
    const app = await buildApp(SPO_USER);
    const res = await request(app)
      .get("/plans/duplicate-check")
      .query({ planType: "monthly", startDate: "01-Jan-2026", endDate: "2026-01-31", stateId: "5" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_date_format");
  });

  it("PLAN-DUP-VAL-02: Malformed endDate → 400", async () => {
    const app = await buildApp(SPO_USER);
    const res = await request(app)
      .get("/plans/duplicate-check")
      .query({ planType: "monthly", startDate: "2026-01-01", endDate: "2026/01/31", stateId: "5" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_date_format");
  });

  it("PLAN-DUP-VAL-03: Non-integer draftPlanId → 400", async () => {
    const app = await buildApp(SPO_USER);
    const res = await request(app)
      .get("/plans/duplicate-check")
      .query({ planType: "monthly", startDate: "2026-01-01", endDate: "2026-01-31", stateId: "5", draftPlanId: "abc" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_draft_plan_id");
  });

  it("PLAN-DUP-VAL-04: Zero draftPlanId → 400", async () => {
    const app = await buildApp(SPO_USER);
    const res = await request(app)
      .get("/plans/duplicate-check")
      .query({ planType: "monthly", startDate: "2026-01-01", endDate: "2026-01-31", stateId: "5", draftPlanId: "0" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_draft_plan_id");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SELF-DUPLICATE EXCLUSION: draftPlanId excludes the plan being edited
// ─────────────────────────────────────────────────────────────────────────────

describe("PLAN-DUP-SELF: Self-duplicate exclusion via draftPlanId", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("PLAN-DUP-SELF-01: draftPlanId matching found plan → returns none (not hard)", async () => {
    // The user is editing plan #72 (a draft). The DB query finds plan #72 as a
    // duplicate match. Because draftPlanId=72 excludes it, no match is returned.
    // The endpoint returns none → save buttons stay enabled.
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [] })           // hard check (excluded by AND id <> $7)
      .mockResolvedValueOnce({ rows: [{ n: 0 }] });  // soft check

    const app = await buildApp(SPO_USER);
    const res = await request(app)
      .get("/plans/duplicate-check")
      .query({ planType: "monthly", startDate: "2026-01-01", endDate: "2026-01-31", stateId: "5", draftPlanId: "72" });

    expect(res.status).toBe(200);
    expect(res.body.matchType).toBe("none");
  });

  it("PLAN-DUP-SELF-02: draftPlanId present but different plan found → still returns hard", async () => {
    // User is editing plan #72, but a DIFFERENT plan (#55) exists with same identity.
    // draftPlanId=72 excludes #72 only; #55 is still found → hard block.
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{
        id: 55, title: "Another Plan", status: "submitted", sector: "Health",
        plan_type: "monthly", start_date: new Date("2026-01-01"), end_date: new Date("2026-01-31"),
      }],
    });

    const app = await buildApp(SPO_USER);
    const res = await request(app)
      .get("/plans/duplicate-check")
      .query({ planType: "monthly", startDate: "2026-01-01", endDate: "2026-01-31", stateId: "5", draftPlanId: "72" });

    expect(res.status).toBe(200);
    expect(res.body.matchType).toBe("hard");
    expect(res.body.existing.status).toBe("submitted");
  });

  it("PLAN-DUP-SELF-03: No draftPlanId → own draft blocks (original behaviour preserved)", async () => {
    // Without draftPlanId, the own draft IS found and returns hard.
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{
        id: 72, title: "My Draft", status: "draft", sector: "Health",
        plan_type: "monthly", start_date: new Date("2026-01-01"), end_date: new Date("2026-01-31"),
      }],
    });

    const app = await buildApp(SPO_USER);
    const res = await request(app)
      .get("/plans/duplicate-check")
      .query({ planType: "monthly", startDate: "2026-01-01", endDate: "2026-01-31", stateId: "5" });
    // No draftPlanId param → hard match returned

    expect(res.status).toBe(200);
    expect(res.body.matchType).toBe("hard");
    expect(res.body.existing.planId).toBe(72);
  });

  it("PLAN-DUP-SELF-04: draftPlanId SQL clause uses AND id <> $7 (self-exclude in query)", async () => {
    // Verify the exclusion clause is actually appended to the hard check SQL.
    const queriedSqls: string[] = [];
    mockPoolQuery.mockImplementation((sql: string) => {
      queriedSqls.push(sql);
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const app = await buildApp(SPO_USER);
    await request(app)
      .get("/plans/duplicate-check")
      .query({ planType: "monthly", startDate: "2026-01-01", endDate: "2026-01-31", stateId: "5", draftPlanId: "72" });

    const hardCheckSql = queriedSqls.find((s) => s.includes("status NOT IN") && s.includes("FROM plans"));
    expect(hardCheckSql).toBeDefined();
    // Must include the self-exclusion clause
    expect(hardCheckSql).toMatch(/AND id <> \$7/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADVISORY LOCK SQL STRUCTURE TEST
// ─────────────────────────────────────────────────────────────────────────────

describe("Advisory lock uses scope-branch deterministic hash key (PLAN-BD-2 race safety)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("Lock SQL uses hashtext() with CASE WHEN scope-branch (not flat concatenation)", async () => {
    // The scope-branch key ensures project-linked plans always lock on project_id
    // regardless of any client-supplied stateId, closing the race where concurrent
    // creates for the same project+period but different stateIds acquire different locks.
    const client = mockTransactionClient((sql) => {
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (sql.includes("status NOT IN") && sql.includes("FROM plans")) return { rows: [] };
      if (sql.includes("INSERT INTO plans")) return { rows: [PLAN_INSERT_RESULT], rowCount: 1 };
      return null;
    });
    mockPoolConnect.mockResolvedValueOnce(client);
    mockPoolQuery.mockImplementation(defaultPoolResponses);

    const app = await buildApp(SPO_USER);
    await request(app).post("/plans").send(BASE_MONTHLY_BODY);

    const lockCall = client.calls.find((c) => c.sql.includes("pg_advisory_xact_lock"));
    expect(lockCall).toBeDefined();
    expect(lockCall!.sql).toContain("hashtext");
    // Must use CASE WHEN scope branching — not a flat concat of all scope params
    expect(lockCall!.sql.toLowerCase()).toContain("case");
    expect(lockCall!.sql.toLowerCase()).toContain("when");
    // Project-linked branch
    expect(lockCall!.sql).toContain("project:");
    // HQ branch
    expect(lockCall!.sql).toContain("'hq'");
    // State-standalone branch
    expect(lockCall!.sql).toContain("state:");
  });

  it("Project-linked lock key branches on project_id only (not stateId)", async () => {
    // Two creates for the same projectId+type+period with different stateIds
    // must acquire THE SAME advisory lock, ensuring exactly one can insert.
    const lockKeys: (string | undefined)[] = [];
    const client = mockTransactionClient((sql, params) => {
      if (sql.includes("pg_advisory_xact_lock")) {
        // Record the stateId param position to verify it's not used as the key branch
        lockKeys.push(JSON.stringify(params));
        return { rows: [] };
      }
      if (sql.includes("status NOT IN") && sql.includes("FROM plans")) return { rows: [] };
      if (sql.includes("INSERT INTO plans")) return { rows: [PLAN_INSERT_RESULT], rowCount: 1 };
      return null;
    });
    mockPoolConnect.mockResolvedValueOnce(client);
    mockPoolQuery.mockImplementation(defaultPoolResponses);

    const app = await buildApp(SPO_USER);
    // Project-linked plan: $4=projectId, $5=null (locationType), $6=stateId
    // The CASE WHEN should branch on $4 IS NOT NULL → 'project:<projectId>'
    await request(app).post("/plans").send({
      ...BASE_MONTHLY_BODY,
      projectId: 42,
    });

    const lockCall = client.calls.find((c) => c.sql.includes("pg_advisory_xact_lock"));
    expect(lockCall).toBeDefined();
    // Params: [planType, startDate, endDate, projectId_str, locType, stateId_str]
    // $4 = projectId_str = "42" (non-null → uses project branch)
    const params = lockCall!.params as unknown[];
    expect(params[3]).toBe("42"); // lockProjectId as string
  });
});
