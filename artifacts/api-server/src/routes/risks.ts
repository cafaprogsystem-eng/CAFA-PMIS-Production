import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { CreateRiskBody, UpdateRiskBody } from "@workspace/api-zod";
import { ZodError } from "zod";
import { logAudit, tcSectorRestriction, assertSectorAllowed, requirePerm, permissionsFor, hasPerm } from "../middlewares/currentUser";
import type { Request, Response, NextFunction } from "express";
import { notifyByRole, createNotificationDeduped, notifyEntityActorsDeduped } from "../lib/notifications";
import { checkAllDueDates } from "../lib/due-date-checker";
import { realtime } from "../lib/realtime";
import { assertActiveState } from "../lib/state-master";
import { ACTIVE_RISK_STATUS_SQL } from "../lib/riskConstants";

// Compute risk level from probability × impact
function computeRiskLevel(likelihood: string, impact: string | null, severity: string): string {
  const probMap: Record<string, number> = {
    low: 1, unlikely: 1,
    medium: 2, possible: 2,
    high: 3, likely: 3, almost_certain: 3,
  };
  const impMap: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 3 };
  const prob = probMap[likelihood] ?? 2;
  const imp = impMap[impact ?? severity] ?? 2;
  const score = prob * imp;
  if (score >= 9) return "critical";
  if (score >= 6) return "high";
  if (score >= 2) return "medium";
  return "low";
}

// SQL expression for riskLevel used in WHERE filters
const riskLevelSQL = `
  (CASE
    WHEN (
      CASE r.likelihood WHEN 'high' THEN 3 WHEN 'likely' THEN 3 WHEN 'almost_certain' THEN 3 WHEN 'medium' THEN 2 WHEN 'possible' THEN 2 WHEN 'low' THEN 1 WHEN 'unlikely' THEN 1 ELSE 2 END *
      CASE COALESCE(r.impact, r.severity) WHEN 'critical' THEN 3 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 2 END
    ) >= 9 THEN 'critical'
    WHEN (
      CASE r.likelihood WHEN 'high' THEN 3 WHEN 'likely' THEN 3 WHEN 'almost_certain' THEN 3 WHEN 'medium' THEN 2 WHEN 'possible' THEN 2 WHEN 'low' THEN 1 WHEN 'unlikely' THEN 1 ELSE 2 END *
      CASE COALESCE(r.impact, r.severity) WHEN 'critical' THEN 3 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 2 END
    ) >= 6 THEN 'high'
    WHEN (
      CASE r.likelihood WHEN 'high' THEN 3 WHEN 'likely' THEN 3 WHEN 'almost_certain' THEN 3 WHEN 'medium' THEN 2 WHEN 'possible' THEN 2 WHEN 'low' THEN 1 WHEN 'unlikely' THEN 1 ELSE 2 END *
      CASE COALESCE(r.impact, r.severity) WHEN 'critical' THEN 3 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 2 END
    ) >= 2 THEN 'medium'
    ELSE 'low'
  END)
`;

async function getRiskRow(riskId: number) {
  const r = await pool.query<{
    sector: string | null; projectId: number | null; assignedToId: number | null; status: string; stateId: number | null;
    severity: string; likelihood: string; impact: string | null;
  }>(
    `SELECT p.sector, r.project_id AS "projectId", r.assigned_to_id AS "assignedToId", r.status, r.state_id AS "stateId",
            r.severity, r.likelihood, r.impact
     FROM risks r LEFT JOIN projects p ON p.id = r.project_id AND p.deleted_at IS NULL WHERE r.id = $1`,
    [riskId],
  );
  return r.rows[0];
}

const riskSelect = `
  SELECT r.id, r.title, r.description, r.category, r.severity, r.likelihood,
         r.impact, r.status,
         COALESCE(r.location_type, CASE WHEN r.state_id IS NOT NULL THEN 'state' ELSE NULL END) AS "locationType",
         r.state_id AS "stateId", s.name AS "stateName", s.name_ar AS "stateNameAr",
         r.project_id AS "projectId", p.title AS "projectTitle",
         r.assigned_to_id AS "assignedToId",
         u.name AS "assignedToName",
         r.mitigation_plan AS "mitigationPlan",
         r.due_date AS "dueDate",
         r.follow_up_date AS "followUpDate",
         r.identified_at AS "identifiedAt",
         r.updated_at AS "updatedAt",
         r.plan_id AS "planId", r.plan_activity_id AS "planActivityId"
  FROM risks r
  LEFT JOIN states s ON s.id = r.state_id
  LEFT JOIN projects p ON p.id = r.project_id AND p.deleted_at IS NULL
  LEFT JOIN users u ON u.id = r.assigned_to_id
`;

