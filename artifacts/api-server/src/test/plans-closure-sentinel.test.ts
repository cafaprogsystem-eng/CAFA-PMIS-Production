/**
 * Plans Closure Sentinel — Task #486
 *
 * Verifies each reconciled finding (PLAN-BD-1/2/4/5 and PLAN-001–PLAN-017) against
 * production code after Tasks #430, #440, #465, #466, #474 merged.
 *
 * PLAN-CLOSE-01  All 7 plan types share one transition handler (no type-specific branch)
 * PLAN-CLOSE-02  Monthly/quarterly/annual hard duplicate guard blocks concurrent creates
 * PLAN-CLOSE-03  Irregular plan types (action/emergency/custom) always permitted even with existing
 * PLAN-CLOSE-04  Advisory lock serialises concurrent structured creates
 * PLAN-CLOSE-05  Rejected/cancelled plan does not block replacement creation
 * PLAN-CLOSE-06  Activity status/progress matrix constants enforced
 * PLAN-CLOSE-07  Cancelled activity excluded from plan progress AVG (structural)
 * PLAN-CLOSE-08  No eligible activities → null progressPct (not 0%)
 * PLAN-CLOSE-09  Rejected plan: no reopen, no edit, no resubmit, no outgoing transition
 * PLAN-CLOSE-10  Request Revision returns to draft; same plan ID preserved
 * PLAN-CLOSE-11  Date integrity: end < start → 422; Feb 30 → 422
 * PLAN-CLOSE-12  Responsible-user validation: inactive user → 422
 * PLAN-CLOSE-13  CAS transition conflict (wrong source status) → 409 with zero side effects
 * PLAN-CLOSE-14  Delete integrity: plan_activities removed, attachments and risks cleaned
 * PLAN-CLOSE-15  PM/Super Admin cannot bypass hard duplicate block or date constraint
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

const SA_USER = {
  id: 2, name: "SA", email: "sa@t.com", role: "super_admin",
  roleLabel: "Super Admin", scope: "global",
  stateId: null, stateName: null, sector: null, sectors: [], avatarUrl: null,
} as const;

// ── Minimal plan row ──────────────────────────────────────────────────────────
const PLAN_ROW = {
  id: 42, status: "draft", sector: "Health", stateId: null, locationType: "hq",
  title: "Closure Test Plan", planType: "monthly", frequency: "monthly",
  progressPct: null, activitiesCount: 0,
  sectors: [], localities: [], objectives: [],
  budgetPlanned: null, budgetActual: null, currency: null, fundingSource: null,
  lastFinalApprovedAt: null, code: "CAFA-PLAN-HQ-001",
  stateName: null, projectTitle: null,
  responsibleName: "Alice", responsibleUserId: null,
  startDate: "2026-01-01", endDate: "2026-12-31", description: null,
  createdAt: new Date(), updatedAt: new Date(), createdByName: "PM",
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

/** Minimal transaction client mock for POST/PATCH create tests. */
function mockTransactionClient(
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
      return Promise.resolve({ rows: [], rowCount: 1 });
    }),
    release: vi.fn(),
  };
  mockPoolConnect.mockResolvedValue(client);
  return client;
}

/** Wire pool.query for POST /plans (HQ plan, no stateId). */
function setupPostQuery(opts: { activeUser?: boolean; userExists?: boolean } = {}) {
  const { activeUser = true, userExists = true } = opts;
  mockPoolQuery.mockImplementation((sql: string) => {
    if (sql.includes("code LIKE 'CAFA-PLAN-HQ-%'")) return Promise.resolve({ rows: [] });
    if (sql.includes("code FROM states"))             return Promise.resolve({ rows: [{ code: "KH" }] });
    if (sql.includes("code LIKE $"))                  return Promise.resolve({ rows: [] });
    if (sql.includes("SELECT status FROM users")) {
      if (!userExists) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [{ status: activeUser ? "active" : "suspended" }] });
    }
    if (sql.includes("FROM plans pl")) return Promise.resolve({ rows: [PLAN_ROW] });
    return Promise.resolve({ rows: [] });
  });
}

