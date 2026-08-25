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

export interface ComponentScores {
  activityCompletion: number | null;
  reportSubmission: number | null;
  indicatorAchievement: number | null;
  budgetUtilization: number | null;
  riskManagement: number | null;
  dataCompleteness: number | null;
}

export interface PerformanceScore {
  overallScore: number | null;
  tier: string;
  components: ComponentScores;
  dataAvailable: boolean;
}

export interface StateScoreRow {
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
  performanceScore: number | null;
  performanceTier: string;
  components: ComponentScores;
  // Trend tracking — previousScore is null until historical snapshots are stored
  currentScore: number | null;
  previousScore: number | null;
  scoreDifference: number | null;
  trendDirection: "up" | "down" | "stable" | null;
}

export interface ProjectScoreRow {
  projectId: number;
  projectCode: string;
  projectTitle: string;
  sector: string;
  stateNames: string[];
  status: string;
  overallScore: number | null;
  tier: string;
  components: ComponentScores;
  activityCount: number;
  openRisks: number;
  criticalRisks: number;
  recentReportStatus: string | null;
}

// ─── Weight constants ───────────────────────────────────────────────────────

const W = {
  activityCompletion:   0.25,
  reportSubmission:     0.20,
  indicatorAchievement: 0.20,
  budgetUtilization:    0.15,
  riskManagement:       0.10,
  dataCompleteness:     0.10,
} as const;

// ─── Pure helpers ───────────────────────────────────────────────────────────

export function budgetUtilScore(utilPct: number): number {
  if (utilPct <= 0) return 0;
  if (utilPct <= 85) return Math.round((utilPct / 85) * 100);
  return Math.max(0, Math.round(100 - (utilPct - 85) * 1.5));
}

export function computeWeightedScore(c: ComponentScores): number | null {
  const keys = Object.keys(W) as (keyof typeof W)[];
  let weightedSum = 0;
  let totalWeight = 0;
  let dataCount = 0;
  for (const key of keys) {
    const val = c[key as keyof ComponentScores];
    if (val !== null && val !== undefined) {
      weightedSum += val * W[key];
      totalWeight += W[key];
      dataCount++;
    }
  }
  if (dataCount < 2 || totalWeight === 0) return null;
  return Math.round(weightedSum / totalWeight);
}

export function scoreTier(score: number | null): string {
  if (score === null) return "insufficient";
  if (score >= 80) return "excellent";
  if (score >= 60) return "good";
  if (score >= 40) return "needs-follow-up";
  return "critical";
}

