/**
 * Canonical Report workflow transition tables.
 *
 * Single source of truth shared by the backend (routes/reports.ts, which
 * enforces every transition against these exact from/to/permission rules via
 * lib/reportConstants.ts's re-export) and the frontend (pages/reports.tsx,
 * which derives the workflow action buttons it offers from this same table).
 * Before this package existed, the frontend hand-maintained its own parallel
 * copy (`transitionsFor`), which had already drifted from the backend for the
 * HQ Sector Report "spc_fallback" authoring path: the backend generalised
 * coordination-review to always require reports.approve.coordination (Task
 * #373 — PM now holds it via Full Operational Access, so the old narrower
 * PM-specific reports.approve.final exception was retired), but the frontend
 * kept requiring reports.approve.final for that path, so a role with
 * coordination permission but not final-approval permission would be
 * authorised by the backend yet never see the button.
 *
 * Plain data + pure functions only — no framework or Node-only imports — so
 * it can be consumed unmodified by both the Express backend and the
 * Vite-bundled browser frontend.
 */

export interface ReportTransitionRule {
  /** Statuses this transition may be triggered from. */
  from: readonly string[];
  /** Status the report moves to when this transition succeeds. */
  to: string;
  /** Permission required to execute this transition (static default; reject/
   *  request_revision are further resolved dynamically via getRevisionPerm). */
  perm: string;
}

export type WorkflowActions = Record<string, ReportTransitionRule>;

/**
 * PATH A — SPO-authored Project and Activity Reports.
 *
 * The author is a State Programme Officer. Technical Review by a
 * sector-matched Technical Coordinator is MANDATORY before Coordination
 * Review can proceed.
 *
 *   draft → submitted                    (SPO submits)
 *   submitted → technically_approved     (TC performs Technical Review)
 *   technically_approved → coord…        (SPC performs Coordination Review)
 *   coordination_approved → approved     (PM performs Final Approval)
 *
 * SPC MUST NOT approve directly from submitted for this path.
 * TC MUST NOT technically-review their own report (self-review forbidden).
 */
export const STATE_AUTHORED_TRANSITIONS: WorkflowActions = {
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
export const TECHNICAL_AUTHORED_TRANSITIONS: WorkflowActions = {
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
 * These types have a single fixed workflow regardless of author role or
 * workflow_path (including HQSR's "spc_fallback" authoring path — Task #373
 * generalised PM's coordination-review access via Full Operational Access, so
 * no report-type- or path-specific permission override remains).
 *
 *   draft → submitted                    (SPO / TC submits)
 *   submitted → coordination_approved    (SPC performs Coordination Review)
 *   coordination_approved → approved     (PM performs Final Approval)
 */
export const SIMPLE_CHAIN_TRANSITIONS: WorkflowActions = {
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
 * For hq_sector / program_state: always coordination — including HQSR's
 * "spc_fallback" path (see SIMPLE_CHAIN_TRANSITIONS doc comment above).
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
