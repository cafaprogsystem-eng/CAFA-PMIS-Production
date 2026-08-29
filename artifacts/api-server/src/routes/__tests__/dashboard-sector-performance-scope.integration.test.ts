/**
 * Dashboard sector-performance scope integration tests.
 *
 * These tests use temporary PostgreSQL tables so the route's actual SQL is
 * evaluated against State and assignment-scoped project populations.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";

const integration = process.env.DATABASE_URL ? describe : describe.skip;

type DbClient = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  release: () => void;
};

const SOM = {
  id: 10,
  name: "State Officer",
  email: "som@example.test",
  role: "state_office_manager",
  stateId: 7,
  sector: null,
  sectors: [],
};

const SPO = {
  id: 11,
  name: "State Programme Officer",
  email: "spo@example.test",
  role: "state_program_officer",
  stateId: 7,
  sector: null,
  sectors: [],
};

const EMPTY_SPO = { ...SPO, id: 12, email: "empty-spo@example.test" };

integration("sector-performance authorised achievement population", () => {
  let client: DbClient;
  let routePool: { query: (...args: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };
  let restorePoolQuery: (() => void) | undefined;

  async function buildApp(currentUser: typeof SOM | typeof SPO) {
    const app = express();
    app.use((req: Request, _res: Response, next: NextFunction) => {
      (req as unknown as { currentUser: typeof currentUser }).currentUser = currentUser;
      next();
    });
    const { default: dashboardRouter } = await import("../dashboard.js");
    app.use("/api", dashboardRouter);
    return app;
  }

  beforeAll(async () => {
    const { pool } = await import("@workspace/db");
    client = await pool.connect() as unknown as DbClient;
    routePool = pool as unknown as typeof routePool;
    await client.query("BEGIN");
    await client.query(`
      CREATE TEMP TABLE projects (
        id int,
        sector text,
        deleted_at timestamptz,
        beneficiaries_male int,
        beneficiaries_female int,
        beneficiaries_boys int,
        beneficiaries_girls int,
        currency text,
        budget_total numeric
      );
      CREATE TEMP TABLE project_states (project_id int, state_id int);
      CREATE TEMP TABLE project_assignments (project_id int, user_id int);
      CREATE TEMP TABLE indicators (project_id int, target numeric, achieved numeric, sector text);
      CREATE TEMP TABLE activities (project_id int, budget_spent numeric);
    `);

    const originalQuery = routePool.query;
    routePool.query = ((...args: unknown[]) => client.query(
      args[0] as string,
      args[1] as unknown[] | undefined,
    )) as typeof routePool.query;
    restorePoolQuery = () => { routePool.query = originalQuery; };
  });

  beforeEach(async () => {
    await client.query(`
      TRUNCATE TABLE indicators, activities, project_assignments, project_states, projects;

      INSERT INTO projects VALUES
        (1, 'Health', NULL, 10, 10, 0, 0, 'USD', 1000),
        (2, 'Health', NULL, 10, 10, 0, 0, 'USD', 1000),
        (3, 'Health', NULL, 10, 10, 0, 0, 'USD', 1000);

      INSERT INTO project_states VALUES (1, 7), (2, 8), (3, 7);
      INSERT INTO project_assignments VALUES (1, 11);

      INSERT INTO indicators VALUES
        (1, 100, 50, 'Health'),
        (2, 100, 100, 'Health'),
        (3, NULL, 100, 'Health');
    `);
  });

  afterAll(async () => {
    restorePoolQuery?.();
    if (client) {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("excludes same-sector projects outside a State user's authorised State", async () => {
    const app = await buildApp(SOM);
    const res = await request(app).get("/api/dashboard/sector-performance");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      expect.objectContaining({
        sector: "Health",
        projects: 2,
        indicatorAchievementPct: 50,
      }),
    ]);
  });

  it("excludes same-sector projects outside an assigned-project user's assignments", async () => {
    const app = await buildApp(SPO);
    const res = await request(app).get("/api/dashboard/sector-performance");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      expect.objectContaining({
        sector: "Health",
        projects: 1,
        indicatorAchievementPct: 50,
      }),
    ]);
  });

  it("returns an empty result when an assigned-project user has no assignments", async () => {
    const app = await buildApp(EMPTY_SPO);
    const res = await request(app).get("/api/dashboard/sector-performance");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns null for no-indicator, missing-target, and non-positive-target evidence", async () => {
    await client.query("DELETE FROM indicators WHERE project_id = 1");
    const app = await buildApp(SPO);

    const withoutIndicator = await request(app).get("/api/dashboard/sector-performance");
    expect(withoutIndicator.status).toBe(200);
    expect(withoutIndicator.body[0].indicatorAchievementPct).toBeNull();

    await client.query("INSERT INTO indicators VALUES (1, NULL, 100, 'Health')");
    const missingTarget = await request(app).get("/api/dashboard/sector-performance");
    expect(missingTarget.status).toBe(200);
    expect(missingTarget.body[0].indicatorAchievementPct).toBeNull();

    await client.query("UPDATE indicators SET target = 0 WHERE project_id = 1");
    const nonPositiveTarget = await request(app).get("/api/dashboard/sector-performance");
    expect(nonPositiveTarget.status).toBe(200);
    expect(nonPositiveTarget.body[0].indicatorAchievementPct).toBeNull();
  });

  it("returns null when the only scoped indicator target is negative", async () => {
    await client.query("DELETE FROM indicators WHERE project_id = 1");
    await client.query("INSERT INTO indicators VALUES (1, -10, 50, 'Health')");

    const app = await buildApp(SPO);
    const res = await request(app).get("/api/dashboard/sector-performance");

    expect(res.status).toBe(200);
    expect(res.body[0].indicatorAchievementPct).toBeNull();
  });

  it("preserves genuine achieved-zero evidence as factual 0%", async () => {
    await client.query("DELETE FROM indicators WHERE project_id = 1");
    await client.query("INSERT INTO indicators VALUES (1, 100, 0, 'Health')");

    const app = await buildApp(SPO);
    const res = await request(app).get("/api/dashboard/sector-performance");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      expect.objectContaining({
        sector: "Health",
        projects: 1,
        indicatorAchievementPct: 0,
      }),
    ]);
  });

  it("aggregates valid evidence across multiple authorised Projects only", async () => {
    await client.query("DELETE FROM indicators WHERE project_id IN (1, 3)");
    await client.query(`
      INSERT INTO indicators VALUES
        (1, 100, 50, 'Health'),
        (3, 100, 100, 'Health')
    `);

    const app = await buildApp(SOM);
    const res = await request(app).get("/api/dashboard/sector-performance");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      expect.objectContaining({
        sector: "Health",
        projects: 2,
        indicatorAchievementPct: 75,
      }),
    ]);
  });

});
