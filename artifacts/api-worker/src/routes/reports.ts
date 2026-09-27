import { Hono, type MiddlewareHandler } from "hono";
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

/**
 * Outer gate: reports.create OR the narrow SOM fallback permission
 * reports.program_state.create (SPR-003/004). The type-specific author gates
 * inside the handler decide who may create each report type — the narrow
 * permission grants nothing beyond reaching the program_state gate (all other
 * type gates exclude SOM explicitly).
 */
const requireReportsCreateOrProgramStateCreate: MiddlewareHandler<{ Bindings: Bindings; Variables: Variables }> = async (c, next) => {
  const user = c.get("currentUser");
  if (user && hasPerm(permissionsFor(user), "reports.program_state.create")) {
    return next();
  }
  return requirePerm("reports.create")(c, next);
};

/**
 * Outer gate for draft edits / workflow transitions: reports.update OR the
 * narrow SOM fallback permission. SOM may only reach the handlers to work on
 * their own fallback-authored program_state reports — the in-handler guards
 * (SOM defence in PATCH; scoped submit allowance in transitions) enforce
 * that. All other roles keep exactly the requirePerm("reports.update") gate.
 */
const requireReportsUpdateOrSomSprAuthor: MiddlewareHandler<{ Bindings: Bindings; Variables: Variables }> = async (c, next) => {
  const user = c.get("currentUser");
  if (
    user &&
    user.role === "state_office_manager" &&
    hasPerm(permissionsFor(user), "reports.program_state.create")
  ) {
    return next();
  }
  return requirePerm("reports.update")(c, next);
};

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

// ---------------------------------------------------------------------------
// POST /reports — Create a report
// ---------------------------------------------------------------------------

