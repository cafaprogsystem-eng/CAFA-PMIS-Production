import { Hono } from "hono";
import type { Bindings } from "../lib/db";
import { openDb } from "../lib/db";
import { attachCurrentUser, requireAuth, logAudit, type CurrentUser, type Variables } from "../lib/rbac";
import { SUDAN_STATES } from "../lib/state-master";
import { publishSupportingEvent } from "../lib/realtime";

/**
 * Ported from artifacts/api-server/src/routes/states.ts (521 lines, first
 * file of the post-projects.ts phase). States are master data, not a
 * performance dashboard — deliberately limited to canonical State fields and
 * truthful reference information.
 */

const STATE_ADMIN_ROLES = new Set(["super_admin", "executive_director", "program_manager"]);
const STATE_SCOPED_ROLES = new Set(["state_office_manager", "state_program_officer"]);
const NAME_MAX_LENGTH = 120;
const ARABIC_NAME_MAX_LENGTH = 120;
const CODE_MAX_LENGTH = 24;
const ADDRESS_MAX_LENGTH = 500;

type StateInput = {
  name: string;
  nameAr: string;
  code: string;
  officeAddress: string | null;
};

function isStateRegistryAdmin(role: string | undefined): boolean {
  return Boolean(role && STATE_ADMIN_ROLES.has(role));
}

/**
 * State registry references are organisation-wide, but state-scoped users must
 * not turn a detail, snapshot, or locality query into cross-state operational
 * visibility by supplying a different ID. A missing assignment fails closed.
 */
function stateScopeAllowed(user: CurrentUser | undefined, stateId: number): { ok: true } | { ok: false } {
  if (!user || !STATE_SCOPED_ROLES.has(user.role)) return { ok: true };
  if (user.stateId === stateId) return { ok: true };
  return { ok: false };
}

function parseStateId(raw: string): number | null {
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

function normaliseText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ");
}

function hasUnsafeControlCharacter(value: string): boolean {
  // Newlines and tabs are normalised as whitespace above. Other controls are
  // never meaningful State master data and can make labels unsafe to display.
  return /[\p{Cc}\p{Cf}]/u.test(value);
}

function validateStateInput(body: unknown): { value: StateInput } | { error: string; fields: Record<string, string> } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "validation_failed", fields: { body: "An object is required." } };
  }
  const input = body as Record<string, unknown>;
  const fields: Record<string, string> = {};

  const name = typeof input.name === "string" ? normaliseText(input.name) : "";
  const nameAr = typeof input.nameAr === "string" ? normaliseText(input.nameAr) : "";
  const code = typeof input.code === "string" ? normaliseText(input.code) : "";
  const officeAddressRaw = input.officeAddress;
  const officeAddress = officeAddressRaw == null
    ? null
    : typeof officeAddressRaw === "string" ? normaliseText(officeAddressRaw) : null;

  if (!name) fields.name = "State name is required.";
  else if (name.length > NAME_MAX_LENGTH) fields.name = `State name must be ${NAME_MAX_LENGTH} characters or fewer.`;
  else if (hasUnsafeControlCharacter(name)) fields.name = "State name contains unsupported control characters.";

  if (!nameAr) fields.nameAr = "Arabic State name is required.";
  else if (nameAr.length > ARABIC_NAME_MAX_LENGTH) fields.nameAr = `Arabic State name must be ${ARABIC_NAME_MAX_LENGTH} characters or fewer.`;
  else if (hasUnsafeControlCharacter(nameAr)) fields.nameAr = "Arabic State name contains unsupported control characters.";

  if (!code) fields.code = "State code is required.";
  else if (code.length > CODE_MAX_LENGTH) fields.code = `State code must be ${CODE_MAX_LENGTH} characters or fewer.`;
  else if (hasUnsafeControlCharacter(code)) fields.code = "State code contains unsupported control characters.";

  if (officeAddressRaw !== undefined && officeAddressRaw !== null && typeof officeAddressRaw !== "string") {
    fields.officeAddress = "Office address must be text.";
  } else if (officeAddress && officeAddress.length > ADDRESS_MAX_LENGTH) {
    fields.officeAddress = `Office address must be ${ADDRESS_MAX_LENGTH} characters or fewer.`;
  } else if (officeAddress && hasUnsafeControlCharacter(officeAddress)) {
    fields.officeAddress = "Office address contains unsupported control characters.";
  }

  if (Object.keys(fields).length > 0) return { error: "validation_failed", fields };
  return { value: { name, nameAr, code, officeAddress: officeAddress || null } };
}

