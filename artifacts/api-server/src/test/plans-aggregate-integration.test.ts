/**
 * PLAN-015 / Task #523 — Real-database aggregate verification.
 *
 * Executes the EXACT production `planSummarySelect` SQL (imported from
 * routes/plans.ts — no copy that could drift) against a live PostgreSQL
 * instance, seeding Plans with:
 *   - multiple activities (mixed statuses incl. cancelled)
 *   - only-cancelled activities
 *   - no activities
 *   - multiple sectors (JSONB sectors array)
 *
 * All seed rows are created inside a single transaction that is ROLLED BACK,
 * so the shared development database is never mutated.
 *
 * Verifies (spec §30 / §40 / §65):
 *   1. One result row per Plan regardless of activity count (no fan-out).
 *   2. AVG progress is correct and cancelled activities are excluded from
 *      numerator AND denominator.
 *   3. All-cancelled → progressPct NULL (not 0).
 *   4. Zero activities → progressPct NULL, activitiesCount 0.
 *   5. Effective-sectors array (EFFECTIVE_SECTORS_SQL) resolves the JSONB
 *      sectors column verbatim.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool } from "@workspace/db";
import { planSummarySelect } from "../routes/plans.js";

if (!process.env.DATABASE_URL) {
  // Fail loudly — this closure-critical verification must not silently skip.
  throw new Error(
    "plans-aggregate-integration: DATABASE_URL is required for the PLAN-015 real-DB verification (#523).",
  );
}

type TransactionClient = {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  release: () => void;
};
let client: TransactionClient;
const ids: Record<string, number> = {};

beforeAll(async () => {
  client = await pool.connect() as unknown as TransactionClient;
  await client.query("BEGIN");

  async function seedPlan(code: string, sectors: string[] | null): Promise<number> {
    const r = await client.query<{ id: number }>(
      `INSERT INTO plans (code, title, plan_type, start_date, end_date, location_type, status, sectors)
       VALUES ($1, $2, 'monthly', '2099-01-01', '2099-01-31', 'hq', 'active', $3::jsonb)
       RETURNING id`,
      [code, `ZR integration ${code}`, sectors ? JSON.stringify(sectors) : null],
    );
    return r.rows[0].id;
  }

  ids.mixed = await seedPlan("ZRIT-MIXED", ["Health", "WASH"]);
  ids.allCancelled = await seedPlan("ZRIT-CANC", ["Health"]);
  ids.empty = await seedPlan("ZRIT-EMPTY", null);

  const acts: Array<[number, string, number]> = [
    [ids.mixed, "completed", 100],
    [ids.mixed, "in_progress", 50],
    [ids.mixed, "cancelled", 10], // must not affect AVG
    [ids.allCancelled, "cancelled", 0],
    [ids.allCancelled, "cancelled", 100],
  ];
  for (const [planId, status, pct] of acts) {
    await client.query(
      `INSERT INTO plan_activities (plan_id, title, status, progress_pct)
       VALUES ($1, $2, $3, $4)`,
      [planId, `act-${status}-${pct}`, status, pct],
    );
  }
});

afterAll(async () => {
  await client.query("ROLLBACK");
  client.release();
  await pool.end();
});

describe("PLAN-015 real-DB aggregate verification (Task #523)", () => {
  async function fetchRows() {
    const res = await client.query(
      `${planSummarySelect} WHERE pl.id = ANY($1::int[]) ORDER BY pl.id`,
      [[ids.mixed, ids.allCancelled, ids.empty]],
    );
    return res.rows as Array<Record<string, unknown>>;
  }

  it("returns exactly one row per plan — no fan-out from the pre-aggregated LEFT JOIN", async () => {
    const rows = await fetchRows();
    expect(rows).toHaveLength(3);
    const idCounts = new Map<number, number>();
    for (const r of rows) idCounts.set(r.id as number, (idCounts.get(r.id as number) ?? 0) + 1);
    for (const [, n] of idCounts) expect(n).toBe(1);
  });

  it("computes AVG over non-cancelled activities only (100+50 → 75; cancelled 10 excluded)", async () => {
    const rows = await fetchRows();
    const mixed = rows.find((r) => r.id === ids.mixed)!;
    expect(mixed.progressPct).toBe(75);
    expect(mixed.activitiesCount).toBe(3); // count includes cancelled; AVG does not
  });

  it("returns NULL progress when every activity is cancelled (not 0)", async () => {
    const rows = await fetchRows();
    const canc = rows.find((r) => r.id === ids.allCancelled)!;
    expect(canc.progressPct).toBeNull();
    expect(canc.activitiesCount).toBe(2);
  });

  it("returns NULL progress and 0 activitiesCount for a plan with no activities", async () => {
    const rows = await fetchRows();
    const empty = rows.find((r) => r.id === ids.empty)!;
    expect(empty.progressPct).toBeNull();
    expect(empty.activitiesCount).toBe(0);
  });

  it("resolves effective sectors from the JSONB sectors column (PLAN-009 precedence)", async () => {
    const rows = await fetchRows();
    const mixed = rows.find((r) => r.id === ids.mixed)!;
    expect(mixed.sectors).toEqual(["Health", "WASH"]);
    const empty = rows.find((r) => r.id === ids.empty)!;
    expect(empty.sectors).toEqual([]); // no sectors, no legacy sector, no project
  });

  it("the production SQL contains no per-row correlated plan_activities subquery", () => {
    expect(planSummarySelect).not.toContain("WHERE pa.plan_id = pl.id");
    expect(planSummarySelect).toContain("GROUP BY plan_id");
    expect(planSummarySelect).toContain('ON pa_agg.plan_id = pl.id');
  });
});