reportsRoutes.post("/reports", requireReportsCreateOrProgramStateCreate, async (c) => {
  const user = c.get("currentUser");
  const { db, close } = openDb(c);
  try {
    if (!user) return c.json({ error: "no current user" }, 401);

    const rawBody = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

    // Extract activityName from the raw body BEFORE Zod parse strips unknown fields.
    // The Zod schema does not include activityName (it is extra metadata for activity
    // reports); reading it here ensures the required-field check and INSERT both see it.
    const rawActivityName = typeof rawBody.activityName === "string"
      ? (rawBody.activityName as string).trim()
      : null;

    const rawLocationType = rawBody.locationType === "hq"
      ? "hq"
      : rawBody.locationType === "state"
        ? "state"
        : null;

    // Activity Reports: kind is not user-required — the UI hides the frequency selector.
    // Apply the compatibility default BEFORE Zod parsing so the required-field check in the
    // generated schema is satisfied. The value is an internal infrastructure default and is
    // never shown to users as a user-selected frequency.
    if (rawBody.reportType === "activity" && !rawBody.kind) {
      rawBody.kind = "monthly";
    }

    const body = CreateReportBody.parse(rawBody);

    // ── Validate top-level beneficiary counts are non-negative integers ────────
    {
      const benFields = ["beneficiariesMale", "beneficiariesFemale", "beneficiariesBoys", "beneficiariesGirls"] as const;
      for (const f of benFields) {
        const v = body[f];
        if (v !== undefined && v !== null && (!Number.isInteger(v) || v < 0)) {
          return c.json({ error: "validation_error", message: `${f} must be a non-negative whole number` }, 400);
        }
      }
    }
    // ── Validate per-activity fields ──────────────────────────────────────────
    if (body.activities) {
      for (const act of body.activities) {
        const pct = act["percent"] !== undefined ? Number(act["percent"]) : undefined;
        if (pct !== undefined && (!Number.isFinite(pct) || !Number.isInteger(pct) || pct < 0 || pct > 100)) {
          return c.json({ error: "validation_error", message: "Activity implementation % must be a whole number between 0 and 100" }, 400);
        }
        for (const bf of ["beneficiariesMen", "beneficiariesWomen", "beneficiariesBoys", "beneficiariesGirls"]) {
          const bv = act[bf];
          if (bv !== undefined && bv !== null) {
            const num = Number(bv);
            if (!Number.isFinite(num) || !Number.isInteger(num) || num < 0) {
              return c.json({ error: "validation_error", message: `Activity ${bf} must be a non-negative whole number` }, 400);
            }
          }
        }
      }
    }

    // ── Validate canonical Report Type ────────────────────────────────────────
    if (!body.reportType || !isCanonicalReportType(body.reportType)) {
      return c.json({
        error: "invalid_report_type",
        message: `reportType must be one of: ${CANONICAL_REPORT_TYPES.join(", ")}`,
      }, 400);
    }
    const reportType = body.reportType;

    // ── PERM-01: Activity Report author role enforcement ──────────────────────
    // Activity Reports may only be authored by State Programme Officers,
    // Technical Coordinators, super_admin, and (Full Operational Access) PM.
    // SPC is NOT an Activity Report author per the approved business model.
    if (reportType === "activity") {
      const ACTIVITY_AUTHOR_ROLES = [
        "state_program_officer",
        "technical_coordinator",
        "super_admin",
        "program_manager",
      ];
      const isSuperAdminCheck = permissionsFor(user).includes("*");
      if (!isSuperAdminCheck && !ACTIVITY_AUTHOR_ROLES.includes(user.role)) {
        return c.json({ error: "activity_report_author_role_required" }, 403);
      }
    }

    // ── PERM-02: Project Monthly Report author role enforcement ──────────────
    // PMRs may only be authored by State Programme Officers, Technical
    // Coordinators, super_admin, and (Full Operational Access) PM.
    // SOM, SPC, and ED are NOT PMR authors per the approved business model.
    if (reportType === "project") {
      const PMR_AUTHOR_ROLES = [
        "state_program_officer",
        "technical_coordinator",
        "super_admin",
        "program_manager",
      ];
      const isSuperAdminCheck = permissionsFor(user).includes("*");
      if (!isSuperAdminCheck && !PMR_AUTHOR_ROLES.includes(user.role)) {
        return c.json({ error: "project_report_author_role_required" }, 403);
      }
    }

    // ── PERM-03 / HQSR-001: HQ Sector Report author role enforcement ─────────
    // HQ Sector Reports may only be authored by:
    //   - Technical Coordinators, for their assigned sector(s) only (exact match)
    //   - super_admin (emergency authoring)
    //   - Senior Program Coordinator as a bounded fallback ONLY when no active
    //     TC covers the requested sector (server-verified vacancy check).
    //     (HQSR-BD-1 / HQSR-BD-6): SPC fallback is ENABLED — SPC-authored HQ
    //     Sector Reports are coordination-reviewed by PM (who holds
    //     reports.approve.coordination); SPC self-review remains blocked by the
    //     universal self-review guard in the transitions handler.
    //   - Program Manager: Full Operational Access override (Task #373).
    //     Explicit canonical sector required; sector validated server-side.
    // SPO, SOM, ED, and Viewer are explicitly NOT HQ Sector authors.
    if (reportType === "hq_sector") {
      const isSuperAdminCheck = permissionsFor(user).includes("*");
      // Every HQ Sector Report — regardless of author role, including the
      // super_admin emergency path — requires a non-blank canonical sector.
      const requestedSector = typeof body.sector === "string" ? body.sector.trim() : "";
      if (!requestedSector) {
        return c.json({ error: "sector is required for hq_sector reports" }, 400);
      }
      if (!VALID_SECTOR_SET.has(requestedSector)) {
        return c.json({ error: "invalid_sector" }, 400);
      }
      body.sector = requestedSector; // persist the normalised (trimmed) canonical value
      if (!isSuperAdminCheck && user.role !== "super_admin") {
        if (user.role === "technical_coordinator") {
          const assignedSectors = tcSectorRestriction(user) ?? [];
          // Exact-segment matching only; a TC with no assigned sectors fails closed.
          if (assignedSectors.length === 0 || !assignedSectors.includes(requestedSector)) {
            return c.json({
              error: "sector_scope_forbidden",
              message: "The requested sector is outside your assigned Main Sectors.",
            }, 403);
          }
        } else if (user.role === "senior_program_coordinator") {
          // Server-side vacancy check — never trust frontend claims of TC absence.
          const tcAvailable = await hasActiveTcForSector(db, requestedSector);
          if (tcAvailable) {
            return c.json({
              error: "hq_sector_tc_available",
              message:
                "An active Technical Coordinator is assigned to this sector; they are the designated HQ Sector Report author.",
            }, 403);
          }
          // SPC fallback (HQSR-BD-1 / HQSR-BD-6): vacancy confirmed — allow creation.
          // Falls through to normal report creation.
        } else if (user.role === "program_manager") {
          // Full Operational Access override (Task #373). Falls through.
        } else {
          return c.json({ error: "hq_sector_author_role_required" }, 403);
        }
      }
      // ── HQSR-004: Location integrity ─────────────────────────────────────
      // Canonically an HQ Sector Report has NO State or Project linkage:
      // state_id and project_id must both be NULL. Defence in depth: the
      // INSERT below also forces NULL, and a DB CHECK constraint backs this.
      if (body.stateId != null || body.projectId != null) {
        return c.json({
          error: "hq_sector_location_invalid",
          message:
            "HQ Sector Reports must not carry a State or Project linkage (state_id and project_id must be null).",
          fields: [
            ...(body.stateId != null ? ["stateId"] : []),
            ...(body.projectId != null ? ["projectId"] : []),
          ],
        }, 422);
      }
    }

    // ── SPR-003/004: State Programme Report author role enforcement ──────────
    // Approved governance (SPR-BD-2):
    //   - SPO: primary author — state profile-clamped (SPR-002 clamp below).
    //   - SOM: bounded fallback ONLY when no active SPO covers their own state
    //     (server-verified vacancy check — never trust frontend claims).
    //   - super_admin: emergency authoring — must supply an explicit stateId
    //     that exists in the canonical states table (NOT profile-clamped).
    //   - TC, SPC, PM, ED, Viewer: NOT authors. Generic reports.create alone is
    //     insufficient for program_state creation.
    if (reportType === "program_state") {
      const isSuperAdminCheck = permissionsFor(user).includes("*");
      if (user.role === "state_program_officer") {
        // Primary author — pass through. Null-state fail-closed (state_scope_required)
        // and the profile stateId clamp are enforced below (SPR-002).
      } else if (user.role === "state_office_manager") {
        const somStateId = user.stateId ?? null;
        if (somStateId == null) {
          return c.json({
            error: "state_scope_required",
            message: "Your account has no assigned State; State Programme Reports cannot be created.",
          }, 403);
        }
        const spoAvailable = await hasActiveSpoForState(db, somStateId);
        if (spoAvailable) {
          return c.json({
            error: "program_state_spo_available",
            message:
              "A State Programme Officer is assigned to your state. State Programme Report authoring is reserved for the SPO.",
          }, 403);
        }
        // Vacancy confirmed — SOM may proceed; the profile stateId clamp below applies.
      } else if (user.role === "super_admin" || isSuperAdminCheck) {
        // Emergency path: explicit canonical state is mandatory.
        if (body.stateId == null) {
          return c.json({
            error: "state_required_for_super_admin_spr",
            message: "An explicit stateId is required when a super administrator creates a State Programme Report.",
          }, 400);
        }
        const stateExists = await db.query(`SELECT 1 FROM states WHERE id = $1 LIMIT 1`, [body.stateId]);
        if (stateExists.rows.length === 0) {
          return c.json({ error: "invalid_state_id" }, 400);
        }
        // super_admin keeps body.stateId (not a state role — no clamp below).
      } else if (user.role === "program_manager") {
        // Full Operational Access override (Task #373). PM has no profile state,
        // so an explicit canonical stateId is mandatory (same as super_admin).
        if (body.stateId == null) {
          return c.json({
            error: "state_required_for_program_manager_spr",
            message:
              "An explicit stateId is required when a Program Manager creates a State Programme Report.",
          }, 400);
        }
        const pmStateExists = await db.query(`SELECT 1 FROM states WHERE id = $1 LIMIT 1`, [body.stateId]);
        if (pmStateExists.rows.length === 0) {
          return c.json({ error: "invalid_state_id" }, 400);
        }
        // PM keeps body.stateId (not a state role — no clamp below).
      } else {
        return c.json({ error: "program_state_report_author_role_required" }, 403);
      }
    }

    // ── Validate canonical Reporting Frequency (kind) ─────────────────────────
    if (reportType === "activity") {
      // kind is not user-required for Activity Reports. Apply an internal
      // compatibility default ("monthly") when absent; validate the value
      // when present so the stored value remains canonical.
      if (!body.kind) {
        body.kind = "monthly";
      } else if (!isCanonicalFrequency(body.kind)) {
        return c.json({
          error: "invalid_frequency",
          message: `kind must be one of: ${CANONICAL_FREQUENCIES.join(", ")}`,
        }, 400);
      }
    } else {
      if (!body.kind || !isCanonicalFrequency(body.kind)) {
        return c.json({
          error: "invalid_frequency",
          message: `kind (reporting frequency) must be one of: ${CANONICAL_FREQUENCIES.join(", ")}`,
        }, 400);
      }
    }

    // ── Validate period fields per frequency ─────────────────────────────────
    if (reportType === "activity") {
      if (body.kind !== "on_demand" && (!body.reportingYear || !body.reportingMonth)) {
        return c.json({ error: "activity_requires_year_and_month" }, 400);
      }
    } else {
      if (body.kind === "monthly") {
        if (!body.reportingYear || !body.reportingMonth) {
          return c.json({ error: "monthly_requires_year_and_month" }, 400);
        }
      } else if (body.kind === "quarterly") {
        if (!body.reportingYear || !body.quarter) {
          return c.json({ error: "quarterly_requires_year_and_quarter" }, 400);
        }
      } else if (body.kind === "annual") {
        if (!body.reportingYear) {
          return c.json({ error: "annual_requires_year" }, 400);
        }
      }
    }

    // ── Validate type-specific required fields ────────────────────────────────
    if (reportType === "project" && body.projectId == null) {
      return c.json({ error: "project_report_requires_project_id" }, 400);
    }
    if (
      (reportType === "project" || reportType === "program_state") &&
      body.stateId == null &&
      // HQ project reports: stateId is legitimately null — exempt from state requirement
      !(reportType === "project" && rawLocationType === "hq") &&
      user.role !== "state_program_officer" &&
      user.role !== "state_office_manager"
    ) {
      return c.json({ error: `stateId is required for ${reportType} reports` }, 400);
    }
    // Fail closed: a state-scoped role (SPO/SOM) with no assigned state must not
    // create a State Programme Report.
    if (
      reportType === "program_state" &&
      (user.role === "state_program_officer" || user.role === "state_office_manager") &&
      user.stateId == null
    ) {
      return c.json({
        error: "state_scope_required",
        message: "Your account has no assigned State; State Programme Reports cannot be created.",
      }, 403);
    }
    if (reportType === "hq_sector" && !body.sector) {
      return c.json({ error: "sector is required for hq_sector reports" }, 400);
    }
    // Activity reports require a non-blank activityName in all link modes.
    if (reportType === "activity" && !rawActivityName) {
      return c.json({
        error: "activityName_required",
        message: "activityName is required for activity reports and must not be blank.",
      }, 400);
    }

    // ── Activity Report validation — source-aware (project-linked vs. standalone) ──
    const activityId = Number((body as Record<string, unknown>).activityId) || null;
    const tcSectors = tcSectorRestriction(user);
    let projectPrimarySector: string | null = null;
    // Migration 070 (REPORTS-CURRENCY): resolved the same way as projectPrimarySector —
    // project-linked reports use the project's currency; standalone activities use their
    // own. Only Project and Activity Reports have an unambiguous single source; other
    // report types have no natural currency source and are left null.
    let effectiveCurrency: string | null = null;
    // Holds the resolved stateId for activity reports (used in effectiveStateId below).
    let activityResolvedStateId: number | null | undefined = undefined;
    // Holds the resolved projectId for activity reports (null for standalone).
    let activityResolvedProjectId: number | null | undefined = undefined;

    if (reportType === "activity" && activityId) {
      // Look up the activity — must exist regardless of project linkage.
      const actLookup = await db.query<{
        id: number;
        projectId: number | null;
        sector: string | null;
        stateId: number | null;
        currency: string | null;
      }>(
        `SELECT id, project_id AS "projectId", sector, state_id AS "stateId", currency FROM activities WHERE id = $1`,
        [activityId],
      );
      if (actLookup.rows.length === 0) {
        return c.json({ error: "activity_not_found", message: "The selected Activity does not exist." }, 400);
      }
      const activity = actLookup.rows[0];

      if (activity.projectId !== null) {
        // ── PROJECT-LINKED path ────────────────────────────────────────────────
        if (body.projectId != null && Number(body.projectId) !== activity.projectId) {
          return c.json({
            error: "activity_project_mismatch",
            message: "The selected Activity does not belong to the selected Project.",
          }, 400);
        }
        activityResolvedProjectId = activity.projectId;

        // (1) Project must exist
        const actProjRow = await db.query<{ id: number; sector: string | null; currency: string | null }>(
          `SELECT id, sector, currency FROM projects WHERE id = $1`,
          [activity.projectId],
        );
        if (actProjRow.rows.length === 0) {
          return c.json({ error: "project_not_found", message: "Activity's project does not exist." }, 400);
        }
        projectPrimarySector = actProjRow.rows[0].sector ?? null;
        effectiveCurrency = actProjRow.rows[0].currency ?? null;

        // (2) TC sector check via Project Primary Sector — fail-closed.
        if (tcSectors) {
          if (!projectPrimarySector) {
            return c.json({
              error: "tc_sector_validation_failed",
              message: "Project has no primary sector. Cannot validate Technical Coordinator scope.",
            }, 403);
          }
          if (!tcSectors.includes(projectPrimarySector)) {
            return c.json({
              error: "sector_scope_forbidden",
              message: "Project primary sector is outside your assigned Main Sectors.",
            }, 403);
          }
        }

        // (3) Determine the effective stateId (SPO: clamped to assigned state)
        const isStateRoleAct =
          user.role === "state_program_officer" ||
          user.role === "state_office_manager";
        const stateIdForAct: number | null = isStateRoleAct
          ? (user.stateId ?? null)
          : (body.stateId != null ? Number(body.stateId) : null);

        if (!stateIdForAct) {
          return c.json({ error: "stateId is required for activity reports" }, 400);
        }

        // (4) Project→State link — selected state must be linked to the project
        const actStateLink = await db.query<{ project_id: number }>(
          `SELECT project_id FROM project_states WHERE project_id = $1 AND state_id = $2`,
          [activity.projectId, stateIdForAct],
        );
        if (actStateLink.rows.length === 0) {
          if (user.role === "state_program_officer") {
            return c.json({
              error: "project_state_mismatch",
              message: "Selected project is not linked to your assigned state.",
            }, 403);
          }
          return c.json({
            error: "state_not_linked_to_project",
            message: "Selected state is not linked to the selected project.",
          }, 400);
        }

        // (5) Activity→State: if the Activity has an authoritative state_id, report state must match.
        if (activity.stateId !== null && activity.stateId !== stateIdForAct) {
          return c.json({
            error: "activity_state_mismatch",
            message: "The selected Activity is assigned to a different State than the selected Report State.",
          }, 400);
        }

        activityResolvedStateId = stateIdForAct;

      } else {
        // ── STANDALONE path ────────────────────────────────────────────────────
        if (body.projectId != null) {
          return c.json({
            error: "standalone_activity_cannot_have_project_id",
            message: "This is a standalone activity (no parent project). Do not supply a projectId.",
          }, 400);
        }
        activityResolvedProjectId = null;
        effectiveCurrency = activity.currency ?? null;

        // TC sector check via activity.sector — fail-closed.
        const activitySector = activity.sector ?? null;
        if (tcSectors) {
          if (!activitySector) {
            return c.json({
              error: "tc_sector_validation_failed",
              message: "Standalone activity has no sector. Cannot validate Technical Coordinator scope.",
            }, 403);
          }
          if (!tcSectors.includes(activitySector)) {
            return c.json({
              error: "sector_scope_forbidden",
              message: "Activity sector is outside your assigned Main Sectors.",
            }, 403);
          }
        }

        // State scope: SPO and SOM must not create reports for activities assigned to a different state.
        const isStateRoleStandalone =
          user.role === "state_program_officer" ||
          user.role === "state_office_manager";
        if (isStateRoleStandalone) {
          const stateRoleStateId = user.stateId ?? null;
          if (stateRoleStateId !== null && activity.stateId !== null && activity.stateId !== stateRoleStateId) {
            return c.json({
              error: "activity_state_scope_forbidden",
              message: "This standalone activity is assigned to a different state than your assigned state.",
            }, 403);
          }
        }

        // effectiveSector for standalone = activity.sector
        projectPrimarySector = activitySector;

        // Resolve effective stateId for standalone — state integrity rules:
        if (activity.stateId !== null) {
          if (body.stateId != null && Number(body.stateId) !== activity.stateId) {
            return c.json({
              error: "standalone_state_mismatch",
              message: "The supplied stateId does not match the standalone activity's assigned state.",
            }, 400);
          }
          activityResolvedStateId = activity.stateId;
        } else {
          activityResolvedStateId = isStateRoleStandalone
            ? (user.stateId ?? null)
            : (body.stateId != null ? Number(body.stateId) : null);
        }
      }
    }

    // ── Activity Report: Project-linked mode (activityId=null, projectId supplied) ──
    if (reportType === "activity" && !activityId && body.projectId != null && Number(body.projectId) > 0) {
      const actProjRow = await db.query<{ id: number; sector: string | null; currency: string | null }>(
        `SELECT id, sector, currency FROM projects WHERE id = $1`,
        [Number(body.projectId)],
      );
      if (actProjRow.rows.length === 0) {
        return c.json({ error: "project_not_found", message: "Selected project does not exist." }, 400);
      }
      projectPrimarySector = actProjRow.rows[0].sector ?? null;
      effectiveCurrency = actProjRow.rows[0].currency ?? null;

      if (tcSectors) {
        if (!projectPrimarySector) {
          return c.json({ error: "tc_sector_validation_failed", message: "Project has no primary sector. Cannot validate Technical Coordinator scope." }, 403);
        }
        if (!tcSectors.includes(projectPrimarySector)) {
          return c.json({ error: "sector_scope_forbidden", message: "Project primary sector is outside your assigned Main Sectors." }, 403);
        }
      }

      const isStateRoleActProj =
        user.role === "state_program_officer" ||
        user.role === "state_office_manager";
      const stateIdForActProj = isStateRoleActProj
        ? (user.stateId ?? null)
        : (body.stateId != null ? Number(body.stateId) : null);

      if (stateIdForActProj) {
        const projStateLink = await db.query<{ project_id: number }>(
          `SELECT project_id FROM project_states WHERE project_id = $1 AND state_id = $2`,
          [Number(body.projectId), stateIdForActProj],
        );
        if (projStateLink.rows.length === 0) {
          if (user.role === "state_program_officer") {
            return c.json({ error: "project_state_mismatch", message: "Selected project is not linked to your assigned state." }, 403);
          }
          return c.json({ error: "state_not_linked_to_project", message: "Selected state is not linked to the selected project." }, 400);
        }
      }

      activityResolvedProjectId = Number(body.projectId);
      activityResolvedStateId = stateIdForActProj;
    }

    // Guard: locationType=hq is only valid for activity and project reports.
    if (rawLocationType === "hq" && reportType !== "activity" && reportType !== "project") {
      return c.json({ error: "invalid_location_combination", message: "locationType=hq is only valid for activity and project reports." }, 400);
    }
    // Guard: locationType=hq cannot be combined with an explicit stateId.
    if (rawLocationType === "hq" && body.stateId != null) {
      return c.json({ error: "invalid_location_combination", message: "locationType=hq cannot be combined with a stateId." }, 400);
    }

    // ── Activity Report: HQ Standalone mode ──
    if (reportType === "activity" && !activityId && (body.projectId == null || Number(body.projectId) === 0) && rawLocationType === "hq") {
      if (user.role === "state_program_officer" || user.role === "state_office_manager") {
        return c.json({ error: "hq_forbidden", message: "State-scoped users cannot create HQ activity reports." }, 403);
      }
      activityResolvedStateId = null;
      activityResolvedProjectId = null;

      const standaloneBodySector = (body.sector ?? null) as string | null;
      if (tcSectors) {
        if (!standaloneBodySector) {
          return c.json({ error: "sector_required", message: "Sector is required for standalone activity reports." }, 400);
        }
        if (!VALID_SECTOR_SET.has(standaloneBodySector)) return c.json({ error: "invalid_sector" }, 400);
        if (!tcSectors.includes(standaloneBodySector)) {
          return c.json({ error: "sector_scope_forbidden", message: "The requested sector is outside your assigned Main Sectors." }, 403);
        }
        projectPrimarySector = standaloneBodySector;
      } else {
        const userSectorAssigned = user.sector ?? null;
        if (userSectorAssigned) {
          if (!standaloneBodySector) {
            return c.json({ error: "sector_required", message: "Sector is required for standalone activity reports." }, 400);
          }
          if (standaloneBodySector !== userSectorAssigned) {
            return c.json({ error: "sector_scope_forbidden", message: "The requested sector does not match your assigned sector." }, 403);
          }
          projectPrimarySector = standaloneBodySector;
        } else {
          projectPrimarySector = standaloneBodySector;
        }
      }
    }

    // ── Activity Report: Non-HQ Standalone mode ──
    if (reportType === "activity" && !activityId && (body.projectId == null || Number(body.projectId) === 0) && rawLocationType !== "hq") {
      const isStateRoleSA =
        user.role === "state_program_officer" ||
        user.role === "state_office_manager";
      activityResolvedStateId = isStateRoleSA
        ? (user.stateId ?? null)
        : (body.stateId != null ? Number(body.stateId) : null);
      activityResolvedProjectId = null;

      const standaloneBodySector = (body.sector ?? null) as string | null;

      if (tcSectors) {
        if (!standaloneBodySector) {
          return c.json({
            error: "sector_required",
            message: "Sector is required for standalone activity reports.",
          }, 400);
        }
        if (!VALID_SECTOR_SET.has(standaloneBodySector)) {
          return c.json({ error: "invalid_sector" }, 400);
        }
        if (!tcSectors.includes(standaloneBodySector)) {
          return c.json({
            error: "sector_scope_forbidden",
            message: "The requested sector is outside your assigned Main Sectors.",
          }, 403);
        }
        projectPrimarySector = standaloneBodySector;
      } else {
        const userSectorAssigned = user.sector ?? null;
        if (userSectorAssigned) {
          if (!standaloneBodySector) {
            return c.json({
              error: "sector_required",
              message: "Sector is required for standalone activity reports.",
            }, 400);
          }
          if (standaloneBodySector !== userSectorAssigned) {
            return c.json({
              error: "sector_scope_forbidden",
              message: "The requested sector does not match your assigned sector.",
            }, 403);
          }
          projectPrimarySector = standaloneBodySector;
        } else {
          projectPrimarySector = standaloneBodySector;
        }
      }
    }

    if (reportType === "project" && body.projectId != null) {
      // Load the linked project and read its authoritative primary sector and management level.
      // Exclude soft-deleted projects (deleted_at IS NOT NULL).
      const projectRow = await db.query<{
        id: number; sector: string | null; managementLevel: string | null; hasHqOperations: boolean;
        reportingStartDate: string; reportingEndDate: string; currency: string | null;
      }>(
        `SELECT id, sector, management_level AS "managementLevel",
                has_hq_operations AS "hasHqOperations",
                reporting_start_date::text AS "reportingStartDate",
                reporting_end_date::text AS "reportingEndDate",
                currency
           FROM projects WHERE id = $1 AND deleted_at IS NULL`,
        [body.projectId],
      );
      if (projectRow.rows.length === 0) {
        return c.json({ error: "project_not_found", message: "Selected project does not exist or is no longer available." }, 400);
      }
      projectPrimarySector = projectRow.rows[0].sector ?? null;
      effectiveCurrency = projectRow.rows[0].currency ?? null;

      // ── HQ legitimacy check for project reports ──────────────────────────────
      if (rawLocationType === "hq") {
        if (
          user.role === "state_program_officer" ||
          user.role === "state_office_manager"
        ) {
          return c.json({
            error: "hq_forbidden",
            message: "State-scoped users cannot create HQ project reports.",
          }, 403);
        }
        // Deny unless the project explicitly declares HQ operational presence.
        if (!projectRow.rows[0].hasHqOperations) {
          return c.json({
            error: "hq_not_permitted_for_project",
            message: "This project does not have HQ as an Operational Location.",
          }, 400);
        }
        if (body.stateId != null) {
          return c.json({
            error: "invalid_location_combination",
            message: "locationType=hq cannot be combined with a stateId for project reports.",
          }, 400);
        }
      }

      // TC sector security: validate against Project Primary Sector regardless of body.sector.
      if (tcSectors) {
        if (!projectPrimarySector) {
          return c.json({
            error: "tc_sector_validation_failed",
            message: "Project has no primary sector. Cannot validate Technical Coordinator scope.",
          }, 403);
        }
        if (!tcSectors.includes(projectPrimarySector)) {
          return c.json({
            error: "sector_scope_forbidden",
            message: "Project primary sector is outside your assigned Main Sectors.",
          }, 403);
        }
      }

      // ── State / Project relationship validation ──────────────────────────────
      const isStateRole =
        user.role === "state_program_officer" ||
        user.role === "state_office_manager";
      const stateIdForValidation = isStateRole
        ? (user.stateId ?? null)
        : body.stateId ?? null;

      if (stateIdForValidation) {
        const projectStateLink = await db.query<{ project_id: number }>(
          `SELECT project_id FROM project_states WHERE project_id = $1 AND state_id = $2`,
          [body.projectId, stateIdForValidation],
        );
        if (projectStateLink.rows.length === 0) {
          if (user.role === "state_program_officer") {
            return c.json({
              error: "project_state_mismatch",
              message: "Selected project is not linked to your assigned state.",
            }, 403);
          }
          return c.json({
            error: "state_not_linked_to_project",
            message: "Selected state is not linked to the selected project.",
          }, 400);
        }
      }
      const coverage = projectRow.rows[0];
      if (
        body.kind === "monthly" &&
        body.reportingYear &&
        body.reportingMonth &&
        coverage.reportingStartDate &&
        coverage.reportingEndDate &&
        !projectCoverageOverlapsMonth(
          coverage.reportingStartDate,
          coverage.reportingEndDate,
          { year: body.reportingYear, month: body.reportingMonth },
        )
      ) {
        return c.json({
          error: "project_reporting_coverage_outside_period",
          message: "Monthly Project Reports must overlap the project's reporting coverage.",
        }, 422);
      }
    }

    // ── Legacy sector validation for non-project, non-activity types ──────────
    if (reportType !== "project" && reportType !== "activity" && tcSectors && body.sector && !VALID_SECTOR_SET.has(body.sector)) {
      return c.json({ error: "invalid_sector" }, 400);
    }
    if (reportType !== "project" && reportType !== "activity" && tcSectors && body.sector && !tcSectors.includes(body.sector)) {
      return c.json({ error: "sector_scope_forbidden" }, 403);
    }

    // ── State scoping for state roles ─────────────────────────────────────────
    const isStateRole =
      user.role === "state_program_officer" ||
      user.role === "state_office_manager";
    // HQSR-004: hq_sector reports NEVER carry a state linkage — force NULL.
    const effectiveStateId = reportType === "hq_sector"
      ? null
      : (reportType === "activity" && activityResolvedStateId !== undefined)
        ? activityResolvedStateId
        : (isStateRole ? (user.stateId ?? null) : body.stateId ?? null);
    if (effectiveStateId != null) {
      const activeState = await assertActiveState(db, Number(effectiveStateId));
      if (!activeState.ok) {
        return c.json({
          error: activeState.error,
          message: "New reports can only be created for an active State.",
        }, 422);
      }
    }

    // For Project and Activity Reports: use the project's (or activity's) authoritative sector.
    const effectiveSector = (reportType === "project" || reportType === "activity")
      ? (projectPrimarySector ?? body.sector ?? null)
      : (body.sector ?? null);

    // Compute the immutable workflow path from the author's role at creation time.
    const newWorkflowPath = (reportType === "project" || reportType === "activity")
      ? (user.role === "state_program_officer" ? "state_authored" : "technical_authored")
      : (reportType === "hq_sector" && user.role === "senior_program_coordinator"
          ? "spc_fallback"
          : null);

    // ── HQ Project Report: transactional duplicate guard ─────────────────────
    if (reportType === "project" && rawLocationType === "hq") {
      type DupRow = { id: number };
      let dupCheck: DupRow[];
      if (body.kind === "monthly") {
        ({ rows: dupCheck } = await db.query<DupRow>(
          `SELECT id FROM reports
            WHERE report_type = 'project'
              AND location_type = 'hq'
              AND state_id IS NULL
              AND project_id = $1
              AND kind = 'monthly'
              AND reporting_year = $2
              AND reporting_month = $3
              AND status NOT IN ('rejected','archived')
              AND migration_is_duplicate = FALSE
            LIMIT 1`,
          [body.projectId, body.reportingYear, body.reportingMonth],
        ));
      } else if (body.kind === "quarterly") {
        ({ rows: dupCheck } = await db.query<DupRow>(
          `SELECT id FROM reports
            WHERE report_type = 'project'
              AND location_type = 'hq'
              AND state_id IS NULL
              AND project_id = $1
              AND kind = 'quarterly'
              AND reporting_year = $2
              AND quarter = $3
              AND status NOT IN ('rejected','archived')
              AND migration_is_duplicate = FALSE
            LIMIT 1`,
          [body.projectId, body.reportingYear, body.quarter],
        ));
      } else {
        ({ rows: dupCheck } = await db.query<DupRow>(
          `SELECT id FROM reports
            WHERE report_type = 'project'
              AND location_type = 'hq'
              AND state_id IS NULL
              AND project_id = $1
              AND kind = 'annual'
              AND reporting_year = $2
              AND status NOT IN ('rejected','archived')
              AND migration_is_duplicate = FALSE
            LIMIT 1`,
          [body.projectId, body.reportingYear],
        ));
      }
      if (dupCheck.length > 0) {
        return c.json({
          error: "duplicate_report_period",
          message: "An HQ project report already exists for this project and period combination.",
        }, 409);
      }
    }

    // ── State Programme Report: transactional duplicate guard ────────────────
    if (reportType === "program_state" && effectiveStateId != null && body.reportingYear != null) {
      let sprDupSql: string | null = null;
      let sprDupParams: unknown[] = [];
      if (body.kind === "monthly" && body.reportingMonth != null) {
        sprDupSql = `SELECT id FROM reports
                     WHERE report_type = 'program_state' AND state_id = $1 AND kind = 'monthly'
                       AND reporting_year = $2 AND reporting_month = $3
                       AND status NOT IN ('rejected','archived')
                       AND migration_is_duplicate = FALSE
                     LIMIT 1`;
        sprDupParams = [effectiveStateId, body.reportingYear, body.reportingMonth];
      } else if (body.kind === "quarterly" && body.quarter != null) {
        sprDupSql = `SELECT id FROM reports
                     WHERE report_type = 'program_state' AND state_id = $1 AND kind = 'quarterly'
                       AND reporting_year = $2 AND quarter = $3
                       AND status NOT IN ('rejected','archived')
                       AND migration_is_duplicate = FALSE
                     LIMIT 1`;
        sprDupParams = [effectiveStateId, body.reportingYear, body.quarter];
      } else if (body.kind === "annual") {
        sprDupSql = `SELECT id FROM reports
                     WHERE report_type = 'program_state' AND state_id = $1 AND kind = 'annual'
                       AND reporting_year = $2
                       AND status NOT IN ('rejected','archived')
                       AND migration_is_duplicate = FALSE
                     LIMIT 1`;
        sprDupParams = [effectiveStateId, body.reportingYear];
      }
      if (sprDupSql) {
        const { rows: sprDup } = await db.query<{ id: number }>(sprDupSql, sprDupParams);
        if (sprDup.length > 0) {
          return c.json({
            error: "duplicate_report_period",
            message: "A State Programme Report already exists for this State and reporting period.",
          }, 409);
        }
      }
    }

    // ── HQ Sector Report: transactional duplicate guard ──────────────────────
    if (reportType === "hq_sector" && effectiveSector && body.reportingYear != null) {
      let hqsrDupSql: string | null = null;
      let hqsrDupParams: unknown[] = [];
      if (body.kind === "monthly" && body.reportingMonth != null) {
        hqsrDupSql = `SELECT id FROM reports
                       WHERE report_type = 'hq_sector'
                         AND sector = $1
                         AND kind = 'monthly'
                         AND reporting_year = $2
                         AND reporting_month = $3
                         AND status NOT IN ('rejected','archived')
                         AND migration_is_duplicate = FALSE
                       LIMIT 1`;
        hqsrDupParams = [effectiveSector, body.reportingYear, body.reportingMonth];
      } else if (body.kind === "quarterly" && body.quarter != null) {
        hqsrDupSql = `SELECT id FROM reports
                       WHERE report_type = 'hq_sector'
                         AND sector = $1
                         AND kind = 'quarterly'
                         AND reporting_year = $2
                         AND quarter = $3
                         AND status NOT IN ('rejected','archived')
                         AND migration_is_duplicate = FALSE
                       LIMIT 1`;
        hqsrDupParams = [effectiveSector, body.reportingYear, body.quarter];
      } else if (body.kind === "annual") {
        hqsrDupSql = `SELECT id FROM reports
                       WHERE report_type = 'hq_sector'
                         AND sector = $1
                         AND kind = 'annual'
                         AND reporting_year = $2
                         AND status NOT IN ('rejected','archived')
                         AND migration_is_duplicate = FALSE
                       LIMIT 1`;
        hqsrDupParams = [effectiveSector, body.reportingYear];
      }
      if (hqsrDupSql) {
        const { rows: hqsrDup } = await db.query<{ id: number }>(hqsrDupSql, hqsrDupParams);
        if (hqsrDup.length > 0) {
          return c.json({
            error: "duplicate_report_period",
            message:
              "An HQ Sector Report already exists for this Sector and reporting period.",
          }, 409);
        }
      }
    }

    let newId: number;
    try {
      const { rows } = await db.query<{ id: number }>(
        `INSERT INTO reports (
           title, kind, report_type, activity_id,
           reporting_month, reporting_year, period_start, period_end,
           sector, submitted_to, project_id, state_id, period,
           narrative, executive_summary, challenges, recommendations,
           sections, beneficiaries_male, beneficiaries_female,
           beneficiaries_boys, beneficiaries_girls,
           planned_budget, actual_expenditure, activities, quarter,
           on_demand_reason, indicator_progress, activity_name, location_type,
           status, submitted_by_id, author_id, workflow_path, submitted_at, currency
         ) VALUES (
           $1, $2, $3, $4,
           $5, $6, $7, $8,
           $9, $10, $11, $12, $13,
           $14, $15, $16, $17,
           $18, $19, $20,
           $21, $22,
           $23, $24, $25, $26,
           $27, $28, $31, $32,
           'draft', $29, $29, $30, NOW(), $33
         )
         RETURNING id`,
        [
          body.title,
          body.kind,
          reportType,
          activityId,
          body.reportingMonth ?? null,
          body.reportingYear ?? null,
          body.periodStart ?? null,
          body.periodEnd ?? null,
          effectiveSector,      // $9 — authoritative sector snapshot
          body.submittedTo ?? null,
          // For activity reports: use the resolved projectId (null for standalone).
          // For hq_sector: force NULL (HQSR-004 location integrity, defence in depth).
          // For other types: use body.projectId.
          reportType === "hq_sector"
            ? null
            : reportType === "activity"
              ? (activityResolvedProjectId !== undefined ? activityResolvedProjectId : body.projectId ?? null)
              : (body.projectId ?? null),
          effectiveStateId,
          body.period,
          body.narrative ?? null,
          body.executiveSummary ?? null,
          body.challenges ?? null,
          body.recommendations ?? null,
          // FIX-08: All new Activity Reports are stamped as modern at creation time.
          // jsonb columns must be passed as JSON.stringify() strings — pg does not
          // auto-serialize JS objects/arrays for jsonb.
          (() => {
            const sectionsVal = reportType === "activity"
              ? {
                  ...((body.sections as Record<string, unknown>) ?? {}),
                  _schemaVersion: "modern",
                }
              : (body.sections ?? null);
            return sectionsVal != null ? JSON.stringify(sectionsVal) : null;
          })(),
          body.beneficiariesMale ?? null,
          body.beneficiariesFemale ?? null,
          body.beneficiariesBoys ?? null,
          body.beneficiariesGirls ?? null,
          body.plannedBudget ?? null,
          body.actualExpenditure ?? null,
          body.activities != null ? JSON.stringify(body.activities) : null,
          body.quarter ?? null,
          body.onDemandReason ?? null,
          body.indicatorProgress != null ? JSON.stringify(body.indicatorProgress) : null,
          user.id,              // $29 → submitted_by_id and author_id
          newWorkflowPath,      // $30 → workflow_path
          rawActivityName,      // $31 → activity_name
          rawLocationType,      // $32 → location_type ("hq" | "state" | null)
          effectiveCurrency,    // $33 → currency (Migration 070)
        ],
      );
      newId = rows[0].id;
    } catch (err) {
      // Structured 409 for unique constraint violations (duplicate recurring period)
      if ((err as { code?: string }).code === "23505") {
        return c.json({
          error: "duplicate_report_period",
          message:
            "A report already exists for this project / state / period combination. Only on-demand reports allow multiple entries per period.",
        }, 409);
      }
      throw err;
    }

    await logAudit(db, {
      userId: user.id,
      action: "create",
      module: "reports",
      entityId: newId,
      newValue: reportType,
    });
    const result = await db.query<Record<string, unknown>>(`${reportSelect} WHERE r.id = $1`, [newId]);
    const enriched = await withHistory(db, result.rows);
    return c.json(enriched[0], 201);
  } finally {
    close();
  }
});

