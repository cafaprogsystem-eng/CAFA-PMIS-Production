import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
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
      "059_plan_nullable_budget_fields",
      "060_monthly_reporting_deadlines",
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

  it("preserves the authoritative production 059 bytes and upgrades that history with 060", async () => {
    const plan059 = MIGRATIONS.find(
      (migration) => migration.name === "059_plan_nullable_budget_fields",
    )!;
    const deadline060 = MIGRATIONS.find(
      (migration) => migration.name === "060_monthly_reporting_deadlines",
    )!;
    const reference059 = readFileSync(
      new URL("../migrations/059_plan_nullable_budget_fields.sql", import.meta.url),
    );
    expect(createHash("sha256").update(reference059).digest("hex")).toBe(
      "c2a75ef9101fc71665a860e94c1e49a4de466558725b2d98f9c67b7b3a58583c",
    );

    const checksum = (migration: (typeof MIGRATIONS)[number]) =>
      createHash("sha256")
        .update(`${migration.name}\n${migration.sql}`)
        .digest("hex");
    query.mockReset();
    query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes("SELECT 1, filename, checksum FROM public.schema_migrations")) {
        const name = String(params?.[0]);
        const migration = MIGRATIONS.find((candidate) => candidate.name === name);
        if (migration && name !== deadline060.name) {
          return { rows: [{ filename: name, checksum: checksum(migration) }] };
        }
        return { rows: [] };
      }
      return { rows: [] };
    });

    await expect(runMigrations()).resolves.toBeUndefined();
    expect(query.mock.calls.some(([sql]) => String(sql) === plan059.sql)).toBe(false);
    expect(query.mock.calls.some(([sql]) => String(sql) === deadline060.sql)).toBe(true);
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