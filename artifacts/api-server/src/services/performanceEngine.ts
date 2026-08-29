import { CANONICAL_TYPES_SQL, operationalPopulationSQL } from "../lib/reportConstants";

export interface PgPool {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
}

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ScopeFilter {
  stateId: number | null;
  sectors: string[] | null;
  projectIds?: number[];
}

/**
 * Pure counterpart to the state-performance CTE population. Keeping this
 * small contract alongside the SQL makes the non-mutating fixture suite able
 * to exercise the same authorisation boundary without a PostgreSQL harness.
 */
export type StatePerformanceProjectFact = {
  id: number;
  deletedAt: unknown | null;
  stateIds: number[];
  sector: string;
};

export function isStatePerformanceProjectInScope(
  project: StatePerformanceProjectFact,
  scope: ScopeFilter,
): boolean {
  if (project.deletedAt !== null) return false;
  if (scope.projectIds !== undefined && !scope.projectIds.includes(project.id)) return false;
  if (scope.stateId !== null && !project.stateIds.includes(scope.stateId)) return false;
  return scope.sectors === null || scope.sectors.includes(project.sector);
}

export function isStatePerformanceStandaloneRecordInScope(
  scope: ScopeFilter,
  sector: string | null,
): boolean {
  if (scope.projectIds !== undefined) return false;
  return scope.sectors === null || (sector !== null && scope.sectors.includes(sector));
}

export interface StateImplementationRow {
  stateId: number;
  stateName: string;
  stateNameAr: string | null;
  totalProjects: number;
  activeProjects: number;
  beneficiaries: number;
  progressPct: number;
  budgetUtilizationPct: number | null;
  activityCompletionPct: number | null;
  reportingCompliancePct: number | null;
  riskLevel: string;
  openRisks: number;
  criticalRisks: number;
  /** Active risks with severity='critical' only — excludes closed/mitigated/resolved/cancelled */
  critOnlyRisks: number;
  /** Active risks with severity='high' only — excludes closed/mitigated/resolved/cancelled */
  highOnlyRisks: number;
  reportsSubmitted: number;
  reportsPending: number;
}

// ─── Project WHERE clause builder (mirrors dashboard.ts projectScopeWhere) ──

function projectWhere(
  scope: ScopeFilter,
  alias: string,
  baseIdx: number,
  includeActiveProject = true,
): { sql: string; params: unknown[]; nextIdx: number } {
  const parts: string[] = includeActiveProject ? [`${alias}.deleted_at IS NULL`] : [];
  const params: unknown[] = [];
  let idx = baseIdx;

  if (scope.projectIds !== undefined) {
    if (scope.projectIds.length === 0) return { sql: " AND FALSE", params: [], nextIdx: idx };
    parts.push(`${alias}.id = ANY($${idx++}::int[])`);
    params.push(scope.projectIds);
  }
  if (scope.stateId !== null) {
    parts.push(
      `EXISTS (SELECT 1 FROM project_states _ps WHERE _ps.project_id = ${alias}.id AND _ps.state_id = $${idx++})`,
    );
    params.push(scope.stateId);
  }
  if (scope.sectors !== null && scope.sectors.length > 0) {
    parts.push(`${alias}.sector = ANY($${idx++}::text[])`);
    params.push(scope.sectors);
  } else if (scope.sectors !== null && scope.sectors.length === 0) {
    return { sql: " AND FALSE", params: [], nextIdx: idx };
  }
  return {
    sql: parts.length ? " AND " + parts.join(" AND ") : "",
    params,
    nextIdx: idx,
  };
}

// ─── Factual State implementation metrics ──────────────────────────────────

