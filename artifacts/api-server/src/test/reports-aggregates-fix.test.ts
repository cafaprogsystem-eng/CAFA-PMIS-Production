/**
 * REPORTS-AGGREGATES-FIX — GET /reports/:reportId/aggregates used to query
 * `project_budgets`, a table that was never created by any tracked migration
 * or the initial schema — every real call threw. The canonical project-budget
 * source used everywhere else (GET /projects/:id/budget, dashboard.ts) is
 * activities.budget_planned/budget_spent, which this endpoint now uses too.
 * burnRatePct also now follows the established null-vs-zero convention
 * (budget-presentation.ts's projectBurnRate): null, not 0, when there's no
 * valid planned amount to divide by.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

const mockPoolQuery = vi.fn();

vi.mock("@workspace/db", () => ({
  pool: { query: mockPoolQuery, connect: vi.fn() },
}));
vi.mock("../lib/realtime.js", () => ({
  realtime: { emit: vi.fn(), to: vi.fn().mockReturnThis() },
}));
vi.mock("../lib/notifications.js", () => ({
  notifyEntityActorsDeduped: vi.fn().mockResolvedValue(undefined),
  notifyNextApprover:        vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../middlewares/currentUser.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../middlewares/currentUser.js")>();
  return {
    ...original,
    logAudit:       vi.fn().mockResolvedValue(undefined),
    requirePerm:    () => (_req: Request, _res: Response, next: NextFunction) => next(),
  };
});

beforeEach(() => {
  mockPoolQuery.mockReset();
});

const PM_USER = { id: 1, name: "PM", role: "program_manager", stateId: null, sector: null, sectors: [] as string[] };

async function buildApp(user: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { currentUser: typeof user }).currentUser = user;
    next();
  });
  const { default: reportsRouter } = await import("../routes/reports.js");
  app.use("/", reportsRouter);
  return app;
}

function setupAggregateQueries(opts: { planned: number; actual: number }) {
  mockPoolQuery.mockImplementation((sql: string) => {
    if (sql.includes("FROM reports r") && sql.includes("LEFT JOIN projects")) {
      return Promise.resolve({ rows: [{ reportType: "project", projectId: 7, projectSector: "Health", activitySector: null, effectiveSector: "Health" }] });
    }
    if (sql.includes("SELECT project_id AS \"projectId\" FROM reports WHERE id = $1")) {
      return Promise.resolve({ rows: [{ projectId: 7 }] });
    }
    if (sql.includes("FROM beneficiaries WHERE project_id")) {
      return Promise.resolve({ rows: [{ male: "0", female: "0", boys: "0", girls: "0" }] });
    }
    if (sql.includes("FROM activities WHERE project_id") && sql.includes("budget_planned")) {
      return Promise.resolve({ rows: [{ planned: String(opts.planned), actual: String(opts.actual) }] });
    }
    if (sql.includes("FROM activities a WHERE a.project_id")) {
      return Promise.resolve({ rows: [] });
    }
    if (sql.includes("FROM indicators i")) {
      return Promise.resolve({ rows: [] });
    }
    if (sql.includes("FROM risks")) {
      return Promise.resolve({ rows: [] });
    }
    if (sql.includes("FROM projects WHERE id = $1")) {
      return Promise.resolve({ rows: [{ title: "Test Project" }] });
    }
    return Promise.resolve({ rows: [] });
  });
}

describe("REPORTS-AGGREGATES-FIX: GET /reports/:reportId/aggregates uses activities, not project_budgets", () => {
  it("never queries the nonexistent project_budgets table", async () => {
    setupAggregateQueries({ planned: 1000, actual: 400 });
    const app = await buildApp(PM_USER);
    const res = await request(app).get("/reports/5/aggregates");

    expect(res.status).toBe(200);
    expect(mockPoolQuery.mock.calls.some(([sql]) => String(sql).includes("project_budgets"))).toBe(false);
  });

  it("sums activities.budget_planned/budget_spent for the linked project", async () => {
    setupAggregateQueries({ planned: 1000, actual: 400 });
    const app = await buildApp(PM_USER);
    const res = await request(app).get("/reports/5/aggregates");

    expect(res.body.budget).toEqual({ planned: 1000, actual: 400, remaining: 600, burnRatePct: 40 });
  });

  it("returns null (not 0) burnRatePct when planned is zero", async () => {
    setupAggregateQueries({ planned: 0, actual: 0 });
    const app = await buildApp(PM_USER);
    const res = await request(app).get("/reports/5/aggregates");

    expect(res.body.budget.burnRatePct).toBeNull();
  });
});
