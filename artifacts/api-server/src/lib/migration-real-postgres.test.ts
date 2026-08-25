import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
    const { stdout } = await exec("psql", [databaseUrl, "-At", "-c",
      `SELECT COUNT(*) FROM public.schema_migrations; SELECT to_regclass('public.projects')`]);
    const [historyCount, projectsTable] = stdout.trim().split(/\s+/);
    expect(Number(historyCount)).toBeGreaterThan(50);
    expect(projectsTable).toBe("projects");
    await expect(runMigration()).resolves.toBeUndefined();
  }, 120_000);
});