export async function computeStateImplementation(
  pool: PgPool,
  scope: ScopeFilter,
): Promise<StateImplementationRow[]> {
  // A State Programme Officer is assigned to projects, not to a complete state
  // portfolio. A state-level aggregate cannot truthfully be presented without
  // mixing in unassigned projects, reports, risks, or indicators.
  if (scope.projectIds !== undefined) return [];
  if (scope.sectors !== null && scope.sectors.length === 0) return [];

  // One materialised parent population is used for *every* constituent fact.
  // Child facts must not infer a TC sector from their own optional sector field:
  // project-linked records are authorised by their canonical parent project.
  // This also retains SPO assignment restrictions for every subaggregate.
  const { sql: projectScopeSql, params: projectScopeParams, nextIdx } = projectWhere(scope, "p", 1);
  const stateWhere = scope.stateId !== null ? `WHERE s.id = $${nextIdx}` : "";
  const params = scope.stateId !== null
    ? [...projectScopeParams, scope.stateId]
    : projectScopeParams;
  // Reports may legitimately be state-owned without a project. Preserve those
  // only when their own canonical report sector is authorised; assignment
  // scopes never authorise standalone records.
  // projectIds has already returned above. When sectors are restricted they
  // are the final parameter emitted by projectWhere, after the optional state.
  const sectorParamIndex = nextIdx - 1;
  const allowsUnsectorisedStandalone = isStatePerformanceStandaloneRecordInScope(scope, null);
  const standaloneReportScope = allowsUnsectorisedStandalone
    ? " OR r.project_id IS NULL"
    : ` OR (r.project_id IS NULL AND (
          (r.report_type = 'activity' AND ra.sector = ANY($${sectorParamIndex}::text[]))
          OR (r.report_type <> 'activity' AND r.sector = ANY($${sectorParamIndex}::text[]))
        ))`;
  const standaloneActivityScope = allowsUnsectorisedStandalone
    ? " OR a.project_id IS NULL"
    : ` OR (a.project_id IS NULL AND a.sector = ANY($${sectorParamIndex}::text[]))`;
  // Beneficiary and risk rows have no independent canonical sector. Retain
  // their historical standalone behaviour only for an unrestricted sector
  // scope; a TC can never receive an unscoped child fact.
  const standaloneBeneficiaryScope = allowsUnsectorisedStandalone ? " OR b.project_id IS NULL" : "";
  const standaloneRiskScope = allowsUnsectorisedStandalone ? " OR r.project_id IS NULL" : "";

  const { rows } = await pool.query(
    `WITH scoped_projects AS (
       SELECT DISTINCT p.id, p.sector
       FROM projects p
       WHERE 1=1${projectScopeSql}
     ),
     scoped_state_projects AS (
       SELECT sp.id AS project_id, sp.sector, ps.state_id
       FROM scoped_projects sp
       JOIN project_states ps ON ps.project_id = sp.id
     )
     SELECT
      s.id AS "stateId",
      s.name AS "stateName",
      s.name_ar AS "stateNameAr",
      COALESCE((SELECT COUNT(DISTINCT ps.project_id)::int
         FROM scoped_state_projects ps JOIN projects p ON p.id = ps.project_id
        WHERE ps.state_id = s.id AND p.status IN ('approved','coordination_approved','technically_approved','active')), 0) AS "activeProjects",
      COALESCE((SELECT COUNT(*)::int FROM beneficiaries b LEFT JOIN scoped_projects sp ON sp.id = b.project_id WHERE b.state_id = s.id AND (sp.id IS NOT NULL${standaloneBeneficiaryScope})), 0) AS beneficiaries,
      NULL::int AS "budgetUtilizationPct", -- BUD-004: no canonical State-level expenditure source; proxy removed
      COALESCE((SELECT AVG(a.progress_pct)::int FROM activities a LEFT JOIN scoped_projects sp ON sp.id = a.project_id WHERE a.state_id = s.id AND (sp.id IS NOT NULL${standaloneActivityScope})), 0) AS "progressPct",
      CASE
        WHEN (SELECT COUNT(*) FROM risks r LEFT JOIN scoped_projects sp ON sp.id = r.project_id WHERE r.state_id = s.id AND (sp.id IS NOT NULL${standaloneRiskScope}) AND r.severity IN ('high','critical') AND r.status NOT IN ('closed','mitigated','resolved','cancelled')) >= 2 THEN 'high'
        WHEN (SELECT COUNT(*) FROM risks r LEFT JOIN scoped_projects sp ON sp.id = r.project_id WHERE r.state_id = s.id AND (sp.id IS NOT NULL${standaloneRiskScope}) AND r.severity IN ('high','critical') AND r.status NOT IN ('closed','mitigated','resolved','cancelled')) >= 1 THEN 'medium'
        ELSE 'low'
      END AS "riskLevel",
      COALESCE((SELECT COUNT(*)::int FROM risks r LEFT JOIN scoped_projects sp ON sp.id = r.project_id WHERE r.state_id = s.id AND (sp.id IS NOT NULL${standaloneRiskScope}) AND r.status NOT IN ('closed','mitigated','resolved','cancelled')), 0) AS "openRisks",
      COALESCE((SELECT COUNT(*)::int FROM risks r LEFT JOIN scoped_projects sp ON sp.id = r.project_id WHERE r.state_id = s.id AND (sp.id IS NOT NULL${standaloneRiskScope}) AND r.severity IN ('critical','high') AND r.status NOT IN ('closed','mitigated','resolved','cancelled')), 0) AS "criticalRisks",
      COALESCE((SELECT COUNT(*)::int FROM risks r LEFT JOIN scoped_projects sp ON sp.id = r.project_id WHERE r.state_id = s.id AND (sp.id IS NOT NULL${standaloneRiskScope}) AND r.severity = 'critical' AND r.status NOT IN ('closed','mitigated','resolved','cancelled')), 0) AS "critOnlyRisks",
      COALESCE((SELECT COUNT(*)::int FROM risks r LEFT JOIN scoped_projects sp ON sp.id = r.project_id WHERE r.state_id = s.id AND (sp.id IS NOT NULL${standaloneRiskScope}) AND r.severity = 'high' AND r.status NOT IN ('closed','mitigated','resolved','cancelled')), 0) AS "highOnlyRisks",
      COALESCE((SELECT COUNT(*)::int FROM reports r LEFT JOIN scoped_projects sp ON sp.id = r.project_id LEFT JOIN activities ra ON ra.id = r.activity_id WHERE r.state_id = s.id AND (sp.id IS NOT NULL${standaloneReportScope}) AND r.status NOT IN ('draft') AND r.report_type = ANY(${CANONICAL_TYPES_SQL}) AND ${operationalPopulationSQL("r")}), 0) AS "reportsSubmitted",
      COALESCE((SELECT COUNT(*)::int FROM reports r LEFT JOIN scoped_projects sp ON sp.id = r.project_id LEFT JOIN activities ra ON ra.id = r.activity_id WHERE r.state_id = s.id AND (sp.id IS NOT NULL${standaloneReportScope}) AND r.status IN ('submitted','coordination_approved','technically_approved') AND r.report_type = ANY(${CANONICAL_TYPES_SQL}) AND ${operationalPopulationSQL("r")}), 0) AS "reportsPending",
      (SELECT
        CASE WHEN COUNT(*) > 0
          THEN (COUNT(*) FILTER (WHERE progress_pct >= 100) * 100 / COUNT(*))::int
          ELSE NULL END
        FROM activities a LEFT JOIN scoped_projects sp ON sp.id = a.project_id WHERE a.state_id = s.id AND (sp.id IS NOT NULL${standaloneActivityScope})) AS "activityCompletionPct",
      (SELECT
        CASE WHEN COUNT(*) > 0
          THEN (COUNT(*) FILTER (WHERE status = 'approved') * 100 / COUNT(*))::int
          ELSE NULL END
        FROM reports r LEFT JOIN scoped_projects sp ON sp.id = r.project_id
        LEFT JOIN activities ra ON ra.id = r.activity_id
        WHERE r.state_id = s.id AND r.status NOT IN ('draft')
          AND (sp.id IS NOT NULL${standaloneReportScope})
          AND r.report_type = ANY(${CANONICAL_TYPES_SQL})
          AND ${operationalPopulationSQL("r")}) AS "reportingCompliancePct",
       (SELECT COUNT(*)::int FROM scoped_state_projects sp WHERE sp.state_id = s.id) AS "totalProjects"
    FROM states s ${stateWhere}
    ORDER BY beneficiaries DESC`,
    params,
  );

  return rows.map((row: Record<string, unknown>) => {
    return {
      stateId: Number(row.stateId),
      stateName: String(row.stateName),
      stateNameAr: row.stateNameAr == null ? null : String(row.stateNameAr),
      totalProjects: Number(row.totalProjects ?? row.activeProjects),
      activeProjects: Number(row.activeProjects),
      beneficiaries: Number(row.beneficiaries),
      progressPct: Number(row.progressPct),
      budgetUtilizationPct: null, // BUD-004: proxy removed; no canonical State-level expenditure source
      activityCompletionPct: row.activityCompletionPct != null ? Number(row.activityCompletionPct) : null,
      reportingCompliancePct: row.reportingCompliancePct != null ? Number(row.reportingCompliancePct) : null,
      riskLevel: String(row.riskLevel),
      openRisks: Number(row.openRisks ?? 0),
      criticalRisks: Number(row.criticalRisks ?? 0),
      critOnlyRisks: Number(row.critOnlyRisks ?? 0),
      highOnlyRisks: Number(row.highOnlyRisks ?? 0),
      reportsSubmitted: Number(row.reportsSubmitted ?? 0),
      reportsPending: Number(row.reportsPending),
    };
  });
}