function riskScore(criticalCount: number, highCount: number, medLowCount: number): number {
  return Math.max(0, 100 - criticalCount * 20 - highCount * 10 - medLowCount * 2);
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

/** Retained standalone records stay visible; project-owned records need an active parent. */
function activeProjectParentSQL(projectIdExpression: string): string {
  return `(
    ${projectIdExpression} IS NULL
    OR EXISTS (
      SELECT 1 FROM projects active_parent
      WHERE active_parent.id = ${projectIdExpression}
        AND active_parent.deleted_at IS NULL
    )
  )`;
}

// ─── Org-level score ────────────────────────────────────────────────────────

export async function computeOrgScore(
  pool: PgPool,
  scope: ScopeFilter,
): Promise<PerformanceScore> {
  const { sql: pSql, params: pParams, nextIdx } = projectWhere(scope, "p", 1);
  const { sql: childProjectScopeSql } = projectWhere(scope, "p", 1, false);

  const [actRow, repRow, indRow, budRow, riskRow, dataRow] = await Promise.all([
    // 1. Activity completion
    pool.query<{ score: string | null }>(
      `SELECT AVG(a.progress_pct)::float AS score
       FROM activities a
       JOIN projects p ON p.id = a.project_id
       WHERE 1=1${pSql}`,
      pParams,
    ),
    // 2. Report submission & timeliness
    pool.query<{ total_submitted: string; total_approved: string; late_pending: string }>(
      `SELECT
         COUNT(*) FILTER (WHERE r.status != 'draft')::int AS total_submitted,
         COUNT(*) FILTER (WHERE r.status = 'approved')::int AS total_approved,
         COUNT(*) FILTER (
           WHERE r.status IN ('submitted','coordination_approved','technically_approved')
             AND r.submitted_at < NOW() - INTERVAL '21 days'
         )::int AS late_pending
       FROM reports r
       LEFT JOIN projects p ON p.id = r.project_id
        WHERE 1=1${childProjectScopeSql}
          AND ${activeProjectParentSQL("r.project_id")}`,
      pParams,
    ),
    // 3. Indicator achievement — computed as the average of per-sector achievement rates.
    //    This matches the sector-performance chart calculation and prevents a single sector
    //    with an outlier-scale target from collapsing the org-wide rate to 0%.
    pool.query<{ avg_pct: string | null }>(
      scope.projectIds !== undefined
        ? scope.projectIds.length === 0
          ? `SELECT NULL::float AS avg_pct`
          : `SELECT AVG(sector_pct)::float AS avg_pct
             FROM (
               SELECT CASE WHEN SUM(i.target) > 0
                           THEN LEAST(100, SUM(i.achieved) / SUM(i.target) * 100)
                           ELSE NULL END AS sector_pct
               FROM indicators i
               JOIN projects p ON p.id = i.project_id
                WHERE p.deleted_at IS NULL AND i.project_id = ANY($1::int[])
                 ${scope.stateId !== null ? `AND EXISTS (SELECT 1 FROM project_states ps WHERE ps.project_id = p.id AND ps.state_id = $2)` : ""}
               GROUP BY i.sector
             ) sub
             WHERE sector_pct IS NOT NULL`
        : scope.sectors !== null && scope.sectors.length > 0
        ? `SELECT AVG(sector_pct)::float AS avg_pct
           FROM (
             SELECT CASE WHEN SUM(i.target) > 0
                         THEN LEAST(100, SUM(i.achieved) / SUM(i.target) * 100)
                         ELSE NULL END AS sector_pct
              FROM indicators i
              JOIN projects p ON p.id = i.project_id AND p.deleted_at IS NULL
              WHERE i.sector = ANY($1::text[])
             GROUP BY i.sector
           ) sub
           WHERE sector_pct IS NOT NULL`
        : scope.stateId !== null
          ? `SELECT AVG(sector_pct)::float AS avg_pct
             FROM (
               SELECT CASE WHEN SUM(i.target) > 0
                           THEN LEAST(100, SUM(i.achieved) / SUM(i.target) * 100)
                           ELSE NULL END AS sector_pct
                FROM indicators i
                JOIN projects indicator_project ON indicator_project.id = i.project_id
                  AND indicator_project.deleted_at IS NULL
               WHERE i.sector IN (
                 SELECT DISTINCT p.sector FROM projects p
                 JOIN project_states ps ON ps.project_id = p.id
                  WHERE p.deleted_at IS NULL AND ps.state_id = $1
               )
               GROUP BY i.sector
             ) sub
             WHERE sector_pct IS NOT NULL`
          : `SELECT AVG(sector_pct)::float AS avg_pct
               FROM (
                 SELECT CASE WHEN SUM(i.target) > 0
                             THEN LEAST(100, SUM(i.achieved) / SUM(i.target) * 100)
                             ELSE NULL END AS sector_pct
                  FROM indicators i
                  JOIN projects p ON p.id = i.project_id AND p.deleted_at IS NULL
                 GROUP BY i.sector
               ) sub
               WHERE sector_pct IS NOT NULL`,
      scope.projectIds !== undefined && scope.projectIds.length > 0
        ? scope.stateId !== null ? [scope.projectIds, scope.stateId] : [scope.projectIds]
        : scope.sectors !== null && scope.sectors.length > 0
        ? [scope.sectors]
        : scope.stateId !== null
          ? [scope.stateId]
          : [],
    ),
    // 4. Budget utilization
    pool.query<{ total_budget: string; total_spent: string }>(
      `SELECT
         COALESCE(SUM(p.budget_total), 0)::float AS total_budget,
         COALESCE(SUM(a_agg.spent), 0)::float AS total_spent
       FROM projects p
       LEFT JOIN (SELECT project_id, SUM(budget_spent) AS spent FROM activities GROUP BY project_id) a_agg
         ON a_agg.project_id = p.id
       WHERE 1=1${pSql}`,
      pParams,
    ),
    // 5. Risk management
    pool.query<{ critical_count: string; high_count: string; med_low_count: string; total_count: string }>(
      `SELECT
             COUNT(*) FILTER (WHERE rk.severity = 'critical' AND rk.status NOT IN ('closed','mitigated'))::int AS critical_count,
             COUNT(*) FILTER (WHERE rk.severity = 'high' AND rk.status NOT IN ('closed','mitigated'))::int AS high_count,
             COUNT(*) FILTER (WHERE rk.severity IN ('medium','low') AND rk.status NOT IN ('closed','mitigated'))::int AS med_low_count,
             COUNT(*)::int AS total_count
           FROM risks rk
           LEFT JOIN projects p ON p.id = rk.project_id
            WHERE 1=1${childProjectScopeSql}
              AND ${activeProjectParentSQL("rk.project_id")}`,
      pParams,
    ),
    // 6. Data completeness
    pool.query<{
      total_projects: string;
      has_budget: string;
      has_activities: string;
      has_reports: string;
      has_targets: string;
    }>(
      `SELECT
         COUNT(*)::int AS total_projects,
         COUNT(*) FILTER (WHERE p.budget_total > 0)::int AS has_budget,
         COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM activities a WHERE a.project_id = p.id))::int AS has_activities,
         COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM reports r WHERE r.project_id = p.id AND r.status != 'draft'))::int AS has_reports,
         COUNT(*) FILTER (WHERE p.beneficiaries_target > 0)::int AS has_targets
       FROM projects p
       WHERE 1=1${pSql}`,
      pParams,
    ),
  ]);

  // -- Activity completion component
  const actScore = actRow.rows[0]?.score != null ? Math.round(Number(actRow.rows[0].score)) : null;

  // -- Report submission component
  const repR = repRow.rows[0];
  const totalSubmitted = Number(repR?.total_submitted ?? 0);
  const totalApproved = Number(repR?.total_approved ?? 0);
  const latePending = Number(repR?.late_pending ?? 0);
  const repScore = totalSubmitted > 0
    ? Math.max(0, Math.min(100, Math.round((totalApproved / totalSubmitted) * 100 - latePending * 5)))
    : null;

  // -- Indicator achievement component (avg of per-sector rates; null when no sectors have targets)
  const indR = indRow.rows[0];
  const avgPct = indR?.avg_pct != null ? Number(indR.avg_pct) : null;
  const indScore = avgPct != null ? Math.round(avgPct) : null;

  // -- Budget utilization component
  const budR = budRow.rows[0];
  const totalBudget = Number(budR?.total_budget ?? 0);
  const totalSpent = Number(budR?.total_spent ?? 0);
  const utilPct = totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0;
  const budScore = totalBudget > 0 ? budgetUtilScore(utilPct) : null;

  // -- Risk management component
  const riskR = riskRow.rows[0];
  const riskTotalCount = Number(riskR?.total_count ?? 0);
  const critCount = Number(riskR?.critical_count ?? 0);
  const highCount = Number(riskR?.high_count ?? 0);
  const medLowCount = Number(riskR?.med_low_count ?? 0);
  // No risk records at all = no data, not perfect performance
  const riskComp = riskTotalCount > 0 ? riskScore(critCount, highCount, medLowCount) : null;

  // -- Data completeness component
  const dataR = dataRow.rows[0];
  const totalProj = Number(dataR?.total_projects ?? 0);
  const hasBudget = Number(dataR?.has_budget ?? 0);
  const hasAct = Number(dataR?.has_activities ?? 0);
  const hasRep = Number(dataR?.has_reports ?? 0);
  const hasTgt = Number(dataR?.has_targets ?? 0);
  const dataScore = totalProj > 0
    ? Math.round(((hasBudget + hasAct + hasRep + hasTgt) / (totalProj * 4)) * 100)
    : null;

  const components: ComponentScores = {
    activityCompletion:   actScore,
    reportSubmission:     repScore,
    indicatorAchievement: indScore,
    budgetUtilization:    budScore,
    riskManagement:       riskComp,
    dataCompleteness:     dataScore,
  };

  const overallScore = computeWeightedScore(components);

  return {
    overallScore,
    tier: scoreTier(overallScore),
    components,
    dataAvailable: totalProj > 0,
  };
}

// ─── Per-state scores ───────────────────────────────────────────────────────

export async function computeStateScores(
  pool: PgPool,
  scope: ScopeFilter,
): Promise<StateScoreRow[]> {
  // A State Programme Officer is assigned to projects, not to a complete state
  // portfolio. A state-level aggregate cannot truthfully be presented without
  // mixing in unassigned projects, reports, risks, or indicators.
  if (scope.projectIds !== undefined) return [];

  const { sql: sectorCond, params: sectorParams } = (() => {
    if (scope.sectors !== null && scope.sectors.length > 0) {
      return { sql: " AND p.sector = ANY($1::text[])", params: [scope.sectors] };
    }
    if (scope.sectors !== null && scope.sectors.length === 0) {
      return { sql: " AND FALSE", params: [] };
    }
    return { sql: "", params: [] };
  })();

  const stateWhere = scope.stateId !== null ? `WHERE s.id = ${scope.stateId}` : "";

  const { rows } = await pool.query(
    `SELECT
      s.id AS "stateId",
      s.name AS "stateName",
      s.name_ar AS "stateNameAr",
      COALESCE((SELECT COUNT(DISTINCT ps.project_id)::int
        FROM project_states ps JOIN projects p ON p.id = ps.project_id
        WHERE p.deleted_at IS NULL AND ps.state_id = s.id AND p.status IN ('approved','coordination_approved','technically_approved','active')
        ${sectorCond}), 0) AS "activeProjects",
      COALESCE((SELECT COUNT(*)::int FROM beneficiaries b WHERE b.state_id = s.id AND ${activeProjectParentSQL("b.project_id")}), 0) AS beneficiaries,
      NULL::int AS "budgetUtilizationPct", -- BUD-004: no canonical State-level expenditure source; proxy removed
      COALESCE((SELECT AVG(a.progress_pct)::int FROM activities a WHERE a.state_id = s.id AND ${activeProjectParentSQL("a.project_id")}), 0) AS "progressPct",
      CASE
        WHEN (SELECT COUNT(*) FROM risks r WHERE r.state_id = s.id AND ${activeProjectParentSQL("r.project_id")} AND r.severity IN ('high','critical') AND r.status NOT IN ('closed','mitigated','resolved','cancelled')) >= 2 THEN 'high'
        WHEN (SELECT COUNT(*) FROM risks r WHERE r.state_id = s.id AND ${activeProjectParentSQL("r.project_id")} AND r.severity IN ('high','critical') AND r.status NOT IN ('closed','mitigated','resolved','cancelled')) >= 1 THEN 'medium'
        ELSE 'low'
      END AS "riskLevel",
      COALESCE((SELECT COUNT(*)::int FROM risks r WHERE r.state_id = s.id AND ${activeProjectParentSQL("r.project_id")} AND r.status NOT IN ('closed','mitigated','resolved','cancelled')), 0) AS "openRisks",
      COALESCE((SELECT COUNT(*)::int FROM risks r WHERE r.state_id = s.id AND ${activeProjectParentSQL("r.project_id")} AND r.severity IN ('critical','high') AND r.status NOT IN ('closed','mitigated','resolved','cancelled')), 0) AS "criticalRisks",
      COALESCE((SELECT COUNT(*)::int FROM risks r WHERE r.state_id = s.id AND ${activeProjectParentSQL("r.project_id")} AND r.severity = 'critical' AND r.status NOT IN ('closed','mitigated','resolved','cancelled')), 0) AS "critOnlyRisks",
      COALESCE((SELECT COUNT(*)::int FROM risks r WHERE r.state_id = s.id AND ${activeProjectParentSQL("r.project_id")} AND r.severity = 'high' AND r.status NOT IN ('closed','mitigated','resolved','cancelled')), 0) AS "highOnlyRisks",
      COALESCE((SELECT COUNT(*)::int FROM risks r WHERE r.state_id = s.id AND ${activeProjectParentSQL("r.project_id")} AND r.severity IN ('medium','low') AND r.status NOT IN ('closed','mitigated','resolved','cancelled')), 0) AS "medLowRisks",
      COALESCE((SELECT COUNT(*)::int FROM reports r WHERE r.state_id = s.id AND ${activeProjectParentSQL("r.project_id")} AND r.status NOT IN ('draft')), 0) AS "reportsSubmitted",
      COALESCE((SELECT COUNT(*)::int FROM reports r WHERE r.state_id = s.id AND ${activeProjectParentSQL("r.project_id")} AND r.status IN ('submitted','coordination_approved','technically_approved')), 0) AS "reportsPending",
      COALESCE((SELECT COUNT(*)::int FROM reports r WHERE r.state_id = s.id AND ${activeProjectParentSQL("r.project_id")} AND r.status = 'approved'), 0) AS "reportsApproved",
      COALESCE((SELECT COUNT(*)::int FROM reports r
        WHERE r.state_id = s.id
          AND ${activeProjectParentSQL("r.project_id")}
          AND r.status IN ('submitted','coordination_approved','technically_approved')
          AND r.submitted_at < NOW() - INTERVAL '21 days'), 0) AS "lateReports",
      (SELECT
        CASE WHEN COUNT(*) > 0
          THEN (COUNT(*) FILTER (WHERE progress_pct >= 100) * 100 / COUNT(*))::int
          ELSE NULL END
        FROM activities a WHERE a.state_id = s.id AND ${activeProjectParentSQL("a.project_id")}) AS "activityCompletionPct",
      (SELECT
        CASE WHEN COUNT(*) > 0
          THEN (COUNT(*) FILTER (WHERE status = 'approved') * 100 / COUNT(*))::int
          ELSE NULL END
        FROM reports r WHERE r.state_id = s.id AND ${activeProjectParentSQL("r.project_id")} AND r.status NOT IN ('draft')) AS "reportingCompliancePct",
      -- Indicator achievement for sectors active in this state
      COALESCE((SELECT
        CASE WHEN SUM(i.target) > 0 THEN LEAST(100, (SUM(i.achieved) / SUM(i.target) * 100))::int ELSE NULL END
        FROM indicators i
        JOIN projects indicator_project ON indicator_project.id = i.project_id
          AND indicator_project.deleted_at IS NULL
        WHERE i.sector IN (
          SELECT DISTINCT p.sector FROM projects p
          JOIN project_states ps ON ps.project_id = p.id
          WHERE p.deleted_at IS NULL AND ps.state_id = s.id${sectorCond}
        )
      ), NULL) AS "indicatorAchievementPct",
      -- Data completeness for projects in this state
      (SELECT COUNT(*)::int FROM projects p JOIN project_states ps ON ps.project_id = p.id WHERE p.deleted_at IS NULL AND ps.state_id = s.id${sectorCond}) AS "totalProjects",
      (SELECT COUNT(*) FILTER (WHERE p.budget_total > 0)::int FROM projects p JOIN project_states ps ON ps.project_id = p.id WHERE p.deleted_at IS NULL AND ps.state_id = s.id${sectorCond}) AS "hasBudget",
      (SELECT COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM activities a WHERE a.project_id = p.id))::int FROM projects p JOIN project_states ps ON ps.project_id = p.id WHERE p.deleted_at IS NULL AND ps.state_id = s.id${sectorCond}) AS "hasActivities",
      (SELECT COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM reports r WHERE r.project_id = p.id AND r.status != 'draft'))::int FROM projects p JOIN project_states ps ON ps.project_id = p.id WHERE p.deleted_at IS NULL AND ps.state_id = s.id${sectorCond}) AS "hasReports",
      (SELECT COUNT(*) FILTER (WHERE p.beneficiaries_target > 0)::int FROM projects p JOIN project_states ps ON ps.project_id = p.id WHERE p.deleted_at IS NULL AND ps.state_id = s.id${sectorCond}) AS "hasTargets"
    FROM states s ${stateWhere}
    ORDER BY beneficiaries DESC`,
    sectorParams,
  );

  return rows.map((row: Record<string, unknown>) => {
    const totalProj = Number(row.totalProjects ?? 0);
    const reportsSubmitted = Number(row.reportsSubmitted ?? 0);
    const reportsApproved = Number(row.reportsApproved ?? 0);
    const lateReports = Number(row.lateReports ?? 0);
    const criticalRisks = Number(row.criticalRisks ?? 0);
    const openRisks = Number(row.openRisks ?? 0);
    const medLowRisks = Number(row.medLowRisks ?? 0);

    const repScore = reportsSubmitted > 0
      ? Math.max(0, Math.min(100, Math.round((reportsApproved / reportsSubmitted) * 100 - lateReports * 5)))
      : null;

    const indPct = row.indicatorAchievementPct != null ? Number(row.indicatorAchievementPct) : null;

    const dataScore = totalProj > 0
      ? Math.round(((Number(row.hasBudget ?? 0) + Number(row.hasActivities ?? 0) + Number(row.hasReports ?? 0) + Number(row.hasTargets ?? 0)) / (totalProj * 4)) * 100)
      : null;

    // A state needs at least one active project to be ranked.
    // Draft/closed projects do not constitute operational data.
    const activeProjectCount = Number(row.activeProjects ?? 0);
    const hasActiveProjects = activeProjectCount > 0;

    const components: ComponentScores = {
      activityCompletion:   hasActiveProjects ? (Number(row.activityCompletionPct) || null) : null,
      reportSubmission:     hasActiveProjects ? repScore : null,
      indicatorAchievement: hasActiveProjects ? indPct : null,
      budgetUtilization:    null, // BUD-004: no canonical State-level expenditure source
      riskManagement:       hasActiveProjects ? riskScore(criticalRisks, openRisks - criticalRisks, medLowRisks) : null,
      dataCompleteness:     hasActiveProjects ? dataScore : null,
    };

    // Null score = insufficient data (no active projects to score)
    const performanceScore = hasActiveProjects ? computeWeightedScore(components) : null;

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
      openRisks,
      criticalRisks,
      critOnlyRisks: Number(row.critOnlyRisks ?? 0),
      highOnlyRisks: Number(row.highOnlyRisks ?? 0),
      reportsSubmitted,
      reportsPending: Number(row.reportsPending),
      performanceScore,
      performanceTier: scoreTier(performanceScore),
      components,
      currentScore: performanceScore,
      previousScore: null,
      scoreDifference: null,
      trendDirection: null,
    };
  });
}