function parseLifecycleInput(body: unknown): {
  value: { operationalStatus?: "active" | "inactive"; officeStatus?: "present" | "absent" | "unknown" };
} | { error: string; fields: Record<string, string> } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "validation_failed", fields: { body: "An object is required." } };
  }
  const input = body as Record<string, unknown>;
  if (input.confirmed !== true) {
    return { error: "validation_failed", fields: { confirmed: "A confirmed lifecycle change is required." } };
  }
  const operationalStatus = input.operationalStatus as unknown;
  const officeStatus = input.officeStatus as unknown;
  if (operationalStatus !== undefined && operationalStatus !== "active" && operationalStatus !== "inactive") {
    return { error: "validation_failed", fields: { operationalStatus: "Operational status must be active or inactive." } };
  }
  if (officeStatus !== undefined && officeStatus !== "present" && officeStatus !== "absent" && officeStatus !== "unknown") {
    return { error: "validation_failed", fields: { officeStatus: "Office status is invalid." } };
  }
  if (operationalStatus === undefined && officeStatus === undefined) {
    return { error: "validation_failed", fields: { body: "Choose an operational or office status." } };
  }
  return { value: { operationalStatus: operationalStatus as "active" | "inactive" | undefined, officeStatus: officeStatus as "present" | "absent" | "unknown" | undefined } };
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "23505";
}

// Office managers are resolved live from users (role=state_office_manager,
// state_id=s.id, status='active') rather than the dead states.manager_user_id
// column: more than one active State Office Manager can be assigned to the
// same State at once (no uniqueness constraint enforces otherwise), so a
// single manager_user_id foreign key could never represent that correctly.
const registrySql = `
  SELECT
    s.id,
    s.name,
    s.name_ar AS "nameAr",
    s.code,
    s.operational_status AS "operationalStatus",
    s.office_status AS "officeStatus",
    s.office_address AS "officeAddress",
    s.updated_at AS "updatedAt",
    COALESCE((
      SELECT json_agg(json_build_object('id', u.id, 'name', u.name) ORDER BY u.name)
      FROM users u
      WHERE u.role = 'state_office_manager' AND u.state_id = s.id AND u.status = 'active'
    ), '[]'::json) AS "officeManagers",
    (SELECT COUNT(*)::int FROM localities l WHERE l.state_id = s.id) AS "localitiesCount"
  FROM states s
`;

export const statesRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

statesRoutes.use("/localities", attachCurrentUser, requireAuth);
statesRoutes.use("/localities/*", attachCurrentUser, requireAuth);
statesRoutes.use("/states", attachCurrentUser, requireAuth);
statesRoutes.use("/states/*", attachCurrentUser, requireAuth);

statesRoutes.get("/localities", async (c) => {
  const user = c.get("currentUser");
  const { db, close } = openDb(c);
  try {
    const suppliedStateId = c.req.query("stateId");
    const requestedStateId = suppliedStateId !== undefined ? parseStateId(suppliedStateId) : null;
    if (suppliedStateId !== undefined && requestedStateId === null) {
      return c.json({ error: "invalid_state_id" }, 422);
    }
    const isStateScoped = !!user && STATE_SCOPED_ROLES.has(user.role);
    const stateId = isStateScoped ? (user!.stateId ?? null) : requestedStateId;
    if (isStateScoped && stateId === null) {
      return c.json({ error: "state_forbidden" }, 403);
    }
    if (requestedStateId !== null && stateId !== requestedStateId) {
      return c.json({ error: "state_forbidden" }, 403);
    }
    const sql = `
      SELECT l.id, l.name, l.state_id AS "stateId", s.name AS "stateName",
             s.name_ar AS "stateNameAr"
      FROM localities l JOIN states s ON s.id = l.state_id
      ${stateId ? "WHERE l.state_id = $1" : ""}
      ORDER BY s.name, l.name
    `;
    const { rows } = stateId ? await db.query(sql, [stateId]) : await db.query(sql);
    return c.json(rows);
  } finally {
    close();
  }
});