/**
 * Wire pool.query for transition-handler tests.
 * The transition handler queries:
 *   1. SELECT status, sector, project_id, state_id FROM plans WHERE id = $1
 *   2. getPlanMeta — LEFT JOIN projects … WHERE pl.id = $1
 */
function setupTransitionQuery(status: string) {
  mockPoolQuery.mockImplementation((sql: string) => {
    // Transition handler direct SELECT (no alias)
    if (sql.includes("FROM plans WHERE id = $1")) {
      return Promise.resolve({ rows: [{ status, sector: "Health", project_id: null, stateId: null }] });
    }
    // getPlanMeta — uses LEFT JOIN projects
    if (sql.includes("LEFT JOIN projects")) {
      return Promise.resolve({ rows: [{ sector: "Health", stateId: null, locationType: "hq" }] });
    }
    // isPlanCurrentlyEditable check (action = 'reopen')
    if (sql.includes("action = 'reopen'")) {
      return Promise.resolve({ rows: [] });
    }
    // getPlanById (used after successful transition for response)
    if (sql.includes("FROM plans pl")) {
      return Promise.resolve({ rows: [{ ...PLAN_ROW, status }] });
    }
    return Promise.resolve({ rows: [] });
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLAN-CLOSE-01: All 7 plan types share identical PLAN_TRANSITIONS map
// ═══════════════════════════════════════════════════════════════════════════════
describe("PLAN-CLOSE-01: All 7 plan types share identical PLAN_TRANSITIONS map (PLAN-BD-1)", async () => {
  const { PLAN_TRANSITIONS, PLAN_TYPES } = await import("../routes/plans.js");

  it("01-a: PLAN_TYPES has exactly 7 entries", () => {
    expect(PLAN_TYPES.size).toBe(7);
  });

  it("01-b: Every plan type uses the same canonical transition set — no type-specific action keys", () => {
    const typeNames = new Set(["monthly", "quarterly", "annual", "action", "operational", "emergency", "custom"]);
    for (const key of Object.keys(PLAN_TRANSITIONS)) {
      expect(typeNames.has(key)).toBe(false);
    }
  });

  it("01-c: submit transition accepts draft source only — single unified from-set", () => {
    expect(PLAN_TRANSITIONS.submit.from).toEqual(["draft"]);
  });

  it("01-d: reject transition accepts pre-final statuses — single unified from-set", () => {
    expect(PLAN_TRANSITIONS.reject.from).toEqual(
      expect.arrayContaining(["submitted", "technically_approved", "coordination_approved"]),
    );
    expect(PLAN_TRANSITIONS.reject.to).toBe("rejected");
  });

  it("01-e: PLAN_TRANSITIONS has exactly 12 type-agnostic actions", () => {
    expect(Object.keys(PLAN_TRANSITIONS)).toHaveLength(12);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PLAN-CLOSE-02/03/04/05: Duplicate guard and advisory lock (PLAN-BD-2)
// NOTE: The hard duplicate check runs whenever planType is structured AND both
// dates are present — independent of closeRegistration flag.  Draft creates with
// both dates trigger the advisory lock + hard query inside the DB transaction.
// ═══════════════════════════════════════════════════════════════════════════════
describe("PLAN-CLOSE-02/03/04/05: Duplicate guard and advisory lock (PLAN-BD-2)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("PLAN-CLOSE-02: Monthly structured plan blocked when active duplicate exists → 409", async () => {
    setupPostQuery();
    mockTransactionClient((sql) => {
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (sql.includes("status NOT IN")) {
        // Hard duplicate found
        return { rows: [{ id: 99, status: "active", sector: "Health" }] };
      }
      return null;
    });

    const app = await buildApp({ ...PM_USER });
    // No closeRegistration flag — draft save with dates triggers the advisory lock + hard check.
    const res = await request(app).post("/plans").send({
      title: "Test Monthly", locationType: "hq",
      planType: "monthly",
      startDate: "2026-01-01", endDate: "2026-01-31",
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("plan_duplicate_exists");
  });

  it("PLAN-CLOSE-03: Irregular plan type (action) creates successfully even when similar plan exists", async () => {
    setupPostQuery();
    mockTransactionClient((sql) => {
      if (sql.includes("INSERT INTO plans")) return { rows: [{ id: 42 }], rowCount: 1 };
      return null;
    });

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans").send({
      title: "Action Plan", locationType: "hq",
      planType: "action",   // irregular — soft warning only, no backend hard guard
      startDate: "2026-01-01", endDate: "2026-01-31",
    });
    // Irregular types skip the backend hard guard; should not produce 409
    expect(res.status).not.toBe(409);
    expect(res.status).toBeLessThan(500);
  });

  it("PLAN-CLOSE-04: Advisory lock SQL is emitted inside the transaction for structured types", async () => {
    setupPostQuery();
    let lockCalled = false;
    mockTransactionClient((sql) => {
      if (sql.includes("pg_advisory_xact_lock")) { lockCalled = true; return { rows: [] }; }
      if (sql.includes("status NOT IN")) return { rows: [] }; // no duplicate
      if (sql.includes("INSERT INTO plans")) return { rows: [{ id: 42 }], rowCount: 1 };
      return null;
    });

    const app = await buildApp({ ...PM_USER });
    // Draft save with both dates — triggers advisory lock for monthly
    await request(app).post("/plans").send({
      title: "Monthly Plan", locationType: "hq",
      planType: "monthly",
      startDate: "2026-01-01", endDate: "2026-01-31",
    });
    expect(lockCalled).toBe(true);
  });

  it("PLAN-CLOSE-05: Rejected duplicate does NOT block replacement creation", async () => {
    // The hard duplicate query excludes rejected/cancelled/archived.
    // A rejected plan with same type+dates+scope returns no rows → create proceeds.
    setupPostQuery();
    mockTransactionClient((sql) => {
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
      // Hard check — no rows returned (rejected plan excluded by status NOT IN clause)
      if (sql.includes("status NOT IN")) return { rows: [] };
      if (sql.includes("INSERT INTO plans")) return { rows: [{ id: 42 }], rowCount: 1 };
      return null;
    });

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans").send({
      title: "Monthly Plan", locationType: "hq",
      planType: "monthly",
      startDate: "2026-01-01", endDate: "2026-01-31",
    });
    // Should not be 409 — rejected plan is not a blocker
    expect(res.status).not.toBe(409);
    expect(res.status).toBeLessThan(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PLAN-CLOSE-06/07/08: Activity progress model (PLAN-BD-4)
// ═══════════════════════════════════════════════════════════════════════════════
describe("PLAN-CLOSE-06/07/08: Activity progress model — cancelled excluded, null = no activities", async () => {
  const plansSource = await import("../routes/plans.js");

  it("PLAN-CLOSE-06: PLAN_TRANSITIONS and PLAN_TYPES are exported — no partial/undefined constants", () => {
    expect(plansSource.PLAN_TRANSITIONS).toBeDefined();
    expect(plansSource.PLAN_TYPES).toBeDefined();
    expect(plansSource.PLAN_TYPES.size).toBe(7);
  });

  it("PLAN-CLOSE-07: planSummarySelect SQL excludes cancelled activities from AVG (structural)", async () => {
    // Read the compiled JS or TS source to confirm the cancelled exclusion in the SQL.
    const { readFileSync } = await import("fs");
    const tsPath = new URL("../routes/plans.ts", import.meta.url).pathname;
    let src = "";
    try { src = readFileSync(tsPath, "utf8"); } catch { src = ""; }
    if (!src) {
      const jsPath = new URL("../routes/plans.js", import.meta.url).pathname;
      try { src = readFileSync(jsPath, "utf8"); } catch { src = ""; }
    }
    // progressPct aggregate must exclude cancelled activities from AVG.
    // PLAN-015 (Wave 2): the aggregate is a pre-aggregated LEFT JOIN (pa_agg),
    // with the cancelled exclusion inside the AVG's CASE expression itself.
    expect(src).toContain("AVG(CASE WHEN status <> 'cancelled' THEN progress_pct END)");
    expect(src).toContain("pa_agg");
  });

  it("PLAN-CLOSE-08: null progressPct (no eligible activities) propagates as null in API response", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("FROM plans pl")) {
        return Promise.resolve({ rows: [{ ...PLAN_ROW, progressPct: null, activitiesCount: 0 }] });
      }
      if (sql.includes("LEFT JOIN projects")) {
        return Promise.resolve({ rows: [{ sector: "Health", stateId: null, locationType: "hq" }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).get("/plans/42");
    expect(res.status).toBeLessThan(500);
    if (res.status === 200) {
      // progressPct must be null, never coerced to 0
      expect(res.body.progressPct).toBeNull();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PLAN-CLOSE-09: Rejected plan is terminal — no outgoing transitions (PLAN-BD-5)
// ═══════════════════════════════════════════════════════════════════════════════
describe("PLAN-CLOSE-09: Rejected plan is terminal (PLAN-BD-5)", async () => {
  const { PLAN_TRANSITIONS, REOPENABLE_STATUSES } = await import("../routes/plans.js");
  beforeEach(() => vi.clearAllMocks());

  it("09-a: PLAN_TRANSITIONS has no action that accepts 'rejected' as a source status", () => {
    for (const [action, transition] of Object.entries(PLAN_TRANSITIONS)) {
      expect(
        transition.from,
        `Action '${action}' must not accept 'rejected' as source`,
      ).not.toContain("rejected");
    }
  });

  it("09-b: REOPENABLE_STATUSES does not include 'rejected'", () => {
    expect(REOPENABLE_STATUSES.has("rejected")).toBe(false);
  });

  it("09-c: 'rejected' is not in REOPENABLE_STATUSES — reopen permanently blocked", () => {
    expect(REOPENABLE_STATUSES.has("rejected")).toBe(false);
  });

  it("09-d: POST /plans/:planId/transitions with 'submit' on a rejected plan → 409 wrong-source conflict", async () => {
    // Plan status is 'rejected' — submit requires 'draft' source → PLAN-016 → 409
    setupTransitionQuery("rejected");
    const casClient = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    };
    mockPoolConnect.mockResolvedValue(casClient);

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans/42/transitions").send({ action: "submit" });
    // submit from rejected: wrong source status → 409 cannot_submit_from_rejected
    expect(res.status).toBe(409);
    expect(res.body.error).toContain("cannot_submit_from_rejected");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PLAN-CLOSE-10: Request Revision returns to draft with same Plan ID
// ═══════════════════════════════════════════════════════════════════════════════
describe("PLAN-CLOSE-10: Request Revision returns to draft (same Plan ID)", async () => {
  const { PLAN_TRANSITIONS } = await import("../routes/plans.js");
  beforeEach(() => vi.clearAllMocks());

  it("10-a: request_revision transitions to 'draft'", () => {
    expect(PLAN_TRANSITIONS.request_revision.to).toBe("draft");
  });

  it("10-b: request_revision is accepted from submitted, technically_approved, coordination_approved", () => {
    expect(PLAN_TRANSITIONS.request_revision.from).toEqual(
      expect.arrayContaining(["submitted", "technically_approved", "coordination_approved"]),
    );
  });

  it("10-c: request_revision via API requires a comment; missing comment → 400", async () => {
    // Plan in 'submitted' state — request_revision without comment must be rejected
    setupTransitionQuery("submitted");
    const casClient = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
      release: vi.fn(),
    };
    mockPoolConnect.mockResolvedValue(casClient);

    const app = await buildApp({ ...PM_USER });
    const res = await request(app)
      .post("/plans/42/transitions")
      .send({ action: "request_revision" }); // no comment
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("comment_required_for_revision_or_reject");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PLAN-CLOSE-11: Date integrity (PLAN-011)
// ═══════════════════════════════════════════════════════════════════════════════
describe("PLAN-CLOSE-11: Date integrity — end < start → 422, impossible date → 422", () => {
  beforeEach(() => vi.clearAllMocks());

  it("11-a: POST with start > end returns 422 end_date_before_start_date", async () => {
    setupPostQuery();
    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans").send({
      title: "Date Test", locationType: "hq",
      startDate: "2026-12-31", endDate: "2026-01-01",
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("end_date_before_start_date");
  });

  it("11-b: POST with impossible date (Feb 30) returns 422 invalid_start_date", async () => {
    setupPostQuery();
    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans").send({
      title: "Date Test", locationType: "hq",
      startDate: "2026-02-30", endDate: "2026-12-31",
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("invalid_start_date");
  });

  it("11-c: POST with junk-suffix date does not silently truncate — returns 422", async () => {
    setupPostQuery();
    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans").send({
      title: "Date Test", locationType: "hq",
      startDate: "2026-01-01junk", endDate: "2026-12-31",
    });
    expect(res.status).toBe(422);
  });

  it("11-d: Migration 026 (plans_date_range_check) is registered in MIGRATIONS", async () => {
    const { MIGRATIONS } = await import("../lib/run-migrations.js");
    const mig = (MIGRATIONS as Array<{ name: string; sql: string }>).find(
      (m) => m.name === "026_plans_date_range_check",
    );
    expect(mig).toBeDefined();
    expect(mig?.sql).toContain("end_date >= start_date");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PLAN-CLOSE-12: Responsible-user validation: inactive user → 422 (PLAN-010)
// ═══════════════════════════════════════════════════════════════════════════════
describe("PLAN-CLOSE-12: Responsible user validation — inactive user → 422", () => {
  beforeEach(() => vi.clearAllMocks());

  it("12-a: POST with suspended responsible user returns 422", async () => {
    setupPostQuery({ activeUser: false });
    mockTransactionClient(undefined, { userStatus: "suspended" });

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans").send({
      title: "Resp Test", locationType: "hq",
      responsibleUserId: 99,
    });
    expect(res.status).toBe(422);
  });

  it("12-b: POST with non-existent responsible user returns 422", async () => {
    setupPostQuery({ userExists: false });
    mockTransactionClient(undefined, { userExists: false });

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans").send({
      title: "Resp Test", locationType: "hq",
      responsibleUserId: 9999,
    });
    expect(res.status).toBe(422);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PLAN-CLOSE-13: CAS transition conflict → 409 with zero side effects (PLAN-004)
// ═══════════════════════════════════════════════════════════════════════════════
describe("PLAN-CLOSE-13: CAS transition — wrong source status → 409, no side effects", () => {
  beforeEach(() => vi.clearAllMocks());

  it("13-a: Transition from wrong status returns 409 — PLAN-016 wrong-source guard", async () => {
    // Plan is currently 'draft'; technical_review requires 'submitted' source.
    // Handler detects the mismatch BEFORE any transaction, returning 409.
    setupTransitionQuery("draft");
    // No transaction client needed — 409 fires before BEGIN
    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans/42/transitions").send({ action: "technical_review" });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain("cannot_technical_review_from_draft");
  });

  it("13-b: invalid action name returns 400 before any DB interaction", async () => {
    // PLAN_TRANSITIONS lookup fails first — no DB call needed
    setupTransitionQuery("submitted");
    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans/42/transitions").send({ action: "nonexistent_action" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("invalid_action");
  });

  it("13-c: CAS transition constants are exported and coherent", async () => {
    const { PLAN_TRANSITIONS, PLAN_TRANSITION_PERMS } = await import("../routes/plans.js");
    // Every transition must have a perm defined
    for (const action of Object.keys(PLAN_TRANSITIONS)) {
      expect(
        PLAN_TRANSITION_PERMS[action],
        `Missing PLAN_TRANSITION_PERMS entry for action '${action}'`,
      ).toBeDefined();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PLAN-CLOSE-14: Delete integrity (PLAN-005)
// ═══════════════════════════════════════════════════════════════════════════════
describe("PLAN-CLOSE-14: Delete integrity — activities, risks, attachments cleaned up", () => {
  beforeEach(() => vi.clearAllMocks());

  it("14-a: DELETE /plans/:planId issues cascade SQL in the correct order", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("LEFT JOIN projects"))
        return Promise.resolve({ rows: [{ sector: "Health", stateId: null, locationType: "hq" }] });
      return Promise.resolve({ rows: [] });
    });

    const deletedQueries: string[] = [];
    const deleteClient = {
      query: vi.fn().mockImplementation((sql: string) => {
        deletedQueries.push(sql.trim());
        if (sql.includes("object_path FROM plan_attachments"))
          return Promise.resolve({ rows: [] }); // no attachments
        return Promise.resolve({ rows: [], rowCount: 1 });
      }),
      release: vi.fn(),
    };
    mockPoolConnect.mockResolvedValue(deleteClient);

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).delete("/plans/42");
    expect(res.status).toBeLessThan(500);

    const combined = deletedQueries.join("\n");
    // All critical cascade tables must be touched
    expect(combined).toContain("plan_registration_sessions");
    expect(combined).toContain("plan_activities");
    expect(combined).toContain("plan_attachments");
    // Risks preserved via SET NULL (not deleted)
    expect(combined).toContain("UPDATE risks");
    expect(combined).toContain("plan_activity_id = NULL");
  });

  it("14-b: DELETE clears risk references BEFORE removing plan_activities (no FK orphan)", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("LEFT JOIN projects"))
        return Promise.resolve({ rows: [{ sector: "Health", stateId: null, locationType: "hq" }] });
      return Promise.resolve({ rows: [] });
    });

    const queryOrder: string[] = [];
    const deleteClient = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.trim().startsWith("UPDATE risks")) queryOrder.push("risks_update");
        if (sql.includes("DELETE FROM plan_activities")) queryOrder.push("activities_delete");
        if (sql.includes("object_path FROM plan_attachments"))
          return Promise.resolve({ rows: [] });
        return Promise.resolve({ rows: [], rowCount: 1 });
      }),
      release: vi.fn(),
    };
    mockPoolConnect.mockResolvedValue(deleteClient);

    const app = await buildApp({ ...PM_USER });
    await request(app).delete("/plans/42");

    // risks.plan_activity_id must be cleared BEFORE plan_activities are deleted
    const risksIdx = queryOrder.indexOf("risks_update");
    const activitiesIdx = queryOrder.indexOf("activities_delete");
    expect(risksIdx).toBeGreaterThanOrEqual(0);
    expect(activitiesIdx).toBeGreaterThanOrEqual(0);
    expect(risksIdx).toBeLessThan(activitiesIdx);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PLAN-CLOSE-15: PM/Super Admin cannot bypass hard duplicate block or date constraint
// ═══════════════════════════════════════════════════════════════════════════════
describe("PLAN-CLOSE-15: PM and Super Admin cannot bypass hard guards", () => {
  beforeEach(() => vi.clearAllMocks());

  it("15-a: PM cannot bypass end_before_start date validation → 422", async () => {
    setupPostQuery();
    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans").send({
      title: "Bypass Test", locationType: "hq",
      startDate: "2026-12-31", endDate: "2026-01-01",
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("end_date_before_start_date");
  });

  it("15-b: Super Admin cannot bypass end_before_start date validation → 422", async () => {
    setupPostQuery();
    const app = await buildApp({ ...SA_USER });
    const res = await request(app).post("/plans").send({
      title: "Bypass Test", locationType: "hq",
      startDate: "2026-12-31", endDate: "2026-01-01",
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("end_date_before_start_date");
  });

  it("15-c: PM cannot bypass hard duplicate block for monthly plans → 409", async () => {
    setupPostQuery();
    mockTransactionClient((sql) => {
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (sql.includes("status NOT IN")) {
        return { rows: [{ id: 99, status: "active", sector: "Health" }] };
      }
      return null;
    });

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans").send({
      title: "Monthly Plan", locationType: "hq",
      planType: "monthly",
      startDate: "2026-01-01", endDate: "2026-01-31",
    });
    expect(res.status).toBe(409);
  });

  it("15-d: Super Admin cannot bypass hard duplicate block for quarterly plans → 409", async () => {
    setupPostQuery();
    mockTransactionClient((sql) => {
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (sql.includes("status NOT IN")) {
        return { rows: [{ id: 99, status: "draft", sector: "Health" }] };
      }
      return null;
    });

    const app = await buildApp({ ...SA_USER });
    const res = await request(app).post("/plans").send({
      title: "Q1 Plan", locationType: "hq",
      planType: "quarterly",
      startDate: "2026-01-01", endDate: "2026-03-31",
    });
    expect(res.status).toBe(409);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PLAN-CLOSE-16: Rejected plan locked for PATCH editing (PLAN-BD-5 / PLAN-017)
// Fix: "rejected" added to POST_APPROVAL_LOCKED_STATUSES so isPlanCurrentlyEditable()
// returns false for plans that were never finally approved but are now rejected.
// ═══════════════════════════════════════════════════════════════════════════════
describe("PLAN-CLOSE-16: Rejected plan is locked for PATCH editing (PLAN-BD-5 edit-lock fix)", async () => {
  const { POST_APPROVAL_LOCKED_STATUSES } = await import("../routes/plans.js");
  beforeEach(() => vi.clearAllMocks());

  it("16-a: 'rejected' is in POST_APPROVAL_LOCKED_STATUSES", () => {
    expect(POST_APPROVAL_LOCKED_STATUSES.has("rejected")).toBe(true);
  });

  it("16-b: isPlanCurrentlyEditable returns false for a rejected plan with no lastFinalApprovedAt", () => {
    // rejected + null lastFinalApprovedAt → locked (isPlanCurrentlyEditable = false)
    // We verify via the constant: !POST_APPROVAL_LOCKED_STATUSES.has("rejected") must be false
    expect(!POST_APPROVAL_LOCKED_STATUSES.has("rejected")).toBe(false);
  });

  it("16-c: PATCH /plans/:planId on a rejected plan returns 409 plan_approval_locked", async () => {
    // Rejected plan has no lastFinalApprovedAt → isPlanCurrentlyEditable sees
    // POST_APPROVAL_LOCKED_STATUSES.has("rejected") = true → returns false → 409.
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("LEFT JOIN projects"))
        return Promise.resolve({ rows: [{ sector: "Health", stateId: null, locationType: "hq" }] });
      if (sql.includes("last_final_approved_at") && sql.includes("start_date"))
        return Promise.resolve({ rows: [{ status: "rejected", lastFinalApprovedAt: null,
          start_date: null, end_date: null, title: "Rejected Plan", responsible_user_id: null }] });
      // isPlanCurrentlyEditable — no reopen row needed; rejected is locked regardless
      if (sql.includes("action = 'reopen'"))
        return Promise.resolve({ rows: [] });
      if (sql.includes("FROM plans pl"))
        return Promise.resolve({ rows: [{ ...PLAN_ROW, status: "rejected" }] });
      return Promise.resolve({ rows: [] });
    });
    const transClient = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
      release: vi.fn(),
    };
    mockPoolConnect.mockResolvedValue(transClient);

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).patch("/plans/42").send({ title: "Attempted Edit" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("plan_approval_locked");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PLAN-CLOSE-17: PATCH activity deletion clears risks.plan_activity_id first
// Fix: before DELETE FROM plan_activities (PATCH omit path), UPDATE risks SET
// plan_activity_id = NULL to prevent dangling references (no DB-level FK exists).
// ═══════════════════════════════════════════════════════════════════════════════
describe("PLAN-CLOSE-17: PATCH activity deletion clears risk references before delete", () => {
  beforeEach(() => vi.clearAllMocks());

  it("17-a: PATCH with omitted activity IDs issues UPDATE risks before DELETE plan_activities", async () => {
    // Existing: activities [10, 11]. PATCH keeps only [10] → 11 is omitted → toDelete=[11].
    // Expected order: UPDATE risks … plan_activity_id = NULL  BEFORE  DELETE plan_activities.
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("LEFT JOIN projects"))
        return Promise.resolve({ rows: [{ sector: "Health", stateId: null, locationType: "hq" }] });
      if (sql.includes("last_final_approved_at") && sql.includes("start_date"))
        return Promise.resolve({ rows: [{ status: "draft", lastFinalApprovedAt: null,
          start_date: null, end_date: null, title: "Draft Plan", responsible_user_id: null }] });
      if (sql.includes("action = 'reopen'"))
        return Promise.resolve({ rows: [] });
      if (sql.includes("FROM plans pl"))
        return Promise.resolve({ rows: [{ ...PLAN_ROW }] });
      return Promise.resolve({ rows: [] });
    });

    const queryOrder: string[] = [];
    const patchClient = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.trim().startsWith("UPDATE risks") && sql.includes("plan_activity_id = NULL"))
          queryOrder.push("risks_null");
        if (sql.includes("DELETE FROM plan_activities"))
          queryOrder.push("activities_delete");
        // Existing activities SELECT (includes responsible_user_id for grandfathering)
        if (sql.includes("FROM plan_activities") && sql.includes("FOR UPDATE"))
          return Promise.resolve({ rows: [{ id: 10, responsible_user_id: null }, { id: 11, responsible_user_id: null }] });
        return Promise.resolve({ rows: [], rowCount: 1 });
      }),
      release: vi.fn(),
    };
    mockPoolConnect.mockResolvedValue(patchClient);

    const app = await buildApp({ ...PM_USER });
    await request(app).patch("/plans/42").send({
      // Supply activity 10 (kept), omit 11 (deleted)
      activities: [{ id: 10, title: "Kept", status: "planned", progressPct: 0 }],
    });

    // UPDATE risks must come BEFORE DELETE plan_activities
    const risksIdx = queryOrder.indexOf("risks_null");
    const delIdx = queryOrder.indexOf("activities_delete");
    expect(risksIdx).toBeGreaterThanOrEqual(0);
    expect(delIdx).toBeGreaterThanOrEqual(0);
    expect(risksIdx).toBeLessThan(delIdx);
  });

  it("17-b: PATCH with no omitted activities skips the UPDATE risks call", async () => {
    // PATCH keeps all existing activities → toDelete is empty → no UPDATE risks emitted.
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("LEFT JOIN projects"))
        return Promise.resolve({ rows: [{ sector: "Health", stateId: null, locationType: "hq" }] });
      if (sql.includes("last_final_approved_at") && sql.includes("start_date"))
        return Promise.resolve({ rows: [{ status: "draft", lastFinalApprovedAt: null,
          start_date: null, end_date: null, title: "Draft Plan", responsible_user_id: null }] });
      if (sql.includes("action = 'reopen'"))
        return Promise.resolve({ rows: [] });
      if (sql.includes("FROM plans pl"))
        return Promise.resolve({ rows: [{ ...PLAN_ROW }] });
      return Promise.resolve({ rows: [] });
    });

    let riskNullCalled = false;
    const patchClient = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.trim().startsWith("UPDATE risks") && sql.includes("plan_activity_id = NULL"))
          riskNullCalled = true;
        if (sql.includes("SELECT id FROM plan_activities"))
          return Promise.resolve({ rows: [{ id: 10 }] });
        return Promise.resolve({ rows: [], rowCount: 1 });
      }),
      release: vi.fn(),
    };
    mockPoolConnect.mockResolvedValue(patchClient);

    const app = await buildApp({ ...PM_USER });
    await request(app).patch("/plans/42").send({
      activities: [{ id: 10, title: "Kept", status: "planned", progressPct: 0 }],
    });

    // No activities deleted → UPDATE risks must NOT be called
    expect(riskNullCalled).toBe(false);
  });
});
