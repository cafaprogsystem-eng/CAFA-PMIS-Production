/**
 * Global Full Operational Access helpers.
 *
 * Implements the approved governance rule:
 *   Program Manager and Super Admin have Full Operational Access across all
 *   CAFA PMIS operational modules and may perform any operationally valid
 *   action, subject only to structural/data-integrity rules and approved
 *   exceptions (root-admin-only, privacy, accounting segregation).
 *
 * See docs/audit-reports/global-full-operational-access-governance.md for the
 * full governance specification.
 */

export type UserForAccess = { role: string; id: number };

/** Roles that are permanently scoped to a single state. */
const STATE_SCOPED_ROLES = new Set([
  "state_office_manager",
  "state_program_officer",
]);

/**
 * Resolves the effective stateId for a location-context-scoped query.
 *
 * - State-scoped roles: their own stateId overrides any query param (fail-closed).
 *   If their stateId is not configured, `denied = true` and they see no data.
 * - HQ roles: validates and returns the query-param stateId (or null for All Locations).
 *   Backend SQL parameterisation prevents injection; invalid IDs return empty results.
 *
 * Use this helper at the start of any endpoint that accepts a `stateId` query param.
 */
export function resolveLocationContext(
  user: UserForAccess & { stateId?: number | null },
  queryStateId: string | undefined,
): { stateId: number | null; denied: boolean } {
  if (STATE_SCOPED_ROLES.has(user.role)) {
    const sid = user.stateId ?? null;
    return { stateId: sid, denied: sid === null };
  }
  // HQ roles: accept a valid positive integer or null (All Locations)
  if (!queryStateId) return { stateId: null, denied: false };
  const n = Number(queryStateId);
  if (!Number.isInteger(n) || n <= 0) return { stateId: null, denied: false };
  return { stateId: n, denied: false };
}

/**
 * Returns true if the user holds Full Operational Access
 * (Program Manager or Super Admin).
 *
 * Use this helper instead of scattering `role === "program_manager" ||
 * role === "super_admin"` checks across routes.
 */
export function hasFullOperationalAccess(user: UserForAccess): boolean {
  return user.role === "program_manager" || user.role === "super_admin";
}

/**
 * Returns true when the action is only available via override — i.e., the user
 * holds Full Operational Access but would not normally be allowed by their
 * standard role grant.
 */
export function isOverrideAction(user: UserForAccess, normallyAllowed: boolean): boolean {
  return hasFullOperationalAccess(user) && !normallyAllowed;
}

export interface OverrideResolution {
  /** Whether the action is ultimately allowed. */
  allowed: boolean;
  /** True when the Full Operational Access override was the deciding factor. */
  usedOverride: boolean;
  /** True when an explicit override_reason must be supplied by the caller. */
  reasonRequired: boolean;
}

/**
 * Resolves whether an action is allowed, taking Full Operational Access into
 * account.  Use at route level to unify normal-role and override paths.
 *
 * @param normallyAllowed  Whether the user's standard role would allow the action.
 * @param user             The current user (needs `role` and `id`).
 * @param opts.requireReasonForOverride  Whether an override_reason is mandatory
 *   when the override path is taken.  Defaults to true.
 */
export function resolveAccess(
  normallyAllowed: boolean,
  user: UserForAccess,
  opts?: { requireReasonForOverride?: boolean },
): OverrideResolution {
  if (normallyAllowed) {
    return { allowed: true, usedOverride: false, reasonRequired: false };
  }
  if (hasFullOperationalAccess(user)) {
    return {
      allowed: true,
      usedOverride: true,
      reasonRequired: opts?.requireReasonForOverride ?? true,
    };
  }
  return { allowed: false, usedOverride: false, reasonRequired: false };
}