statesRoutes.get("/states", async (c) => {
  const user = c.get("currentUser");
  const { db, close } = openDb(c);
  try {
    const includeInactive = c.req.query("includeInactive") === "true";
    const officeStatus = c.req.query("officeStatus") ?? null;
    if (includeInactive && !isStateRegistryAdmin(user?.role)) {
      return c.json({
        error: "state_registry_forbidden",
        message: "You do not have permission to manage the State registry.",
      }, 403);
    }
    if (officeStatus !== null && !["present", "absent", "unknown"].includes(officeStatus)) {
      return c.json({ error: "invalid_office_status" }, 422);
    }
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (!includeInactive) conditions.push(`s.operational_status = 'active'`);
    if (officeStatus !== null) {
      values.push(officeStatus);
      conditions.push(`s.office_status = $${values.length}`);
    }
    if (user && STATE_SCOPED_ROLES.has(user.role)) {
      if (user.stateId == null) return c.json([]);
      values.push(user.stateId);
      conditions.push(`s.id = $${values.length}`);
    }
    const { rows } = await db.query(
      `${registrySql}${conditions.length ? ` WHERE ${conditions.join(" AND ")}` : ""} ORDER BY s.name, s.id`,
      values,
    );
    return c.json(rows);
  } finally {
    close();
  }
});

statesRoutes.get("/states/:stateId", async (c) => {
  const user = c.get("currentUser");
  const { db, close } = openDb(c);
  try {
    const stateId = parseStateId(c.req.param("stateId"));
    if (stateId === null) return c.json({ error: "invalid_state_id" }, 422);
    const scopeGuard = stateScopeAllowed(user, stateId);
    if (!scopeGuard.ok) return c.json({ error: "state_forbidden" }, 403);
    const registry = await db.query<Record<string, unknown>>(`${registrySql} WHERE s.id = $1`, [stateId]);
    if (registry.rows.length === 0) return c.json({ error: "state not found" }, 404);
    const state = registry.rows[0];
    const localities = await db.query(`SELECT id, name FROM localities WHERE state_id = $1 ORDER BY name`, [stateId]);
    const projects = await db.query(
      `SELECT p.id, p.code, p.title, p.status, p.sector
      FROM projects p
      JOIN project_states ps ON ps.project_id = p.id
      WHERE ps.state_id = $1 AND p.deleted_at IS NULL
      ORDER BY p.created_at DESC`,
      [stateId],
    );
    return c.json({ ...state, localities: localities.rows, projects: projects.rows });
  } finally {
    close();
  }
});

statesRoutes.post("/states", async (c) => {
  const user = c.get("currentUser");
  if (!isStateRegistryAdmin(user?.role)) {
    return c.json({
      error: "state_registry_forbidden",
      message: "You do not have permission to manage the State registry.",
    }, 403);
  }

  const validated = validateStateInput(await c.req.json());
  if ("error" in validated) return c.json(validated, 422);

  const { db, close } = openDb(c);
  try {
    const { name, nameAr, code, officeAddress } = validated.value;
    if (!SUDAN_STATES.some((state) => state[0] === code && state[1] === name && state[2] === nameAr)) {
      return c.json({ error: "canonical_state_registry_only" }, 409);
    }
    const { rows } = await db.query<{
      id: number; name: string; nameAr: string; code: string; operationalStatus: string; officeStatus: string; officeAddress: string | null;
    }>(
      `INSERT INTO states (name, name_ar, code, office_address, operational_status, office_status)
       VALUES ($1, $2, $3, $4, 'inactive', 'unknown')
       RETURNING id, name, name_ar AS "nameAr", code, operational_status AS "operationalStatus",
                 office_status AS "officeStatus", office_address AS "officeAddress"`,
      [name, nameAr, code, officeAddress],
    );
    const state = { ...rows[0], officeManagers: [] as Array<{ id: number; name: string }>, localitiesCount: 0 };
    await logAudit(db, {
      userId: user!.id,
      action: "create",
      module: "states",
      entityId: state.id,
      newValue: JSON.stringify({ name: state.name, nameAr: state.nameAr, code: state.code, officeAddress: state.officeAddress }),
    });
    await publishSupportingEvent(c.env, { entityType: "state", entityId: state.id, action: "created" });
    return c.json(state, 201);
  } catch (err) {
    if (isUniqueViolation(err)) return c.json({ error: "state_identity_conflict" }, 409);
    throw err;
  } finally {
    close();
  }
});