// RISK-010: soft-deleted projects are excluded from the JOIN above, so a
// risk whose project was soft-deleted stays in the list (history preserved)
// but its projectTitle is NULL and the deleted project cannot grant TC
// sector scope (p.sector is NULL for deleted projects).
// RISK-PAGE: single aggregate query replaces the old count-only query.
// Returns total (for pagination) plus per-level and open counts (for KPI tiles).
// Runs with the same WHERE clause so all values are actor-scoped.
const riskSummarySelect = `
  SELECT
    COUNT(*)::text AS total,
    SUM(CASE WHEN r.status ${ACTIVE_RISK_STATUS_SQL} THEN 1 ELSE 0 END)::int AS open,
    SUM(CASE WHEN ${riskLevelSQL} = 'critical' THEN 1 ELSE 0 END)::int AS critical,
    SUM(CASE WHEN ${riskLevelSQL} = 'high'     THEN 1 ELSE 0 END)::int AS high,
    SUM(CASE WHEN ${riskLevelSQL} = 'medium'   THEN 1 ELSE 0 END)::int AS medium,
    SUM(CASE WHEN ${riskLevelSQL} = 'low'      THEN 1 ELSE 0 END)::int AS low
  FROM risks r
  LEFT JOIN states s ON s.id = r.state_id
  LEFT JOIN projects p ON p.id = r.project_id AND p.deleted_at IS NULL
  LEFT JOIN users u ON u.id = r.assigned_to_id
`;

// ── #577: state reference must exist (actor-independent structural check) ───
async function validateStateExists(stateId: number): Promise<boolean> {
  const { rows } = await pool.query(`SELECT 1 FROM states WHERE id = $1`, [stateId]);
  return rows.length > 0;
}

// ── Allowed enumeration values (app-level validation; columns are TEXT) ──────
// Includes legacy aliases still present in historical rows so PATCH round-trips
// of old data are not rejected.
const VALID_LIKELIHOODS = new Set(["low", "medium", "high", "unlikely", "possible", "likely", "almost_certain"]);
const VALID_IMPACTS = new Set(["low", "medium", "high", "critical"]);
const VALID_STATUSES = new Set(["open", "under_mitigation", "closed", "identified", "assigned", "mitigation_plan", "follow_up", "escalation", "mitigated"]);

function validateRiskEnums(b: { likelihood?: string; severity?: string; impact?: string | null; status?: string | null }): string | null {
  if (b.likelihood !== undefined && !VALID_LIKELIHOODS.has(b.likelihood)) return `Invalid likelihood "${b.likelihood}". Allowed: ${[...VALID_LIKELIHOODS].join(", ")}.`;
  if (b.severity !== undefined && !VALID_IMPACTS.has(b.severity)) return `Invalid severity "${b.severity}". Allowed: ${[...VALID_IMPACTS].join(", ")}.`;
  if (b.impact !== undefined && b.impact !== null && !VALID_IMPACTS.has(b.impact)) return `Invalid impact "${b.impact}". Allowed: ${[...VALID_IMPACTS].join(", ")}.`;
  if (b.status !== undefined && b.status !== null && !VALID_STATUSES.has(b.status)) return `Invalid status "${b.status}". Allowed: ${[...VALID_STATUSES].join(", ")}.`;
  return null;
}

// ── RISK-011: strict date validation ─────────────────────────────────────────
// Risks date columns are PG `date`; malformed client strings previously reached
// the driver raw and surfaced as a PG 500. Strict YYYY-MM-DD round-trip parsing
// (regex + UTC round-trip so e.g. "2026-02-30" is rejected — Date.parse alone
// silently rolls it over). null/undefined are valid (nullable column).
// No ordering constraint is enforced: no canonical dueDate/identifiedAt ordering
// rule exists anywhere in current code or docs (documented as RISK-BD-06).
const RISK_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function validateRiskDate(val: unknown, field: string): { error: string; message: string } | null {
  if (val === null || val === undefined) return null;
  if (typeof val !== "string" || !RISK_DATE_RE.test(val)) {
    return { error: `${field}_invalid_format`, message: `${field} must be a YYYY-MM-DD date string.` };
  }
  const d = new Date(`${val}T00:00:00Z`);
  // Year 0000 round-trips in JS but is not a valid PostgreSQL `date` — reject it
  // explicitly so it cannot reach the driver and surface as a 500.
  if (val.startsWith("0000") || isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== val) {
    return { error: `${field}_invalid_date`, message: `${field} is not a real calendar date.` };
  }
  return null;
}