// ─── Hierarchical Performance Calculation ──────────────────────────────────
//
// Approved hierarchy: Indicator → Project → Sector → Average
//   1. Indicator Achievement Rate  = achieved / target × 100 (no cap)
//   2. Project Achievement Rate    = equal-weight average of valid indicator rates
//   3. Sector Achievement Rate     = equal-weight average of valid project rates
//   4. Average Sector Achievement  = equal-weight average of valid sector rates
//
// Raw indicator values with potentially incompatible units are never summed
// across indicators. Each level is calculated independently and remains
// individually traceable.

export interface ProjectHierarchicalRow {
  projectId: number;
  projectCode: string;
  projectTitle: string;
  /** Null means the source project has no resolved sector assignment. */
  sector: string | null;
  stateNames: string[];
  validIndicatorCount: number;
  missingIndicatorCount: number;
  /** 1 dp. Null when no valid indicator data exists for this project. */
  projectAchievementRate: number | null;
}

export interface SectorHierarchicalRow {
  /** Null is the canonical unavailable state for unresolved project sectors. */
  sector: string | null;
  projectCount: number;
  validProjectCount: number;
  insufficientProjectCount: number;
  /** 1 dp. Null when no project in the sector has valid indicator data. */
  sectorAchievementRate: number | null;
  projects: ProjectHierarchicalRow[];
}

