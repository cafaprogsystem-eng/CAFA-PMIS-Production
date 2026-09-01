/**
 * PROJ-INDICATOR-ACHIEVED — PATCH /projects/:projectId must not silently zero
 * out recorded indicator progress.
 *
 * Indicators (like Outputs) carry no client-supplied id in the request body,
 * so — unlike Activities, which are matched by id and preserve budget_spent/
 * progress_pct — every PATCH used to unconditionally DELETE and reinsert all
 * indicators with achieved defaulting to 0. Editing a project's title (or
 * any unrelated field) after an indicator had recorded progress silently
 * wiped that progress. The fix reads the prior (code -> achieved) map before
 * the delete and carries it forward by matching on the deterministic
 * position-based `code` ("IND-{output}.{n}").
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

const { mockQuery, mockClientQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockClientQuery: vi.fn(),
}));
const mockClient = { query: mockClientQuery, release: vi.fn() };

vi.mock("@workspace/db", () => ({
  pool: { query: mockQuery, connect: vi.fn().mockResolvedValue(mockClient) },
}));
vi.mock("../lib/realtime.js", () => ({
  realtime: { emit: vi.fn(), to: vi.fn().mockReturnThis(), broadcastUpdate: vi.fn() },
}));
vi.mock("../lib/notifications.js", () => ({
  notifyEntityActors: vi.fn(), notifyEntityActorsDeduped: vi.fn(), notifyNextApprover: vi.fn(),
  createNotification: vi.fn(), createNotificationDeduped: vi.fn(), notifyByRole: vi.fn(),
}));
vi.mock("../middlewares/currentUser.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middlewares/currentUser")>();
  return { ...actual, logAudit: vi.fn() };
});

const projectsRouter = (await import("./projects")).default;

const PM_USER = {
  id: 1, name: "PM", email: "pm@test.test", role: "program_manager", roleLabel: "PM",
  scope: "hq", stateId: null, stateName: null, sector: null, avatarUrl: null, sectors: null,
};

function appAs() {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.currentUser = PM_USER as never;
    next();
  });
  app.use(projectsRouter);
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: "internal", detail: String(err) });
  });
  return request(app);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockImplementation(async (sql: string) => {
    if (sql.includes("project_states ps") || sql.includes("project_assignments pa")) {
      return { rows: [{ "?column?": 1 }], rowCount: 1 };
    }
    if (sql.includes("FROM project_documents")) return { rows: [], rowCount: 0 };
    if (sql.includes("FROM states")) {
      return { rows: [{ id: 1, name: "Khartoum", operationalStatus: "active", officeStatus: "present" }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  mockClientQuery.mockImplementation(async (sql: string) => {
    if (sql.includes("BEGIN") || sql.includes("COMMIT")) return { rows: [], rowCount: 0 };
    if (sql.includes("SELECT status, sector")) {
      return { rows: [{ status: "draft", sector: "Health", sectors: [], has_hq_operations: true, state_ids: [] }], rowCount: 1 };
    }
    if (sql.includes("SELECT budget FROM projects")) return { rows: [{ budget: 0 }], rowCount: 1 };
    if (sql.includes("SELECT id, budget_spent, progress_pct")) return { rows: [], rowCount: 0 };
    if (sql.includes("SELECT code, achieved FROM indicators")) {
      // Prior state: the project already has one indicator at IND-1.1 with
      // achieved = 55, recorded before this PATCH.
      return { rows: [{ code: "IND-1.1", achieved: "55" }], rowCount: 1 };
    }
    if (sql.startsWith("UPDATE projects SET")) return { rows: [], rowCount: 1 };
    if (sql.startsWith("DELETE")) return { rows: [], rowCount: 0 };
    if (sql.includes("INSERT INTO outputs")) return { rows: [{ id: 999 }], rowCount: 1 };
    if (sql.includes("INSERT INTO indicators")) return { rows: [{ id: 888 }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
});

function patchBody(indicators: Array<{ title: string }>) {
  return {
    title: "Test Project",
    description: "A".repeat(60),
    agreementNumber: "AGR-001",
    sectors: ["Health"],
    donor: "UNICEF",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    stateIds: [1],
    hasHqOperations: false,
    reportingFrequency: "monthly",
    outputs: [
      {
        title: "Output One",
        indicators: indicators.map((i) => ({ title: i.title, unit: "count", target: 100 })),
        activities: [],
      },
    ],
  };
}

describe("PROJ-INDICATOR-ACHIEVED — carries prior achieved forward by position-based code", () => {
  it("preserves achieved=55 for the indicator at the same position (IND-1.1) after an unrelated edit", async () => {
    const res = await appAs().patch("/projects/1").send(patchBody([{ title: "Updated Indicator Title" }]));

    expect(res.status).toBe(200);
    const insertCall = mockClientQuery.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO indicators"));
    expect(insertCall).toBeDefined();
    const [sql, params] = insertCall as [string, unknown[]];
    expect(sql).toContain("achieved");
    // Params: project_id, output_id, code, title, unit, target, sector, achieved
    expect(params[params.length - 1]).toBe(55);
  });

  it("defaults achieved to 0 for a newly-added second indicator with no prior record", async () => {
    const res = await appAs()
      .patch("/projects/1")
      .send(patchBody([{ title: "First indicator" }, { title: "Brand new second indicator" }]));

    expect(res.status).toBe(200);
    const insertCalls = mockClientQuery.mock.calls.filter(([sql]) => String(sql).includes("INSERT INTO indicators"));
    expect(insertCalls).toHaveLength(2);
    const secondParams = insertCalls[1][1] as unknown[];
    expect(secondParams[secondParams.length - 1]).toBe(0);
  });
});