function parseRiskBody<T>(
  schema: { safeParse: (data: unknown) => { success: true; data: T } | { success: false; error: ZodError } },
  body: unknown,
  res: { status: (code: number) => { json: (body: unknown) => void } },
): T | null {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  const { error } = result;
  // Check whether any issue is an enum mismatch on a known risk field
  const ENUM_FIELDS = new Set(["likelihood", "severity", "impact", "status"]);
  const enumIssue = error.issues.find(
    (i) => (i.code === "invalid_enum_value" || i.code === "invalid_union") &&
      i.path.length > 0 && ENUM_FIELDS.has(String(i.path[0])),
  );
  if (enumIssue) {
    // Surface as 422 with a message compatible with validateRiskEnums format
    const field = String(enumIssue.path[0]);
    const received = "received" in enumIssue ? String((enumIssue as { received?: unknown }).received) : "unknown";
    const allowed =
      field === "likelihood" ? [...VALID_LIKELIHOODS].join(", ")
      : field === "status"   ? [...VALID_STATUSES].join(", ")
      : [...VALID_IMPACTS].join(", ");
    res.status(422).json({
      error: "invalid_value",
      message: `Invalid ${field} "${received}". Allowed: ${allowed}.`,
    });
    return null;
  }
  // Structural / required-field failures remain 400
  res.status(400).json({ error: "validation_error", message: error.issues[0]?.message ?? "Invalid request body" });
  return null;
}
async function validateAssignedUser(userId: number | null | undefined): Promise<{ error: string; message: string } | null> {
  if (userId == null) return null;
  const { rows } = await pool.query<{ status: string }>(`SELECT status FROM users WHERE id = $1`, [userId]);
  if (rows.length === 0) return { error: "assigned_user_not_found", message: "The assigned user does not exist." };
  if (rows[0].status !== "active") return { error: "assigned_user_not_active", message: "The assigned user is not active." };
  return null;
}

const router: IRouter = Router();

// Read guard: org-wide roles hold risks.view; state roles hold risks.view.state.
// Unknown/legacy roles fail closed.
function riskReadGuard(req: Request, res: Response, next: NextFunction) {
  if (!req.currentUser) { res.status(401).json({ error: "unauthorized" }); return; }
  const perms = permissionsFor(req.currentUser);
  if (hasPerm(perms, "risks.view") || hasPerm(perms, "risks.view.state")) { next(); return; }
  res.status(403).json({ error: "forbidden", requiredPermission: "risks.view" });
}