export interface HierarchicalPerformance {
  /** 1 dp. Null when no sector has valid data. */
  averageSectorAchievementRate: number | null;
  validSectorCount: number;
  validProjectCount: number;
  sectors: SectorHierarchicalRow[];
}

/**
 * Keep source labels truthful at the hierarchy boundary. Projects may have a
 * nullable sector while awaiting manual resolution; empty and known placeholder
 * values are treated the same way rather than being presented as a real sector.
 */
export function normalizePerformanceLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const label = value.trim();
  if (!label) return null;
  if (["unknown", "unresolved", "n/a", "not available"].includes(label.toLowerCase())) {
    return null;
  }
  return label;
}

function comparePerformanceLabels(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a.localeCompare(b);
}

/**
 * Pure. Indicator achievement rate.
 * Overachievement (achieved > target) is preserved — values above 100% are valid.
 * Returns null when target ≤ 0 or either value is null / undefined.
 */
export function calculateIndicatorAchievement(
  target: number | null | undefined,
  achieved: number | null | undefined,
): number | null {
  if (target == null || achieved == null) return null;
  if (target <= 0) return null;
  return (achieved / target) * 100;
}

/**
 * Pure. Project achievement rate = equal-weight average of valid indicator rates.
 * Indicators with missing or zero targets are excluded and counted as missing.
 */
export function calculateProjectAchievement(
  indicators: Array<{ target: number | null; achieved: number | null }>,
): { rate: number | null; validCount: number; missingCount: number } {
  let sum = 0;
  let validCount = 0;
  let missingCount = 0;
  for (const ind of indicators) {
    const rate = calculateIndicatorAchievement(ind.target, ind.achieved);
    if (rate !== null) {
      sum += rate;
      validCount++;
    } else {
      missingCount++;
    }
  }
  return {
    rate: validCount > 0 ? sum / validCount : null,
    validCount,
    missingCount,
  };
}

/**
 * Pure. Sector achievement rate = equal-weight average of valid project rates.
 * Projects with null rates (no valid indicator data) are excluded and counted as insufficient.
 */
export function calculateSectorAchievement(
  projectRates: Array<number | null>,
): { rate: number | null; validCount: number; insufficientCount: number } {
  const valid = projectRates.filter((r): r is number => r !== null);
  return {
    rate: valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : null,
    validCount: valid.length,
    insufficientCount: projectRates.length - valid.length,
  };
}

/**
 * Pure. Average sector achievement rate = equal-weight average of valid sector rates.
 */
export function calculateAverageSectorAchievement(
  sectorRates: Array<number | null>,
): { rate: number | null; validCount: number } {
  const valid = sectorRates.filter((r): r is number => r !== null);
  return {
    rate: valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : null,
    validCount: valid.length,
  };
}

/**
 * Full indicator → project → sector → average hierarchy computation.
 *
 * @param filterSql    Pre-built SQL fragment ($N-indexed) for the projects table
 *                     aliased as "p", appended as `WHERE 1=1${filterSql}`.
 * @param filterParams Bound params matching the placeholders in filterSql.
 */
