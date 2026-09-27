import { Hono } from "hono";
import { CreateReportBody, TransitionReportBody } from "@workspace/api-zod";
import type { Bindings, QueryExecutor } from "../lib/db";
import { openDb } from "../lib/db";
import {
  attachCurrentUser,
  requireAuth,
  requirePerm,
  permissionsFor,
  hasPerm,
  logAudit,
  tcSectorRestriction,
  assertSectorAllowed,
  type CurrentUser,
  type Variables,
} from "../lib/rbac";
import { VALID_SECTOR_SET } from "../lib/sectors";
import { hasFullOperationalAccess } from "../lib/accessControl";
import { assertActiveState } from "../lib/state-master";
import {
  CANONICAL_REPORT_TYPES,
  CANONICAL_FREQUENCIES,
  REPORT_WORKFLOWS,
  AWAITING_APPROVAL_STATUSES_SQL,
  CANONICAL_TYPES_SQL,
  getRevisionPerm,
  isCanonicalReportType,
  isCanonicalFrequency,
  getProjectActivityWorkflow,
} from "../lib/report-constants";
import {
  assertCanViewReport,
  assertAttachmentMutationAllowed,
  hasActiveTcForSector,
  hasActiveSpoForState,
  getReportSectorForAuth,
} from "../lib/report-auth";
import { contentDispositionHeader } from "../lib/content-disposition";
import {
  PMR_COMP_SUBMITTED_STATUSES,
  pmrCompStatusRank,
  resolveExpectedLocations,
} from "../lib/pmr-location-helper";
import { verifyUploadToken, UploadTokenError } from "../lib/upload-token";
import {
  ObjectNotFoundError,
  deleteObjectSafely,
  getObjectEntityFile,
  getObjectEntityMetadata,
  downloadObject,
} from "../lib/storage";
import { isStorageDeleteSafeForRecord, partitionSafeStoragePathsForReport } from "../lib/evidence-ownership";
import { projectCoverageOverlapsMonth } from "../lib/project-reporting-coverage";

/**
 * Ported from artifacts/api-server/src/routes/reports.ts (4906 lines, 17
 * routes — the largest route file in the whole system) — fourth file of the
 * post-projects.ts phase, batched like plans.ts and projects.ts before it.
 *
 * Batch A (this addition): every read-only route plus every shared helper
 * they need — applyReportScope, applyOperationalPopulation, reportSelect,
 * withHistory, reportDeepLink. GET /reports/consolidated,
 * GET /reports/authors, GET /reports/activity-facet, GET /reports/stats,
 * GET /reports/export, and GET /reports/duplicate-check are deliberately
 * registered BEFORE GET /reports/:reportId (same Hono route-registration-
 * order fix established in projects.ts batch 3 and applied proactively for
 * every batch of plans.ts).
 *
 * Dropped (documented, matching the due-date-checker.ts / risks.ts and
 * monthly-reporting-deadline.ts precedents): POST
 * /reports/monthly-reporting/evaluate and the entire
 * lib/monthly-reporting-deadline.ts module it alone consumes — both exist
 * purely to resolve monthly-reporting "obligations" and deliver reminder
 * notifications/emails via the not-yet-built notification-creation engine.
 * Also dropped throughout (same reasoning as every prior file):
 * notifyEntityActorsDeduped / notifyNextApprover / createNotificationDeduped
 * notification creation, and realtime.broadcastUpdate /
 * realtime.captureOperationalAudience (deferred to the Durable Objects phase).
 */

const objectStorageService = {
  getObjectEntityFile,
  getObjectEntityMetadata,
  downloadObject,
};

/** Maximum rows returned by the /reports/export endpoint.
 *  A sentinel query of MAX+1 is used to distinguish exactly-MAX results
 *  from truncated results without a separate COUNT query. */
const REPORT_EXPORT_MAX_ROWS = 5_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function reportDeepLink(db: QueryExecutor, reportId: number): Promise<string> {
  const r = await db.query<{ rt: string | null }>(
    `SELECT report_type AS rt FROM reports WHERE id = $1`,
    [reportId],
  );
  const rt = r.rows[0]?.rt ?? "project";
  const slug =
    rt === "hq_sector"
      ? "hq-sector"
      : rt === "program_state"
        ? "program-state"
        : rt;
  return `/reports/${slug}/${reportId}`;
}

/**
 * Apply canonical report type filter and operational status filter to a
 * WHERE clause fragment list + params array.
 * Also applies state/TC-sector scoping for the current user.
 *
 * @param opts.reportType - When set, makes the TC sector predicate type-aware:
 *   - 'project'  → TC filter uses p.sector ONLY (Project Primary Sector authoritative).
 *                  Knowing a stale r.sector value must never widen TC access.
 *   - other type → TC filter uses (r.sector OR p.sector) — correct for hq_sector etc.
 *   - undefined  → mixed/unfiltered query: produces a type-conditional SQL predicate that
 *                  applies the project-strict rule to project rows and the OR rule to others.
 *
 * @param opts.excludeArchived - when true (default), excludes archived reports.
 */
