import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { logAudit } from "../middlewares/currentUser";
import { SUDAN_STATES } from "../lib/state-master";
import { realtime } from "../lib/realtime";

const router: IRouter = Router();

/**
 * States are master data, not a performance dashboard. This is deliberately
 * limited to canonical State fields and truthful reference information.
 */
// Office managers are resolved live from users (role=state_office_manager,
// state_id=s.id, status='active') rather than the dead states.manager_user_id
// column: more than one active State Office Manager can be assigned to the
// same State at once (no uniqueness constraint enforces otherwise), so a
// single manager_user_id foreign key could never represent that correctly.
// A denormalised single-value column would either silently pick one winner
// or require a business rule ("only one SOM per State") this system has
// never actually enforced.
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

const STATE_ADMIN_ROLES = new Set([
  "super_admin",
  "executive_director",
  "program_manager",
]);
const STATE_SCOPED_ROLES = new Set([
  "state_office_manager",
  "state_program_officer",
]);
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
function stateScopeAllowed(
  req: import("express").Request,
  res: import("express").Response,
  stateId: number,
): boolean {
  const user = req.currentUser;
  if (!user || !STATE_SCOPED_ROLES.has(user.role)) return true;
  if (user.stateId === stateId) return true;
  res.status(403).json({ error: "state_forbidden" });
  return false;
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
  const operationalStatus = input.operationalStatus;
  const officeStatus = input.officeStatus;
  if (operationalStatus !== undefined && operationalStatus !== "active" && operationalStatus !== "inactive") {
    return { error: "validation_failed", fields: { operationalStatus: "Operational status must be active or inactive." } };
  }
  if (officeStatus !== undefined && officeStatus !== "present" && officeStatus !== "absent" && officeStatus !== "unknown") {
    return { error: "validation_failed", fields: { officeStatus: "Office status is invalid." } };
  }
  if (operationalStatus === undefined && officeStatus === undefined) {
    return { error: "validation_failed", fields: { body: "Choose an operational or office status." } };
  }
  return { value: { operationalStatus, officeStatus } };
}

function sendStateAdminForbidden(res: import("express").Response): void {
  res.status(403).json({
    error: "state_registry_forbidden",
    message: "You do not have permission to manage the State registry.",
  });
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "23505";
}

