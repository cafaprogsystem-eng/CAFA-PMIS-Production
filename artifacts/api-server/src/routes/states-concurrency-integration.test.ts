/**
 * STATE-FUNC database verification for the migration-backed State identity
 * trigger. This uses the development PostgreSQL instance, not a mocked pool.
 */
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "@workspace/db";

const suffix = `${Date.now()}_${process.pid}`;
const insertedIds: number[] = [];

async function insertState(name: string, code: string): Promise<number> {
  const result = await pool.query<{ id: number }>(
    "INSERT INTO states (name, name_ar, code) VALUES ($1, $2, $3) RETURNING id",
    [name, `اختبار ${name}`, code],
  );
  const id = result.rows[0].id;
  insertedIds.push(id);
  return id;
}

afterAll(async () => {
  if (insertedIds.length > 0) {
    await pool.query("DELETE FROM states WHERE id = ANY($1::int[])", [insertedIds]);
  }
  await pool.end();
});

describe("STATE-FUNC migration-backed normalised identity", () => {
  it("has applied the State identity migration in the active database", async () => {
    const migration = await pool.query<{ filename: string }>(
      "SELECT filename FROM schema_migrations WHERE filename = $1",
      ["034_state_registry_identity"],
    );
    expect(migration.rows).toHaveLength(1);
  });

  it("allows exactly one concurrent whitespace/case-equivalent State create", async () => {
    const code = `SC${suffix.slice(-12)}`.slice(0, 24);
    const writes = await Promise.allSettled([
      insertState(`  Concurrent State ${suffix}  `, ` ${code} `),
      insertState(`concurrent   state ${suffix}`, code.toLowerCase()),
    ]);

    const fulfilled = writes.filter((write) => write.status === "fulfilled");
    const rejected = writes.filter((write) => write.status === "rejected") as PromiseRejectedResult[];
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({ code: "23505" });
  });

  it("rejects a concurrent rename collision while preserving both stable State IDs", async () => {
    const firstId = await insertState(`First Rename ${suffix}`, `RF${suffix.slice(-10)}`.slice(0, 24));
    const secondId = await insertState(`Second Rename ${suffix}`, `RS${suffix.slice(-10)}`.slice(0, 24));
    const targetName = `Shared Rename ${suffix}`;

    const writes = await Promise.allSettled([
      pool.query("UPDATE states SET name = $1 WHERE id = $2 RETURNING id", [targetName, firstId]),
      pool.query("UPDATE states SET name = $1 WHERE id = $2 RETURNING id", [`  shared  rename ${suffix} `, secondId]),
    ]);

    const fulfilled = writes.filter((write) => write.status === "fulfilled") as PromiseFulfilledResult<{ rows: Array<{ id: number }> }>[];
    const rejected = writes.filter((write) => write.status === "rejected") as PromiseRejectedResult[];
    expect(fulfilled).toHaveLength(1);
    expect([firstId, secondId]).toContain(fulfilled[0].value.rows[0].id);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({ code: "23505" });

    const retained = await pool.query<{ id: number }>("SELECT id FROM states WHERE id = ANY($1::int[]) ORDER BY id", [[firstId, secondId]]);
    expect(retained.rows.map((row) => row.id)).toEqual([firstId, secondId].sort((a, b) => a - b));
  });
});