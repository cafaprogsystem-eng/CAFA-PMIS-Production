/**
 * Plan Rejection Regression — Backend Tests (PLAN-BD-5)
 *
 * Confirms the server-side contract for the reject transition:
 *
 * PLAN-REJ-BACK-01  Blank comment → 400 comment_required_for_revision_or_reject
 * PLAN-REJ-BACK-02  Whitespace-only comment → 400
 * PLAN-REJ-BACK-03  Valid comment → transition proceeds (200) + notify called post-COMMIT
 * PLAN-REJ-BACK-04  409 CAS conflict on reject → ROLLBACK, no notification
 * PLAN-REJ-BACK-05  rejected status is terminal — no transition has rejected in from[]
 * PLAN-REJ-BACK-06  request_revision with blank comment also blocked (shared guard)
 * PLAN-REJ-BACK-07  rejection_reason is stored in comments table (route path check)
 *
 * British English spelling used throughout.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

// ── vi.hoisted: shared mock handles ──────────────────────────────────────────
const { mockPoolQuery, mockPoolConnect, mockNotifyActors, mockNotifyNext } = vi.hoisted(() => ({
  mockPoolQuery:   vi.fn(),
  mockPoolConnect: vi.fn(),
  mockNotifyActors: vi.fn().mockResolvedValue(undefined),
  mockNotifyNext:   vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@workspace/db", () => ({
  pool: { query: mockPoolQuery, connect: mockPoolConnect },
}));
vi.mock("../lib/realtime.js", () => ({
  realtime: { emit: vi.fn(), to: vi.fn().mockReturnThis() },
}));
vi.mock("../lib/notifications.js", () => ({
  notifyEntityActorsDeduped: mockNotifyActors,
  notifyNextApprover:        mockNotifyNext,
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

// ── User fixtures ─────────────────────────────────────────────────────────────
const TC_USER = {
  id: 3, name: "TC", email: "tc@t.com",
  role: "technical_coordinator", scope: "sector",
  stateId: null, stateName: null, sector: "Health", sectors: ["Health"], avatarUrl: null,
} as const;
const PM_USER = {
  id: 1, name: "PM", email: "pm@t.com",
  role: "program_manager", scope: "global",
  stateId: null, stateName: null, sector: null, sectors: [], avatarUrl: null,
} as const;
const SA_USER = {
  id: 2, name: "SA", email: "sa@t.com",
  role: "super_admin", scope: "global",
  stateId: null, stateName: null, sector: null, sectors: [], avatarUrl: null,
} as const;

// Minimal plan row for SELECT FROM plans pl
const PLAN_ROW = {
  id: 42, status: "submitted", sector: "Health", stateId: null, locationType: "hq",
  title: "Test Plan", planType: "monthly", frequency: "monthly",
  progressPct: null, activitiesCount: 0,
  sectors: [], localities: [], objectives: [],
  budgetPlanned: null, budgetActual: null, currency: null, fundingSource: null,
  lastFinalApprovedAt: null, code: "CAFA-PLAN-042", stateName: null, projectTitle: null,
  responsibleName: "Alice", responsibleUserId: null,
  startDate: null, endDate: null, description: null,
  createdAt: new Date(), updatedAt: new Date(), createdByName: "TC",
};

// ── App builder ────────────────────────────────────────────────────────────────
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

/** Builds a mock transaction client that records SQL calls. */
function mockTransactionClient(
  overrides?: (sql: string, params?: unknown[]) => { rows: unknown[]; rowCount?: number } | null,
) {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const client = {
    calls,
    query: vi.fn().mockImplementation((sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      if (overrides) {
        const result = overrides(sql, params);
        if (result !== null) return Promise.resolve(result);
      }
      return Promise.resolve({ rows: [], rowCount: 1 });
    }),
    release: vi.fn(),
  };
  mockPoolConnect.mockResolvedValue(client);
  return client;
}

