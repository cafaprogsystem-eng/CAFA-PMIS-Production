import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const query = vi.hoisted(() => vi.fn());
const release = vi.hoisted(() => vi.fn());
vi.mock("@workspace/db", () => ({ pool: { connect: vi.fn(async () => ({ query, release })) } }));
vi.mock("./logger", () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const { MIGRATIONS, assertMigrationManifest, runMigrations } = await import("./run-migrations");

describe("tracked migration runtime authority", () => {
  it("has unique, valid full migration names", () => {
    expect(() => assertMigrationManifest()).not.toThrow();
    expect(new Set(MIGRATIONS.map((migration) => migration.name)).size).toBe(MIGRATIONS.length);
  });

  it("keeps the maintained Plan migration references aligned with runtime authority", () => {
    for (const name of [
      "057_plan_budget_legacy_unverified",
      "058_plan_final_approval_timestamp",
    ]) {
      const migration = MIGRATIONS.find((candidate) => candidate.name === name);
      const reference = readFileSync(
        new URL(`../migrations/${name}.sql`, import.meta.url),
        "utf8",
      );
      expect(migration).toBeDefined();
      expect(reference).toContain(migration!.sql.trim());
    }
  });

  it("takes a database advisory lock before inspecting or mutating history", async () => {
    query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes("SELECT filename, checksum FROM schema_migrations WHERE")) {
        return { rows: [{ filename: params?.[0], checksum: null }] };
      }
      return { rows: [] };
    });
    await runMigrations();
    const lock = query.mock.calls.findIndex(([sql]) => String(sql).includes("pg_advisory_lock"));
    const lookup = query.mock.calls.findIndex(([sql]) => String(sql).includes("schema_migrations WHERE filename"));
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(lock).toBeLessThan(lookup);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("pg_advisory_unlock"))).toBe(true);
    expect(release).toHaveBeenCalled();
  });
});