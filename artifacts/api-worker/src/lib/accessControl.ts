/**
 * Ported verbatim from artifacts/api-server/src/lib/accessControl.ts —
 * pure functions, no framework or DB dependency in the original either.
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
  allowed: boolean;
  usedOverride: boolean;
  reasonRequired: boolean;
}

/**
 * Resolves whether an action is allowed, taking Full Operational Access into
 * account. Use at route level to unify normal-role and override paths.
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
