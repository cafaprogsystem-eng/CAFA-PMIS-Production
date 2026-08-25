/**
 * Shared PMR expected-location resolution + status ranking.
 *
 * Single source of truth used by:
 *   - GET /dashboard/pmr-reporting-completeness (Phase 1, PMR-015 Option C)
 *   - GET /reports/consolidated (Consolidated Project View, BD-5 Option B)
 *
 * Source of truth for expected Reporting Locations:
 *   project_states rows + projects.has_hq_operations flag.
 * HQ first, then states alphabetically by name.
 */

/** Minimal structural pool type — avoids a hard dependency on pg types. */
export interface Pool {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export interface ResolvedLocation {
  locationType: "hq" | "state";
  stateId: number | null;
  locationName: string;
}

export interface ProjectStateLocationRow {
  project_id: number;
  state_id: number;
  state_name: string;
}

/** Statuses meaning the PMR has entered the workflow ("submitted"). */
export const PMR_COMP_SUBMITTED_STATUSES = new Set([
  "submitted",
  "state_reviewed",
  "technically_reviewed",
  "technically_approved",
  "coordination_reviewed",
  "coordination_approved",
  "approved",
]);

/** Ranking used to pick the most relevant report when a location has several
 * (e.g. a rejected report plus a new draft). Higher wins. */
export function pmrCompStatusRank(status: string): number {
  if (status === "approved") return 5;
  if (PMR_COMP_SUBMITTED_STATUSES.has(status)) return 4;
  if (status === "rejected") return 3;
  if (status === "draft") return 2;
  return 1;
}

/**
 * Queries the operational state locations for a batch of projects.
 * When stateClamp is set (state-scoped roles), only that state is returned —
 * location existence for other states must not leak.
 */
export async function queryProjectStateLocations(
  pool: Pool,
  projectIds: number[],
  stateClamp: number | null = null,
): Promise<ProjectStateLocationRow[]> {
  if (projectIds.length === 0) return [];
  const stParams: unknown[] = [projectIds];
  let stClampSql = "";
  if (stateClamp !== null) {
    stClampSql = " AND ps.state_id = $2";
    stParams.push(stateClamp);
  }
  const stRes = await pool.query(
    `SELECT ps.project_id, ps.state_id, s.name AS state_name
       FROM project_states ps
       JOIN states s ON s.id = ps.state_id
      WHERE ps.project_id = ANY($1::int[])${stClampSql}
      ORDER BY s.name`,
    stParams,
  );
  return stRes.rows as unknown as ProjectStateLocationRow[];
}

/**
 * Returns the authoritative expected Reporting Locations for a project.
 * Source of truth: project_states rows + has_hq_operations flag.
 * HQ first, then states alphabetically by name.
 *
 * Scope rules:
 *   - stateClamp (state-scoped roles): only their own state is returned;
 *     HQ is never an expected location for state-clamped users.
 *   - hasHqOperations may be passed when the caller already fetched the
 *     project row (avoids a redundant query).
 */
export async function resolveExpectedLocations(
  pool: Pool,
  projectId: number,
  opts: { stateClamp?: number | null; hasHqOperations?: boolean } = {},
): Promise<ResolvedLocation[]> {
  const stateClamp = opts.stateClamp ?? null;

  let hasHq = opts.hasHqOperations;
  if (hasHq === undefined) {
    const pr = await pool.query(
      `SELECT has_hq_operations AS "hasHqOperations" FROM projects WHERE id = $1`,
      [projectId],
    );
    hasHq = pr.rows.length > 0 ? Boolean(pr.rows[0].hasHqOperations) : false;
  }

  const stateRows = await queryProjectStateLocations(pool, [projectId], stateClamp);

  const locations: ResolvedLocation[] = [];
  // HQ is not an expected location for state-clamped users — they only
  // see (and report for) their own state.
  if (hasHq && stateClamp === null) {
    locations.push({ locationType: "hq", stateId: null, locationName: "HQ" });
  }
  for (const s of stateRows) {
    locations.push({ locationType: "state", stateId: s.state_id, locationName: s.state_name });
  }
  return locations;
}