function applyReportScope(
  user: CurrentUser | undefined,
  filters: string[],
  params: unknown[],
  opts: {
    tableAlias?: string;
    projectJoinAlias?: string;
    excludeArchived?: boolean;
    canonicalOnly?: boolean;
    /** Pass the query's report_type when known so TC scope uses the correct predicate. */
    reportType?: string;
  } = {},
): { needsProjectJoin: boolean } {
  const r = opts.tableAlias ?? "r";
  const p = opts.projectJoinAlias ?? "p";
  const excludeArchived = opts.excludeArchived !== false;
  const canonicalOnly = opts.canonicalOnly !== false;

  // ── Scope notes ──────────────────────────────────────────────────────────
  // Roles with org-wide Reports read (no state/sector filter applied here):
  //   super_admin, executive_director, program_manager,
  //   senior_program_coordinator, viewer
  //   (TC is org-wide here; sector filter applied separately via tcSectorRestriction)
  // ─────────────────────────────────────────────────────────────────────────

  // State restriction (state roles clamped to their own state)
  const isStateRole =
    user?.role === "state_program_officer" ||
    user?.role === "state_office_manager";
  if (isStateRole) {
    if (!user?.stateId) {
      // Fail-closed: state-scoped role with no assigned stateId cannot see any reports.
      filters.push("1 = 0");
      return { needsProjectJoin: false };
    }
    params.push(user.stateId);
    filters.push(`${r}.state_id = $${params.length}`);
  }

  // TC sector restriction — type-aware
  const tcSectors = tcSectorRestriction(user);
  let needsProjectJoin = false;
  if (tcSectors) {
    params.push(tcSectors);
    const idx = params.length;
    if (opts.reportType === "project") {
      // Project Reports: TC scope uses Project Primary Sector ONLY.
      // r.sector is display-only and must not widen access.
      // Fail-closed: project rows with p.sector IS NULL are excluded (p.sector ANY(…) = false).
      filters.push(`${p}.sector = ANY($${idx}::text[])`);
    } else if (!opts.reportType) {
      // Mixed query (no type filter): source-aware predicate per row type.
      //   project rows: p.sector ONLY.
      //   activity project-linked: p.sector ONLY.
      //   activity standalone (project_id IS NULL): act.sector.
      //   hq_sector / program_state: r.sector OR p.sector.
      filters.push(
        `(`
        + `(${r}.report_type = 'project' AND ${p}.sector = ANY($${idx}::text[]))`
        + ` OR (${r}.report_type = 'activity' AND ${r}.project_id IS NOT NULL AND ${p}.sector = ANY($${idx}::text[]))`
        + ` OR (${r}.report_type = 'activity' AND ${r}.project_id IS NULL AND act.sector = ANY($${idx}::text[]))`
        + ` OR (${r}.report_type NOT IN ('project', 'activity') AND (${r}.sector = ANY($${idx}::text[]) OR ${p}.sector = ANY($${idx}::text[])))`
        + `)`,
      );
    } else if (opts.reportType === "activity") {
      // Activity Reports: source-aware TC scope.
      //   Project-linked: Project Primary Sector is the ONLY authority (fail-closed).
      //   Standalone (project_id IS NULL): activity.sector is the ONLY authority.
      filters.push(
        `(`
        + `(${r}.project_id IS NOT NULL AND ${p}.sector = ANY($${idx}::text[]))`
        + ` OR (${r}.project_id IS NULL AND act.sector = ANY($${idx}::text[]))`
        + `)`,
      );
    } else {
      // Other explicit types (hq_sector, program_state):
      // these carry their authoritative sector in r.sector (hq_sector) or
      // derive it from the project.
      filters.push(
        `(${r}.sector = ANY($${idx}::text[]) OR ${p}.sector = ANY($${idx}::text[]))`,
      );
    }
    needsProjectJoin = true;
  }

  // Canonical type filter (excludes NULL and legacy non-canonical values)
  if (canonicalOnly) {
    filters.push(`${r}.report_type = ANY(${CANONICAL_TYPES_SQL})`);
  }

  // Operational status filter (excludes archived by default)
  if (excludeArchived) {
    filters.push(`${r}.status != 'archived'`);
  }

  return { needsProjectJoin };
}

/**
 * Restricts to the operational Report population by appending two predicates:
 *   - migration_is_duplicate = FALSE  (excludes migration-preserved historical duplicates)
 *   - migration_status_unverified = FALSE  (excludes records with unknown original status)
 *
 * Call AFTER applyReportScope() for all KPI/stats aggregations.
 * Do NOT call for individual record reads, workflow transitions, or admin history views.
 */
function applyOperationalPopulation(filters: string[], tableAlias = "r"): void {
  filters.push(`${tableAlias}.migration_is_duplicate = FALSE`);
  filters.push(`${tableAlias}.migration_status_unverified = FALSE`);
}

// ── Base SELECT fragment ──────────────────────────────────────────────────────

const reportSelect = `
  SELECT r.id, r.title, r.kind, r.status,
         r.report_type        AS "reportType",
         r.activity_id        AS "activityId",
         r.reporting_month    AS "reportingMonth",
         r.reporting_year     AS "reportingYear",
         r.period_start       AS "periodStart",
         r.period_end         AS "periodEnd",
         r.sector,
         r.submitted_to       AS "submittedTo",
         r.project_id         AS "projectId",   p.title AS "projectTitle",
          r.state_id           AS "stateId",     s.name  AS "stateName", s.name_ar AS "stateNameAr",
         r.period, r.narrative,
         r.executive_summary  AS "executiveSummary",
         r.challenges,
         r.recommendations,
         r.sections,
         r.beneficiaries_male   AS "beneficiariesMale",
         r.beneficiaries_female AS "beneficiariesFemale",
         r.beneficiaries_boys   AS "beneficiariesBoys",
         r.beneficiaries_girls  AS "beneficiariesGirls",
         r.planned_budget     AS "plannedBudget",
         r.actual_expenditure AS "actualExpenditure",
         r.currency,
         r.activities,
         r.quarter,
         r.on_demand_reason   AS "onDemandReason",
         r.indicator_progress AS "indicatorProgress",
         r.migration_review_notes AS "migrationReviewNotes",
         r.workflow_path AS "workflowPath",
         r.author_id     AS "authorId",
         CASE
           WHEN r.report_type = 'activity' AND r.project_id IS NOT NULL THEN p.sector
           WHEN r.report_type = 'activity' AND r.project_id IS NULL     THEN act.sector
           ELSE COALESCE(NULLIF(r.sector,''), p.sector)
         END AS "effectiveSector",
         COALESCE(au.name, 'Former User') AS "authorName",
         u.name AS "submittedByName", r.submitted_at AS "submittedAt",
         act.title    AS "activityTitle",
         act.code     AS "activityCode",
         act.sector   AS "activitySector",
         act.currency AS "activityCurrency",
         r.activity_name AS "activityName",
         COALESCE(r.location_type, CASE WHEN r.state_id IS NOT NULL THEN 'state' ELSE NULL END) AS "locationType"
  FROM reports r
  LEFT JOIN projects   p   ON p.id   = r.project_id
  LEFT JOIN states     s   ON s.id   = r.state_id
  LEFT JOIN users      u   ON u.id   = r.submitted_by_id
  LEFT JOIN users      au  ON au.id  = r.author_id
  LEFT JOIN activities act ON act.id = r.activity_id
`;

async function withHistory(db: QueryExecutor, rows: Record<string, unknown>[]) {
  if (rows.length === 0) return rows;
  const ids = rows.map((r) => r.id as number);
  const { rows: hist } = await db.query<{
    id: number; entityId: number; action: string; fromStatus: string; toStatus: string;
    actorName: string; actorRole: string; comment: string | null; timestamp: string;
    usedOverride: boolean; overrideReason: string | null;
  }>(
    `SELECT a.id, a.entity_id AS "entityId", a.action,
            a.from_status AS "fromStatus", a.to_status AS "toStatus",
            u.name AS "actorName", u.role_label AS "actorRole",
            a.comment, a.timestamp,
            a.used_override AS "usedOverride", a.override_reason AS "overrideReason"
     FROM approvals a JOIN users u ON u.id = a.actor_id
     WHERE a.entity_type = 'report' AND a.entity_id = ANY($1::int[])
     ORDER BY a.timestamp ASC`,
    [ids],
  );
  const byEntity = new Map<number, unknown[]>();
  for (const h of hist) {
    const arr = byEntity.get(h.entityId) ?? [];
    arr.push(h);
    byEntity.set(h.entityId, arr);
  }
  return rows.map((r) => ({
    ...r,
    plannedBudget: r.plannedBudget != null ? Number(r.plannedBudget) : null,
    actualExpenditure: r.actualExpenditure != null ? Number(r.actualExpenditure) : null,
    approvalHistory: byEntity.get(r.id as number) ?? [],
  }));
}

