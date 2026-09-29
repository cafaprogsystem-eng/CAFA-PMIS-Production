import type { QueryExecutor } from "./db";
import { hasPerm, permissionsFor, type CurrentUser } from "./rbac";
import { resolveReportViewAccess } from "./report-auth";

/**
 * Ported from artifacts/api-server/src/lib/realtime.ts:180-407 (parseOperationalEntityType,
 * parseOperationalEntityId, accessUserForPermissions, hasRecordReadPermission,
 * canMutateOperationalRecord, isStateScopedRole, stateScopeAllows, sectorScopeAllows,
 * stringList, canAccessOperationalRecord).
 *
 * Non-HTTP record-read/mutate boundary shared by the record-locking routes and the
 * Durable Object's delivery-time authorization for project/report/plan/risk domain
 * events. Mirrors the same state/sector/assignment restrictions the REST routes
 * enforce, treating absent scope metadata as a denial.
 */

export const OPERATIONAL_ENTITY_TYPES = ["project", "report", "plan", "risk"] as const;
export type OperationalEntityType = (typeof OPERATIONAL_ENTITY_TYPES)[number];

export interface OperationalRecordAccessUser {
  id: number;
  role: string;
  stateId: number | null;
  sectors: string[] | null;
}

export function parseOperationalEntityType(value: unknown): OperationalEntityType | null {
  return typeof value === "string" && (OPERATIONAL_ENTITY_TYPES as readonly string[]).includes(value)
    ? (value as OperationalEntityType)
    : null;
}

export function parseOperationalEntityId(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : null;
}

function accessUserForPermissions(user: OperationalRecordAccessUser): CurrentUser {
  return {
    id: user.id,
    name: "",
    email: "",
    role: user.role,
    roleLabel: "",
    scope: user.stateId === null ? "hq" : "state",
    stateId: user.stateId,
    stateName: null,
    sector: user.sectors?.join(",") ?? null,
    sectors: user.sectors,
    avatarUrl: null,
  };
}

/** Exported for the Durable Object's deletion-audience re-check (emitAuthorizedDomainEvent's "deleted" path). */
export function hasRecordReadPermission(user: OperationalRecordAccessUser, entityType: OperationalEntityType): boolean {
  const perms = permissionsFor(accessUserForPermissions(user));
  const required = entityType === "project"
    ? ["projects.view", "projects.view.state"]
    : entityType === "report"
      ? ["reports.view", "reports.view.state"]
      : entityType === "risk"
        ? ["risks.view", "risks.view.state"]
        // Plans predate a dedicated read capability. Existing routes grant
        // access through operational create/update/approval permissions.
        : ["plans.view", "plans.create", "plans.update", "plans.approve.coordination", "plans.approve.technical", "plans.approve.final"];
  return required.some((perm) => hasPerm(perms, perm));
}

/** Lock ownership is a write, not a read capability. */
export function canMutateOperationalRecord(
  user: OperationalRecordAccessUser,
  entityType: OperationalEntityType,
): boolean {
  const perms = permissionsFor(accessUserForPermissions(user));
  const required = entityType === "project"
    ? "projects.update"
    : entityType === "report"
      ? "reports.update"
      : entityType === "plan"
        ? "plans.update"
        : "risks.update";
  return hasPerm(perms, required);
}

function isStateScopedRole(role: string): boolean {
  return role === "state_program_officer" || role === "state_office_manager";
}

function stateScopeAllows(user: OperationalRecordAccessUser, stateId: number | null): boolean {
  return !isStateScopedRole(user.role) || (user.stateId !== null && stateId === user.stateId);
}

function sectorScopeAllows(user: OperationalRecordAccessUser, sectors: string[]): boolean {
  if (user.role !== "technical_coordinator") return true;
  // A malformed/missing TC assignment fails closed, as it does in HTTP routes.
  return (user.sectors ?? []).some((sector) => sectors.includes(sector));
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && item.length > 0);
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) return stringList(parsed);
    } catch {
      return value.split(",").map((part) => part.trim()).filter(Boolean);
    }
  }
  return [];
}

/**
 * Non-HTTP record-read boundary used by record watches/locks and every
 * operational domain-event delivery. Mirrors the current HTTP state,
 * assignment, and sector restrictions while treating absent scope metadata
 * as a denial.
 */
export async function canAccessOperationalRecord(
  db: QueryExecutor,
  user: OperationalRecordAccessUser,
  entityType: OperationalEntityType,
  entityId: number,
): Promise<boolean> {
  if (!parseOperationalEntityId(entityId) || !hasRecordReadPermission(user, entityType)) return false;

  if (entityType === "project") {
    const result = await db.query<{ sector: string | null; sectors: unknown }>(
      `SELECT sector, COALESCE(sectors, '[]'::jsonb) AS sectors
         FROM projects
        WHERE id = $1 AND deleted_at IS NULL`,
      [entityId],
    );
    const row = result.rows[0];
    const sectors = [...new Set([
      ...(row?.sector ? [row.sector] : []),
      ...stringList(row?.sectors),
    ])];
    if (!row || !sectorScopeAllows(user, sectors)) return false;
    if (user.role === "state_program_officer") {
      if (user.stateId === null) return false;
      const assigned = await db.query(
        `SELECT 1 FROM project_assignments WHERE project_id = $1 AND user_id = $2 LIMIT 1`,
        [entityId, user.id],
      );
      return (assigned.rowCount ?? assigned.rows.length) > 0;
    }
    if (user.role === "state_office_manager") {
      if (user.stateId === null) return false;
      const linked = await db.query(
        `SELECT 1 FROM project_states WHERE project_id = $1 AND state_id = $2 LIMIT 1`,
        [entityId, user.stateId],
      );
      return (linked.rowCount ?? linked.rows.length) > 0;
    }
    return true;
  }

  if (entityType === "report") {
    const access = await resolveReportViewAccess(db, {
      id: user.id, role: user.role, stateId: user.stateId, sectors: user.sectors,
    }, entityId);
    return access.allowed;
  }

  if (entityType === "plan") {
    const result = await db.query<{
      state_id: number | null;
      location_type: string | null;
      sectors: unknown;
    }>(
      `SELECT pl.state_id, pl.location_type,
              CASE
                WHEN jsonb_array_length(COALESCE(pl.sectors, '[]'::jsonb)) > 0 THEN pl.sectors
                WHEN NULLIF(pl.sector, '') IS NOT NULL THEN jsonb_build_array(pl.sector)
                WHEN NULLIF(p.sector, '') IS NOT NULL THEN jsonb_build_array(p.sector)
                ELSE '[]'::jsonb
              END AS sectors
         FROM plans pl
         LEFT JOIN projects p ON p.id = pl.project_id
        WHERE pl.id = $1`,
      [entityId],
    );
    const row = result.rows[0];
    if (
      !row ||
      (row.location_type === "hq" && isStateScopedRole(user.role)) ||
      !stateScopeAllows(user, row.state_id)
    ) return false;
    const sectors = stringList(row.sectors);
    return sectorScopeAllows(user, sectors);
  }

  const result = await db.query<{ state_id: number | null; sector: string | null }>(
    `SELECT r.state_id, p.sector
       FROM risks r
       LEFT JOIN projects p ON p.id = r.project_id AND p.deleted_at IS NULL
      WHERE r.id = $1`,
    [entityId],
  );
  const row = result.rows[0];
  return Boolean(row && stateScopeAllows(user, row.state_id) && sectorScopeAllows(user, row.sector ? [row.sector] : []));
}