// ─── Per-project scores ─────────────────────────────────────────────────────

export async function computeProjectScores(
  pool: PgPool,
  scope: ScopeFilter,
  limit = 50,
): Promise<ProjectScoreRow[]> {
  const { sql: pSql, params: pParams } = projectWhere(scope, "p", 1);

  const { rows } = await pool.query(
    `SELECT
      p.id AS "projectId",
      p.code AS "projectCode",
      p.title AS "projectTitle",
      p.sector,
      p.status,
      p.budget_total::float AS "budgetTotal",
      ARRAY(
        SELECT s.name FROM project_states ps JOIN states s ON s.id = ps.state_id
        WHERE ps.project_id = p.id ORDER BY s.name
      ) AS "stateNames",
      -- Activity completion
      COALESCE((SELECT AVG(a.progress_pct)::float FROM activities a WHERE a.project_id = p.id), NULL) AS "activityAvgPct",
      (SELECT COUNT(*)::int FROM activities a WHERE a.project_id = p.id) AS "activityCount",
      -- Report submission
      (SELECT COUNT(*)::int FROM reports r WHERE r.project_id = p.id AND r.status != 'draft') AS "reportsSubmitted",
      (SELECT COUNT(*)::int FROM reports r WHERE r.project_id = p.id AND r.status = 'approved') AS "reportsApproved",
      (SELECT COUNT(*)::int FROM reports r WHERE r.project_id = p.id AND r.status IN ('submitted','coordination_approved','technically_approved') AND r.submitted_at < NOW() - INTERVAL '21 days') AS "lateReports",
      (SELECT r.status FROM reports r WHERE r.project_id = p.id AND r.status != 'draft' ORDER BY r.submitted_at DESC LIMIT 1) AS "recentReportStatus",
      -- Indicator achievement
      (SELECT CASE WHEN SUM(i.target) > 0 THEN LEAST(100, SUM(i.achieved)/SUM(i.target)*100)::int ELSE NULL END
       FROM indicators i
       JOIN projects indicator_project ON indicator_project.id = i.project_id
         AND indicator_project.deleted_at IS NULL
       WHERE i.sector = p.sector) AS "indAchievementPct",
      -- Budget utilization
      CASE WHEN p.budget_total > 0
        THEN COALESCE((SELECT SUM(budget_spent)::float FROM activities WHERE project_id = p.id), 0) / p.budget_total * 100
        ELSE NULL END AS "utilPct",
      -- Risk management
      (SELECT COUNT(*)::int FROM risks rk WHERE rk.project_id = p.id AND rk.severity = 'critical' AND rk.status NOT IN ('closed','mitigated')) AS "criticalRisks",
      (SELECT COUNT(*)::int FROM risks rk WHERE rk.project_id = p.id AND rk.severity = 'high' AND rk.status NOT IN ('closed','mitigated')) AS "highRisks",
      (SELECT COUNT(*)::int FROM risks rk WHERE rk.project_id = p.id AND rk.severity IN ('medium','low') AND rk.status NOT IN ('closed','mitigated')) AS "medLowRisks",
      (SELECT COUNT(*)::int FROM risks rk WHERE rk.project_id = p.id AND rk.status NOT IN ('closed','mitigated')) AS "openRisks",
      (SELECT COUNT(*)::int FROM risks rk WHERE rk.project_id = p.id) AS "totalRisks",
      -- Data completeness
      CASE
        WHEN p.budget_total > 0 THEN 1 ELSE 0
      END +
      CASE WHEN (SELECT COUNT(*) FROM activities WHERE project_id = p.id) > 0 THEN 1 ELSE 0 END +
      CASE WHEN (SELECT COUNT(*) FROM reports r WHERE r.project_id = p.id AND r.status != 'draft') > 0 THEN 1 ELSE 0 END +
      CASE WHEN p.beneficiaries_target > 0 THEN 1 ELSE 0 END AS "completenessPoints"
    FROM projects p
    WHERE p.status IN ('active','approved','coordination_approved','technically_approved','submitted')${pSql}
    ORDER BY p.created_at DESC
    LIMIT ${limit}`,
    pParams,
  );

  return rows.map((row: Record<string, unknown>) => {
    const actAvg = row.activityAvgPct != null ? Math.round(Number(row.activityAvgPct)) : null;
    const reportsSubmitted = Number(row.reportsSubmitted ?? 0);
    const reportsApproved = Number(row.reportsApproved ?? 0);
    const lateReports = Number(row.lateReports ?? 0);
    const repScore = reportsSubmitted > 0
      ? Math.max(0, Math.min(100, Math.round((reportsApproved / reportsSubmitted) * 100 - lateReports * 5)))
      : null;
    const utilPct = row.utilPct != null ? Number(row.utilPct) : null;
    const totalRisks = Number(row.totalRisks ?? 0);
    const critRisks = Number(row.criticalRisks ?? 0);
    const highRisks = Number(row.highRisks ?? 0);
    const medLow = Number(row.medLowRisks ?? 0);
    const completeness = Math.round((Number(row.completenessPoints ?? 0) / 4) * 100);

    const components: ComponentScores = {
      activityCompletion:   actAvg,
      reportSubmission:     repScore,
      indicatorAchievement: row.indAchievementPct != null ? Number(row.indAchievementPct) : null,
      budgetUtilization:    utilPct != null ? budgetUtilScore(utilPct) : null,
      // No risk records at all = no data, not perfect performance
      riskManagement:       totalRisks > 0 ? riskScore(critRisks, highRisks, medLow) : null,
      dataCompleteness:     completeness,
    };

    const overallScore = computeWeightedScore(components);

    return {
      projectId: Number(row.projectId),
      projectCode: String(row.projectCode),
      projectTitle: String(row.projectTitle),
      sector: String(row.sector ?? ""),
      stateNames: Array.isArray(row.stateNames) ? row.stateNames : [],
      status: String(row.status),
      overallScore,
      tier: scoreTier(overallScore),
      components,
      activityCount: Number(row.activityCount ?? 0),
      openRisks: Number(row.openRisks ?? 0),
      criticalRisks: critRisks,
      recentReportStatus: row.recentReportStatus != null ? String(row.recentReportStatus) : null,
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
  const projectPerf: ProjectHierarchicalRow[] = projectRows.rows.map((p) => {
    const indicators = indsByProject.get(p.id) ?? [];
    const { rate, validCount, missingCount } = calculateProjectAchievement(indicators);
    return {
      projectId: p.id,
      projectCode: p.code,
      projectTitle: p.title,
      sector: normalizePerformanceLabel(p.sector),
      stateNames: statesByProject.get(p.id) ?? [],
      validIndicatorCount: validCount,
      missingIndicatorCount: missingCount,
      projectAchievementRate: rate != null ? Math.round(rate * 10) / 10 : null,
    };
  });

  // 5. Group by sector and compute sector rates
  const sectorMap = new Map<string | null, ProjectHierarchicalRow[]>();
  for (const p of projectPerf) {
    const arr = sectorMap.get(p.sector) ?? [];
    arr.push(p);
    sectorMap.set(p.sector, arr);
  }

  const sectors: SectorHierarchicalRow[] = [];
  for (const [sector, projects] of sectorMap) {
    const { rate, validCount, insufficientCount } = calculateSectorAchievement(
      projects.map((p) => p.projectAchievementRate),
    );
    sectors.push({
      sector,
      projectCount: projects.length,
      validProjectCount: validCount,
      insufficientProjectCount: insufficientCount,
      sectorAchievementRate: rate != null ? Math.round(rate * 10) / 10 : null,
      projects,
    });
  }
  sectors.sort((a, b) => comparePerformanceLabels(a.sector, b.sector));

  // 6. Compute average sector achievement rate
  const { rate: avgRate, validCount: validSectorCount } = calculateAverageSectorAchievement(
    sectors.map((s) => s.sectorAchievementRate),
  );
  const validProjectCount = projectPerf.filter((p) => p.projectAchievementRate !== null).length;

  return {
    averageSectorAchievementRate: avgRate != null ? Math.round(avgRate * 10) / 10 : null,
    validSectorCount,
    validProjectCount,
    sectors,
  };
}