// ---------------------------------------------------------------------------
// PATCH /reports/:reportId — Update a draft report
// ---------------------------------------------------------------------------

reportsRoutes.patch("/reports/:reportId", requireReportsUpdateOrSomSprAuthor, async (c) => {
  const user = c.get("currentUser");
  const { db, close } = openDb(c);
  try {
    if (!user) return c.json({ error: "no current user" }, 401);
    const reportId = Number(c.req.param("reportId"));
    const cur = await db.query<{
      status: string;
      sector: string | null;
      projectId: number | null;
      reportType: string | null;
      authorId: number | null;
      stateId: number | null;
      sections: Record<string, unknown> | null;
    }>(
      `SELECT status, sector, project_id AS "projectId", report_type AS "reportType",
              author_id AS "authorId", state_id AS "stateId", sections
       FROM reports WHERE id = $1`,
      [reportId],
    );
    if (cur.rows.length === 0) {
      return c.json({ error: "report not found" }, 404);
    }
    if (cur.rows[0].status !== "draft") {
      return c.json({ error: "only_draft_reports_can_be_updated" }, 409);
    }

    // Author ownership: only the original report author may edit a draft.
    // Super-admin may bypass for administrative corrections.
    // Program Manager may bypass via Full Operational Access (Task #373) —
    // identity/integrity fields are still protected (super_admin bypass only).
    const authorId = cur.rows[0].authorId;
    const isSuperAdmin = user.role === "super_admin";
    const isDraftEditFullAccess = hasFullOperationalAccess(user);

    // ── SOM fallback defence (SPR-003/004) ────────────────────────────────
    // SOM reaches this handler only via the narrow fallback permission and
    // may edit exclusively their own program_state drafts in their OWN
    // current state. Fail closed when either state id is null (reassigned or
    // unassigned SOM loses access to old drafts). This also closes the
    // authorId=null historical-draft loophole for SOM.
    if (user.role === "state_office_manager") {
      const somStateId = user.stateId ?? null;
      const reportStateId = cur.rows[0].stateId ?? null;
      if (
        cur.rows[0].reportType !== "program_state" ||
        authorId !== user.id ||
        somStateId === null ||
        reportStateId === null ||
        reportStateId !== somStateId
      ) {
        return c.json({
          error: "som_program_state_author_only",
          message: "State Office Managers can only edit State Programme Report drafts they authored for their own state.",
        }, 403);
      }
    }

    // Full Operational Access (PM/super_admin) bypasses author ownership.
    // author_id is preserved unchanged — the original creator is never mutated.
    if (!isDraftEditFullAccess && authorId !== null && authorId !== user.id) {
      return c.json({
        error: "draft_edit_forbidden",
        message: "Only the original report author can edit this draft.",
      }, 403);
    }

    const sector = await getReportSectorForAuth(db, reportId);
    const guard = assertSectorAllowed(user, sector ?? null);
    if (!guard.ok) {
      return c.json(guard.body, guard.status as 403);
    }
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

    // ── Activity Report identity immutability ─────────────────────────────────
    // activityId / projectId / stateId / locationType form the immutable identity of an
    // Activity Report. Even in draft, these fields cannot be changed: doing so would allow
    // period-duplicate bypass and break workflow_path / author traceability.
    // super_admin may bypass for administrative corrections.
    if (cur.rows[0].reportType === "activity" && !isSuperAdmin) {
      const identityFields = ["activityId", "projectId", "stateId", "locationType"];
      const attempted = identityFields.filter((f) => body[f] !== undefined);
      if (attempted.length > 0) {
        return c.json({
          error: "activity_identity_immutable",
          message: `Activity Report identity fields cannot be changed after creation: ${attempted.join(", ")}.`,
        }, 409);
      }
    }

    // ── Project Report identity immutability ──────────────────────────────────
    // projectId / stateId / locationType / period / reportingMonth / reportingYear / quarter
    // form the immutable identity triple (project + location + period) of a PMR.
    // super_admin may bypass for administrative corrections.
    if (cur.rows[0].reportType === "project" && !isSuperAdmin) {
      const pmrIdentityFields = ["projectId", "stateId", "locationType", "period", "reportingMonth", "reportingYear", "quarter"];
      const attempted = pmrIdentityFields.filter((f) => body[f] !== undefined);
      if (attempted.length > 0) {
        return c.json({
          error: "project_report_identity_immutable",
          message: `Project Report identity fields cannot be changed after creation: ${attempted.join(", ")}.`,
        }, 409);
      }
    }

    // ── State Programme Report identity immutability ──────────────────────────
    // stateId / kind / period / reportingMonth / reportingYear / quarter /
    // periodStart / periodEnd form the immutable business identity of an SPR.
    // super_admin may bypass for administrative corrections.
    if (cur.rows[0].reportType === "program_state" && !isSuperAdmin) {
      const sprIdentityFields = [
        "stateId", "kind", "period", "reportingMonth", "reportingYear",
        "quarter", "periodStart", "periodEnd", "reportType",
      ];
      const attempted = sprIdentityFields.filter((f) => body[f] !== undefined);
      if (attempted.length > 0) {
        return c.json({
          error: "program_state_report_identity_immutable",
          message: `State Programme Report identity fields cannot be changed after creation: ${attempted.join(", ")}.`,
        }, 409);
      }
    }

    // ── HQ Sector Report identity immutability (HQSR-002) ─────────────────────
    // Actor-independent: no role (including PM and super_admin) may mutate
    // HQSR identity via the generic PATCH.
    if (cur.rows[0].reportType === "hq_sector") {
      const hqIdentityFields = [
        "reportType", "report_type",
        "sector",
        "kind",
        "period",
        "reportingMonth", "reporting_month",
        "reportingYear", "reporting_year",
        "quarter",
        "periodStart", "period_start",
        "periodEnd", "period_end",
        "stateId", "state_id",
        "projectId", "project_id",
      ];
      const attempted = hqIdentityFields.filter((f) => f in body);
      if (attempted.length > 0) {
        return c.json({
          error: "hq_sector_report_identity_immutable",
          message: `HQ Sector Report identity fields cannot be changed after creation: ${attempted.join(", ")}.`,
        }, 409);
      }
    }

    // ── FIX-08: _schemaVersion immutability guard ─────────────────────────────
    // Once an Activity Report has been marked as modern (_schemaVersion:"modern" in sections),
    // that marker cannot be removed or cleared via PATCH.
    // super_admin is exempt (administrative corrections only).
    if (cur.rows[0].reportType === "activity" && !isSuperAdmin) {
      const existingSections = cur.rows[0].sections ?? {};
      if (existingSections["_schemaVersion"] === "modern" && body["sections"] !== undefined) {
        if (body["sections"] === null) {
          return c.json({
            error: "modern_schema_version_immutable",
            message:
              "Cannot clear sections of a modern Activity Report. " +
              "Send an empty object {} to clear content fields while preserving the schema version.",
          }, 409);
        }
        const incoming = body["sections"] as Record<string, unknown>;
        if (incoming["_schemaVersion"] !== "modern") {
          body["sections"] = { ...incoming, _schemaVersion: "modern" };
        }
      }
    }

    // ── Validate beneficiary counts and activity fields for PATCH ─────────────
    {
      const benFields = ["beneficiariesMale", "beneficiariesFemale", "beneficiariesBoys", "beneficiariesGirls"];
      for (const f of benFields) {
        const v = body[f];
        if (v !== undefined && v !== null) {
          const num = Number(v);
          if (!Number.isFinite(num) || !Number.isInteger(num) || num < 0) {
            return c.json({ error: "validation_error", message: `${f} must be a non-negative whole number` }, 400);
          }
        }
      }
      const acts = body["activities"];
      if (Array.isArray(acts)) {
        for (const act of acts as Record<string, unknown>[]) {
          const pct = act["percent"] !== undefined ? Number(act["percent"]) : undefined;
          if (pct !== undefined && (!Number.isFinite(pct) || !Number.isInteger(pct) || pct < 0 || pct > 100)) {
            return c.json({ error: "validation_error", message: "Activity implementation % must be a whole number between 0 and 100" }, 400);
          }
          for (const bf of ["beneficiariesMen", "beneficiariesWomen", "beneficiariesBoys", "beneficiariesGirls"]) {
            const bv = act[bf];
            if (bv !== undefined && bv !== null) {
              const num = Number(bv);
              if (!Number.isFinite(num) || !Number.isInteger(num) || num < 0) {
                return c.json({ error: "validation_error", message: `Activity ${bf} must be a non-negative whole number` }, 400);
              }
            }
          }
        }
      }
    }

    // Validate kind if provided (all report types — no special exemptions).
    if (body.kind !== undefined && !isCanonicalFrequency(body.kind)) {
      return c.json({
        error: "invalid_frequency",
        message: `kind must be one of: ${CANONICAL_FREQUENCIES.join(", ")}`,
      }, 400);
    }

    const setCols: unknown[] = [];
    const sets: string[] = [];
    const set = (col: string, val: unknown) =>
      `${col} = $${(setCols.push(val), setCols.length + 1)}`;

    const maybeSet = (key: string, col: string) => {
      if (body[key] !== undefined) sets.push(set(col, body[key]));
    };
    // jsonb columns must be passed as JSON.stringify() strings — pg does not
    // auto-serialize JS objects/arrays for jsonb and falls back to PostgreSQL
    // array syntax which causes "invalid input syntax for type json" errors.
    const maybeSetJson = (key: string, col: string) => {
      if (body[key] !== undefined) {
        const v = body[key];
        sets.push(set(col, v != null ? JSON.stringify(v) : null));
      }
    };
    maybeSet("title", "title");
    maybeSet("kind", "kind");
    maybeSet("sector", "sector");
    maybeSet("reportingMonth", "reporting_month");
    maybeSet("reportingYear", "reporting_year");
    maybeSet("period", "period");
    maybeSet("periodStart", "period_start");
    maybeSet("periodEnd", "period_end");
    maybeSet("narrative", "narrative");
    maybeSet("executiveSummary", "executive_summary");
    maybeSet("challenges", "challenges");
    maybeSet("recommendations", "recommendations");
    maybeSetJson("sections", "sections");
    maybeSet("beneficiariesMale", "beneficiaries_male");
    maybeSet("beneficiariesFemale", "beneficiaries_female");
    maybeSet("beneficiariesBoys", "beneficiaries_boys");
    maybeSet("beneficiariesGirls", "beneficiaries_girls");
    maybeSet("plannedBudget", "planned_budget");
    maybeSet("actualExpenditure", "actual_expenditure");
    maybeSetJson("activities", "activities");
    maybeSet("quarter", "quarter");
    maybeSet("onDemandReason", "on_demand_reason");
    maybeSetJson("indicatorProgress", "indicator_progress");
    maybeSet("submittedTo", "submitted_to");
    maybeSet("activityName", "activity_name");
    maybeSet("activityId", "activity_id");
    maybeSet("projectId", "project_id");
    maybeSet("stateId", "state_id");

    if (sets.length === 0) {
      return c.json({ error: "no_fields_to_update" }, 400);
    }
    sets.push(`updated_at = NOW()`);

    const baseRevision = c.req.header("x-base-revision");
    const update = await db.query(
      `UPDATE reports SET ${sets.join(", ")} WHERE id = $1${baseRevision ? ` AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $${setCols.length + 2}::timestamptz)` : ""}`,
      [reportId, ...setCols, ...(baseRevision ? [baseRevision] : [])],
    );
    if (baseRevision && update.rowCount === 0) {
      return c.json({ error: "offline_conflict", code: "revision_mismatch", message: "The report changed while this draft was offline." }, 409);
    }

    await logAudit(db, {
      userId: user.id,
      action: "update",
      module: "reports",
      entityId: reportId,
    });
    const result = await db.query<Record<string, unknown>>(`${reportSelect} WHERE r.id = $1`, [reportId]);
    const enriched = await withHistory(db, result.rows);
    return c.json(enriched[0]);
  } finally {
    close();
  }
});

