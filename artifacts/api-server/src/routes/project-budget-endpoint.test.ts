/**
 * PROJ-BUDGET-ENDPOINT — GET /projects/:projectId/budget
 *
 * 1. Total "spent" must include ALL activities, not just those grouped under
 *    an existing output. activities.output_id is nullable by design
 *    (standalone activities). Before this fix, a standalone activity's spend
 *    was invisible to this endpoint's total even though every Dashboard
 *    budget query sums ALL activities for the project — so the same project
 *    showed a lower "spent" and a healthier burn rate here than on the
 *    Dashboard.
 * 2. Burn rate must be null (not 0) when its planned amount is 0 — a
 *    manufactured 0% would misread as "fully unspent" rather than "no
 *    budget recorded". Matches the convention already used throughout
 *    dashboard.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

const { mockPoolQuery } = vi.hoisted(() => ({ mockPoolQuery: vi.fn() }));

vi.mock("@workspace/db", () => ({ pool: { query: mockPoolQuery, connect: vi.fn() } }));
vi.mock("../lib/realtime.js", () => ({
  realtime: { emit: vi.fn(), to: vi.fn().mockReturnThis(), broadcastUpdate: vi.fn() },
}));
vi.mock("../lib/notifications.js", () => ({
  notifyEntityActors: vi.fn(), notifyEntityActorsDeduped: vi.fn(), notifyNextApprover: vi.fn(),
  createNotification: vi.fn(), createNotificationDeduped: vi.fn(), notifyByRole: vi.fn(),
}));
vi.mock("../middlewares/currentUser.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middlewares/currentUser")>();
  return { ...actual, logAudit: vi.fn(), requirePerm: () => (_req: Request, _res: Response, next: NextFunction) => next() };
});

const projectsRouter = (await import("./projects")).default;

const PM_USER = {
  id: 1, name: "PM", email: "pm@test.test", role: "program_manager", roleLabel: "PM",
  scope: "hq", stateId: null, stateName: null, sector: null, avatarUrl: null, sectors: null,
};

function appAs(user: typeof PM_USER) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.currentUser = user as never;
    next();
  });
  app.use(projectsRouter);
  return request(app);
}

function stubBudgetQueries(opts: {
  budgetTotal: number;
  sector?: string;
  outputs: { id: number; code: string; title: string }[];
  activities: { id: number; outputId: number | null; code: string; title: string; planned: number; spent: number }[];
}) {
  mockPoolQuery.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM projects WHERE id = $1 AND deleted_at IS NULL")) {
      return { rows: [{ total: opts.budgetTotal, sector: opts.sector ?? null, sectors: [] }], rowCount: 1 };
    }
    if (sql.includes("FROM outputs WHERE project_id")) {
      return { rows: opts.outputs, rowCount: opts.outputs.length };
    }
    if (sql.includes("FROM activities WHERE project_id")) {
      return {
        rows: opts.activities.map((a) => ({
          id: a.id, outputId: a.outputId, code: a.code, title: a.title,
          planned: a.planned, spent: a.spent, plannedStart: null, plannedEnd: null,
        })),
        rowCount: opts.activities.length,
      };
    }
    return { rows: [], rowCount: 0 };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PROJ-BUDGET-ENDPOINT — total spend includes standalone (no-output) activities", () => {
  it("sums an activity with output_id = null into the total, not just output-linked ones", async () => {
    stubBudgetQueries({
      budgetTotal: 100_000,
      outputs: [{ id: 10, code: "OUT-1", title: "Output One" }],
      activities: [
        { id: 1, outputId: 10, code: "ACT-1", title: "Linked activity", planned: 50_000, spent: 30_000 },
        { id: 2, outputId: null, code: "ACT-2", title: "Standalone activity", planned: 20_000, spent: 20_000 },
      ],
    });

    const res = await appAs(PM_USER).get("/projects/1/budget");

    expect(res.status).toBe(200);
    // 30,000 (linked) + 20,000 (standalone) — the standalone activity must
    // not be silently dropped from the total.
    expect(res.body.spent).toBe(50_000);
    expect(res.body.remaining).toBe(50_000);
    expect(res.body.burnRatePct).toBe(50);
  });
});

describe("PROJ-BUDGET-ENDPOINT — burn rate is null (not 0) when planned/total is zero", () => {
  it("top-level burnRatePct is null when the project has no budget_total", async () => {
    stubBudgetQueries({
      budgetTotal: 0,
      outputs: [],
      activities: [],
    });

    const res = await appAs(PM_USER).get("/projects/1/budget");

    expect(res.status).toBe(200);
    expect(res.body.burnRatePct).toBeNull();
  });

  it("per-output and per-activity burnRatePct are null when their own planned amount is zero", async () => {
    stubBudgetQueries({
      budgetTotal: 10_000,
      outputs: [{ id: 10, code: "OUT-1", title: "Zero-planned output" }],
      activities: [
        { id: 1, outputId: 10, code: "ACT-1", title: "Zero-planned activity", planned: 0, spent: 0 },
      ],
    });

    const res = await appAs(PM_USER).get("/projects/1/budget");

    expect(res.status).toBe(200);
    expect(res.body.lines[0].burnRatePct).toBeNull();
    expect(res.body.lines[0].children[0].burnRatePct).toBeNull();
    // A zero-planned line must not trigger the "under-utilized" alert —
    // there's nothing to under-utilize when nothing was ever planned.
    expect(res.body.alerts).toEqual([]);
  });
});
