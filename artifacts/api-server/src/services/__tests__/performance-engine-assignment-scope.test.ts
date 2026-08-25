import { describe, expect, it } from "vitest";
import {
  computeOrgScore,
  computeHierarchicalPerformance,
  computeProjectScores,
  computeStateScores,
  type PgPool,
} from "../performanceEngine";

function rowsForOrgScore(sql: string) {
  if (sql.includes("total_submitted")) return { rows: [{ total_submitted: 0, total_approved: 0, late_pending: 0 }] };
  if (sql.includes("avg_pct")) return { rows: [{ avg_pct: null }] };
  if (sql.includes("total_budget")) return { rows: [{ total_budget: 0, total_spent: 0 }] };
  if (sql.includes("critical_count")) return { rows: [{ critical_count: 0, high_count: 0, med_low_count: 0, total_count: 0 }] };
  if (sql.includes("total_projects")) return { rows: [{ total_projects: 0, has_budget: 0, has_activities: 0, has_reports: 0, has_targets: 0 }] };
  return { rows: [{ score: null }] };
}

describe("performance engine project-assignment scope", () => {
  it("composes assigned project IDs with the state clamp for every organisation score component", async () => {
    const calls: Array<{ sql: string; params: unknown[] | undefined }> = [];
    const pool = {
      query: async (sql: string, params?: unknown[]) => {
        calls.push({ sql, params });
        return rowsForOrgScore(sql);
      },
    } as unknown as PgPool;

    await computeOrgScore(pool, { stateId: 7, sectors: null, projectIds: [101] });

    const projectScoped = calls.filter(({ sql }) =>
      sql.includes("FROM activities") || sql.includes("FROM reports") ||
      sql.includes("FROM risks") || sql.includes("FROM projects"),
    );
    expect(projectScoped).not.toHaveLength(0);
    for (const call of projectScoped) {
      expect(call.sql).toContain("p.id = ANY($1::int[])");
      expect(call.sql).toContain("ps.state_id = $2");
      expect(call.params).toEqual([[101], 7]);
    }

    const indicator = calls.find(({ sql }) => sql.includes("FROM indicators i"));
    expect(indicator?.sql).toContain("i.project_id = ANY($1::int[])");
    expect(indicator?.sql).toContain("ps.state_id = $2");
    expect(indicator?.params).toEqual([[101], 7]);
  });

  it("does not expose a state aggregate to a project-assigned officer", async () => {
    let called = false;
    const pool: PgPool = { query: async () => { called = true; return { rows: [] }; } };

    await expect(computeStateScores(pool, { stateId: 7, sectors: null, projectIds: [101] })).resolves.toEqual([]);
    expect(called).toBe(false);
  });

  it("keeps the state clamp when rendering assigned project performance", async () => {
    const calls: Array<{ sql: string; params: unknown[] | undefined }> = [];
    const pool: PgPool = {
      query: async (sql, params) => {
        calls.push({ sql, params });
        return { rows: [] };
      },
    };

    await computeProjectScores(pool, { stateId: 7, sectors: null, projectIds: [101] });

    expect(calls[0]?.sql).toContain("p.id = ANY($1::int[])");
    expect(calls[0]?.sql).toContain("ps.state_id = $2");
    expect(calls[0]?.params).toEqual([[101], 7]);
  });

  it("excludes retired parents from organisation, project, and hierarchical performance populations", async () => {
    const calls: Array<{ sql: string; params: unknown[] | undefined }> = [];
    const pool = {
      query: async (sql: string, params?: unknown[]) => {
        calls.push({ sql, params });
        return rowsForOrgScore(sql);
      },
    } as unknown as PgPool;

    await computeOrgScore(pool, { stateId: null, sectors: null });
    const orgProjectRoots = calls.filter(({ sql }) =>
      sql.includes("FROM activities a") || sql.includes("FROM projects p"),
    );
    expect(orgProjectRoots).not.toHaveLength(0);
    for (const call of orgProjectRoots) expect(call.sql).toContain("p.deleted_at IS NULL");

    const orgChildren = calls.filter(({ sql }) =>
      sql.includes("total_submitted") || sql.includes("critical_count"),
    );
    expect(orgChildren).not.toHaveLength(0);
    for (const call of orgChildren) expect(call.sql).toContain("active_parent.deleted_at IS NULL");

    calls.length = 0;
    await computeProjectScores(pool, { stateId: null, sectors: null });
    expect(calls[0]?.sql).toContain("p.deleted_at IS NULL");

    calls.length = 0;
    await computeHierarchicalPerformance(pool, "", []);
    expect(calls[0]?.sql).toContain("p.deleted_at IS NULL");
  });
});