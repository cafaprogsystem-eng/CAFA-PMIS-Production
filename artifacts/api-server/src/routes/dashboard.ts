import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { tcSectorRestriction, requirePerm } from "../middlewares/currentUser";
import {
  CANONICAL_TYPES_SQL,
  AWAITING_APPROVAL_STATUSES_SQL,
  SUBMITTED_STATUSES_SQL,
  TOTAL_STATUSES_SQL,
  operationalPopulationSQL,
} from "../lib/reportConstants";
import { ACTIVE_RISK_STATUS_SQL } from "../lib/riskConstants";
import { VALID_SECTOR_SET } from "../lib/sectors";
import {
  PMR_COMP_SUBMITTED_STATUSES,
  pmrCompStatusRank,
  queryProjectStateLocations,
} from "../lib/pmrLocationHelper";
import {
  computeOrgScore,
  computeStateScores,
  computeProjectScores,
  computeHierarchicalPerformance,
} from "../services/performanceEngine";
import { assertCanViewHqSectorSnapshot } from "../lib/reportAuth";

const router: IRouter = Router();

// ─── Scope helpers ─────────────────────────────────────────────────────────
// Returns a WHERE-clause fragment + bound params that scope project-related
// queries to the current user's state or sector where applicable.
// "base_idx" is the $N offset so we can continue the caller's param list.
interface Scope {
  stateId: number | null;
  sectors: string[] | null;
  projectIds?: number[]; // defined = project-assignment-based scope (state_program_officer)
  /** A misconfigured state role must never fall back to organisation-wide data. */
  denyAll?: boolean;
}

const DASHBOARD_FILTER_KEYS = new Set(["stateId", "sector", "donor", "dateFrom", "dateTo"]);
const DASHBOARD_FILTER_MATRIX: Record<string, ReadonlySet<string>> = {
  summary: DASHBOARD_FILTER_KEYS,
  statePerformance: new Set(["stateId", "sector"]),
  notificationsSummary: new Set(),
  sectorPerformance: new Set(),
  pendingApprovals: new Set(),
  recentActivity: new Set(),
  sectorBudget: new Set(["stateId", "sector", "donor", "dateFrom", "dateTo", "status"]),
  donorPortfolio: DASHBOARD_FILTER_KEYS,
  projectBudgetPerformance: DASHBOARD_FILTER_KEYS,
  beneficiaries: DASHBOARD_FILTER_KEYS,
  agenda: new Set(),
  sectorSnapshot: new Set(["sector"]),
  performance: new Set(),
  performanceStates: new Set(),
  performanceProjects: new Set(["limit"]),
  attentionProjects: new Set(),
  hierarchicalPerformance: DASHBOARD_FILTER_KEYS,
  lateReports: new Set(),
  pmrReportingCompleteness: new Set(["kind", "reportingYear", "reportingMonth", "quarter", "projectId"]),
};

/**
 * Dashboard cards are aggregates, so an empty aggregate row is never evidence
 * of an empty population. PostgreSQL's aggregate queries return one row (with
 * a numeric zero when appropriate); missing or malformed rows are an
 * authoritative-evaluation failure and must not be rendered as zero.
 */
function aggregateRow(
  result: { rows?: unknown[] },
  queryName: string,
  fields: string[],
): Record<string, number> {
  const row = result.rows?.[0];
  if (!row || typeof row !== "object") {
    const error = new Error(`Dashboard aggregate "${queryName}" returned no result row.`);
    Object.assign(error, { status: 500 });
    throw error;
  }
  const values = row as Record<string, unknown>;
  const parsed: Record<string, number> = {};
  for (const field of fields) {
    if (typeof values[field] !== "number" || !Number.isFinite(values[field])) {
      const error = new Error(`Dashboard aggregate "${queryName}" returned an invalid "${field}" value.`);
      Object.assign(error, { status: 500 });
      throw error;
    }
    parsed[field] = values[field] as number;
  }
  return parsed;
}

function dashboardScopeError(scope: Scope, query: Record<string, string | undefined>): string | null {
  if (scope.denyAll || (scope.sectors !== null && scope.sectors.length === 0)) {
    return "dashboard_scope_forbidden";
  }
  if (query.stateId !== undefined && scope.stateId !== null && Number(query.stateId) !== scope.stateId) {
    return "dashboard_state_forbidden";
  }
  if (query.sector !== undefined && scope.sectors !== null && !scope.sectors.includes(query.sector)) {
    return "dashboard_sector_forbidden";
  }
  return null;
}

function forbiddenDashboardScope(errorCode: string): Error {
  const error = new Error("Dashboard filter is outside the caller's authorised scope.");
  Object.assign(error, { status: 403, errorCode });
  return error;
}

function userScope(req: Request): Scope {
  const u = req.currentUser;
  if (!u) return { stateId: null, sectors: null };
  const isStateRole = u.role === "state_office_manager" || u.role === "state_program_officer";
  const stateId = isStateRole ? (u.stateId ?? null) : null;
  const sectors = tcSectorRestriction(req);
  return { stateId, sectors, denyAll: isStateRole && stateId === null };
}

/** For state_program_officer: scope to assigned projects only. Async because it queries DB. */
async function buildScope(req: Request): Promise<Scope> {
  const u = req.currentUser;
  if (!u) return { stateId: null, sectors: null };
  if (u.role === "state_program_officer") {
    if (u.stateId === null) {
      return { stateId: null, sectors: null, projectIds: [], denyAll: true };
    }
    const { rows } = await pool.query<{ project_id: number }>(
      `SELECT DISTINCT project_id FROM project_assignments WHERE user_id = $1`,
      [u.id],
    );
    return {
      stateId: u.stateId,
      sectors: null,
      projectIds: rows.map((r) => r.project_id),
    };
  }
  return userScope(req);
}

/** Merge user-supplied filter query params on top of the RBAC scope.
 *  - state_program_officer / state_office_manager cannot widen beyond their assigned state.
 *  - TC cannot widen beyond their assigned sectors.
 *  - HQ roles can narrow to any state/sector/donor/date.
 */
function applyFilterParams(
  scope: Scope,
  query: Record<string, string | undefined>,
): { effectiveScope: Scope; donorCond: string; dateConds: string; extraParams: (string | null)[] } {
  const scopeError = dashboardScopeError(scope, query);
  if (scopeError) throw forbiddenDashboardScope(scopeError);
  const { stateId: qStateId, sector: qSector, donor: qDonor, dateFrom, dateTo } = query;

  // stateId — HQ roles may narrow to a specific state; state roles stay locked
  const effectiveStateId: number | null =
    scope.stateId !== null ? scope.stateId : qStateId ? Number(qStateId) : null;

  // sectors — TC may narrow to one of their sectors; HQ may add a single sector filter
  let effectiveSectors: string[] | null = scope.sectors;
  if (qSector) {
    if (scope.sectors === null) {
      effectiveSectors = [qSector]; // HQ: narrow to chosen sector
    } else if (scope.sectors.includes(qSector)) {
      effectiveSectors = [qSector]; // TC: allowed to narrow to this sector
    }
    // else: TC without access → keep existing sector restriction (deny-all if empty)
  }

  // Keep assignment and deny-all restrictions when optional filters narrow a
  // scope. Reconstructing Scope here previously discarded SPO project IDs.
  const effectiveScope: Scope = {
    ...scope,
    stateId: effectiveStateId,
    sectors: effectiveSectors,
  };

  // Extra per-column conditions (donor, dates) applied after scope params
  const donorCond = qDonor ? "AND p.donor = ?" : "";
  const dateConds =
    (dateFrom ? "AND p.end_date >= ?::date " : "") +
    (dateTo   ? "AND p.start_date <= ?::date " : "");
  const extraParams: (string | null)[] = [
    ...(qDonor    ? [qDonor]    : []),
    ...(dateFrom  ? [dateFrom]  : []),
    ...(dateTo    ? [dateTo]    : []),
  ];

  return { effectiveScope, donorCond, dateConds, extraParams };
}

/** Validate the URL-backed filters used by the Dashboard aggregate endpoints. */
function dashboardFilterError(
  query: Record<string, string | undefined>,
  allowed: ReadonlySet<string> = DASHBOARD_FILTER_KEYS,
): string | null {
  for (const [key, value] of Object.entries(query)) {
    if (!allowed.has(key)) return `unsupported Dashboard filter "${key}"`;
    if (typeof value !== "string") return `Dashboard filter "${key}" must be specified once`;
    if (key === "limit" && (!/^(?:[1-9]\d*)$/.test(value) || Number(value) < 10 || Number(value) > 100)) {
      return 'Dashboard filter "limit" must be an integer from 10 to 100';
    }
  }
  const { stateId, sector, donor, dateFrom, dateTo } = query;
  if (stateId !== undefined && (!/^[1-9]\d*$/.test(stateId))) return "stateId must be a positive integer";
  if (sector !== undefined && !VALID_SECTOR_SET.has(sector)) return "sector must be a canonical sector";
  if (donor !== undefined && (donor.trim().length === 0 || donor.length > 255)) return "donor must be 1–255 characters";

  const isIsoDate = (value: string | undefined) => {
    if (value === undefined) return true;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  if (!isIsoDate(dateFrom) || !isIsoDate(dateTo)) return "date filters must use valid YYYY-MM-DD values";
  if (dateFrom && dateTo && dateFrom > dateTo) return "dateFrom must be on or before dateTo";
  return null;
}

function dashboardFilterGuard(endpoint: keyof typeof DASHBOARD_FILTER_MATRIX) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const filterError = dashboardFilterError(
      req.query as Record<string, string | undefined>,
      DASHBOARD_FILTER_MATRIX[endpoint],
    );
    if (filterError) {
      res.status(400).json({ error: "dashboard_invalid_filter", detail: filterError });
      return;
    }
    next();
  };
}

/** Replace ? placeholders (left-to-right) with $N starting from startIdx.
 *  Returns the parameterized SQL and the next idx. */
function reindex(sql: string, startIdx: number): { sql: string; nextIdx: number } {
  let idx = startIdx;
  const result = sql.replace(/\?/g, () => `$${idx++}`);
  return { sql: result, nextIdx: idx };
}

// Builds a SQL fragment "AND <conditions>" for a projects table aliased as `alias`.
// Returns { sql, params, nextIdx }.
function projectScopeWhere(
  scope: Scope,
  alias: string,
  baseIdx: number,
): { sql: string; params: (number | string[] | number[])[]; nextIdx: number } {
  // Every Dashboard project population is operational-only. Child records use
  // activeProjectParentSQL below, while project-root queries share this clause.
  const parts: string[] = [`${alias}.deleted_at IS NULL`];
  const params: (number | string[] | number[])[] = [];
  let idx = baseIdx;

  if (scope.denyAll) {
    parts.push("FALSE");
  }

  // state_program_officer: scope to explicitly assigned project IDs, still
  // clamped to their state so stale/cross-state assignments cannot broaden
  // Dashboard visibility.
  if (scope.projectIds !== undefined) {
    if (scope.projectIds.length === 0) {
      parts.push("FALSE");
    } else {
      parts.push(`${alias}.id = ANY($${idx++}::int[])`);
      params.push(scope.projectIds);
    }
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
    // TC with no sectors assigned → deny-all
    parts.push("FALSE");
  }
  return { sql: parts.length ? " AND " + parts.join(" AND ") : "", params, nextIdx: idx };
}

/**
 * Preserves standalone records while excluding records linked to a retired
 * project. Dashboard report/risk/activity/beneficiary metrics must not surface
 * historical child rows solely because those rows are intentionally retained.
 */
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

/**
 * The Reports module's authoritative TC-sector predicate. Do not replace this
 * with COALESCE: project reports and project-linked activity reports are
 * governed only by their project's sector; standalone activity reports use
 * only their activity sector.
 */
function technicalCoordinatorReportSectorSQL(
  reportAlias: string,
  projectAlias: string,
  activityAlias: string,
  parameterIndex: number,
  parameterKind: "array" | "single" = "array",
): string {
  const matches = (column: string) =>
    parameterKind === "array"
      ? `${column} = ANY($${parameterIndex}::text[])`
      : `${column} = $${parameterIndex}::text`;
  return `(
    (${reportAlias}.report_type = 'project' AND ${matches(`${projectAlias}.sector`)})
    OR (${reportAlias}.report_type = 'activity' AND ${reportAlias}.project_id IS NOT NULL AND ${matches(`${projectAlias}.sector`)})
    OR (${reportAlias}.report_type = 'activity' AND ${reportAlias}.project_id IS NULL AND ${matches(`${activityAlias}.sector`)})
    OR (${reportAlias}.report_type NOT IN ('project', 'activity')
      AND (${matches(`${reportAlias}.sector`)} OR ${matches(`${projectAlias}.sector`)}))
  )`;
}

/** Report scope mirrors GET /reports, including SPO project assignments. */
function reportScopeWhere(
  scope: Scope,
  reportAlias: string,
  projectAlias: string,
  activityAlias: string,
  baseIdx: number,
  filters: Record<string, string | undefined> = {},
): { sql: string; params: (number | number[] | string | string[])[] } {
  const parts: string[] = [];
  const params: (number | number[] | string | string[])[] = [];
  let idx = baseIdx;
  if (scope.denyAll) parts.push("FALSE");
  if (scope.stateId !== null) {
    parts.push(`${reportAlias}.state_id = $${idx++}`);
    params.push(scope.stateId);
  }
  if (scope.projectIds !== undefined) {
    if (scope.projectIds.length === 0) parts.push("FALSE");
    else {
      parts.push(`${reportAlias}.project_id = ANY($${idx++}::int[])`);
      params.push(scope.projectIds);
    }
  }
  if (scope.sectors !== null) {
    if (scope.sectors.length === 0) parts.push("FALSE");
    else {
      parts.push(technicalCoordinatorReportSectorSQL(reportAlias, projectAlias, activityAlias, idx++));
      params.push(scope.sectors);
    }
  }
  if (filters.donor) { parts.push(`${projectAlias}.donor = $${idx++}`); params.push(filters.donor); }
  if (filters.dateFrom) { parts.push(`${projectAlias}.end_date >= $${idx++}::date`); params.push(filters.dateFrom); }
  if (filters.dateTo) { parts.push(`${projectAlias}.start_date <= $${idx++}::date`); params.push(filters.dateTo); }
  return { sql: parts.length ? ` AND ${parts.join(" AND ")}` : "", params };
}

/** Computed 3×3 Risk score; must mirror routes/risks.ts. */
const riskScoreSQL = (alias: string) => `(
  CASE ${alias}likelihood WHEN 'high' THEN 3 WHEN 'likely' THEN 3 WHEN 'almost_certain' THEN 3 WHEN 'medium' THEN 2 WHEN 'possible' THEN 2 WHEN 'low' THEN 1 WHEN 'unlikely' THEN 1 ELSE 2 END *
  CASE COALESCE(${alias}impact, ${alias}severity) WHEN 'critical' THEN 3 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 2 END
)`;

// ─── Budget & Donors — role gate ────────────────────────────────────────────
/**
 * Approved roles for Budget & Donors tab and its protected endpoints.
 *
 * Role check = module-level access decision.
 * userScope() = record-level restriction.
 * Both layers are required; neither replaces the other.
 *
 * Explicitly approved:
 *   super_admin / executive_director         — organisation-wide oversight
 *   program_manager / senior_program_coordinator — programme-level oversight
 *   technical_coordinator                    — sector-scoped financial data
 *   state_program_officer                    — state-scoped financial data
 *
 * Explicitly excluded (authentication alone is NOT sufficient):
 *   state_office_manager  — state role, but NO approved Budget & Donors permission
 *   state_manager, viewer, project_officer, program_assistant
 *   finance / HR / procurement / MEAL roles and all other authenticated users
 */
const BUDGET_DONORS_ROLES = new Set([
  "super_admin", "executive_director",
  "program_manager", "senior_program_coordinator",
  "technical_coordinator",
  "state_program_officer",
]);

/**
 * Reusable gate applied at the top of each Budget & Donors endpoint handler.
 * Returns true (continue) when the user has an approved role.
 * Writes 403 and returns false for every other role (including unauthenticated).
 * Always call this BEFORE userScope().
 */
function requireBudgetDonorsRole(req: Request, res: Response): boolean {
  const role = req.currentUser?.role ?? "";
  if (!BUDGET_DONORS_ROLES.has(role)) {
    res.status(403).json({ error: "Access to Budget & Donors requires an approved role." });
    return false;
  }
  return true;
}

// ─── Routes ────────────────────────────────────────────────────────────────

