/**
 * PLAN-CODE-RACE — generatePlanCode/generateHqPlanCode previously read the
 * MAX+1 code sequence via plain `pool.query` OUTSIDE any transaction, with no
 * lock and no unique DB constraint on plans.code. Two concurrent POST /plans
 * requests could both compute the same "next" sequence number and persist two
 * plans sharing one code. This mirrors the fix already applied to
 * projects.code (PRJ-008/PRJ-018): a transaction-scoped pg_advisory_xact_lock,
 * acquired via the same client that performs the INSERT, serialises code
 * allocation per code-namespace (per-State, or HQ). Migration 061 adds a
 * plans_code_unique DB constraint as a defence-in-depth backstop, with the
 * matching 23505 → 409 translation at the catch site.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MIGRATIONS } from "../lib/run-migrations";

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

const PLAN_SUMMARY_ROW = {
  id: 77, status: "draft", sector: "Health", stateId: 5, locationType: null,
  title: "Test Plan", planType: "action", frequency: "monthly",
  progressPct: null, activitiesCount: 0,
  sectors: [], localities: [], objectives: [],
  budgetPlanned: null, budgetActual: null, currency: null, fundingSource: null,
  lastFinalApprovedAt: null, code: "CAFA-PLAN-KH-001", stateName: "Khartoum", projectTitle: null,
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

function defaultPoolResponses(sql: string) {
  if (sql.includes("FROM states") && sql.includes("WHERE id")) {
    return Promise.resolve({ rows: [{ id: 5, name: "Khartoum", nameAr: "الخرطوم", code: "KH", operationalStatus: "active", officeStatus: "present" }] });
  }
  if (sql.includes("FROM plans pl") && sql.includes("LEFT JOIN projects")) {
    return Promise.resolve({ rows: [PLAN_SUMMARY_ROW] });
  }
  if (sql.includes("createdByName") || (sql.includes("FROM plans pl") && sql.includes("LEFT JOIN users"))) {
    return Promise.resolve({ rows: [{ description: null, objectives: [], createdById: 1, createdByName: "PM", createdAt: new Date(), updatedAt: new Date() }] });
  }
  if (sql.includes("FROM plan_activities")) return Promise.resolve({ rows: [] });
  if (sql.includes("FROM risks")) return Promise.resolve({ rows: [] });
  return Promise.resolve({ rows: [], rowCount: 0 });
}

/** Records every query issued via the transaction client, in call order. */
function mockTransactionClient(overrides?: (sql: string) => { rows: unknown[]; rowCount?: number } | null) {
  const calls: string[] = [];
  const client = {
    calls,
    query: vi.fn().mockImplementation((sql: string) => {
      calls.push(sql);
      if (overrides) {
        const result = overrides(sql);
        if (result !== null) return Promise.resolve(result);
      }
      return Promise.resolve({ rows: [], rowCount: 1 });
    }),
    release: vi.fn(),
  };
  mockPoolConnect.mockResolvedValue(client);
  return client;
}

