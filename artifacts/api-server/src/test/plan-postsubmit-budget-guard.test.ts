/**
 * PLAN-POSTSUB-BUD — Budget-invariant re-check on ordinary post-submission PATCHes.
 *
 * Prior to this fix, validatePlanBudgetReadiness ("activities total ≤ plan budget")
 * only ran at creation/closeRegistration and at the submit transition. A plain
 * PATCH that changed budgetPlanned, currency, or activities once a Plan was past
 * Draft (already submitted) skipped it entirely, letting the invariant silently
 * break after submission. PATCH /plans/:planId now re-runs the same shared check
 * — using the row already locked FOR UPDATE for budget-affecting edits — whenever
 * the Plan is not in Draft status and closeRegistration was not explicitly
 * requested (which already runs the fuller Save & Finish validation).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

const { mockPoolQuery, mockPoolConnect } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockPoolConnect: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  pool: { query: mockPoolQuery, connect: mockPoolConnect },
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

const PM_USER = { id: 1, name: "PM", email: "pm@t.com", role: "program_manager", roleLabel: "Programme Manager", scope: "global", stateId: null, stateName: null, sector: null, sectors: [], avatarUrl: null } as const;

const PLAN_ROW = {
  id: 42, status: "technically_approved", sector: "Health", stateId: null, locationType: "hq",
  title: "Test Plan", planType: "monthly", frequency: "monthly",
  progressPct: null, activitiesCount: 0,
  sectors: [], localities: [], objectives: [],
  budgetPlanned: 100, budgetActual: null, currency: "USD", fundingSource: null,
  lastFinalApprovedAt: null, code: "CAFA-PLAN-042", stateName: null, projectTitle: null,
  responsibleName: "Alice", responsibleUserId: null,
  startDate: null, endDate: null, description: null,
  createdAt: new Date(), updatedAt: new Date(), createdByName: "PM",
};

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

/** Wires the pre-transaction "before" lookup and the final getPlanById read. */
function setupBeforeQuery(status: string) {
  mockPoolQuery.mockImplementation((sql: string) => {
    if (sql.includes("SELECT status, last_final_approved_at")) {
      return Promise.resolve({
        rows: [{ status, lastFinalApprovedAt: null, start_date: null, end_date: null, title: "Test Plan", responsible_user_id: null }],
      });
    }
    if (sql.includes("FROM plans pl")) return Promise.resolve({ rows: [{ ...PLAN_ROW, status }] });
    return Promise.resolve({ rows: [] });
  });
}

/**
 * Wires the transaction client used inside the PATCH handler:
 *  - the plan-row FOR UPDATE lock (status/currency/budget_planned)
 *  - the persisted-activities budget read (used when body.activities is omitted)
 */
function setupPatchClient(opts: { status: string; lockedBudgetPlanned: number; persistedActivityTotal: number }) {
  const client = {
    query: vi.fn().mockImplementation((sql: string) => {
      if (sql.includes("FROM plans WHERE id = $1 FOR UPDATE")) {
        return Promise.resolve({
          rows: [{
            start_date: null, end_date: null, responsible_user_id: null,
            status: opts.status, last_final_approved_at: null, updated_at: new Date(),
            currency: "USD", budget_planned: opts.lockedBudgetPlanned,
          }],
        });
      }
      if (sql.includes("SELECT budget_planned FROM plan_activities WHERE plan_id = $1")) {
        return Promise.resolve({ rows: [{ budget_planned: opts.persistedActivityTotal }] });
      }
      return Promise.resolve({ rows: [], rowCount: 1 });
    }),
    release: vi.fn(),
  };
  mockPoolConnect.mockResolvedValue(client);
  return client;
}

describe("PLAN-POSTSUB-BUD: budget invariant re-checked on ordinary post-submission PATCHes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("PLAN-POSTSUB-BUD-01: lowering budgetPlanned below the existing activities total after submission is rejected", async () => {
    setupBeforeQuery("technically_approved");
    setupPatchClient({ status: "technically_approved", lockedBudgetPlanned: 100, persistedActivityTotal: 80 });

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).patch("/plans/42").send({ budgetPlanned: 50 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("activity_budget_exceeds_plan");
  });

  it("PLAN-POSTSUB-BUD-02: replacing activities with a total above the locked plan budget after submission is rejected", async () => {
    setupBeforeQuery("technically_approved");
    setupPatchClient({ status: "technically_approved", lockedBudgetPlanned: 100, persistedActivityTotal: 0 });

    const app = await buildApp({ ...PM_USER });
    const res = await request(app)
      .patch("/plans/42")
      .send({ activities: [{ title: "New activity", budgetPlanned: 150 }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("activity_budget_exceeds_plan");
  });

  it("PLAN-POSTSUB-BUD-03: the same edit is NOT blocked while the Plan is still in Draft", async () => {
    setupBeforeQuery("draft");
    setupPatchClient({ status: "draft", lockedBudgetPlanned: 100, persistedActivityTotal: 80 });

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).patch("/plans/42").send({ budgetPlanned: 50 });

    expect(res.status).not.toBe(400);
  });

  it("PLAN-POSTSUB-BUD-04: a PATCH touching only an unrelated field after submission is not subjected to the budget check", async () => {
    setupBeforeQuery("technically_approved");
    setupPatchClient({ status: "technically_approved", lockedBudgetPlanned: 100, persistedActivityTotal: 999 });

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).patch("/plans/42").send({ title: "Renamed plan" });

    expect(res.status).not.toBe(400);
  });

  it("PLAN-POSTSUB-BUD-05: a compliant post-submission budget edit still succeeds", async () => {
    setupBeforeQuery("technically_approved");
    setupPatchClient({ status: "technically_approved", lockedBudgetPlanned: 100, persistedActivityTotal: 80 });

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).patch("/plans/42").send({ budgetPlanned: 200 });

    expect(res.status).not.toBe(400);
  });
});