router.get("/dashboard/summary", dashboardFilterGuard("summary"), async (req, res, next) => {
  try {
    // Non-financial fields (project counts, risks, reports, activities, beneficiaries) are
    // returned to all authenticated roles scoped by userScope().
    // Financial fields (budget totals, spend, utilization) are gated to BUDGET_DONORS_ROLES only
    // via hasFinancialAccess further below (per-field gating, not upfront 403).
    // SPOs are restricted to state-valid projects explicitly assigned to them.
    const rawScope = await buildScope(req);
    const scopeError = dashboardScopeError(rawScope, req.query as Record<string, string | undefined>);
    if (scopeError) {
      res.status(403).json({ error: scopeError });
      return;
    }
    const { effectiveScope, donorCond, dateConds, extraParams } = applyFilterParams(
      rawScope,
      req.query as Record<string, string | undefined>,
    );

    const { sql: baseScopeSql, params: baseScopeParams, nextIdx: nextBase } = projectScopeWhere(effectiveScope, "p", 1);
    // Reindex donor / date ?-placeholders starting after the RBAC params
    const { sql: donorSql } = reindex(donorCond, nextBase);
    const { sql: dateSql } = reindex(dateConds, nextBase + (donorCond ? 1 : 0));
    const extraSql = (donorSql + " " + dateSql).trim();
    const scopeSql = baseScopeSql + (extraSql ? " " + extraSql : "");
    const scopeParams = [...baseScopeParams, ...extraParams];
    // Reports use the same state, sector, and SPO assignment population as the
    // rest of the summary, with optional project filters applied where valid.
    const reportEffectiveScope = effectiveScope;
    const reportFilters = req.query as Record<string, string | undefined>;
    const reportCountScope = reportScopeWhere(
      reportEffectiveScope, "r", "rp", "ra", 1, reportFilters,
    );

    // An empty assignment scope must still have an authoritative result rather
    // than a process-local manufactured zero.
    const zeroRisks = () => pool.query(
      "SELECT 0::int AS high, 0::int AS open, 0::int AS critical",
    );

    // Computed risk-level score (mirrors riskLevelSQL in routes/risks.ts) so the
    // "Active Critical Risks" KPI matches the /risks?riskLevel=critical filter.
    // score >= 9 → critical; >= 6 → high.
    // Determine effective state/sector for the conditional risk+report queries
    const es = effectiveScope;
    const scopedChildStateSql = es.stateId !== null
      ? ` AND a.state_id = $${es.projectIds !== undefined ? 2 : 1}`
      : "";
    const scopedAllocationStateSql = es.stateId !== null
      ? ` AND psa.state_id = $${es.projectIds !== undefined ? 2 : 1}`
      : "";
    const hasRiskProjectNarrowing =
      es.projectIds !== undefined
      || es.sectors !== null
      || Boolean(reportFilters.donor || reportFilters.dateFrom || reportFilters.dateTo);
    const scopedRiskStateSql = es.stateId !== null
      ? ` AND rk.state_id = $${es.projectIds !== undefined ? 2 : 1}`
      : "";

    const [proj, budgetTotal, budgetSpent, risks, pending, delayed, byStatus, riskCounts, reportCounts, activityCounts] = await Promise.all([
      pool.query(
        `SELECT
          COUNT(*) FILTER (WHERE status IN ('approved','coordination_approved','technically_approved','active'))::int AS active,
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'closed')::int AS closed
         FROM projects p WHERE p.deleted_at IS NULL${scopeSql}`,
        scopeParams,
      ),
      pool.query(
        `SELECT COALESCE(SUM(p.budget_total), 0)::float AS total FROM projects p WHERE p.deleted_at IS NULL${scopeSql}`,
        scopeParams,
      ),
      pool.query(
        `SELECT COALESCE(SUM(a.budget_spent), 0)::float AS spent
         FROM activities a JOIN projects p ON p.id = a.project_id
         WHERE p.deleted_at IS NULL${scopeSql}${scopedChildStateSql}`,
        scopeParams,
      ),
      // 3: high-risk state count
      es.projectIds !== undefined && es.projectIds.length === 0
        ? zeroRisks()
        : hasRiskProjectNarrowing
          ? pool.query(
              `SELECT COUNT(DISTINCT rk.state_id)::int AS high FROM risks rk
               WHERE rk.project_id IN (
                 SELECT p.id FROM projects p WHERE p.deleted_at IS NULL${scopeSql}
               )${scopedRiskStateSql}
                 AND ${riskScoreSQL("rk.")} >= 6
                 AND rk.status ${ACTIVE_RISK_STATUS_SQL}`,
              scopeParams,
            )
          : es.stateId !== null
        ? pool.query(
            `SELECT COUNT(DISTINCT rk.state_id)::int AS high FROM risks rk
             WHERE rk.state_id = $1 AND ${activeProjectParentSQL("rk.project_id")}
                AND ${riskScoreSQL("rk.")} >= 6 AND rk.status ${ACTIVE_RISK_STATUS_SQL}`,
            [es.stateId],
          )
        : pool.query(
                `SELECT COUNT(DISTINCT rk.state_id)::int AS high
                 FROM risks rk WHERE ${activeProjectParentSQL("rk.project_id")}
                    AND ${riskScoreSQL("rk.")} >= 6 AND rk.status ${ACTIVE_RISK_STATUS_SQL}`,
              ),
      // 4: pending approvals
      (() => {
        const pendingReportScope = reportScopeWhere(
          reportEffectiveScope, "r", "rp", "ra", scopeParams.length + 1, reportFilters,
        );
        return pool.query(
          `SELECT
            (SELECT COUNT(*)::int FROM projects p WHERE status NOT IN ('approved','rejected','draft')${scopeSql}) AS proj,
            (SELECT COUNT(*)::int FROM reports r
             LEFT JOIN projects rp ON rp.id = r.project_id
             LEFT JOIN activities ra ON ra.id = r.activity_id
             WHERE status = ANY(${AWAITING_APPROVAL_STATUSES_SQL})${pendingReportScope.sql}
               AND r.report_type = ANY(${CANONICAL_TYPES_SQL})
               AND ${activeProjectParentSQL("r.project_id")}
               AND ${operationalPopulationSQL()}
            ) AS rep`,
          [...scopeParams, ...pendingReportScope.params],
        );
      })(),
      // 5: delayed activities
      pool.query(
        `SELECT COUNT(*)::int AS cnt FROM activities a
         WHERE planned_end < NOW() AND progress_pct < 100
         AND ${activeProjectParentSQL("a.project_id")}
          ${scopedChildStateSql}
         ${scopeSql ? " AND a.project_id IN (SELECT id FROM projects p WHERE 1=1" + scopeSql + ")" : ""}`,
        scopeParams,
      ),
      // 6: project counts by status
      pool.query(
        `SELECT status, COUNT(*)::int AS count FROM projects p WHERE 1=1${scopeSql} GROUP BY status`,
        scopeParams,
      ),
      // 7: risk open/critical counts
      es.projectIds !== undefined && es.projectIds.length === 0
        ? zeroRisks()
        : hasRiskProjectNarrowing
          ? pool.query(
              `SELECT
                 COUNT(*) FILTER (WHERE rk.status ${ACTIVE_RISK_STATUS_SQL})::int AS open,
                 COUNT(*) FILTER (WHERE ${riskScoreSQL("rk.")} >= 9 AND rk.status ${ACTIVE_RISK_STATUS_SQL})::int AS critical
               FROM risks rk
               WHERE rk.project_id IN (
                 SELECT p.id FROM projects p WHERE p.deleted_at IS NULL${scopeSql}
               )${scopedRiskStateSql}`,
              scopeParams,
            )
          : es.stateId !== null
        ? pool.query(
            `SELECT
              COUNT(*) FILTER (WHERE rk.status ${ACTIVE_RISK_STATUS_SQL})::int AS open,
              COUNT(*) FILTER (WHERE ${riskScoreSQL("rk.")} >= 9 AND rk.status ${ACTIVE_RISK_STATUS_SQL})::int AS critical
             FROM risks rk WHERE rk.state_id = $1 AND ${activeProjectParentSQL("rk.project_id")}`,
            [es.stateId],
          )
        : pool.query(
                  `SELECT
                   COUNT(*) FILTER (WHERE rk.status ${ACTIVE_RISK_STATUS_SQL})::int AS open,
                   COUNT(*) FILTER (WHERE ${riskScoreSQL("rk.")} >= 9 AND rk.status ${ACTIVE_RISK_STATUS_SQL})::int AS critical
                    FROM risks rk WHERE ${activeProjectParentSQL("rk.project_id")}`,
                ),
      // 8: report submitted/pending counts (canonical Reports-module scope)
      pool.query(
        `SELECT
          COUNT(*) FILTER (WHERE r.status = ANY(${SUBMITTED_STATUSES_SQL}))::int AS submitted,
          COUNT(*) FILTER (WHERE r.status = ANY(${AWAITING_APPROVAL_STATUSES_SQL}))::int AS pending
         FROM reports r
         LEFT JOIN projects rp ON rp.id = r.project_id
         LEFT JOIN activities ra ON ra.id = r.activity_id
         WHERE ${activeProjectParentSQL("r.project_id")}${reportCountScope.sql}
           AND r.report_type = ANY(${CANONICAL_TYPES_SQL})
           AND ${operationalPopulationSQL()}`,
        reportCountScope.params,
      ),
      // 9: activity planned / completed counts
      pool.query(
        `SELECT COUNT(*)::int AS planned,
                COUNT(*) FILTER (WHERE progress_pct >= 100)::int AS completed
         FROM activities a
         WHERE ${activeProjectParentSQL("a.project_id")}
          ${scopedChildStateSql}
         ${scopeSql ? "AND a.project_id IN (SELECT id FROM projects p WHERE 1=1" + scopeSql + ")" : ""}`,
        scopeParams,
      ),
    ]);

    const [benReached, benTarget] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(beneficiaries_male + beneficiaries_female + beneficiaries_boys + beneficiaries_girls),0)::int AS reached
         FROM projects p WHERE 1=1${scopeSql}`,
        scopeParams,
      ),
      pool.query(
        `SELECT COALESCE(SUM(beneficiaries_target), 0)::int AS target FROM projects p WHERE 1=1${scopeSql}`,
        scopeParams,
      ),
    ]);
    const stateCount = await pool.query(
      `SELECT COUNT(DISTINCT ps.state_id)::int AS c
       FROM project_states ps
       JOIN projects p ON p.id = ps.project_id
       WHERE p.status IN ('approved','coordination_approved','technically_approved','active')${scopeSql}`,
      scopeParams,
    );

    // Do not use optional chaining/default values here. Every value reaches the
    // response only after every authoritative subquery has completed and has
    // produced its required aggregate row.
    const projectTotals = aggregateRow(proj, "projects", ["active", "total", "closed"]);
    const budgetTotals = aggregateRow(budgetTotal, "budget_total", ["total"]);
    const spentTotals = aggregateRow(budgetSpent, "budget_spent", ["spent"]);
    const riskStateTotals = aggregateRow(risks, "high_risk_states", ["high"]);
    const pendingTotals = aggregateRow(pending, "pending_approvals", ["proj", "rep"]);
    const delayedTotals = aggregateRow(delayed, "delayed_activities", ["cnt"]);
    const riskTotals = aggregateRow(riskCounts, "risk_counts", ["open", "critical"]);
    const reportTotals = aggregateRow(reportCounts, "report_counts", ["submitted", "pending"]);
    const activityTotals = aggregateRow(activityCounts, "activity_counts", ["planned", "completed"]);
    const reachedTotals = aggregateRow(benReached, "beneficiaries_reached", ["reached"]);
    const targetTotals = aggregateRow(benTarget, "beneficiaries_target", ["target"]);
    const stateTotals = aggregateRow(stateCount, "states_count", ["c"]);

    const totalBudget = budgetTotals.total;
    const totalSpent = spentTotals.spent;
    // Spec: return null when Allocated Budget is zero — null means "no valid budget",
    // which the frontend displays as "—". A genuine 0 % is only valid when totalBudget > 0
    // and totalSpent === 0.  Raw float passed through — no integer rounding on the server.
    const burn: number | null = totalBudget > 0 ? (totalSpent / totalBudget) * 100 : null;

    // budgetAllocated = sum of state-level allocations (or activity planned budget as fallback)
    const [allocatedRes, currencyBreakdownRes] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(psa.budget_allocation), 0)::float AS allocated
         FROM project_state_allocations psa
         JOIN projects p ON p.id = psa.project_id
         WHERE p.deleted_at IS NULL${scopeSql}${scopedAllocationStateSql}`,
        scopeParams,
      ),
      // DEFECT-05: per-currency grouped totals using a CTE so the scope is applied once
      // (avoids alias confusion between outer p and inner subquery aliases)
      pool.query(
        `WITH scoped AS (
           SELECT id, budget_total, currency FROM projects p
           WHERE p.deleted_at IS NULL${scopeSql} AND p.currency IS NOT NULL AND p.currency <> ''
         )
         SELECT
           s.currency,
           COALESCE(SUM(s.budget_total), 0)::float AS "totalBudget",
           (SELECT SUM(a.budget_spent)::float FROM activities a
             WHERE a.project_id IN (SELECT id FROM scoped WHERE currency = s.currency)
             ${scopedChildStateSql}) AS "totalSpent"
         FROM scoped s
         GROUP BY s.currency
         ORDER BY "totalBudget" DESC`,
        scopeParams,
      ),
    ]);
    const allocatedTotals = aggregateRow(allocatedRes, "budget_allocated", ["allocated"]);
    const budgetAllocated = allocatedTotals.allocated;
    // Same calculation as burn — unified; null when no budget so the frontend
    // can distinguish "no data" (null → "—") from "genuinely zero spend" (0 → "0%").
    const budgetUtilization: number | null = burn;
    const budgetByCurrency: { currency: string; totalBudget: number; totalSpent: number | null; budgetRemaining: number | null; utilisationRate: number | null }[] =
      currencyBreakdownRes.rows.map(r => {
        const tb = r.totalBudget as number;
        const ts = r.totalSpent as number | null;
        return {
          currency: r.currency as string,
          totalBudget: tb,
          totalSpent: ts,
          budgetRemaining: ts != null ? tb - ts : null,
          utilisationRate: tb > 0 && ts != null ? (ts / tb) * 100 : null,
        };
      });
    const currencies = budgetByCurrency.map(r => r.currency);
    const currencyMixed = currencies.length > 1;
    const currency: string | null = currencies.length === 1 ? currencies[0] : null;
    // CAFA does not store dated beneficiary snapshots or another verified
    // monthly achievement series. Return no series rather than imply that
    // current cumulative project values happened evenly over time.
    const monthly: { month: string; target: number; achieved: number }[] = [];
    // Financial fields are gated to Budget & Donors approved roles only.
    // Non-financial fields (project counts, risks, reports, activities) are always returned.
    const hasFinancialAccess = BUDGET_DONORS_ROLES.has(req.currentUser?.role ?? "");
    const operationalSummary = {
      activeProjects: projectTotals.active,
      totalProjects: projectTotals.total,
      completedProjects: projectTotals.closed,
      statesCount: stateTotals.c,
      totalBeneficiaries: reachedTotals.reached,
      beneficiariesTarget: targetTotals.target,
      highRiskStates: riskStateTotals.high,
      openRisks: riskTotals.open,
      criticalRisks: riskTotals.critical,
      reportsSubmitted: reportTotals.submitted,
      reportsPending: reportTotals.pending,
      activitiesPlanned: activityTotals.planned,
      activitiesCompleted: activityTotals.completed,
      pendingApprovalsCount: pendingTotals.proj + pendingTotals.rep,
      delayedActivities: delayedTotals.cnt,
      byStatus: byStatus.rows,
      monthlyAchievement: monthly,
    };
    const financialSummary = {
      totalBudget,
      totalSpent,
      budgetRemaining: totalBudget - totalSpent,
      budgetAllocated,
      budgetUtilization,
      burnRatePct: burn,
      // DEFECT-05: currency metadata + per-currency grouped totals for multi-currency portfolios
      currency,
      currencyMixed,
      budgetByCurrency,
    };
    // Financial fields are intentionally omitted, rather than null-filled, for
    // operational-only dashboard callers. This keeps the response boundary
    // enforceable independently of the client.
    res.json(hasFinancialAccess ? { ...operationalSummary, ...financialSummary } : operationalSummary);
  } catch (err) {
    next(err);
  }
});

