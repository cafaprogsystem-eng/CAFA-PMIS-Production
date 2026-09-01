/**
 * Canonical Report Type, Frequency, and Status constants.
 *
 * Single source of truth consumed by:
 * - GET /reports (list, stats)
 * - GET /dashboard/reports-summary
 * - POST /reports/:id/transitions
 * - All filter helpers and tests
 */

// ── Canonical types ──────────────────────────────────────────────────────────

export const CANONICAL_REPORT_TYPES = [
  "project",
  "activity",
  "program_state",
  "hq_sector",
] as const;
export type CanonicalReportType = (typeof CANONICAL_REPORT_TYPES)[number];

/** Visible labels for canonical report types (singular). */
export const REPORT_TYPE_LABELS: Record<CanonicalReportType, string> = {
  project: "Project Report",
  activity: "Activity Report",
  program_state: "State Programme Report",
  hq_sector: "HQ Sector Report",
};

// ── Canonical frequencies ────────────────────────────────────────────────────

export const CANONICAL_FREQUENCIES = [
  "monthly",
  "quarterly",
  "annual",
  "on_demand",
] as const;
export type CanonicalFrequency = (typeof CANONICAL_FREQUENCIES)[number];

/**
 * Scheduled project reporting frequencies (Task #325 / Model D).
 * The set of values allowed for projects.reporting_frequency.
 * 'on_demand' is deliberately EXCLUDED: on-demand reports are supplementary
 * and never a project's scheduled cycle.
 */
export const SCHEDULED_FREQUENCIES = ["monthly", "quarterly", "annual"] as const;
export type ScheduledFrequency = (typeof SCHEDULED_FREQUENCIES)[number];

// ── Status groups ────────────────────────────────────────────────────────────

/**
 * ACTIVE workflow statuses — statuses that the NEW author-based workflow can
 * produce for newly created or re-submitted reports.
 *
 * "state_reviewed" is NOT in this set: the new workflow has no transition that
 * enters state_reviewed. This set is used for new-workflow transition guards.
 */
export const REPORT_ACTIVE_AWAITING_APPROVAL_STATUSES = [
  "submitted",
  "technically_approved",
  "coordination_approved",
] as const;

/**
 * SUPPORTED historical awaiting-approval statuses — includes "state_reviewed"
 * because historical project/activity reports may legitimately be in this status
 * (they reached it under the old 5-step workflow before Migration 008).
 *
 * Use this set for dashboard KPI counting so factual historical records are not
 * silently dropped from the "Awaiting Approval" total.
 *
 * The distinction between ACTIVE and SUPPORTED is:
 *   ACTIVE   = statuses the new workflow can enter  (no state_reviewed)
 *   SUPPORTED = statuses the system may still hold  (includes state_reviewed)
 */
export const REPORT_AWAITING_APPROVAL_STATUSES = [
  "submitted",
  "state_reviewed",
  "technically_approved",
  "coordination_approved",
] as const;

export const REPORT_DRAFT_STATUSES = ["draft"] as const;
export const REPORT_APPROVED_STATUSES = ["approved"] as const;

/**
 * Reports that have entered the workflow at least once and remain in the
 * operational KPI population. Rejected reports are included because they were
 * submitted; archived reports remain excluded by REPORT_TOTAL_STATUSES.
 */
export const REPORT_SUBMITTED_STATUSES = [
  "submitted",
  "state_reviewed",
  "technically_approved",
  "coordination_approved",
  "approved",
  "rejected",
] as const;

/**
 * Statuses included in the operational Total Reports count.
 * Excludes "archived" — archived reports are readable but excluded from KPIs.
 * Includes "state_reviewed" because historical reports may legitimately carry
 * that status and must not be silently excluded from total counts.
 */
export const REPORT_TOTAL_STATUSES = [
  "draft",
  "submitted",
  "state_reviewed",
  "technically_approved",
  "coordination_approved",
  "approved",
  "rejected",
] as const;

/** All statuses that represent a final (terminal) outcome. */
export const REPORT_TERMINAL_STATUSES = ["rejected", "archived"] as const;

// ── SQL array literals ───────────────────────────────────────────────────────
// These are injected into raw SQL strings — values are constants, not user input.

export const CANONICAL_TYPES_SQL = `ARRAY['project','activity','program_state','hq_sector']`;

/** Active workflow awaiting-approval states (new reports only — no state_reviewed). */
export const ACTIVE_AWAITING_APPROVAL_STATUSES_SQL = `ARRAY['submitted','technically_approved','coordination_approved']`;

/** Supported awaiting-approval states (includes historical state_reviewed for KPI counting). */
export const AWAITING_APPROVAL_STATUSES_SQL = `ARRAY['submitted','state_reviewed','technically_approved','coordination_approved']`;

export const TOTAL_STATUSES_SQL = `ARRAY['draft','submitted','state_reviewed','technically_approved','coordination_approved','approved','rejected']`;
export const SUBMITTED_STATUSES_SQL = `ARRAY['submitted','state_reviewed','technically_approved','coordination_approved','approved','rejected']`;

/**
 * Operational-population SQL predicate fragments.
 *
 * The operational report population excludes:
 *   - migration_is_duplicate = TRUE  (historical duplicates preserved by migration 006)
 *   - migration_status_unverified = TRUE (records whose pre-migration status is unverifiable)
 *
 * These two predicates define the boundary between historical/migration metadata
 * and the live operational report population used in all KPI aggregations.
 *
 * Usage: qualify each element with the reports table alias before embedding
 * in a WHERE clause, e.g. `r.${OPERATIONAL_POPULATION_FILTERS[0]}`.
 * Or use the helper `operationalPopulationSQL(alias?)` for a ready-made AND fragment.
 *
 * Apply to: GET /reports/stats, GET /dashboard/reports-summary (all sub-queries).
 * Do NOT apply to: individual record reads, workflow transitions, admin history views.
 */
export const OPERATIONAL_POPULATION_FILTERS = [
  "migration_is_duplicate = FALSE",
  "migration_status_unverified = FALSE",
] as const;

/**
 * Returns a SQL AND fragment that restricts to the operational report population.
 * Safe to embed directly in a WHERE clause.
 * @param alias - reports table alias (default "r")
 */
export function operationalPopulationSQL(alias = "r"): string {
  return OPERATIONAL_POPULATION_FILTERS
    .map((f) => `${alias}.${f}`)
    .join(" AND ");
}

// ── Workflow definitions ─────────────────────────────────────────────────────
//
// The transition tables and workflow-resolution functions now live in the
// shared @workspace/report-transitions package so the frontend (reports.tsx)
// derives its workflow action buttons from the exact same source this route
// enforces, instead of a hand-maintained copy that had already drifted (the
// HQSR "spc_fallback" coordination-review permission — see that package's
// doc comment for the full history).
export {
  type ReportTransitionRule as TransitionRule,
  type WorkflowActions,
  REPORT_WORKFLOWS,
  getProjectActivityWorkflow,
  getRevisionPerm,
} from "@workspace/report-transitions";

// ── Type guards ──────────────────────────────────────────────────────────────

export function isCanonicalReportType(v: unknown): v is CanonicalReportType {
  return CANONICAL_REPORT_TYPES.includes(v as CanonicalReportType);
}

export function isCanonicalFrequency(v: unknown): v is CanonicalFrequency {
  return CANONICAL_FREQUENCIES.includes(v as CanonicalFrequency);
}