router.get("/localities", async (req, res, next) => {
  try {
    const suppliedStateId = req.query.stateId;
    const requestedStateId = typeof suppliedStateId === "string"
      ? parseStateId(suppliedStateId)
      : null;
    if (suppliedStateId !== undefined && requestedStateId === null) {
      res.status(422).json({ error: "invalid_state_id" });
      return;
    }
    const isStateScoped = !!req.currentUser && STATE_SCOPED_ROLES.has(req.currentUser.role);
    const stateId = isStateScoped
      ? req.currentUser!.stateId
      : requestedStateId;
    if (isStateScoped && stateId === null) {
      res.status(403).json({ error: "state_forbidden" });
      return;
    }
    if (requestedStateId !== null && stateId !== requestedStateId) {
      res.status(403).json({ error: "state_forbidden" });
      return;
    }
    const sql = `
      SELECT l.id, l.name, l.state_id AS "stateId", s.name AS "stateName",
             s.name_ar AS "stateNameAr"
      FROM localities l JOIN states s ON s.id = l.state_id
      ${stateId ? "WHERE l.state_id = $1" : ""}
      ORDER BY s.name, l.name
    `;
    const { rows } = stateId
      ? await pool.query(sql, [stateId])
      : await pool.query(sql);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get("/states", async (req, res, next) => {
  try {
    const includeInactive = req.query.includeInactive === "true";
    const officeStatus = typeof req.query.officeStatus === "string" ? req.query.officeStatus : null;
    if (includeInactive && !isStateRegistryAdmin(req.currentUser?.role)) {
      sendStateAdminForbidden(res);
      return;
    }
    if (officeStatus !== null && !["present", "absent", "unknown"].includes(officeStatus)) {
      res.status(422).json({ error: "invalid_office_status" });
      return;
    }
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (!includeInactive) conditions.push(`s.operational_status = 'active'`);
    if (officeStatus !== null) {
      values.push(officeStatus);
      conditions.push(`s.office_status = $${values.length}`);
    }
    if (req.currentUser && STATE_SCOPED_ROLES.has(req.currentUser.role)) {
      if (req.currentUser.stateId == null) {
        res.json([]);
        return;
      }
      values.push(req.currentUser.stateId);
      conditions.push(`s.id = $${values.length}`);
    }
    const { rows } = await pool.query(
      `${registrySql}${conditions.length ? ` WHERE ${conditions.join(" AND ")}` : ""} ORDER BY s.name, s.id`,
      values,
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get("/states/:stateId", async (req, res, next) => {
  try {
    const stateId = parseStateId(req.params.stateId as string);
    if (stateId === null) {
      res.status(422).json({ error: "invalid_state_id" });
      return;
    }
    if (!stateScopeAllowed(req, res, stateId)) return;
    const registry = await pool.query(`${registrySql} WHERE s.id = $1`, [stateId]);
    if (registry.rows.length === 0) {
      res.status(404).json({ error: "state not found" });
      return;
    }
    const state = registry.rows[0];
    const localities = await pool.query(
      `SELECT id, name FROM localities WHERE state_id = $1 ORDER BY name`,
      [stateId],
    );
    const projects = await pool.query(
      `
       SELECT p.id, p.code, p.title, p.status, p.sector
      FROM projects p
      JOIN project_states ps ON ps.project_id = p.id
      WHERE ps.state_id = $1 AND p.deleted_at IS NULL
      ORDER BY p.created_at DESC
      `,
      [stateId],
    );
    res.json({
      ...state,
      localities: localities.rows,
      projects: projects.rows,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/states", async (req, res, next) => {
  if (!isStateRegistryAdmin(req.currentUser?.role)) {
    sendStateAdminForbidden(res);
    return;
  }

  const validated = validateStateInput(req.body);
  if ("error" in validated) {
    res.status(422).json(validated);
    return;
  }

  try {
    const { name, nameAr, code, officeAddress } = validated.value;
    if (!SUDAN_STATES.some((state) => state[0] === code && state[1] === name && state[2] === nameAr)) {
      res.status(409).json({ error: "canonical_state_registry_only" });
      return;
    }
    const { rows } = await pool.query(
      `INSERT INTO states (name, name_ar, code, office_address, operational_status, office_status)
       VALUES ($1, $2, $3, $4, 'inactive', 'unknown')
       RETURNING id, name, name_ar AS "nameAr", code, operational_status AS "operationalStatus",
                 office_status AS "officeStatus", office_address AS "officeAddress"`,
      [name, nameAr, code, officeAddress],
    );
    const state = { ...rows[0], officeManagers: [] as Array<{ id: number; name: string }>, localitiesCount: 0 };
    await logAudit({
      userId: req.currentUser!.id,
      action: "create",
      module: "states",
      entityId: state.id,
      newValue: JSON.stringify({ name: state.name, nameAr: state.nameAr, code: state.code, officeAddress: state.officeAddress }),
    });
    await realtime.publishSupportingEvent({
      entityType: "state",
      entityId: state.id,
      action: "created",
    });
    res.status(201).json(state);
  } catch (err) {
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: "state_identity_conflict" });
      return;
    }
    next(err);
  }
});

router.patch("/states/:stateId", async (req, res, next) => {
  if (!isStateRegistryAdmin(req.currentUser?.role)) {
    sendStateAdminForbidden(res);
    return;
  }

  const stateId = parseStateId(req.params.stateId as string);
  if (stateId === null) {
    res.status(422).json({ error: "invalid_state_id" });
    return;
  }
  const validated = validateStateInput(req.body);
  if ("error" in validated) {
    res.status(422).json(validated);
    return;
  }

  try {
    const before = await pool.query(
      `SELECT name, name_ar AS "nameAr", code, office_address AS "officeAddress" FROM states WHERE id = $1`,
      [stateId],
    );
    if (before.rows.length === 0) {
      res.status(404).json({ error: "state not found" });
      return;
    }

    const { name, nameAr, code, officeAddress } = validated.value;
    if (!SUDAN_STATES.some((state) => state[0] === code && state[1] === name && state[2] === nameAr)) {
      res.status(409).json({ error: "canonical_state_registry_only" });
      return;
    }
    // Opt-in optimistic-concurrency guard, same pattern as risks/plans/reports:
    // a caller that sends x-base-revision (the updatedAt it last read) is
    // rejected with 409 if the row has moved since — two admins editing the
    // same State's registry fields at once no longer silently clobber each
    // other. Absent the header, behaviour is unchanged.
    const params: unknown[] = [name, nameAr, code, officeAddress, stateId];
    const baseRevision = req.header("x-base-revision");
    if (baseRevision) params.push(baseRevision);
    const updated = await pool.query(
      `UPDATE states
       SET name = $1, name_ar = $2, code = $3, office_address = $4, updated_at = NOW()
       WHERE id = $5${baseRevision ? ` AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $6::timestamptz)` : ""}
       RETURNING id, name, name_ar AS "nameAr", code, operational_status AS "operationalStatus",
                 office_status AS "officeStatus", office_address AS "officeAddress", updated_at AS "updatedAt"`,
      params,
    );
    if (baseRevision && updated.rowCount === 0) {
      res.status(409).json({ error: "offline_conflict", code: "revision_mismatch", message: "The state changed since this form was loaded." });
      return;
    }
    const state = { ...updated.rows[0], officeManagers: [] as Array<{ id: number; name: string }>, localitiesCount: 0 };
    await logAudit({
      userId: req.currentUser!.id,
      action: "update",
      module: "states",
      entityId: stateId,
      oldValue: JSON.stringify(before.rows[0]),
      newValue: JSON.stringify({ name: state.name, nameAr: state.nameAr, code: state.code, officeAddress: state.officeAddress }),
    });
    await realtime.publishSupportingEvent({
      entityType: "state",
      entityId: stateId,
      action: "updated",
    });
    res.json(state);
  } catch (err) {
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: "state_identity_conflict" });
      return;
    }
    next(err);
  }
});

router.patch("/states/:stateId/lifecycle", async (req, res, next) => {
  if (!isStateRegistryAdmin(req.currentUser?.role)) {
    sendStateAdminForbidden(res);
    return;
  }
  const stateId = parseStateId(req.params.stateId as string);
  if (stateId === null) {
    res.status(422).json({ error: "invalid_state_id" });
    return;
  }
  const validated = parseLifecycleInput(req.body);
  if ("error" in validated) {
    res.status(422).json(validated);
    return;
  }
  try {
    const before = await pool.query(
      `SELECT operational_status AS "operationalStatus", office_status AS "officeStatus" FROM states WHERE id = $1`,
      [stateId],
    );
    if (!before.rows[0]) {
      res.status(404).json({ error: "state not found" });
      return;
    }
    const { operationalStatus, officeStatus } = validated.value;
    const result = await pool.query(
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
      await logAudit({
        userId: req.currentUser!.id,
        action: "state_lifecycle_changed",
        module: "states",
        entityId: stateId,
        oldValue: JSON.stringify(before.rows[0]),
        newValue: JSON.stringify({ operationalStatus: state.operationalStatus, officeStatus: state.officeStatus }),
      });
      await realtime.publishSupportingEvent({
        entityType: "state",
        entityId: stateId,
        action: "lifecycle_changed",
      });
    }
    res.json(state);
  } catch (err) {
    next(err);
  }
});

// ── State Snapshot (for State Program Report form) ───────────────────────────
router.get("/states/:stateId/snapshot", async (req, res, next) => {
  try {
    const stateId = parseStateId(req.params.stateId as string);
    if (stateId === null) {
      res.status(422).json({ error: "invalid_state_id" });
      return;
    }
    if (!stateScopeAllowed(req, res, stateId)) return;
    const existing = await pool.query("SELECT 1 FROM states WHERE id = $1", [stateId]);
    if (existing.rows.length === 0) {
      res.status(404).json({ error: "state not found" });
      return;
    }
    const { rows } = await pool.query(`
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
    res.json(rows[0] ?? {});
  } catch (err) {
    next(err);
  }
});

export default router;
