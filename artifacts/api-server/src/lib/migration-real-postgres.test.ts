import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MIGRATIONS } from "./run-migrations";

// This test invokes the compiled production migration command. Keep it opt-in
// so the ordinary API suite can run before the production bundle is built; CI
// enables it explicitly in its post-build disposable PostgreSQL gate.
const migrationDatabaseUrl = process.env.MIGRATION_TEST_DATABASE_URL;
const exec = promisify(execFile);
const databaseName = `cafa_migration_${randomUUID().replaceAll("-", "")}`;
let databaseUrl = "";

async function runMigration(): Promise<void> {
  await exec(process.execPath, ["--enable-source-maps", "dist/migrate.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: "production", DATABASE_URL: databaseUrl },
  });
}

async function psql(sql: string): Promise<string> {
  const { stdout } = await exec("psql", [
    databaseUrl,
    "-v", "ON_ERROR_STOP=1",
    "-At",
    "-F", "|",
    "-c", sql,
  ]);
  return stdout.trim();
}

function checksum(name: string, sql: string): string {
  return createHash("sha256").update(`${name}\n${sql}`).digest("hex");
}

describe.skipIf(!migrationDatabaseUrl)("tracked migration release against disposable PostgreSQL", () => {
  beforeAll(async () => {
    const adminUrl = migrationDatabaseUrl!;
    await exec("psql", [adminUrl, "-v", "ON_ERROR_STOP=1", "-c", `CREATE DATABASE ${databaseName}`]);
    const url = new URL(adminUrl);
    url.pathname = `/${databaseName}`;
    databaseUrl = url.toString();
  }, 30_000);

  afterAll(async () => {
    if (!migrationDatabaseUrl) return;
    await exec("psql", [migrationDatabaseUrl, "-v", "ON_ERROR_STOP=1", "-c", `DROP DATABASE IF EXISTS ${databaseName}`]);
  }, 30_000);

  it("bootstraps a fresh database, serialises concurrent release attempts, and reruns as a no-op", async () => {
    await Promise.all([runMigration(), runMigration()]);
    const [historyCount, projectsTable] = (await psql(
      `SELECT COUNT(*) FROM public.schema_migrations;
       SELECT to_regclass('public.projects')`,
    )).split(/\s+/);
    expect(Number(historyCount)).toBe(MIGRATIONS.length);
    expect(projectsTable).toBe("projects");

    const actualHistory = (await psql(
      `SELECT filename, checksum FROM public.schema_migrations ORDER BY filename`,
    )).split("\n").filter(Boolean);
    const expectedHistory = MIGRATIONS
      .map((migration) => `${migration.name}|${checksum(migration.name, migration.sql)}`)
      .sort();
    expect(actualHistory).toEqual(expectedHistory);

    const planColumns = (await psql(
      `SELECT column_name, data_type, is_nullable, COALESCE(column_default, '')
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'plans'
         AND column_name IN ('budget_legacy_unverified', 'last_final_approved_at')
       ORDER BY column_name`,
    )).split("\n");
    expect(planColumns).toContain("budget_legacy_unverified|boolean|NO|false");
    expect(planColumns).toContain("last_final_approved_at|timestamp with time zone|YES|");

    await expect(runMigration()).resolves.toBeUndefined();
  }, 120_000);

  it("applies only the bounded Plan evidence backfills and preserves their source values", async () => {
    const budgetMigration = MIGRATIONS.find(
      (migration) => migration.name === "057_plan_budget_legacy_unverified",
    );
    const approvalMigration = MIGRATIONS.find(
      (migration) => migration.name === "058_plan_final_approval_timestamp",
    );
    expect(budgetMigration).toBeDefined();
    expect(approvalMigration).toBeDefined();

    const provenBudgetIds = [10, 11, 14, 15, 16, 17, 18, 19, 20, 22, 24, 57, 58, 59, 60, 61, 62];
    const budgetRows = [
      ...provenBudgetIds.map((id) => `(${id}, 'BUD-${id}', 'Budget evidence ${id}', 0, 'USD')`),
      "(901, 'BUD-901', 'Genuine USD zero', 0, 'USD')",
      "(902, 'BUD-902', 'Non-zero historical ID', 10, 'USD')",
      "(903, 'BUD-903', 'Non-USD historical ID', 0, 'EUR')",
    ];
    await psql(
      `INSERT INTO plans (id, code, title, budget_planned, currency)
       VALUES ${budgetRows.join(", ")}`,
    );
    await psql(budgetMigration!.sql);
    await psql(budgetMigration!.sql);
    expect(await psql(
      `SELECT string_agg(id::text, ',' ORDER BY id)
       FROM plans WHERE budget_legacy_unverified`,
    )).toBe(provenBudgetIds.join(","));
    expect(await psql(
      `SELECT COUNT(*) FROM plans
       WHERE (id = 901 AND budget_legacy_unverified)
          OR (id = 902 AND budget_legacy_unverified)
          OR (id = 903 AND budget_legacy_unverified)
          OR (id = 902 AND budget_planned <> 10)
          OR (id = 903 AND currency <> 'EUR')`,
    )).toBe("0");

    await psql(`
      INSERT INTO plans (id, code, title, status, last_final_approved_at)
      VALUES
        (1001, 'APR-1001', 'Backfill latest final approval', 'draft', NULL),
        (1002, 'APR-1002', 'Unproven approval', 'approved', NULL),
        (1003, 'APR-1003', 'Status alone is insufficient', 'approved', NULL),
        (1004, 'APR-1004', 'Existing workflow timestamp wins', 'approved', '2026-12-31T00:00:00Z');
      INSERT INTO approvals (entity_type, entity_id, action, from_status, to_status, actor_id, "timestamp")
      VALUES
        ('plan', 1001, 'final_approve', 'coordination_approved', 'approved', 1, '2026-01-01T00:00:00Z'),
        ('plan', 1001, 'final_approve', 'coordination_approved', 'approved', 1, '2026-02-01T00:00:00Z'),
        ('plan', 1002, 'final_approve', 'coordination_approved', 'rejected', 1, '2026-03-01T00:00:00Z'),
        ('plan', 1004, 'final_approve', 'coordination_approved', 'approved', 1, '2026-04-01T00:00:00Z');
    `);
    await psql(approvalMigration!.sql);
    await psql(approvalMigration!.sql);
    expect(await psql(
      `SELECT id || '|' || COALESCE(to_char(last_final_approved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD'), 'NULL')
       FROM plans WHERE id BETWEEN 1001 AND 1004 ORDER BY id`,
    )).toBe([
      "1001|2026-02-01",
      "1002|NULL",
      "1003|NULL",
      "1004|2026-12-31",
    ].join("\n"));
  }, 120_000);
});