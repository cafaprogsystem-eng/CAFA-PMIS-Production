import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { Readable } from "stream";
import { pool } from "@workspace/db";
import { CreateReportBody, TransitionReportBody } from "@workspace/api-zod";
import {
  logAudit,
  tcSectorRestriction,
  assertSectorAllowed,
  requirePerm,
  permissionsFor,
  hasPerm,
} from "../middlewares/currentUser";
import { VALID_SECTOR_SET } from "../lib/sectors";
import { unresolvedRequiredCorrections } from "./comments";
import { notifyEntityActorsDeduped, notifyNextApprover, createNotificationDeduped } from "../lib/notifications";
import { realtime } from "../lib/realtime";
import { assertActiveState } from "../lib/state-master";
import {
  CANONICAL_REPORT_TYPES,
  CANONICAL_FREQUENCIES,
  REPORT_WORKFLOWS,
  AWAITING_APPROVAL_STATUSES_SQL,
  TOTAL_STATUSES_SQL,
  CANONICAL_TYPES_SQL,
  getRevisionPerm,
  isCanonicalReportType,
  isCanonicalFrequency,
  operationalPopulationSQL,
  getProjectActivityWorkflow,
} from "../lib/reportConstants";
import { assertCanViewReport, assertAttachmentMutationAllowed, hasActiveTcForSector, hasActiveSpoForState, getReportSectorForAuth } from "../lib/reportAuth";
import { contentDispositionHeader } from "../lib/contentDisposition";
import { hasFullOperationalAccess } from "../lib/accessControl";
import {
  PMR_COMP_SUBMITTED_STATUSES,
  pmrCompStatusRank,
  resolveExpectedLocations,
} from "../lib/pmrLocationHelper";
import { verifyUploadToken, UploadTokenError } from "../lib/uploadToken";
import { logger } from "../lib/logger";
import { ObjectStorageService, ObjectNotFoundError, deleteStorageObjectSafely } from "../lib/objectStorage";
import { isStorageDeleteSafeForRecord, partitionSafeStoragePathsForReport } from "../lib/evidenceOwnership";
import { projectCoverageOverlapsMonth } from "../lib/project-reporting-coverage";
import { evaluateMonthlyReportingDeadlines } from "../lib/monthly-reporting-deadline";

const objectStorageService = new ObjectStorageService();

/** Maximum rows returned by the /reports/export endpoint.
 *  A sentinel query of MAX+1 is used to distinguish exactly-MAX results
 *  from truncated results without a separate COUNT query. */
const REPORT_EXPORT_MAX_ROWS = 5_000;

// NOTE (Task #522 / REP-ZR-24): report_attachments DDL is owned exclusively by
// tracked migration 014_att02_evidence_object_path_unique in run-migrations.ts.
// The previous module-level CREATE TABLE side effect has been removed — route
// files must never run startup DDL.

// ── Helpers ───────────────────────────────────────────────────────────────────

async function reportDeepLink(reportId: number): Promise<string> {
  const r = await pool.query<{ rt: string | null }>(
    `SELECT report_type AS rt FROM reports WHERE id = $1`,
    [reportId],
  );
  const rt = r.rows[0]?.rt ?? "project";
  const slug =
    rt === "hq_sector"
      ? "hq-sector"
      : rt === "program_state"
        ? "program-state"
        : rt === "activity"
          ? "activity"
          : "project";
  return `/reports/${slug}?open=${reportId}`;
}

/**
 * Apply canonical report type filter and operational status filter to a
 * WHERE clause fragment list + params array.
 * Also applies state/TC-sector scoping for the current user.
 *
 * @param excludeArchived - when true (default), excludes archived reports.
 *   Pass false to include archived (e.g. archive-accessible reads).
 */
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
  req: Parameters<typeof tcSectorRestriction>[0],
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
  //
  // programme_assistant: NOT in VALID_ROLES; receives no reports.view permission
  //   in permissionsFor() → 403 before reaching this function → fail-closed.
  //   This is intentional. See permissionsFor() role model notes.
  //
  // project_officer: NOT a defined CAFA PMIS role (dashboard.ts comment only).
  //   No reports.view permission → fail-closed before reaching this function.
  // ─────────────────────────────────────────────────────────────────────────

  // State restriction (state roles clamped to their own state)
  const isStateRole =
    req.currentUser?.role === "state_program_officer" ||
    req.currentUser?.role === "state_office_manager";
  if (isStateRole) {
    if (!req.currentUser?.stateId) {
      // Fail-closed: state-scoped role with no assigned stateId cannot see any reports.
      filters.push("1 = 0");
      return { needsProjectJoin: false };
    }
    params.push(req.currentUser.stateId);
    filters.push(`${r}.state_id = $${params.length}`);
  }

  // TC sector restriction — type-aware (spec §2 and §6)
  const tcSectors = tcSectorRestriction(req);
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

