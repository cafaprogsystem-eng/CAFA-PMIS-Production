/**
 * Frontend geographic-scope helpers.
 *
 * Derives authorisation decisions from data the backend already returns on
 * the authenticated user object.  A discriminated union makes the three
 * possible scope outcomes explicit and prevents the ambiguity where an
 * empty array could mean either "org-wide" or "no valid scope".
 */

// ── Global Full Operational Access ────────────────────────────────────────────

/**
 * Returns true if the user holds Full Operational Access (Program Manager or
 * Super Admin).  PM and super_admin may perform any operationally valid action
 * across all CAFA PMIS modules.
 *
 * Backend is authoritative — this helper is for UI visibility only.
 * See docs/audit-reports/global-full-operational-access-governance.md.
 */
export function hasFullOperationalAccess(user?: { role?: string }): boolean {
  return user?.role === "program_manager" || user?.role === "super_admin";
}

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * The three mutually exclusive geographic-scope outcomes for a user:
 *
 * single_state      — backend assigned exactly one authorised state.
 *                     State field must be locked to stateIds[0].
 *
 * organisation_wide — user has explicit org-wide geographic access.
 *                     State selector is shown; all states are available.
 *
 * none              — scope is missing, malformed, or not yet resolved.
 *                     Fail closed: expose zero states, do not fall back
 *                     to the global states list.
 */
export type GeographicScope =
  | { type: "single_state";      stateIds: [number] }
  | { type: "organisation_wide"; stateIds: []       }
  | { type: "none";              stateIds: []       };

// ── Internal role sets ────────────────────────────────────────────────────────

/**
 * Roles that carry no state restriction — they are authorised for all states.
 *
 * Technical Coordinator and HQ sector roles are sector-scoped but carry no
 * state restriction; they resolve to `organisation_wide` for state purposes,
 * matching the existing behaviour of every state-scoped endpoint in the API.
 *
 * This list is the single source of truth for org-wide state access on the
 * frontend.  It must be kept in sync with `permissionsFor()` in the backend's
 * `currentUser.ts` as roles are added or changed.
 */
const ORG_WIDE_STATE_ROLES = new Set([
  "super_admin",
  "executive_director",
  "program_manager",
  "senior_program_coordinator",
  "technical_coordinator",    // sector-scoped only; no state restriction
  // NOTE: "hq_sector_coordinator" and "hq_sector_officer" were removed — they
  // are not in VALID_ROLES on the backend and cannot be assigned to any user.
  // Any account carrying a legacy phantom role receives universal-only
  // permissions from permissionsFor() and must be re-assigned by an admin.
]);

/**
 * Roles for which the backend always sets a `stateId`.
 * If `stateId` is absent for one of these roles the user is misconfigured
 * and the scope resolves to `none` (fail closed).
 *
 * Canonical backend role IDs only — aliases "state_manager" and "state_officer"
 * are NOT valid backend role names and must not appear here.
 */
const SINGLE_STATE_ROLES = new Set([
  "state_program_officer",
  "state_office_manager",
]);

// ── PMR authorship ────────────────────────────────────────────────────────────

/** Canonical PMR author roles — mirrors backend PMR_AUTHOR_ROLES. */
export const PMR_AUTHOR_ROLES = new Set([
  "state_program_officer",
  "technical_coordinator",
  "super_admin",
  "program_manager", // Full Operational Access override (Task #373)
]);

/** Returns true if the given role is an approved PMR author. */
export function canAuthorProjectReport(role: string | undefined): boolean {
  return PMR_AUTHOR_ROLES.has(role ?? "");
}

// ── HQ Sector Report authorship ───────────────────────────────────────────────

/**
 * Canonical HQ Sector Report author roles — mirrors the backend HQSR-001 gate.
 *
 * senior_program_coordinator is intentionally EXCLUDED: SPC fallback authoring
 * (approved by HQSR-BD-1 when no active TC covers the sector) is deferred
 * pending workflow support, so the create action is hidden for SPC until the
 * backend path is enabled. Backend remains authoritative — this is UI
 * visibility only, not security.
 */
