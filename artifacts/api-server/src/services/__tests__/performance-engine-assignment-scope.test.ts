import { describe, expect, it } from "vitest";
import {
  computeOrgScore,
  computeHierarchicalPerformance,
  computeProjectScores,
  computeStateScores,
  isStatePerformanceProjectInScope,
  isStatePerformanceStandaloneRecordInScope,
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
  it("fixture-evaluates TC state facts with no cross-sector or Task-860 report leakage", () => {
    // This is deliberately an in-memory fixture: this repository has no
    // disposable PostgreSQL/pg-mem integration harness. The pure scope
    // contract below is also used by computeStateScores' standalone SQL
    // branch; the SQL assertions following this test lock the CTE mapping.
    const scope = { stateId: 7, sectors: ["Health"] };
    const projects = [
      { id: 1, deletedAt: null, stateIds: [7], sector: "Health" },
      { id: 2, deletedAt: null, stateIds: [7], sector: "WASH" },
      { id: 3, deletedAt: "retired", stateIds: [7], sector: "Health" },
    ];
    const allowedProjectIds = new Set(projects
      .filter(project => isStatePerformanceProjectInScope(project, scope))
      .map(project => project.id));
    const projectFact = (projectId: number | null, standaloneSector: string | null) =>
      projectId !== null
        ? allowedProjectIds.has(projectId)
        : isStatePerformanceStandaloneRecordInScope(scope, standaloneSector);
    const reports = [
      { projectId: 1, sector: "Health", activitySector: null, duplicate: false, unverified: false },
      { projectId: 2, sector: "WASH", activitySector: null, duplicate: false, unverified: false },
      { projectId: null, sector: "Health", activitySector: "Health", duplicate: false, unverified: false },
      { projectId: 1, sector: "Health", activitySector: null, duplicate: true, unverified: false },
      { projectId: 1, sector: "Health", activitySector: null, duplicate: false, unverified: true },
    ];
    const operationalReports = reports.filter(report =>
      !report.duplicate && !report.unverified &&
      projectFact(report.projectId, report.activitySector ?? report.sector),
    );

    // Same-state WASH project facts and retired Health facts are absent; an
    // activity/report standalone Health record remains valid for the TC.
    expect([1, 2, 3].filter(id => projectFact(id, null))).toEqual([1]);
    expect([{ projectId: 1, sector: null }, { projectId: 2, sector: null }, { projectId: null, sector: "Health" }]
      .filter(fact => projectFact(fact.projectId, fact.sector))).toHaveLength(2); // activities
    expect([{ projectId: 1 }, { projectId: 2 }, { projectId: null }]
      .filter(fact => projectFact(fact.projectId, null))).toHaveLength(1); // beneficiaries/risks
    expect(operationalReports).toHaveLength(2);
    expect(operationalReports.map(report => report.projectId)).toEqual([1, null]);

    const beneficiaries = [{ projectId: 1, value: 10 }, { projectId: 2, value: 900 }, { projectId: null, value: 800 }];
    const activities = [{ projectId: 1, sector: null, progress: 100 }, { projectId: 2, sector: null, progress: 0 }, { projectId: null, sector: "Health", progress: 50 }];
    const risks = [{ projectId: 1 }, { projectId: 2 }, { projectId: null }];
    // The fixture-derived state KPI inputs prove the intended returned values:
    // cross-sector project-linked values and unsectorised standalone child rows
    // cannot inflate a Health TC's state score.
    expect(beneficiaries.filter(row => projectFact(row.projectId, null)).reduce((sum, row) => sum + row.value, 0)).toBe(10);
    expect(activities.filter(row => projectFact(row.projectId, row.sector)).map(row => row.progress)).toEqual([100, 50]);
    expect(risks.filter(row => projectFact(row.projectId, null))).toHaveLength(1);
  });

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

  it("binds every state-performance fact to one canonical sector-scoped project population", async () => {
    const calls: Array<{ sql: string; params: unknown[] | undefined }> = [];
    const pool: PgPool = {
      query: async (sql, params) => {
        calls.push({ sql, params });
        return { rows: [] };
      },
    };

    await computeStateScores(pool, { stateId: null, sectors: ["Health"] });

    expect(calls).toHaveLength(1);
    const { sql, params } = calls[0]!;
    // The CTE is the sole sector predicate; every child fact joins it by
    // canonical project ID rather than trusting a child-sector field.
    expect(sql).toContain("WITH scoped_projects AS");
    expect(sql).toContain("p.sector = ANY($1::text[])");
    expect(params).toEqual([["Health"]]);
    for (const table of ["beneficiaries b LEFT JOIN scoped_projects", "activities a LEFT JOIN scoped_projects", "risks r LEFT JOIN scoped_projects", "reports r LEFT JOIN scoped_projects"]) {
      expect(sql).toContain(table);
    }
    expect(sql).toMatch(/indicators i\s+JOIN scoped_state_projects sp ON sp\.project_id = i\.project_id/);
  });

  it("uses the sector parameter rather than the state parameter for combined state and sector scope", async () => {
    const calls: Array<{ sql: string; params: unknown[] | undefined }> = [];
    const pool: PgPool = {
      query: async (sql, params) => {
        calls.push({ sql, params });
        return { rows: [] };
      },
    };

    await computeStateScores(pool, { stateId: 7, sectors: ["Health"] });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.params).toEqual([7, ["Health"], 7]);
    expect(calls[0]?.sql).toContain("p.sector = ANY($2::text[])");
    expect(calls[0]?.sql).toContain("ra.sector = ANY($2::text[])");
    expect(calls[0]?.sql).toContain("FROM states s WHERE s.id = $3");
  });

  it("excludes Task-860 migration report records from every state-performance report fact", async () => {
    const calls: string[] = [];
    const pool: PgPool = {
      query: async (sql) => {
        calls.push(sql);
        return { rows: [] };
      },
    };

    await computeStateScores(pool, { stateId: null, sectors: ["Health"] });

    const sql = calls[0]!;
    expect(sql).toContain("r.migration_is_duplicate = FALSE");
    expect(sql).toContain("r.migration_status_unverified = FALSE");
    expect((sql.match(/r\.migration_is_duplicate = FALSE/g) ?? []).length).toBeGreaterThanOrEqual(5);
    expect((sql.match(/r\.report_type = ANY/g) ?? []).length).toBeGreaterThanOrEqual(5);
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