/**
 * Project Deletion Policy — central decision helper.
 *
 * This is a pure function (no DB, no I/O) so it can be unit-tested
 * independently of the database layer.
 */

export type DeletionMode = "permanent" | "soft" | "not_allowed";

/**
 * Statuses that definitively indicate a project has reached Final Approval.
 * Once a project's approvals history contains any of these as `toStatus`,
 * Permanent Delete is prohibited forever — regardless of later status changes.
 */
export const FINAL_APPROVAL_STATUSES: readonly string[] = [
  "approved",
  "active",
  "closed",
] as const;

/**
 * Statuses that — without consulting workflow history — are safely pre-approval
 * (they cannot be reached by downgrading from an approved state in the current
 * CAFA workflow, so they default to "permanent" mode unless history says otherwise).
 */
export const PRE_APPROVAL_STATUSES: readonly string[] = [
  "draft",
  "submitted",
  "state_reviewed",
  "technically_approved",
  "coordination_approved",
  "rejected",
] as const;

/**
 * Determines how a project may be deleted.
 *
 * @param project         - Must include at least `status`.
 * @param workflowHistory - The full approvals history for this project.
 *                          Each entry only needs a `toStatus` field.
 * @param canDelete       - Whether the acting user holds `projects.delete` perm
 *                          AND is within authorised scope. Callers should resolve
 *                          both checks before calling this function.
 *
 * Returns:
 *   "not_allowed" — user lacks permission or scope.
 *   "permanent"   — project has never reached Final Approval; hard delete is safe.
 *   "soft"        — project has reached Final Approval (current or historical);
 *                   only soft delete is allowed.
 */
export function getProjectDeletionMode(
  project: { status: string },
  workflowHistory: ReadonlyArray<{ toStatus: string }>,
  canDelete: boolean,
): DeletionMode {
  if (!canDelete) return "not_allowed";

  // Check current status first (fast path for approved/active/closed).
  if (FINAL_APPROVAL_STATUSES.includes(project.status)) return "soft";

  // Check approvals history — a project that was once approved then returned
  // must never regain Permanent Delete eligibility.
  const everApproved = workflowHistory.some((h) =>
    FINAL_APPROVAL_STATUSES.includes(h.toStatus),
  );

  return everApproved ? "soft" : "permanent";
}

/**
 * Validates that a deletion reason is non-empty and meets minimum length.
 * Returns null if valid, or an error string.
 */
export function validateDeletionReason(reason: unknown): string | null {
  if (typeof reason !== "string" || reason.trim().length < 5) {
    return "A deletion reason of at least 5 characters is required.";
  }
  return null;
}

/**
 * Returns true if the supplied confirmation code exactly matches the
 * project code (case-sensitive, no surrounding whitespace).
 */
export function confirmationCodeMatches(input: string, projectCode: string): boolean {
  return input.trim() === projectCode;
}