export const HQ_SECTOR_AUTHOR_ROLES = new Set([
  "technical_coordinator",
  "super_admin",
  // SPC fallback (HQSR-BD-1/BD-6): SPC may author when no active TC covers the
  // sector. The server-side vacancy check is authoritative — the frontend only
  // shows the create surface; the backend decides eligibility per sector.
  "senior_program_coordinator",
  // PM Full Operational Access override (Task #373): sector validation still
  // applies — backend requires an explicit canonical sector in the body.
  "program_manager",
]);

/**
 * Returns true if the given role is an approved HQ Sector Report author.
 *
 * For Technical Coordinators the check fails closed on sector assignment:
 * a TC with no assigned sector(s) cannot author any HQ Sector Report, so the
 * create action is hidden. Pass the user's raw `sector` value (comma-separated
 * list, as returned by the backend).
 */
export function canAuthorHqSectorReport(
  role: string | undefined,
  userSector?: string | null,
): boolean {
  if (!HQ_SECTOR_AUTHOR_ROLES.has(role ?? "")) return false;
  if (role === "technical_coordinator") {
    const assigned = (userSector ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    return assigned.length > 0;
  }
  return true;
}

/**
 * Canonical State Programme Report author roles — mirrors the backend
 * SPR-003/004 gate (approved SPR-BD-2 governance):
 *   - state_program_officer: primary author (state profile-clamped)
 *   - state_office_manager: bounded fallback — shown the create action; the
 *     backend verifies server-side that no active SPO covers their state and
 *     returns 403 program_state_spo_available otherwise (Option A UX).
 *   - super_admin: emergency authoring with an explicit canonical state.
 * TC, SPC, PM, ED, and Viewer are NOT authors. Backend remains authoritative —
 * this is UI visibility only, not security.
 */
export const PROGRAM_STATE_AUTHOR_ROLES = new Set([
  "state_program_officer",
  "state_office_manager",
  "super_admin",
  // PM Full Operational Access override (Task #373): backend requires explicit
  // stateId since PM has no profile state (same requirement as super_admin).
  "program_manager",
]);
/**
 * Returns the explicit GeographicScope for the authenticated user.
 *
 * Resolution order:
 *   1. null/non-object input               → none
 *   2. role in SINGLE_STATE_ROLES + stateId → single_state
 *   3. role in SINGLE_STATE_ROLES, no stateId → none  (misconfigured — fail closed)
 *   4. role in ORG_WIDE_STATE_ROLES        → organisation_wide
 *   5. unrecognised/unknown role           → none
 *
 * Intentionally returns `none` rather than falling back to `organisation_wide`
 * whenever the scope cannot be positively established.
 */
export function getGeographicScope(user: unknown): GeographicScope {
  if (!user || typeof user !== "object") {
    return { type: "none", stateIds: [] };
  }

  const u = user as Record<string, unknown>;
  const role    = typeof u.role    === "string" ? u.role    : "";
  const stateId = typeof u.stateId === "number" ? u.stateId : null;

  if (SINGLE_STATE_ROLES.has(role)) {
    return stateId !== null
      ? { type: "single_state", stateIds: [stateId] }
      : { type: "none",         stateIds: [] };
  }

  if (ORG_WIDE_STATE_ROLES.has(role)) {
    return { type: "organisation_wide", stateIds: [] };
  }

  // Unknown or unapproved role — fail closed.
  return { type: "none", stateIds: [] };
}

/**
 * Returns true if the given role may see the State Programme Report create
 * action. SPO/SOM with no assigned state fail closed (backend would reject
 * with state_scope_required); super_admin needs no state assignment.
 */
export function canAuthorProgramStateReport(
  role: string | undefined,
  userStateId?: number | null,
): boolean {
  if (!PROGRAM_STATE_AUTHOR_ROLES.has(role ?? "")) return false;
  if (role === "state_program_officer" || role === "state_office_manager") {
    return userStateId != null;
  }
  return true;
}
