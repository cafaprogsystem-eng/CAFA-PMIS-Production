/**
 * PLAN-STATE-RACE — a sector reassignment (sector/sectors/projectId) is
 * re-validated INSIDE the transaction, against the row as it actually
 * commits, via getPlanMeta(planId, client) + assertAnySectorAllowed. A stateId
 * reassignment was only checked BEFORE the transaction, against a "meta"
 * snapshot read moments earlier via plain pool.query — and, notably, that
 * pre-transaction check is skipped entirely whenever the submitted stateId
 * equals the stale meta's stateId (treated as "unchanged"), even though the
 * SET clause still unconditionally writes state_id whenever body.stateId is
 * present. stateId changes now get the same inside-the-transaction guard
 * sector changes already had: assertStateAllowed is re-run against the row as
 * read through the transaction client, rolling back on failure.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

const { mockPoolQuery, mockPoolConnect } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockPoolConnect: vi.fn(),
}));

vi.mock("@workspace/db", () => ({ pool: { query: mockPoolQuery, connect: mockPoolConnect } }));
vi.mock("../lib/realtime.js", () => ({ realtime: { emit: vi.fn(), to: vi.fn().mockReturnThis() } }));
vi.mock("../lib/notifications.js", () => ({
  notifyEntityActorsDeduped: vi.fn().mockResolvedValue(undefined),
  notifyNextApprover:        vi.fn().mockResolvedValue(undefined),
  createNotification:        vi.fn().mockResolvedValue(undefined),
  notifyEntityActors:        vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../lib/objectStorage.js", () => ({ deleteStorageObjectSafely: vi.fn().mockResolvedValue({ deleted: true }), objectStorageService: {} }));
vi.mock("../middlewares/currentUser.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../middlewares/currentUser.js")>();
  return {
    ...original,
    logAudit:          vi.fn().mockResolvedValue(undefined),
    requirePerm:       () => (_req: Request, _res: Response, next: NextFunction) => next(),
    attachCurrentUser: (_req: Request, _res: Response, next: NextFunction) => next(),
  };
});

const SPO_USER = { id: 4, name: "SPO", email: "spo@t.com", role: "state_program_officer", roleLabel: "State Programme Officer", scope: "state", stateId: 5, stateName: "Khartoum", sector: null, sectors: [], avatarUrl: null } as const;

const PLAN_ROW = {
  id: 42, status: "draft", sector: "Health", stateId: 5, locationType: "state",
  title: "Test Plan", planType: "monthly", frequency: "monthly",
  progressPct: null, activitiesCount: 0,
  sectors: ["Health"], localities: [], objectives: [],
  budgetPlanned: null, budgetActual: null, currency: null, fundingSource: null,
  lastFinalApprovedAt: null, code: "CAFA-PLAN-KH-042", stateName: "Khartoum", projectTitle: null,
  responsibleName: "Alice", responsibleUserId: null,
  startDate: null, endDate: null, description: null,
  createdAt: new Date(), updatedAt: new Date(), createdByName: "SPO",
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

function setupPoolQuery() {
  mockPoolQuery.mockImplementation((sql: string) => {
    if (sql.includes("SELECT status, last_final_approved_at")) {
      return Promise.resolve({
        rows: [{ status: "draft", lastFinalApprovedAt: null, start_date: null, end_date: null, title: "Test Plan", responsible_user_id: null }],
      });
    }
    if (sql.includes("FROM plans pl") && sql.includes("LEFT JOIN projects")) {
      return Promise.resolve({ rows: [PLAN_ROW] });
    }
    if (sql.includes("createdByName")) {
      return Promise.resolve({ rows: [{ description: null, objectives: [], createdById: 1, createdByName: "SPO", createdAt: new Date(), updatedAt: new Date() }] });
    }
    return Promise.resolve({ rows: [] });
  });
}

describe("PLAN-STATE-RACE: stateId is re-verified inside the transaction, not just against the stale pre-transaction snapshot", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rolls back and 403s when the row read through the transaction client no longer belongs to the actor's State", async () => {
    // SPO (State 5) submits body.stateId=5 — identical to the stale pre-transaction
    // `meta.stateId`, so the OLD pre-transaction guard treated this as "unchanged"
    // and skipped its own assertStateAllowed/assertActiveState calls entirely, even
    // though `set("state_id", 5)` still runs unconditionally. The transaction-client
    // re-read (getPlanMeta(planId, client), the same helper the sector-reassignment
    // guard already used) is where the actual authorisation now happens: this test
    // has it return State 99, which the SPO is never authorised for.
    setupPoolQuery();
    let rolledBack = false;
    const client = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql === "ROLLBACK") { rolledBack = true; return Promise.resolve({ rows: [] }); }
        if (sql.includes("FOR UPDATE")) {
          return Promise.resolve({ rows: [{ start_date: null, end_date: null, responsible_user_id: null, status: "draft", last_final_approved_at: null, updated_at: new Date(), currency: null, budget_planned: null }] });
        }
        if (sql.includes("FROM plans pl") && sql.includes("LEFT JOIN projects")) {
          return Promise.resolve({ rows: [{ sector: "Health", sectors: ["Health"], stateId: 99, locationType: "state" }] });
        }
        return Promise.resolve({ rows: [], rowCount: 1 });
      }),
      release: vi.fn(),
    };
    mockPoolConnect.mockResolvedValue(client);

    const app = await buildApp({ ...SPO_USER });
    const res = await request(app).patch("/plans/42").send({ stateId: 5 });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("state_forbidden");
    expect(rolledBack).toBe(true);
  });

  it("a stateId submission that stays within the actor's own scope still commits", async () => {
    setupPoolQuery();
    const client = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes("FOR UPDATE")) {
          return Promise.resolve({ rows: [{ start_date: null, end_date: null, responsible_user_id: null, status: "draft", last_final_approved_at: null, updated_at: new Date(), currency: null, budget_planned: null }] });
        }
        if (sql.includes("FROM plans pl") && sql.includes("LEFT JOIN projects")) {
          return Promise.resolve({ rows: [{ sector: "Health", sectors: ["Health"], stateId: 5, locationType: "state" }] });
        }
        return Promise.resolve({ rows: [], rowCount: 1 });
      }),
      release: vi.fn(),
    };
    mockPoolConnect.mockResolvedValue(client);

    const app = await buildApp({ ...SPO_USER });
    const res = await request(app).patch("/plans/42").send({ stateId: 5 });

    expect(res.status).not.toBe(403);
  });

  it("a PATCH that does not touch stateId at all never runs the post-transaction State re-check", async () => {
    setupPoolQuery();
    const queriedTables: string[] = [];
    const client = {
      query: vi.fn().mockImplementation((sql: string) => {
        queriedTables.push(sql);
        return Promise.resolve({ rows: [], rowCount: 1 });
      }),
      release: vi.fn(),
    };
    mockPoolConnect.mockResolvedValue(client);

    const app = await buildApp({ ...SPO_USER });
    const res = await request(app).patch("/plans/42").send({ title: "Renamed" });

    expect(res.status).not.toBe(403);
    expect(queriedTables.some((sql) => sql.includes("FROM plans pl") && sql.includes("LEFT JOIN projects"))).toBe(false);
  });
});
