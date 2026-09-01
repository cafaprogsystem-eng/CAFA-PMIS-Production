/**
 * Canonical Plan workflow transition table.
 *
 * Single source of truth shared by the backend (routes/plans.ts, which enforces
 * every transition against these exact from/to/permission rules) and the
 * frontend (plan-detail.tsx, which derives the workflow action buttons it
 * offers from this same table). Before this package existed, the frontend
 * hand-maintained its own parallel copy of this table, which could — and did —
 * drift from the backend's actual enforcement (e.g. a stale permission key).
 *
 * Plain data only — no framework or Node-only imports — so it can be consumed
 * unmodified by both the Express backend and the Vite-bundled browser frontend.
 */

export interface PlanTransitionRule {
  /** Statuses this transition may be triggered from. */
  from: string[];
  /** Status the plan moves to when this transition succeeds. */
  to: string;
}

export const PLAN_TRANSITIONS: Record<string, PlanTransitionRule> = {
  submit: { from: ["draft"], to: "submitted" },
  technical_review: { from: ["submitted"], to: "technically_approved" },
  coordination_review: { from: ["technically_approved"], to: "coordination_approved" },
  final_approve: { from: ["coordination_approved"], to: "approved" },
  activate: { from: ["approved"], to: "active" },
  start: { from: ["active"], to: "in_progress" },
  mark_delayed: { from: ["active", "in_progress"], to: "delayed" },
  complete: { from: ["active", "in_progress", "delayed"], to: "completed" },
  cancel: { from: ["draft", "submitted", "technically_approved", "coordination_approved", "approved", "active", "in_progress", "delayed"], to: "cancelled" },
  archive: { from: ["completed", "cancelled"], to: "archived" },
  reject: { from: ["submitted", "technically_approved", "coordination_approved"], to: "rejected" },
  request_revision: { from: ["submitted", "technically_approved", "coordination_approved"], to: "draft" },
};

/** Permission required to trigger each transition action. */
export const PLAN_TRANSITION_PERMS: Record<string, string> = {
  submit: "plans.create",
  technical_review: "plans.approve.technical",
  coordination_review: "plans.approve.coordination",
  final_approve: "plans.approve.final",
  activate: "plans.update",
  start: "plans.update",
  mark_delayed: "plans.update",
  complete: "plans.update",
  cancel: "plans.update",
  archive: "plans.update",
  reject: "plans.approve.technical",
  request_revision: "plans.approve.technical",
};
