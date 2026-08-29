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

function appForTechnicalCoordinator() {
  const app = express();
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.currentUser = {
      id: 21, name: "Health TC", email: "tc@example.test",
      role: "technical_coordinator", roleLabel: "Technical Coordinator", scope: "sector",
      stateId: null, stateName: null, sector: "Health", sectors: ["Health"], avatarUrl: null,
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

  it.each([
    "/dashboard/performance",
    "/dashboard/performance/states",
    "/dashboard/performance/projects",
  ])("does not expose retired composite endpoint %s", async (path) => {
    mockQuery.mockClear();
    await request(appForAssignedSpo()).get(path).expect(404);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("applies assignment scope to project facts and canonical state scope to Report aggregates", async () => {
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
    expect(byState).toContain("p.id = ANY($1::int[])");
    expect(byState).toContain("_ps.state_id = $2");
    expect(byState).toContain("s.id = $3");

    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
    mockQuery.mockResolvedValueOnce({
      rows: [{ total: 2, draft: 2, returned: 2, awaiting_approval: 0, approved: 0, awaiting_over14: 0 }],
    } as never);
    const reportResponse = await request(appForAssignedSpo()).get("/dashboard/reports-summary").expect(200);
    const reportCalls = mockQuery.mock.calls as unknown[][];
    const scopedReportCalls = reportCalls.filter((call) => String(call[0] ?? "").includes("reports r"));
    expect(scopedReportCalls).not.toHaveLength(0);
    for (const call of scopedReportCalls) {
      expect(String(call[0])).not.toContain("r.project_id = ANY");
      expect(String(call[0])).toContain("r.state_id = $1");
      expect(call[1]).toEqual([7]);
    }
    expect(reportResponse.body.returned).toBe(2);
  });

  it("fails project facts closed without assignments but preserves authorised standalone Reports", async () => {
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
    mockQuery.mockResolvedValue({ rows: [] });
    mockQuery.mockResolvedValueOnce({
      rows: [{ total: 2, draft: 2, returned: 2, awaiting_approval: 0, approved: 0, awaiting_over14: 0 }],
    } as never);
    const reportResponse = await request(appForAssignedSpo()).get("/dashboard/reports-summary").expect(200);
    expect(reportResponse.body.returned).toBe(2);
    const reportCalls = (mockQuery.mock.calls as unknown[][]);
    const reportSql = reportCalls
      .map((call) => String(call[0] ?? ""))
      .filter((sql) => sql.includes("reports r"));
    expect(reportSql).not.toHaveLength(0);
    for (const sql of reportSql) {
      expect(sql).toContain("r.state_id = $1");
      expect(sql).not.toContain("r.project_id = ANY");
      expect(sql).not.toContain("AND FALSE");
    }
    for (const call of reportCalls.filter((call) => String(call[0] ?? "").includes("reports r"))) {
      expect(call[1]).toEqual([7]);
    }
  });

  it("uses canonical type-aware TC sector scope for mixed Report counts", async () => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
    mockQuery.mockResolvedValueOnce({
      rows: [{ total: 0, draft: 0, returned: 0, awaiting_approval: 0, approved: 0, awaiting_over14: 0 }],
    } as never);

    await request(appForTechnicalCoordinator()).get("/dashboard/reports-summary").expect(200);

    const countCall = (mockQuery.mock.calls as unknown[][]).find((call) =>
      String(call[0] ?? "").includes("AS returned"),
    );
    expect(countCall).toBeDefined();
    const sql = String(countCall![0]);
    expect(sql).toContain(
      "r.report_type = 'project' AND p2.sector = ANY($1::text[])",
    );
    expect(sql).toContain(
      "r.report_type = 'activity' AND r.project_id IS NOT NULL AND p2.sector = ANY($1::text[])",
    );
    expect(sql).toContain(
      "r.report_type = 'activity' AND r.project_id IS NULL AND act.sector = ANY($1::text[])",
    );
    expect(sql).toContain(
      "r.report_type NOT IN ('project', 'activity')",
    );
    expect(sql).not.toContain("COALESCE(NULLIF(r.sector,''), p2.sector)");
    expect(countCall![1]).toEqual([["Health"]]);
  });
});