router.get("/risks", riskReadGuard, async (req, res, next) => {
  try {
    const filters: string[] = [];
    const params: unknown[] = [];

    // State roles clamped to own state; org-wide users may filter by locationType=hq
    const isStateRole = req.currentUser?.role === "state_program_officer" || req.currentUser?.role === "state_office_manager";
    const requestedLocationType = req.query.locationType ? String(req.query.locationType) : null;

    if (isStateRole) {
      // State-scoped: always clamp to own state, never show HQ risks
        const userStateId = req.currentUser?.stateId ?? null;
      if (userStateId !== null) { params.push(userStateId); filters.push(`r.state_id = $${params.length}`); }
      else { filters.push("1=0"); } // no state assigned → return nothing
    } else if (requestedLocationType === "hq") {
      // Org-wide: explicit HQ filter
      filters.push(`r.location_type = 'hq'`);
    } else if (requestedLocationType === "state" || req.query.stateId) {
      // Org-wide: state filter
      const effectiveStateId = req.query.stateId ? Number(req.query.stateId) : null;
      if (effectiveStateId !== null) { params.push(effectiveStateId); filters.push(`r.state_id = $${params.length}`); }
      if (requestedLocationType === "state") { filters.push(`(r.location_type = 'state' OR (r.location_type IS NULL AND r.state_id IS NOT NULL))`); }
    }
    // If no location filter at all, org-wide users see all risks (HQ + all states)
    if (req.query.projectId) { params.push(Number(req.query.projectId)); filters.push(`r.project_id = $${params.length}`); }
    if (req.query.status) { params.push(String(req.query.status)); filters.push(`r.status = $${params.length}`); }
    if (req.query.category) { params.push(String(req.query.category)); filters.push(`r.category = $${params.length}`); }
    if (req.query.assignedToId) { params.push(Number(req.query.assignedToId)); filters.push(`r.assigned_to_id = $${params.length}`); }
    if (req.query.sector) { params.push(String(req.query.sector)); filters.push(`p.sector = $${params.length}`); }

    // Keyword search
    if (req.query.search) {
      const term = `%${String(req.query.search)}%`;
      params.push(term);
      filters.push(`(r.title ILIKE $${params.length} OR r.description ILIKE $${params.length} OR u.name ILIKE $${params.length} OR s.name ILIKE $${params.length} OR p.title ILIKE $${params.length})`);
    }

    // Active-only filter: excludes terminal statuses so KPI tiles that count
    // active risks can link to an identical list population.
    if (req.query.activeOnly === "1" || req.query.activeOnly === "true") {
      filters.push(`r.status ${ACTIVE_RISK_STATUS_SQL}`);
    }

    // Risk level filter (computed)
    if (req.query.riskLevel) {
      params.push(String(req.query.riskLevel));
      filters.push(`${riskLevelSQL} = $${params.length}`);
    }

    // TC sector restriction
    const tcSectors = tcSectorRestriction(req);
    if (tcSectors) {
      params.push(tcSectors);
      filters.push(`p.sector = ANY($${params.length}::text[])`);
    }

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    // RISK-016: bounded, deterministic pagination.
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const offset = (page - 1) * limit;

    const [summaryResult, dataResult] = await Promise.all([
      pool.query<{ total: string; open: number; critical: number; high: number; medium: number; low: number }>(
        `${riskSummarySelect} ${where}`, params,
      ),
      pool.query(
        `${riskSelect} ${where} ORDER BY r.identified_at DESC, r.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      ),
    ]);
    const sr = summaryResult.rows[0];
    const total = Number(sr?.total ?? 0);
    const totalPages = total > 0 ? Math.ceil(total / limit) : 0;
    const summary = {
      open:     sr?.open     ?? 0,
      critical: sr?.critical ?? 0,
      high:     sr?.high     ?? 0,
      medium:   sr?.medium   ?? 0,
      low:      sr?.low      ?? 0,
    };

    // Enrich with computed riskLevel
    const items = dataResult.rows.map((r: Record<string, unknown>) => ({
      ...r,
      riskLevel: computeRiskLevel(
        String(r.likelihood ?? ""),
        r.impact ? String(r.impact) : null,
        String(r.severity ?? ""),
      ),
    }));
    res.json({ items, total, page, limit, totalPages, summary });
  } catch (err) {
    next(err);
  }
});

router.post("/risks", requirePerm("risks.create"), async (req, res, next) => {
  try {
    const body = parseRiskBody(CreateRiskBody, req.body, res);
    if (!body) return;
    const enumError = validateRiskEnums(body);
    if (enumError) { res.status(422).json({ error: "invalid_value", message: enumError }); return; }
    const isHqRisk = body.locationType === "hq";
    const isStateRole = req.currentUser?.role === "state_program_officer" || req.currentUser?.role === "state_office_manager";

    // ── Location validation ─────────────────────────────────────────────────
    if (isHqRisk) {
      // HQ risk: stateId must be absent; state roles are denied
      if (body.stateId != null) {
        res.status(400).json({ error: "invalid_location_combination", message: "locationType=hq cannot be combined with a stateId." });
        return;
      }
      if (isStateRole) {
        res.status(403).json({ error: "hq_forbidden", message: "State-scoped users cannot create HQ risks." });
        return;
      }
    } else {
      // State risk: stateId required
      if (body.stateId == null) {
        res.status(400).json({ error: "stateId_required", message: "stateId is required for state-linked risks." });
        return;
      }
      // #577: the referenced state must exist — actor-independent structural
      // integrity; PM/Super Admin bypass scope, never existence.
      const activeState = await assertActiveState(body.stateId);
      if (!activeState.ok) {
        res.status(422).json({
          error: activeState.error === "inactive_state" ? "inactive_state" : "state_not_found",
          message: activeState.error === "inactive_state" ? "The referenced state is inactive." : "The referenced state does not exist.",
        });
        return;
      }
      // State roles may only create risks within their own assigned state
      if (isStateRole) {
        const userStateId = req.currentUser?.stateId ?? null;
        if (userStateId === null || userStateId !== body.stateId) {
          res.status(403).json({ error: "state_forbidden" });
          return;
        }
      }
    }

    // ── RISK-011: strict date validation (422, never PG 500) ───────────────
    const dueDateErr = validateRiskDate(body.dueDate, "dueDate");
    if (dueDateErr) { res.status(422).json(dueDateErr); return; }

    // ── RISK-008: project existence + actor access ──────────────────────────
    // Existence is checked for ALL roles — Full Operational Access (PM/SA)
    // bypasses scope, never existence. Soft-deleted projects are not linkable.
    let projectSector: string | null = null;
    if (body.projectId != null) {
      const pr = await pool.query<{ sector: string | null }>(
        `SELECT sector FROM projects WHERE id = $1 AND deleted_at IS NULL`, [body.projectId],
      );
      if (pr.rows.length === 0) {
        res.status(422).json({ error: "project_not_found", message: "The referenced project does not exist." });
        return;
      }
      projectSector = pr.rows[0].sector ?? null;
      // State roles may only link projects operating in their own state
      // (canonical project_states membership check, as in reports.ts).
      if (isStateRole) {
        const ps = await pool.query(
          `SELECT 1 FROM project_states WHERE project_id = $1 AND state_id = $2`,
          [body.projectId, req.currentUser?.stateId ?? null],
        );
        if (ps.rows.length === 0) {
          res.status(403).json({ error: "project_forbidden", message: "The referenced project does not operate in your state." });
          return;
        }
      }
    }

    const tcSectors = tcSectorRestriction(req);
    if (tcSectors) {
      const guard = assertSectorAllowed(req, projectSector);
      if (!guard.ok) { res.status(guard.status).json(guard.body); return; }
    }

    // ── RISK-006: assignee must exist and be active ─────────────────────────
    const assigneeErr = await validateAssignedUser(body.assignedToId);
    if (assigneeErr) { res.status(422).json(assigneeErr); return; }

    // RISK-005 (concurrency): risks.project_id has no DB-level FK, so a risk
    // INSERT racing a project permanent delete could otherwise orphan the new
    // row (existence check reads before the delete commits, INSERT lands
    // after). Re-check the project under FOR UPDATE in the same transaction
    // as the INSERT: if the delete transaction holds the project row lock,
    // this blocks until it commits and then fails closed (422); if this
    // transaction wins the lock, the delete's cascade removes the new risk.
    const txClient = await pool.connect();
    let id: number;
    try {
      await txClient.query("BEGIN");
      if (body.projectId != null) {
        const lockCheck = await txClient.query(
          `SELECT 1 FROM projects WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
          [body.projectId],
        );
        if (lockCheck.rows.length === 0) {
          await txClient.query("ROLLBACK");
          res.status(422).json({ error: "project_not_found", message: "The referenced project does not exist." });
          return;
        }
      }
      const { rows } = await txClient.query(
        `INSERT INTO risks (title, description, category, severity, likelihood, impact, status, state_id, location_type, project_id, assigned_to_id, mitigation_plan, due_date)
         VALUES ($1, $2, $3, $4, $5, $6, 'open', $7, $8, $9, $10, $11, $12)
         RETURNING id`,
        [
          body.title, body.description ?? null, body.category,
          body.severity, body.likelihood, body.impact ?? null,
          isHqRisk ? null : (body.stateId ?? null),
          isHqRisk ? "hq" : null,
          body.projectId ?? null,
          body.assignedToId ?? null,
          body.mitigationPlan ?? null,
          body.dueDate ?? null,
        ],
      );
      id = rows[0].id;
      await txClient.query("COMMIT");
    } catch (txErr) {
      await txClient.query("ROLLBACK").catch(() => {});
      throw txErr;
    } finally {
      txClient.release();
    }

    await logAudit({
      userId: req.currentUser?.id ?? null,
      action: "create", module: "risks",
      entityId: id, newValue: body.title,
    });

    // Notify project actors
    if (body.projectId) {
      await notifyEntityActorsDeduped({
        // The recipients are project stakeholders, but the notification itself
        // must identify the newly created risk.
        entityType: "risk",
        entityId: id,
        recipientEntityType: "project",
        recipientEntityId: body.projectId,
        kind: "risk_created",
        message: `A new risk was logged: "${body.title}"`,
        link: `/risks`,
        exceptUserId: req.currentUser?.id ?? null,
        dedupeKey: `risk-created:${id}`,
      });
    }

    // G-02: standalone risk (no linked project) — notify PM + SC + state roles
    if (!body.projectId) {
      const standaloneMsg = `A new standalone risk was logged: "${body.title}"`;
      await notifyByRole({
        roles: ["program_manager", "senior_program_coordinator"],
        kind: "risk_created",
        message: standaloneMsg,
        link: `/risks`,
        entityType: "risk",
        entityId: id,
        exceptUserId: req.currentUser?.id ?? null,
        dedupeKey: `risk-created:${id}`,
      });
      if (body.stateId) {
        const stateUsers = await pool.query<{ id: number }>(
          `SELECT id FROM users WHERE role IN ('state_program_officer', 'state_office_manager') AND state_id = $1 AND status = 'active'`,
          [body.stateId],
        );
        for (const u of stateUsers.rows) {
          if (u.id !== req.currentUser?.id) {
            await createNotificationDeduped({
              userId: u.id,
              kind: "risk_created",
              entityType: "risk",
              entityId: id,
              message: standaloneMsg,
              link: `/risks`,
              dedupeKey: `risk-created:${id}`,
            });
          }
        }
      }
    }

    // Notify assignee if set
    const assignedToId = body.assignedToId;
    if (assignedToId && assignedToId !== req.currentUser?.id) {
      await createNotificationDeduped({
        userId: assignedToId,
        kind: "risk_assigned",
        entityType: "risk",
        entityId: id,
        message: `You were assigned to a risk: "${body.title}"`,
        link: "/risks",
        dedupeKey: `risk-assignment:${id}:created:${assignedToId}`,
      });
    }

    const result = await pool.query(`${riskSelect} WHERE r.id = $1`, [id]);
    const row = result.rows[0] as Record<string, unknown>;
    const riskLevel = computeRiskLevel(String(row.likelihood ?? ""), row.impact ? String(row.impact) : null, String(row.severity ?? ""));
    const enriched = { ...row, riskLevel };
    realtime.broadcastUpdate({ module: "risks", action: "created", entityId: id, actorId: req.currentUser?.id, actorName: req.currentUser?.name });
    res.status(201).json(enriched);
  } catch (err) {
    next(err);
  }
});