// ---------------------------------------------------------------------------
// DELETE /reports/:reportId — Hard-delete draft (creator or super_admin)
// ---------------------------------------------------------------------------

reportsRoutes.delete(
  "/reports/:reportId",
  requirePerm("reports.delete"), // PERM-03: dedicated delete permission, consistent with projects.delete and plans.delete.
  async (c) => {
    const user = c.get("currentUser");
    const { db, pool, close } = openDb(c);
    try {
      if (!user) return c.json({ error: "no current user" }, 401);
      const reportId = Number(c.req.param("reportId"));
      const cur = await db.query<{ status: string; authorId: number | null }>(
        `SELECT status, author_id AS "authorId" FROM reports WHERE id = $1`,
        [reportId],
      );
      if (cur.rows.length === 0) {
        return c.json({ error: "report not found" }, 404);
      }
      if (cur.rows[0].status !== "draft") {
        return c.json({ error: "only_draft_reports_can_be_deleted" }, 409);
      }
      // Fail closed if author_id is null (legacy record without backfill) to prevent
      // a permissive delete for normal roles. PM and super_admin (Full Operational Access)
      // bypass author-ownership and may delete any draft — including null-author legacy rows —
      // as an operational action. Both roles are trusted; the deletion is audit-logged.
      const authorId = cur.rows[0].authorId;
      const isDeleteFullAccess = hasFullOperationalAccess(user);
      if (!isDeleteFullAccess && (authorId === null || authorId !== user.id)) {
        return c.json({ error: "only_creator_or_admin_can_delete" }, 403);
      }

      // Collect all evidence object paths BEFORE any DB delete
      const attachmentPathsResult = await db.query<{ object_path: string }>(
        `SELECT object_path FROM report_attachments WHERE report_id = $1 AND object_path <> ''`,
        [reportId],
      );
      const voicePathsResult = await db.query<{ object_path: string }>(
        `SELECT object_path FROM voice_notes WHERE entity_type = 'report' AND entity_id = $1 AND object_path IS NOT NULL AND object_path <> ''`,
        [reportId],
      );
      const rawAttachmentPaths = attachmentPathsResult.rows.map((r) => r.object_path);
      const rawVoicePaths = voicePathsResult.rows.map((r) => r.object_path);

      // Deduplicate: a path shared between an attachment and a voice note for the
      // same report should only be deleted once.
      const allUniquePaths = [...new Set([...rawAttachmentPaths, ...rawVoicePaths])];

      // Cross-table ownership check: a path is safe to delete when no record
      // OUTSIDE this report's deletion set references it.
      const partition = await partitionSafeStoragePathsForReport(db, reportId, allUniquePaths);
      if (partition.skipped.length > 0) {
        console.warn(`[ATT-05] report_delete skipping ${partition.skipped.length} path(s) with external refs reportId=${reportId}`);
      }

      const safeObjectPaths = partition.safe;

      // Delete all safe storage objects OUTSIDE any DB transaction
      for (const objectPath of safeObjectPaths) {
        try {
          await deleteObjectSafely(c.env, objectPath);
        } catch (_storErr) {
          console.error(`[ATT-05] report_delete storage_error reportId=${reportId} objectPath=${objectPath}`);
          return c.json({ error: "report_evidence_storage_delete_failed" }, 500);
        }
      }

      // All storage objects cleaned — now delete DB rows in a single transaction
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // Hold the report lock before proceeding, so an identity/scope PATCH
        // cannot race the deletion.
        await client.query(`SELECT id FROM reports WHERE id = $1 FOR UPDATE`, [reportId]);
        await client.query(
          `DELETE FROM document_registry_entries dre
           USING report_attachments ra
           WHERE dre.source_kind = 'report_attachment'
             AND dre.source_id = ra.id
             AND ra.report_id = $1`,
          [reportId],
        );
        await client.query(`DELETE FROM report_attachments WHERE report_id = $1`, [reportId]);
        await client.query(
          `DELETE FROM voice_notes WHERE entity_type = 'report' AND entity_id = $1`,
          [reportId],
        );
        await client.query(`DELETE FROM reports WHERE id = $1`, [reportId]);
        await client.query("COMMIT");
      } catch (dbErr) {
        await client.query("ROLLBACK");
        throw dbErr;
      } finally {
        client.release();
      }

      await logAudit(db, {
        userId: user.id,
        action: "delete",
        module: "reports",
        entityId: reportId,
      });
      return c.json({ ok: true });
    } finally {
      close();
    }
  },
);