export async function computeHierarchicalPerformance(
  pool: PgPool,
  filterSql: string,
  filterParams: unknown[],
): Promise<HierarchicalPerformance> {
  // 1. Fetch all in-scope projects
  const projectRows = await pool.query<{
    id: number; code: string; title: string; sector: string;
  }>(
    `SELECT p.id, p.code, p.title, p.sector
     FROM projects p
     WHERE p.deleted_at IS NULL${filterSql}
     ORDER BY p.sector, p.code`,
    filterParams,
  );

  if (projectRows.rows.length === 0) {
    return { averageSectorAchievementRate: null, validSectorCount: 0, validProjectCount: 0, sectors: [] };
  }

  const projectIds = projectRows.rows.map((r) => r.id);

  // 2. Fetch state names for all in-scope projects (single query)
  const stateRows = await pool.query<{ project_id: number; state_name: string }>(
    `SELECT ps.project_id, s.name AS state_name
     FROM project_states ps
     JOIN states s ON s.id = ps.state_id
     WHERE ps.project_id = ANY($1::int[])
     ORDER BY s.name`,
    [projectIds],
  );
  const statesByProject = new Map<number, string[]>();
  for (const row of stateRows.rows) {
    const arr = statesByProject.get(row.project_id) ?? [];
    arr.push(row.state_name);
    statesByProject.set(row.project_id, arr);
  }

  // 3. Fetch all indicators for in-scope projects (single query)
  const indRows = await pool.query<{
    project_id: number; target: string | null; achieved: string | null;
  }>(
    `SELECT project_id, target::float AS target, achieved::float AS achieved
     FROM indicators
     WHERE project_id = ANY($1::int[])`,
    [projectIds],
  );
  const indsByProject = new Map<number, Array<{ target: number | null; achieved: number | null }>>();
  for (const row of indRows.rows) {
    const arr = indsByProject.get(row.project_id) ?? [];
    arr.push({
      target: row.target != null ? Number(row.target) : null,
      achieved: row.achieved != null ? Number(row.achieved) : null,
    });
    indsByProject.set(row.project_id, arr);
  }

  // 4. Compute per-project rates
  const projectPerf = projectRows.rows.map((p) => {
    const indicators = indsByProject.get(p.id) ?? [];
    const { rate, validCount, missingCount } = calculateProjectAchievement(indicators);
    return {
      rawRate: rate,
      row: {
        projectId: p.id,
        projectCode: p.code,
        projectTitle: p.title,
        sector: normalizePerformanceLabel(p.sector),
        stateNames: statesByProject.get(p.id) ?? [],
        validIndicatorCount: validCount,
        missingIndicatorCount: missingCount,
        projectAchievementRate: rate != null ? Math.round(rate * 10) / 10 : null,
      } satisfies ProjectHierarchicalRow,
    };
  });

  // 5. Group by sector and compute sector rates
  const sectorMap = new Map<string | null, typeof projectPerf>();
  for (const p of projectPerf) {
    const arr = sectorMap.get(p.row.sector) ?? [];
    arr.push(p);
    sectorMap.set(p.row.sector, arr);
  }

  const sectors: Array<{ rawRate: number | null; row: SectorHierarchicalRow }> = [];
  for (const [sector, projects] of sectorMap) {
    const { rate, validCount, insufficientCount } = calculateSectorAchievement(
      projects.map((p) => p.rawRate),
    );
    sectors.push({
      rawRate: rate,
      row: {
        sector,
        projectCount: projects.length,
        validProjectCount: validCount,
        insufficientProjectCount: insufficientCount,
        sectorAchievementRate: rate != null ? Math.round(rate * 10) / 10 : null,
        projects: projects.map((p) => p.row),
      },
    });
  }
  sectors.sort((a, b) => comparePerformanceLabels(a.row.sector, b.row.sector));

  // 6. Compute average sector achievement rate
  const { rate: avgRate, validCount: validSectorCount } = calculateAverageSectorAchievement(
    sectors.map((s) => s.rawRate),
  );
  const validProjectCount = projectPerf.filter((p) => p.rawRate !== null).length;

  return {
    averageSectorAchievementRate: avgRate != null ? Math.round(avgRate * 10) / 10 : null,
    validSectorCount,
    validProjectCount,
    sectors: sectors.map((s) => s.row),
  };
}