router.patch("/risks/:riskId", requirePerm("risks.update"), async (req, res, next) => {
  try {
    const riskId = Number(req.params.riskId);
    const prev = await getRiskRow(riskId);
    if (!prev) { res.status(404).json({ error: "risk not found" }); return; }
    const guard = assertSectorAllowed(req, prev.sector);
    if (!guard.ok) { res.status(guard.status).json(guard.body); return; }
    const isStateRole = req.currentUser?.role === "state_program_officer" || req.currentUser?.role === "state_office_manager";
    if (isStateRole) {
      const stateId = req.currentUser?.stateId ?? null;
      if (stateId === null || prev.stateId !== stateId) { res.status(403).json({ error: "state_forbidden" }); return; }
    }

    const body = parseRiskBody(UpdateRiskBody, req.body, res);
    if (!body) return;
    const enumError = validateRiskEnums(body);
    if (enumError) { res.status(422).json({ error: "invalid_value", message: enumError }); return; }
    // ── RISK-011: strict date validation (null clears; malformed → 422) ────
    const patchDueDateErr = validateRiskDate(body.dueDate, "dueDate");
    if (patchDueDateErr) { res.status(422).json(patchDueDateErr); return; }

    // ── RISK-006: assignee must exist and be active (null clears) ──────────
    const patchAssigneeErr = await validateAssignedUser(body.assignedToId);
    if (patchAssigneeErr) { res.status(422).json(patchAssigneeErr); return; }

    const sets: string[] = [];
    const params: unknown[] = [];

    // Field-presence semantics: omitted → preserved; explicit null → cleared
    // (nullable columns only); new value → validated above, then written.
    // plan_id / plan_activity_id / project_id / state_id are intentionally NOT
    // patchable via this route (plan links are plans-module-owned — RISK-BD-01),
    // so no cross-entity consistency check is required here.
    if (body.title !== undefined) { params.push(body.title); sets.push(`title = $${params.length}`); }
    if (body.description !== undefined) { params.push(body.description); sets.push(`description = $${params.length}`); }
    if (body.status !== undefined) { params.push(body.status); sets.push(`status = $${params.length}`); }
    if (body.severity !== undefined) { params.push(body.severity); sets.push(`severity = $${params.length}`); }
    if (body.likelihood !== undefined) { params.push(body.likelihood); sets.push(`likelihood = $${params.length}`); }
    if (body.impact !== undefined) { params.push(body.impact); sets.push(`impact = $${params.length}`); }
    if (body.mitigationPlan !== undefined) { params.push(body.mitigationPlan); sets.push(`mitigation_plan = $${params.length}`); }
    if (body.assignedToId !== undefined) { params.push(body.assignedToId); sets.push(`assigned_to_id = $${params.length}`); }
    if (body.dueDate !== undefined) { params.push(body.dueDate); sets.push(`due_date = $${params.length}`); }
    sets.push(`updated_at = NOW()`);

    if (sets.length === 1) {
    const result = await pool.query(`${riskSelect} WHERE r.id = $1`, [riskId]);
    const row = result.rows[0] as Record<string, unknown>;
      res.json({ ...row, riskLevel: computeRiskLevel(String(row.likelihood ?? ""), row.impact ? String(row.impact) : null, String(row.severity ?? "")) });
      return;
    }

    params.push(riskId);
    const baseRevision = req.header("x-base-revision");
    if (baseRevision) params.push(baseRevision);
    const update = await pool.query(
      `UPDATE risks SET ${sets.join(", ")} WHERE id = $${params.length - (baseRevision ? 1 : 0)}${baseRevision ? ` AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $${params.length}::timestamptz)` : ""}`,
      params,
    );
    if (baseRevision && update.rowCount === 0) {
      res.status(409).json({ error: "offline_conflict", code: "revision_mismatch", message: "The risk changed while this draft was offline." });
      return;
    }

    await logAudit({
      userId: req.currentUser?.id ?? null,
      action: "update", module: "risks",
      entityId: riskId, newValue: JSON.stringify(body),
    });

    // Notify on assignment change
    const newAssignee = body.assignedToId ?? undefined;
    if (newAssignee && newAssignee !== prev.assignedToId && newAssignee !== req.currentUser?.id) {
      await createNotificationDeduped({
        userId: newAssignee,
        kind: "risk_assigned",
        entityType: "risk",
        entityId: riskId,
        message: "You were assigned to a risk",
        link: "/risks",
        dedupeKey: `risk-assignment:${riskId}:${prev.assignedToId ?? "none"}:${newAssignee}`,
      });
    }

    // Notify project actors on update
    if (prev.projectId) {
      await notifyEntityActorsDeduped({
        // Retain project stakeholders as recipients while keeping the event
        // identity and filter context on the risk that actually changed.
        entityType: "risk",
        entityId: riskId,
        recipientEntityType: "project",
        recipientEntityId: prev.projectId,
        kind: "risk_updated",
        message: `A risk was updated on your project`,
        link: `/risks`,
        exceptUserId: req.currentUser?.id ?? null,
        dedupeKey: `risk-update:${riskId}:${prev.status}:${prev.severity}:${prev.likelihood}:${prev.impact ?? "none"}`,
      });
    }

    // Alert on HIGH / CRITICAL risk level (dedup: skip if same kind notified in last 24h)
    const result = await pool.query(`${riskSelect} WHERE r.id = $1`, [riskId]);
    const row = result.rows[0] as Record<string, unknown>;
    const newLevel = computeRiskLevel(
      String(row.likelihood ?? ""),
      row.impact ? String(row.impact) : null,
      String(row.severity ?? ""),
    );
    const riskTitle = String(row.title ?? "");

    if (newLevel === "high" || newLevel === "critical") {
      const kind = newLevel === "critical" ? "risk_critical" : "risk_high";
      const dup = await pool.query(
        `SELECT 1 FROM notifications WHERE entity_id = $1 AND kind = $2 AND created_at > NOW() - INTERVAL '24 hours' LIMIT 1`,
        [riskId, kind],
      );
      if (!dup.rowCount) {
        if (newLevel === "critical") {
          await notifyByRole({
            roles: ["executive_director", "program_manager", "senior_program_coordinator"],
            kind: "risk_critical",
            message: `🚨 A risk escalated to CRITICAL: "${riskTitle}"`,
            link: `/risks`,
            entityType: "risk",
            entityId: riskId,
            mandatory: true,
            dedupeKey: `risk-alert:${riskId}:critical:${prev.status}:${prev.severity}:${prev.likelihood}:${prev.impact ?? "none"}`,
          });
        } else {
          await notifyByRole({
            roles: ["program_manager", "senior_program_coordinator"],
            kind: "risk_high",
            message: `⚠️ A risk is at HIGH level: "${riskTitle}"`,
            link: `/risks`,
            entityType: "risk",
            entityId: riskId,
            dedupeKey: `risk-alert:${riskId}:high:${prev.status}:${prev.severity}:${prev.likelihood}:${prev.impact ?? "none"}`,
          });
        }
      }
    }

    // G-05: notify on severity downgrade
    const RISK_LEVEL_ORDER = ["low", "medium", "high", "critical"];
    const prevLevel = computeRiskLevel(prev.likelihood, prev.impact, prev.severity);
    if (RISK_LEVEL_ORDER.indexOf(prevLevel) > RISK_LEVEL_ORDER.indexOf(newLevel)) {
      const downgradedMsg = `Risk severity downgraded from ${prevLevel} to ${newLevel}: "${riskTitle}"`;
      if (prev.assignedToId && prev.assignedToId !== (req.currentUser?.id ?? null)) {
        await createNotificationDeduped({
          userId: prev.assignedToId, kind: "risk_severity_downgraded",
          entityType: "risk", entityId: riskId, message: downgradedMsg, link: `/risks`,
          dedupeKey: `risk-severity:${riskId}:${prevLevel}:${newLevel}`,
        });
      }
      await notifyByRole({
        roles: ["program_manager", "senior_program_coordinator"], kind: "risk_severity_downgraded",
        message: downgradedMsg, link: `/risks`, entityType: "risk", entityId: riskId,
        exceptUserId: req.currentUser?.id ?? null,
        dedupeKey: `risk-severity:${riskId}:${prevLevel}:${newLevel}`,
      });
    }

    // G-03: notify on risk status change
    const bodyStatus = body.status;
    if (bodyStatus != null && bodyStatus !== prev.status) {
      const statusMsg = `Risk status changed to "${bodyStatus}": "${riskTitle}"`;
      if (prev.assignedToId && prev.assignedToId !== (req.currentUser?.id ?? null)) {
        await createNotificationDeduped({
          userId: prev.assignedToId, kind: "risk_status_changed",
          entityType: "risk", entityId: riskId, message: statusMsg, link: `/risks`,
          dedupeKey: `risk-status:${riskId}:${prev.status}:${bodyStatus}`,
        });
      }
      await notifyByRole({
        roles: ["program_manager", "senior_program_coordinator"], kind: "risk_status_changed",
        message: statusMsg, link: `/risks`, entityType: "risk", entityId: riskId,
        exceptUserId: req.currentUser?.id ?? null,
        dedupeKey: `risk-status:${riskId}:${prev.status}:${bodyStatus}`,
      });
      if (prev.stateId) {
        const stateUsers = await pool.query<{ id: number }>(
          `SELECT id FROM users WHERE role IN ('state_program_officer', 'state_office_manager') AND state_id = $1 AND status = 'active'`,
          [prev.stateId],
        );
        for (const u of stateUsers.rows) {
          if (u.id !== req.currentUser?.id) {
            await createNotificationDeduped({
              userId: u.id, kind: "risk_status_changed",
              entityType: "risk", entityId: riskId, message: statusMsg, link: `/risks`,
              dedupeKey: `risk-status:${riskId}:${prev.status}:${bodyStatus}`,
            });
          }
        }
      }
    }

    const enriched = { ...row, riskLevel: newLevel };
    realtime.broadcastUpdate({ module: "risks", action: "updated", entityId: riskId, actorId: req.currentUser?.id, actorName: req.currentUser?.name });
    res.json(enriched);
  } catch (err) {
    next(err);
  }
});

