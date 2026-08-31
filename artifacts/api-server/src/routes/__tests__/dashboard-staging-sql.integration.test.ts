/**
 * Dashboard staging SQL regressions.
 *
 * The temporary tables intentionally expose overlapping status columns on
 * projects, reports, and activities. These requests therefore fail in the
 * same way as the staging queries if a status predicate loses its owner or if
 * the pending-approvals condition list contains an empty fragment.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";

const integration = process.env.DATABASE_URL ? describe : describe.skip;

type DbClient = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  release: () => void;
};

type RoutePool = {
  query: (...args: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};

const PM = {
  id: 20,
  name: "Program Manager",
  email: "pm@dashboard-sql.test",
  role: "program_manager",
  roleLabel: "Program Manager",
  scope: "global",
  stateId: null,
  stateName: null,
  sector: null,
  sectors: null,
  avatarUrl: null,
};

const STATE_USER = {
  ...PM,
  id: 21,
  name: "State Officer",
  email: "state@dashboard-sql.test",
  role: "state_office_manager",
  stateId: 7,
  scope: "state",
};

const TC = {
  ...PM,
  id: 22,
  name: "Technical Coordinator",
  email: "tc@dashboard-sql.test",
  role: "technical_coordinator",
  sector: "Health",
  sectors: ["Health"],
  scope: "sector",
};

integration("Dashboard staging SQL regressions", () => {
  let client: DbClient;
  let routePool: RoutePool;
  let restorePoolQuery: (() => void) | undefined;

  async function buildApp(currentUser: typeof PM | typeof STATE_USER | typeof TC) {
    const { default: dashboardRouter } = await import("../dashboard.js");
    const app = express();
    app.use((req: Request, _res: Response, next: NextFunction) => {
      (req as unknown as { currentUser: typeof currentUser }).currentUser = currentUser;
      next();
    });
    app.use("/api", dashboardRouter);
    app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
      res.status(500).json({ error: "internal", message: err.message });
    });
    return app;
  }

  beforeAll(async () => {
    const { pool } = await import("@workspace/db");
    client = await pool.connect() as unknown as DbClient;
    routePool = pool as unknown as RoutePool;
    await client.query("BEGIN");
    await client.query(`
      CREATE TEMP TABLE projects (
        id int,
        code text,
        title text,
        status text,
        sector text,
        donor text,
        start_date date,
        end_date date,
        budget_total numeric,
        currency text,
        beneficiaries_target int,
        beneficiaries_male int,
        beneficiaries_female int,
        beneficiaries_boys int,
        beneficiaries_girls int,
        deleted_at timestamptz,
        created_at timestamptz
      );
      CREATE TEMP TABLE project_states (project_id int, state_id int);
      CREATE TEMP TABLE project_state_allocations (
        project_id int,
        state_id int,
        budget_allocation numeric
      );
      CREATE TEMP TABLE states (id int, name text, name_ar text);
      CREATE TEMP TABLE users (id int, name text);
      CREATE TEMP TABLE activities (
        id int,
        project_id int,
        activity_id int,
        state_id int,
        sector text,
        status text,
        budget_spent numeric,
        progress_pct int,
        planned_end timestamptz
      );
      CREATE TEMP TABLE beneficiaries (project_id int, state_id int);
      CREATE TEMP TABLE risks (
        id int,
        project_id int,
        state_id int,
        severity text,
        likelihood text,
        impact text,
        status text
      );
      CREATE TEMP TABLE reports (
        id int,
        title text,
        kind text,
        report_type text,
        workflow_path text,
        activity_id int,
        status text,
        project_id int,
        state_id int,
        sector text,
        period text,
        narrative text,
        submitted_by_id int,
        submitted_at timestamptz,
        migration_is_duplicate boolean,
        migration_status_unverified boolean
      );
    `);

    const originalQuery = routePool.query;
    let queryQueue = Promise.resolve();
    routePool.query = ((...args: unknown[]) => {
      const result = queryQueue.then(() => client.query(
          args[0] as string,
          args[1] as unknown[] | undefined,
      ));
      queryQueue = result.then(() => undefined, () => undefined);
      return result;
    }) as RoutePool["query"];
    restorePoolQuery = () => { routePool.query = originalQuery; };
  });

  beforeEach(async () => {
    await client.query(`
      TRUNCATE TABLE
        reports, risks, beneficiaries, activities, users, states,
        project_state_allocations, project_states, projects;

      INSERT INTO states VALUES (7, 'Fixture State', 'ولاية الاختبار');
      INSERT INTO users VALUES (20, 'Program Manager'), (21, 'State Officer'), (22, 'Technical Coordinator');

      INSERT INTO projects VALUES
        (1, 'PRJ-001', 'Health project', 'coordination_approved', 'Health', 'UNICEF',
         '2026-01-01', '2026-12-31', 1000, 'USD', 100, 25, 25, 25, 25, NULL, NOW()),
        (2, 'PRJ-002', 'WASH project', 'approved', 'WASH', 'WHO',
         '2026-01-01', '2026-12-31', 2000, 'USD', 80, 20, 20, 20, 20, NULL, NOW()),
        (3, 'PRJ-003', 'Second Health project', 'submitted', 'Health', 'UNICEF',
         '2026-01-01', '2026-12-31', 1500, 'USD', 60, 15, 15, 15, 15, NULL, NOW());
      INSERT INTO project_states VALUES (1, 7), (2, 7), (3, 7);
      INSERT INTO project_state_allocations VALUES (1, 7, 900), (2, 7, 1800), (3, 7, 1400);

      INSERT INTO activities VALUES
        (101, 1, NULL, 7, 'Health', 'in_progress', 40, 50, '2099-12-31'),
        (102, 2, NULL, 7, 'WASH', 'completed', 80, 100, '2099-12-31'),
        (103, 3, NULL, 7, 'Health', 'planned', 0, 0, '2099-12-31');
      INSERT INTO beneficiaries VALUES (1, 7), (2, 7), (3, 7);
      INSERT INTO risks VALUES (1, 1, 7, 'high', 'likely', 'high', 'open');

      INSERT INTO reports VALUES
        (201, 'Approved health report', 'monthly', 'project', 'state_authored', NULL,
         'approved', 1, 7, 'Health', '2026-01', 'approved', 20, NOW(), FALSE, FALSE),
        (202, 'Pending health report', 'monthly', 'project', 'state_authored', NULL,
         'coordination_approved', 1, 7, 'Health', '2026-02', 'pending', 20, NOW(), FALSE, FALSE),
        (203, 'Pending WASH report', 'monthly', 'project', 'state_authored', NULL,
         'submitted', 2, 7, 'WASH', '2026-02', 'pending', 20, NOW(), FALSE, FALSE),
        (204, 'Pending second health report', 'monthly', 'project', 'state_authored', NULL,
         'submitted', 3, 7, 'Health', '2026-02', 'pending', 20, NOW(), FALSE, FALSE);
    `);
  });

  afterAll(async () => {
    restorePoolQuery?.();
    if (client) {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("runs Summary against joined tables with overlapping status columns", async () => {
    const app = await buildApp(PM);
    const res = await request(app).get("/api/dashboard/summary");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      activeProjects: 2,
      totalProjects: 3,
      pendingApprovalsCount: 5,
      reportsSubmitted: 4,
    }));
  });

  it("runs State performance and applies reporting compliance to report status", async () => {
    const app = await buildApp(PM);
    const res = await request(app).get("/api/dashboard/state-performance");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      expect.objectContaining({
        stateId: 7,
        totalProjects: 3,
        activeProjects: 2,
        reportingCompliancePct: 25,
      }),
    ]);
  });

  it("runs Pending Approvals without optional scope predicates", async () => {
    const app = await buildApp(PM);
    const res = await request(app).get("/api/dashboard/pending-approvals");

    expect(res.status).toBe(200);
    expect(res.body.projects).toHaveLength(1);
    expect(res.body.reports).toHaveLength(1);
  });

  it("keeps State roles outside the approval workflow on an empty queue", async () => {
    const app = await buildApp(STATE_USER);
    const res = await request(app).get("/api/dashboard/pending-approvals");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ projects: [], reports: [] });
  });

  it("runs Pending Approvals with a Sector scope and returns only that sector", async () => {
    const app = await buildApp(TC);
    const res = await request(app).get("/api/dashboard/pending-approvals");

    expect(res.status).toBe(200);
    expect(res.body.projects).toHaveLength(1);
    expect(res.body.projects[0].sector).toBe("Health");
    expect(res.body.reports).toHaveLength(1);
    expect(res.body.reports[0].projectId).toBe(3);
  });

  it("returns valid empty queue responses when no item is awaiting approval", async () => {
    await client.query("UPDATE projects SET status = 'approved'");
    await client.query("UPDATE reports SET status = 'approved'");

    const app = await buildApp(PM);
    const res = await request(app).get("/api/dashboard/pending-approvals");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ projects: [], reports: [] });
  });

  it("propagates PostgreSQL failures instead of fabricating performance values", async () => {
    await client.query("SAVEPOINT dashboard_database_failure");
    await client.query("ALTER TABLE reports DROP COLUMN status");
    try {
      const app = await buildApp(PM);
      const res = await request(app).get("/api/dashboard/state-performance");

      expect(res.status).toBe(500);
      expect(res.body).toEqual(expect.objectContaining({ error: "internal" }));
    } finally {
      await client.query("ROLLBACK TO SAVEPOINT dashboard_database_failure");
    }
  });
});