statesRoutes.patch("/states/:stateId", async (c) => {
  const user = c.get("currentUser");
  if (!isStateRegistryAdmin(user?.role)) {
    return c.json({
      error: "state_registry_forbidden",
      message: "You do not have permission to manage the State registry.",
    }, 403);
  }

  const stateId = parseStateId(c.req.param("stateId"));
  if (stateId === null) return c.json({ error: "invalid_state_id" }, 422);
  const validated = validateStateInput(await c.req.json());
  if ("error" in validated) return c.json(validated, 422);

  const { db, close } = openDb(c);
  try {
    const before = await db.query<{ name: string; nameAr: string; code: string; officeAddress: string | null }>(
      `SELECT name, name_ar AS "nameAr", code, office_address AS "officeAddress" FROM states WHERE id = $1`,
      [stateId],
    );
    if (before.rows.length === 0) return c.json({ error: "state not found" }, 404);

    const { name, nameAr, code, officeAddress } = validated.value;
    if (!SUDAN_STATES.some((state) => state[0] === code && state[1] === name && state[2] === nameAr)) {
      return c.json({ error: "canonical_state_registry_only" }, 409);
    }
    // Opt-in optimistic-concurrency guard, same pattern as risks/plans/reports:
    // a caller that sends x-base-revision (the updatedAt it last read) is
    // rejected with 409 if the row has moved since. Absent the header,
    // behaviour is unchanged.
    const params: unknown[] = [name, nameAr, code, officeAddress, stateId];
    const baseRevision = c.req.header("x-base-revision");
    if (baseRevision) params.push(baseRevision);
    const updated = await db.query<{
      id: number; name: string; nameAr: string; code: string; operationalStatus: string; officeStatus: string; officeAddress: string | null; updatedAt: string;
    }>(
      `UPDATE states
       SET name = $1, name_ar = $2, code = $3, office_address = $4, updated_at = NOW()
       WHERE id = $5${baseRevision ? ` AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $6::timestamptz)` : ""}
       RETURNING id, name, name_ar AS "nameAr", code, operational_status AS "operationalStatus",
                 office_status AS "officeStatus", office_address AS "officeAddress", updated_at AS "updatedAt"`,
      params,
    );
    if (baseRevision && updated.rowCount === 0) {
      return c.json({ error: "offline_conflict", code: "revision_mismatch", message: "The state changed since this form was loaded." }, 409);
    }
    const state = { ...updated.rows[0], officeManagers: [] as Array<{ id: number; name: string }>, localitiesCount: 0 };
    await logAudit(db, {
      userId: user!.id,
      action: "update",
      module: "states",
      entityId: stateId,
      oldValue: JSON.stringify(before.rows[0]),
      newValue: JSON.stringify({ name: state.name, nameAr: state.nameAr, code: state.code, officeAddress: state.officeAddress }),
    });
    await publishSupportingEvent(c.env, { entityType: "state", entityId: stateId, action: "updated" });
    return c.json(state);
  } catch (err) {
    if (isUniqueViolation(err)) return c.json({ error: "state_identity_conflict" }, 409);
    throw err;
  } finally {
    close();
  }
});