describe("PLAN-CODE-RACE: plan code allocation is serialised inside the create transaction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("acquires a state-scoped advisory lock via the transaction client, before the INSERT, for a State plan", async () => {
    const client = mockTransactionClient((sql) => {
      if (sql.includes("FROM states WHERE id")) return { rows: [{ code: "KH" }] };
      if (sql.includes("FROM plans WHERE code LIKE")) return { rows: [] };
      if (sql.includes("INSERT INTO plans")) return { rows: [{ id: 77 }], rowCount: 1 };
      return null;
    });
    mockPoolQuery.mockImplementation(defaultPoolResponses);

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans").send({
      title: "Race Test", planType: "action", stateId: 5, sectors: ["Health"], responsibleName: "Alice",
    });

    expect(res.status).toBeLessThan(400);
    const lockIdx = client.calls.findIndex((sql) => sql.includes("pg_advisory_xact_lock") && !sql.includes("CASE"));
    const insertIdx = client.calls.findIndex((sql) => sql.includes("INSERT INTO plans"));
    expect(lockIdx).toBeGreaterThanOrEqual(0);
    expect(insertIdx).toBeGreaterThan(lockIdx);
    // The lock must be acquired via the transaction client (client.query), not pool.query.
    expect(mockPoolQuery.mock.calls.some(([sql]) => String(sql).includes("pg_advisory_xact_lock"))).toBe(false);
  });

  it("acquires the HQ-scoped advisory lock (not the per-State one) for an HQ plan", async () => {
    let lockKey: string | undefined;
    const client = mockTransactionClient((sql) => {
      if (sql.includes("FROM plans WHERE code LIKE 'CAFA-PLAN-HQ-%'")) return { rows: [] };
      if (sql.includes("INSERT INTO plans")) return { rows: [{ id: 78 }], rowCount: 1 };
      return null;
    });
    // Capture the lock key parameter directly (mockTransactionClient only records SQL text).
    client.query.mockImplementation((sql: string, params?: unknown[]) => {
      client.calls.push(sql);
      if (sql.includes("pg_advisory_xact_lock") && !sql.includes("CASE")) {
        lockKey = Array.isArray(params) ? String(params[0]) : undefined;
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes("FROM plans WHERE code LIKE 'CAFA-PLAN-HQ-%'")) return Promise.resolve({ rows: [] });
      if (sql.includes("INSERT INTO plans")) return Promise.resolve({ rows: [{ id: 78 }], rowCount: 1 });
      return Promise.resolve({ rows: [], rowCount: 1 });
    });
    mockPoolQuery.mockImplementation(defaultPoolResponses);

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans").send({
      title: "HQ Race Test", planType: "action", locationType: "hq", sectors: ["Health"], responsibleName: "Alice",
    });

    expect(res.status).toBeLessThan(400);
    expect(lockKey).toBe("plan_code_HQ");
  });

  it("translates a plans_code_unique violation into a clean 409, not a raw SQL error", async () => {
    const client = mockTransactionClient((sql) => {
      if (sql.includes("FROM states WHERE id")) return { rows: [{ code: "KH" }] };
      if (sql.includes("FROM plans WHERE code LIKE")) return { rows: [] };
      if (sql.includes("INSERT INTO plans")) {
        const err = Object.assign(new Error("duplicate key value violates unique constraint"), {
          code: "23505",
          constraint: "plans_code_unique",
        });
        throw err;
      }
      return null;
    });
    mockPoolQuery.mockImplementation(defaultPoolResponses);

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans").send({
      title: "Conflict Test", planType: "action", stateId: 5, sectors: ["Health"], responsibleName: "Alice",
    });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("plan_code_conflict");
  });
});

describe("PLAN-CODE-RACE: migration 061 adds plans_code_unique idempotently", () => {
  it("MIGRATIONS includes an entry that guards ADD CONSTRAINT with an existence check", () => {
    const migration = MIGRATIONS.find((m) => m.name === "061_plans_code_unique");
    expect(migration).toBeDefined();
    expect(migration!.sql).toContain("plans_code_unique");
    expect(migration!.sql).toContain("ADD CONSTRAINT plans_code_unique UNIQUE (code)");
    expect(migration!.sql).toContain("IF NOT EXISTS");
  });
});

describe("PLAN-CODE-RACE: source-level guard against future regressions", () => {
  const plansSrc = readFileSync(resolve(__dirname, "../routes/plans.ts"), "utf8");

  it("generatePlanCode and generateHqPlanCode take a transaction client and lock before reading the sequence", () => {
    expect(plansSrc).toMatch(/async function generatePlanCode\(client: PlanCodeClient, stateId: number\)/);
    expect(plansSrc).toMatch(/async function generateHqPlanCode\(client: PlanCodeClient\)/);
  });

  it("the code generators are called after BEGIN, using the transaction client", () => {
    expect(plansSrc).toContain("generateHqPlanCode(client) : await generatePlanCode(client, stateId)");
  });
});
