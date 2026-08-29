import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computeStateImplementation, type PgPool } from "../performanceEngine";

const integration = process.env.DATABASE_URL ? describe : describe.skip;

integration("computeStateImplementation disposable PostgreSQL scope integration", () => {
  let client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>; release: () => void };

  beforeAll(async () => {
    // Dynamic import means a developer without DATABASE_URL can collect this
    // suite without @workspace/db rejecting module initialisation.
    const { pool } = await import("@workspace/db");
    client = await pool.connect() as unknown as typeof client;
    await client.query("BEGIN");
    await client.query(`
      CREATE TEMP TABLE states (id int, name text, name_ar text);
      CREATE TEMP TABLE projects (id int, sector text, deleted_at timestamptz, budget_total numeric, beneficiaries_target numeric, status text);
      CREATE TEMP TABLE project_states (project_id int, state_id int);
      CREATE TEMP TABLE beneficiaries (project_id int, state_id int);
      CREATE TEMP TABLE activities (id int, project_id int, state_id int, progress_pct int, sector text);
      CREATE TEMP TABLE risks (project_id int, state_id int, severity text, status text);
      CREATE TEMP TABLE reports (project_id int, activity_id int, state_id int, status text, report_type text, migration_is_duplicate boolean, migration_status_unverified boolean, submitted_at timestamptz, sector text);
      CREATE TEMP TABLE indicators (project_id int, target numeric, achieved numeric);
      INSERT INTO states VALUES (7, 'Fixture State', NULL);
      INSERT INTO projects VALUES
        (1, 'Health', NULL, 100, 10, 'active'),
        (2, 'WASH', NULL, 100, 10, 'active'),
        (3, 'Health', now(), 100, 10, 'active');
      INSERT INTO project_states VALUES (1,7), (2,7), (3,7);
      INSERT INTO beneficiaries VALUES (1,7), (2,7), (NULL,7);
      INSERT INTO activities VALUES (1,1,7,100,'Health'), (2,2,7,0,'WASH'), (3,NULL,7,50,'Health');
      INSERT INTO risks VALUES (1,7,'critical','open'), (2,7,'critical','open'), (NULL,7,'critical','open');
      INSERT INTO reports VALUES
        (1,NULL,7,'approved','project',false,false,now(),'Health'),
        (2,NULL,7,'approved','project',false,false,now(),'WASH'),
        (NULL,NULL,7,'approved','program_state',false,false,now(),'Health'),
        (1,NULL,7,'approved','project',true,false,now(),'Health'),
        (1,NULL,7,'approved','project',false,true,now(),'Health');
      INSERT INTO indicators VALUES (1,100,50), (2,100,100), (3,100,100);
    `);
  });

  afterAll(async () => {
    if (client) {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("returns Health-only state facts while retaining authorised standalone Health activity/report records", async () => {
    const [row] = await computeStateImplementation(client as unknown as PgPool, {
      stateId: 7,
      sectors: ["Health"],
    });
    expect(row).toEqual(expect.objectContaining({
      stateId: 7,
      activeProjects: 1,
      beneficiaries: 1,
      progressPct: 75,
      openRisks: 1,
      criticalRisks: 1,
      reportsSubmitted: 2,
    }));
  });
});