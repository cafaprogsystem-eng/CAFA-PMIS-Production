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

/**
 * Per-type transition definitions.
 * Each action specifies the valid from-statuses, the resulting status, and the
 * permission required to execute it.
 *
 * Active Project / Activity workflows (author-based, no state_reviewed entry):
 *   state_authored:    draft → submitted → technically_approved → coordination_approved → approved
 *   technical_authored: draft → submitted → coordination_approved → approved
 *
 * Historical compatibility: historical records may be in "state_reviewed" — the
 * STATE_AUTHORED_TRANSITIONS include state_reviewed as a valid from-state for
 * technical_review so TCs can progress these records without re-entering state_reviewed.
 *
 * HQ Sector / State Programme report workflow (3-step chain):
 *   draft → submitted → coordination_approved → approved
 */

export interface TransitionRule {
  from: readonly string[];
  to: string;
  perm: string;
}

export type WorkflowActions = Record<string, TransitionRule>;

/**
 * PATH A — SPO-authored Project and Activity Reports.
 *
 * The author is a State Programme Officer. Technical Review by a sector-matched
 * Technical Coordinator is MANDATORY before Coordination Review can proceed.
 *
 *   draft → submitted                    (SPO submits)
 *   submitted → technically_approved     (TC performs Technical Review)
 *   technically_approved → coord…        (SPC performs Coordination Review)
 *   coordination_approved → approved     (PM performs Final Approval)
 *
 * SPC MUST NOT approve directly from submitted for this path.
 * TC MUST NOT technically-review their own report (self-review forbidden).
 */
const STATE_AUTHORED_TRANSITIONS: WorkflowActions = {
  submit: {
    from: ["draft"],
    to: "submitted",
    perm: "reports.create",
  },
  technical_review: {
    // Active new reports arrive here from "submitted".
    // Historical compatibility: reports that were in "state_reviewed" under the old
    // 5-step workflow are also valid from-states so TCs can progress them.
    // No NEW report will ever enter state_reviewed — this only handles existing records.
    from: ["submitted", "state_reviewed"],
    to: "technically_approved",
    perm: "reports.approve.technical",
  },
  coordination_review: {
    from: ["technically_approved"],
    to: "coordination_approved",
    perm: "reports.approve.coordination",
  },
  final_approve: {
    from: ["coordination_approved"],
    to: "approved",
    perm: "reports.approve.final",
  },
  // reject / request_revision: perm resolved dynamically per status via getRevisionPerm.
  // "state_reviewed" included for historical records that need to be rejected/returned.
  reject: {
    from: ["submitted", "state_reviewed", "technically_approved", "coordination_approved"],
    to: "rejected",
    perm: "reports.approve.technical", // minimum; dynamically upgraded in route
  },
  request_revision: {
    from: ["submitted", "state_reviewed", "technically_approved", "coordination_approved"],
    to: "draft",
    perm: "reports.approve.technical", // minimum; dynamically upgraded in route
  },
  archive: {
    from: ["approved", "rejected"],
    to: "archived",
    perm: "reports.approve.final",
  },
};

/**
 * PATH B — TC-authored Project and Activity Reports.
 *
 * The author is a Technical Coordinator. Technical Review is NOT APPLICABLE:
 * requiring the TC to review their own report would be self-review, which is
 * explicitly prohibited. SPC receives the submitted report directly.
 *
 *   draft → submitted                    (TC submits)
 *   submitted → coordination_approved    (SPC performs Coordination Review)
 *   coordination_approved → approved     (PM performs Final Approval)
 *
 * There is NO submitted → technically_approved step for this path.
 */
const TECHNICAL_AUTHORED_TRANSITIONS: WorkflowActions = {
  submit: {
    from: ["draft"],
    to: "submitted",
    perm: "reports.create",
  },
  coordination_review: {
    from: ["submitted"],
    to: "coordination_approved",
    perm: "reports.approve.coordination",
  },
  final_approve: {
    from: ["coordination_approved"],
    to: "approved",
    perm: "reports.approve.final",
  },
  reject: {
    from: ["submitted", "coordination_approved"],
    to: "rejected",
    perm: "reports.approve.coordination",
  },
  request_revision: {
    from: ["submitted", "coordination_approved"],
    to: "draft",
    perm: "reports.approve.coordination",
  },
  archive: {
    from: ["approved", "rejected"],
    to: "archived",
    perm: "reports.approve.final",
  },
};

