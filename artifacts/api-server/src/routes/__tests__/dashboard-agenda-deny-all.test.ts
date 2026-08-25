import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(async () => ({ rows: [] })),
}));
vi.mock("@workspace/db", () => ({ pool: { query: mockQuery } }));

const dashboardRouter = (await import("../dashboard")).default;

function appForStateUserWithoutAssignment() {
  const app = express();
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.currentUser = {
      id: 19, name: "Unassigned SOM", email: "som@example.test",
      role: "state_office_manager", roleLabel: "State Office Manager", scope: "state",
      stateId: null, stateName: null, sector: null, sectors: null, avatarUrl: null,
    };
    next();
  });
  app.use(dashboardRouter);
  return app;
}

function appForAssignedSpo() {
  const app = express();
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.currentUser = {
      id: 20, name: "Assigned SPO", email: "spo@example.test",
      role: "state_program_officer", roleLabel: "State Programme Officer", scope: "state",
      stateId: 7, stateName: "Test State", sector: null, sectors: null, avatarUrl: null,
    };
    next();
  });
  app.use(dashboardRouter);
  return app;
}

describe("dashboard agenda fail-closed state scope", () => {
  it("applies deny-all to all hand-built agenda and operational queue queries", async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const response = await request(appForStateUserWithoutAssignment()).get("/dashboard/agenda").expect(200);

    expect(response.body).toEqual({ items: [] });
    const sql = (mockQuery.mock.calls as unknown[][]).map((call) => String(call[0] ?? ""));
    expect(sql.find((statement) => statement.includes("FROM projects p"))).toContain("FALSE");
    expect(sql.find((statement) => statement.includes("FROM plans p"))).toContain("FALSE");
    expect(sql.find((statement) => statement.includes("FROM plan_activities pa"))).toContain("FALSE");
    expect(sql.find((statement) => statement.includes("FROM reports r"))).toContain("FALSE");

    mockQuery.mockClear();
    await request(appForStateUserWithoutAssignment()).get("/dashboard/recent-activity").expect(200);
    const recentActivitySql = String((mockQuery.mock.calls as unknown[][])[0]?.[0] ?? "");
    expect(recentActivitySql).toContain("WHERE FALSE");
    expect(recentActivitySql).toContain("a.module = 'plans'");
    expect(recentActivitySql).toContain("pl.project_id");
    expect(recentActivitySql).toContain("active_parent.deleted_at IS NULL");
    expect(recentActivitySql).toContain("a.module IN ('projects', 'project')");

    mockQuery.mockClear();
    await request(appForStateUserWithoutAssignment()).get("/dashboard/late-reports").expect(200);
    expect(String((mockQuery.mock.calls as unknown[][])[0]?.[0] ?? "")).toContain("AND FALSE");
  });

  it("keeps assigned SPO performance endpoints limited to assigned projects in their state", async () => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [{ project_id: 101 }] } as never);

    await request(appForAssignedSpo()).get("/dashboard/performance").expect(200);

    const performanceSql = (mockQuery.mock.calls as unknown[][]).map((call) => String(call[0] ?? ""));
    const indicator = performanceSql.find((sql) => sql.includes("FROM indicators i"));
    const risk = performanceSql.find((sql) => sql.includes("FROM risks rk"));
    expect(indicator).toContain("i.project_id = ANY($1::int[])");
    expect(indicator).toContain("ps.state_id = $2");
    expect(risk).toContain("p.id = ANY($1::int[])");
    expect(risk).toContain("ps.state_id = $2");

    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [{ project_id: 101 }] } as never);
    await request(appForAssignedSpo()).get("/dashboard/performance/states").expect(200, []);

    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [{ project_id: 101 }] } as never);
    await request(appForAssignedSpo()).get("/dashboard/performance/projects").expect(200, []);
    const projectSql = String((mockQuery.mock.calls as unknown[][])[1]?.[0] ?? "");
    expect(projectSql).toContain("p.id = ANY($1::int[])");
    expect(projectSql).toContain("ps.state_id = $2");
  });

  it("applies assigned-project and state scope to budget, beneficiary, and report aggregates", async () => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [{ project_id: 101 }] } as never);
    await request(appForAssignedSpo()).get("/dashboard/sector-budget").expect(200);
    const budgetCalls = mockQuery.mock.calls as unknown[][];
    const budgetSql = budgetCalls.map((call) => String(call[0] ?? ""));
    const budgetQuery = budgetSql.find((sql) => sql.includes("WITH project_filter"));
    expect(budgetQuery).toContain("p.id = ANY($7::int[])");
    expect(budgetQuery).toContain("ps.state_id = $8");
    expect(budgetCalls.find((call) => String(call[0]).includes("WITH project_filter"))?.[1]).toEqual([
      null, null, null, 7, null, null, [101], 7,
    ]);

    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [{ project_id: 101 }] } as never);
    await request(appForAssignedSpo()).get("/dashboard/beneficiaries").expect(200);
    const beneficiarySql = (mockQuery.mock.calls as unknown[][])
      .map((call) => String(call[0] ?? ""));
    const byState = beneficiarySql.find((sql) => sql.includes("FROM states s") && sql.includes("beneficiaries_male"));
    expect(byState).toContain("p.id = ANY($2::int[])");
    expect(byState).toContain("ps.state_id = $3");

    mockQuery.mockReset();
    mockQuery.mockResolvedValue({
      rows: [{ total: 0, draft: 0, awaiting_approval: 0, approved: 0, awaiting_over14: 0 }],
    } as never);
    mockQuery.mockResolvedValueOnce({ rows: [{ project_id: 101 }] } as never);
    await request(appForAssignedSpo()).get("/dashboard/reports-summary").expect(200);
    const reportCalls = mockQuery.mock.calls as unknown[][];
    const scopedReportCalls = reportCalls.filter((call) => String(call[0] ?? "").includes("reports r"));
    expect(scopedReportCalls).not.toHaveLength(0);
    for (const call of scopedReportCalls) {
      expect(String(call[0])).toContain("r.project_id = ANY($1::int[])");
      expect(String(call[0])).toContain("r.state_id = $2");
      expect(call[1]).toEqual([[101], 7]);
    }
  });

  it("fails closed when an SPO has a state but no assigned projects", async () => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);
    await request(appForAssignedSpo()).get("/dashboard/sector-budget").expect(200);
    expect(
      (mockQuery.mock.calls as unknown[][]).map((call) => String(call[0] ?? "")).find((sql) => sql.includes("WITH project_filter")),
    ).toContain("AND FALSE");

    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);
    await request(appForAssignedSpo()).get("/dashboard/beneficiaries").expect(200);
    expect(
      (mockQuery.mock.calls as unknown[][]).map((call) => String(call[0] ?? "")).find((sql) => sql.includes("FROM states s") && sql.includes("beneficiaries_male")),
    ).toContain("AND FALSE");

    mockQuery.mockReset();
    mockQuery.mockResolvedValue({
      rows: [{ total: 0, draft: 0, awaiting_approval: 0, approved: 0, awaiting_over14: 0 }],
    } as never);
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);
    await request(appForAssignedSpo()).get("/dashboard/reports-summary").expect(200);
    const reportSql = (mockQuery.mock.calls as unknown[][])
      .map((call) => String(call[0] ?? ""))
      .filter((sql) => sql.includes("reports r"));
    expect(reportSql).not.toHaveLength(0);
    for (const sql of reportSql) expect(sql).toContain("AND FALSE");
  });
});