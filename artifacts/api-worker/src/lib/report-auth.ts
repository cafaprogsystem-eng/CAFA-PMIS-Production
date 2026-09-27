import type { QueryExecutor } from "./db";
import type { CurrentUser } from "./rbac";
import { assertSectorAllowed, isHqAuthorised } from "./rbac";
import { hasFullOperationalAccess } from "./accessControl";

/**
 * Ported from artifacts/api-server/src/lib/reportAuth.ts.
 *
 * Shared report-view and attachment-mutation authorisation helpers.
 * Adapted: every function takes an explicit `db: QueryExecutor` (no
 * module-level `pool` default) and `user: CurrentUser | undefined` in place
 * of an Express `req`.
 *
 * Security invariants (fail-closed):
 *   1. Report must exist (undefined sector → 404).
 *   2. SPO/SOM must only access reports in their own state.
 *   3. TC must only access reports in their assigned sectors.
 *   4. All other org-wide roles pass (ED, PM, SPC, super_admin, etc.).
 */

export type ReportViewAccess =
  | { allowed: true }
  | { allowed: false; reason: "not_found" | "state_scope_forbidden" | "sector_forbidden" };

/**
 * Returns the authoritative sector for a Report — the single canonical
 * implementation, used by every view/mutation/sector-scope check.
 *
 * Security rule (spec §3):
 *   Project Reports  → return p.sector ONLY (Project Primary Sector is authoritative).
 *                      Fail-closed: if the project has no sector, return null so TC is denied.
 *                      NEVER fall back to r.sector — a stale historical value must not widen access.
 *   Activity Reports → source-aware: project-linked uses the Project's sector as the ONLY
 *                      authority; standalone (project_id IS NULL) uses activity.sector as the
 *                      ONLY authority.
 *   All other types  → return COALESCE(NULLIF(r.sector,''), p.sector) for backwards-compatible
 *                      behaviour (hq_sector reports carry their own authoritative sector in r.sector).
 *
 * Returns:
 *   - string | null  — the effective sector (null means "no sector" which
 *                      is fail-closed for TCs via assertSectorAllowed)
 *   - undefined      — report does not exist
 */
export async function getReportSectorForAuth(
  db: QueryExecutor,
  reportId: number,
): Promise<string | null | undefined> {
  const r = await db.query<{
    reportType: string | null;
    projectId: number | null;
    projectSector: string | null;
    activitySector: string | null;
    effectiveSector: string | null;
  }>(
    `SELECT r.report_type                           AS "reportType",
            r.project_id                            AS "projectId",
            p.sector                                AS "projectSector",
            act.sector                              AS "activitySector",
            COALESCE(NULLIF(r.sector,''), p.sector) AS "effectiveSector"
     FROM reports r
     LEFT JOIN projects    p   ON p.id   = r.project_id
     LEFT JOIN activities  act ON act.id = r.activity_id
     WHERE r.id = $1`,
    [reportId],
  );
  if (r.rows.length === 0) return undefined;
  const { reportType, projectId, projectSector, activitySector, effectiveSector } = r.rows[0];
  if (reportType === "project") return projectSector;
  if (reportType === "activity") {
    return projectId === null ? activitySector : projectSector;
  }
  return effectiveSector;
}

/**
 * Shared report-view decision used by HTTP (and, later, realtime) record access.
 *
 * Keep the report-type-specific sector resolution here rather than allowing
 * another caller to substitute a raw reports.sector value. For a project or
 * project-linked activity report, the project's sector is authoritative.
 */
export async function resolveReportViewAccess(
  db: QueryExecutor,
  user: Pick<CurrentUser, "id" | "role" | "stateId" | "sectors">,
  reportId: number,
): Promise<ReportViewAccess> {
  const sector = await getReportSectorForAuth(db, reportId);
  if (sector === undefined) return { allowed: false, reason: "not_found" };

  const isStateRole =
    user.role === "state_program_officer" ||
    user.role === "state_office_manager";
  if (isStateRole) {
    if (!user.stateId) return { allowed: false, reason: "state_scope_forbidden" };
    const stateCheck = await db.query<{ state_id: number | null; project_id: number | null }>(
      `SELECT state_id, project_id FROM reports WHERE id = $1`,
      [reportId],
    );
    if (stateCheck.rows.length === 0 || stateCheck.rows[0].state_id !== user.stateId) {
      return { allowed: false, reason: "state_scope_forbidden" };
    }
    // An SPO's state alone does not grant access to a project-linked report.
    // This is the deep-link rule used by GET /reports/:reportId: the officer
    // must also be assigned to the linked project.
    if (user.role === "state_program_officer" && stateCheck.rows[0].project_id != null) {
      const assignment = await db.query(
        `SELECT 1 FROM project_assignments WHERE project_id = $1 AND user_id = $2 LIMIT 1`,
        [stateCheck.rows[0].project_id, user.id],
      );
      if (assignment.rows.length === 0) {
        return { allowed: false, reason: "state_scope_forbidden" };
      }
    }
  }

  if (user.role === "technical_coordinator" && (!sector || !(user.sectors ?? []).includes(sector))) {
    return { allowed: false, reason: "sector_forbidden" };
  }
  return { allowed: true };
}