/**
 * Simple chain — State Programme Reports and HQ Sector Reports.
 * These types have a single fixed workflow regardless of author role.
 *
 *   draft → submitted                    (SPO / TC submits)
 *   submitted → coordination_approved    (SPC performs Coordination Review)
 *   coordination_approved → approved     (PM performs Final Approval)
 */
const SIMPLE_CHAIN_TRANSITIONS: WorkflowActions = {
  submit: {
    from: ["draft"],
    to: "submitted",
    perm: "reports.create",
  },
  coordination_review: {
    from: ["submitted"],
    to: "coordination_approved",
    perm: "reports.approve.coordination",
  },
  final_approve: {
    from: ["coordination_approved"],
    to: "approved",
    perm: "reports.approve.final",
  },
  reject: {
    from: ["submitted", "coordination_approved"],
    to: "rejected",
    perm: "reports.approve.coordination",
  },
  request_revision: {
    from: ["submitted", "coordination_approved"],
    to: "draft",
    perm: "reports.approve.coordination",
  },
  archive: {
    from: ["approved", "rejected"],
    to: "archived",
    perm: "reports.approve.final",
  },
};

/**
 * Static workflows for report types with a single fixed chain (program_state, hq_sector).
 * For project and activity reports use getProjectActivityWorkflow() instead —
 * their chain is author-dependent.
 */
export const REPORT_WORKFLOWS: Record<string, WorkflowActions> = {
  program_state: SIMPLE_CHAIN_TRANSITIONS,
  hq_sector: SIMPLE_CHAIN_TRANSITIONS,
};

/**
 * Returns the correct workflow for a Project or Activity Report based on
 * the immutable workflow_path stored on the record.
 *
 *   "technical_authored" → PATH B: no Technical Review (TC is the author)
 *   "state_authored" / null / undefined → PATH A: Technical Review is mandatory
 *
 * Canonical workflow_path values (enforced by DB CHECK constraint):
 *   "technical_authored" — TC is the original report author; Technical Review is skipped.
 *   "state_authored"     — SPO or non-TC is the original report author; Technical Review is mandatory.
 *   null                 — historical records where author role could not be resolved;
 *                          runtime falls back to state_authored conservatively.
 *
 * This function must be used instead of REPORT_WORKFLOWS for project / activity types.
 * The workflow path is frozen at creation and must not be re-derived from the current
 * user's role at review time.
 */
export function getProjectActivityWorkflow(
  workflowPath: string | null | undefined,
): WorkflowActions {
  return workflowPath === "technical_authored"
    ? TECHNICAL_AUTHORED_TRANSITIONS
    : STATE_AUTHORED_TRANSITIONS; // default: state_authored (conservative)
}

/**
 * For project/activity reports: the minimum permission required to reject or
 * request revision depends on the current status AND the report's workflow path.
 *
 * State-authored (SPO created):
 *   submitted            → reports.approve.technical  (TC is active reviewer)
 *   technically_approved → reports.approve.coordination  (SPC is active reviewer)
 *   coordination_approved → reports.approve.coordination  (SPC can return)
 *
 * Technical-authored (TC created):
 *   submitted / coordination_approved → reports.approve.coordination  (SPC is active reviewer)
 *
 * For hq_sector / program_state: always coordination.
 */
export function getRevisionPerm(
  reportType: string,
  fromStatus: string,
  workflowPath?: string | null,
): string {
  if (reportType === "project" || reportType === "activity") {
    if (workflowPath === "technical_authored") {
      // TC-authored: SPC handles all reject / return-for-revision
      return "reports.approve.coordination";
    }
    // State-authored: TC reviews at submitted and state_reviewed (historical compat); SPC thereafter
    if (fromStatus === "submitted" || fromStatus === "state_reviewed") return "reports.approve.technical";
    return "reports.approve.coordination"; // technically_approved or coordination_approved
  }
  // hq_sector / program_state — always coordination
  return "reports.approve.coordination";
}

// ── Type guards ──────────────────────────────────────────────────────────────

export function isCanonicalReportType(v: unknown): v is CanonicalReportType {
  return CANONICAL_REPORT_TYPES.includes(v as CanonicalReportType);
}

export function isCanonicalFrequency(v: unknown): v is CanonicalFrequency {
  return CANONICAL_FREQUENCIES.includes(v as CanonicalFrequency);
}