statesRoutes.patch("/states/:stateId/lifecycle", async (c) => {
  const user = c.get("currentUser");
  if (!isStateRegistryAdmin(user?.role)) {
    return c.json({
      error: "state_registry_forbidden",
      message: "You do not have permission to manage the State registry.",
    }, 403);
  }
  const stateId = parseStateId(c.req.param("stateId"));
  if (stateId === null) return c.json({ error: "invalid_state_id" }, 422);
  const validated = parseLifecycleInput(await c.req.json());
  if ("error" in validated) return c.json(validated, 422);

  const { db, close } = openDb(c);
  try {
    const before = await db.query<{ operationalStatus: string; officeStatus: string }>(
      `SELECT operational_status AS "operationalStatus", office_status AS "officeStatus" FROM states WHERE id = $1`,
      [stateId],
    );
    if (!before.rows[0]) return c.json({ error: "state not found" }, 404);
    const { operationalStatus, officeStatus } = validated.value;
    const result = await db.query<{
      id: number; name: string; nameAr: string; code: string; operationalStatus: string; officeStatus: string; officeAddress: string | null;
    }>(
      `UPDATE states
          SET operational_status = COALESCE($1, operational_status),
              office_status = COALESCE($2, office_status)
        WHERE id = $3
      RETURNING id, name, name_ar AS "nameAr", code,
                operational_status AS "operationalStatus", office_status AS "officeStatus",
                office_address AS "officeAddress"`,
      [operationalStatus ?? null, officeStatus ?? null, stateId],
    );
    const state = { ...result.rows[0], officeManagers: [] as Array<{ id: number; name: string }>, localitiesCount: 0 };
    if (
      state.operationalStatus !== before.rows[0].operationalStatus ||
      state.officeStatus !== before.rows[0].officeStatus
    ) {
      await logAudit(db, {
        userId: user!.id,
        action: "state_lifecycle_changed",
        module: "states",
        entityId: stateId,
        oldValue: JSON.stringify(before.rows[0]),
        newValue: JSON.stringify({ operationalStatus: state.operationalStatus, officeStatus: state.officeStatus }),
      });
      await publishSupportingEvent(c.env, { entityType: "state", entityId: stateId, action: "lifecycle_changed" });
    }
    return c.json(state);
  } finally {
    close();
  }
});

// ── State Snapshot (for State Program Report form) ───────────────────────────
statesRoutes.get("/states/:stateId/snapshot", async (c) => {
  const user = c.get("currentUser");
  const { db, close } = openDb(c);
  try {
    const stateId = parseStateId(c.req.param("stateId"));
    if (stateId === null) return c.json({ error: "invalid_state_id" }, 422);
    const scopeGuard = stateScopeAllowed(user, stateId);
    if (!scopeGuard.ok) return c.json({ error: "state_forbidden" }, 403);
    const existing = await db.query("SELECT 1 FROM states WHERE id = $1", [stateId]);
    if (existing.rows.length === 0) return c.json({ error: "state not found" }, 404);
    const { rows } = await db.query(`
      SELECT
        COALESCE((
          SELECT COUNT(DISTINCT ps.project_id)::int FROM project_states ps
          JOIN projects p ON p.id = ps.project_id
          WHERE ps.state_id = $1 AND p.status IN ('approved','active')
        ), 0) AS "activeProjects",
        COALESCE((
          SELECT COUNT(DISTINCT p.sector)::int FROM project_states ps
          JOIN projects p ON p.id = ps.project_id
          WHERE ps.state_id = $1 AND p.status IN ('approved','active')
        ), 0) AS "activeSectors",
        COALESCE((
          SELECT COUNT(*)::int FROM beneficiaries WHERE state_id = $1
        ), 0) AS "beneficiariesReached",
        COALESCE((
          SELECT COUNT(*)::int FROM activities
          WHERE state_id = $1 AND status = 'completed'
        ), 0) AS "activitiesCompleted",
        COALESCE((
          SELECT COUNT(*)::int FROM activities
          WHERE state_id = $1 AND status = 'delayed'
        ), 0) AS "delayedActivities",
        COALESCE((
          SELECT COUNT(*)::int FROM risks
          WHERE state_id = $1 AND status NOT IN ('closed','mitigated')
        ), 0) AS "openRisks",
        COALESCE((
          SELECT COUNT(*)::int FROM reports r
          WHERE r.state_id = $1 AND r.status IN ('submitted','technically_approved','coordination_approved')
        ), 0) AS "pendingApprovals"
    `, [stateId]);
    return c.json(rows[0] ?? {});
  } finally {
    close();
  }
});