// ── Due-date notification job ──────────────────────────────────────────────
// Expose as an endpoint for admin testing / manual trigger. This executes the
// organisation-wide notification job, so it is a privileged operational action:
// only super_admin (via the "*" wildcard) holds risks.admin.
router.get("/risks/due-date-check", requirePerm("risks.admin"), async (req, res, next) => {
  try {
    await checkAllDueDates();
    res.json({ ok: true, message: "Due-date notification check complete" });
  } catch (err) {
    next(err);
  }
});

// Risk history from audit log
router.get("/risks/:riskId/history", riskReadGuard, async (req, res, next) => {
  try {
    const riskId = Number(req.params.riskId);
    const prev = await getRiskRow(riskId);
    if (!prev) { res.status(404).json({ error: "risk not found" }); return; }
    const guard = assertSectorAllowed(req, prev.sector);
    if (!guard.ok) { res.status(guard.status).json(guard.body); return; }
    const isStateRole = req.currentUser?.role === "state_program_officer" || req.currentUser?.role === "state_office_manager";
    if (isStateRole) {
      const stateId = req.currentUser?.stateId ?? null;
      if (stateId === null || prev.stateId !== stateId) { res.status(403).json({ error: "state_forbidden" }); return; }
    }

    const { rows } = await pool.query(
      `SELECT al.id, al.action, al.new_value AS "newValue", al.timestamp AS "createdAt",
              u.name AS "userName", u.role AS "userRole"
       FROM audit_log al
       LEFT JOIN users u ON u.id = al.user_id
       WHERE al.module = 'risks' AND al.entity_id = $1
       ORDER BY al.timestamp DESC LIMIT 50`,
      [riskId],
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

export default router;