router.get("/dashboard/state-performance", dashboardFilterGuard("statePerformance"), async (req, res, next) => {
  try {
    const scope = await buildScope(req);
    const query = req.query as Record<string, string | undefined>;
    const scopeError = dashboardScopeError(scope, query);
    if (scopeError) {
      res.status(403).json({ error: scopeError });
      return;
    }
    if (scope.projectIds !== undefined) {
      res.status(403).json({ error: "dashboard_scope_forbidden" });
      return;
    }
    // The performance engine consumes ScopeFilter; use the same state/sector
    // narrowing semantics as Dashboard aggregates rather than a local sector
    // special case.
    const { effectiveScope } = applyFilterParams(scope, query);
    const rows = await computeStateScores(pool, effectiveScope);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get("/dashboard/notifications-summary", dashboardFilterGuard("notificationsSummary"), async (req, res, next) => {
  try {
    const userId = req.currentUser?.id;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const [byModule, recentRows] = await Promise.all([
      pool.query(
        `SELECT entity_type AS module,
           COUNT(*) FILTER (WHERE read_at IS NULL)::int AS unread,
           COUNT(*)::int AS total
         FROM notifications WHERE user_id = $1 AND entity_type IS NOT NULL
         GROUP BY entity_type ORDER BY unread DESC`,
        [userId],
      ),
      pool.query(
        `SELECT id, message AS title, entity_type AS module, kind,
                entity_id AS "entityId", entity_type AS "entityType",
                (read_at IS NULL) AS "isRead", created_at AS "createdAt", link
         FROM notifications WHERE user_id = $1 AND read_at IS NULL
         ORDER BY created_at DESC LIMIT 8`,
        [userId],
      ),
    ]);

    const totalUnread: number = byModule.rows.reduce(
      (s: number, r: { unread: number }) => s + (r.unread ?? 0), 0,
    );

    res.json({
      totalUnread,
      byModule: byModule.rows,
      recent: recentRows.rows,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/dashboard/sector-performance", dashboardFilterGuard("sectorPerformance"), async (req, res, next) => {
  try {
    // Non-financial fields (sector, projects, beneficiaries, indicatorAchievementPct,
    // mixedCurrencies) are returned to all authenticated roles scoped by userScope().
    // budgetUtilizationPct is a financial field — calculated for BUDGET_DONORS_ROLES
    // and returned as null for operational-only callers.
    const hasBudgetAccess = BUDGET_DONORS_ROLES.has(req.currentUser?.role ?? "");
    const scope = await buildScope(req);
    const { sql: scopeSql, params: scopeParams } = projectScopeWhere(scope, "p", 1);
    const { rows } = await pool.query(`
      SELECT
        p.sector AS sector,
        COUNT(DISTINCT p.id)::int AS projects,
        COALESCE(SUM(p.beneficiaries_male + p.beneficiaries_female + p.beneficiaries_boys + p.beneficiaries_girls), 0)::int AS beneficiaries,
        COALESCE((SELECT
          CASE WHEN SUM(i.target) > 0 THEN (SUM(i.achieved) / SUM(i.target) * 100)::int ELSE 0 END
          FROM indicators i
          JOIN projects indicator_project ON indicator_project.id = i.project_id
            AND indicator_project.deleted_at IS NULL
          WHERE i.sector = p.sector), 0) AS "indicatorAchievementPct",
        COUNT(DISTINCT NULLIF(p.currency, ''))::int AS "currencyCount",
        SUM(p.budget_total)::float AS "totalBudget",
        SUM(a_agg.spent)::float AS "totalSpent"
      FROM projects p
      LEFT JOIN (SELECT project_id, SUM(budget_spent) AS spent FROM activities GROUP BY project_id) a_agg ON a_agg.project_id = p.id
      WHERE p.deleted_at IS NULL${scopeSql} GROUP BY p.sector ORDER BY projects DESC
    `, scopeParams);
    // BUD-007: never mix currencies into a single utilisation ratio.
    //  - mixed-currency sector → budgetUtilizationPct = null + mixedCurrencies flag
    //  - zero/null budget or null spend → null (unavailable ≠ 0%)
    //  - overspend (>100%) preserved for single-currency sectors
    res.json(rows.map((r: Record<string, unknown>) => {
      const mixedCurrencies = Number(r.currencyCount) > 1;
      const totalBudget = r.totalBudget as number | null;
      const totalSpent = r.totalSpent as number | null;
      const budgetUtilizationPct = mixedCurrencies
        ? null
        : (totalBudget != null && totalBudget > 0 && totalSpent != null
            ? Math.round((totalSpent / totalBudget) * 100)
            : null);
      return {
        sector: r.sector,
        projects: r.projects,
        beneficiaries: r.beneficiaries,
        indicatorAchievementPct: r.indicatorAchievementPct,
        // Preserve a stable operational row shape while redacting the financial value.
        budgetUtilizationPct: hasBudgetAccess ? budgetUtilizationPct : null,
        mixedCurrencies,
      };
    }));
  } catch (err) {
    next(err);
  }
});

router.get("/dashboard/pending-approvals", dashboardFilterGuard("pendingApprovals"), async (req, res, next) => {
  try {
    const u = req.currentUser;
    if (!u) { res.json({ projects: [], reports: [] }); return; }

    const scope = await buildScope(req);
    const canonicalReportScope = userScope(req);
    const { sql: projScopeSql, params: projScopeParams } = projectScopeWhere(scope, "p", 1);

    // Determine which workflow steps this role can currently action.
    // Only items where the authenticated user is the designated next approver are returned.
    // Roles outside the approval workflow receive empty lists — they are not hidden,
    // they simply have no actionable items.
    type RoleStep = { projStatuses: string[]; reportPredicate: string | null };
    const roleSteps: Record<string, RoleStep> = {
      technical_coordinator: {
        projStatuses: ["submitted"],
        reportPredicate: `(r.report_type IN ('project','activity')
          AND r.workflow_path = 'state_authored'
          AND r.status IN ('submitted','state_reviewed'))`,
      },
      senior_program_coordinator: {
        projStatuses: ["technically_approved"],
        reportPredicate: `(
          (r.report_type IN ('project','activity') AND (
            (r.workflow_path = 'state_authored' AND r.status = 'technically_approved')
            OR (r.workflow_path = 'technical_authored' AND r.status = 'submitted')
          ))
          OR (r.report_type IN ('program_state','hq_sector') AND r.status = 'submitted')
        )`,
      },
      program_manager: {
        projStatuses: ["coordination_approved"],
        reportPredicate: `r.status = 'coordination_approved'`,
      },
      super_admin:                 {
        projStatuses:   ["submitted", "technically_approved", "coordination_approved"],
        reportPredicate: `r.status = ANY(${AWAITING_APPROVAL_STATUSES_SQL})`,
      },
    };

    const steps = roleSteps[u.role];
    if (!steps || (steps.projStatuses.length === 0 && steps.reportPredicate === null)) {
      res.json({ projects: [], reports: [] }); return;
    }

    // Build project query scoped to the role's actionable statuses
    const nextProjIdx = projScopeParams.length + 1;
    const projStatusPlaceholder = `$${nextProjIdx}::text[]`;

    const projects = await pool.query(`
      SELECT p.id, p.code, p.title, p.status, p.sector, p.donor,
             p.start_date AS "startDate", p.end_date AS "endDate",
             p.budget_total::float AS "budgetTotal",
             COALESCE((SELECT SUM(a.budget_spent)::float FROM activities a WHERE a.project_id = p.id), 0) AS "budgetSpent",
             p.beneficiaries_target AS "beneficiariesTarget",
              COALESCE(p.beneficiaries_male + p.beneficiaries_female + p.beneficiaries_boys + p.beneficiaries_girls, 0)::int AS "beneficiariesReached",
             COALESCE((SELECT AVG(a.progress_pct)::int FROM activities a WHERE a.project_id = p.id), 0) AS "progressPct",
             ARRAY(SELECT ps.state_id FROM project_states ps WHERE ps.project_id = p.id ORDER BY ps.state_id) AS "stateIds",
             ARRAY(SELECT s.name FROM project_states ps JOIN states s ON s.id = ps.state_id WHERE ps.project_id = p.id ORDER BY ps.state_id) AS "stateNames",
             ARRAY(SELECT s.name_ar FROM project_states ps JOIN states s ON s.id = ps.state_id WHERE ps.project_id = p.id ORDER BY ps.state_id) AS "stateNamesAr"
      FROM projects p
      WHERE p.status = ANY(${projStatusPlaceholder})${projScopeSql}
      ORDER BY p.created_at DESC LIMIT 20
    `, [...projScopeParams, steps.projStatuses]);

    // Reports query — scoped to role's actionable report statuses
    let reportRows: Record<string, unknown>[] = [];
    if (steps.reportPredicate) {
      const reportFilters: string[] = [steps.reportPredicate];
      const rptExtraParams: (number | string | string[] | number[])[] = [];
      const reportScope = reportScopeWhere(canonicalReportScope, "r", "p", "act", 1);
      reportFilters.push(reportScope.sql.replace(/^ AND /, ""));
      rptExtraParams.push(...reportScope.params);

      const reports = await pool.query(`
        SELECT r.id, r.title, r.kind, r.report_type AS "reportType", r.status,
               r.project_id AS "projectId", p.title AS "projectTitle",
               r.state_id AS "stateId", s.name AS "stateName", s.name_ar AS "stateNameAr",
               r.period, r.narrative,
               u.name AS "submittedByName", r.submitted_at AS "submittedAt"
        FROM reports r
        LEFT JOIN projects p ON p.id = r.project_id
        LEFT JOIN activities act ON act.id = r.activity_id
        LEFT JOIN states s ON s.id = r.state_id
        LEFT JOIN users u ON u.id = r.submitted_by_id
        WHERE ${reportFilters.join(" AND ")}
          AND r.report_type = ANY(${CANONICAL_TYPES_SQL})
          AND ${activeProjectParentSQL("r.project_id")}
          AND ${operationalPopulationSQL()}
        ORDER BY r.submitted_at DESC LIMIT 20
      `, rptExtraParams);
      reportRows = reports.rows as Record<string, unknown>[];
    }

    res.json({
      projects: projects.rows,
      // approvalHistory omitted where no source is available (not returned as misleading [])
      reports: reportRows.map(({ ...r }) => r),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/dashboard/recent-activity", dashboardFilterGuard("recentActivity"), async (req, res, next) => {
  try {
    const scope = await buildScope(req);
    const activeAuditParentFilter = `(
      (a.module IN ('projects', 'project') AND p.deleted_at IS NULL)
      OR (a.module = 'reports' AND ${activeProjectParentSQL("r.project_id")})
      OR (a.module = 'risks' AND ${activeProjectParentSQL("rk.project_id")})
      OR (a.module = 'beneficiaries' AND ${activeProjectParentSQL("b.project_id")})
      OR (a.module = 'activities' AND ${activeProjectParentSQL("act.project_id")})
      OR (a.module = 'outputs' AND ${activeProjectParentSQL("o.project_id")})
      OR (a.module = 'plans' AND ${activeProjectParentSQL("pl.project_id")})
      OR a.module NOT IN ('projects', 'project', 'reports', 'risks', 'beneficiaries', 'activities', 'outputs', 'plans')
    )`;
    // Audit-log rows are scoped through their parent record. Assignment-scoped
    // users must never receive generic audit modules with no parent proof.
    const stateJoinFilter = scope.denyAll
      ? "WHERE FALSE"
      : scope.projectIds !== undefined
      ? `WHERE (a.module IN ('projects', 'project') AND a.entity_id = ANY($1::int[]))
           OR (a.module = 'reports' AND a.entity_id IN (SELECT id FROM reports r2 WHERE r2.state_id = $2))
           OR (a.module = 'risks' AND a.entity_id IN (SELECT id FROM risks WHERE project_id = ANY($1::int[])))
           OR (a.module = 'beneficiaries' AND a.entity_id IN (SELECT id FROM beneficiaries WHERE project_id = ANY($1::int[])))`
      : scope.stateId !== null
      ? `WHERE a.user_id IN (SELECT id FROM users WHERE state_id = ${scope.stateId})
           OR (a.module IN ('projects', 'project') AND a.entity_id IN (SELECT project_id FROM project_states WHERE state_id = ${scope.stateId}))
           OR (a.module = 'reports' AND a.entity_id IN (SELECT id FROM reports WHERE state_id = ${scope.stateId}))
           OR (a.module = 'risks' AND a.entity_id IN (SELECT id FROM risks WHERE state_id = ${scope.stateId}))`
      : scope.sectors !== null && scope.sectors.length > 0
        ? `WHERE (a.module IN ('projects', 'project') AND a.entity_id IN (SELECT id FROM projects WHERE sector = ANY($1::text[])))
              OR (a.module = 'reports' AND a.entity_id IN (
                SELECT r2.id FROM reports r2
                LEFT JOIN projects p2 ON p2.id = r2.project_id
                LEFT JOIN activities act2 ON act2.id = r2.activity_id
                WHERE ${technicalCoordinatorReportSectorSQL("r2", "p2", "act2", 1)}
              ))
             OR (a.module NOT IN ('projects','reports','risks'))`
        : scope.sectors !== null && scope.sectors.length === 0
          ? "WHERE FALSE"
          : "";
    const whereClause = stateJoinFilter
      ? `${stateJoinFilter} AND ${activeAuditParentFilter}`
      : `WHERE ${activeAuditParentFilter}`;

    const params: unknown[] = scope.projectIds !== undefined
      ? [scope.projectIds, scope.stateId]
      : scope.sectors !== null && scope.sectors.length > 0 ? [scope.sectors] : [];

    const { rows } = await pool.query(`
      SELECT a.id,
             CASE
                WHEN a.module IN ('projects', 'project') AND a.action = 'create' THEN 'project_created'
                WHEN a.module IN ('projects', 'project') THEN 'project_' || a.action
               WHEN a.module = 'reports' THEN 'report_' || a.action
               WHEN a.module = 'risks' THEN 'risk_' || a.action
               WHEN a.module = 'beneficiaries' THEN 'beneficiary_' || a.action
               ELSE a.action
             END AS kind,
             CASE
                WHEN a.module IN ('projects', 'project') THEN COALESCE(p.title, 'project')
               WHEN a.module = 'reports' THEN COALESCE(r.title, 'report')
               WHEN a.module = 'risks' THEN COALESCE(rk.title, 'risk')
               WHEN a.module = 'beneficiaries' THEN COALESCE(a.new_value, 'beneficiary')
               ELSE COALESCE(a.new_value, a.action)
             END AS message,
             u.name AS "actorName", u.role_label AS "actorRole",
             COALESCE(ps.state_name, rs.name, rkst.name, bst.name) AS "stateName",
             COALESCE(p.title, r.title) AS "projectTitle",
             a.timestamp
      FROM audit_log a
      LEFT JOIN users u ON u.id = a.user_id
      LEFT JOIN projects p ON a.module IN ('projects', 'project') AND p.id = a.entity_id
      LEFT JOIN reports r ON a.module = 'reports' AND r.id = a.entity_id
      LEFT JOIN risks rk ON a.module = 'risks' AND rk.id = a.entity_id
      LEFT JOIN activities act ON a.module = 'activities' AND act.id = a.entity_id
      LEFT JOIN outputs o ON a.module = 'outputs' AND o.id = a.entity_id
      LEFT JOIN plans pl ON a.module = 'plans' AND pl.id = a.entity_id
      LEFT JOIN states rs ON r.state_id = rs.id
      LEFT JOIN states rkst ON rk.state_id = rkst.id
      LEFT JOIN beneficiaries b ON a.module = 'beneficiaries' AND b.id = a.entity_id
      LEFT JOIN states bst ON b.state_id = bst.id
      LEFT JOIN LATERAL (
        SELECT s.name AS state_name FROM project_states ps2
        JOIN states s ON s.id = ps2.state_id
        WHERE ps2.project_id = p.id LIMIT 1
      ) ps ON TRUE
      ${whereClause}
      ORDER BY a.timestamp DESC LIMIT 30
    `, params);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get("/dashboard/sector-budget", dashboardFilterGuard("sectorBudget"), async (req, res, next) => {
  try {
    // BUD-013: explicit upfront role gate — Budget & Donors approved roles only.
    if (!requireBudgetDonorsRole(req, res)) return;
    const { donor, stateId: qStateId, sector, status, dateFrom, dateTo } = req.query as Record<string, string | undefined>;
    const scope = await buildScope(req);
    // This endpoint predates the shared aggregate helper because it also
    // supports `status`; retain its response contract for an unconfigured TC,
    // but never silently substitute the caller's scope for an explicitly
    // requested state/sector outside that scope.
    const scopeFilterError = dashboardScopeError(scope, { stateId: qStateId, sector });
    if (scopeFilterError && (qStateId !== undefined || sector !== undefined)) {
      res.status(403).json({ error: scopeFilterError });
      return;
    }

    // For state roles, force stateId to their assigned state.
    const effectiveStateId = scope.stateId ?? (qStateId ? Number(qStateId) : null);
    // For TCs, intersect requested sector with allowed sectors.
    // TCs always see 0 unresolved projects — unresolved sector fails closed.
    const isTcScope = scope.sectors !== null;
    let effectiveSector = sector ?? null;
    if (isTcScope) {
      if (scope.sectors!.length === 0) {
        res.json({ sectors: [], unresolvedSectorProjects: 0, unresolvedBudgetByCurrency: {} });
        return;
      }
      if (effectiveSector && !scope.sectors!.includes(effectiveSector)) {
        res.json({ sectors: [], unresolvedSectorProjects: 0, unresolvedBudgetByCurrency: {} });
        return;
      }
    }

    const params: unknown[] = [
      donor ?? null,
      status ?? null,
      effectiveSector,
      effectiveStateId,
      dateFrom ?? null,
      dateTo ?? null,
    ];
    const { sql: projectScopeSql, params: projectScopeParams } = projectScopeWhere(scope, "p", 7);
    params.push(...projectScopeParams);

    type DbRow = {
      sector: string;
      currency: string;
      projectCount: number;
      // bigint columns come back as strings in node-postgres
      totalActivityCount: string | null;
      incompleteActivityCount: string | null;
      // financial fields — intentionally nullable (null = missing, not zero)
      budgetTotal: number | null;
      activityPlanned: number | null;
      activitySpent: number | null;
      // exception flags — always non-null integers / floats
      overallocatedProjectCount: number;
      overallocatedAmount: number;
      overspentProjectCount: number;
      overspentAmount: number;
    };

    const { rows } = await pool.query<DbRow>(`
      WITH project_filter AS (
        SELECT p.id, p.sector, p.budget_total, p.currency
        FROM projects p
        WHERE p.deleted_at IS NULL AND p.sector IS NOT NULL AND p.sector <> ''
          AND ($1::text IS NULL OR p.donor = $1)
          AND ($2::text IS NULL OR p.status = $2)
          AND ($3::text IS NULL OR p.sector = $3)
          AND ($4::int IS NULL OR EXISTS (
                SELECT 1 FROM project_states ps WHERE ps.project_id = p.id AND ps.state_id = $4
              ))
          AND ($5::date IS NULL OR p.end_date >= $5::date)
          AND ($6::date IS NULL OR p.start_date <= $6::date)
          ${projectScopeSql}
      ),
      project_activities AS (
        -- Intentionally no COALESCE: null budget_planned/spent means no recorded value,
        -- which is distinct from an authoritative zero.
        SELECT
          a.project_id,
          COUNT(*)::bigint                                       AS total_activity_count,
          COUNT(*) FILTER (WHERE a.progress_pct < 100)::bigint  AS incomplete_activity_count,
          SUM(a.budget_planned)::float                           AS activity_planned,
          SUM(a.budget_spent)::float                             AS activity_spent
        FROM activities a
        WHERE a.project_id IN (SELECT id FROM project_filter)
        GROUP BY a.project_id
      ),
      project_with_flags AS (
        SELECT
          pf.id, pf.sector, pf.currency, pf.budget_total,
          pa.total_activity_count,
          pa.incomplete_activity_count,
          pa.activity_planned,
          pa.activity_spent,
          -- Overallocated: activity planned > project budget_total (both non-null)
          CASE WHEN pa.activity_planned IS NOT NULL
                AND pf.budget_total IS NOT NULL
                AND pa.activity_planned > pf.budget_total
               THEN 1 ELSE 0 END AS is_overallocated,
          CASE WHEN pa.activity_planned IS NOT NULL
                AND pf.budget_total IS NOT NULL
                AND pa.activity_planned > pf.budget_total
               THEN pa.activity_planned - pf.budget_total ELSE NULL END AS overallocated_amount,
          -- Overspent: activity spent > project budget_total (both non-null)
          CASE WHEN pa.activity_spent IS NOT NULL
                AND pf.budget_total IS NOT NULL
                AND pa.activity_spent > pf.budget_total
               THEN 1 ELSE 0 END AS is_overspent,
          CASE WHEN pa.activity_spent IS NOT NULL
                AND pf.budget_total IS NOT NULL
                AND pa.activity_spent > pf.budget_total
               THEN pa.activity_spent - pf.budget_total ELSE NULL END AS overspent_amount
        FROM project_filter pf
        LEFT JOIN project_activities pa ON pa.project_id = pf.id
      )
      SELECT
        sector,
        currency,
        COUNT(DISTINCT id)::int                        AS "projectCount",
        -- Activity counts: null if no activities exist for any project in this group
        SUM(total_activity_count)                      AS "totalActivityCount",
        SUM(incomplete_activity_count)                 AS "incompleteActivityCount",
        -- Financial: SUM returns null when all inputs are null (missing ≠ zero)
        SUM(budget_total)::float                       AS "budgetTotal",
        SUM(activity_planned)::float                   AS "activityPlanned",
        SUM(activity_spent)::float                     AS "activitySpent",
        -- Exception metrics: 0 = no exceptions (authoritative zero, use COALESCE)
        SUM(is_overallocated)::int                     AS "overallocatedProjectCount",
        COALESCE(SUM(overallocated_amount), 0)::float  AS "overallocatedAmount",
        SUM(is_overspent)::int                         AS "overspentProjectCount",
        COALESCE(SUM(overspent_amount), 0)::float      AS "overspentAmount"
      FROM project_with_flags
      GROUP BY sector, currency
      ORDER BY sector, "budgetTotal" DESC NULLS LAST, currency
    `, params);

    // ── Group per-currency rows into the per-sector response shape ────────────
    const sectorMap = new Map<string, DbRow[]>();
    for (const row of rows) {
      if (!sectorMap.has(row.sector)) sectorMap.set(row.sector, []);
      sectorMap.get(row.sector)!.push(row);
    }

    const sectors = Array.from(sectorMap.entries()).map(([sectorName, sectorRows]) => {
      const currencyMixed = sectorRows.length > 1;

      // Activity counts are per-project not per-currency; sum across currency groups.
      // A null from SUM means the entire group had no activities.
      let totalActivityCount: number | null = null;
      let incompleteActivityCount: number | null = null;
      for (const r of sectorRows) {
        const tac = r.totalActivityCount !== null ? Number(r.totalActivityCount) : null;
        const iac = r.incompleteActivityCount !== null ? Number(r.incompleteActivityCount) : null;
        if (tac !== null) totalActivityCount = (totalActivityCount ?? 0) + tac;
        if (iac !== null) incompleteActivityCount = (incompleteActivityCount ?? 0) + iac;
      }

      const totalProjectCount = sectorRows.reduce((s, r) => s + r.projectCount, 0);

      const budgetByCurrency = sectorRows.map(r => {
        const bt = r.budgetTotal;       // null = no budget recorded
        const ap = r.activityPlanned;   // null = no activity budgets recorded
        const as_ = r.activitySpent;    // null = no expenditure recorded
        // Derived metrics: null if any required operand is missing
        const remaining   = bt !== null && as_ !== null ? bt - as_  : null;
        const unallocated = bt !== null && ap !== null  ? bt - ap   : null;
        // Budget Utilisation: null if denominator is 0 or either operand missing
        const utilisationPct = bt !== null && bt > 0 && as_ !== null
          ? (as_ / bt) * 100
          : null;
        return {
          currency: r.currency,
          projectCount: r.projectCount,
          budgetTotal: bt,
          activityPlanned: ap,
          activitySpent: as_,
          remaining,
          unallocated,
          utilisationPct,
          overallocatedProjectCount: r.overallocatedProjectCount,
          overallocatedAmount: r.overallocatedAmount,
          overspentProjectCount: r.overspentProjectCount,
          overspentAmount: r.overspentAmount,
        };
      });

      return {
        sector: sectorName,
        projectCount: totalProjectCount,
        totalActivityCount,
        incompleteActivityCount,
        currencyMixed,
        budgetByCurrency,
      };
    });

    // ── Unresolved sector projects (sector IS NULL) ───────────────────────────
    // TCs always see 0 — unresolved records fall outside all TC sector scopes.
    let unresolvedSectorProjects = 0;
    const unresolvedBudgetByCurrency: Record<string, number> = {};

    if (!isTcScope) {
      const unresolvedParams: unknown[] = [
        donor ?? null, status ?? null, effectiveStateId, dateFrom ?? null, dateTo ?? null,
      ];
      const { sql: unresolvedScopeSql, params: unresolvedScopeParams } = projectScopeWhere(scope, "p", 6);
      unresolvedParams.push(...unresolvedScopeParams);
      const { rows: unresolvedRows } = await pool.query<{
        currency: string; projectCount: number; budgetTotal: number;
      }>(`
        SELECT
          p.currency,
          COUNT(*)::int                                    AS "projectCount",
          COALESCE(SUM(p.budget_total), 0)::float          AS "budgetTotal"
        FROM projects p
        WHERE p.deleted_at IS NULL AND (p.sector IS NULL OR p.sector = '')
          AND ($1::text IS NULL OR p.donor = $1)
          AND ($2::text IS NULL OR p.status = $2)
          AND ($3::int  IS NULL OR EXISTS (
                SELECT 1 FROM project_states ps WHERE ps.project_id = p.id AND ps.state_id = $3
              ))
          AND ($4::date IS NULL OR p.end_date   >= $4::date)
          AND ($5::date IS NULL OR p.start_date <= $5::date)
          ${unresolvedScopeSql}
        GROUP BY p.currency
      `, unresolvedParams);

      for (const row of unresolvedRows) {
        unresolvedSectorProjects += row.projectCount;
        unresolvedBudgetByCurrency[row.currency] =
          (unresolvedBudgetByCurrency[row.currency] ?? 0) + row.budgetTotal;
      }
    }

    res.json({ sectors, unresolvedSectorProjects, unresolvedBudgetByCurrency });
  } catch (err) {
    next(err);
  }
});

/**
 * Donor Portfolio — access control
 *
 * Approved roles (per CAFA PMIS authorisation spec):
 *   super_admin, executive_director    — org-wide scope
 *   program_manager                    — org-wide scope
 *   senior_program_coordinator         — org-wide scope
 *   technical_coordinator              — sector-scoped (tcSectorRestriction)
 *   state_program_officer              — state-scoped  (stateId)
 *
 * Explicitly excluded (mirrors BUDGET_DONORS_ROLES above):
 *   state_office_manager — state role, but NOT approved for Budget & Donors
 *
 * No donor.* or finance.* permission strings exist in the permission
 * architecture. Data restriction is enforced by userScope() below — each
 * role receives only projects within their authorised State or Sector.
 * Unauthenticated requests are rejected with 401 by the global requireAuth
 * middleware before reaching this handler.
 *
 * Frontend guard: canViewBudgetAndDonors(role) in dashboard.tsx.
 * Both must stay in sync with the BUDGET_DONORS_ROLES set above.
 */
router.get("/dashboard/donor-portfolio", dashboardFilterGuard("donorPortfolio"), async (req, res, next) => {
  try {
    // Step 1: role gate — authentication alone is insufficient
    if (!requireBudgetDonorsRole(req, res)) return;

    // Step 2: scope resolution
    const scope = await buildScope(req);

    // Step 3: fail-closed for approved roles with missing scope configuration.
    // TC without assigned Sectors must NOT fall back to org-wide access.
    if (req.currentUser!.role === "technical_coordinator" &&
        scope.sectors !== null && scope.sectors.length === 0) {
      res.status(403).json({
        error: "Budget & Donors access requires an assigned Sector. Contact your administrator.",
      });
      return;
    }
    // SPO without an assigned State must NOT fall back to org-wide access.
    if (req.currentUser!.role === "state_program_officer" && scope.stateId === null) {
      res.status(403).json({
        error: "Budget & Donors access requires an assigned State. Contact your administrator.",
      });
      return;
    }

    // Step 3.5: validate and apply optional ?stateId location narrowing.
    // HQ roles (PM, ED, SPC, super_admin) may narrow to a single state.
    // State-scoped roles (SPO) stay clamped to their own stateId — applyFilterParams
    // enforces this because scope.stateId !== null for SPO.
    const { effectiveScope } = applyFilterParams(scope, req.query as Record<string, string | undefined>);
    const { sql: scopeSql, params: scopeParams } = projectScopeWhere(effectiveScope, "p", 1);

    // Single flat query — all in-scope projects joined with the canonical donors table.
    // Grouping is done in TypeScript so we can apply the canonical-vs-free-text mismatch
    // logic cleanly, deduplicate projects by id, and avoid multi-scopeParam repetition.
    const { rows } = await pool.query<{
      id: number; code: string; title: string;
      budget_total: number | null; currency: string | null;
      free_text_donor: string | null; donor_id: number | null;
      d_id: number | null; d_name: string | null;
      beneficiaries: number;
    }>(`
      SELECT
        p.id, p.code, p.title,
        p.budget_total::float  AS budget_total,
        p.currency,
        p.donor                AS free_text_donor,
        p.donor_id,
        d.id                   AS d_id,
        d.name                 AS d_name,
        COALESCE(p.beneficiaries_male + p.beneficiaries_female + p.beneficiaries_boys + p.beneficiaries_girls, 0)::int AS beneficiaries
      FROM projects p
      LEFT JOIN donors d ON d.id = p.donor_id
      WHERE p.deleted_at IS NULL${scopeSql}
      ORDER BY p.id
    `, scopeParams);

    // ── Fetch actual activity spend per project (null = no activities) ────
    const allProjectIds = Array.from(new Set(rows.map(r => r.id)));
    const spentByProjectId = new Map<number, number | null>();
    if (allProjectIds.length > 0) {
      const actResult = await pool.query<{ project_id: number; spent: number | null }>(
        `SELECT project_id, SUM(budget_spent)::float AS spent
         FROM activities WHERE project_id = ANY($1::int[]) GROUP BY project_id`,
        [allProjectIds],
      );
      for (const ar of actResult.rows) {
        spentByProjectId.set(ar.project_id, ar.spent);
      }
    }

    // ── TypeScript grouping ────────────────────────────────────────────────
    type GEntry = {
      donorId:            number | null;
      donorName:          string;
      freeTextDonorName:  string | null;
      statuses:           Set<string>;
      projectIds:         Set<number>;
      projectList:        { id: number; code: string; title: string }[];
      currencyBudget:     Map<string, number>;
      spentByCurrency:    Map<string, number>;
      hasMissingCurrency: boolean;
      totalBeneficiaries: number;
    };
    const grouped = new Map<string, GEntry>();

    for (const row of rows) {
      const hasCanonical = row.d_id != null;
      const hasFreeText  = typeof row.free_text_donor === "string"
                        && row.free_text_donor.trim() !== "";

      // Classify this project's data status
      let status: string;
      if (hasCanonical) {
        const namesMatch = hasFreeText &&
          row.d_name!.toLowerCase().trim() === row.free_text_donor!.toLowerCase().trim();
        status = hasFreeText && !namesMatch ? "name_mismatch" : "linked";
      } else if (hasFreeText) {
        status = "unlinked";
      } else {
        status = "missing";
      }

      // Stable group key:
      //   canonical donors   → grouped by donor_id (one row per canonical entity)
      //   unlinked free-text → grouped by normalised free-text value
      //   completely missing → each project is its own entry (surfaced individually)
      const groupKey = hasCanonical
        ? `canonical:${row.d_id}`
        : hasFreeText
          ? `free:${row.free_text_donor!.toLowerCase().trim()}`
          : `missing:${row.id}`;

      const donorName = row.d_name
        ?? (hasFreeText ? row.free_text_donor! : null);

      if (!grouped.has(groupKey)) {
        grouped.set(groupKey, {
          donorId:            row.d_id,
          donorName:          donorName ?? "(Unknown Donor)",
          freeTextDonorName:  hasFreeText ? row.free_text_donor : null,
          statuses:           new Set(),
          projectIds:         new Set(),
          projectList:        [],
          currencyBudget:     new Map(),
          spentByCurrency:    new Map(),
          hasMissingCurrency: false,
          totalBeneficiaries: 0,
        });
      }

      const g = grouped.get(groupKey)!;
      g.statuses.add(status);

      // Deduplicate: a multi-state project joins multiple rows but must be counted once
      // Deduplicate: a multi-state project may produce multiple rows via scope JOINs but
      // must be counted once. Budget, spend, beneficiaries, and project list are all
      // accumulated inside this guard so no accumulator can double-count a project.
      if (!g.projectIds.has(row.id)) {
        g.projectIds.add(row.id);
        g.projectList.push({ id: row.id, code: row.code, title: row.title });

        // Accumulate deduplicated beneficiaries
        g.totalBeneficiaries += (row.beneficiaries ?? 0);

        // Budget, spend, and missing-currency flag — all project-ID–deduplicated together
        // so multi-row JOINs cannot inflate any financial figure.
        const projCurrency = (row.currency ?? "").trim() || null;
        if (projCurrency) {
          // Budget accumulation
          g.currencyBudget.set(projCurrency, (g.currencyBudget.get(projCurrency) ?? 0) + (row.budget_total ?? 0));

          // Activity spend accumulation.
          // spentByProjectId: present = has activities (value may be null/0);
          //                   absent  = no activities at all.
          const projSpent = spentByProjectId.has(row.id) ? spentByProjectId.get(row.id)! : null;
          if (projSpent !== null) {
            g.spentByCurrency.set(
              projCurrency,
              (g.spentByCurrency.get(projCurrency) ?? 0) + projSpent,
            );
          }
          // null projSpent = no activity records or all-null budget_spent → omit from sum
        } else {
          g.hasMissingCurrency = true;
        }
      }
    }

    // ── Build response ─────────────────────────────────────────────────────
    const entries = Array.from(grouped.values()).map(g => {
      const currencies    = Array.from(g.currencyBudget.keys());
      const currencyMixed = currencies.length > 1;
      const currency: string | null = currencies.length === 1 ? currencies[0] : null;
      const allocatedBudget = Array.from(g.currencyBudget.values()).reduce((s, v) => s + v, 0);

      // Most severe status wins
      let dataStatus: string;
      if (g.statuses.has("name_mismatch")) dataStatus = "name_mismatch";
      else if (g.statuses.has("unlinked")) dataStatus = "unlinked";
      else if (g.statuses.has("missing"))  dataStatus = "missing";
      else                                 dataStatus = "linked";

      const dataIssues: string[] = [];
      if (dataStatus !== "linked")  dataIssues.push(dataStatus);
      if (g.hasMissingCurrency)     dataIssues.push("missing_currency");

      // Per-currency budget + spend breakdown — uses `curr` (loop var), not outer `currency`
      const budgetByCurrency = currencies
        .map(curr => {
          const budget = g.currencyBudget.get(curr)!;
          // null if no activity records existed for this donor's projects in this currency
          const spent: number | null = g.spentByCurrency.has(curr) ? g.spentByCurrency.get(curr)! : null;
          return {
            currency:       curr,
            allocatedBudget: budget,
            budgetTotal:    budget,  // backward-compat alias
            budgetSpent:    spent,
          };
        })
        .sort((a, b) => b.allocatedBudget - a.allocatedBudget);

      // Top-level budgetSpent: sum of all known per-currency spend (null when nothing known)
      const hasAnySpenData = g.spentByCurrency.size > 0;
      const totalBudgetSpent: number | null = hasAnySpenData
        ? Array.from(g.spentByCurrency.values()).reduce((s, v) => s + (v ?? 0), 0)
        : null;

      return {
        // ── Canonical fields ─────────────────────────────────────────────
        donorId:           g.donorId,
        donorName:         g.donorName,
        freeTextDonorName: g.freeTextDonorName,
        dataStatus,
        dataIssues,
        projectCount:      g.projectList.length,
        projectList:       g.projectList.sort((a, b) => a.code.localeCompare(b.code)),
        allocatedBudget,
        currency,
        currencyMixed,
        budgetByCurrency,
        // ── Legacy backward-compatible fields ────────────────────────────
        donor:         g.donorName,
        projects:      g.projectList.length,
        budgetTotal:   allocatedBudget,
        budgetSpent:   totalBudgetSpent,          // was hardcoded 0
        beneficiaries: g.totalBeneficiaries,      // was hardcoded 0
      };
    });

    // Default: allocated budget desc, then donor name asc as tie-breaker
    entries.sort((a, b) =>
      b.allocatedBudget !== a.allocatedBudget
        ? b.allocatedBudget - a.allocatedBudget
        : a.donorName.localeCompare(b.donorName),
    );

    res.json(entries);
  } catch (err) {
    next(err);
  }
});

router.get("/dashboard/project-budget-performance", dashboardFilterGuard("projectBudgetPerformance"), async (req, res, next) => {
  try {
    // Step 1: role gate
    if (!requireBudgetDonorsRole(req, res)) return;

    // Step 2: scope resolution — use userScope directly (NOT buildScope) so SPO stateId is
    // available for the project_state_allocations JOIN. buildScope rewrites SPO to
    // project_assignments which would lose the stateId we need.
    const scope = await buildScope(req);

    // Step 3: fail-closed for approved roles with missing scope configuration.
    if (req.currentUser!.role === "technical_coordinator" &&
        scope.sectors !== null && scope.sectors.length === 0) {
      res.status(403).json({
        error: "Budget & Donors access requires an assigned Sector. Contact your administrator.",
      });
      return;
    }
    if (req.currentUser!.role === "state_program_officer" && scope.stateId === null) {
      res.status(403).json({
        error: "Budget & Donors access requires an assigned State. Contact your administrator.",
      });
      return;
    }

    // Step 3.5: validate and apply optional ?stateId location narrowing.
    // HQ roles may narrow to a specific state; state-scoped roles stay clamped.
    const { effectiveScope: pbpScope } = applyFilterParams(scope, req.query as Record<string, string | undefined>);

    // isSpo and spoStateId are always derived from the raw user scope (not the effective
    // narrowed scope) so SPO project_state_allocations JOINs always use the user's own
    // assigned state — never an HQ-supplied ?stateId value.
    const isSpo = req.currentUser!.role === "state_program_officer";
    const spoStateId = scope.stateId;

    const { sql: scopeSql, params: scopeParams, nextIdx } = projectScopeWhere(pbpScope, "p", 1);

    // For SPO: LEFT JOIN project_state_allocations for their assigned state
    let psaJoin = "";
    let psaSelect = "NULL::float AS psa_allocated";
    const allParams: (number | string[] | number[])[] = [...scopeParams];
    let psaParamIdx = nextIdx;

    if (isSpo && spoStateId !== null) {
      psaJoin = `LEFT JOIN project_state_allocations psa ON psa.project_id = p.id AND psa.state_id = $${psaParamIdx}`;
      psaSelect = "psa.budget_allocation::float AS psa_allocated";
      allParams.push(spoStateId);
      psaParamIdx++;
    }

    // For SPO, build state subquery to show ONLY their assigned state (not all project states).
    // HQ and TC roles see all states a project operates in.
    let stateIdsSubquery: string;
    let stateNamesSubquery: string;
    let stateNamesArSubquery: string;

    if (isSpo && spoStateId !== null) {
      // SPO: only return their assigned state info when the project operates in it.
      // spoStateId was pushed to allParams at position (psaParamIdx - 1) = $N in SQL.
      const spoStateParamIdx = psaParamIdx - 1; // $N for spoStateId in the SQL param list
      stateIdsSubquery = `ARRAY(
            SELECT ps2.state_id
            FROM project_states ps2
            WHERE ps2.project_id = p.id AND ps2.state_id = $${spoStateParamIdx}
          )`;
      stateNamesSubquery = `ARRAY(
            SELECT s2.name
            FROM project_states ps2
            JOIN states s2 ON s2.id = ps2.state_id
            WHERE ps2.project_id = p.id AND ps2.state_id = $${spoStateParamIdx}
          )`;
      stateNamesArSubquery = `ARRAY(
            SELECT s2.name_ar
            FROM project_states ps2
            JOIN states s2 ON s2.id = ps2.state_id
            WHERE ps2.project_id = p.id AND ps2.state_id = $${spoStateParamIdx}
          )`;
    } else {
      // HQ / TC: all states the project operates in
      stateIdsSubquery = `ARRAY(
            SELECT ps2.state_id
            FROM project_states ps2
            WHERE ps2.project_id = p.id
            ORDER BY ps2.state_id
          )`;
      stateNamesSubquery = `ARRAY(
            SELECT s2.name
            FROM project_states ps2
            JOIN states s2 ON s2.id = ps2.state_id
            WHERE ps2.project_id = p.id
            ORDER BY ps2.state_id
          )`;
      stateNamesArSubquery = `ARRAY(
            SELECT s2.name_ar
            FROM project_states ps2
            JOIN states s2 ON s2.id = ps2.state_id
            WHERE ps2.project_id = p.id
            ORDER BY ps2.state_id
          )`;
    }

    const { rows } = await pool.query<{
      id: number;
      code: string;
      title: string;
      status: string;
      sector: string | null;
      budget_total: number | null;
      currency: string | null;
      donor_id: number | null;
      donor_name: string | null;
      free_text_donor: string | null;
      spent: number | null;
      state_ids: number[];
      state_names: string[];
      state_names_ar: string[];
      psa_allocated: number | null;
      last_financial_update: string | null;
    }>(`
      SELECT
        p.id,
        p.code,
        p.title,
        p.status,
        p.sector,
        p.budget_total::float AS budget_total,
        p.currency,
        p.donor_id,
        d.name AS donor_name,
        p.donor AS free_text_donor,
        exp.spent,
        COALESCE(
          ${stateIdsSubquery},
          ARRAY[]::int[]
        ) AS state_ids,
        COALESCE(
          ${stateNamesSubquery},
          ARRAY[]::text[]
        ) AS state_names,
        COALESCE(
          ${stateNamesArSubquery},
          ARRAY[]::text[]
        ) AS state_names_ar,
        ${psaSelect},
        p.updated_at::text AS last_financial_update
      FROM projects p
      LEFT JOIN donors d ON d.id = p.donor_id
      LEFT JOIN (
        SELECT project_id, SUM(budget_spent)::float AS spent
        FROM activities
        GROUP BY project_id
      ) AS exp ON exp.project_id = p.id
      ${psaJoin}
      WHERE p.deleted_at IS NULL${scopeSql}
      ORDER BY p.id
    `, allParams);

    const entries = rows.map(row => {
      // ── Expenditure source ────────────────────────────────────────────────────
      // activities.budget_spent is the APPROVED expenditure source — the identical
      // field used by the Budget Summary endpoint (line ~252 of this file).
      // Activities have no state_id column, so this value is always project-level.
      const projectLevelSpent: number | null = row.spent ?? null;

      // ── Budget basis ──────────────────────────────────────────────────────────
      // "State Allocation" only when SPO has an approved allocation record for their state.
      const budgetBasis: string =
        (isSpo && row.psa_allocated != null) ? "State Allocation" : "Project-Level Budget";

      // ── Financial-basis consistency (spec: Financial Source Of Truth) ─────────
      // Every row MUST use values from ONE consistent financial level.
      //
      // "State Allocation" basis:
      //   allocatedBudget = psa.budget_allocation (the authorised state allocation).
      //   Spent / Remaining / Utilisation are null ("—") because activities have no
      //   state_id — there is no reliable approved state-level expenditure source.
      //   Mixing a state-level denominator with project-wide spend would be incorrect.
      //
      // "Project-Level Budget" basis:
      //   allocatedBudget = p.budget_total.
      //   Spent = activities.budget_spent (same approved source as Budget Summary).
      let allocatedBudget: number | null;
      let spent: number | null;
      let remainingBalance: number | null;
      let utilisationRate: number | null;
      const missingStateExpenditure: boolean = budgetBasis === "State Allocation";

      if (budgetBasis === "State Allocation") {
        allocatedBudget  = row.psa_allocated;  // state allocation amount
        spent            = null;               // no reliable state-level source
        remainingBalance = null;
        utilisationRate  = null;
      } else {
        allocatedBudget  = row.budget_total;
        spent            = projectLevelSpent;
        const s          = spent ?? 0;
        remainingBalance = allocatedBudget != null ? allocatedBudget - s : null;
        utilisationRate  = (allocatedBudget != null && allocatedBudget > 0)
          ? (s / allocatedBudget) * 100
          : null;
      }

      // Donor data status (mirrors donor-portfolio logic)
      const hasCanonical = row.donor_id != null;
      const hasFreeText  = typeof row.free_text_donor === "string" && row.free_text_donor.trim() !== "";
      let donorDataStatus: string;
      if (hasCanonical) {
        const namesMatch = hasFreeText &&
          row.donor_name!.toLowerCase().trim() === row.free_text_donor!.toLowerCase().trim();
        donorDataStatus = hasFreeText && !namesMatch ? "name_mismatch" : "linked";
      } else if (hasFreeText) {
        donorDataStatus = "unlinked";
      } else {
        donorDataStatus = "missing";
      }

      const currency = (row.currency ?? "").trim() || null;
      const hasBudgetData          = allocatedBudget != null && allocatedBudget > 0;
      const hasMissingCurrency     = !currency;
      const hasRecordedExpenditure = spent != null && spent > 0;

      return {
        projectId:               row.id,
        projectCode:             row.code,
        projectTitle:            row.title,
        projectStatus:           row.status,
        donorId:                 row.donor_id,
        donorName:               row.donor_name ?? (hasFreeText ? row.free_text_donor : null),
        donorDataStatus,
        stateIds:                row.state_ids   ?? [],
        stateNames:              row.state_names ?? [],
        stateNamesAr:            row.state_names_ar ?? [],
        sectorNames:             row.sector ? [row.sector] : [],
        sector:                  row.sector,
        budgetBasis,
        currency,
        allocatedBudget,
        spent,
        remainingBalance,
        utilisationRate,
        missingStateExpenditure,
        // For State Allocation rows: projectLevelSpent exposes the project-wide
        // activities spend in the expanded detail panel (labelled distinctly so it
        // cannot be confused with state-level expenditure).
        projectLevelSpent:       missingStateExpenditure ? projectLevelSpent : null,
        hasBudgetData,
        hasMissingCurrency,
        hasRecordedExpenditure,
        stateAllocationAmount:   (isSpo && row.psa_allocated != null) ? row.psa_allocated : null,
        lastFinancialUpdate:     row.last_financial_update ?? null,
      };
    });

    res.json(entries);
  } catch (err) {
    next(err);
  }
});

router.get("/dashboard/beneficiaries", dashboardFilterGuard("beneficiaries"), async (req, res, next) => {
  try {
    const rawScope = await buildScope(req);
    const { effectiveScope, donorCond, dateConds, extraParams } = applyFilterParams(
      rawScope,
      req.query as Record<string, string | undefined>,
    );
    const { sql: baseScopeSql, params: baseScopeParams, nextIdx } = projectScopeWhere(effectiveScope, "p", 1);
    const { sql: donorSql, nextIdx: afterDonor } = reindex(donorCond, nextIdx);
    const { sql: dateSql } = reindex(dateConds, afterDonor);
    const scopeSql = baseScopeSql + (donorSql || dateSql ? ` ${donorSql} ${dateSql}` : "");
    const scopeParams = [...baseScopeParams, ...extraParams];
    const scope = effectiveScope;

    const [summary, byState, bySector, byProject] = await Promise.all([
      pool.query(`SELECT
        COALESCE(SUM(beneficiaries_male), 0)::int    AS male,
        COALESCE(SUM(beneficiaries_female), 0)::int  AS female,
        COALESCE(SUM(beneficiaries_boys), 0)::int    AS boys,
        COALESCE(SUM(beneficiaries_girls), 0)::int   AS girls,
        COALESCE(SUM(beneficiaries_male + beneficiaries_female + beneficiaries_boys + beneficiaries_girls), 0)::int AS total
        FROM projects p WHERE 1=1${scopeSql}`, scopeParams),

      scope.stateId !== null
        ? pool.query(`
          SELECT
            s.id   AS "stateId",
            s.name AS "stateName",
            COALESCE(ROUND(SUM(p.beneficiaries_male::float))::int, 0) AS male,
            COALESCE(ROUND(SUM(p.beneficiaries_female::float))::int, 0) AS female,
            COALESCE(ROUND(SUM(p.beneficiaries_boys::float))::int, 0) AS boys,
            COALESCE(ROUND(SUM(p.beneficiaries_girls::float))::int, 0) AS girls,
            COALESCE(ROUND(SUM((p.beneficiaries_male + p.beneficiaries_female + p.beneficiaries_boys + p.beneficiaries_girls)::float))::int, 0) AS total
          FROM states s
          JOIN project_states pst ON pst.state_id = s.id
          JOIN projects p ON p.id = pst.project_id
           WHERE s.id = $${scopeParams.length + 1}${scopeSql}
           GROUP BY s.id, s.name ORDER BY total DESC`,
          [...scopeParams, scope.stateId])
        : pool.query(`
          WITH project_share AS (
            SELECT p.id,
              p.beneficiaries_male, p.beneficiaries_female, p.beneficiaries_boys, p.beneficiaries_girls,
              -- Only resolved State registry links participate in a State
              -- distribution. Historical orphan links have no displayable State
              -- and must not dilute every resolved State's calculated share.
              GREATEST((
                SELECT COUNT(*)
                FROM project_states ps
                JOIN states resolved_state ON resolved_state.id = ps.state_id
                WHERE ps.project_id = p.id
              ), 1) AS state_count
            FROM projects p WHERE 1=1${scopeSql}
          )
          SELECT s.id AS "stateId", s.name AS "stateName",
            COALESCE(ROUND(SUM(ps_share.beneficiaries_male::float / ps_share.state_count))::int, 0) AS male,
            COALESCE(ROUND(SUM(ps_share.beneficiaries_female::float / ps_share.state_count))::int, 0) AS female,
            COALESCE(ROUND(SUM(ps_share.beneficiaries_boys::float / ps_share.state_count))::int, 0) AS boys,
            COALESCE(ROUND(SUM(ps_share.beneficiaries_girls::float / ps_share.state_count))::int, 0) AS girls,
            COALESCE(ROUND(SUM((ps_share.beneficiaries_male + ps_share.beneficiaries_female + ps_share.beneficiaries_boys + ps_share.beneficiaries_girls)::float / ps_share.state_count))::int, 0) AS total
          FROM states s
          LEFT JOIN project_states pst ON pst.state_id = s.id
          LEFT JOIN project_share ps_share ON ps_share.id = pst.project_id
          GROUP BY s.id, s.name ORDER BY total DESC, s.name ASC`, scopeParams),

      pool.query(`SELECT
          p.sector AS sector,
          COALESCE(SUM(p.beneficiaries_male), 0)::int   AS male,
          COALESCE(SUM(p.beneficiaries_female), 0)::int AS female,
          COALESCE(SUM(p.beneficiaries_boys), 0)::int   AS boys,
          COALESCE(SUM(p.beneficiaries_girls), 0)::int  AS girls,
          COALESCE(SUM(p.beneficiaries_male + p.beneficiaries_female + p.beneficiaries_boys + p.beneficiaries_girls), 0)::int AS total
        FROM projects p WHERE 1=1${scopeSql}
        GROUP BY p.sector ORDER BY total DESC, p.sector ASC`, scopeParams),

      pool.query(`SELECT
          p.id AS "projectId", p.code AS "projectCode",
          p.title AS "projectTitle", p.sector AS sector,
          COALESCE(ARRAY(
            SELECT s.name FROM project_states ps
            JOIN states s ON s.id = ps.state_id
            WHERE ps.project_id = p.id ORDER BY ps.state_id
          ), ARRAY[]::text[]) AS "stateNames",
          COALESCE(ARRAY(
            SELECT s.name_ar FROM project_states ps
            JOIN states s ON s.id = ps.state_id
            WHERE ps.project_id = p.id ORDER BY ps.state_id
          ), ARRAY[]::text[]) AS "stateNamesAr",
          p.beneficiaries_male::int   AS male,
          p.beneficiaries_female::int AS female,
          p.beneficiaries_boys::int   AS boys,
          p.beneficiaries_girls::int  AS girls,
          (p.beneficiaries_male + p.beneficiaries_female + p.beneficiaries_boys + p.beneficiaries_girls)::int AS total
        FROM projects p WHERE 1=1${scopeSql}
        ORDER BY total DESC, p.title ASC`, scopeParams),
    ]);
    res.json({
      summary: summary.rows[0],
      byState: byState.rows,
      bySector: bySector.rows,
      byProject: byProject.rows,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/dashboard/agenda", dashboardFilterGuard("agenda"), async (req, res, next) => {
  try {
    const scope = await buildScope(req);
    const agendaReportScope = reportScopeWhere(userScope(req), "r", "rp", "ra", 1);
    const { sql: projScopeSql, params: projScopeParams } = projectScopeWhere(scope, "p", 2);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const horizon = new Date(today);
    horizon.setDate(horizon.getDate() + 60);
    const horizonStr = horizon.toISOString().slice(0, 10);

    const [projects, plans, planActivities, reports] = await Promise.all([
      pool.query(`
        SELECT id, title, status, end_date AS date, sector
        FROM projects p
        WHERE status NOT IN ('draft','rejected','closed')
          AND end_date IS NOT NULL AND end_date <= $1${projScopeSql}
        ORDER BY end_date ASC LIMIT 30
      `, [horizonStr, ...projScopeParams]),

      pool.query(`
        SELECT id, title, status, end_date AS date, sector
        FROM plans p
        WHERE status NOT IN ('draft','rejected','cancelled','archived','completed')
          AND end_date IS NOT NULL AND end_date <= $1
          AND ${activeProjectParentSQL("p.project_id")}
          ${scope.denyAll ? " AND FALSE" : ""}
          ${scope.projectIds !== undefined ? " AND p.project_id = ANY($2::int[]) AND p.state_id = $3" : ""}
          ${scope.projectIds === undefined && scope.stateId !== null ? " AND p.state_id = $2" : ""}
          ${scope.projectIds === undefined && scope.sectors !== null && scope.sectors.length > 0 ? " AND p.sector = ANY($2::text[])" : ""}
          ${scope.sectors !== null && scope.sectors.length === 0 ? " AND FALSE" : ""}
        ORDER BY end_date ASC LIMIT 30
      `, scope.projectIds !== undefined
        ? [horizonStr, scope.projectIds, scope.stateId]
        : scope.stateId !== null ? [horizonStr, scope.stateId]
        : scope.sectors && scope.sectors.length > 0 ? [horizonStr, scope.sectors] : [horizonStr]),

      pool.query(`
        SELECT pa.id, pa.title, pa.status, pa.end_date AS date, pl.id AS plan_id
        FROM plan_activities pa
        JOIN plans pl ON pl.id = pa.plan_id
        WHERE pa.status NOT IN ('completed','cancelled')
          AND pa.end_date IS NOT NULL AND pa.end_date <= $1
          AND ${activeProjectParentSQL("pl.project_id")}
          ${scope.denyAll ? " AND FALSE" : ""}
          ${scope.projectIds !== undefined ? " AND pl.project_id = ANY($2::int[]) AND pl.state_id = $3" : ""}
          ${scope.projectIds === undefined && scope.stateId !== null ? " AND pl.state_id = $2" : ""}
          ${scope.projectIds === undefined && scope.sectors !== null && scope.sectors.length > 0 ? " AND pl.sector = ANY($2::text[])" : ""}
          ${scope.sectors !== null && scope.sectors.length === 0 ? " AND FALSE" : ""}
        ORDER BY pa.end_date ASC LIMIT 20
      `, scope.projectIds !== undefined
        ? [horizonStr, scope.projectIds, scope.stateId]
        : scope.stateId !== null ? [horizonStr, scope.stateId]
        : scope.sectors && scope.sectors.length > 0 ? [horizonStr, scope.sectors] : [horizonStr]),

      pool.query(`
        SELECT r.id, r.title, r.report_type AS "reportType", r.status,
               r.submitted_at::date AS date,
               CASE
                 WHEN r.report_type = 'project' THEN rp.sector
                 WHEN r.report_type = 'activity' AND r.project_id IS NOT NULL THEN rp.sector
                 WHEN r.report_type = 'activity' THEN ra.sector
                 ELSE COALESCE(NULLIF(r.sector,''), rp.sector)
               END AS sector
        FROM reports r
        LEFT JOIN projects rp ON rp.id = r.project_id
        LEFT JOIN activities ra ON ra.id = r.activity_id
        WHERE r.status NOT IN ('draft','approved','rejected','archived')
          AND ${activeProjectParentSQL("r.project_id")}
          AND ${operationalPopulationSQL()}
          ${agendaReportScope.sql}
        ORDER BY r.submitted_at DESC LIMIT 20
      `, agendaReportScope.params),
    ]);

    const todayStr = today.toISOString().slice(0, 10);
    function toDateStr(val: unknown): string {
      if (!val) return todayStr;
      if (val instanceof Date) return val.toISOString().slice(0, 10);
      return String(val).slice(0, 10);
    }
    function dueLabel(dateStr: string): string {
      if (dateStr < todayStr) return "overdue";
      if (dateStr === todayStr) return "today";
      return "upcoming";
    }

    const items = [
      ...projects.rows.map((r) => {
        const d = toDateStr(r.date);
        return { id: `project-${r.id}`, type: "project", title: r.title, date: d, status: r.status, link: `/projects/${r.id}`, sector: r.sector ?? null, dueLabel: dueLabel(d) };
      }),
      ...plans.rows.map((r) => {
        const d = toDateStr(r.date);
        return { id: `plan-${r.id}`, type: "plan", title: r.title, date: d, status: r.status, link: `/plans/${r.id}`, sector: r.sector ?? null, dueLabel: dueLabel(d) };
      }),
      ...planActivities.rows.map((r) => {
        const d = toDateStr(r.date);
        return { id: `plan-activity-${r.id}`, type: "plan_activity", title: r.title, date: d, status: r.status, link: `/plans/${r.plan_id}?activity=${r.id}`, sector: null, dueLabel: dueLabel(d) };
      }),
      ...reports.rows.map((r) => {
        const d = toDateStr(r.date);
        const reportPath = r.reportType === "hq_sector"
          ? "/reports/hq-sector"
          : r.reportType === "program_state"
            ? "/reports/program-state"
            : r.reportType === "activity"
              ? "/reports/activity"
              : "/reports/project";
        return { id: `report-${r.id}`, type: "report", title: r.title, date: d, status: r.status, link: `${reportPath}?open=${r.id}`, sector: r.sector ?? null, dueLabel: dueLabel(d) };
      }),
    ].sort((a, b) => a.date.localeCompare(b.date));

    res.json({ items });
  } catch (err) {
    next(err);
  }
});

router.get(
  "/dashboard/reports-summary",
  requirePerm("reports.view"),
  async (req, res, next) => {
    try {
      // ── Authorised scope (same logic as GET /reports) ─────────────────────
      const isStateRole =
        req.currentUser?.role === "state_program_officer" ||
        req.currentUser?.role === "state_office_manager";
      // Reports follow the canonical Reports module scope: state roles are
      // clamped to their State, including standalone State Programme Reports.
      // Project assignment scope remains a Project-Dashboard concern and must
      // not erase authorised project_id=NULL Report records here.
      const scope = userScope(req);
      const effectiveStateId = scope.stateId;
      const denyAll = Boolean(scope.denyAll);
      const tcSectors = tcSectorRestriction(req);
      const isHqRole = !isStateRole && tcSectors === null;

      // Keep state and sector clauses in one parameterised scope.
      const params: unknown[] = [];
      let nextParam = 1;
      const reportScope: string[] = [];
      let stateParam: number | null = null;
      if (denyAll) {
        reportScope.push("AND FALSE");
      } else {
        if (effectiveStateId !== null) {
          stateParam = nextParam;
          reportScope.push(`AND r.state_id = $${nextParam}`);
          params.push(effectiveStateId);
          nextParam++;
        }
      }
      const stateFilter = reportScope.join("\n");
      const sectorParam = nextParam;
      const sectorFilter =
        tcSectors !== null && tcSectors.length > 0
          ? `AND (
              (r.report_type = 'project' AND p2.sector = ANY($${sectorParam}::text[]))
              OR (r.report_type = 'activity' AND r.project_id IS NOT NULL AND p2.sector = ANY($${sectorParam}::text[]))
              OR (r.report_type = 'activity' AND r.project_id IS NULL AND act.sector = ANY($${sectorParam}::text[]))
              OR (
                r.report_type NOT IN ('project', 'activity')
                AND (r.sector = ANY($${sectorParam}::text[]) OR p2.sector = ANY($${sectorParam}::text[]))
              )
            )`
          : tcSectors !== null && tcSectors.length === 0
            ? "AND FALSE"
            : "";
      if (tcSectors !== null && tcSectors.length > 0) params.push(tcSectors);
      const joinProject = sectorFilter
        ? `LEFT JOIN projects p2 ON p2.id = r.project_id
           LEFT JOIN activities act ON act.id = r.activity_id`
        : "";
      const byStateSectorFilter =
        tcSectors !== null && tcSectors.length > 0
          ? `AND (
              (
                r.report_type = 'project'
                AND (SELECT p.sector FROM projects p WHERE p.id = r.project_id) = ANY($${sectorParam}::text[])
              )
              OR (
                r.report_type = 'activity'
                AND r.project_id IS NOT NULL
                AND (SELECT p.sector FROM projects p WHERE p.id = r.project_id) = ANY($${sectorParam}::text[])
              )
              OR (
                r.report_type = 'activity'
                AND r.project_id IS NULL
                AND (SELECT a.sector FROM activities a WHERE a.id = r.activity_id) = ANY($${sectorParam}::text[])
              )
              OR (
                r.report_type NOT IN ('project', 'activity')
                AND (
                  r.sector = ANY($${sectorParam}::text[])
                  OR (SELECT p.sector FROM projects p WHERE p.id = r.project_id) = ANY($${sectorParam}::text[])
                )
              )
            )`
          : tcSectors !== null && tcSectors.length === 0
            ? "AND FALSE"
            : "";
      const stateRowFilter = denyAll ? "WHERE FALSE" : stateParam !== null ? `WHERE s.id = $${stateParam}` : "";

      const canonicalFilter = `AND r.report_type = ANY(${CANONICAL_TYPES_SQL})`;
      const activeReportParentFilter = `AND ${activeProjectParentSQL("r.project_id")}`;
      // Operational-population filter: excludes migration duplicates and unverified records.
      // Applied to all KPI aggregations so historical migration metadata never distorts
      // operational counts. Uses the shared operationalPopulationSQL() helper from
      // reportConstants — the same predicate used in GET /reports/stats.
      const operationalFilter = `AND ${operationalPopulationSQL()}`;

      // Total, Draft, Awaiting Approval, Approved, >14-day counts
      // Excludes archived; includes rejected in Total.
      const [counts, legacyCount, byState, bySector, byType, dataQualityRows] = await Promise.all([
        pool.query(`
          SELECT
            COUNT(*) FILTER (
              WHERE r.status = ANY(${TOTAL_STATUSES_SQL})
            )::int AS total,
            COUNT(*) FILTER (WHERE r.status = 'draft')::int AS draft,
            COUNT(*) FILTER (
              WHERE r.status = 'draft'
                AND (
                  SELECT a.action
                  FROM approvals a
                  WHERE a.entity_type = 'report' AND a.entity_id = r.id
                  ORDER BY a.timestamp DESC, a.id DESC
                  LIMIT 1
                ) = 'request_revision'
            )::int AS returned,
            COUNT(*) FILTER (
              WHERE r.status = ANY(${AWAITING_APPROVAL_STATUSES_SQL})
            )::int AS awaiting_approval,
            COUNT(*) FILTER (WHERE r.status = 'approved')::int AS approved,
            COUNT(*) FILTER (
              WHERE r.status = ANY(${AWAITING_APPROVAL_STATUSES_SQL})
                AND r.submitted_at < NOW() - INTERVAL '14 days'
            )::int AS awaiting_over14
          FROM reports r ${joinProject}
          WHERE 1=1
            ${stateFilter}
            ${sectorFilter}
            ${canonicalFilter}
            ${activeReportParentFilter}
            ${operationalFilter}
        `, params),
        // Unresolved legacy count (NULL report_type) — surfaced to HQ users only.
        // Always org-wide (not state/sector scoped) — HQ data quality issue.
        isHqRole ? pool.query(
          `SELECT COUNT(*)::int AS cnt FROM reports r
           WHERE r.report_type IS NULL AND ${activeProjectParentSQL("r.project_id")}`,
        ) : Promise.resolve({ rows: [{ cnt: 0 }] }),
        // By state — scoped; operational filter in ON clause to preserve LEFT JOIN semantics
        pool.query(`
          SELECT s.id AS "stateId", s.name AS "stateName", COUNT(r.id)::int AS count
          FROM states s
          LEFT JOIN reports r
            ON r.state_id = s.id
               AND r.report_type = ANY(${CANONICAL_TYPES_SQL})
               AND r.status = ANY(${TOTAL_STATUSES_SQL})
               AND r.migration_is_duplicate = FALSE
               AND r.migration_status_unverified = FALSE
                AND ${activeProjectParentSQL("r.project_id")}
                ${stateFilter}
                ${byStateSectorFilter}
          ${stateRowFilter}
          GROUP BY s.id, s.name
          ORDER BY count DESC, s.name ASC
        `, params),
        // By sector — canonical types, non-archived, operational population
        pool.query(
          `SELECT COALESCE(
                    CASE
                      WHEN r.report_type = 'project' THEN p.sector
                      WHEN r.report_type = 'activity' AND r.project_id IS NOT NULL THEN p.sector
                      WHEN r.report_type = 'activity' THEN act.sector
                      ELSE COALESCE(NULLIF(r.sector,''), p.sector)
                    END,
                    'Unspecified'
                  ) AS sector,
                  COUNT(*)::int AS count
           FROM reports r
           LEFT JOIN projects p ON p.id = r.project_id
           LEFT JOIN activities act ON act.id = r.activity_id
           WHERE 1=1
             ${stateFilter}
             ${sectorFilter.replace("p2.", "p.")}
             ${canonicalFilter}
              ${activeReportParentFilter}
             ${operationalFilter}
             AND r.status = ANY(${TOTAL_STATUSES_SQL})
           GROUP BY 1 ORDER BY count DESC`,
          params,
        ),
        // By canonical type — totals only, operational population
        pool.query(
          `SELECT report_type AS "reportType", COUNT(*)::int AS count
           FROM reports r ${joinProject}
           WHERE 1=1
             ${stateFilter}
             ${sectorFilter}
             ${canonicalFilter}
              ${activeReportParentFilter}
             ${operationalFilter}
             AND r.status = ANY(${TOTAL_STATUSES_SQL})
           GROUP BY report_type ORDER BY count DESC`,
          params,
        ),
        // Data quality counts — canonical rows only, org-wide (not state/sector scoped).
        // Returned to HQ roles only; used to render the admin data-quality notice.
        isHqRole ? pool.query<{ migration_duplicates: number; status_unverified: number }>(
          `SELECT
             COUNT(*) FILTER (WHERE migration_is_duplicate = TRUE)::int  AS migration_duplicates,
             COUNT(*) FILTER (WHERE migration_status_unverified = TRUE)::int AS status_unverified
            FROM reports r
            WHERE r.report_type = ANY(${CANONICAL_TYPES_SQL})
              AND ${activeProjectParentSQL("r.project_id")}`,
        ) : Promise.resolve({ rows: [{ migration_duplicates: 0, status_unverified: 0 }] }),
      ]);

      const c = counts.rows[0];
      const dq = dataQualityRows.rows[0];
      // HQ roles see the unresolved legacy count; state/TC roles see 0 (not their concern)
      res.json({
        total: Number(c.total),
        draft: Number(c.draft),
        returned: Number(c.returned),
        awaitingApproval: Number(c.awaiting_approval),
        approved: Number(c.approved),
        awaitingApprovalOver14Days: Number(c.awaiting_over14),
        unresolvedLegacyCount: isHqRole ? Number(legacyCount.rows[0]?.cnt ?? 0) : 0,
        // dataQualityNotice: compact factual counts for HQ admin awareness.
        // null for state/TC roles — migration metadata is an HQ concern.
        dataQualityNotice: isHqRole ? {
          migrationDuplicateCount: Number(dq?.migration_duplicates ?? 0),
          unverifiedCount: Number(dq?.status_unverified ?? 0),
        } : null,
        byState: byState.rows,
        bySector: bySector.rows,
        byType: byType.rows,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ── HQ Sector Snapshot (for HQ Sector Report form) ───────────────────────────
router.get("/dashboard/sector-snapshot", requirePerm("reports.view"), dashboardFilterGuard("sectorSnapshot"), async (req, res, next) => {
  try {
    const sector = req.query.sector as string | undefined;
    if (!sector) { res.status(400).json({ error: "sector is required" }); return; }
    if (!VALID_SECTOR_SET.has(sector)) { res.status(400).json({ error: "invalid_sector" }); return; }

    // HQ Sector Report snapshot access follows the canonical report author/view
    // rules: state-scoped roles cannot access HQ records, and TCs are limited
    // to their exact assigned sectors.
    const access = assertCanViewHqSectorSnapshot(req, sector);
    if (!access.ok) {
      res.status(access.status).json(access.body);
      return;
    }

    const [snap, stateSummaries, projectSummaries, benBreakdown, benByState, benByProject, benByDonor, indicators] = await Promise.all([
      // Snapshot cards
      pool.query(`
        SELECT
          COALESCE((SELECT COUNT(DISTINCT p.id)::int FROM projects p WHERE p.deleted_at IS NULL AND p.sector = $1 AND p.status IN ('approved','active')), 0) AS "activeProjects",
          COALESCE((SELECT COUNT(DISTINCT ps.state_id)::int FROM project_states ps JOIN projects p ON p.id = ps.project_id WHERE p.deleted_at IS NULL AND p.sector = $1 AND p.status IN ('approved','active')), 0) AS "activeStates",
          COALESCE((SELECT COUNT(DISTINCT l.id)::int FROM project_localities pl JOIN localities l ON l.id = pl.locality_id JOIN project_states ps ON ps.project_id = pl.project_id JOIN projects p ON p.id = pl.project_id WHERE p.deleted_at IS NULL AND p.sector = $1 AND p.status IN ('approved','active')), 0) AS "activeLocalities",
          COALESCE((SELECT COUNT(*)::int FROM activities a JOIN projects p ON p.id = a.project_id WHERE p.deleted_at IS NULL AND p.sector = $1), 0) AS "activitiesImplemented",
          COALESCE((SELECT SUM(p.beneficiaries_male + p.beneficiaries_female + p.beneficiaries_boys + p.beneficiaries_girls)::int FROM projects p WHERE p.deleted_at IS NULL AND p.sector = $1), 0) AS "beneficiariesReached",
          COALESCE((SELECT CASE WHEN SUM(i.target) > 0 THEN (SUM(i.achieved) / SUM(i.target) * 100)::int ELSE 0 END FROM indicators i JOIN projects p ON p.id = i.project_id WHERE p.deleted_at IS NULL AND i.sector = $1), 0) AS "indicatorProgressPct",
          COALESCE((SELECT COUNT(*)::int FROM activities a JOIN projects p ON p.id = a.project_id WHERE p.deleted_at IS NULL AND p.sector = $1 AND a.status = 'delayed'), 0) AS "delayedActivities",
          COALESCE((SELECT COUNT(*)::int FROM risks r WHERE r.project_id IN (SELECT id FROM projects WHERE deleted_at IS NULL AND sector = $1) AND r.status ${ACTIVE_RISK_STATUS_SQL}), 0) AS "openRisks",
          COALESCE((SELECT COUNT(*)::int FROM reports r2
            LEFT JOIN projects p2 ON p2.id = r2.project_id
            LEFT JOIN activities act2 ON act2.id = r2.activity_id
            WHERE ${technicalCoordinatorReportSectorSQL("r2", "p2", "act2", 1, "single")}
              AND ${activeProjectParentSQL("r2.project_id")}
              AND r2.report_type = ANY(${CANONICAL_TYPES_SQL})
              AND r2.status = ANY(${AWAITING_APPROVAL_STATUSES_SQL})
              AND ${operationalPopulationSQL("r2")}), 0) AS "pendingApprovals"
      `, [sector]),

      // Per-state summary
      pool.query(`
        SELECT
          s.id AS "stateId", s.name AS "stateName", s.name_ar AS "stateNameAr",
          COUNT(DISTINCT p.id)::int AS projects,
          COUNT(DISTINCT a.id)::int AS activities,
          COALESCE((SELECT COUNT(*)::int FROM beneficiaries b WHERE b.state_id = s.id AND b.project_id IN (SELECT id FROM projects WHERE deleted_at IS NULL AND sector = $1)), 0) AS beneficiaries,
          COALESCE(AVG(a.progress_pct)::int, 0) AS "progressPct",
          COALESCE((SELECT COUNT(*)::int FROM risks r WHERE r.state_id = s.id AND r.project_id IN (SELECT id FROM projects WHERE deleted_at IS NULL AND sector = $1) AND r.status ${ACTIVE_RISK_STATUS_SQL}), 0) AS "openRisks"
        FROM states s
        JOIN project_states ps ON ps.state_id = s.id
        JOIN projects p ON p.id = ps.project_id AND p.deleted_at IS NULL AND p.sector = $1 AND p.status IN ('approved','active','coordination_approved','technically_approved')
        LEFT JOIN activities a ON a.project_id = p.id
        GROUP BY s.id, s.name ORDER BY projects DESC, s.name ASC
      `, [sector]),

      // Per-project summary
      pool.query(`
        SELECT
          p.id, p.code, p.title, p.donor,
          COALESCE((SELECT AVG(a.progress_pct)::int FROM activities a WHERE a.project_id = p.id), 0) AS "progressPct",
          COALESCE((SELECT COUNT(*)::int FROM beneficiaries b WHERE b.project_id = p.id), 0) AS beneficiaries,
          COALESCE((SELECT CASE WHEN p.budget_total > 0 THEN (SUM(a.budget_spent) / p.budget_total * 100)::int ELSE 0 END FROM activities a WHERE a.project_id = p.id), 0) AS "budgetUtilizationPct",
          CASE
            WHEN (SELECT COUNT(*) FROM risks r WHERE r.project_id = p.id AND r.severity IN ('high','critical') AND r.status ${ACTIVE_RISK_STATUS_SQL}) >= 2 THEN 'high'
            WHEN (SELECT COUNT(*) FROM risks r WHERE r.project_id = p.id AND r.severity IN ('high','critical') AND r.status ${ACTIVE_RISK_STATUS_SQL}) >= 1 THEN 'medium'
            ELSE 'low'
          END AS "riskLevel"
        FROM projects p
        WHERE p.deleted_at IS NULL AND p.sector = $1 AND p.status IN ('approved','active','coordination_approved','technically_approved','submitted')
        ORDER BY p.created_at DESC LIMIT 20
      `, [sector]),

      // Beneficiary breakdown — sector totals
      pool.query(`
        SELECT
          COALESCE(SUM(p.beneficiaries_male), 0)::int AS men,
          COALESCE(SUM(p.beneficiaries_female), 0)::int AS women,
          COALESCE(SUM(p.beneficiaries_boys), 0)::int AS boys,
          COALESCE(SUM(p.beneficiaries_girls), 0)::int AS girls
        FROM projects p WHERE p.deleted_at IS NULL AND p.sector = $1
      `, [sector]),

      // Beneficiary breakdown — by state
      pool.query(`
        SELECT
          s.id AS "stateId", s.name AS "stateName", s.name_ar AS "stateNameAr",
          COALESCE(SUM(p.beneficiaries_male), 0)::int AS men,
          COALESCE(SUM(p.beneficiaries_female), 0)::int AS women,
          COALESCE(SUM(p.beneficiaries_boys), 0)::int AS boys,
          COALESCE(SUM(p.beneficiaries_girls), 0)::int AS girls,
          (COALESCE(SUM(p.beneficiaries_male), 0) + COALESCE(SUM(p.beneficiaries_female), 0) +
           COALESCE(SUM(p.beneficiaries_boys), 0) + COALESCE(SUM(p.beneficiaries_girls), 0))::int AS total
        FROM projects p
        JOIN project_states ps ON ps.project_id = p.id
        JOIN states s ON s.id = ps.state_id
        WHERE p.deleted_at IS NULL AND p.sector = $1
        GROUP BY s.id, s.name
        ORDER BY total DESC
      `, [sector]),

      // Beneficiary breakdown — by project
      pool.query(`
        SELECT
          p.code, p.title,
          COALESCE(p.beneficiaries_male, 0)::int AS men,
          COALESCE(p.beneficiaries_female, 0)::int AS women,
          COALESCE(p.beneficiaries_boys, 0)::int AS boys,
          COALESCE(p.beneficiaries_girls, 0)::int AS girls,
          (COALESCE(p.beneficiaries_male, 0) + COALESCE(p.beneficiaries_female, 0) +
           COALESCE(p.beneficiaries_boys, 0) + COALESCE(p.beneficiaries_girls, 0))::int AS total
        FROM projects p
        WHERE p.deleted_at IS NULL AND p.sector = $1
        ORDER BY total DESC
      `, [sector]),

      // Beneficiary breakdown — by donor
      pool.query(`
        SELECT
          COALESCE(NULLIF(TRIM(p.donor), ''), 'Unknown') AS donor,
          COALESCE(SUM(p.beneficiaries_male), 0)::int AS men,
          COALESCE(SUM(p.beneficiaries_female), 0)::int AS women,
          COALESCE(SUM(p.beneficiaries_boys), 0)::int AS boys,
          COALESCE(SUM(p.beneficiaries_girls), 0)::int AS girls,
          (COALESCE(SUM(p.beneficiaries_male), 0) + COALESCE(SUM(p.beneficiaries_female), 0) +
           COALESCE(SUM(p.beneficiaries_boys), 0) + COALESCE(SUM(p.beneficiaries_girls), 0))::int AS total
        FROM projects p
        WHERE p.deleted_at IS NULL AND p.sector = $1
        GROUP BY COALESCE(NULLIF(TRIM(p.donor), ''), 'Unknown')
        ORDER BY total DESC
      `, [sector]),

      // Indicator analysis
      pool.query(`
        SELECT
          i.title AS name, i.target::float AS target, i.achieved::float AS achieved,
          CASE WHEN i.target > 0 THEN (i.achieved / i.target * 100)::int ELSE 0 END AS "progressPct",
          CASE
            WHEN i.target > 0 AND (i.achieved / i.target) >= 1 THEN 'Achieved'
            WHEN i.target > 0 AND (i.achieved / i.target) >= 0.75 THEN 'On Track'
            WHEN i.target > 0 AND (i.achieved / i.target) >= 0.5 THEN 'At Risk'
            ELSE 'Off Track'
          END AS status
        FROM indicators i
        JOIN projects p ON p.id = i.project_id AND p.deleted_at IS NULL
        WHERE i.sector = $1
        ORDER BY "progressPct" DESC LIMIT 20
      `, [sector]),
    ]);

    res.json({
      snapshot: snap.rows[0] ?? {},
      stateSummaries: stateSummaries.rows,
      projectSummaries: projectSummaries.rows,
      beneficiaryBreakdown: benBreakdown.rows[0] ?? { men: 0, women: 0, boys: 0, girls: 0 },
      beneficiaryByState: benByState.rows,
      beneficiaryByProject: benByProject.rows,
      beneficiaryByDonor: benByDonor.rows,
      indicators: indicators.rows,
    });
  } catch (err) {
    next(err);
  }
});

// ── Performance Engine Routes ───────────────────────────────────────────────

router.get("/dashboard/performance", dashboardFilterGuard("performance"), async (req, res, next) => {
  try {
    const scope = await buildScope(req);
    const scopeError = dashboardScopeError(scope, {});
    if (scopeError) {
      res.status(403).json({ error: scopeError });
      return;
    }
    const score = await computeOrgScore(pool, scope);
    res.json(score);
  } catch (err) {
    next(err);
  }
});

router.get("/dashboard/performance/states", dashboardFilterGuard("performanceStates"), async (req, res, next) => {
  try {
    const scope = await buildScope(req);
    const scopeError = dashboardScopeError(scope, {});
    if (scopeError) {
      res.status(403).json({ error: scopeError });
      return;
    }
    const rows = await computeStateScores(pool, scope);
    // Sort by performanceScore descending (nulls last)
    rows.sort((a, b) => {
      if (a.performanceScore === null && b.performanceScore === null) return 0;
      if (a.performanceScore === null) return 1;
      if (b.performanceScore === null) return -1;
      return b.performanceScore - a.performanceScore;
    });
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get("/dashboard/performance/projects", dashboardFilterGuard("performanceProjects"), async (req, res, next) => {
  try {
    const scope = await buildScope(req);
    const scopeError = dashboardScopeError(scope, {});
    if (scopeError) {
      res.status(403).json({ error: scopeError });
      return;
    }
    const { limit: qLimit } = req.query as Record<string, string | undefined>;
    const limit = Math.min(100, Math.max(10, Number(qLimit ?? 50)));
    const rows = await computeProjectScores(pool, scope, limit);
    // Sort by overallScore descending (nulls last)
    rows.sort((a, b) => {
      if (a.overallScore === null && b.overallScore === null) return 0;
      if (a.overallScore === null) return 1;
      if (b.overallScore === null) return -1;
      return b.overallScore - a.overallScore;
    });
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get("/dashboard/attention-projects", dashboardFilterGuard("attentionProjects"), async (req, res, next) => {
  try {
    const scope = await buildScope(req);
    const { sql: scopeSql, params: scopeParams } = projectScopeWhere(scope, "p", 1);

    // Run all follow-up condition queries in parallel.
    // Each query returns only projects that meet that specific factual condition.
    const [
      draftProjRows,
      draftRptRows,
      returnedRptRows,
      awaitingApprovalRows,
      critRiskRows,
      overdueMitRows,
    ] = await Promise.all([
      // 1. Draft projects
      pool.query<{ id: number; code: string; title: string; sector: string }>(
        `SELECT p.id, p.code, p.title, p.sector
         FROM projects p
         WHERE p.status = 'draft'${scopeSql}
         ORDER BY p.id`,
        scopeParams,
      ),
      // 2. Projects with draft project reports — count distinct draft report IDs
      pool.query<{ id: number; code: string; title: string; sector: string; draftRptCount: string }>(
        `SELECT p.id, p.code, p.title, p.sector,
                COUNT(DISTINCT r.id)::text AS "draftRptCount"
         FROM projects p
         JOIN reports r ON r.project_id = p.id
         WHERE r.status = 'draft'
           AND r.report_type = ANY(${CANONICAL_TYPES_SQL})
           AND ${operationalPopulationSQL()}
           ${scopeSql}
         GROUP BY p.id, p.code, p.title, p.sector
         ORDER BY p.id`,
        scopeParams,
      ),
      // 3. Projects with currently returned reports — count distinct returned report IDs
      pool.query<{ id: number; code: string; title: string; sector: string; returnedCount: string }>(
        `SELECT p.id, p.code, p.title, p.sector,
                COUNT(DISTINCT r.id)::text AS "returnedCount"
         FROM projects p
         JOIN reports r ON r.project_id = p.id
         WHERE r.status = 'draft'
           AND r.report_type = ANY(${CANONICAL_TYPES_SQL})
           AND ${operationalPopulationSQL()}
           AND (
             SELECT a.action
             FROM approvals a
             WHERE a.entity_type = 'report' AND a.entity_id = r.id
             ORDER BY a.timestamp DESC, a.id DESC
             LIMIT 1
           ) = 'request_revision'
           ${scopeSql}
         GROUP BY p.id, p.code, p.title, p.sector
         ORDER BY p.id`,
        scopeParams,
      ),
      // 4. Projects with reports awaiting approval >14 days — count distinct report IDs
      pool.query<{ id: number; code: string; title: string; sector: string; awaitingCount: string }>(
        `SELECT p.id, p.code, p.title, p.sector,
                COUNT(DISTINCT r.id)::text AS "awaitingCount"
         FROM projects p
         JOIN reports r ON r.project_id = p.id
         WHERE r.status = ANY(${AWAITING_APPROVAL_STATUSES_SQL})
           AND r.report_type = ANY(${CANONICAL_TYPES_SQL})
           AND ${operationalPopulationSQL()}
           AND r.submitted_at IS NOT NULL
           AND r.submitted_at < NOW() - INTERVAL '14 days'${scopeSql}
         GROUP BY p.id, p.code, p.title, p.sector
         ORDER BY p.id`,
        scopeParams,
      ),
      // 5. Projects with at least one active critical risk
      pool.query<{ id: number; code: string; title: string; sector: string; critCount: string }>(
        `SELECT p.id, p.code, p.title, p.sector,
                COUNT(rk.id)::text AS "critCount"
         FROM projects p
         JOIN risks rk ON rk.project_id = p.id
         WHERE ${riskScoreSQL("rk.")} >= 9
           AND rk.status ${ACTIVE_RISK_STATUS_SQL}${scopeSql}
         GROUP BY p.id, p.code, p.title, p.sector
         HAVING COUNT(rk.id) > 0
         ORDER BY p.id`,
        scopeParams,
      ),
      // 6. Projects with overdue risk mitigation actions — count distinct overdue risk IDs
      pool.query<{ id: number; code: string; title: string; sector: string; overdueMitCount: string }>(
        `SELECT p.id, p.code, p.title, p.sector,
                COUNT(DISTINCT rk.id)::text AS "overdueMitCount"
         FROM projects p
         JOIN risks rk ON rk.project_id = p.id
         WHERE rk.status ${ACTIVE_RISK_STATUS_SQL}
           AND rk.due_date IS NOT NULL
           AND rk.due_date < CURRENT_DATE${scopeSql}
         GROUP BY p.id, p.code, p.title, p.sector
         ORDER BY p.id`,
        scopeParams,
      ),
    ]);

    // Structured follow-up reason — code is stable for logic; label is display-only.
    type FollowUpReasonCode =
      | "draft_project"
      | "draft_project_report"
      | "report_awaiting_approval"
      | "returned_report"
      | "active_critical_risk"
      | "overdue_risk_mitigation";

    type FollowUpReason = {
      code:  FollowUpReasonCode;
      /** Human-readable display text. May change with copy edits — never use for logic. */
      label: string;
      /** Factual count of matching source records (≥ 1). Boolean project conditions = 1. */
      count: number;
    };

    type FollowUpItem = {
      projectId:       number;
      projectCode:     string;
      projectTitle:    string;
      sector:          string;
      followUpReasons: FollowUpReason[];
    };

    /** Pluralise — pass explicit plural to handle compound phrases correctly. */
    const pl = (singular: string, plural: string, n: number) => n === 1 ? singular : plural;

    const map = new Map<number, FollowUpItem>();

    const ensure = (row: { id: number; code: string; title: string; sector: string }): FollowUpItem => {
      if (!map.has(row.id)) {
        map.set(row.id, {
          projectId:       row.id,
          projectCode:     row.code,
          projectTitle:    row.title,
          sector:          row.sector,
          followUpReasons: [],
        });
      }
      return map.get(row.id)!;
    };

    // draft_project: boolean project-level condition — count is always 1
    for (const row of draftProjRows.rows)
      ensure(row).followUpReasons.push({ code: "draft_project", label: "Draft Project", count: 1 });

    // draft_project_report: factual count of draft project reports connected to the project
    for (const row of draftRptRows.rows) {
      const n = Math.max(1, Number(row.draftRptCount));
      ensure(row).followUpReasons.push({ code: "draft_project_report", label: pl("Draft Project Report", "Draft Project Reports", n), count: n });
    }

    // returned_report: factual count of currently returned reports
    for (const row of returnedRptRows.rows) {
      const n = Math.max(1, Number(row.returnedCount));
      ensure(row).followUpReasons.push({ code: "returned_report", label: pl("Returned Report", "Returned Reports", n), count: n });
    }

    // report_awaiting_approval: factual count of reports awaiting approval >14 days
    for (const row of awaitingApprovalRows.rows) {
      const n = Math.max(1, Number(row.awaitingCount));
      ensure(row).followUpReasons.push({ code: "report_awaiting_approval", label: pl("Report Awaiting Approval", "Reports Awaiting Approval", n), count: n });
    }

    // active_critical_risk: factual count of active critical risks on the project
    for (const row of critRiskRows.rows) {
      const n = Math.max(1, Number(row.critCount));
      ensure(row).followUpReasons.push({ code: "active_critical_risk", label: pl("Active Critical Risk", "Active Critical Risks", n), count: n });
    }

    // overdue_risk_mitigation: factual count of overdue active risks (past due_date)
    for (const row of overdueMitRows.rows) {
      const n = Math.max(1, Number(row.overdueMitCount));
      ensure(row).followUpReasons.push({ code: "overdue_risk_mitigation", label: pl("Overdue Risk Mitigation", "Overdue Risk Mitigations", n), count: n });
    }

    // Return deduplicated projects — each counted once regardless of how many reasons apply.
    res.json(Array.from(map.values()));
  } catch (err) {
    next(err);
  }
});

router.get("/dashboard/hierarchical-performance", dashboardFilterGuard("hierarchicalPerformance"), async (req, res, next) => {
  try {
    const rawScope = await buildScope(req);
    const { effectiveScope, donorCond, dateConds, extraParams } = applyFilterParams(
      rawScope,
      req.query as Record<string, string | undefined>,
    );
    const { sql: baseScopeSql, params: baseScopeParams, nextIdx: nextBase } =
      projectScopeWhere(effectiveScope, "p", 1);
    const { sql: donorSql, nextIdx: nextAfterDonor } = reindex(donorCond, nextBase);
    const { sql: dateSql } = reindex(dateConds, nextAfterDonor);
    const extraSql = (donorSql + " " + dateSql).trim();
    const filterSql = baseScopeSql + (extraSql ? " " + extraSql : "");
    const filterParams: unknown[] = [...baseScopeParams, ...extraParams];
    const result = await computeHierarchicalPerformance(pool, filterSql, filterParams);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get("/dashboard/late-reports", dashboardFilterGuard("lateReports"), async (req, res, next) => {
  try {
    const reportScope = reportScopeWhere(userScope(req), "r", "p", "act", 1);

    const { rows } = await pool.query(`
      SELECT
        r.id,
        r.title,
        r.report_type AS "reportType",
        r.status,
        r.submitted_at AS "submittedAt",
        EXTRACT(day FROM NOW() - r.submitted_at)::int AS "daysWaiting",
        p.id AS "projectId",
        p.code AS "projectCode",
        p.title AS "projectTitle",
        s.name AS "stateName",
        s.name_ar AS "stateNameAr",
        u.name AS "submittedByName"
      FROM reports r
      LEFT JOIN projects p ON p.id = r.project_id
       LEFT JOIN activities act ON act.id = r.activity_id
      LEFT JOIN states s ON s.id = r.state_id
      LEFT JOIN users u ON u.id = r.submitted_by_id
      WHERE r.status = ANY(${AWAITING_APPROVAL_STATUSES_SQL})
        AND r.report_type = ANY(${CANONICAL_TYPES_SQL})
        AND r.submitted_at < NOW() - INTERVAL '14 days'
        AND ${activeProjectParentSQL("r.project_id")}
        AND ${operationalPopulationSQL()}${reportScope.sql}
      ORDER BY r.submitted_at ASC
      LIMIT 30
    `, reportScope.params);

    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ─── PMR Reporting Completeness — Phase 1 (PMR-015 Option C) ────────────────
// For a given kind + reporting period, returns which expected Operational
// Locations of each in-scope project have submitted their PMR and which are
// missing. Operational completeness metric only — no performance scoring,
// no beneficiary / activity / indicator / financial analytics.

// Shared with GET /reports/consolidated — single source of truth (no drift).
// See ../lib/pmrLocationHelper.ts for PMR_COMP_SUBMITTED_STATUSES,
// pmrCompStatusRank and the expected-location query.

router.get("/dashboard/pmr-reporting-completeness", requirePerm("reports.view"), dashboardFilterGuard("pmrReportingCompleteness"), async (req, res, next) => {
  try {
    const q = req.query as Record<string, string | undefined>;
    const kind = q.kind;
    if (!kind || !["monthly", "quarterly", "annual"].includes(kind)) {
      res.status(400).json({ error: "kind is required and must be monthly, quarterly or annual" });
      return;
    }
    const reportingYear = q.reportingYear ? Number(q.reportingYear) : NaN;
    if (!Number.isInteger(reportingYear) || reportingYear < 2000 || reportingYear > 2100) {
      res.status(400).json({ error: "reportingYear is required and must be a valid year" });
      return;
    }
    let reportingMonth: number | null = null;
    let quarter: number | null = null;
    if (kind === "monthly") {
      reportingMonth = q.reportingMonth ? Number(q.reportingMonth) : NaN;
      if (!Number.isInteger(reportingMonth) || reportingMonth < 1 || reportingMonth > 12) {
        res.status(400).json({ error: "reportingMonth (1-12) is required when kind=monthly" });
        return;
      }
    } else if (kind === "quarterly") {
      quarter = q.quarter ? Number(q.quarter) : NaN;
      if (!Number.isInteger(quarter) || quarter < 1 || quarter > 4) {
        res.status(400).json({ error: "quarter (1-4) is required when kind=quarterly" });
        return;
      }
    }
    const projectIdFilter = q.projectId ? Number(q.projectId) : null;
    if (q.projectId && !Number.isInteger(projectIdFilter)) {
      res.status(400).json({ error: "projectId must be an integer" });
      return;
    }

    // Step 1: projects in scope (RBAC enforced server-side)
    // State roles are clamped to their own state's locations and reports —
    // matching the report route scope (r.state_id) — and fail closed when no
    // state is assigned.
    const u = req.currentUser;
    const isStateRole =
      u?.role === "state_office_manager" || u?.role === "state_program_officer";
    const stateClamp: number | null = isStateRole ? (u?.stateId ?? null) : null;
    if (isStateRole && stateClamp === null) {
      res.json({
        summary: {
          projectsInScope: 0, expectedLocations: 0, reportsSubmitted: 0,
          reportsApproved: 0, missingLocations: 0, completenessPercent: null,
        },
        projects: [],
      });
      return;
    }
    const scope = await buildScope(req);
    const { sql: scopeSql, params: scopeParams, nextIdx } = projectScopeWhere(scope, "p", 1);
    const projParams: unknown[] = [...scopeParams];
    let projFilter = "";
    if (projectIdFilter !== null) {
      projFilter = ` AND p.id = $${nextIdx}`;
      projParams.push(projectIdFilter);
    }
    const projRes = await pool.query(
      `SELECT p.id, p.title AS name, p.code, p.has_hq_operations AS "hasHqOperations"
         FROM projects p
        WHERE 1=1${scopeSql}${projFilter}
        ORDER BY p.code`,
      projParams,
    );
    const projectIds = projRes.rows.map((r: { id: number }) => r.id);

    interface LocationRow {
      locationType: "hq" | "state";
      stateId: number | null;
      locationName: string;
      reportId: number | null;
      reportStatus: string | null;
      submittedAt: string | null;
      isMissing: boolean;
    }

    let statesRows: { project_id: number; state_id: number; state_name: string }[] = [];
    let reportRows: {
      project_id: number; state_id: number | null; location_type: string | null;
      status: string; report_id: number; submitted_at: string | null;
    }[] = [];

    if (projectIds.length > 0) {
      // Step 2: operational state locations (state roles see only their own state)
      statesRows = await queryProjectStateLocations(pool, projectIds, stateClamp);

      // Step 3: matching PMRs for the exact kind + period (no cross-frequency mixing)
      const repParams: unknown[] = [projectIds, kind, reportingYear];
      let periodSql = "";
      if (kind === "monthly") {
        periodSql = ` AND r.reporting_month = $${repParams.length + 1}`;
        repParams.push(reportingMonth);
      } else if (kind === "quarterly") {
        periodSql = ` AND r.quarter = $${repParams.length + 1}`;
        repParams.push(quarter);
      }
      if (stateClamp !== null) {
        periodSql += ` AND r.state_id = $${repParams.length + 1}`;
        repParams.push(stateClamp);
      }
      const repRes = await pool.query(
        `SELECT r.project_id, r.state_id, r.location_type, r.status,
                r.id AS report_id, r.submitted_at
           FROM reports r
          WHERE r.project_id = ANY($1::int[])
            AND r.report_type = 'project'
            AND r.kind = $2
            AND r.reporting_year = $3${periodSql}
            AND r.status != 'archived'`,
        repParams,
      );
      reportRows = repRes.rows;
    }

    // Aggregate in TypeScript
    const statesByProject = new Map<number, { stateId: number; name: string }[]>();
    for (const s of statesRows) {
      const list = statesByProject.get(s.project_id) ?? [];
      list.push({ stateId: s.state_id, name: s.state_name });
      statesByProject.set(s.project_id, list);
    }
    // best report per project + location key ("hq" | "s<stateId>")
    const bestReport = new Map<string, { report_id: number; status: string; submitted_at: string | null }>();
    for (const r of reportRows) {
      const isHq = r.location_type === "hq" || (r.location_type === null && r.state_id === null);
      const key = `${r.project_id}:${isHq ? "hq" : `s${r.state_id}`}`;
      const prev = bestReport.get(key);
      if (!prev || pmrCompStatusRank(r.status) > pmrCompStatusRank(prev.status)) {
        bestReport.set(key, { report_id: r.report_id, status: r.status, submitted_at: r.submitted_at });
      }
    }

    const toIso = (v: unknown): string | null =>
      v == null ? null : v instanceof Date ? v.toISOString() : String(v);
    const round1 = (v: number) => Math.round(v * 10) / 10;

    const reportingPeriod: Record<string, number> = { year: reportingYear };
    if (reportingMonth !== null) reportingPeriod.month = reportingMonth;
    if (quarter !== null) reportingPeriod.quarter = quarter;

    const projects = projRes.rows.map((p: { id: number; name: string; code: string; hasHqOperations: boolean }) => {
      const locations: LocationRow[] = [];
      const pushLoc = (locType: "hq" | "state", stateId: number | null, name: string) => {
        const rep = bestReport.get(`${p.id}:${locType === "hq" ? "hq" : `s${stateId}`}`);
        locations.push({
          locationType: locType,
          stateId,
          locationName: name,
          reportId: rep ? rep.report_id : null,
          reportStatus: rep ? rep.status : null,
          submittedAt: rep ? toIso(rep.submitted_at) : null,
          // Missing = no report at all, or only a draft (never entered the workflow).
          isMissing: !rep || rep.status === "draft",
        });
      };
      // HQ is not an expected location for state-clamped users — they only
      // see (and report for) their own state.
      if (p.hasHqOperations && stateClamp === null) pushLoc("hq", null, "HQ");
      for (const s of statesByProject.get(p.id) ?? []) pushLoc("state", s.stateId, s.name);

      const expectedLocations = locations.length;
      const reportsSubmitted = locations.filter(
        (l) => l.reportStatus !== null && PMR_COMP_SUBMITTED_STATUSES.has(l.reportStatus),
      ).length;
      const reportsApproved = locations.filter((l) => l.reportStatus === "approved").length;
      const missingLocations = locations.filter((l) => l.isMissing).length;
      return {
        projectId: p.id,
        projectName: p.name,
        projectCode: p.code,
        frequency: kind,
        reportingPeriod,
        expectedLocations,
        reportsSubmitted,
        reportsApproved,
        missingLocations,
        completenessPercent:
          expectedLocations > 0 ? round1((reportsSubmitted / expectedLocations) * 100) : null,
        locations,
      };
    });

    const sum = (f: (p: (typeof projects)[number]) => number) =>
      projects.reduce((acc, p) => acc + f(p), 0);
    const expectedTotal = sum((p) => p.expectedLocations);
    const submittedTotal = sum((p) => p.reportsSubmitted);
    res.json({
      summary: {
        projectsInScope: projects.length,
        expectedLocations: expectedTotal,
        reportsSubmitted: submittedTotal,
        reportsApproved: sum((p) => p.reportsApproved),
        missingLocations: sum((p) => p.missingLocations),
        completenessPercent:
          expectedTotal > 0 ? round1((submittedTotal / expectedTotal) * 100) : null,
      },
      projects,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