/**
 * Canonical report-view authorisation check.
 *
 * Runs the exact same 3-step check as `GET /reports/:reportId`:
 *   1. getReportSectorForAuth  → undefined  →  404 report not found
 *   2. SPO/SOM state-scope check            →  403 state_scope_forbidden
 *   3. assertSectorAllowed (TC scope)       →  403/404 sector_forbidden
 *
 * Returns `{ ok: true }` when access is permitted, or
 * `{ ok: false, status, body }` when it should be denied.
 * The caller must send the denial response and return early.
 */
export async function assertCanViewReport(
  db: QueryExecutor,
  user: CurrentUser | undefined,
  reportId: number,
): Promise<{ ok: true } | { ok: false; status: number; body: object }> {
  if (!user) {
    return { ok: false, status: 401, body: { error: "unauthorized" } };
  }
  const access = await resolveReportViewAccess(db, user, reportId);
  if (!access.allowed && access.reason === "not_found") {
    return { ok: false, status: 404, body: { error: "report not found" } };
  }
  if (!access.allowed && access.reason === "state_scope_forbidden") {
    return { ok: false, status: 403, body: { error: "state_scope_forbidden" } };
  }
  if (!access.allowed) return { ok: false, status: 403, body: { error: "sector_forbidden" } };
  return { ok: true };
}

/**
 * Shared access check for the non-persisted HQ Sector Report snapshot.
 *
 * HQ Sector Reports are not linked to a State or Project. Therefore the
 * canonical HQ record rule applies: state-scoped roles cannot view them at
 * all, while Technical Coordinators may only view their assigned sectors.
 * Other roles that already hold reports.view retain organisation-wide access.
 */
export function assertCanViewHqSectorSnapshot(
  user: CurrentUser | undefined,
  sector: string | null,
): { ok: true } | { ok: false; status: number; body: object } {
  if (!user) {
    return { ok: false, status: 401, body: { error: "unauthorized" } };
  }
  if (!isHqAuthorised(user)) {
    return { ok: false, status: 403, body: { error: "state_scope_forbidden" } };
  }
  const sectorGuard = assertSectorAllowed(user, sector);
  if (!sectorGuard.ok) return sectorGuard;
  return { ok: true };
}

/**
 * Shared auth helper for attachment/voice-note mutation.
 *
 * Checks: report exists, draft status, author ownership, sector scope.
 * Returns { ok: true } or { ok: false, status, body }.
 */
export async function assertAttachmentMutationAllowed(
  db: QueryExecutor,
  user: CurrentUser | undefined,
  reportId: number,
): Promise<{ ok: true } | { ok: false; status: number; body: object }> {
  if (!user) return { ok: false, status: 401, body: { error: "unauthorized" } };
  const cur = await db.query<{ status: string; authorId: number | null }>(
    `SELECT status, author_id AS "authorId" FROM reports WHERE id = $1`,
    [reportId],
  );
  if (cur.rows.length === 0) return { ok: false, status: 404, body: { error: "report not found" } };
  if (cur.rows[0].status !== "draft") {
    return { ok: false, status: 409, body: { error: "only_draft_reports_can_be_updated" } };
  }
  // Super-admin and PM (Full Operational Access, Task #373) bypass author ownership.
  // author_id is never mutated — the original creator is preserved on all edits.
  const isFullAccess = hasFullOperationalAccess(user);
  const authorId = cur.rows[0].authorId;
  if (!isFullAccess && authorId !== null && authorId !== user.id) {
    return {
      ok: false,
      status: 403,
      body: { error: "draft_edit_forbidden", message: "Only the original report author can edit this draft." },
    };
  }
  const sector = await getReportSectorForAuth(db, reportId);
  const sectorGuard = assertSectorAllowed(user, sector ?? null);
  if (!sectorGuard.ok) return { ok: false, status: sectorGuard.status, body: sectorGuard.body };
  return { ok: true };
}

/**
 * SPR-003/004 — SOM fallback vacancy check.
 *
 * Returns true when at least one ACTIVE state_program_officer is assigned to
 * the given state. Inactive/suspended SPOs do not count; SPOs assigned to
 * other states do not count.
 *
 * Server-side only — never trust a frontend "no SPO available" claim.
 * Mirrors hasActiveTcForSector below (role + status semantics).
 */
export async function hasActiveSpoForState(db: QueryExecutor, stateId: number): Promise<boolean> {
  if (stateId == null || !Number.isFinite(Number(stateId))) return false;
  const res = await db.query<{ count: string }>(
    `SELECT COUNT(*)::int AS count FROM users
     WHERE role = 'state_program_officer' AND status = 'active' AND state_id = $1`,
    [stateId],
  );
  return Number(res.rows[0]?.count ?? 0) > 0;
}

/**
 * HQSR-001 — SPC fallback vacancy check.
 *
 * Returns true when at least one ACTIVE technical_coordinator has an exact
 * assignment to the requested sector. TC sector assignments are stored as a
 * comma-separated list in users.sector; matching is exact-segment (trimmed),
 * never substring. Inactive/suspended TCs do not count; TCs assigned to other
 * sectors do not count.
 *
 * Server-side only — never trust a frontend "no TC available" claim.
 */
export async function hasActiveTcForSector(db: QueryExecutor, sector: string): Promise<boolean> {
  const target = sector.trim();
  if (!target) return false;
  const res = await db.query<{ sector: string | null }>(
    `SELECT sector FROM users
     WHERE role = 'technical_coordinator' AND status = 'active' AND sector IS NOT NULL`,
  );
  return res.rows.some((row) =>
    String(row.sector ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .includes(target),
  );
}
