/**
 * Canonical Project workflow-status groupings.
 *
 * Single source of truth for "what counts as an active/operational project"
 * and "what counts as awaiting approval", consumed by dashboard.ts and
 * performanceEngine.ts. Before this file existed, each endpoint hand-wrote
 * its own status list — some correctly matching the canonical set, others
 * drifting to a narrower or broader one — so the same concept ("active
 * projects", "pending approvals") could disagree between two KPI cards in
 * the same response, or between the summary card and its own detail view.
 * Mirrors the pattern already used for Reports in reportConstants.ts.
 *
 * Project lifecycle: draft → submitted → technically_approved →
 * coordination_approved → approved → active → closed (plus terminal rejected).
 */

/** A project that has passed at least technical review and is not yet closed. */
export const ACTIVE_PROJECT_STATUSES_SQL = `ARRAY['approved','coordination_approved','technically_approved','active']`;

/** A project sitting at some stage of the approval workflow, not yet fully approved. */
export const AWAITING_PROJECT_APPROVAL_STATUSES_SQL = `ARRAY['submitted','technically_approved','coordination_approved']`;