async function withHistory(rows: unknown[]) {
  if (rows.length === 0) return rows;
  const ids = (rows as { id: number }[]).map((r) => r.id);
  const { rows: hist } = await pool.query(
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
  return (rows as { id: number; plannedBudget: unknown; actualExpenditure: unknown }[]).map(
    (r) => ({
      ...r,
      plannedBudget:
        r.plannedBudget != null ? Number(r.plannedBudget) : null,
      actualExpenditure:
        r.actualExpenditure != null ? Number(r.actualExpenditure) : null,
      approvalHistory: byEntity.get(r.id) ?? [],
    }),
  );
}

// ── Router ────────────────────────────────────────────────────────────────────

const router: IRouter = Router();

router.post("/reports/monthly-reporting/evaluate", requirePerm("reports.approve.final"), async (req, res, next) => {
  try {
    const dryRun = req.body?.dryRun === true;
    if (req.body?.dryRun !== undefined && typeof req.body.dryRun !== "boolean") {
      res.status(422).json({ error: "dryRun must be boolean" });
      return;
    }
    res.json(await evaluateMonthlyReportingDeadlines(new Date(), undefined, dryRun));
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /reports — List reports
// ---------------------------------------------------------------------------

router.get("/reports", requirePerm("reports.view"), async (req, res, next) => {
  try {
    const filters: string[] = [];
    const params: unknown[] = [];

    // Explicit query filters
    if (req.query.projectId) {
      if (String(req.query.projectId) === "standalone") {
        filters.push(`r.project_id IS NULL`);
      } else {
        params.push(Number(req.query.projectId));
        filters.push(`r.project_id = $${params.length}`);
      }
    }
    if (req.query.status) {
      params.push(String(req.query.status));
      filters.push(`r.status = $${params.length}`);
    }
    if (req.query.reportType) {
      params.push(String(req.query.reportType));
      filters.push(`r.report_type = $${params.length}`);
    }
    if (req.query.kind) {
      params.push(String(req.query.kind));
      filters.push(`r.kind = $${params.length}`);
    }
    if (req.query.sector) {
      params.push(String(req.query.sector));
      // Use effective sector (COALESCE r.sector, project primary sector)
      filters.push(`COALESCE(NULLIF(r.sector,''), p.sector) = $${params.length}`);
    }
    if (req.query.reportingYear) {
      params.push(Number(req.query.reportingYear));
      filters.push(`r.reporting_year = $${params.length}`);
    }
    if (req.query.reportingMonth) {
      params.push(Number(req.query.reportingMonth));
      filters.push(`r.reporting_month = $${params.length}`);
    }
    if (req.query.authorId) {
      params.push(Number(req.query.authorId));
      filters.push(`r.author_id = $${params.length}`);
    }
    if (req.query.activityId) {
      params.push(Number(req.query.activityId));
      filters.push(`r.activity_id = $${params.length}`);
    }
    if (req.query.q) {
      const q = `%${String(req.query.q)}%`;
      params.push(q);
      filters.push(
        `(r.title ILIKE $${params.length} OR p.title ILIKE $${params.length} OR s.name ILIKE $${params.length} OR COALESCE(NULLIF(r.sector,''), p.sector) ILIKE $${params.length})`,
      );
    }

    // Include archived when explicitly requested
    const includeArchived = req.query.status === "archived";

    // Apply authoritative scope (state restriction, TC sector, canonical type filter)
    applyReportScope(req, filters, params, {
      excludeArchived: !includeArchived,
      canonicalOnly: req.query.reportType ? false : true, // honour explicit type filter
      reportType: req.query.reportType ? String(req.query.reportType) : undefined,
    });

    // Operational-population filter (default): excludes migration duplicates and records with
    // unverified historical status. These rows are preserved for audit but must not silently
    // distort list totals or appear as active workflow records.
    // HQ leadership roles may pass ?includeHistorical=true to retrieve all records for review.
    const HQ_LEADERSHIP_ROLES_FOR_HISTORY = new Set([
      "super_admin", "executive_director", "program_manager", "senior_program_coordinator",
    ]);
    const includeHistorical =
      req.query.includeHistorical === "true" &&
      HQ_LEADERSHIP_ROLES_FOR_HISTORY.has(req.currentUser?.role ?? "");
    if (!includeHistorical) {
      applyOperationalPopulation(filters);
    }

    // Explicit state filter AFTER scope (scope may already have clamped state)
    if (req.query.stateId) {
      const isStateRole =
        req.currentUser?.role === "state_program_officer" ||
        req.currentUser?.role === "state_office_manager";
      if (!isStateRole) {
        params.push(Number(req.query.stateId));
        filters.push(`r.state_id = $${params.length}`);
      }
    }

    // Fix sector filter to use effective sector (r.sector OR linked project's sector)
    // (applied after scope so it uses the already-set params index)
    // Note: the sector param is already handled above via the explicit query filter block,
    // but that used r.sector directly. We now overwrite it here:
    // (The plain r.sector filter block at line ~243 is overridden below for sector param)

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    // Pagination
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 25));
    const offset = (page - 1) * pageSize;

    // Count total matching records.
    // Must include LEFT JOIN activities act so TC scope predicates referencing
    // act.sector (for standalone activity reports) do not cause a missing-FROM-clause error.
    const countResult = await pool.query<{ total: string }>(
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

    const { rows } = await pool.query(
      `${reportSelect} ${where} ORDER BY r.submitted_at DESC NULLS LAST, r.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset],
    );
    const items = await withHistory(rows);
    res.json({ items, total, page, pageSize, totalPages });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /reports/consolidated — Consolidated Project View (BD-5 Option B)
// ---------------------------------------------------------------------------
// Pure read model: groups all PMRs for one project + frequency + period by
// Reporting Location with a coverage indicator. No synthetic consolidated
// record, no cross-frequency mixing, no cross-location beneficiary totals.
// Completeness figures MUST agree with GET /dashboard/pmr-reporting-completeness
// for the same params + user scope (shared helper: ../lib/pmrLocationHelper.ts).

const CONS_MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

router.get("/reports/consolidated", requirePerm("reports.view"), async (req, res, next) => {
  try {
    const q = req.query as Record<string, string | undefined>;

    // ── Validation ─────────────────────────────────────────────────────────
    const projectId = q.projectId ? Number(q.projectId) : NaN;
    if (!Number.isInteger(projectId)) {
      res.status(400).json({ error: "projectId is required and must be an integer" });
      return;
    }
    const kind = q.kind;
    if (!kind || !isCanonicalFrequency(kind)) {
      res.status(400).json({
        error: `kind is required and must be one of: ${CANONICAL_FREQUENCIES.join(", ")}`,
      });
      return;
    }
    const reportingYear = q.reportingYear ? Number(q.reportingYear) : NaN;
    if (!Number.isInteger(reportingYear) || reportingYear < 2000 || reportingYear > 2100) {
      res.status(400).json({ error: "reportingYear is required and must be between 2000 and 2100" });
      return;
    }
    let reportingMonth: number | null = null;
    let quarter: number | null = null;
    if (kind === "monthly") {
      if (q.quarter !== undefined) {
        res.status(400).json({ error: "quarter is not allowed when kind=monthly" });
        return;
      }
      reportingMonth = q.reportingMonth ? Number(q.reportingMonth) : NaN;
      if (!Number.isInteger(reportingMonth) || reportingMonth < 1 || reportingMonth > 12) {
        res.status(400).json({ error: "reportingMonth (1-12) is required when kind=monthly" });
        return;
      }
    } else if (kind === "quarterly") {
      if (q.reportingMonth !== undefined) {
        res.status(400).json({ error: "reportingMonth is not allowed when kind=quarterly" });
        return;
      }
      quarter = q.quarter ? Number(q.quarter) : NaN;
      if (!Number.isInteger(quarter) || quarter < 1 || quarter > 4) {
        res.status(400).json({ error: "quarter (1-4) is required when kind=quarterly" });
        return;
      }
    } else {
      // annual / on_demand: year is the only period selector
      if (q.reportingMonth !== undefined || q.quarter !== undefined) {
        res.status(400).json({ error: `reportingMonth and quarter are not allowed when kind=${kind}` });
        return;
      }
    }

    // ── Access control (same semantics as the report-list scope) ──────────
    const u = req.currentUser;
    const isStateRole =
      u?.role === "state_program_officer" || u?.role === "state_office_manager";
    const stateClamp: number | null = isStateRole ? (u?.stateId ?? null) : null;
    if (isStateRole && stateClamp === null) {
      // Fail-closed: state-scoped role with no assigned state sees nothing.
      res.status(403).json({ error: "no state assigned" });
      return;
    }
    const tcSectors = tcSectorRestriction(req);
    if (tcSectors !== null && tcSectors.length === 0) {
      // Fail-closed: TC with no assigned sector sees nothing.
      res.status(403).json({ error: "no sector assigned" });
      return;
    }

    // SPO project-assignment scope — mirrors buildScope() used by
    // /dashboard/pmr-reporting-completeness: an SPO sees only projects they
    // are assigned to. Fail with 404 (no existence leakage) otherwise.
    if (u?.role === "state_program_officer") {
      const asgRes = await pool.query(
        `SELECT DISTINCT project_id FROM project_assignments WHERE user_id = $1`,
        [u.id],
      );
      const assigned = new Set(
        asgRes.rows.map((r: { project_id: number }) => r.project_id),
      );
      if (!assigned.has(projectId)) {
        res.status(404).json({ error: "project not found" });
        return;
      }
    }

    // ── Project (single query; scope-checked) ─────────────────────────────
    const projRes = await pool.query(
      `SELECT p.id, p.title, p.code, p.sector,
              p.has_hq_operations AS "hasHqOperations"
         FROM projects p
        WHERE p.id = $1`,
      [projectId],
    );
    if (projRes.rows.length === 0) {
      res.status(404).json({ error: "project not found" });
      return;
    }
    const project = projRes.rows[0] as {
      id: number; title: string; code: string; sector: string | null;
      hasHqOperations: boolean;
    };
    // TC: Project Primary Sector is the ONLY authority (fail-closed on null).
    if (tcSectors !== null && (!project.sector || !tcSectors.includes(project.sector))) {
      res.status(404).json({ error: "project not found" });
      return;
    }

    // ── Expected locations (scoped — no location-existence leakage) ───────
    const expected = await resolveExpectedLocations(pool, projectId, {
      stateClamp,
      hasHqOperations: Boolean(project.hasHqOperations),
    });
    // State-clamped user whose state is not an operational location of this
    // project: the project is out of their scope — 404, no data leakage.
    if (stateClamp !== null && expected.length === 0) {
      res.status(404).json({ error: "project not found" });
      return;
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
    const repRes = await pool.query(
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

    interface ConsReportRow {
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
    }

    // Best report per location key ("hq" | "s<stateId>") — same ranking as
    // the reporting-completeness endpoint (shared pmrCompStatusRank).
    const bestReport = new Map<string, ConsReportRow>();
    for (const r of repRes.rows as ConsReportRow[]) {
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

    res.json({
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
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /reports — Create a report
// ---------------------------------------------------------------------------

// Outer gate: reports.create OR the narrow SOM fallback permission
// reports.program_state.create (SPR-003/004). The type-specific author gates
// below decide who may create each report type — the narrow permission grants
// nothing beyond reaching the program_state gate (all other type gates exclude
// SOM explicitly).
const requireReportsCreateOrProgramStateCreate = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (req.currentUser && hasPerm(permissionsFor(req.currentUser), "reports.program_state.create")) {
    next();
    return;
  }
  requirePerm("reports.create")(req, res, next);
};

// Outer gate for draft edits / workflow transitions: reports.update OR the
// narrow SOM fallback permission. SOM may only reach the handlers to work on
// their own fallback-authored program_state reports — the in-handler guards
// (SOM defence in PATCH; scoped submit allowance in transitions) enforce that.
// All other roles keep exactly the previous requirePerm("reports.update") gate.
const requireReportsUpdateOrSomSprAuthor = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (
    req.currentUser &&
    req.currentUser.role === "state_office_manager" &&
    hasPerm(permissionsFor(req.currentUser), "reports.program_state.create")
  ) {
    next();
    return;
  }
  requirePerm("reports.update")(req, res, next);
};

router.post("/reports", requireReportsCreateOrProgramStateCreate, async (req, res, next) => {
  try {
    if (!req.currentUser) {
      res.status(401).json({ error: "no current user" });
      return;
    }

    // Extract activityName from raw req.body BEFORE Zod parse strips unknown fields.
    // The Zod schema does not include activityName (it is extra metadata for activity
    // reports); reading it here ensures the required-field check and INSERT both see it.
    const rawActivityName = typeof (req.body as Record<string, unknown>).activityName === "string"
      ? ((req.body as Record<string, unknown>).activityName as string).trim()
      : null;

    const rawLocationType = (req.body as Record<string, unknown>).locationType === "hq"
      ? "hq"
      : (req.body as Record<string, unknown>).locationType === "state"
        ? "state"
        : null;

    // Activity Reports: kind is not user-required — the UI hides the frequency selector.
    // Apply the compatibility default BEFORE Zod parsing so the required-field check in the
    // generated schema is satisfied.  The value is an internal infrastructure default and is
    // never shown to users as a user-selected frequency.
    {
      const rawBodyRecord = req.body as Record<string, unknown>;
      if (rawBodyRecord.reportType === "activity" && !rawBodyRecord.kind) {
        rawBodyRecord.kind = "monthly";
      }
    }

    const body = CreateReportBody.parse(req.body);

    // ── Validate top-level beneficiary counts are non-negative integers ────────
    {
      const benFields = ["beneficiariesMale", "beneficiariesFemale", "beneficiariesBoys", "beneficiariesGirls"] as const;
      for (const f of benFields) {
        const v = body[f];
        if (v !== undefined && v !== null && (!Number.isInteger(v) || v < 0)) {
          res.status(400).json({ error: "validation_error", message: `${f} must be a non-negative whole number` });
          return;
        }
      }
    }
    // ── Validate per-activity fields ──────────────────────────────────────────
    if (body.activities) {
      for (const act of body.activities) {
        const pct = act["percent"] !== undefined ? Number(act["percent"]) : undefined;
        if (pct !== undefined && (!Number.isFinite(pct) || !Number.isInteger(pct) || pct < 0 || pct > 100)) {
          res.status(400).json({ error: "validation_error", message: "Activity implementation % must be a whole number between 0 and 100" });
          return;
        }
        for (const bf of ["beneficiariesMen", "beneficiariesWomen", "beneficiariesBoys", "beneficiariesGirls"]) {
          const bv = act[bf];
          if (bv !== undefined && bv !== null) {
            const num = Number(bv);
            if (!Number.isFinite(num) || !Number.isInteger(num) || num < 0) {
              res.status(400).json({ error: "validation_error", message: `Activity ${bf} must be a non-negative whole number` });
              return;
            }
          }
        }
      }
    }

    // ── Validate canonical Report Type ────────────────────────────────────────
    if (!body.reportType || !isCanonicalReportType(body.reportType)) {
      res.status(400).json({
        error: "invalid_report_type",
        message: `reportType must be one of: ${CANONICAL_REPORT_TYPES.join(", ")}`,
      });
      return;
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
        "super_admin", // super_admin has wildcard but explicit check is still safe
        "program_manager", // Global Full Operational Access (Task #373)
      ];
      const userRole = req.currentUser?.role;
      const isSuperAdminCheck = permissionsFor(req.currentUser).includes("*");
      if (!isSuperAdminCheck && !ACTIVITY_AUTHOR_ROLES.includes(userRole ?? "")) {
        res.status(403).json({ error: "activity_report_author_role_required" });
        return;
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
        "super_admin", // super_admin has wildcard but explicit check is still safe
        "program_manager", // Global Full Operational Access (Task #373)
      ];
      const userRole = req.currentUser?.role;
      const isSuperAdminCheck = permissionsFor(req.currentUser).includes("*");
      if (!isSuperAdminCheck && !PMR_AUTHOR_ROLES.includes(userRole ?? "")) {
        res.status(403).json({ error: "project_report_author_role_required" });
        return;
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
      const userRole = req.currentUser?.role;
      const isSuperAdminCheck = permissionsFor(req.currentUser).includes("*");
      // Every HQ Sector Report — regardless of author role, including the
      // super_admin emergency path — requires a non-blank canonical sector.
      // Normalise (trim) before role branching so whitespace-only values and
      // non-canonical sectors can never persist a malformed HQ record.
      const requestedSector = typeof body.sector === "string" ? body.sector.trim() : "";
      if (!requestedSector) {
        res.status(400).json({ error: "sector is required for hq_sector reports" });
        return;
      }
      if (!VALID_SECTOR_SET.has(requestedSector)) {
        res.status(400).json({ error: "invalid_sector" });
        return;
      }
      body.sector = requestedSector; // persist the normalised (trimmed) canonical value
      if (!isSuperAdminCheck && userRole !== "super_admin") {
        if (userRole === "technical_coordinator") {
          const assignedSectors = tcSectorRestriction(req) ?? [];
          // Exact-segment matching only; a TC with no assigned sectors fails closed.
          if (assignedSectors.length === 0 || !assignedSectors.includes(requestedSector)) {
            res.status(403).json({
              error: "sector_scope_forbidden",
              message: "The requested sector is outside your assigned Main Sectors.",
            });
            return;
          }
        } else if (userRole === "senior_program_coordinator") {
          // Server-side vacancy check — never trust frontend claims of TC absence.
          const tcAvailable = await hasActiveTcForSector(requestedSector);
          if (tcAvailable) {
            res.status(403).json({
              error: "hq_sector_tc_available",
              message:
                "An active Technical Coordinator is assigned to this sector; they are the designated HQ Sector Report author.",
            });
            return;
          }
          // SPC fallback (HQSR-BD-1 / HQSR-BD-6): vacancy confirmed — allow creation.
          // The workflow routes to PM for coordination_review (not SPC, to avoid
          // self-review); see the hq_sector coordination_review guard in the
          // transitions handler. author_id is stamped as the SPC's user id and
          // workflow_path remains NULL — the fallback is identified at review time
          // by author_id → users.role. Falls through to normal report creation.
        } else if (userRole === "program_manager") {
          // Full Operational Access override (Task #373). Sector has already been
          // validated above. No vacancy check — PM may author regardless of TC
          // availability. Falls through to normal report creation.
        } else {
          res.status(403).json({ error: "hq_sector_author_role_required" });
          return;
        }
      }
      // ── HQSR-004: Location integrity ─────────────────────────────────────
      // Canonically an HQ Sector Report has NO State or Project linkage:
      // state_id and project_id must both be NULL. Reject any client that
      // supplies either (actor-independent — PM Full Operational Access and
      // super_admin are equally bound; no overrideReason bypass). Runs AFTER
      // the HQSR-001 sector validation + author gate so those errors keep
      // precedence. Defence-in-depth: the INSERT below also forces NULL, and
      // Migration 021 adds a DB CHECK constraint.
      if (body.stateId != null || body.projectId != null) {
        res.status(422).json({
          error: "hq_sector_location_invalid",
          message:
            "HQ Sector Reports must not carry a State or Project linkage (state_id and project_id must be null).",
          fields: [
            ...(body.stateId != null ? ["stateId"] : []),
            ...(body.projectId != null ? ["projectId"] : []),
          ],
        });
        return;
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
      const userRole = req.currentUser?.role;
      const isSuperAdminCheck = permissionsFor(req.currentUser).includes("*");
      if (userRole === "state_program_officer") {
        // Primary author — pass through. Null-state fail-closed (state_scope_required)
        // and the profile stateId clamp are enforced below (SPR-002).
      } else if (userRole === "state_office_manager") {
        const somStateId = req.currentUser?.stateId ?? null;
        if (somStateId == null) {
          res.status(403).json({
            error: "state_scope_required",
            message: "Your account has no assigned State; State Programme Reports cannot be created.",
          });
          return;
        }
        const spoAvailable = await hasActiveSpoForState(somStateId);
        if (spoAvailable) {
          res.status(403).json({
            error: "program_state_spo_available",
            message:
              "A State Programme Officer is assigned to your state. State Programme Report authoring is reserved for the SPO.",
          });
          return;
        }
        // Vacancy confirmed — SOM may proceed; the profile stateId clamp below applies.
      } else if (userRole === "super_admin" || isSuperAdminCheck) {
        // Emergency path: explicit canonical state is mandatory.
        if (body.stateId == null) {
          res.status(400).json({
            error: "state_required_for_super_admin_spr",
            message: "An explicit stateId is required when a super administrator creates a State Programme Report.",
          });
          return;
        }
        const stateExists = await pool.query(
          `SELECT 1 FROM states WHERE id = $1 LIMIT 1`,
          [body.stateId],
        );
        if (stateExists.rows.length === 0) {
          res.status(400).json({ error: "invalid_state_id" });
          return;
        }
        // super_admin keeps body.stateId (not a state role — no clamp below).
      } else if (userRole === "program_manager") {
        // Full Operational Access override (Task #373). PM has no profile state,
        // so an explicit canonical stateId is mandatory (same as super_admin).
        if (body.stateId == null) {
          res.status(400).json({
            error: "state_required_for_program_manager_spr",
            message:
              "An explicit stateId is required when a Program Manager creates a State Programme Report.",
          });
          return;
        }
        const pmStateExists = await pool.query(
          `SELECT 1 FROM states WHERE id = $1 LIMIT 1`,
          [body.stateId],
        );
        if (pmStateExists.rows.length === 0) {
          res.status(400).json({ error: "invalid_state_id" });
          return;
        }
        // PM keeps body.stateId (not a state role — no clamp below).
      } else {
        res.status(403).json({ error: "program_state_report_author_role_required" });
        return;
      }
    }

    // ── Validate canonical Reporting Frequency (kind) ─────────────────────────
    // NOTE (Task #325): Project.reportingFrequency records the scheduled frequency but is
    // not yet enforced server-side. A soft client-side warning is shown when kind ≠ frequency.
    // Hard enforcement may be added in a future task once historical projects are configured.
    if (reportType === "activity") {
      // kind is not user-required for Activity Reports.  The UI hides the
      // frequency selector so new records arrive without a kind field.  Apply
      // an internal compatibility default ("monthly") when absent; validate
      // the value when present so the stored value remains canonical.
      if (!body.kind) {
        body.kind = "monthly"; // safe internal default — not exposed to users as a selection
      } else if (!isCanonicalFrequency(body.kind)) {
        res.status(400).json({
          error: "invalid_frequency",
          message: `kind must be one of: ${CANONICAL_FREQUENCIES.join(", ")}`,
        });
        return;
      }
    } else {
      if (!body.kind || !isCanonicalFrequency(body.kind)) {
        res.status(400).json({
          error: "invalid_frequency",
          message: `kind (reporting frequency) must be one of: ${CANONICAL_FREQUENCIES.join(", ")}`,
        });
        return;
      }
    }

    // ── Validate period fields per frequency ─────────────────────────────────
    // Activity Reports always use Month+Year semantics for monthly/quarterly/annual kinds.
    // Historical records may carry kind="quarterly"/"annual" in the DB, but the period is
    // always YYYY-MM format; skip frequency-specific (quarterly/annual) requirements.
    // on_demand Activity Reports use periodStart instead of reportingYear/Month; skip check.
    if (reportType === "activity") {
      if (body.kind !== "on_demand" && (!body.reportingYear || !body.reportingMonth)) {
        res.status(400).json({ error: "activity_requires_year_and_month" });
        return;
      }
    } else {
      if (body.kind === "monthly") {
        if (!body.reportingYear || !body.reportingMonth) {
          res.status(400).json({ error: "monthly_requires_year_and_month" });
          return;
        }
      } else if (body.kind === "quarterly") {
        if (!body.reportingYear || !body.quarter) {
          res.status(400).json({ error: "quarterly_requires_year_and_quarter" });
          return;
        }
      } else if (body.kind === "annual") {
        if (!body.reportingYear) {
          res.status(400).json({ error: "annual_requires_year" });
          return;
        }
      }
    }

    // ── Validate type-specific required fields ────────────────────────────────
    if (reportType === "project" && body.projectId == null) {
      res.status(400).json({ error: "project_report_requires_project_id" });
      return;
    }
    if (
      (reportType === "project" || reportType === "program_state") &&
      body.stateId == null &&
      // HQ project reports: stateId is legitimately null — exempt from state requirement
      !(reportType === "project" && rawLocationType === "hq") &&
      req.currentUser?.role !== "state_program_officer" &&
      req.currentUser?.role !== "state_office_manager"
    ) {
      res.status(400).json({
        error: `stateId is required for ${reportType} reports`,
      });
      return;
    }
    // Fail closed: a state-scoped role (SPO/SOM) with no assigned state must not
    // create a State Programme Report. The create clamp derives stateId from the
    // author's profile; a null profile state would produce a null-stateId SPR the
    // author could never read. No row is created.
    if (
      reportType === "program_state" &&
      (req.currentUser?.role === "state_program_officer" ||
        req.currentUser?.role === "state_office_manager") &&
      req.currentUser?.stateId == null
    ) {
      res.status(403).json({
        error: "state_scope_required",
        message: "Your account has no assigned State; State Programme Reports cannot be created.",
      });
      return;
    }
    if (reportType === "hq_sector" && !body.sector) {
      res.status(400).json({ error: "sector is required for hq_sector reports" });
      return;
    }
    // Activity reports require a non-blank activityName in all link modes.
    // rawActivityName was captured from req.body before Zod stripped unknown fields.
    if (reportType === "activity" && !rawActivityName) {
      res.status(400).json({
        error: "activityName_required",
        message: "activityName is required for activity reports and must not be blank.",
      });
      return;
    }
    // ── Activity Report validation — source-aware (project-linked vs. standalone) ──
    const activityId = Number((body as Record<string, unknown>).activityId) || null;
    const tcSectors = tcSectorRestriction(req);
    let projectPrimarySector: string | null = null;
    // Holds the resolved stateId for activity reports (used in effectiveStateId below).
    let activityResolvedStateId: number | null | undefined = undefined;
    // Holds the resolved projectId for activity reports (null for standalone).
    let activityResolvedProjectId: number | null | undefined = undefined;

    if (reportType === "activity" && activityId) {
      // Look up the activity — must exist regardless of project linkage.
      const actLookup = await pool.query<{
        id: number;
        projectId: number | null;
        sector: string | null;
        stateId: number | null;
      }>(
        `SELECT id, project_id AS "projectId", sector, state_id AS "stateId" FROM activities WHERE id = $1`,
        [activityId],
      );
      if (actLookup.rows.length === 0) {
        res.status(400).json({ error: "activity_not_found", message: "The selected Activity does not exist." });
        return;
      }
      const activity = actLookup.rows[0];

      if (activity.projectId !== null) {
        // ── PROJECT-LINKED path ────────────────────────────────────────────────
        // If body supplies a projectId it must match the activity's project.
        if (body.projectId != null && Number(body.projectId) !== activity.projectId) {
          res.status(400).json({
            error: "activity_project_mismatch",
            message: "The selected Activity does not belong to the selected Project.",
          });
          return;
        }
        activityResolvedProjectId = activity.projectId;

        // (1) Project must exist
        const actProjRow = await pool.query<{ id: number; sector: string | null }>(
          `SELECT id, sector FROM projects WHERE id = $1`,
          [activity.projectId],
        );
        if (actProjRow.rows.length === 0) {
          res.status(400).json({ error: "project_not_found", message: "Activity's project does not exist." });
          return;
        }
        projectPrimarySector = actProjRow.rows[0].sector ?? null;

        // (2) TC sector check via Project Primary Sector — fail-closed.
        if (tcSectors) {
          if (!projectPrimarySector) {
            res.status(403).json({
              error: "tc_sector_validation_failed",
              message: "Project has no primary sector. Cannot validate Technical Coordinator scope.",
            });
            return;
          }
          if (!tcSectors.includes(projectPrimarySector)) {
            res.status(403).json({
              error: "sector_scope_forbidden",
              message: "Project primary sector is outside your assigned Main Sectors.",
            });
            return;
          }
        }

        // (3) Determine the effective stateId (SPO: clamped to assigned state)
        const isStateRoleAct =
          req.currentUser.role === "state_program_officer" ||
          req.currentUser.role === "state_office_manager";
        const stateIdForAct: number | null = isStateRoleAct
          ? (req.currentUser.stateId ?? null)
          : (body.stateId != null ? Number(body.stateId) : null);

        if (!stateIdForAct) {
          res.status(400).json({ error: "stateId is required for activity reports" });
          return;
        }

        // (4) Project→State link — selected state must be linked to the project
        const actStateLink = await pool.query<{ project_id: number }>(
          `SELECT project_id FROM project_states WHERE project_id = $1 AND state_id = $2`,
          [activity.projectId, stateIdForAct],
        );
        if (actStateLink.rows.length === 0) {
          if (req.currentUser.role === "state_program_officer") {
            res.status(403).json({
              error: "project_state_mismatch",
              message: "Selected project is not linked to your assigned state.",
            });
            return;
          }
          res.status(400).json({
            error: "state_not_linked_to_project",
            message: "Selected state is not linked to the selected project.",
          });
          return;
        }

        // (5) Activity→State: if the Activity has an authoritative state_id, report state must match.
        // Activities with null state_id are considered project-wide; no state restriction applied.
        if (activity.stateId !== null && activity.stateId !== stateIdForAct) {
          res.status(400).json({
            error: "activity_state_mismatch",
            message: "The selected Activity is assigned to a different State than the selected Report State.",
          });
          return;
        }

        activityResolvedStateId = stateIdForAct;

      } else {
        // ── STANDALONE path ────────────────────────────────────────────────────
        // Standalone activities have no project — reject any supplied projectId.
        if (body.projectId != null) {
          res.status(400).json({
            error: "standalone_activity_cannot_have_project_id",
            message: "This is a standalone activity (no parent project). Do not supply a projectId.",
          });
          return;
        }
        activityResolvedProjectId = null;

        // TC sector check via activity.sector — fail-closed.
        const activitySector = activity.sector ?? null;
        if (tcSectors) {
          if (!activitySector) {
            res.status(403).json({
              error: "tc_sector_validation_failed",
              message: "Standalone activity has no sector. Cannot validate Technical Coordinator scope.",
            });
            return;
          }
          if (!tcSectors.includes(activitySector)) {
            res.status(403).json({
              error: "sector_scope_forbidden",
              message: "Activity sector is outside your assigned Main Sectors.",
            });
            return;
          }
        }

        // State scope: SPO and SOM must not create reports for activities assigned to a different state.
        const isStateRoleStandalone =
          req.currentUser.role === "state_program_officer" ||
          req.currentUser.role === "state_office_manager";
        if (isStateRoleStandalone) {
          const stateRoleStateId = req.currentUser.stateId ?? null;
          if (stateRoleStateId !== null && activity.stateId !== null && activity.stateId !== stateRoleStateId) {
            res.status(403).json({
              error: "activity_state_scope_forbidden",
              message: "This standalone activity is assigned to a different state than your assigned state.",
            });
            return;
          }
        }

        // effectiveSector for standalone = activity.sector
        // Stored in projectPrimarySector so the INSERT uses it via effectiveSector below.
        projectPrimarySector = activitySector;

        // Resolve effective stateId for standalone — state integrity rules:
        //
        // If activity.stateId is non-null it is the ONLY authoritative state for this activity.
        //   • Any supplied body.stateId that conflicts is rejected (prevent cross-state injection).
        //   • SPO/SOM: their assigned state must also match (enforced above); use activity.stateId.
        //   • TC and others: body.stateId is ignored; activity.stateId is used.
        //
        // If activity.stateId is null (no assigned state), fall back to body.stateId or SPO/SOM state.
        if (activity.stateId !== null) {
          // Reject any body.stateId that conflicts with the activity's authoritative state.
          if (body.stateId != null && Number(body.stateId) !== activity.stateId) {
            res.status(400).json({
              error: "standalone_state_mismatch",
              message: "The supplied stateId does not match the standalone activity's assigned state.",
            });
            return;
          }
          activityResolvedStateId = activity.stateId;
        } else {
          // Activity has no assigned state — resolve from body or SPO/SOM role.
          activityResolvedStateId = isStateRoleStandalone
            ? (req.currentUser.stateId ?? null)
            : (body.stateId != null ? Number(body.stateId) : null);
        }
      }
    }

    // ── Activity Report: Project-linked mode (activityId=null, projectId supplied) ──
    // User linked the report to a project but not a specific activity record.
    if (reportType === "activity" && !activityId && body.projectId != null && Number(body.projectId) > 0) {
      const actProjRow = await pool.query<{ id: number; sector: string | null }>(
        `SELECT id, sector FROM projects WHERE id = $1`,
        [Number(body.projectId)],
      );
      if (actProjRow.rows.length === 0) {
        res.status(400).json({ error: "project_not_found", message: "Selected project does not exist." });
        return;
      }
      projectPrimarySector = actProjRow.rows[0].sector ?? null;

      if (tcSectors) {
        if (!projectPrimarySector) {
          res.status(403).json({ error: "tc_sector_validation_failed", message: "Project has no primary sector. Cannot validate Technical Coordinator scope." });
          return;
        }
        if (!tcSectors.includes(projectPrimarySector)) {
          res.status(403).json({ error: "sector_scope_forbidden", message: "Project primary sector is outside your assigned Main Sectors." });
          return;
        }
      }

      const isStateRoleActProj =
        req.currentUser.role === "state_program_officer" ||
        req.currentUser.role === "state_office_manager";
      const stateIdForActProj = isStateRoleActProj
        ? (req.currentUser.stateId ?? null)
        : (body.stateId != null ? Number(body.stateId) : null);

      if (stateIdForActProj) {
        const projStateLink = await pool.query<{ project_id: number }>(
          `SELECT project_id FROM project_states WHERE project_id = $1 AND state_id = $2`,
          [Number(body.projectId), stateIdForActProj],
        );
        if (projStateLink.rows.length === 0) {
          if (req.currentUser.role === "state_program_officer") {
            res.status(403).json({ error: "project_state_mismatch", message: "Selected project is not linked to your assigned state." });
            return;
          }
          res.status(400).json({ error: "state_not_linked_to_project", message: "Selected state is not linked to the selected project." });
          return;
        }
      }

      activityResolvedProjectId = Number(body.projectId);
      activityResolvedStateId = stateIdForActProj;
    }

    // ── Activity Report: Standalone mode (activityId=null, projectId=null/0) ──
    // No linked activity or project. Sector comes from body but must be validated
    // Guard: locationType=hq is only valid for activity and project reports. Reject other types early.
    if (rawLocationType === "hq" && reportType !== "activity" && reportType !== "project") {
      res.status(400).json({ error: "invalid_location_combination", message: "locationType=hq is only valid for activity and project reports." });
      return;
    }
    // Guard: locationType=hq cannot be combined with an explicit stateId.
    if (rawLocationType === "hq" && body.stateId != null) {
      res.status(400).json({ error: "invalid_location_combination", message: "locationType=hq cannot be combined with a stateId." });
      return;
    }

    // ── Activity Report: HQ Standalone mode (activityId=null, projectId=null/0, locationType=hq) ──
    // HQ report — no state. Sector validation still applies for sector-scoped roles.
    if (reportType === "activity" && !activityId && (body.projectId == null || Number(body.projectId) === 0) && rawLocationType === "hq") {
      if (req.currentUser.role === "state_program_officer" || req.currentUser.role === "state_office_manager") {
        res.status(403).json({ error: "hq_forbidden", message: "State-scoped users cannot create HQ activity reports." });
        return;
      }
      activityResolvedStateId = null;  // HQ: no state
      activityResolvedProjectId = null;

      const standaloneBodySector = (body.sector ?? null) as string | null;
      if (tcSectors) {
        if (!standaloneBodySector) {
          res.status(400).json({ error: "sector_required", message: "Sector is required for standalone activity reports." });
          return;
        }
        if (!VALID_SECTOR_SET.has(standaloneBodySector)) { res.status(400).json({ error: "invalid_sector" }); return; }
        if (!tcSectors.includes(standaloneBodySector)) {
          res.status(403).json({ error: "sector_scope_forbidden", message: "The requested sector is outside your assigned Main Sectors." });
          return;
        }
        projectPrimarySector = standaloneBodySector;
      } else {
        const userSectorAssigned = ((req.currentUser as unknown) as Record<string, unknown>).sector as string | null ?? null;
        if (userSectorAssigned) {
          if (!standaloneBodySector) {
            res.status(400).json({ error: "sector_required", message: "Sector is required for standalone activity reports." });
            return;
          }
          if (standaloneBodySector !== userSectorAssigned) {
            res.status(403).json({ error: "sector_scope_forbidden", message: "The requested sector does not match your assigned sector." });
            return;
          }
          projectPrimarySector = standaloneBodySector;
        } else {
          projectPrimarySector = standaloneBodySector;
        }
      }
    }

    // ── Activity Report: Non-HQ Standalone mode (activityId=null, projectId=null/0, no HQ flag) ──
    // against the requesting user's authorised sector(s) for sector-scoped roles.
    if (reportType === "activity" && !activityId && (body.projectId == null || Number(body.projectId) === 0) && rawLocationType !== "hq") {
      const isStateRoleSA =
        req.currentUser.role === "state_program_officer" ||
        req.currentUser.role === "state_office_manager";
      activityResolvedStateId = isStateRoleSA
        ? (req.currentUser.stateId ?? null)
        : (body.stateId != null ? Number(body.stateId) : null);
      activityResolvedProjectId = null;

      // Sector validation for sector-scoped roles (TC and HQ sector roles).
      // In this mode there is no authoritative activity/project to derive the sector from,
      // so we validate body.sector against the user's assigned sector(s) and reject any
      // attempt to claim an out-of-scope sector (fail-closed).
      const standaloneBodySector = (body.sector ?? null) as string | null;

      if (tcSectors) {
        // Technical Coordinator: body.sector must be present and within assigned sectors.
        if (!standaloneBodySector) {
          res.status(400).json({
            error: "sector_required",
            message: "Sector is required for standalone activity reports.",
          });
          return;
        }
        if (!VALID_SECTOR_SET.has(standaloneBodySector)) {
          res.status(400).json({ error: "invalid_sector" });
          return;
        }
        if (!tcSectors.includes(standaloneBodySector)) {
          res.status(403).json({
            error: "sector_scope_forbidden",
            message: "The requested sector is outside your assigned Main Sectors.",
          });
          return;
        }
        projectPrimarySector = standaloneBodySector;
      } else {
        // HQ sector roles (hq_sector_coordinator, hq_sector_officer): body.sector must
        // match their single assigned sector.
        const userSectorAssigned = ((req.currentUser as unknown) as Record<string, unknown>).sector as string | null ?? null;
        if (userSectorAssigned) {
          if (!standaloneBodySector) {
            res.status(400).json({
              error: "sector_required",
              message: "Sector is required for standalone activity reports.",
            });
            return;
          }
          if (standaloneBodySector !== userSectorAssigned) {
            res.status(403).json({
              error: "sector_scope_forbidden",
              message: "The requested sector does not match your assigned sector.",
            });
            return;
          }
          projectPrimarySector = standaloneBodySector;
        } else {
          // Org-wide roles: accept the supplied sector (or null) as-is.
          projectPrimarySector = standaloneBodySector;
        }
      }
    }

    if (reportType === "project" && body.projectId != null) {
      // Load the linked project and read its authoritative primary sector and management level.
      // Exclude soft-deleted projects (deleted_at IS NOT NULL) — they are unavailable in the
      // Projects module and may not be used as a PMR location basis.
      const projectRow = await pool.query<{
        id: number; sector: string | null; managementLevel: string | null; hasHqOperations: boolean;
        reportingStartDate: string; reportingEndDate: string;
      }>(
        `SELECT id, sector, management_level AS "managementLevel",
                has_hq_operations AS "hasHqOperations",
                reporting_start_date::text AS "reportingStartDate",
                reporting_end_date::text AS "reportingEndDate"
           FROM projects WHERE id = $1 AND deleted_at IS NULL`,
        [body.projectId],
      );
      if (projectRow.rows.length === 0) {
        res.status(400).json({ error: "project_not_found", message: "Selected project does not exist or is no longer available." });
        return;
      }
      projectPrimarySector = projectRow.rows[0].sector ?? null;

      // ── HQ legitimacy check for project reports ──────────────────────────────
      // HQ is permitted only when the project explicitly has has_hq_operations = true.
      // This is independent of management_level — management level answers who manages
      // the project, not where it operates.
      // State-scoped users (SPO/SOM) can never create HQ project reports regardless.
      if (rawLocationType === "hq") {
        if (
          req.currentUser.role === "state_program_officer" ||
          req.currentUser.role === "state_office_manager"
        ) {
          res.status(403).json({
            error: "hq_forbidden",
            message: "State-scoped users cannot create HQ project reports.",
          });
          return;
        }
        // Deny unless the project explicitly declares HQ operational presence.
        if (!projectRow.rows[0].hasHqOperations) {
          res.status(400).json({
            error: "hq_not_permitted_for_project",
            message: "This project does not have HQ as an Operational Location.",
          });
          return;
        }
        // HQ + stateId combination is invalid (guard already at line 908 for activity reports;
        // replicate here for project reports to ensure consistent enforcement).
        if (body.stateId != null) {
          res.status(400).json({
            error: "invalid_location_combination",
            message: "locationType=hq cannot be combined with a stateId for project reports.",
          });
          return;
        }
      }

      // TC sector security: validate against Project Primary Sector regardless of body.sector.
      // This prevents bypass by omitting or faking body.sector.
      if (tcSectors) {
        if (!projectPrimarySector) {
          res.status(403).json({
            error: "tc_sector_validation_failed",
            message: "Project has no primary sector. Cannot validate Technical Coordinator scope.",
          });
          return;
        }
        if (!tcSectors.includes(projectPrimarySector)) {
          res.status(403).json({
            error: "sector_scope_forbidden",
            message: "Project primary sector is outside your assigned Main Sectors.",
          });
          return;
        }
      }

      // ── State / Project relationship validation ──────────────────────────────
      const isStateRole =
        req.currentUser.role === "state_program_officer" ||
        req.currentUser.role === "state_office_manager";
      const stateIdForValidation = isStateRole
        ? (req.currentUser.stateId ?? null)
        : body.stateId ?? null;

      if (stateIdForValidation) {
        const projectStateLink = await pool.query<{ project_id: number }>(
          `SELECT project_id FROM project_states WHERE project_id = $1 AND state_id = $2`,
          [body.projectId, stateIdForValidation],
        );
        if (projectStateLink.rows.length === 0) {
          // SPO: report state must be linked to their assigned state + the project
          if (req.currentUser.role === "state_program_officer") {
            res.status(403).json({
              error: "project_state_mismatch",
              message: "Selected project is not linked to your assigned state.",
            });
            return;
          }
          // TC / other roles: selected state must be one of the project's linked states
          res.status(400).json({
            error: "state_not_linked_to_project",
            message: "Selected state is not linked to the selected project.",
          });
          return;
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
        res.status(422).json({
          error: "project_reporting_coverage_outside_period",
          message: "Monthly Project Reports must overlap the project's reporting coverage.",
        });
        return;
      }
    }

    // ── Legacy sector validation for non-project, non-activity types ──────────
    // Activity reports handle TC sector checks internally (source-aware).
    if (reportType !== "project" && reportType !== "activity" && tcSectors && body.sector && !VALID_SECTOR_SET.has(body.sector)) {
      res.status(400).json({ error: "invalid_sector" });
      return;
    }
    if (reportType !== "project" && reportType !== "activity" && tcSectors && body.sector && !tcSectors.includes(body.sector)) {
      res.status(403).json({ error: "sector_scope_forbidden" });
      return;
    }

    // ── State scoping for state roles ─────────────────────────────────────────
    const isStateRole =
      req.currentUser.role === "state_program_officer" ||
      req.currentUser.role === "state_office_manager";
    // For activity reports: use the resolved stateId computed during activity validation
    // (handles both project-linked and standalone cases).
    // HQSR-004: hq_sector reports NEVER carry a state linkage — force NULL
    // regardless of body content (the 422 guard above already rejects non-null
    // supplied values; this is defence in depth for any bypassed path).
    const effectiveStateId = reportType === "hq_sector"
      ? null
      : (reportType === "activity" && activityResolvedStateId !== undefined)
        ? activityResolvedStateId
        : (isStateRole ? (req.currentUser.stateId ?? null) : body.stateId ?? null);
    if (effectiveStateId != null) {
      const activeState = await assertActiveState(Number(effectiveStateId));
      if (!activeState.ok) {
        res.status(422).json({
          error: activeState.error,
          message: "New reports can only be created for an active State.",
        });
        return;
      }
    }

    // For Project and Activity Reports: use the project's (or activity's) authoritative sector as
    // the sector snapshot. For standalone activities, projectPrimarySector holds activity.sector.
    // This prevents user-supplied sector values from contradicting the authoritative source.
    const effectiveSector = (reportType === "project" || reportType === "activity")
      ? (projectPrimarySector ?? body.sector ?? null)
      : (body.sector ?? null);

    // Compute the immutable workflow path from the author's role at creation time.
    // For project/activity: SPO → state_authored (TC review mandatory);
    //                       TC and all other roles → technical_authored (no TC self-review).
    // For hq_sector: SPC author → 'spc_fallback' (vacancy-checked SPC fallback path,
    //   HQSR-BD-1/BD-6; PM is the coordination reviewer). Frozen at creation so a later
    //   role change for the author can never alter the report's approval path (Migration 019).
    //   TC / super_admin authored hq_sector reports remain NULL (normal simple chain).
    // For program_state: NULL (simple chain, author-independent).
    const newWorkflowPath = (reportType === "project" || reportType === "activity")
      ? (req.currentUser.role === "state_program_officer" ? "state_authored" : "technical_authored")
      : (reportType === "hq_sector" && req.currentUser.role === "senior_program_coordinator"
          ? "spc_fallback"
          : null);

    // ── HQ Project Report: transactional duplicate guard ─────────────────────
    // The existing unique indexes key on state_id; PostgreSQL treats NULLs as distinct
    // so they never fire for HQ (state_id IS NULL) reports.  New indexes in migration 015
    // add HQ-specific partial unique constraints, but we also do a SELECT-then-INSERT
    // guard here to surface a descriptive 409 rather than a raw constraint violation,
    // and to close the race between the GET duplicate-check and POST.
    if (reportType === "project" && rawLocationType === "hq") {
      type DupRow = { id: number };
      let dupCheck: DupRow[];
      if (body.kind === "monthly") {
        ({ rows: dupCheck } = await pool.query<DupRow>(
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
        ({ rows: dupCheck } = await pool.query<DupRow>(
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
        // annual
        ({ rows: dupCheck } = await pool.query<DupRow>(
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
        res.status(409).json({
          error: "duplicate_report_period",
          message: "An HQ project report already exists for this project and period combination.",
        });
        return;
      }
    }

    // ── State Programme Report: transactional duplicate guard ────────────────
    // Mirrors the SPR partial unique indexes so a duplicate produces a
    // descriptive 409 (duplicate_report_period) rather than a raw 23505, and
    // closes the race between the GET duplicate-check and the POST. The DB
    // indexes remain authoritative. on_demand has no unique index (multiple
    // allowed) so no guard applies.
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
        const { rows: sprDup } = await pool.query<{ id: number }>(sprDupSql, sprDupParams);
        if (sprDup.length > 0) {
          res.status(409).json({
            error: "duplicate_report_period",
            message: "A State Programme Report already exists for this State and reporting period.",
          });
          return;
        }
      }
    }

    // ── HQ Sector Report: transactional duplicate guard ──────────────────────
    // HQSR partial unique indexes (Migration 023) key on sector — PostgreSQL
    // treats NULLs as distinct so the SPR/project guards above (which key on
    // state_id / project_id) never fire for HQSR.  This guard produces a
    // descriptive 409 (duplicate_report_period) instead of a raw 23505 and
    // closes the race between the GET duplicate-check and POST.
    // on_demand HQSRs have no uniqueness constraint (multiple supplementary
    // reports per period are allowed).
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
        const { rows: hqsrDup } = await pool.query<{ id: number }>(hqsrDupSql, hqsrDupParams);
        if (hqsrDup.length > 0) {
          res.status(409).json({
            error: "duplicate_report_period",
            message:
              "An HQ Sector Report already exists for this Sector and reporting period.",
          });
          return;
        }
      }
    }

    let newId: number;
    try {
    const { rows } = await pool.query(
      `INSERT INTO reports (
         title, kind, report_type, activity_id,
         reporting_month, reporting_year, period_start, period_end,
         sector, submitted_to, project_id, state_id, period,
         narrative, executive_summary, challenges, recommendations,
         sections, beneficiaries_male, beneficiaries_female,
         beneficiaries_boys, beneficiaries_girls,
         planned_budget, actual_expenditure, activities, quarter,
         on_demand_reason, indicator_progress, activity_name, location_type,
         status, submitted_by_id, author_id, workflow_path, submitted_at
       ) VALUES (
         $1, $2, $3, $4,
         $5, $6, $7, $8,
         $9, $10, $11, $12, $13,
         $14, $15, $16, $17,
         $18, $19, $20,
         $21, $22,
         $23, $24, $25, $26,
         $27, $28, $31, $32,
         'draft', $29, $29, $30, NOW()
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
        effectiveSector,      // $9 — authoritative sector snapshot (from project or activity for activity reports)
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
        // This makes modern/legacy classification authoritative server-side:
        // no client can create an Activity Report without the marker, preventing
        // the creation→submit legacy-bypass path.
        // Non-activity report types: pass sections through unchanged.
        // jsonb columns (sections, activities, indicator_progress): must be passed as
        // JSON.stringify() strings so pg sends them as text that PostgreSQL parses as JSON.
        // The pg driver does NOT auto-serialize JS objects/arrays for jsonb — it falls back
        // to PostgreSQL array syntax which is invalid JSON and causes "invalid input syntax
        // for type json" errors on INSERT.
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
        req.currentUser.id,   // $29 → submitted_by_id and author_id
        newWorkflowPath,      // $30 → workflow_path
        rawActivityName, // $31 → activity_name (captured from req.body before Zod parse)
        rawLocationType, // $32 → location_type ("hq" | "state" | null)
      ],
    );
    newId = rows[0].id as number;
    } catch (err) {
      // Structured 409 for unique constraint violations (duplicate recurring period)
      if ((err as { code?: string }).code === "23505") {
        res.status(409).json({
          error: "duplicate_report_period",
          message:
            "A report already exists for this project / state / period combination. Only on-demand reports allow multiple entries per period.",
        });
        return;
      }
      throw err;
    }

    await logAudit({
      userId: req.currentUser.id,
      action: "create",
      module: "reports",
      entityId: newId,
      newValue: reportType,
    });
    realtime.broadcastUpdate?.({
      module: "reports",
      action: "created",
      entityId: newId,
      actorId: req.currentUser.id,
      actorName: req.currentUser.name,
    });
    const result = await pool.query(`${reportSelect} WHERE r.id = $1`, [newId]);
    const enriched = await withHistory(result.rows);
    res.status(201).json(enriched[0]);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /reports/authors — Scoped unique author facet for the Author filter
// ---------------------------------------------------------------------------
// Returns the complete set of unique (author_id, name) pairs present in the
// user's authorised Project Report population — independent of pagination.
// Accepts the same non-author, non-pagination filters as GET /reports so the
// option list stays stable regardless of the currently selected Author value
// (faceted-filter pattern: the Author dropdown never collapses to a single item).
// NULL author_ids are excluded: they represent anonymous records and must not
// produce a selectable filter identity.
// ---------------------------------------------------------------------------

router.get("/reports/authors", requirePerm("reports.view"), async (req, res, next) => {
  try {
    const filters: string[] = [];
    const params: unknown[] = [];

    // ── Non-author, non-pagination filters ───────────────────────────────────
    if (req.query.reportType) {
      params.push(String(req.query.reportType));
      filters.push(`r.report_type = $${params.length}`);
    }
    if (req.query.projectId) {
      if (String(req.query.projectId) === "standalone") {
        filters.push(`r.project_id IS NULL`);
      } else {
        params.push(Number(req.query.projectId));
        filters.push(`r.project_id = $${params.length}`);
      }
    }
    if (req.query.status) {
      params.push(String(req.query.status));
      filters.push(`r.status = $${params.length}`);
    }
    if (req.query.sector) {
      params.push(String(req.query.sector));
      filters.push(`COALESCE(NULLIF(r.sector,''), p.sector) = $${params.length}`);
    }
    if (req.query.kind) {
      params.push(String(req.query.kind));
      filters.push(`r.kind = $${params.length}`);
    }
    if (req.query.reportingYear) {
      params.push(Number(req.query.reportingYear));
      filters.push(`r.reporting_year = $${params.length}`);
    }
    if (req.query.reportingMonth) {
      params.push(Number(req.query.reportingMonth));
      filters.push(`r.reporting_month = $${params.length}`);
    }
    if (req.query.quarter) {
      params.push(Number(req.query.quarter));
      filters.push(`r.quarter = $${params.length}`);
    }
    if (req.query.activityId) {
      params.push(Number(req.query.activityId));
      filters.push(`r.activity_id = $${params.length}`);
    }
    // stateId: HQ users may pass an explicit stateId filter; state-scoped roles
    // are already clamped by applyReportScope below (passed param is ignored for them).
    if (req.query.stateId) {
      const isStateRole =
        req.currentUser?.role === "state_program_officer" ||
        req.currentUser?.role === "state_office_manager";
      if (!isStateRole) {
        params.push(Number(req.query.stateId));
        filters.push(`r.state_id = $${params.length}`);
      }
    }

    // ── RBAC scope + canonical type + operational population ─────────────────
    // When a reportType is passed explicitly we keep canonicalOnly=false so the
    // caller can request a specific type (e.g. "project") without colliding with
    // the general canonical filter; when no type is given we default to canonical.
    applyReportScope(req, filters, params, {
      excludeArchived: true,
      canonicalOnly: req.query.reportType ? false : true,
      reportType: req.query.reportType ? String(req.query.reportType) : undefined,
    });
    applyOperationalPopulation(filters);

    // ── Exclude NULL author_ids ───────────────────────────────────────────────
    // Reports with no author_id cannot produce a selectable filter identity.
    filters.push(`r.author_id IS NOT NULL`);

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    // Return DISTINCT (author_id, resolved name), sorted by name.
    // COALESCE with 'Former User' handles deleted accounts that had a non-null
    // author_id: they are selectable (filter by the stored ID still works),
    // but the display name falls back to the neutral historical label.
    const { rows } = await pool.query<{ id: number; name: string }>(
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

    res.json({ authors: rows });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /reports/activity-facet — Activities that have Activity Reports, RBAC-scoped
// Returns the distinct list of activities for which the current user has at
// least one Activity Report in their accessible scope. Powers the Activity
// filter dropdown on the Activity Reports listing page.
// ---------------------------------------------------------------------------

router.get("/reports/activity-facet", requirePerm("reports.view"), async (req, res, next) => {
  try {
    const filters: string[] = [];
    const params: unknown[] = [];

    // Always locked to activity report type
    params.push("activity");
    filters.push(`r.report_type = $${params.length}`);

    if (req.query.projectId) {
      if (String(req.query.projectId) === "standalone") {
        filters.push(`r.project_id IS NULL`);
      } else {
        params.push(Number(req.query.projectId));
        filters.push(`r.project_id = $${params.length}`);
      }
    }
    if (req.query.sector) {
      params.push(String(req.query.sector));
      filters.push(`COALESCE(NULLIF(r.sector,''), p.sector) = $${params.length}`);
    }
    // stateId: state-scoped roles are already clamped by applyReportScope;
    // honour the param for HQ users so they can pre-filter by state.
    if (req.query.stateId) {
      const isStateRole =
        req.currentUser?.role === "state_program_officer" ||
        req.currentUser?.role === "state_office_manager";
      if (!isStateRole) {
        params.push(Number(req.query.stateId));
        filters.push(`r.state_id = $${params.length}`);
      }
    }

    // RBAC scope (state lock / TC sector) + operational population
    applyReportScope(req, filters, params, {
      excludeArchived: true,
      canonicalOnly: false,   // report_type already pinned above
      reportType: "activity",
    });
    applyOperationalPopulation(filters);

    // Only rows with a resolved activity
    filters.push(`r.activity_id IS NOT NULL`);
    filters.push(`act.id IS NOT NULL`);

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    const { rows } = await pool.query<{ id: number; title: string; code: string | null }>(
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
    // Secondary sort: alphabetical by title
    rows.sort((a, b) => (a.title ?? "").localeCompare(b.title ?? ""));
    res.json({ activities: rows });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /reports/stats — Per-type counts using canonical status groups
// ---------------------------------------------------------------------------

router.get("/reports/stats", requirePerm("reports.view"), async (req, res, next) => {
  try {
    const filters: string[] = [];
    const params: unknown[] = [];

    applyReportScope(req, filters, params, {
      excludeArchived: false, // stats show all operational statuses; archive excluded below
      canonicalOnly: true,
    });
    // Exclude archived from stats
    filters.push(`r.status != 'archived'`);
    // Restrict to operational population — excludes migration duplicates and unverified records
    applyOperationalPopulation(filters);

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const { rows } = await pool.query<{
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
    res.json(stats);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /reports/export — Export all matching reports (no pagination limit)
// ---------------------------------------------------------------------------

router.get("/reports/export", requirePerm("reports.view"), async (req, res, next) => {
  try {
    const filters: string[] = [];
    const params: unknown[] = [];

    if (req.query.projectId) {
      if (String(req.query.projectId) === "standalone") {
        filters.push(`r.project_id IS NULL`);
      } else {
        params.push(Number(req.query.projectId));
        filters.push(`r.project_id = $${params.length}`);
      }
    }
    if (req.query.status) {
      params.push(String(req.query.status));
      filters.push(`r.status = $${params.length}`);
    }
    if (req.query.reportType) {
      params.push(String(req.query.reportType));
      filters.push(`r.report_type = $${params.length}`);
    }
    if (req.query.kind) {
      params.push(String(req.query.kind));
      filters.push(`r.kind = $${params.length}`);
    }
    if (req.query.sector) {
      params.push(String(req.query.sector));
      filters.push(`COALESCE(NULLIF(r.sector,''), p.sector) = $${params.length}`);
    }
    if (req.query.reportingYear) {
      params.push(Number(req.query.reportingYear));
      filters.push(`r.reporting_year = $${params.length}`);
    }
    if (req.query.reportingMonth) {
      params.push(Number(req.query.reportingMonth));
      filters.push(`r.reporting_month = $${params.length}`);
    }
    if (req.query.quarter) {
      params.push(Number(req.query.quarter));
      filters.push(`r.quarter = $${params.length}`);
    }
    if (req.query.authorId) {
      params.push(Number(req.query.authorId));
      filters.push(`r.author_id = $${params.length}`);
    }
    if (req.query.activityId) {
      params.push(Number(req.query.activityId));
      filters.push(`r.activity_id = $${params.length}`);
    }

    const includeArchived = req.query.status === "archived";
    applyReportScope(req, filters, params, {
      excludeArchived: !includeArchived,
      canonicalOnly: req.query.reportType ? false : true,
      reportType: req.query.reportType ? String(req.query.reportType) : undefined,
    });
    applyOperationalPopulation(filters);

    if (req.query.stateId) {
      const isStateRole =
        req.currentUser?.role === "state_program_officer" ||
        req.currentUser?.role === "state_office_manager";
      if (!isStateRole) {
        params.push(Number(req.query.stateId));
        filters.push(`r.state_id = $${params.length}`);
      }
    }

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const { rows: rawRows } = await pool.query(
      `${reportSelect} ${where} ORDER BY r.submitted_at DESC NULLS LAST, r.id DESC LIMIT $${params.length + 1}`,
      [...params, REPORT_EXPORT_MAX_ROWS + 1],
    );

    // MAX+1 sentinel: if we got more than the cap, the result set is larger than the limit.
    const truncated = rawRows.length > REPORT_EXPORT_MAX_ROWS;
    const rows = truncated ? rawRows.slice(0, REPORT_EXPORT_MAX_ROWS) : rawRows;

    res.setHeader("X-Report-Truncated", String(truncated));
    res.setHeader("X-Report-Export-Limit", String(REPORT_EXPORT_MAX_ROWS));
    res.json(await withHistory(rows));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /reports/duplicate-check
// ---------------------------------------------------------------------------

router.get("/reports/duplicate-check", requirePerm("reports.view"), async (req, res, next) => {
  try {
    const { projectId, stateId, locationType: dupLocationType, frequency, period, activityId, reportType: qReportType } = req.query;
    const isActivityDupCheck = qReportType === "activity" || !!activityId;

    // For Activity duplicate checks: period alone is required (kind/frequency is not a discriminator).
    // For non-Activity checks: both frequency and period are required.
    if (!period) {
      res.status(400).json({ error: "period is required" });
      return;
    }
    if (!isActivityDupCheck && !frequency) {
      res.status(400).json({ error: "frequency and period are required" });
      return;
    }

    // Activity duplicate check: uniqueness key = activity_id + state_id + period (kind excluded)
    // FIX-05: kind is no longer a duplicate discriminator for Activity Reports — two records for the
    // same activity + state + period are duplicates regardless of their stored kind value.
    if (isActivityDupCheck) {
      if (!activityId) {
        // Standalone or project-linked activity report — no activity-based uniqueness key.
        // Duplicate detection is not applicable for these modes; return no match.
        res.json({ matchType: "none" });
        return;
      }

      // ── Scope enforcement — source-aware sector + state checks ──────────────
      // The duplicate-check endpoint returns report metadata. Without scope checks
      // any user holding reports.view could probe activity/state/period combinations
      // outside their authorised population (including standalone activities).
      const actScopeRow = await pool.query<{
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
        res.status(404).json({ error: "activity_not_found" });
        return;
      }
      const { actProjectId, actSector, projectSector } = actScopeRow.rows[0];
      // Source-aware effective sector: project-linked uses project sector; standalone uses activity sector.
      const dcEffectiveSector = actProjectId !== null ? projectSector : actSector;
      const dcSectorGuard = assertSectorAllowed(req, dcEffectiveSector);
      if (!dcSectorGuard.ok) {
        res.status(dcSectorGuard.status).json(dcSectorGuard.body);
        return;
      }
      // State scope: SPO/SOM must not probe reports assigned to a different state.
      const isDcStateRole =
        req.currentUser?.role === "state_program_officer" ||
        req.currentUser?.role === "state_office_manager";
      if (isDcStateRole && req.currentUser?.stateId && stateId) {
        if (Number(stateId) !== req.currentUser.stateId) {
          res.status(403).json({ error: "state_scope_forbidden" });
          return;
        }
      }

      // on_demand Activity Reports are always exempt from recurring-period uniqueness checks.
      // This preserves the pre-FIX-05 business rule: on-demand events have no recurring
      // schedule, so two on-demand reports for the same activity are never "duplicates".
      // FIX-05 only removes kind as a discriminator for *recurring* (monthly/quarterly/annual)
      // Activity Reports — it does not broaden the on-demand exemption.
      if (String(frequency) === "on_demand") {
        res.json({ matchType: "none" });
        return;
      }

      // FIX-05: kind is NOT included in the uniqueness key for recurring Activity Reports.
      // Uniqueness is determined by activity_id + state_id + period only.
      const { rows } = await pool.query(
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
        res.json({ matchType: "none" });
      } else {
        res.json({ matchType: "exact", existingReport: rows[0] });
      }
      return;
    }

    // ── State Programme Report (program_state) duplicate check ───────────────
    // Mirrors the partial unique DB indexes exactly (migration set):
    //   monthly:   (report_type, state_id, kind, reporting_year, reporting_month)
    //   quarterly: (report_type, state_id, kind, reporting_year, quarter)
    //   annual:    (report_type, state_id, kind, reporting_year)
    // all excluding status IN ('rejected','archived'). on_demand has NO unique
    // index — multiple on-demand SPRs per State are intentionally allowed.
    if (qReportType === "program_state") {
      // Resolve the effective stateId. Full-operational-access roles (PM /
      // super_admin — no hard-coded State restriction per #373) may supply an
      // arbitrary stateId; State-scoped users are clamped to their own state so
      // this endpoint cannot be used to probe other States' reports.
      const isFullAccessRole =
        req.currentUser?.role === "program_manager" ||
        req.currentUser?.role === "super_admin";
      const effectiveStateId: number | null = isFullAccessRole
        ? (stateId ? Number(stateId) : null)
        : (req.currentUser?.stateId ?? null);

      if (effectiveStateId === null || Number.isNaN(effectiveStateId)) {
        // Null state: fail closed — no check possible, no data leaked.
        res.json({ matchType: "none" });
        return;
      }

      const freq = String(frequency);
      const periodStr = String(period);

      // On-demand: multiple allowed per DB — never a duplicate.
      if (freq === "on_demand") {
        res.json({ matchType: "none" });
        return;
      }

      // Parse the period string into components matching the DB columns.
      //   monthly:   "YYYY-MM"   quarterly: "YYYY-Q{n}"   annual: "YYYY"
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
        res.status(400).json({ error: "invalid_period_for_frequency" });
        return;
      }

      // Response deliberately exposes only id/title/period/status — no author,
      // content, or evidence details.
      const { rows: sprRows } = await pool.query<{ id: number; title: string; period: string; status: string }>(
        sprSql,
        sprParams,
      );
      if (sprRows.length === 0) {
        res.json({ matchType: "none" });
      } else {
        res.json({ matchType: "exact", existingReport: sprRows[0] });
      }
      return;
    }

    // Project duplicate check
    if (!projectId) {
      res.status(400).json({ error: "projectId is required for project duplicate-check" });
      return;
    }
    // HQ project reports: uniqueness key is project + location_type='hq' + period (state_id IS NULL).
    // State project reports: uniqueness key is project + state_id + period.
    const isDupHq = dupLocationType === "hq";
    let dupRows: Array<{ id: number; title: string; period: string; status: string }>;
    if (isDupHq) {
      const { rows } = await pool.query<{ id: number; title: string; period: string; status: string }>(
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
      const { rows } = await pool.query<{ id: number; title: string; period: string; status: string }>(
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
      res.json({ matchType: "none" });
    } else {
      res.json({ matchType: "exact", existingReport: dupRows[0] });
    }
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /reports/:reportId
// ---------------------------------------------------------------------------

router.get("/reports/:reportId", requirePerm("reports.view"), async (req, res, next) => {
  try {
    const reportId = Number(req.params.reportId as string);
    if (isNaN(reportId)) {
      res.status(400).json({ error: "invalid report id" });
      return;
    }
    const sector = await getReportSectorForAuth(reportId);
    if (sector === undefined) {
      res.status(404).json({ error: "report not found" });
      return;
    }
    // State scope enforcement for state roles — knowing a report ID must not bypass list RBAC.
    const isStateRole =
      req.currentUser?.role === "state_program_officer" ||
      req.currentUser?.role === "state_office_manager";
    if (isStateRole) {
      // Fail closed: a state-scoped role with no assigned state sees nothing.
      if (!req.currentUser?.stateId) {
        res.status(403).json({ error: "state_scope_forbidden" });
        return;
      }
      const stateCheck = await pool.query<{ state_id: number | null; project_id: number | null }>(
        `SELECT state_id, project_id FROM reports WHERE id = $1`,
        [reportId],
      );
      if (
        stateCheck.rows.length > 0 &&
        stateCheck.rows[0].state_id !== req.currentUser.stateId
      ) {
        res.status(403).json({ error: "state_scope_forbidden" });
        return;
      }
      // SPOs are additionally clamped to their assigned projects (mirrors
      // buildScope() in dashboard.ts) — a guessed report ID must not expose
      // an unassigned project's report even within their own state.
      if (
        req.currentUser?.role === "state_program_officer" &&
        stateCheck.rows.length > 0 &&
        stateCheck.rows[0].project_id !== null
      ) {
        const asg = await pool.query<{ project_id: number }>(
          `SELECT DISTINCT project_id FROM project_assignments WHERE user_id = $1`,
          [req.currentUser.id],
        );
        const assigned = new Set(asg.rows.map((r) => r.project_id));
        if (!assigned.has(stateCheck.rows[0].project_id)) {
          res.status(403).json({ error: "state_scope_forbidden" });
          return;
        }
      }
    }
    const guard = assertSectorAllowed(req, sector);
    if (!guard.ok) {
      res.status(guard.status).json(guard.body);
      return;
    }
    const result = await pool.query(`${reportSelect} WHERE r.id = $1`, [reportId]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: "report not found" });
      return;
    }
    const enriched = await withHistory(result.rows);
    res.json(enriched[0]);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PATCH /reports/:reportId — Update a draft report
// ---------------------------------------------------------------------------

router.patch(
  "/reports/:reportId",
  // SPR-003/004 SOM fallback: SOM (narrow reports.program_state.create) may
  // edit ONLY their own program_state drafts — enforced by the SOM defence
  // guard inside the handler. Everyone else needs reports.update as before.
  requireReportsUpdateOrSomSprAuthor,
  async (req, res, next) => {
    try {
      if (!req.currentUser) {
        res.status(401).json({ error: "no current user" });
        return;
      }
      const reportId = Number(req.params.reportId as string);
      const cur = await pool.query<{
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
        res.status(404).json({ error: "report not found" });
        return;
      }
      if (cur.rows[0].status !== "draft") {
        res.status(409).json({ error: "only_draft_reports_can_be_updated" });
        return;
      }

      // Author ownership: only the original report author may edit a draft.
      // Super-admin may bypass for administrative corrections.
      // Program Manager may bypass via Full Operational Access (Task #373) —
      // identity/integrity fields are still protected (super_admin bypass only).
      const authorId = cur.rows[0].authorId;
      const isSuperAdmin = req.currentUser.role === "super_admin";
      const isDraftEditFullAccess = hasFullOperationalAccess(req.currentUser);

      // ── SOM fallback defence (SPR-003/004) ────────────────────────────────
      // SOM reaches this handler only via the narrow fallback permission and
      // may edit exclusively their own program_state drafts in their OWN
      // current state. Fail closed when either state id is null (reassigned or
      // unassigned SOM loses access to old drafts). This also closes the
      // authorId=null historical-draft loophole for SOM.
      if (req.currentUser.role === "state_office_manager") {
        const somStateId = req.currentUser.stateId ?? null;
        const reportStateId = cur.rows[0].stateId ?? null;
        if (
          cur.rows[0].reportType !== "program_state" ||
          authorId !== req.currentUser.id ||
          somStateId === null ||
          reportStateId === null ||
          reportStateId !== somStateId
        ) {
          res.status(403).json({
            error: "som_program_state_author_only",
            message: "State Office Managers can only edit State Programme Report drafts they authored for their own state.",
          });
          return;
        }
      }

      // Full Operational Access (PM/super_admin) bypasses author ownership.
      // author_id is preserved unchanged — the original creator is never mutated.
      if (!isDraftEditFullAccess && authorId !== null && authorId !== req.currentUser.id) {
        res.status(403).json({
          error: "draft_edit_forbidden",
          message: "Only the original report author can edit this draft.",
        });
        return;
      }

      const sector = await getReportSectorForAuth(reportId);
      const guard = assertSectorAllowed(req, sector ?? null);
      if (!guard.ok) {
        res.status(guard.status).json(guard.body);
        return;
      }
      const body = req.body as Record<string, unknown>;

      // ── Activity Report identity immutability ─────────────────────────────────
      // activityId / projectId / stateId / locationType form the immutable identity of an
      // Activity Report. Even in draft, these fields cannot be changed: doing so would allow
      // period-duplicate bypass and break workflow_path / author traceability.
      // locationType is also immutable because changing it would alter the geographic identity
      // of the report (state AR ↔ HQ AR) after creation.
      // super_admin may bypass for administrative corrections.
      if (cur.rows[0].reportType === "activity" && !isSuperAdmin) {
        const identityFields = ["activityId", "projectId", "stateId", "locationType"];
        const attempted = identityFields.filter((f) => body[f] !== undefined);
        if (attempted.length > 0) {
          res.status(409).json({
            error: "activity_identity_immutable",
            message: `Activity Report identity fields cannot be changed after creation: ${attempted.join(", ")}.`,
          });
          return;
        }
      }

      // ── Project Report identity immutability ──────────────────────────────────
      // projectId / stateId / locationType / period / reportingMonth / reportingYear / quarter
      // form the immutable identity triple (project + location + period) of a PMR.
      // Even in draft, these fields cannot be changed: doing so would allow duplicate-check
      // bypass and break the project-location-period uniqueness constraint.
      // super_admin may bypass for administrative corrections.
      if (cur.rows[0].reportType === "project" && !isSuperAdmin) {
        const pmrIdentityFields = ["projectId", "stateId", "locationType", "period", "reportingMonth", "reportingYear", "quarter"];
        const attempted = pmrIdentityFields.filter((f) => body[f] !== undefined);
        if (attempted.length > 0) {
          res.status(409).json({
            error: "project_report_identity_immutable",
            message: `Project Report identity fields cannot be changed after creation: ${attempted.join(", ")}.`,
          });
          return;
        }
      }

      // ── State Programme Report identity immutability ──────────────────────────
      // stateId / kind / period / reportingMonth / reportingYear / quarter /
      // periodStart / periodEnd form the immutable business identity of an SPR
      // (program_state + state + frequency + reporting period). Even in draft,
      // these fields cannot be changed: doing so would let a state-scoped author
      // move a report outside their own state or bypass period uniqueness.
      // reportType is included defensively (the generic PATCH never writes it,
      // but a present key must be rejected explicitly, not silently ignored).
      // super_admin may bypass for administrative corrections.
      if (cur.rows[0].reportType === "program_state" && !isSuperAdmin) {
        const sprIdentityFields = [
          "stateId", "kind", "period", "reportingMonth", "reportingYear",
          "quarter", "periodStart", "periodEnd", "reportType",
        ];
        const attempted = sprIdentityFields.filter((f) => body[f] !== undefined);
        if (attempted.length > 0) {
          res.status(409).json({
            error: "program_state_report_identity_immutable",
            message: `State Programme Report identity fields cannot be changed after creation: ${attempted.join(", ")}.`,
          });
          return;
        }
      }

      // ── HQ Sector Report identity immutability (HQSR-002) ─────────────────────
      // sector / kind / period / reportingMonth / reportingYear / quarter /
      // periodStart / periodEnd / stateId / projectId form the immutable business
      // identity of an HQ Sector Report. Even in draft, these fields cannot be
      // changed: doing so would let a TC reassign their report to a different
      // sector after creation, defeating the sector-scoped author gate.
      // reportType is included defensively (a present key must be rejected
      // explicitly, not silently ignored). Presence alone triggers rejection —
      // even a PATCH re-sending the same value is a 409.
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
          res.status(409).json({
            error: "hq_sector_report_identity_immutable",
            message: `HQ Sector Report identity fields cannot be changed after creation: ${attempted.join(", ")}.`,
          });
          return;
        }
      }

      // ── FIX-08: _schemaVersion immutability guard ─────────────────────────────
      // Once an Activity Report has been marked as modern (_schemaVersion:"modern" in sections),
      // that marker cannot be removed or cleared via PATCH. Without this guard a client could
      // send sections:null (or sections without the marker), causing the submit transition to
      // treat the report as legacy and skip all content checks.
      // super_admin is exempt (administrative corrections only).
      if (cur.rows[0].reportType === "activity" && !isSuperAdmin) {
        const existingSections = cur.rows[0].sections ?? {};
        if (existingSections["_schemaVersion"] === "modern" && body["sections"] !== undefined) {
          if (body["sections"] === null) {
            // Null clears the entire sections JSONB including _schemaVersion — reject it.
            res.status(409).json({
              error: "modern_schema_version_immutable",
              message:
                "Cannot clear sections of a modern Activity Report. " +
                "Send an empty object {} to clear content fields while preserving the schema version.",
            });
            return;
          }
          // sections is a non-null object — preserve the marker if the client omitted it
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
              res.status(400).json({ error: "validation_error", message: `${f} must be a non-negative whole number` });
              return;
            }
          }
        }
        const acts = body["activities"];
        if (Array.isArray(acts)) {
          for (const act of acts as Record<string, unknown>[]) {
            const pct = act["percent"] !== undefined ? Number(act["percent"]) : undefined;
            if (pct !== undefined && (!Number.isFinite(pct) || !Number.isInteger(pct) || pct < 0 || pct > 100)) {
              res.status(400).json({ error: "validation_error", message: "Activity implementation % must be a whole number between 0 and 100" });
              return;
            }
            for (const bf of ["beneficiariesMen", "beneficiariesWomen", "beneficiariesBoys", "beneficiariesGirls"]) {
              const bv = act[bf];
              if (bv !== undefined && bv !== null) {
                const num = Number(bv);
                if (!Number.isFinite(num) || !Number.isInteger(num) || num < 0) {
                  res.status(400).json({ error: "validation_error", message: `Activity ${bf} must be a non-negative whole number` });
                  return;
                }
              }
            }
          }
        }
      }

      // Validate kind if provided (all report types — no special exemptions).
      // For Activity Report edits the frontend omits kind from the payload so the DB value is
      // preserved as-is; this check therefore never fires for Activity Report PATCH in practice.
      // Keeping the validation unconditional prevents arbitrary kind strings from being stored
      // if a client bypasses the frontend omission.
      if (body.kind !== undefined && !isCanonicalFrequency(body.kind)) {
        res.status(400).json({
          error: "invalid_frequency",
          message: `kind must be one of: ${CANONICAL_FREQUENCIES.join(", ")}`,
        });
        return;
      }

      const set = (col: string, val: unknown) =>
        `${col} = $${(setCols.push(val), setCols.length + 1)}`;
      const setCols: unknown[] = [];
      const sets: string[] = [];

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
        res.status(400).json({ error: "no_fields_to_update" });
        return;
      }
      sets.push(`updated_at = NOW()`);

      const baseRevision = req.header("x-base-revision");
      const update = await pool.query(
        `UPDATE reports SET ${sets.join(", ")} WHERE id = $1${baseRevision ? ` AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $${setCols.length + 2}::timestamptz)` : ""}`,
        [reportId, ...setCols, ...(baseRevision ? [baseRevision] : [])],
      );
      if (baseRevision && update.rowCount === 0) {
        res.status(409).json({ error: "offline_conflict", code: "revision_mismatch", message: "The report changed while this draft was offline." });
        return;
      }

      await logAudit({
        userId: req.currentUser.id,
        action: "update",
        module: "reports",
        entityId: reportId,
      });
      realtime.broadcastUpdate?.({
        module: "reports",
        action: "updated",
        entityId: reportId,
        actorId: req.currentUser.id,
        actorName: req.currentUser.name,
      });
      const result = await pool.query(`${reportSelect} WHERE r.id = $1`, [reportId]);
      const enriched = await withHistory(result.rows);
      res.json(enriched[0]);
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /reports/:reportId/aggregates — Auto-pulled project data
// ---------------------------------------------------------------------------

router.get(
  "/reports/:reportId/aggregates",
  requirePerm("reports.view"),
  async (req, res, next) => {
    try {
      const reportId = Number(req.params.reportId as string);
      if (isNaN(reportId)) {
        res.status(400).json({ error: "invalid report id" });
        return;
      }

      // Enforce sector scope (same as GET /reports/:reportId)
      const sector = await getReportSectorForAuth(reportId);
      if (sector === undefined) {
        res.status(404).json({ error: "report not found" });
        return;
      }
      const sectorGuard = assertSectorAllowed(req, sector);
      if (!sectorGuard.ok) {
        res.status(sectorGuard.status).json(sectorGuard.body);
        return;
      }
      // Enforce state scope (SPO/SOM must only access reports within their state)
      const isStateRole =
        req.currentUser?.role === "state_program_officer" ||
        req.currentUser?.role === "state_office_manager";
      if (isStateRole && req.currentUser?.stateId) {
        const stateCheck = await pool.query<{ state_id: number | null }>(
          `SELECT state_id FROM reports WHERE id = $1`,
          [reportId],
        );
        if (stateCheck.rows.length > 0 && stateCheck.rows[0].state_id !== req.currentUser.stateId) {
          res.status(403).json({ error: "state_scope_forbidden" });
          return;
        }
      }

      const reportRow = await pool.query(
        `SELECT project_id AS "projectId" FROM reports WHERE id = $1`,
        [reportId],
      );
      if (reportRow.rows.length === 0) {
        res.status(404).json({ error: "report not found" });
        return;
      }
      const projectId = reportRow.rows[0].projectId as number | null;
      if (!projectId) {
        res.status(404).json({ error: "no_project_linked" });
        return;
      }

      const [bRow, budgetRow, actRow, indRow, riskRow] = await Promise.all([
        pool.query<{ male: string; female: string; boys: string; girls: string }>(
          `SELECT
             COALESCE(SUM(beneficiaries_male),0)   AS male,
             COALESCE(SUM(beneficiaries_female),0) AS female,
             COALESCE(SUM(beneficiaries_boys),0)   AS boys,
             COALESCE(SUM(beneficiaries_girls),0)  AS girls
           FROM beneficiaries WHERE project_id = $1`,
          [projectId],
        ),
        // `project_budgets` never existed in the tracked schema — this query used to
        // throw on every real call. activities.budget_planned/budget_spent is the
        // canonical project-budget source used everywhere else (GET /projects/:id/budget,
        // dashboard.ts), so it's used here too.
        pool.query<{ planned: string; actual: string }>(
          `SELECT
             COALESCE(SUM(budget_planned),0)   AS planned,
             COALESCE(SUM(budget_spent),0)     AS actual
           FROM activities WHERE project_id = $1`,
          [projectId],
        ),
        pool.query(
          `SELECT a.id, a.title, a.status,
                  a.planned_start AS "startDate", a.planned_end AS "endDate"
           FROM activities a WHERE a.project_id = $1
           ORDER BY a.id LIMIT 50`,
          [projectId],
        ),
        pool.query(
          `SELECT i.id, COALESCE(i.title, i.name) AS name,
                  i.target, COALESCE(i.achieved,0) AS achieved, i.unit
           FROM indicators i WHERE i.project_id = $1 LIMIT 30`,
          [projectId],
        ),
        pool.query(
          `SELECT id, title, severity, status FROM risks
           WHERE project_id = $1 AND status NOT IN ('resolved','closed')
           ORDER BY id LIMIT 20`,
          [projectId],
        ),
      ]);

      const b = bRow.rows[0];
      const bg = budgetRow.rows[0];
      const planned = Number(bg.planned);
      const actual = Number(bg.actual);
      const pRow = await pool.query<{ title: string }>(
        `SELECT title FROM projects WHERE id = $1`,
        [projectId],
      );
      res.json({
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
          // Null (not 0) when there's no valid planned amount to divide by — matches
          // budget-presentation.ts's projectBurnRate convention used everywhere else.
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
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// DELETE /reports/:reportId — Hard-delete draft (creator or super_admin)
// ---------------------------------------------------------------------------

router.delete(
  "/reports/:reportId",
  requirePerm("reports.delete"), // PERM-03: dedicated delete permission, consistent with projects.delete and plans.delete.
  // Creator (author_id) or super_admin may delete a draft report.
  async (req, res, next) => {
    try {
      if (!req.currentUser) {
        res.status(401).json({ error: "no current user" });
        return;
      }
      const reportId = Number(req.params.reportId as string);
      const cur = await pool.query(
        `SELECT status, author_id AS "authorId" FROM reports WHERE id = $1`,
        [reportId],
      );
      if (cur.rows.length === 0) {
        res.status(404).json({ error: "report not found" });
        return;
      }
      if (cur.rows[0].status !== "draft") {
        res.status(409).json({ error: "only_draft_reports_can_be_deleted" });
        return;
      }
      const perms = permissionsFor(req.currentUser);
      // Fail closed if author_id is null (legacy record without backfill) to prevent
      // a permissive delete for normal roles. PM and super_admin (Full Operational Access)
      // bypass author-ownership and may delete any draft — including null-author legacy rows —
      // as an operational action. Both roles are trusted; the deletion is audit-logged.
      const authorId = cur.rows[0].authorId as number | null;
      const isDeleteFullAccess = hasFullOperationalAccess(req.currentUser);
      if (!isDeleteFullAccess && (authorId === null || authorId !== req.currentUser.id)) {
        res.status(403).json({ error: "only_creator_or_admin_can_delete" });
        return;
      }
      let deletionAudience: Awaited<ReturnType<typeof realtime.captureOperationalAudience>> | undefined;
      // Collect all evidence object paths BEFORE any DB delete
      const attachmentPathsResult = await pool.query<{ object_path: string }>(
        `SELECT object_path FROM report_attachments WHERE report_id = $1 AND object_path <> ''`,
        [reportId],
      );
      const voicePathsResult = await pool.query<{ object_path: string }>(
        `SELECT object_path FROM voice_notes WHERE entity_type = 'report' AND entity_id = $1 AND object_path IS NOT NULL AND object_path <> ''`,
        [reportId],
      );
      const rawAttachmentPaths = attachmentPathsResult.rows.map((r) => r.object_path);
      const rawVoicePaths = voicePathsResult.rows.map((r) => r.object_path);

      // Deduplicate: a path shared between an attachment and a voice note for the
      // same report should only be deleted once.
      const allUniquePaths = [...new Set([...rawAttachmentPaths, ...rawVoicePaths])];

      // Cross-table ownership check: a path is safe to delete when no record
      // OUTSIDE this report's deletion set references it.  Paths shared within
      // the report (attachment + voice note both reference the same path) are safe
      // because after this deletion, no record will reference them.
      const partition = await partitionSafeStoragePathsForReport(reportId, allUniquePaths);
      if (partition.skipped.length > 0) {
        console.warn("[ATT-05] report_delete skipping %d path(s) with external refs reportId=%d", partition.skipped.length, reportId);
      }

      const safeObjectPaths = partition.safe;

      // Delete all safe storage objects OUTSIDE any DB transaction
      for (const objectPath of safeObjectPaths) {
        try {
          await deleteStorageObjectSafely(objectPath);
        } catch (_storErr) {
          console.error("[ATT-05] report_delete storage_error reportId=%d objectPath=%s", reportId, objectPath);
          res.status(500).json({ error: "report_evidence_storage_delete_failed" });
          return;
        }
      }

      // All storage objects cleaned — now delete DB rows in a single transaction
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // Hold the report lock before capturing its authorised deletion
        // audience, so an identity/scope PATCH cannot race the snapshot.
        await client.query(`SELECT id FROM reports WHERE id = $1 FOR UPDATE`, [reportId]);
        deletionAudience = await realtime.captureOperationalAudience?.("report", reportId, client);
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

      await logAudit({
        userId: req.currentUser.id,
        action: "delete",
        module: "reports",
        entityId: reportId,
      });
      realtime.broadcastUpdate?.({
        module: "reports",
        action: "deleted",
        entityId: reportId,
        actorId: req.currentUser.id,
        actorName: req.currentUser.name,
        deletionAudience,
      });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// validateProjectReportForSubmission — Backend content gate for Project Reports
// ---------------------------------------------------------------------------
// Mirrors the frontend PMR validateSubmit rules exactly so a direct API call
// cannot bypass frontend validation.  Called only on action=submit for
// report_type=project — draft PATCH is always permissive.
// ---------------------------------------------------------------------------

type PmrContentError = { field: string; section?: string; reason: string };

/** Minimal duck-type for a DB client capable of parameterised queries — avoids a direct pg import. */
type PmrQueryClient = {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ rows: T[] }>;
};

async function validateProjectReportForSubmission(
  row: Record<string, unknown>,
  client: PmrQueryClient,
): Promise<PmrContentError[]> {
  const errors: PmrContentError[] = [];
  const sections  = (row.sections  ?? {}) as Record<string, unknown>;
  const activities = Array.isArray(row.activities)
    ? (row.activities as Array<Record<string, unknown>>)
    : [];

  // §1 — Title (always required)
  if (!String(row.title ?? "").trim()) {
    errors.push({ field: "title", reason: "Report Title is required." });
  }

  // §2 — Project identity (always required for project reports)
  if (!row.project_id) {
    errors.push({ field: "projectId", reason: "Project is required." });
  }

  // §3 — Reporting location: state required unless location_type is 'hq'
  if (row.location_type !== "hq" && !row.state_id) {
    errors.push({ field: "stateId", reason: "State is required for state-scoped reports." });
  }

  // §4 — Period (kind-specific)
  const kind          = String(row.kind ?? "monthly");
  const period        = String(row.period ?? "");
  const reportingYear = row.reporting_year  != null ? Number(row.reporting_year)  : null;
  const reportingMonth= row.reporting_month != null ? Number(row.reporting_month) : null;
  const quarter       = row.quarter         != null ? Number(row.quarter)         : null;

  if (kind === "monthly") {
    if (!reportingYear || !reportingMonth) {
      errors.push({ field: "period", reason: "Reporting year and month are required for monthly reports." });
    } else {
      // Consistency check — only for modern YYYY-MM format periods.
      // Historical records may carry a non-standard period string (e.g. "Q3-2025"); apply the
      // guard only when the stored period already matches the modern format to avoid blocking
      // re-submission of legacy records.
      const expectedPeriod = `${reportingYear}-${String(reportingMonth).padStart(2, "0")}`;
      if (/^\d{4}-\d{2}$/.test(period) && period !== expectedPeriod) {
        errors.push({ field: "period", reason: "Reporting period is inconsistent with reporting month/year." });
      }
    }
  } else if (kind === "quarterly") {
    if (!reportingYear || !quarter || quarter < 1 || quarter > 4) {
      errors.push({ field: "period", reason: "Reporting year and valid quarter (1–4) are required for quarterly reports." });
    } else {
      const expectedPeriod = `${reportingYear}-Q${quarter}`;
      if (/^\d{4}-Q\d$/.test(period) && period !== expectedPeriod) {
        errors.push({ field: "period", reason: "Reporting period is inconsistent with reporting year/quarter." });
      }
    }
  } else if (kind === "annual") {
    if (!reportingYear) {
      errors.push({ field: "period", reason: "Reporting year is required for annual reports." });
    }
  } else if (kind === "on_demand") {
    // on_demand_reason is a top-level column; periodStart is period_start column.
    // period_start is required unconditionally — the general `period` column is not a substitute
    // (it may carry a legacy string that does not represent the on-demand start date).
    if (!String(row.period_start ?? "").trim()) {
      errors.push({ field: "periodStart", reason: "Period start is required for on-demand reports." });
    }
    if (!String(row.on_demand_reason ?? "").trim()) {
      errors.push({ field: "onDemandReason", reason: "On-demand reason is required." });
    }
  }

  // §5 — Key Achievements (required progress field in sectionsCfg.progress)
  if (!String(sections["keyAchievements"] ?? "").trim()) {
    errors.push({ field: "keyAchievements", section: "progress", reason: "Key Achievements is required." });
  }

  // §6 — Lessons Learned (required narrative field in sectionsCfg.narrative)
  if (!String(sections["lessonsLearned"] ?? "").trim()) {
    errors.push({ field: "lessonsLearned", section: "narrative", reason: "Lessons Learned is required." });
  }

  // §7 — Activities: at least one named activity required (project type only)
  // Note: activity JSONB keys are camelCase as sent by the frontend and stored verbatim.
  //
  // Numeric safety: a draft PATCH does not validate activity JSONB internals, so a stored value
  // may be a non-numeric string (e.g. "not-a-number").  Number("not-a-number") === NaN; NaN passes
  // both `=== null` and `< 0` checks, allowing an invalid record to slip through.  Use finiteNum()
  // so any non-finite value is treated as missing/invalid (null) rather than silently accepted.
  const finiteNum = (v: unknown): number | null => {
    if (v === null || v === undefined) return null;
    // Blank/whitespace strings are treated as missing — mirrors the frontend rule
    // `a.actualExpenditure === "" ? null : Number(...)` which blocks empty-string submit.
    // Note: Number("") === 0, so this check MUST precede Number() conversion.
    if (typeof v === "string" && !v.trim()) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  // Beneficiary field parser: distinguishes blank/missing from explicit zero.
  // Only accepts number or string types — booleans, arrays, objects, etc. are rejected as invalid.
  // Returns null     → field is blank/missing/non-numeric (required — reporter must enter 0 if no reach)
  // Returns "negative" → value is a valid number but negative (invalid)
  // Returns number   → valid integer ≥ 0 (includes explicit zero)
  const parseBenField = (v: unknown): number | null | "negative" => {
    if (v === null || v === undefined) return null;
    // Reject non-string, non-number types (booleans, arrays, objects)
    if (typeof v !== "number" && typeof v !== "string") return null;
    if (typeof v === "string" && !v.trim()) return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    if (n < 0) return "negative";
    return Math.floor(n);
  };

  // Junk-entry safety: activities JSONB may contain null, arrays, or scalar
  // entries after a permissive draft PATCH — a member access on those would
  // throw and turn a malformed submit into a 500. Every non-plain-object
  // entry is itself a validation error (422), never silently ignored and
  // never a 500, so malformed persisted JSONB can never reach approval.
  const isPlainObject = (a: unknown): a is Record<string, unknown> =>
    a !== null && typeof a === "object" && !Array.isArray(a);
  activities.forEach((a, i) => {
    if (!isPlainObject(a)) {
      errors.push({ field: `activities[${i}]`, reason: `Activity entry ${i + 1} is malformed (expected an object).` });
    }
  });
  const cleanActs = activities.filter(
    (a): a is Record<string, unknown> => isPlainObject(a) && Boolean(String(a["name"] ?? "").trim()),
  );
  if (cleanActs.length === 0) {
    errors.push({ field: "activities", reason: "At least one named activity is required." });
  } else {
    let hasAnyPositiveExpenditure = false;

    for (let i = 0; i < cleanActs.length; i++) {
      const a           = cleanActs[i];
      const fieldPrefix = `activities[${i}]`;
      const planned     = finiteNum(a["plannedBudget"]);
      const actual      = finiteNum(a["actualExpenditure"]);

      // Actual expenditure: must be a finite non-negative number (null or NaN → invalid)
      if (actual === null || actual < 0) {
        errors.push({
          field: `${fieldPrefix}.actualExpenditure`,
          reason: "Actual expenditure is required and must be a valid non-negative number.",
        });
      } else if (actual > 0) {
        hasAnyPositiveExpenditure = true;
      }

      // Achievement summary: required
      if (!String(a["achievementSummary"] ?? "").trim()) {
        errors.push({ field: `${fieldPrefix}.achievementSummary`, reason: "Achievement summary is required." });
      }

      // Per-activity beneficiary fields: each is required (blank ≠ zero)
      // Zero is a valid explicit entry ("no direct reach this period").
      const benFields: Array<[string, unknown]> = [
        ["beneficiariesMen",   a["beneficiariesMen"]],
        ["beneficiariesWomen", a["beneficiariesWomen"]],
        ["beneficiariesBoys",  a["beneficiariesBoys"]],
        ["beneficiariesGirls", a["beneficiariesGirls"]],
      ];
      for (const [, bv] of benFields) {
        const parsed = parseBenField(bv);
        if (parsed === null) {
          errors.push({
            field: `${fieldPrefix}.beneficiaries`,
            reason: "Beneficiary field is required — enter 0 if no direct reach occurred this period.",
          });
        } else if (parsed === "negative") {
          errors.push({
            field: `${fieldPrefix}.beneficiaries`,
            reason: "Beneficiary values cannot be negative.",
          });
        }
      }

      // Unplanned activities require a reason
      if (a["isUnplanned"] && !String(a["unplannedReason"] ?? "").trim()) {
        errors.push({ field: `${fieldPrefix}.unplannedReason`, reason: "Reason is required for unplanned activities." });
      }

      // Variance reason: mirrors frontend varianceReasonRequired(planned, actual)
      // Required when actual > planned OR actual < planned * 0.7 (30% threshold, any positive overrun)
      if (actual !== null && planned !== null && planned > 0) {
        const needsVariance = actual > planned || actual < planned * 0.7;
        if (needsVariance && !String(a["varianceReason"] ?? "").trim()) {
          errors.push({
            field: `${fieldPrefix}.varianceReason`,
            reason: "Variance reason is required when expenditure deviates by more than 30%.",
          });
        }
      }
    }

    // §7b — Project currency: mirrors the frontend rule that blocks submit when the linked project
    // has no currency configured but the report includes positive financial data.
    // Only enforced when project_id is set and at least one activity reports actual spend > 0.
    if (hasAnyPositiveExpenditure && row.project_id) {
      const curRes = await client.query<{ currency: string | null }>(
        "SELECT currency FROM projects WHERE id = $1",
        [row.project_id],
      );
      const projectCurrency = curRes.rows[0]?.currency ?? null;
      if (!projectCurrency) {
        errors.push({
          field: "projectCurrency",
          reason: "Project currency is not configured. Financial reporting cannot be submitted until the project currency is set.",
        });
      }
    }
  }

  // §8 — Supporting documentation
  // docsNoSupport / docsNoSupportReason are stored inside the sections JSONB by the frontend.
  // Query report_attachments for an accurate live count (the locked SELECT does not include it).
  const attRes = await client.query<{ cnt: number }>(
    "SELECT COUNT(*)::int AS cnt FROM report_attachments WHERE report_id = $1",
    [row["id"]],
  );
  const hasAttachments      = (attRes.rows[0]?.cnt ?? 0) > 0;
  const docsNoSupport       = sections["docsNoSupport"] === true;
  const docsNoSupportReason = String(sections["docsNoSupportReason"] ?? "").trim();
  if (!hasAttachments && !(docsNoSupport && docsNoSupportReason)) {
    errors.push({
      field: "supportingDocs",
      reason: "Supporting documentation is required. Upload at least one attachment or provide a reason for omission.",
    });
  }

  return errors;
}

// ---------------------------------------------------------------------------
// validateProgramStateReportForSubmission — Backend content gate for SPRs
// ---------------------------------------------------------------------------
// SPR-001: Mirrors the frontend State Programme Report buildPayload validation
// (program-state-report-form.tsx) so a direct API call cannot submit an empty
// or incomplete SPR.  Called only on action=submit for report_type=program_state.
// Draft create/PATCH stays permissive; resubmit after request_revision runs the
// same gate (the workflow transitions back to draft, so submit is the same path).
//
// Robustness contract: this function must never throw on malformed stored data
// (sections = null, wrong nested types, junk in activities JSONB) — it returns
// field errors instead, so the route answers 422, never 500.
// ---------------------------------------------------------------------------

export function validateProgramStateReportForSubmission(
  row: Record<string, unknown>,
): PmrContentError[] {
  const errors: PmrContentError[] = [];

  // sections may be null, a non-object, or an array — normalise to a plain object.
  const rawSections = row.sections;
  const sections: Record<string, unknown> =
    rawSections && typeof rawSections === "object" && !Array.isArray(rawSections)
      ? (rawSections as Record<string, unknown>)
      : {};

  const asStr = (v: unknown): string =>
    typeof v === "string" ? v : v == null ? "" : String(v);

  // §1 — Title (required, non-blank after trim)
  if (!asStr(row.title).trim()) {
    errors.push({ field: "title", reason: "Report Title is required." });
  }

  // §2 — State identity: SPRs are always state-scoped; stored state_id must be set.
  if (!row.state_id) {
    errors.push({ field: "stateId", reason: "State is required." });
  }

  // §3 — Sectors covered (sections.sectors: at least one entry)
  const sectors = Array.isArray(sections["sectors"]) ? sections["sectors"] : [];
  if (sectors.filter((s) => asStr(s).trim()).length === 0) {
    errors.push({ field: "sectors", reason: "At least one sector is required." });
  }

  // §4 — Localities covered (sections.localitiesCovered: at least one entry)
  const localities = Array.isArray(sections["localitiesCovered"])
    ? sections["localitiesCovered"]
    : [];
  if (localities.filter((l) => asStr(l).trim()).length === 0) {
    errors.push({ field: "localitiesCovered", reason: "At least one locality is required." });
  }

  // §5 — Humanitarian context (sections.humanitarianContext.{4 required fields})
  const rawHc = sections["humanitarianContext"];
  const hc: Record<string, unknown> =
    rawHc && typeof rawHc === "object" && !Array.isArray(rawHc)
      ? (rawHc as Record<string, unknown>)
      : {};
  const hcRequired: Array<[string, string]> = [
    ["securitySituation",   "Security Situation is required."],
    ["populationMovements", "Population Movements is required."],
    ["diseaseOutbreaks",    "Disease Outbreaks is required."],
    ["accessConstraints",   "Access Constraints is required."],
  ];
  for (const [key, reason] of hcRequired) {
    if (!asStr(hc[key]).trim()) {
      errors.push({ field: `humanitarianContext.${key}`, section: "humanitarianContext", reason });
    }
  }

  // §6 — Activities (top-level activities column; camelCase keys as sent by frontend).
  // Beneficiary numeric safety: blank/missing parses to 0 (mirrors frontend
  // Number(x || 0)), but junk types/values (booleans, arrays, objects, NaN
  // strings, negatives) are rejected explicitly — Number("") === 0 must not
  // hide invalid data, so the type check precedes conversion.
  const parseSprBen = (v: unknown): number | "invalid" => {
    if (v === null || v === undefined) return 0;
    if (typeof v !== "number" && typeof v !== "string") return "invalid";
    if (typeof v === "string" && !v.trim()) return 0;
    const n = Number(v);
    if (!Number.isFinite(n)) return "invalid";
    if (n < 0) return "invalid";
    return n;
  };

  const activities = Array.isArray(row.activities)
    ? (row.activities as unknown[])
    : [];
  if (activities.length === 0) {
    errors.push({ field: "activities", reason: "At least one activity is required." });
  } else {
    for (let i = 0; i < activities.length; i++) {
      const fieldPrefix = `activities[${i}]`;
      const rawA = activities[i];
      if (!rawA || typeof rawA !== "object" || Array.isArray(rawA)) {
        errors.push({ field: fieldPrefix, reason: "Activity entry is malformed." });
        continue;
      }
      const a = rawA as Record<string, unknown>;

      if (!asStr(a["title"]).trim()) {
        errors.push({ field: `${fieldPrefix}.title`, reason: "Activity title is required." });
      }
      if (!asStr(a["sector"]).trim()) {
        errors.push({ field: `${fieldPrefix}.sector`, reason: "Activity sector is required." });
      }
      if (!asStr(a["activityDate"]).trim()) {
        errors.push({ field: `${fieldPrefix}.date`, reason: "Activity date is required." });
      }
      if (!asStr(a["achievementSummary"]).trim()) {
        errors.push({ field: `${fieldPrefix}.achievementSummary`, reason: "Activity achievement summary is required." });
      }

      // Beneficiary reach: total across men/women/boys/girls must be > 0
      // (mirrors the frontend `ben === 0` block); each field must parse safely.
      let benSum = 0;
      let benInvalid = false;
      for (const key of ["beneficiariesMen", "beneficiariesWomen", "beneficiariesBoys", "beneficiariesGirls"]) {
        const parsed = parseSprBen(a[key]);
        if (parsed === "invalid") { benInvalid = true; continue; }
        benSum += parsed;
      }
      if (benInvalid) {
        errors.push({
          field: `${fieldPrefix}.beneficiaries`,
          reason: "Beneficiary values must be valid non-negative numbers.",
        });
      } else if (benSum === 0) {
        errors.push({
          field: `${fieldPrefix}.beneficiaries`,
          reason: "Activity must report at least one beneficiary reached.",
        });
      }
    }
  }

  // §7 — Narratives (stored at top level of sections JSONB by the frontend)
  const narrativeRequired: Array<[string, string]> = [
    ["keyAchievements",      "Key Achievements is required."],
    ["mainChallenges",       "Main Challenges is required."],
    ["mitigationMeasures",   "Mitigation Measures is required."],
    ["nextPeriodPriorities", "Next Period Priorities is required."],
  ];
  for (const [key, reason] of narrativeRequired) {
    if (!asStr(sections[key]).trim()) {
      errors.push({ field: key, section: "narrative", reason });
    }
  }

  // §8 — On-Demand rules (kind=on_demand): periodStart/periodEnd valid dates with
  // end ≥ start, plus a non-blank reason.  onDemandReason is checked on the
  // top-level column first (create route maps body.onDemandReason there) with a
  // sections fallback — the SPR frontend stores it inside sections.
  if (String(row.kind ?? "") === "on_demand") {
    const parseDate = (v: unknown): number | null => {
      const s = asStr(v).trim();
      if (!s) return null;
      const t = Date.parse(s.length === 10 ? `${s}T00:00:00Z` : s);
      return Number.isFinite(t) ? t : null;
    };
    const start = parseDate(row.period_start);
    const end   = parseDate(row.period_end);
    if (start === null) {
      errors.push({ field: "periodStart", reason: "Period start is required and must be a valid date for on-demand reports." });
    }
    if (end === null) {
      errors.push({ field: "periodEnd", reason: "Period end is required and must be a valid date for on-demand reports." });
    }
    if (start !== null && end !== null && end < start) {
      errors.push({ field: "periodEnd", reason: "Period end must be on or after period start." });
    }
    const reason =
      asStr(row.on_demand_reason).trim() || asStr(sections["onDemandReason"]).trim();
    if (!reason) {
      errors.push({ field: "onDemandReason", reason: "On-demand reason is required." });
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// validateHqSectorReportForSubmission — Backend content gate for HQSRs
// ---------------------------------------------------------------------------
// HQSR-003: Mirrors the frontend HQ Sector Report buildPayload validation
// (hq-sector-report-form.tsx) so a direct API call cannot submit an empty or
// incomplete hq_sector report.  Called only on action=submit for
// report_type=hq_sector.  Draft create/PATCH stays permissive; resubmit after
// request_revision runs the same gate (the workflow transitions back to draft,
// so submit is the same path).  The gate applies equally to every author path
// (TC primary, SPC vacancy fallback, super_admin, and any PM override) — it is
// a content rule, not an authorisation rule.
//
// Robustness contract: this function must never throw on malformed stored data
// (sections = null / an array, booleans or arrays in narrative fields, junk in
// supportRequired) — it returns field errors instead, so the route answers
// 422, never 500.
//
// Explicitly NOT required (parity with the frontend gate): officerName,
// beneficiary figures, activity rows, financial figures, attachments,
// stateObservations / technicalRatings / indicatorCommentary, and the live
// sector-performance snapshot (which is never persisted).
// ---------------------------------------------------------------------------

export function validateHqSectorReportForSubmission(
  row: Record<string, unknown>,
): PmrContentError[] {
  const errors: PmrContentError[] = [];

  // sections may be null, a non-object, or an array — normalise to a plain object.
  const rawSections = row.sections;
  const sections: Record<string, unknown> =
    rawSections && typeof rawSections === "object" && !Array.isArray(rawSections)
      ? (rawSections as Record<string, unknown>)
      : {};

  const asStr = (v: unknown): string =>
    typeof v === "string" ? v : v == null ? "" : String(v);
  const isBlank = (v: unknown): boolean => asStr(v).trim().length === 0;
  // Strict variant for user-entered text: a boolean/array/object stored where
  // a narrative string belongs is malformed content, not a valid value —
  // String(false) === "false" must not satisfy a required-text check.
  const isMissingText = (v: unknown): boolean =>
    typeof v !== "string" || v.trim().length === 0;

  // §1 — Sector (top-level column; authoritative for hq_sector)
  if (isBlank(row.sector)) {
    errors.push({ field: "sector", reason: "Sector is required." });
  }

  // §2 — Title (top-level column)
  if (isBlank(row.title)) {
    errors.push({ field: "title", reason: "Report Title is required." });
  }

  // §3 — On-Demand rules: periodStart/periodEnd valid dates with end ≥ start,
  // plus a non-blank reason.  The HQSR frontend stores these inside sections
  // (periodStart/periodEnd/onDemandReason); the generic create route also maps
  // body-level values to top-level columns when present.  Check top-level
  // first with a sections fallback so both storage layouts validate.
  // Frequency likewise: prefer the stored kind column, falling back to
  // sections.frequency (the frontend's authoritative field).
  // On-demand detection: EITHER indicator triggers the on-demand rules.
  // The frontend stores the authoritative frequency in sections.frequency;
  // the create route stores kind as a top-level column. A direct API caller
  // could store conflicting values (e.g. kind="monthly" with
  // sections.frequency="on_demand"), so a non-on-demand value in one location
  // must never suppress an on-demand value in the other — fail closed and
  // apply the stricter rules whenever either says on_demand.
  const isOnDemand =
    asStr(row.kind).trim() === "on_demand" ||
    asStr(sections["frequency"]).trim() === "on_demand";
  if (isOnDemand) {
    // Strict calendar-date parser. Date.parse alone is not enough: it silently
    // normalises impossible dates ("2026-02-30" → 2 March 2026), which would
    // let API/PATCH-created content bypass the valid-date requirement.
    // Accepts: a JS Date (pg returns Date objects for date columns) or a
    // canonical YYYY-MM-DD string (optionally with a trailing time part, as
    // in the ISO serialisation of a date column), whose calendar components
    // must round-trip exactly through Date.UTC.
    const parseDate = (v: unknown): number | null => {
      if (v instanceof Date) {
        const t = v.getTime();
        return Number.isFinite(t) ? t : null;
      }
      const s = asStr(v).trim();
      const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(s);
      if (!m) return null;
      const y = Number(m[1]);
      const mo = Number(m[2]);
      const d = Number(m[3]);
      const t = Date.UTC(y, mo - 1, d);
      const dt = new Date(t);
      if (
        dt.getUTCFullYear() !== y ||
        dt.getUTCMonth() !== mo - 1 ||
        dt.getUTCDate() !== d
      ) {
        return null; // impossible calendar date (e.g. Feb 30, month 13, day 32)
      }
      return t;
    };
    const rawStart = !isBlank(row.period_start) ? row.period_start : sections["periodStart"];
    const rawEnd   = !isBlank(row.period_end)   ? row.period_end   : sections["periodEnd"];
    const start = parseDate(rawStart);
    const end   = parseDate(rawEnd);
    if (start === null) {
      errors.push({ field: "periodStart", reason: "Period start is required and must be a valid date for on-demand reports." });
    }
    if (end === null) {
      errors.push({ field: "periodEnd", reason: "Period end is required and must be a valid date for on-demand reports." });
    }
    if (start !== null && end !== null && end < start) {
      errors.push({ field: "periodEnd", reason: "Period end must be on or after period start." });
    }
    const reason =
      asStr(row.on_demand_reason).trim() || asStr(sections["onDemandReason"]).trim();
    if (!reason) {
      errors.push({ field: "onDemandReason", reason: "On-demand reason is required." });
    }
  }

  // §4 — Required narrative sections (stored at top level of sections JSONB)
  const narrativeRequired: Array<[string, string]> = [
    ["technicalAnalysis",   "Technical Analysis is required."],
    ["keyFindings",         "Key Findings is required."],
    ["qualityAssessment",   "Quality Assessment is required."],
    ["technicalChallenges", "Technical Challenges is required."],
    ["recommendations",     "Recommendations is required."],
    ["strategicPriorities", "Strategic Priorities is required."],
    ["lessonsLearned",      "Lessons Learned is required."],
    ["sectorOutlook",       "Sector Outlook is required."],
  ];
  for (const [key, reason] of narrativeRequired) {
    if (isMissingText(sections[key])) {
      errors.push({ field: key, section: "narratives", reason });
    }
  }

  // §5 — Support requests: at least one valid entry (non-blank supportType AND
  // description — mirrors the frontend cleanSupport filter).
  const rawSupport = sections["supportRequired"];
  const supportArr: unknown[] = Array.isArray(rawSupport) ? rawSupport : [];
  const validSupport = supportArr.filter(
    (r: unknown) =>
      r !== null &&
      typeof r === "object" &&
      !Array.isArray(r) &&
      !isMissingText((r as Record<string, unknown>).supportType) &&
      !isMissingText((r as Record<string, unknown>).description),
  );
  if (validSupport.length === 0) {
    errors.push({
      field: "supportRequired",
      reason: "At least one support request with a support type and description is required.",
    });
  }

  return errors;
}

// ---------------------------------------------------------------------------
// POST /reports/:reportId/transitions — Workflow actions
// ---------------------------------------------------------------------------

router.post(
  "/reports/:reportId/transitions",
  // PERM-04/WF-02: Outer gate is reports.update, not reports.view.
  // This blocks SOM (view-only) and ED (view-only) from reaching the handler.
  // The inner action-specific permission check is the real security gate:
  //   submit              → reports.create  (SPO, TC, super_admin for Activity Reports)
  //   technical_review    → reports.approve.technical  (TC only)
  //   coordination_review → reports.approve.coordination  (SPC, PM, super_admin)
  //   final_approve       → reports.approve.final  (PM, super_admin)
  //   request_revision/reject → reports.approve.technical or .coordination per stage
  // ED, viewer: blocked here at requirePerm("reports.update").
  // SOM (SPR-003/004 fallback): passes the outer gate via the narrow
  // reports.program_state.create permission, but the inner permission check
  // only grants them action=submit on their OWN program_state report — every
  // other action/report stays 403 (no approve/reject/revision rights).
  requireReportsUpdateOrSomSprAuthor,
  async (req, res, next) => {
    const client = await pool.connect();
    try {
      if (!req.currentUser) {
        res.status(401).json({ error: "no current user" });
        return;
      }
      const reportId = Number(req.params.reportId as string);
      const body = TransitionReportBody.parse(req.body);

      await client.query("BEGIN");

      // Lock the row for this transaction to prevent concurrent approvals
      const cur = await client.query(
        `SELECT status, report_type AS "reportType", state_id AS "stateId",
                sector, project_id AS "projectId", activity_id AS "activityId",
                workflow_path AS "workflowPath", author_id AS "authorId"
         FROM reports WHERE id = $1 FOR UPDATE`,
        [reportId],
      );
      if (cur.rows.length === 0) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "report not found" });
        return;
      }

      const {
        status: fromStatus,
        reportType,
        stateId: reportStateId,
        projectId: reportProjectId,
        workflowPath,
        authorId,
      } = cur.rows[0] as {
        status: string;
        reportType: string | null;
        stateId: number | null;
        sector: string | null;
        projectId: number | null;
        activityId: number | null;
        workflowPath: string | null;
        authorId: number | null;
      };

      // Verify the report has a canonical type
      if (!reportType || !isCanonicalReportType(reportType)) {
        await client.query("ROLLBACK");
        res.status(409).json({
          error: "unresolved_report_type",
          message:
            "This report has an unresolved type and cannot be transitioned. Assign a canonical type first.",
        });
        return;
      }

      // ── NULL workflow_path historical fallback ────────────────────────────────
      // A small set of historical project/activity reports have workflow_path = NULL
      // because their original author_id could not be resolved during migration backfill.
      // getProjectActivityWorkflow(null) conservatively falls back to state_authored (PATH A).
      // Log a structured warning when this fallback fires so operations can audit affected records.
      if ((reportType === "project" || reportType === "activity") && workflowPath === null) {
        logger.warn(
          {
            reportId,
            reportType,
            status: fromStatus,
            authorId,
            workflowPath: null,
            fallbackWorkflow: "state_authored",
            reason: "historical_workflow_path_missing",
          },
          "[reports] transition: null workflow_path — using conservative state_authored fallback (historical record)",
        );
      }

      // ── Defense-in-depth: reject unexpected non-null workflow_path values ─────
      // The DB CHECK constraint prevents any value other than 'state_authored' or
      // 'technical_authored' from being stored. This guard is dead code in production
      // but makes the intent explicit and protects against hypothetical schema drift.
      if (
        (reportType === "project" || reportType === "activity") &&
        workflowPath !== null &&
        workflowPath !== "state_authored" &&
        workflowPath !== "technical_authored"
      ) {
        await client.query("ROLLBACK");
        res.status(409).json({
          error: "invalid_workflow_path",
          message: "Report has an unrecognised workflow_path value and cannot be transitioned.",
        });
        return;
      }

      // Look up the workflow for this report type.
      // Project and Activity reports use an author-dependent workflow; all others use a
      // single fixed chain. The workflowPath is immutable after creation.
      const workflow =
        reportType === "project" || reportType === "activity"
          ? getProjectActivityWorkflow(workflowPath)
          : REPORT_WORKFLOWS[reportType];

      if (!workflow) {
        await client.query("ROLLBACK");
        res.status(409).json({ error: "no workflow defined for report type", reportType });
        return;
      }

      const transition = workflow[body.action];
      if (!transition) {
        await client.query("ROLLBACK");
        res.status(400).json({
          error: `action '${body.action}' is not valid for report type '${reportType}' (workflow_path: ${workflowPath ?? "none"})`,
        });
        return;
      }

      // Validate the from-status
      if (!transition.from.includes(fromStatus)) {
        await client.query("ROLLBACK");
        res.status(400).json({
          error: `cannot ${body.action} from status '${fromStatus}' for ${reportType} reports`,
        });
        return;
      }

      // WF-03: Guard against transitioning INTO historical-only statuses.
      // "state_reviewed" is a legacy status from the old 5-step workflow and is
      // a valid "from" source for historical records, but must NEVER be a new "to" target.
      const HISTORICAL_ONLY_TARGETS = new Set(["state_reviewed"]);
      if (HISTORICAL_ONLY_TARGETS.has(transition.to)) {
        await client.query("ROLLBACK");
        res.status(400).json({ error: "invalid_transition_target", status: transition.to });
        return;
      }

      // Resolve the required permission (dynamic for reject/request_revision)
      let requiredPerm = transition.perm;
      if (body.action === "reject" || body.action === "request_revision") {
        requiredPerm = getRevisionPerm(reportType, fromStatus, workflowPath);
      }

      // ── HQSR SPC-fallback PM reviewer note (HQSR-BD-1/BD-6) ─────────────────
      // PM now holds reports.approve.coordination via Full Operational Access
      // (Task #373), so PM may coordination-review ANY report type. The
      // isHqsrSpcFallbackPmReviewer variable is retained for clarity — it was
      // the original narrow exception; now PM passes the generic permission gate
      // (perms.includes(requiredPerm)) for all reports, making this variable
      // always true when the conditions match.  It is kept for documentation.
      const HQSR_FALLBACK_PM_ACTIONS = ["coordination_review", "request_revision", "reject"] as const;
      const isHqsrSpcFallbackPmReviewer =
        reportType === "hq_sector" &&
        workflowPath === "spc_fallback" &&
        req.currentUser.role === "program_manager" &&
        (HQSR_FALLBACK_PM_ACTIONS as readonly string[]).includes(body.action) &&
        requiredPerm === "reports.approve.coordination";
      // Mark variable as used (avoids TS "declared but never read" if linter fires).
      void isHqsrSpcFallbackPmReviewer;

      // SPC reviewing a TC-authored hq_sector report is the normal path; SPC
      // reviewing their own fallback report is blocked by the self-review guard below.

      // Check permission
      const perms = permissionsFor(req.currentUser);

      // SPR-003/004 SOM fallback: the narrow reports.program_state.create
      // permission satisfies ONLY the submit action on a program_state report
      // the SOM authored themselves. It never satisfies review/approve/reject
      // actions or any other report type.
      // Fail closed on state scope: both the SOM's current state and the
      // report's state must be non-null and equal (a reassigned or unassigned
      // SOM cannot submit drafts authored for a previous state).
      const isSomSprAuthorSubmit =
        req.currentUser.role === "state_office_manager" &&
        body.action === "submit" &&
        reportType === "program_state" &&
        authorId !== null &&
        authorId === req.currentUser.id &&
        req.currentUser.stateId != null &&
        reportStateId !== null &&
        reportStateId === req.currentUser.stateId &&
        perms.includes("reports.program_state.create");

      if (!perms.includes("*") && !perms.includes(requiredPerm) && !isSomSprAuthorSubmit) {
        await client.query("ROLLBACK");
        res.status(403).json({ error: "forbidden", requiredPermission: requiredPerm });
        return;
      }

      // ── Self-review prevention (with PM/super_admin override path) ────────
      // The original report author (author_id) must never review or approve their
      // own report at any workflow stage: technical_review, coordination_review,
      // or final_approve. This uses author_id (original creator), not submitted_by_id.
      //
      // Full Operational Access override (Task #373): PM and super_admin may
      // self-review as an operational override, subject to:
      //   1. An explicit overrideReason must be supplied in the request body.
      //   2. The approval row is annotated: used_override=TRUE, override_reason=<text>.
      //   3. The audit log row is annotated with the same values.
      //
      // technical_review note: TC-authored reports skip this stage entirely, so this
      // guard defends against a corrupted workflow_path or future migration errors.
      const REVIEWER_ACTIONS = ["technical_review", "coordination_review", "final_approve"] as const;
      let selfReviewOverride = false;
      if ((REVIEWER_ACTIONS as readonly string[]).includes(body.action)) {
        if (authorId !== null && authorId === req.currentUser.id) {
          if (hasFullOperationalAccess(req.currentUser)) {
            // PM/super_admin may self-review as an override — require explicit reason.
            const suppliedReason = typeof body.overrideReason === "string" ? body.overrideReason.trim() : "";
            if (!suppliedReason) {
              await client.query("ROLLBACK");
              res.status(400).json({
                error: "override_reason_required",
                message:
                  "An override reason is required when Program Manager or Super Admin reviews their own report.",
              });
              return;
            }
            selfReviewOverride = true;
          } else {
            await client.query("ROLLBACK");
            res.status(403).json({
              error: "self_review_forbidden",
              message: "The report author cannot review or approve their own report.",
            });
            return;
          }
        }
      }

      // ── State scope check for state roles ────────────────────────────────
      // SPO is limited to their assigned state; SOM is view-only (no transitions allowed).
      const isStateRole =
        req.currentUser.role === "state_program_officer" ||
        req.currentUser.role === "state_office_manager";
      if (isStateRole) {
        const userStateId = req.currentUser.stateId ?? null;
        if (userStateId !== null && reportStateId !== null && reportStateId !== userStateId) {
          await client.query("ROLLBACK");
          res.status(403).json({ error: "state_scope_forbidden" });
          return;
        }
      }

      // ── Sector scope check ────────────────────────────────────────────────
      const sector = await getReportSectorForAuth(reportId);
      const guard = assertSectorAllowed(req, sector ?? null);
      if (!guard.ok) {
        await client.query("ROLLBACK");
        res.status(guard.status).json(guard.body);
        return;
      }

      // ── Require comment for revision/reject ───────────────────────────────
      const commentText = String(body.comment ?? "").trim();
      if (
        (body.action === "request_revision" || body.action === "reject") &&
        !commentText
      ) {
        await client.query("ROLLBACK");
        res.status(400).json({ error: "comment_required_for_revision_or_reject" });
        return;
      }

      // ── Content gate for modern Activity Reports on submit ───────────────
      // FIX-08: Backend enforcement of required fields to match frontend submit validation.
      // Only applies when action=submit AND report_type=activity AND _schemaVersion="modern".
      // Legacy records (no modern marker) are exempt — FIX-07 governs them.
      // Conditional rules that require understanding of user context (challenges/lessons toggle
      // phrasing that depends on locationType/linkMode) are frontend-authoritative only.
      if (body.action === "submit" && reportType === "activity") {
        const fullRow = await client.query(
          `SELECT title,
                  activity_name        AS "activityName",
                  sections,
                  period,
                  reporting_month      AS "reportingMonth",
                  reporting_year       AS "reportingYear",
                  state_id             AS "stateId",
                  location_type        AS "locationType",
                  beneficiaries_male   AS "beneficiariesMale",
                  beneficiaries_female AS "beneficiariesFemale",
                  beneficiaries_boys   AS "beneficiariesBoys",
                  beneficiaries_girls  AS "beneficiariesGirls"
           FROM reports WHERE id = $1`,
          [reportId],
        );
        if (fullRow.rows.length > 0) {
          const row = fullRow.rows[0] as {
            title: string | null;
            activityName: string | null;
            sections: Record<string, unknown> | null;
            period: string | null;
            reportingMonth: number | null;
            reportingYear: number | null;
            stateId: number | null;
            locationType: string | null;
            beneficiariesMale: number | null;
            beneficiariesFemale: number | null;
            beneficiariesBoys: number | null;
            beneficiariesGirls: number | null;
          };
          const sections = row.sections ?? {};
          const isModern = sections["_schemaVersion"] === "modern";
          if (isModern) {
            const contentErrors: string[] = [];

            // §1 — Unconditional required fields
            if (!(row.title ?? "").trim())
              contentErrors.push("Report Title is required.");
            if (!(row.activityName ?? "").trim())
              contentErrors.push("Report Subject / Activity Name is required.");

            // §2 — Reporting period: required only when the stored period is in YYYY-MM format.
            // Historical records may carry a non-standard period (e.g. "Q3-2025", "2025") — the
            // frontend's isLegacyPeriod flag exempts them from month/year fields, so the backend
            // must apply the same exemption to avoid a contract split on re-submit.
            const periodStr = String(row.period ?? "");
            const isLegacyPeriod = !/^\d{4}-\d{2}$/.test(periodStr);
            if (!isLegacyPeriod) {
              if (!row.reportingMonth)
                contentErrors.push("Reporting Month is required.");
              if (!row.reportingYear)
                contentErrors.push("Reporting Year is required.");
            }

            // §3 — Implementation (Step 2)
            if (!(String(sections["implementationStatus"] ?? "")).trim())
              contentErrors.push("Implementation Status is required.");
            if (!(String(sections["implementationSummary"] ?? "")).trim())
              contentErrors.push("Implementation Summary is required.");

            // §4 — Date ordering: if both dates are present, end >= start (ISO-string compare is safe for YYYY-MM-DD)
            const startDate = String(sections["actualStartDate"] ?? "").trim();
            const endDate   = String(sections["actualEndDate"]   ?? "").trim();
            if (startDate && endDate && endDate < startDate)
              contentErrors.push("Actual End Date must be on or after Actual Start Date.");

            // §5 — Results (Step 3)
            if (!(String(sections["resultsAchieved"] ?? "")).trim())
              contentErrors.push("Results Achieved is required.");

            // §6 — Beneficiary reach toggle (explicit for modern records)
            const hasBeneficiaryReach = String(sections["hasBeneficiaryReach"] ?? "").trim();
            if (!hasBeneficiaryReach || (hasBeneficiaryReach !== "yes" && hasBeneficiaryReach !== "no")) {
              contentErrors.push("Please indicate whether this report has direct beneficiary reach.");
            } else if (hasBeneficiaryReach === "yes") {
              // When reach is declared, counts must be non-negative integers
              const benCounts = [
                ["men",   row.beneficiariesMale],
                ["women", row.beneficiariesFemale],
                ["boys",  row.beneficiariesBoys],
                ["girls", row.beneficiariesGirls],
              ] as const;
              for (const [label, val] of benCounts) {
                const n = Number(val ?? 0);
                if (!Number.isInteger(n) || n < 0)
                  contentErrors.push(`Beneficiary count for ${label} must be a non-negative whole number.`);
              }
            }

            // §7 — Challenges toggle (explicit for modern records)
            const hasChallenges = String(sections["hasChallenges"] ?? "").trim();
            if (!hasChallenges || (hasChallenges !== "yes" && hasChallenges !== "no")) {
              contentErrors.push("Please indicate whether significant challenges were encountered.");
            } else if (hasChallenges === "yes") {
              if (!(String(sections["challenges"] ?? "")).trim())
                contentErrors.push("Challenges Encountered is required.");
            }

            // §8 — Lessons (Step 5)
            if (!(String(sections["lessonsLearned"] ?? "")).trim())
              contentErrors.push("Lessons Learned is required.");

            // §9 — State/location: non-HQ modern reports must have a state assigned.
            // HQ reports carry location_type='hq' and are exempt from stateId.
            // State-role authors always get their stateId stamped at creation — so a null
            // stateId on a state-typed report is a genuine gap, not a single-state-user case.
            if (row.locationType !== "hq" && !row.stateId)
              contentErrors.push("State is required.");

            if (contentErrors.length > 0) {
              await client.query("ROLLBACK");
              res.status(422).json({ error: "report_content_incomplete", fields: contentErrors });
              return;
            }
          }
        }
      }

      // ── Content gate for Project (Monthly) Reports on submit ─────────────
      // PB-1: Backend enforcement of required fields, matching the frontend PMR
      // validateSubmit rules exactly.  Runs on action=submit for both initial
      // submission (draft→submitted) and re-submission (returned→submitted).
      // Uses report_type=project — NOT _schemaVersion, which PMR never set.
      // Draft PATCH is unaffected: this block only runs inside the transition handler.
      if (body.action === "submit" && reportType === "project") {
        const pmrFullRow = await client.query(
          `SELECT id, title, project_id, state_id, location_type,
                  kind, period, period_start, on_demand_reason,
                  reporting_month, reporting_year, quarter,
                  sections, activities
           FROM reports WHERE id = $1`,
          [reportId],
        );
        if (pmrFullRow.rows.length > 0) {
          const pmrErrors = await validateProjectReportForSubmission(
            pmrFullRow.rows[0] as Record<string, unknown>,
            client,
          );
          if (pmrErrors.length > 0) {
            await client.query("ROLLBACK");
            res.status(422).json({ error: "report_content_incomplete", fields: pmrErrors });
            return;
          }
        }
      }

      // ── Content gate for State Programme Reports on submit ───────────────
      // SPR-001: Backend enforcement of required fields, matching the frontend
      // SPR buildPayload validation exactly.  Runs on action=submit for both
      // initial submission and re-submission after request_revision.
      // Draft create/PATCH is unaffected: this block only runs in the transition handler.
      if (body.action === "submit" && reportType === "program_state") {
        const sprFullRow = await client.query(
          `SELECT id, title, state_id, kind, period,
                  period_start, period_end, on_demand_reason,
                  sections, activities
           FROM reports WHERE id = $1`,
          [reportId],
        );
        if (sprFullRow.rows.length > 0) {
          const sprErrors = validateProgramStateReportForSubmission(
            sprFullRow.rows[0] as Record<string, unknown>,
          );
          if (sprErrors.length > 0) {
            await client.query("ROLLBACK");
            res.status(422).json({ error: "report_content_incomplete", fields: sprErrors });
            return;
          }
        }
      }

      // ── Content gate for HQ Sector Reports on submit ─────────────────────
      // HQSR-003: Backend enforcement of required fields, matching the frontend
      // HQSR buildPayload validation exactly.  Runs on action=submit for both
      // initial submission and re-submission after request_revision, and applies
      // equally to all author paths (TC, SPC fallback, PM override, super_admin).
      // Draft create/PATCH is unaffected: this block only runs in the transition
      // handler, before any status mutation / approval row / notification —
      // ROLLBACK on failure leaves zero workflow mutations.
      if (body.action === "submit" && reportType === "hq_sector") {
        const hqFullRow = await client.query(
          `SELECT id, title, sector, kind,
                  period_start, period_end, on_demand_reason,
                  sections
           FROM reports WHERE id = $1`,
          [reportId],
        );
        if (hqFullRow.rows.length > 0) {
          const hqErrors = validateHqSectorReportForSubmission(
            hqFullRow.rows[0] as Record<string, unknown>,
          );
          if (hqErrors.length > 0) {
            await client.query("ROLLBACK");
            res.status(422).json({ error: "report_content_incomplete", fields: hqErrors });
            return;
          }
        }
      }

      // ── Final-approve gate: no unresolved required corrections ────────────
      if (body.action === "final_approve") {
        const n = await unresolvedRequiredCorrections("report", reportId);
        if (n > 0) {
          await client.query("ROLLBACK");
          res.status(409).json({ error: "unresolved_required_corrections", count: n });
          return;
        }
      }

      const toStatus = transition.to;

      // ── Update report status ──────────────────────────────────────────────
      // On re-submit (submit from draft after request_revision), reset submitted_at
      // so the >14-day timer restarts from the new submission.
      const resetSubmittedAt = body.action === "submit";
      await client.query(
        `UPDATE reports
         SET status = $1
             ${resetSubmittedAt ? ", submitted_at = NOW(), submitted_by_id = $3" : ""}
             , updated_at = NOW()
         WHERE id = $2`,
        resetSubmittedAt ? [toStatus, reportId, req.currentUser.id] : [toStatus, reportId],
      );

      // ── Record approval history ───────────────────────────────────────────
      const approvalOverrideReason = selfReviewOverride
        ? (typeof body.overrideReason === "string" ? body.overrideReason.trim() : null)
        : null;
      await client.query(
        `INSERT INTO approvals (entity_type, entity_id, action, from_status, to_status, actor_id, comment, used_override, override_reason)
         VALUES ('report', $1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          reportId,
          body.action,
          fromStatus,
          toStatus,
          req.currentUser.id,
          body.comment ?? null,
          selfReviewOverride,
          approvalOverrideReason,
        ],
      );

      // ── Comments for revision/rejection ──────────────────────────────────
      if (commentText && (body.action === "request_revision" || body.action === "reject")) {
        await client.query(
          `INSERT INTO comments (entity_type, entity_id, comment_type, author_id, body)
           VALUES ('report', $1, $2, $3, $4)`,
          [
            reportId,
            body.action === "request_revision" ? "revision_request" : "rejection_reason",
            req.currentUser.id,
            commentText,
          ],
        );
      }

      // ── Audit log ─────────────────────────────────────────────────────────
      await logAudit({
        userId: req.currentUser.id,
        action: body.action,
        module: "reports",
        entityId: reportId,
        oldValue: fromStatus,
        newValue: toStatus,
        usedOverride: selfReviewOverride,
        overrideReason: approvalOverrideReason,
      });

      await client.query("COMMIT");

      // ── Post-commit notifications (non-blocking) ──────────────────────────
      const kindMap: Record<string, string> = {
        request_revision: "returned",
        reject: "rejected",
        final_approve: "approved",
        submit: "submitted",
        technical_review: "technically_reviewed",
        coordination_review: "coordination_reviewed",
        archive: "archived",
      };
      const reportLink = await reportDeepLink(reportId);
      const transitionDedupeKey =
        `report-transition:${reportId}:${body.action}:${fromStatus}:${toStatus}`;
      notifyEntityActorsDeduped({
        entityType: "report",
        entityId: reportId,
        kind: kindMap[body.action] ?? "system",
        message: `Report transitioned ${fromStatus} → ${toStatus} by ${req.currentUser.name}${commentText ? `: ${commentText}` : ""}`,
        dedupeKey: transitionDedupeKey,
        link: reportLink,
        exceptUserId: req.currentUser.id,
        mandatory:
          body.action === "reject" || body.action === "request_revision",
      }).catch(() => {});
      // Standalone program_state reports (no project) have no
      // project_assignments row for actorsForEntity("report", …) to resolve —
      // only the report's own author/submitter would ever hear about a
      // status change. Mirror routes/risks.ts's standalone-state-notify
      // pattern (used for both risk creation and risk status changes):
      // directly reach every other active SPO/SOM in the report's own state.
      if (reportType === "program_state" && !reportProjectId && reportStateId) {
        const stateUsers = await pool.query<{ id: number }>(
          `SELECT id FROM users WHERE role IN ('state_program_officer', 'state_office_manager') AND state_id = $1 AND status = 'active'`,
          [reportStateId],
        );
        for (const u of stateUsers.rows) {
          if (u.id !== req.currentUser.id) {
            createNotificationDeduped({
              userId: u.id,
              kind: kindMap[body.action] ?? "system",
              entityType: "report",
              entityId: reportId,
              message: `Report transitioned ${fromStatus} → ${toStatus} by ${req.currentUser.name}${commentText ? `: ${commentText}` : ""}`,
              link: reportLink,
              dedupeKey: transitionDedupeKey,
            }).catch(() => {});
          }
        }
      }
      // ── HQSR routing path (HQSR-BD-1/BD-6) ───────────────────────────────
      // For hq_sector submits, the immutable workflow_path (frozen at creation,
      // Migration 019) identifies the SPC fallback — resilient to later role
      // changes and correct on resubmit. spc_fallback → notify PM directly.
      // tc_authored (incl. historical NULL workflow_path) → notify SPC, never
      // sector TCs; fallback PM when no active SPC (HQSR-006).
      const hqsrPath: "spc_fallback" | "tc_authored" | null =
        reportType === "hq_sector" && body.action === "submit"
          ? (workflowPath === "spc_fallback" ? "spc_fallback" : "tc_authored")
          : null;
      notifyNextApprover({
        action: body.action,
        entityType: "report",
        entityId: reportId,
        sector: sector ?? null,
        // Workflow-path-aware submit routing applies only to author-dependent
        // workflows (project/activity). Other report types keep default routing.
        workflowPath:
          reportType === "project" || reportType === "activity" ? workflowPath : null,
        hqsrPath,
        message: `A report requires your review: ${body.action} by ${req.currentUser.name}`,
        link: reportLink,
        exceptUserId: req.currentUser.id,
        dedupeKey:
          `${transitionDedupeKey}:next-approver:${workflowPath ?? "default"}:${hqsrPath ?? "standard"}`,
      }).catch(() => {});

      realtime.broadcastUpdate?.({
        module: "reports",
        action: body.action,
        entityId: reportId,
        actorId: req.currentUser.id,
        actorName: req.currentUser.name,
      });
      const result = await pool.query(`${reportSelect} WHERE r.id = $1`, [reportId]);
      const enriched = await withHistory(result.rows);
      res.json(enriched[0]);
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      next(err);
    } finally {
      client.release();
    }
  },
);

// ---------------------------------------------------------------------------
// assertAttachmentMutationAllowed is now imported from lib/reportAuth.ts
// (moved there so storage.ts and voice-notes.ts can share it without circular deps)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// GET /reports/:reportId/attachments/:attachmentId/download
// Authenticated, authorised download for a single attachment.
// Uses the canonical assertCanViewReport check (sector + state scope).
// The object_path is resolved server-side — the client never sees the raw path.
// ---------------------------------------------------------------------------
router.get(
  "/reports/:reportId/attachments/:attachmentId/download",
  requirePerm("reports.view"),
  async (req, res, next) => {
    try {
      const reportId = Number(req.params.reportId as string);
      const attachmentId = Number(req.params.attachmentId as string);
      if (isNaN(reportId) || isNaN(attachmentId)) {
        res.status(400).json({ error: "invalid id" });
        return;
      }
      // Full canonical auth: sector scope + state scope
      const authResult = await assertCanViewReport(req, reportId);
      if (!authResult.ok) {
        res.status(authResult.status).json(authResult.body);
        return;
      }
      // Resolve the attachment — WHERE includes report_id so a client cannot
      // reach attachments from other reports by guessing attachment IDs.
      const { rows } = await pool.query<{
        objectPath: string;
        fileName: string;
        contentType: string | null;
        availabilityStatus: string;
      }>(
        `SELECT object_path AS "objectPath", file_name AS "fileName",
                content_type AS "contentType",
                availability_status AS "availabilityStatus"
         FROM report_attachments WHERE id = $1 AND report_id = $2`,
        [attachmentId, reportId],
      );
      if (rows.length === 0) {
        res.status(404).json({ error: "attachment not found" });
        return;
      }
      const { objectPath, fileName, contentType } = rows[0];
      if (rows[0].availabilityStatus === "unavailable") {
        res.status(410).json({ error: "file_unavailable", message: "File Unavailable" });
        return;
      }
      if (!objectPath) {
        res.status(410).json({ error: "file_unavailable", message: "Historical file requires owner reconciliation." });
        return;
      }
      try {
        const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
        const response = await objectStorageService.downloadObject(objectFile);
        res.status(response.status);
        if (contentType) res.setHeader("Content-Type", contentType);
        res.setHeader("Content-Disposition", contentDispositionHeader(fileName, "attachment"));
        response.headers.forEach((value, key) => {
          if (!["content-type", "content-disposition"].includes(key.toLowerCase())) {
            res.setHeader(key, value);
          }
        });
        if (response.body) {
          const nodeStream = Readable.fromWeb(
            response.body as import("stream/web").ReadableStream<Uint8Array>,
          );
          nodeStream.pipe(res);
        } else {
          res.end();
        }
      } catch (storageErr) {
        if (storageErr instanceof ObjectNotFoundError) {
          res.status(404).json({ error: "attachment file not found in storage" });
          return;
        }
        throw storageErr;
      }
    } catch (err) { next(err); }
  },
);

// ---------------------------------------------------------------------------
// GET /reports/:reportId/attachments — list saved attachments for a report
// Uses the canonical assertCanViewReport check (sector + state scope).
// ---------------------------------------------------------------------------
export function toPublicReportAttachmentDto(row: Record<string, unknown>) {
  return {
    ...row,
    availabilityStatus: row.availabilityStatus ?? "available",
  };
}

async function persistReportAttachmentPresentation(
  reportId: number,
  attachment: Record<string, unknown>,
  attachmentType?: string,
): Promise<void> {
  const attachmentId = Number(attachment.id);
  if (!Number.isFinite(attachmentId)) return;
  const presentation = {
    attachmentId,
    fileName: String(attachment.fileName ?? ""),
    contentType: String(attachment.contentType ?? ""),
    size: Number(attachment.size ?? 0),
    attachmentType: typeof attachmentType === "string" && attachmentType.trim()
      ? attachmentType.trim().slice(0, 100)
      : "Other",
  };
  await pool.query(
    `UPDATE reports
     SET sections = jsonb_set(
       COALESCE(sections, '{}'::jsonb),
       '{attachments}',
       COALESCE(sections->'attachments', '[]'::jsonb) || $2::jsonb,
       true
     )
     WHERE id = $1
       AND NOT EXISTS (
         SELECT 1
         FROM jsonb_array_elements(COALESCE(sections->'attachments', '[]'::jsonb)) entry
         WHERE entry->>'attachmentId' = $3
       )`,
    [reportId, JSON.stringify([presentation]), String(attachmentId)],
  );
}

router.get(
  "/reports/:reportId/attachments",
  requirePerm("reports.view"),
  async (req, res, next) => {
    try {
      const reportId = Number(req.params.reportId as string);
      if (isNaN(reportId)) { res.status(400).json({ error: "invalid report id" }); return; }
      // Full canonical auth: sector scope + state scope (fixes state-bypass gap)
      const authResult = await assertCanViewReport(req, reportId);
      if (!authResult.ok) { res.status(authResult.status).json(authResult.body); return; }
      const { rows } = await pool.query(
        `SELECT id, report_id AS "reportId", file_name AS "fileName",
                content_type AS "contentType", size,
                uploaded_at AS "uploadedAt", availability_status AS "availabilityStatus"
         FROM report_attachments WHERE report_id = $1 ORDER BY uploaded_at ASC`,
        [reportId],
      );
      res.json(rows.map(toPublicReportAttachmentDto));
    } catch (err) { next(err); }
  },
);

// ---------------------------------------------------------------------------
// POST /reports/:reportId/attachments — record a newly uploaded attachment
// Requires: reports.update + draft status + author ownership + sector scope
//
// ATT-02 hardened: client must supply an uploadToken issued by this server
// via POST /storage/uploads/request-url. The objectPath, contentType, and size
// are taken exclusively from the verified token — client-supplied values for
// those fields are ignored.
// ---------------------------------------------------------------------------
router.post(
  "/reports/:reportId/attachments",
  requirePerm("reports.update"),
  async (req, res, next) => {
    try {
      const reportId = Number(req.params.reportId as string);
      if (isNaN(reportId)) { res.status(400).json({ error: "invalid report id" }); return; }

      // Re-authorise at registration time (catches status changes between upload issuance and registration).
      const authCheck = await assertAttachmentMutationAllowed(req, reportId);
      if (!authCheck.ok) { res.status(authCheck.status).json(authCheck.body); return; }

      const body = req.body as { fileName?: string; uploadToken?: string; attachmentType?: string };
      if (!body.fileName || !body.uploadToken) {
        res.status(400).json({ error: "fileName and uploadToken are required" });
        return;
      }

      // Verify the upload token.
      let descriptor;
      try {
        descriptor = verifyUploadToken(body.uploadToken);
      } catch (err) {
        if (err instanceof UploadTokenError) {
          res.status(400).json({ error: "invalid_upload_token", message: err.message });
          return;
        }
        throw err;
      }

      // Token must belong to the requesting user.
      if (descriptor.userId !== req.currentUser!.id) {
        res.status(403).json({ error: "upload_token_user_mismatch" });
        return;
      }

      // Token must be bound to this specific report.
      if (descriptor.reportId !== reportId) {
        res.status(403).json({ error: "upload_not_bound_to_report" });
        return;
      }

      // Token must be for an attachment, not a voice note.
      if (descriptor.entityType !== "attachment") {
        res.status(400).json({ error: "upload_token_entity_type_mismatch" });
        return;
      }

      // Sanitise the display file name (strip path traversal, limit length).
      const safeName = (body.fileName ?? "")
        .replace(/\.\.[/\\]/g, "")
        .replace(/[/\\]/g, "_")
        .slice(0, 255);
      if (!safeName) {
        res.status(400).json({ error: "invalid_file_name" });
        return;
      }

      // Verify the object was actually uploaded to storage before registering it.
      // This closes the gap where a valid token could be used without uploading the file.
      try {
        await objectStorageService.getObjectEntityFile(descriptor.objectPath);
        const metadata = typeof (objectStorageService as unknown as { getObjectEntityMetadata?: unknown }).getObjectEntityMetadata === "function"
          ? await objectStorageService.getObjectEntityMetadata(descriptor.objectPath)
          : { size: descriptor.maxSize, contentType: descriptor.contentType };
        if (
          metadata.size !== descriptor.maxSize
          || !metadata.contentType
          || metadata.contentType.split(";")[0].trim().toLowerCase() !== descriptor.contentType.split(";")[0].trim().toLowerCase()
        ) {
          res.status(422).json({ error: "provider_metadata_mismatch" });
          return;
        }
      } catch (storageErr) {
        if (storageErr instanceof ObjectNotFoundError) {
          res.status(422).json({
            error: "object_not_found_in_storage",
            message: "The file has not been uploaded yet. Upload the file before registering.",
          });
          return;
        }
        throw storageErr;
      }

      // Atomic INSERT with UNIQUE constraint on object_path — prevents race-prone
      // duplicate registrations under concurrent retries.
      // ON CONFLICT DO NOTHING: if a duplicate exists (concurrent retry), no row is
      // inserted and RETURNING yields empty; we then SELECT the existing row.
      //
      // The cutover leaves one canonical object identity per report attachment.
      const { rows } = await pool.query(
        `WITH inserted AS (
           INSERT INTO report_attachments (report_id, file_name, content_type, size, object_path, uploaded_by_id)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (object_path) DO NOTHING
           RETURNING id, report_id, file_name, content_type, size, uploaded_at, availability_status
         ),
         indexed AS (
           INSERT INTO document_registry_entries
             (source_kind, source_id, title, classification, confidentiality, related_record_type, related_record_id)
           SELECT 'report_attachment', inserted.id, inserted.file_name,
             CASE WHEN COALESCE(r.sections->>'reportingAudience', r.sections->>'reportAudience', '') = 'donor'
                         OR r.kind ILIKE '%donor%' THEN 'Donor Reports' ELSE 'Programme Reports' END,
             'internal', 'report', r.id
           FROM inserted
           JOIN reports r ON r.id = inserted.report_id
           ON CONFLICT (source_kind, source_id) DO NOTHING
         )
         SELECT id, report_id AS "reportId", file_name AS "fileName",
                 content_type AS "contentType", size, uploaded_at AS "uploadedAt",
                 availability_status AS "availabilityStatus"
         FROM inserted`,
        [
          reportId,
          safeName,
          descriptor.contentType,   // from token — never from client body
          descriptor.maxSize,       // from token — never from client body
          descriptor.objectPath,    // from token — never from client body
          req.currentUser!.id,
        ],
      );

      if (rows.length > 0) {
        await persistReportAttachmentPresentation(reportId, rows[0], body.attachmentType);
        realtime.broadcastUpdate?.({
          module: "reports",
          action: "attachment_created",
          entityId: reportId,
          actorId: req.currentUser!.id,
          actorName: req.currentUser!.name,
        });
        res.status(201).json(toPublicReportAttachmentDto(rows[0]));
        return;
      }

      // Conflict: another concurrent request already registered this object_path.
      // Return the existing row (idempotent — safe for HTTP retry).
      const { rows: existing } = await pool.query(
        `SELECT id, report_id AS "reportId", file_name AS "fileName",
                content_type AS "contentType", size,
                uploaded_at AS "uploadedAt",
                availability_status AS "availabilityStatus"
         FROM report_attachments WHERE object_path = $1`,
        [descriptor.objectPath],
      );
      if (existing[0]) {
        await pool.query(
          `INSERT INTO document_registry_entries
             (source_kind, source_id, title, classification, confidentiality, related_record_type, related_record_id)
           SELECT 'report_attachment', ra.id, ra.file_name,
             CASE WHEN COALESCE(r.sections->>'reportingAudience', r.sections->>'reportAudience', '') = 'donor'
                         OR r.kind ILIKE '%donor%' THEN 'Donor Reports' ELSE 'Programme Reports' END,
             'internal', 'report', r.id
           FROM report_attachments ra
           JOIN reports r ON r.id = ra.report_id
           WHERE ra.id = $1
           ON CONFLICT (source_kind, source_id) DO NOTHING`,
          [existing[0].id],
        );
        await persistReportAttachmentPresentation(reportId, existing[0], body.attachmentType);
      }
      realtime.broadcastUpdate?.({
        module: "reports",
        action: "attachment_updated",
        entityId: reportId,
        actorId: req.currentUser!.id,
        actorName: req.currentUser!.name,
      });
      res.status(201).json(existing[0] ? toPublicReportAttachmentDto(existing[0]) : undefined);
    } catch (err) { next(err); }
  },
);

// ---------------------------------------------------------------------------
// DELETE /reports/:reportId/attachments/:attachId — remove a saved attachment
// Requires: reports.update + draft status + author ownership + sector scope
// ---------------------------------------------------------------------------
router.delete(
  "/reports/:reportId/attachments/:attachId",
  requirePerm("reports.update"),
  async (req, res, next) => {
    try {
      const reportId = Number(req.params.reportId as string);
      const attachId = Number(req.params.attachId as string);
      if (isNaN(reportId) || isNaN(attachId)) { res.status(400).json({ error: "invalid id" }); return; }
      const authCheck = await assertAttachmentMutationAllowed(req, reportId);
      if (!authCheck.ok) { res.status(authCheck.status).json(authCheck.body); return; }
      // Step 1: Fetch the object_path from DB first (storage-first ordering)
      const fetchResult = await pool.query<{ object_path: string }>(
        `SELECT object_path FROM report_attachments WHERE id = $1 AND report_id = $2`,
        [attachId, reportId],
      );
      if (fetchResult.rowCount === 0) { res.status(404).json({ error: "not found" }); return; }
      const objectPath = fetchResult.rows[0].object_path;
      // Step 2: Delete storage object before DB row (storage-first), with
      //         cross-table ownership check to prevent deleting a storage object
      //         that is also referenced by a voice_notes record.
      if (objectPath) {
        const storageSafe = await isStorageDeleteSafeForRecord(objectPath, "report_attachments");
        if (storageSafe) {
          try {
            await deleteStorageObjectSafely(objectPath);
          } catch (_storErr) {
            console.error("[ATT-05] attachment_delete storage_error attachId=%d reportId=%d", attachId, reportId);
            res.status(500).json({ error: "attachment_storage_delete_failed" });
            return;
          }
        } else {
          console.warn("[ATT-05] attachment_delete skipping storage delete — objectPath cross-referenced in voice_notes attachId=%d", attachId);
        }
      }
      // Step 3: Delete DB row
      const result = await pool.query(
        `WITH deleted AS (
           DELETE FROM report_attachments WHERE id = $1 AND report_id = $2 RETURNING id
         ),
         registry_deleted AS (
           DELETE FROM document_registry_entries dre
           USING deleted
           WHERE dre.source_kind = 'report_attachment' AND dre.source_id = deleted.id
           RETURNING dre.id
         )
         SELECT id FROM deleted`,
        [attachId, reportId],
      );
      if (result.rowCount === 0) { res.status(404).json({ error: "not found" }); return; }
      realtime.broadcastUpdate?.({
        module: "reports",
        action: "attachment_deleted",
        entityId: reportId,
        actorId: req.currentUser!.id,
        actorName: req.currentUser!.name,
      });
      res.status(200).json({ ok: true });
    } catch (err) { next(err); }
  },
);

export default router;