/**
 * Ported from artifacts/api-server/src/routes/comments.ts's
 * unresolvedRequiredCorrections export (same duplication already applied in
 * routes/plans.ts and routes/projects.ts — porting the rest of comments.ts is
 * not required for this one query).
 */
async function unresolvedRequiredCorrections(
  db: QueryExecutor,
  entityType: string,
  entityId: number,
): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM comments
     WHERE entity_type = $1 AND entity_id = $2 AND comment_type = 'required_correction' AND status = 'open'`,
    [entityType, entityId],
  );
  return rows[0]?.n ?? 0;
}

export const reportsRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

reportsRoutes.use("/reports", attachCurrentUser, requireAuth);
reportsRoutes.use("/reports/*", attachCurrentUser, requireAuth);

// ---------------------------------------------------------------------------
// GET /reports — List reports
// ---------------------------------------------------------------------------

reportsRoutes.get("/reports", requirePerm("reports.view"), async (c) => {
  const user = c.get("currentUser");
  const { db, close } = openDb(c);
  try {
    const filters: string[] = [];
    const params: unknown[] = [];

    const q = c.req.query();

    if (q.projectId) {
      if (String(q.projectId) === "standalone") {
        filters.push(`r.project_id IS NULL`);
      } else {
        params.push(Number(q.projectId));
        filters.push(`r.project_id = $${params.length}`);
      }
    }
    if (q.status) {
      params.push(String(q.status));
      filters.push(`r.status = $${params.length}`);
    }
    if (q.reportType) {
      params.push(String(q.reportType));
      filters.push(`r.report_type = $${params.length}`);
    }
    if (q.kind) {
      params.push(String(q.kind));
      filters.push(`r.kind = $${params.length}`);
    }
    if (q.sector) {
      params.push(String(q.sector));
      // Use effective sector (COALESCE r.sector, project primary sector)
      filters.push(`COALESCE(NULLIF(r.sector,''), p.sector) = $${params.length}`);
    }
    if (q.reportingYear) {
      params.push(Number(q.reportingYear));
      filters.push(`r.reporting_year = $${params.length}`);
    }
    if (q.reportingMonth) {
      params.push(Number(q.reportingMonth));
      filters.push(`r.reporting_month = $${params.length}`);
    }
    if (q.authorId) {
      params.push(Number(q.authorId));
      filters.push(`r.author_id = $${params.length}`);
    }
    if (q.activityId) {
      params.push(Number(q.activityId));
      filters.push(`r.activity_id = $${params.length}`);
    }
    if (q.q) {
      const like = `%${String(q.q)}%`;
      params.push(like);
      filters.push(
        `(r.title ILIKE $${params.length} OR p.title ILIKE $${params.length} OR s.name ILIKE $${params.length} OR COALESCE(NULLIF(r.sector,''), p.sector) ILIKE $${params.length})`,
      );
    }

    // Include archived when explicitly requested
    const includeArchived = q.status === "archived";

    // Apply authoritative scope (state restriction, TC sector, canonical type filter)
    applyReportScope(user, filters, params, {
      excludeArchived: !includeArchived,
      canonicalOnly: q.reportType ? false : true, // honour explicit type filter
      reportType: q.reportType ? String(q.reportType) : undefined,
    });

    // Operational-population filter (default): excludes migration duplicates and records with
    // unverified historical status. These rows are preserved for audit but must not silently
    // distort list totals or appear as active workflow records.
    // HQ leadership roles may pass ?includeHistorical=true to retrieve all records for review.
    const HQ_LEADERSHIP_ROLES_FOR_HISTORY = new Set([
      "super_admin", "executive_director", "program_manager", "senior_program_coordinator",
    ]);
    const includeHistorical =
      q.includeHistorical === "true" &&
      HQ_LEADERSHIP_ROLES_FOR_HISTORY.has(user?.role ?? "");
    if (!includeHistorical) {
      applyOperationalPopulation(filters);
    }

    // Explicit state filter AFTER scope (scope may already have clamped state)
    if (q.stateId) {
      const isStateRole =
        user?.role === "state_program_officer" ||
        user?.role === "state_office_manager";
      if (!isStateRole) {
        params.push(Number(q.stateId));
        filters.push(`r.state_id = $${params.length}`);
      }
    }

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    // Pagination
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 25));
    const offset = (page - 1) * pageSize;

    // Count total matching records.
    // Must include LEFT JOIN activities act so TC scope predicates referencing
    // act.sector (for standalone activity reports) do not cause a missing-FROM-clause error.
    const countResult = await db.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM reports r
       LEFT JOIN projects    p   ON p.id   = r.project_id
       LEFT JOIN states      s   ON s.id   = r.state_id
       LEFT JOIN activities  act ON act.id = r.activity_id
       ${where}`,
      params,
    );
    const total = Number(countResult.rows[0].total);
    const totalPages = Math.ceil(total / pageSize);

    const { rows } = await db.query<Record<string, unknown>>(
      `${reportSelect} ${where} ORDER BY r.submitted_at DESC NULLS LAST, r.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset],
    );
    const items = await withHistory(db, rows);
    return c.json({ items, total, page, pageSize, totalPages });
  } finally {
    close();
  }
});

// ---------------------------------------------------------------------------
// GET /reports/consolidated — Consolidated Project View (BD-5 Option B)
// ---------------------------------------------------------------------------
// Pure read model: groups all PMRs for one project + frequency + period by
// Reporting Location with a coverage indicator. No synthetic consolidated
// record, no cross-frequency mixing, no cross-location beneficiary totals.

const CONS_MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

reportsRoutes.get("/reports/consolidated", requirePerm("reports.view"), async (c) => {
  const user = c.get("currentUser");
  const { db, close } = openDb(c);
  try {
    const q = c.req.query();

    // ── Validation ─────────────────────────────────────────────────────────
    const projectId = q.projectId ? Number(q.projectId) : NaN;
    if (!Number.isInteger(projectId)) {
      return c.json({ error: "projectId is required and must be an integer" }, 400);
    }
    const kind = q.kind;
    if (!kind || !isCanonicalFrequency(kind)) {
      return c.json({
        error: `kind is required and must be one of: ${CANONICAL_FREQUENCIES.join(", ")}`,
      }, 400);
    }
    const reportingYear = q.reportingYear ? Number(q.reportingYear) : NaN;
    if (!Number.isInteger(reportingYear) || reportingYear < 2000 || reportingYear > 2100) {
      return c.json({ error: "reportingYear is required and must be between 2000 and 2100" }, 400);
    }
    let reportingMonth: number | null = null;
    let quarter: number | null = null;
    if (kind === "monthly") {
      if (q.quarter !== undefined) {
        return c.json({ error: "quarter is not allowed when kind=monthly" }, 400);
      }
      reportingMonth = q.reportingMonth ? Number(q.reportingMonth) : NaN;
      if (!Number.isInteger(reportingMonth) || reportingMonth < 1 || reportingMonth > 12) {
        return c.json({ error: "reportingMonth (1-12) is required when kind=monthly" }, 400);
      }
    } else if (kind === "quarterly") {
      if (q.reportingMonth !== undefined) {
        return c.json({ error: "reportingMonth is not allowed when kind=quarterly" }, 400);
      }
      quarter = q.quarter ? Number(q.quarter) : NaN;
      if (!Number.isInteger(quarter) || quarter < 1 || quarter > 4) {
        return c.json({ error: "quarter (1-4) is required when kind=quarterly" }, 400);
      }
    } else {
      // annual / on_demand: year is the only period selector
      if (q.reportingMonth !== undefined || q.quarter !== undefined) {
        return c.json({ error: `reportingMonth and quarter are not allowed when kind=${kind}` }, 400);
      }
    }

    // ── Access control (same semantics as the report-list scope) ──────────
    const isStateRole =
      user?.role === "state_program_officer" || user?.role === "state_office_manager";
    const stateClamp: number | null = isStateRole ? (user?.stateId ?? null) : null;
    if (isStateRole && stateClamp === null) {
      // Fail-closed: state-scoped role with no assigned state sees nothing.
      return c.json({ error: "no state assigned" }, 403);
    }
    const tcSectors = tcSectorRestriction(user);
    if (tcSectors !== null && tcSectors.length === 0) {
      // Fail-closed: TC with no assigned sector sees nothing.
      return c.json({ error: "no sector assigned" }, 403);
    }

    // SPO project-assignment scope — mirrors buildScope() used by
    // /dashboard/pmr-reporting-completeness: an SPO sees only projects they
    // are assigned to. Fail with 404 (no existence leakage) otherwise.
    if (user?.role === "state_program_officer") {
      const asgRes = await db.query<{ project_id: number }>(
        `SELECT DISTINCT project_id FROM project_assignments WHERE user_id = $1`,
        [user.id],
      );
      const assigned = new Set(asgRes.rows.map((r) => r.project_id));
      if (!assigned.has(projectId)) {
        return c.json({ error: "project not found" }, 404);
      }
    }

    // ── Project (single query; scope-checked) ─────────────────────────────
    const projRes = await db.query<{
      id: number; title: string; code: string; sector: string | null;
      hasHqOperations: boolean;
    }>(
      `SELECT p.id, p.title, p.code, p.sector,
              p.has_hq_operations AS "hasHqOperations"
         FROM projects p
        WHERE p.id = $1`,
      [projectId],
    );
    if (projRes.rows.length === 0) {
      return c.json({ error: "project not found" }, 404);
    }
    const project = projRes.rows[0];
    // TC: Project Primary Sector is the ONLY authority (fail-closed on null).
    if (tcSectors !== null && (!project.sector || !tcSectors.includes(project.sector))) {
      return c.json({ error: "project not found" }, 404);
    }

    // ── Expected locations (scoped — no location-existence leakage) ───────
    const expected = await resolveExpectedLocations(db, projectId, {
      stateClamp,
      hasHqOperations: Boolean(project.hasHqOperations),
    });
    // State-clamped user whose state is not an operational location of this
    // project: the project is out of their scope — 404, no data leakage.
    if (stateClamp !== null && expected.length === 0) {
      return c.json({ error: "project not found" }, 404);
    }

    // ── Matching PMRs (single set-based query, no N+1) ─────────────────────
    const repParams: unknown[] = [projectId, kind, reportingYear];
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
    const repRes = await db.query<{
      id: number; status: string; state_id: number | null;
      location_type: string | null; submitted_at: Date | string | null;
      title: string; narrative: string | null; executive_summary: string | null;
      challenges: string | null; recommendations: string | null;
      activities: unknown; indicator_progress: unknown;
      beneficiaries_male: number | null; beneficiaries_female: number | null;
      beneficiaries_boys: number | null; beneficiaries_girls: number | null;
      planned_budget: string | number | null;
      actual_expenditure: string | number | null;
      currency: string | null;
    }>(
      `SELECT r.id, r.status, r.state_id, r.location_type, r.submitted_at,
              r.title, r.narrative, r.executive_summary, r.challenges,
              r.recommendations, r.activities, r.indicator_progress,
              r.beneficiaries_male, r.beneficiaries_female,
              r.beneficiaries_boys, r.beneficiaries_girls,
              r.planned_budget, r.actual_expenditure, r.currency
         FROM reports r
        WHERE r.project_id = $1
          AND r.report_type = 'project'
          AND r.kind = $2
          AND r.reporting_year = $3${periodSql}
          AND r.status != 'archived'
        ORDER BY r.location_type DESC, r.state_id ASC`,
      repParams,
    );

    type ConsReportRow = (typeof repRes.rows)[number];

    // Best report per location key ("hq" | "s<stateId>") — same ranking as
    // the reporting-completeness endpoint (shared pmrCompStatusRank).
    const bestReport = new Map<string, ConsReportRow>();
    for (const r of repRes.rows) {
      const isHq = r.location_type === "hq" || (r.location_type === null && r.state_id === null);
      const key = isHq ? "hq" : `s${r.state_id}`;
      const prev = bestReport.get(key);
      if (!prev || pmrCompStatusRank(r.status) > pmrCompStatusRank(prev.status)) {
        bestReport.set(key, r);
      }
    }

    const toIso = (v: unknown): string | null =>
      v == null ? null : v instanceof Date ? v.toISOString() : String(v);
    const toNum = (v: unknown): number | null => (v == null ? null : Number(v));
    const round1 = (v: number) => Math.round(v * 10) / 10;

    const locations = expected.map((loc) => {
      const rep = bestReport.get(loc.locationType === "hq" ? "hq" : `s${loc.stateId}`);
      return {
        locationType: loc.locationType,
        stateId: loc.stateId,
        locationName: loc.locationName,
        // Missing = no report at all, or only a draft (never entered the
        // workflow) — consistent with pmr-reporting-completeness.
        isMissing: !rep || rep.status === "draft",
        report: rep
          ? {
              reportId: rep.id,
              status: rep.status,
              submittedAt: toIso(rep.submitted_at),
              title: rep.title,
              narrative: rep.narrative,
              executiveSummary: rep.executive_summary,
              challenges: rep.challenges,
              recommendations: rep.recommendations,
              beneficiariesMale: rep.beneficiaries_male,
              beneficiariesFemale: rep.beneficiaries_female,
              beneficiariesBoys: rep.beneficiaries_boys,
              beneficiariesGirls: rep.beneficiaries_girls,
              activities: rep.activities,
              indicatorProgress: rep.indicator_progress,
              plannedBudget: toNum(rep.planned_budget),
              actualExpenditure: toNum(rep.actual_expenditure),
              currency: rep.currency,
            }
          : null,
      };
    });

    const expectedLocations = locations.length;
    const reportsSubmitted = locations.filter(
      (l) => l.report !== null && PMR_COMP_SUBMITTED_STATUSES.has(l.report.status),
    ).length;
    const reportsApproved = locations.filter((l) => l.report?.status === "approved").length;
    const missingLocations = locations.filter((l) => l.isMissing).length;

    const period: Record<string, unknown> = { kind, reportingYear };
    let label: string;
    if (kind === "monthly") {
      period.reportingMonth = reportingMonth;
      label = `${CONS_MONTH_NAMES[(reportingMonth as number) - 1]} ${reportingYear}`;
    } else if (kind === "quarterly") {
      period.quarter = quarter;
      label = `Q${quarter} ${reportingYear}`;
    } else {
      label = String(reportingYear);
    }
    period.label = label;

    return c.json({
      project: {
        id: project.id,
        code: project.code,
        title: project.title,
        sector: project.sector ?? "",
      },
      period,
      completeness: {
        expectedLocations,
        reportsSubmitted,
        reportsApproved,
        missingLocations,
        completenessPercent:
          expectedLocations > 0 ? round1((reportsSubmitted / expectedLocations) * 100) : null,
      },
      locations,
    });
  } finally {
    close();
  }
});

// ---------------------------------------------------------------------------
// GET /reports/authors — Scoped unique author facet for the Author filter
// ---------------------------------------------------------------------------

reportsRoutes.get("/reports/authors", requirePerm("reports.view"), async (c) => {
  const user = c.get("currentUser");
  const { db, close } = openDb(c);
  try {
    const q = c.req.query();
    const filters: string[] = [];
    const params: unknown[] = [];

    if (q.reportType) {
      params.push(String(q.reportType));
      filters.push(`r.report_type = $${params.length}`);
    }
    if (q.projectId) {
      if (String(q.projectId) === "standalone") {
        filters.push(`r.project_id IS NULL`);
      } else {
        params.push(Number(q.projectId));
        filters.push(`r.project_id = $${params.length}`);
      }
    }
    if (q.status) {
      params.push(String(q.status));
      filters.push(`r.status = $${params.length}`);
    }
    if (q.sector) {
      params.push(String(q.sector));
      filters.push(`COALESCE(NULLIF(r.sector,''), p.sector) = $${params.length}`);
    }
    if (q.kind) {
      params.push(String(q.kind));
      filters.push(`r.kind = $${params.length}`);
    }
    if (q.reportingYear) {
      params.push(Number(q.reportingYear));
      filters.push(`r.reporting_year = $${params.length}`);
    }
    if (q.reportingMonth) {
      params.push(Number(q.reportingMonth));
      filters.push(`r.reporting_month = $${params.length}`);
    }
    if (q.quarter) {
      params.push(Number(q.quarter));
      filters.push(`r.quarter = $${params.length}`);
    }
    if (q.activityId) {
      params.push(Number(q.activityId));
      filters.push(`r.activity_id = $${params.length}`);
    }
    // stateId: HQ users may pass an explicit stateId filter; state-scoped roles
    // are already clamped by applyReportScope below (passed param is ignored for them).
    if (q.stateId) {
      const isStateRole =
        user?.role === "state_program_officer" ||
        user?.role === "state_office_manager";
      if (!isStateRole) {
        params.push(Number(q.stateId));
        filters.push(`r.state_id = $${params.length}`);
      }
    }

    // ── RBAC scope + canonical type + operational population ─────────────────
    applyReportScope(user, filters, params, {
      excludeArchived: true,
      canonicalOnly: q.reportType ? false : true,
      reportType: q.reportType ? String(q.reportType) : undefined,
    });
    applyOperationalPopulation(filters);

    // ── Exclude NULL author_ids ───────────────────────────────────────────────
    filters.push(`r.author_id IS NOT NULL`);

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    const { rows } = await db.query<{ id: number; name: string }>(
      `SELECT DISTINCT ON (r.author_id)
              r.author_id          AS id,
              COALESCE(au.name, 'Former User') AS name
       FROM   reports r
       LEFT JOIN projects    p   ON p.id   = r.project_id
       LEFT JOIN users       au  ON au.id  = r.author_id
       LEFT JOIN activities  act ON act.id = r.activity_id
       ${where}
       ORDER  BY r.author_id, name`,
      params,
    );

    // Secondary sort: alphabetical by display name
    rows.sort((a, b) => a.name.localeCompare(b.name));

    return c.json({ authors: rows });
  } finally {
    close();
  }
});

// ---------------------------------------------------------------------------
// GET /reports/activity-facet — Activities that have Activity Reports, RBAC-scoped
// ---------------------------------------------------------------------------

reportsRoutes.get("/reports/activity-facet", requirePerm("reports.view"), async (c) => {
  const user = c.get("currentUser");
  const { db, close } = openDb(c);
  try {
    const q = c.req.query();
    const filters: string[] = [];
    const params: unknown[] = [];

    // Always locked to activity report type
    params.push("activity");
    filters.push(`r.report_type = $${params.length}`);

    if (q.projectId) {
      if (String(q.projectId) === "standalone") {
        filters.push(`r.project_id IS NULL`);
      } else {
        params.push(Number(q.projectId));
        filters.push(`r.project_id = $${params.length}`);
      }
    }
    if (q.sector) {
      params.push(String(q.sector));
      filters.push(`COALESCE(NULLIF(r.sector,''), p.sector) = $${params.length}`);
    }
    if (q.stateId) {
      const isStateRole =
        user?.role === "state_program_officer" ||
        user?.role === "state_office_manager";
      if (!isStateRole) {
        params.push(Number(q.stateId));
        filters.push(`r.state_id = $${params.length}`);
      }
    }

    applyReportScope(user, filters, params, {
      excludeArchived: true,
      canonicalOnly: false, // report_type already pinned above
      reportType: "activity",
    });
    applyOperationalPopulation(filters);

    // Only rows with a resolved activity
    filters.push(`r.activity_id IS NOT NULL`);
    filters.push(`act.id IS NOT NULL`);

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    const { rows } = await db.query<{ id: number; title: string; code: string | null }>(
      `SELECT DISTINCT ON (act.id)
              act.id,
              act.title,
              act.code
       FROM   reports r
       LEFT JOIN projects   p   ON p.id   = r.project_id
       LEFT JOIN activities act ON act.id = r.activity_id
       ${where}
       ORDER  BY act.id, act.title`,
      params,
    );
    rows.sort((a, b) => (a.title ?? "").localeCompare(b.title ?? ""));
    return c.json({ activities: rows });
  } finally {
    close();
  }
});

// ---------------------------------------------------------------------------
// GET /reports/stats — Per-type counts using canonical status groups
// ---------------------------------------------------------------------------

reportsRoutes.get("/reports/stats", requirePerm("reports.view"), async (c) => {
  const user = c.get("currentUser");
  const { db, close } = openDb(c);
  try {
    const filters: string[] = [];
    const params: unknown[] = [];

    applyReportScope(user, filters, params, {
      excludeArchived: false, // stats show all operational statuses; archive excluded below
      canonicalOnly: true,
    });
    filters.push(`r.status != 'archived'`);
    applyOperationalPopulation(filters);

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const { rows } = await db.query<{
      report_type: string;
      total: string;
      draft: string;
      awaiting_approval: string;
      approved: string;
      awaiting_over14: string;
    }>(
      `SELECT
         r.report_type,
         COUNT(*)::text                                                  AS total,
         COUNT(*) FILTER (WHERE r.status = 'draft')::text               AS draft,
         COUNT(*) FILTER (WHERE r.status = ANY(${AWAITING_APPROVAL_STATUSES_SQL}))::text AS awaiting_approval,
         COUNT(*) FILTER (WHERE r.status = 'approved')::text            AS approved,
         COUNT(*) FILTER (
           WHERE r.status = ANY(${AWAITING_APPROVAL_STATUSES_SQL})
             AND r.submitted_at < NOW() - INTERVAL '14 days'
         )::text AS awaiting_over14
       FROM reports r
       LEFT JOIN projects    p   ON p.id   = r.project_id
       LEFT JOIN activities  act ON act.id = r.activity_id
       ${where}
       GROUP BY r.report_type`,
      params,
    );
    const stats: Record<
      string,
      { total: number; draft: number; awaitingApproval: number; approved: number; awaitingApprovalOver14Days: number }
    > = {};
    for (const r of rows) {
      stats[r.report_type] = {
        total: Number(r.total),
        draft: Number(r.draft),
        awaitingApproval: Number(r.awaiting_approval),
        approved: Number(r.approved),
        awaitingApprovalOver14Days: Number(r.awaiting_over14),
      };
    }
    return c.json(stats);
  } finally {
    close();
  }
});

// ---------------------------------------------------------------------------
// GET /reports/export — Export all matching reports (no pagination limit)
// ---------------------------------------------------------------------------

reportsRoutes.get("/reports/export", requirePerm("reports.view"), async (c) => {
  const user = c.get("currentUser");
  const { db, close } = openDb(c);
  try {
    const q = c.req.query();
    const filters: string[] = [];
    const params: unknown[] = [];

    if (q.projectId) {
      if (String(q.projectId) === "standalone") {
        filters.push(`r.project_id IS NULL`);
      } else {
        params.push(Number(q.projectId));
        filters.push(`r.project_id = $${params.length}`);
      }
    }
    if (q.status) {
      params.push(String(q.status));
      filters.push(`r.status = $${params.length}`);
    }
    if (q.reportType) {
      params.push(String(q.reportType));
      filters.push(`r.report_type = $${params.length}`);
    }
    if (q.kind) {
      params.push(String(q.kind));
      filters.push(`r.kind = $${params.length}`);
    }
    if (q.sector) {
      params.push(String(q.sector));
      filters.push(`COALESCE(NULLIF(r.sector,''), p.sector) = $${params.length}`);
    }
    if (q.reportingYear) {
      params.push(Number(q.reportingYear));
      filters.push(`r.reporting_year = $${params.length}`);
    }
    if (q.reportingMonth) {
      params.push(Number(q.reportingMonth));
      filters.push(`r.reporting_month = $${params.length}`);
    }
    if (q.quarter) {
      params.push(Number(q.quarter));
      filters.push(`r.quarter = $${params.length}`);
    }
    if (q.authorId) {
      params.push(Number(q.authorId));
      filters.push(`r.author_id = $${params.length}`);
    }
    if (q.activityId) {
      params.push(Number(q.activityId));
      filters.push(`r.activity_id = $${params.length}`);
    }

    const includeArchived = q.status === "archived";
    applyReportScope(user, filters, params, {
      excludeArchived: !includeArchived,
      canonicalOnly: q.reportType ? false : true,
      reportType: q.reportType ? String(q.reportType) : undefined,
    });
    applyOperationalPopulation(filters);

    if (q.stateId) {
      const isStateRole =
        user?.role === "state_program_officer" ||
        user?.role === "state_office_manager";
      if (!isStateRole) {
        params.push(Number(q.stateId));
        filters.push(`r.state_id = $${params.length}`);
      }
    }

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const { rows: rawRows } = await db.query<Record<string, unknown>>(
      `${reportSelect} ${where} ORDER BY r.submitted_at DESC NULLS LAST, r.id DESC LIMIT $${params.length + 1}`,
      [...params, REPORT_EXPORT_MAX_ROWS + 1],
    );

    // MAX+1 sentinel: if we got more than the cap, the result set is larger than the limit.
    const truncated = rawRows.length > REPORT_EXPORT_MAX_ROWS;
    const rows = truncated ? rawRows.slice(0, REPORT_EXPORT_MAX_ROWS) : rawRows;

    c.header("X-Report-Truncated", String(truncated));
    c.header("X-Report-Export-Limit", String(REPORT_EXPORT_MAX_ROWS));
    return c.json(await withHistory(db, rows));
  } finally {
    close();
  }
});

// ---------------------------------------------------------------------------
// GET /reports/duplicate-check
// ---------------------------------------------------------------------------

reportsRoutes.get("/reports/duplicate-check", requirePerm("reports.view"), async (c) => {
  const user = c.get("currentUser");
  const { db, close } = openDb(c);
  try {
    const q = c.req.query();
    const { projectId, stateId, locationType: dupLocationType, frequency, period, activityId, reportType: qReportType } = q;
    const isActivityDupCheck = qReportType === "activity" || !!activityId;

    if (!period) {
      return c.json({ error: "period is required" }, 400);
    }
    if (!isActivityDupCheck && !frequency) {
      return c.json({ error: "frequency and period are required" }, 400);
    }

    if (isActivityDupCheck) {
      if (!activityId) {
        return c.json({ matchType: "none" });
      }

      const actScopeRow = await db.query<{
        actProjectId: number | null;
        actSector: string | null;
        projectSector: string | null;
      }>(
        `SELECT a.project_id AS "actProjectId",
                a.sector     AS "actSector",
                p.sector     AS "projectSector"
         FROM activities a
         LEFT JOIN projects p ON p.id = a.project_id
         WHERE a.id = $1`,
        [Number(activityId)],
      );
      if (actScopeRow.rows.length === 0) {
        return c.json({ error: "activity_not_found" }, 404);
      }
      const { actProjectId, actSector, projectSector } = actScopeRow.rows[0];
      const dcEffectiveSector = actProjectId !== null ? projectSector : actSector;
      const dcSectorGuard = assertSectorAllowed(user, dcEffectiveSector);
      if (!dcSectorGuard.ok) {
        return c.json(dcSectorGuard.body, dcSectorGuard.status as 403);
      }
      const isDcStateRole =
        user?.role === "state_program_officer" ||
        user?.role === "state_office_manager";
      if (isDcStateRole && user?.stateId && stateId) {
        if (Number(stateId) !== user.stateId) {
          return c.json({ error: "state_scope_forbidden" }, 403);
        }
      }

      if (String(frequency) === "on_demand") {
        return c.json({ matchType: "none" });
      }

      const { rows } = await db.query<{ id: number; title: string; period: string; status: string }>(
        `SELECT r.id, r.title, r.period, r.status
         FROM reports r
         WHERE r.report_type = 'activity'
           AND r.activity_id = $1
           AND ($2::integer IS NULL OR r.state_id = $2::integer)
           AND r.period = $3
           AND r.status NOT IN ('rejected','archived')
           AND r.migration_is_duplicate = FALSE
         LIMIT 1`,
        [
          Number(activityId),
          stateId ? Number(stateId) : null,
          String(period),
        ],
      );
      if (rows.length === 0) {
        return c.json({ matchType: "none" });
      }
      return c.json({ matchType: "exact", existingReport: rows[0] });
    }

    if (qReportType === "program_state") {
      const isFullAccessRole =
        user?.role === "program_manager" ||
        user?.role === "super_admin";
      const effectiveStateId: number | null = isFullAccessRole
        ? (stateId ? Number(stateId) : null)
        : (user?.stateId ?? null);

      if (effectiveStateId === null || Number.isNaN(effectiveStateId)) {
        return c.json({ matchType: "none" });
      }

      const freq = String(frequency);
      const periodStr = String(period);

      if (freq === "on_demand") {
        return c.json({ matchType: "none" });
      }

      let sprSql: string | null = null;
      let sprParams: unknown[] = [];
      if (freq === "monthly") {
        const m = periodStr.match(/^(\d{4})-(\d{1,2})$/);
        if (m) {
          sprSql = `SELECT id, title, period, status FROM reports
                    WHERE report_type = 'program_state'
                      AND state_id = $1 AND kind = 'monthly'
                      AND reporting_year = $2 AND reporting_month = $3
                      AND status NOT IN ('rejected','archived')
                      AND migration_is_duplicate = FALSE
                    LIMIT 1`;
          sprParams = [effectiveStateId, Number(m[1]), Number(m[2])];
        }
      } else if (freq === "quarterly") {
        const m = periodStr.match(/^(\d{4})-Q(\d)$/);
        if (m) {
          sprSql = `SELECT id, title, period, status FROM reports
                    WHERE report_type = 'program_state'
                      AND state_id = $1 AND kind = 'quarterly'
                      AND reporting_year = $2 AND quarter = $3
                      AND status NOT IN ('rejected','archived')
                      AND migration_is_duplicate = FALSE
                    LIMIT 1`;
          sprParams = [effectiveStateId, Number(m[1]), Number(m[2])];
        }
      } else if (freq === "annual") {
        const m = periodStr.match(/^(\d{4})$/);
        if (m) {
          sprSql = `SELECT id, title, period, status FROM reports
                    WHERE report_type = 'program_state'
                      AND state_id = $1 AND kind = 'annual'
                      AND reporting_year = $2
                      AND status NOT IN ('rejected','archived')
                      AND migration_is_duplicate = FALSE
                    LIMIT 1`;
          sprParams = [effectiveStateId, Number(m[1])];
        }
      }
      if (!sprSql) {
        return c.json({ error: "invalid_period_for_frequency" }, 400);
      }

      const { rows: sprRows } = await db.query<{ id: number; title: string; period: string; status: string }>(
        sprSql,
        sprParams,
      );
      if (sprRows.length === 0) {
        return c.json({ matchType: "none" });
      }
      return c.json({ matchType: "exact", existingReport: sprRows[0] });
    }

    if (!projectId) {
      return c.json({ error: "projectId is required for project duplicate-check" }, 400);
    }
    const isDupHq = dupLocationType === "hq";
    let dupRows: Array<{ id: number; title: string; period: string; status: string }>;
    if (isDupHq) {
      const { rows } = await db.query<{ id: number; title: string; period: string; status: string }>(
        `SELECT r.id, r.title, r.period, r.status
         FROM reports r
         WHERE r.report_type = 'project'
           AND r.project_id = $1
           AND r.state_id IS NULL
           AND r.location_type = 'hq'
           AND r.kind = $2
           AND r.period = $3
           AND r.status NOT IN ('rejected','archived')
           AND r.migration_is_duplicate = FALSE
         LIMIT 1`,
        [Number(projectId), String(frequency), String(period)],
      );
      dupRows = rows;
    } else {
      const { rows } = await db.query<{ id: number; title: string; period: string; status: string }>(
        `SELECT r.id, r.title, r.period, r.status
         FROM reports r
         WHERE r.report_type = 'project'
           AND r.project_id = $1
           AND ($2::integer IS NULL OR r.state_id = $2::integer)
           AND r.kind = $3
           AND r.period = $4
           AND r.status NOT IN ('rejected','archived')
           AND r.migration_is_duplicate = FALSE
         LIMIT 1`,
        [
          Number(projectId),
          stateId ? Number(stateId) : null,
          String(frequency),
          String(period),
        ],
      );
      dupRows = rows;
    }
    if (dupRows.length === 0) {
      return c.json({ matchType: "none" });
    }
    return c.json({ matchType: "exact", existingReport: dupRows[0] });
  } finally {
    close();
  }
});

// ---------------------------------------------------------------------------
// GET /reports/:reportId
// ---------------------------------------------------------------------------

reportsRoutes.get("/reports/:reportId", requirePerm("reports.view"), async (c) => {
  const user = c.get("currentUser");
  const { db, close } = openDb(c);
  try {
    const reportId = Number(c.req.param("reportId"));
    if (isNaN(reportId)) {
      return c.json({ error: "invalid report id" }, 400);
    }
    const sector = await getReportSectorForAuth(db, reportId);
    if (sector === undefined) {
      return c.json({ error: "report not found" }, 404);
    }
    // State scope enforcement for state roles — knowing a report ID must not bypass list RBAC.
    const isStateRole =
      user?.role === "state_program_officer" ||
      user?.role === "state_office_manager";
    if (isStateRole) {
      if (!user?.stateId) {
        return c.json({ error: "state_scope_forbidden" }, 403);
      }
      const stateCheck = await db.query<{ state_id: number | null; project_id: number | null }>(
        `SELECT state_id, project_id FROM reports WHERE id = $1`,
        [reportId],
      );
      if (
        stateCheck.rows.length > 0 &&
        stateCheck.rows[0].state_id !== user.stateId
      ) {
        return c.json({ error: "state_scope_forbidden" }, 403);
      }
      // SPOs are additionally clamped to their assigned projects — a guessed
      // report ID must not expose an unassigned project's report even within
      // their own state.
      if (
        user?.role === "state_program_officer" &&
        stateCheck.rows.length > 0 &&
        stateCheck.rows[0].project_id !== null
      ) {
        const asg = await db.query<{ project_id: number }>(
          `SELECT DISTINCT project_id FROM project_assignments WHERE user_id = $1`,
          [user.id],
        );
        const assigned = new Set(asg.rows.map((r) => r.project_id));
        if (!assigned.has(stateCheck.rows[0].project_id)) {
          return c.json({ error: "state_scope_forbidden" }, 403);
        }
      }
    }
    const guard = assertSectorAllowed(user, sector);
    if (!guard.ok) {
      return c.json(guard.body, guard.status as 403);
    }
    const result = await db.query<Record<string, unknown>>(`${reportSelect} WHERE r.id = $1`, [reportId]);
    if (result.rows.length === 0) {
      return c.json({ error: "report not found" }, 404);
    }
    const enriched = await withHistory(db, result.rows);
    return c.json(enriched[0]);
  } finally {
    close();
  }
});

// ---------------------------------------------------------------------------
// GET /reports/:reportId/aggregates — Auto-pulled project data
// ---------------------------------------------------------------------------

reportsRoutes.get("/reports/:reportId/aggregates", requirePerm("reports.view"), async (c) => {
  const user = c.get("currentUser");
  const { db, close } = openDb(c);
  try {
    const reportId = Number(c.req.param("reportId"));
    if (isNaN(reportId)) {
      return c.json({ error: "invalid report id" }, 400);
    }

    const sector = await getReportSectorForAuth(db, reportId);
    if (sector === undefined) {
      return c.json({ error: "report not found" }, 404);
    }
    const sectorGuard = assertSectorAllowed(user, sector);
    if (!sectorGuard.ok) {
      return c.json(sectorGuard.body, sectorGuard.status as 403);
    }
    const isStateRole =
      user?.role === "state_program_officer" ||
      user?.role === "state_office_manager";
    if (isStateRole && user?.stateId) {
      const stateCheck = await db.query<{ state_id: number | null }>(
        `SELECT state_id FROM reports WHERE id = $1`,
        [reportId],
      );
      if (stateCheck.rows.length > 0 && stateCheck.rows[0].state_id !== user.stateId) {
        return c.json({ error: "state_scope_forbidden" }, 403);
      }
    }

    const reportRow = await db.query<{ projectId: number | null }>(
      `SELECT project_id AS "projectId" FROM reports WHERE id = $1`,
      [reportId],
    );
    if (reportRow.rows.length === 0) {
      return c.json({ error: "report not found" }, 404);
    }
    const projectId = reportRow.rows[0].projectId;
    if (!projectId) {
      return c.json({ error: "no_project_linked" }, 404);
    }

    const [bRow, budgetRow, actRow, indRow, riskRow] = await Promise.all([
      // REPORTS-AGGREGATES-FIX (beneficiaries half): the `beneficiaries` table is an
      // individual-level registry with no beneficiaries_male/female/boys/girls columns —
      // those columns exist only on `projects` (one row per project, already aggregated),
      // the same source projects.ts reads everywhere else. Every real call to this
      // endpoint for a project-linked report used to throw "column ... does not exist".
      db.query<{ male: number; female: number; boys: number; girls: number }>(
        `SELECT
           COALESCE(beneficiaries_male,0)   AS male,
           COALESCE(beneficiaries_female,0) AS female,
           COALESCE(beneficiaries_boys,0)   AS boys,
           COALESCE(beneficiaries_girls,0)  AS girls
         FROM projects WHERE id = $1`,
        [projectId],
      ),
      // `project_budgets` never existed in the tracked schema — activities.budget_planned /
      // budget_spent is the canonical project-budget source used everywhere else.
      db.query<{ planned: string; actual: string }>(
        `SELECT
           COALESCE(SUM(budget_planned),0)   AS planned,
           COALESCE(SUM(budget_spent),0)     AS actual
         FROM activities WHERE project_id = $1`,
        [projectId],
      ),
      db.query<Record<string, unknown>>(
        `SELECT a.id, a.title, a.status,
                a.planned_start AS "startDate", a.planned_end AS "endDate"
         FROM activities a WHERE a.project_id = $1
         ORDER BY a.id LIMIT 50`,
        [projectId],
      ),
      // REPORTS-AGGREGATES-FIX (indicators half): `indicators` has no `name` column
      // (only `title`) — COALESCE(i.title, i.name) still fails at parse time
      // regardless of matched rows, so this query 500'd on every real call.
      db.query<{ id: number; name: string; target: string; achieved: string; unit: string }>(
        `SELECT i.id, i.title AS name,
                i.target, COALESCE(i.achieved,0) AS achieved, i.unit
         FROM indicators i WHERE i.project_id = $1 LIMIT 30`,
        [projectId],
      ),
      db.query<Record<string, unknown>>(
        `SELECT id, title, severity, status FROM risks
         WHERE project_id = $1 AND status NOT IN ('resolved','closed')
         ORDER BY id LIMIT 20`,
        [projectId],
      ),
    ]);

    const b = bRow.rows[0] ?? { male: 0, female: 0, boys: 0, girls: 0 };
    const bg = budgetRow.rows[0];
    const planned = Number(bg.planned);
    const actual = Number(bg.actual);
    const pRow = await db.query<{ title: string }>(
      `SELECT title FROM projects WHERE id = $1`,
      [projectId],
    );
    return c.json({
      projectId,
      projectTitle: pRow.rows[0]?.title ?? "",
      beneficiaries: {
        male: Number(b.male),
        female: Number(b.female),
        boys: Number(b.boys),
        girls: Number(b.girls),
        total:
          Number(b.male) + Number(b.female) + Number(b.boys) + Number(b.girls),
      },
      budget: {
        planned,
        actual,
        remaining: planned - actual,
        // Null (not 0) when there's no valid planned amount to divide by.
        burnRatePct: planned > 0 ? Math.round((actual / planned) * 100) : null,
      },
      activities: actRow.rows,
      indicators: indRow.rows.map((r) => ({
        ...r,
        target: Number(r.target),
        achieved: Number(r.achieved),
      })),
      risks: riskRow.rows,
    });
  } finally {
    close();
  }
});