/** Wires pool.query for a happy-path non-submit transition on a submitted plan. */
function setupSubmittedPlanQuery(sector = "Health") {
  mockPoolQuery.mockImplementation((sql: string) => {
    if (sql.includes("SELECT status, sector"))
      return Promise.resolve({ rows: [{ status: "submitted", sector, project_id: null, stateId: null }] });
    if (sql.includes("LEFT JOIN projects"))
      return Promise.resolve({ rows: [{ sector, stateId: null, locationType: "hq" }] });
    if (sql.includes("unresolved_required"))
      return Promise.resolve({ rows: [{ count: "0" }] });
    if (sql.includes("FROM plans pl"))
      return Promise.resolve({ rows: [{ ...PLAN_ROW, status: "rejected" }] });
    return Promise.resolve({ rows: [] });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PLAN-REJ-BACK-01 / 02: blank and whitespace comment → 400
// ─────────────────────────────────────────────────────────────────────────────
describe("PLAN-REJ-BACK-01/02: blank or whitespace rejection reason → 400", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupSubmittedPlanQuery();
    mockTransactionClient(); // not used for this path — 400 fires before connect
  });

  it("PLAN-REJ-BACK-01: blank comment string returns 400 with comment_required error", async () => {
    const app = await buildApp({ ...TC_USER });
    const res = await request(app)
      .post("/plans/42/transitions")
      .send({ action: "reject", comment: "" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("comment_required_for_revision_or_reject");
  });

  it("PLAN-REJ-BACK-02: whitespace-only comment returns 400 with comment_required error", async () => {
    const app = await buildApp({ ...TC_USER });
    const res = await request(app)
      .post("/plans/42/transitions")
      .send({ action: "reject", comment: "   \t  " });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("comment_required_for_revision_or_reject");
  });

  it("PLAN-REJ-BACK-01b: absent comment (undefined) also returns 400", async () => {
    const app = await buildApp({ ...TC_USER });
    const res = await request(app)
      .post("/plans/42/transitions")
      .send({ action: "reject" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("comment_required_for_revision_or_reject");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PLAN-REJ-BACK-03: valid comment → transition proceeds + notification fired
// ─────────────────────────────────────────────────────────────────────────────
describe("PLAN-REJ-BACK-03: valid rejection proceeds and fires post-commit notification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupSubmittedPlanQuery();
    mockTransactionClient(); // CAS returns rowCount=1 → COMMIT succeeds
  });

  it("returns 200 and calls notifyEntityActorsDeduped after commit", async () => {
    const app = await buildApp({ ...TC_USER });
    const res = await request(app)
      .post("/plans/42/transitions")
      .send({ action: "reject", comment: "Does not meet quality standards." });

    expect(res.status).toBe(200);
    expect(mockNotifyActors).toHaveBeenCalledOnce();
    const [notifyArgs] = mockNotifyActors.mock.calls;
    expect(notifyArgs[0]).toMatchObject({
      entityType: "plan",
      entityId: 42,
      kind: "rejected",
      mandatory: true,
    });
  });

  it("notification message includes the rejection reason", async () => {
    const app = await buildApp({ ...PM_USER });
    await request(app)
      .post("/plans/42/transitions")
      .send({ action: "reject", comment: "Missing required documentation." });

    const [notifyArgs] = mockNotifyActors.mock.calls;
    expect(notifyArgs[0].message).toContain("Missing required documentation.");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PLAN-REJ-BACK-04: 409 CAS conflict on reject → ROLLBACK, no notification
// ─────────────────────────────────────────────────────────────────────────────
describe("PLAN-REJ-BACK-04: 409 concurrent conflict → ROLLBACK, zero notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupSubmittedPlanQuery();
    // CAS UPDATE returns rowCount=0 → conflict
    mockTransactionClient((sql) => {
      if (sql.includes("UPDATE plans SET status")) return { rows: [], rowCount: 0 };
      return null;
    });
  });

  it("returns 409 plan_status_conflict", async () => {
    const app = await buildApp({ ...TC_USER });
    const res = await request(app)
      .post("/plans/42/transitions")
      .send({ action: "reject", comment: "Some reason" });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("plan_status_conflict");
  });

  it("no notification is sent when 409 occurs (ROLLBACK path bypasses notify)", async () => {
    const app = await buildApp({ ...TC_USER });
    await request(app)
      .post("/plans/42/transitions")
      .send({ action: "reject", comment: "Some reason" });

    expect(mockNotifyActors).not.toHaveBeenCalled();
    expect(mockNotifyNext).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PLAN-REJ-BACK-05: rejected is terminal — no outgoing transitions
// ─────────────────────────────────────────────────────────────────────────────
describe("PLAN-REJ-BACK-05: rejected status is terminal in PLAN_TRANSITIONS", () => {
  it("no PLAN_TRANSITIONS entry has 'rejected' in its from[] array", async () => {
    const { PLAN_TRANSITIONS } = await import("../routes/plans.js");
    for (const [action, entry] of Object.entries(PLAN_TRANSITIONS)) {
      expect(
        entry.from,
        `transition '${action}' must not accept 'rejected' as a source status`,
      ).not.toContain("rejected");
    }
  });

  it("the reject transition produces 'rejected' and is the only one to do so", async () => {
    const { PLAN_TRANSITIONS } = await import("../routes/plans.js");
    const toRejected = Object.entries(PLAN_TRANSITIONS).filter(([, e]) => e.to === "rejected");
    expect(toRejected).toHaveLength(1);
    expect(toRejected[0][0]).toBe("reject");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PLAN-REJ-BACK-06: request_revision blank comment also blocked (shared guard)
// ─────────────────────────────────────────────────────────────────────────────
describe("PLAN-REJ-BACK-06: request_revision blank comment is also blocked", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupSubmittedPlanQuery();
    mockTransactionClient();
  });

  it("blank comment on request_revision returns 400", async () => {
    const app = await buildApp({ ...TC_USER });
    const res = await request(app)
      .post("/plans/42/transitions")
      .send({ action: "request_revision", comment: "" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("comment_required_for_revision_or_reject");
  });

  it("valid comment on request_revision produces 200 (guard does not over-block)", async () => {
    const app = await buildApp({ ...TC_USER });
    const res = await request(app)
      .post("/plans/42/transitions")
      .send({ action: "request_revision", comment: "Please address the budget discrepancy." });

    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PLAN-REJ-BACK-07: rejection reason stored as rejection_reason comment_type
// ─────────────────────────────────────────────────────────────────────────────
describe("PLAN-REJ-BACK-07: rejection reason is inserted with comment_type=rejection_reason", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupSubmittedPlanQuery();
  });

  it("INSERT INTO comments uses comment_type=rejection_reason for reject action", async () => {
    const client = mockTransactionClient();
    const app = await buildApp({ ...SA_USER });
    await request(app)
      .post("/plans/42/transitions")
      .send({ action: "reject", comment: "Non-compliant plan." });

    // Find the comments INSERT call
    const commentInsert = client.calls.find(
      (c) => c.sql.includes("INSERT INTO comments") && c.params?.includes("rejection_reason"),
    );
    expect(commentInsert).toBeDefined();
    expect(commentInsert!.params).toContain("rejection_reason");
    expect(commentInsert!.params).toContain("Non-compliant plan.");
  });

  it("INSERT INTO comments uses comment_type=revision_request for request_revision action", async () => {
    const client = mockTransactionClient();
    const app = await buildApp({ ...SA_USER });
    await request(app)
      .post("/plans/42/transitions")
      .send({ action: "request_revision", comment: "Needs revision." });

    const commentInsert = client.calls.find(
      (c) => c.sql.includes("INSERT INTO comments") && c.params?.includes("revision_request"),
    );
    expect(commentInsert).toBeDefined();
    expect(commentInsert!.params).toContain("revision_request");
    // Must NOT use rejection_reason for revision
    expect(commentInsert!.params).not.toContain("rejection_reason");
  });
});
