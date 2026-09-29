import { Hono } from "hono";
import type { Bindings, QueryExecutor } from "../lib/db";
import { openDb } from "../lib/db";
import {
  attachCurrentUser,
  requireAuth,
  logAudit,
  assertSectorAllowed,
  permissionsFor,
  hasPerm,
  type CurrentUser,
  type Variables,
} from "../lib/rbac";
import { assertCanViewReport } from "../lib/report-auth";
import { hasFullOperationalAccess } from "../lib/accessControl";
import { isSprSectionKey } from "../lib/spr-sections";

/**
 * Ported from artifacts/api-server/src/routes/comments.ts (737 lines, 4
 * routes) — sixth file of the post-projects.ts phase (after states.ts,
 * risks.ts, plans.ts, reports.ts), small enough for a single batch.
 *
 * Dropped (same reasoning as every prior file): the entire "notify
 * stakeholders" surface — notifyEntityActors, the parent-author reply
 * notification, and the whole @mention-parsing block (which exists solely
 * to resolve mentioned usernames into notification recipients via
 * authorizedMentionRecipientIds — nothing else reads that result). The
 * entityLink() helper existed only to build links for those notifications
 * and is dropped alongside them. logAudit, the comment INSERT itself, and
 * every authorization/scope rule are preserved in full — only the
 * notification delivery is deferred to the not-yet-built notification
 * engine.
 *
 * lib/sprSections.ts is ported in full (lib/spr-sections.ts) since it
 * gates a real 422 validation (SPR-010 section-key taxonomy), not just
 * notification copy.
 */

const VALID_ENTITY_TYPES = new Set(["project", "report", "plan", "risk"]);
const VALID_COMMENT_TYPES = new Set([
  "general",
  "technical",
  "required_correction",
  "approval_note",
  "rejection_reason",
  "revision_request",
  "coordination",
  "observation",
]);

// Role → comment-type allow-list. Spec:
//  - Technical Coordinator: technical, required_correction, revision_request
//  - Senior Program Coordinator: coordination, required_correction, revision_request
//  - Program Manager: approval_note, rejection_reason, required_correction, revision_request
//  - State Program Officer: general (also reply)
//  - State Office Manager: observation only
//  - Super Admin / Executive Director: everything
const ROLE_TYPE_ALLOW: Record<string, Set<string>> = {
  super_admin: new Set(VALID_COMMENT_TYPES),
  executive_director: new Set(VALID_COMMENT_TYPES),
  program_manager: new Set(["general", "approval_note", "rejection_reason", "required_correction", "revision_request"]),
  senior_program_coordinator: new Set(["general", "coordination", "required_correction", "revision_request"]),
  technical_coordinator: new Set(["general", "technical", "required_correction", "revision_request"]),
  state_program_officer: new Set(["general"]),
  state_office_manager: new Set(["observation"]),
};

type EntityMeta = { sector: string | null; reportType: string | null };

// Returns undefined when the entity does not exist. reportType is only set for
// entityType === "report" (used by the SPR-010 section taxonomy validation) and
// is fetched in the same query as the sector — no extra round-trip.
async function loadEntityMeta(db: QueryExecutor, entityType: string, entityId: number): Promise<EntityMeta | undefined> {
  if (entityType === "project") {
    const r = await db.query<{ sector: string | null }>(`SELECT sector FROM projects WHERE id = $1`, [entityId]);
    if (!r.rows[0]) return undefined;
    return { sector: r.rows[0].sector, reportType: null };
  }
  if (entityType === "report") {
    // Security rule: Project Reports use Project Primary Sector ONLY for TC scope.
    // Activity Reports are source-aware: project-linked uses p.sector; standalone uses act.sector.
    // r.sector is display-only and must not widen TC access.
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
      [entityId],
    );
    if (!r.rows[0]) return undefined;
    const { reportType, projectId, projectSector, activitySector, effectiveSector } = r.rows[0];
    // Project Reports: TC scope is based exclusively on Project Primary Sector.
    if (reportType === "project") return { sector: projectSector, reportType };
    // Activity Reports: source-aware.
    //   Standalone (project_id IS NULL): activity.sector is the ONLY authority.
    //   Project-linked: Project Primary Sector is the ONLY authority.
    // Fail-closed: null sector → assertSectorAllowed denies TC access.
    if (reportType === "activity") {
      return { sector: projectId === null ? activitySector : projectSector, reportType };
    }
    return { sector: effectiveSector, reportType };
  }
  if (entityType === "plan") {
    const r = await db.query<{ sector: string | null }>(
      `SELECT COALESCE(NULLIF(pl.sector,''), p.sector) AS sector
       FROM plans pl LEFT JOIN projects p ON p.id = pl.project_id WHERE pl.id = $1`,
      [entityId],
    );
    if (!r.rows[0]) return undefined;
    return { sector: r.rows[0].sector, reportType: null };
  }
  if (entityType === "risk") {
    // RISK-001: TC sector scope for risks follows the canonical Risk rule —
    // the LINKED PROJECT's primary sector is the only authority. A standalone
    // risk (no project) has a null sector, so assertSectorAllowed fails closed
    // for TCs, mirroring the GET /risks list filter (p.sector = ANY(...)).
    const r = await db.query<{ sector: string | null }>(
      `SELECT p.sector FROM risks r LEFT JOIN projects p ON p.id = r.project_id WHERE r.id = $1`,
      [entityId],
    );
    if (!r.rows[0]) return undefined;
    return { sector: r.rows[0].sector, reportType: null };
  }
  return undefined;
}

// RISK-001: state scope for risk comments — mirrors PATCH /risks/:riskId and
// GET /risks/:riskId/history. State roles (SPO/SOM) may only touch comments on
// risks in their own state; a state user with a null stateId fails closed.
// PM / super_admin pass (Full Operational Access) as they are not state roles
// and hold no TC sector restriction.
async function assertRiskStateScope(
  db: QueryExecutor,
  user: CurrentUser | undefined,
  riskId: number,
): Promise<{ ok: true } | { ok: false; status: number; body: object }> {
  if (!user) return { ok: false, status: 401, body: { error: "unauthorized" } };
  const isStateRole = user.role === "state_program_officer" || user.role === "state_office_manager";
  if (!isStateRole) return { ok: true };
  if (user.stateId == null) return { ok: false, status: 403, body: { error: "state_forbidden" } };
  const r = await db.query<{ state_id: number | null }>(
    `SELECT state_id FROM risks WHERE id = $1`,
    [riskId],
  );
  if (!r.rows[0]) return { ok: false, status: 404, body: { error: "entity_not_found" } };
  if (r.rows[0].state_id !== user.stateId) {
    return { ok: false, status: 403, body: { error: "state_forbidden" } };
  }
  return { ok: true };
}

const COMMENT_COLS = `
  c.id, c.entity_type AS "entityType", c.entity_id AS "entityId",
  c.parent_id AS "parentId", c.section, c.comment_type AS "commentType",
  c.author_id AS "authorId", u.name AS "authorName", u.role_label AS "authorRoleLabel",
  c.body, c.status, c.resolved_at AS "resolvedAt", c.resolved_by_id AS "resolvedById",
  c.created_at AS "createdAt", c.updated_at AS "updatedAt"
`;

export const commentsRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

commentsRoutes.use("/comments", attachCurrentUser, requireAuth);
commentsRoutes.use("/comments/*", attachCurrentUser, requireAuth);

commentsRoutes.get("/comments", async (c) => {
  const user = c.get("currentUser");
  const { db, close } = openDb(c);
  try {
    const q = c.req.query();
    const entityType = String(q.entityType ?? "");
    const entityId = Number(q.entityId);
    if (!VALID_ENTITY_TYPES.has(entityType) || !Number.isFinite(entityId)) {
      return c.json({ error: "entityType_and_entityId_required" }, 400);
    }

    // Read access:
    //  - Roles with comments.create keep the existing full read path.
    //  - SPR-010: roles WITHOUT comments.create (SPO/SOM) get a narrowly
    //    scoped, read-only exception: ONLY the author of a program_state
    //    report that has been returned for revision (status = draft with a
    //    request_revision approval on record), in their own state, may read
    //    its reviewer comments. No posting/resolving authority is granted;
    //    all other requests fail closed with 403.
    //  - HQSR-005: the same read-only exception applies to the author of a
    //    returned-for-revision hq_sector draft (TC authors lack
    //    comments.create). assertCanViewReport above retains the sector
    //    scope, so a cross-sector TC is still denied.
    // RISK-001: risk comment reads are governed by canonical risk read
    // authority (risks.view / risks.view.state) + risk scope — NOT by the
    // unrelated comments.create gate. SPO/SOM hold risks.view.state and may
    // read risk comments within their own state.
    if (entityType === "risk") {
      const perms = permissionsFor(user!);
      if (!hasPerm(perms, "risks.view") && !hasPerm(perms, "risks.view.state")) {
        return c.json({ error: "forbidden", requiredPermission: "risks.view" }, 403);
      }
      const meta = await loadEntityMeta(db, "risk", entityId);
      if (meta === undefined) return c.json({ error: "entity_not_found" }, 404);
      const guard = assertSectorAllowed(user, meta.sector);
      if (!guard.ok) return c.json(guard.body, guard.status as 403);
      const stateGuard = await assertRiskStateScope(db, user, entityId);
      if (!stateGuard.ok) return c.json(stateGuard.body, stateGuard.status as 403);
      const { rows } = await db.query(
        `SELECT ${COMMENT_COLS} FROM comments c JOIN users u ON u.id = c.author_id
         WHERE c.entity_type = 'risk' AND c.entity_id = $1
         ORDER BY c.created_at ASC`,
        [entityId],
      );
      return c.json(rows);
    }

    const canComment = hasPerm(permissionsFor(user!), "comments.create");
    if (!canComment) {
      // ── Plan read-only exception (PLAN-012) ──────────────────────────────
      // SPO/SOM lack comments.create but may read revision_request comments
      // on their own state's draft plan that has been returned for revision.
      // Conditions (all must hold; fail-closed otherwise):
      //   1. entityType === "plan"
      //   2. Caller is a state-scoped role (state_program_officer / state_office_manager)
      //      with a non-null stateId (null stateId = fail closed)
      //   3. Plan belongs to the same state as the caller
      //   4. Plan is currently in draft status
      //   5. The plan has at least one request_revision approval on record
      // Only revision_request comments are returned (least-privilege read).
      if (entityType === "plan") {
        const isStateRole =
          user!.role === "state_program_officer" ||
          user!.role === "state_office_manager";
        if (!isStateRole || user!.stateId == null) {
          return c.json({ error: "forbidden", requiredPermission: "comments.create" }, 403);
        }
        const gate = await db.query<{ ok: boolean }>(
          `SELECT (
              pl.state_id = $2
              AND pl.status = 'draft'
              AND EXISTS (
                SELECT 1 FROM approvals a
                WHERE a.entity_type = 'plan' AND a.entity_id = pl.id
                  AND a.action = 'request_revision'
              )
            ) AS ok
           FROM plans pl WHERE pl.id = $1`,
          [entityId, user!.stateId],
        );
        if (!gate.rows[0]?.ok) {
          return c.json({ error: "forbidden", requiredPermission: "comments.create" }, 403);
        }
        // Return only revision_request comments — narrowly scoped read.
        const { rows } = await db.query(
          `SELECT ${COMMENT_COLS} FROM comments c JOIN users u ON u.id = c.author_id
           WHERE c.entity_type = 'plan' AND c.entity_id = $1
             AND c.comment_type = 'revision_request'
           ORDER BY c.created_at ASC`,
          [entityId],
        );
        return c.json(rows);
      }

      // ── Report read-only exceptions (SPR-010, HQSR-005) ─────────────────
      if (entityType !== "report") {
        return c.json({ error: "forbidden", requiredPermission: "comments.create" }, 403);
      }
      // Retain the canonical report-view check (state + sector scope, 404 on
      // missing report) before applying the narrower authorship gate.
      const view = await assertCanViewReport(db, user, entityId);
      if (!view.ok) return c.json(view.body, view.status as 403);
      const gate = await db.query<{ ok: boolean }>(
        `SELECT (
            r.report_type IN ('program_state', 'hq_sector')
            AND r.status = 'draft'
            AND r.author_id = $2
            AND EXISTS (
              SELECT 1 FROM approvals a
              WHERE a.entity_type = 'report' AND a.entity_id = r.id
                AND a.action = 'request_revision'
            )
          ) AS ok
         FROM reports r WHERE r.id = $1`,
        [entityId, user!.id],
      );
      if (!gate.rows[0]?.ok) {
        return c.json({ error: "forbidden", requiredPermission: "comments.create" }, 403);
      }
      const { rows } = await db.query(
        `SELECT ${COMMENT_COLS} FROM comments c JOIN users u ON u.id = c.author_id
         WHERE c.entity_type = $1 AND c.entity_id = $2
         ORDER BY c.created_at ASC`,
        [entityType, entityId],
      );
      return c.json(rows);
    }

    const meta = await loadEntityMeta(db, entityType, entityId);
    if (meta === undefined) return c.json({ error: "entity_not_found" }, 404);
    const guard = assertSectorAllowed(user, meta.sector);
    if (!guard.ok) return c.json(guard.body, guard.status as 403);

    // State scope: SPO/SOM must not read comments on a report from a different state.
    // This mirrors the GET /reports/:reportId state scope check.
    if (entityType === "report") {
      const isStateRole =
        user?.role === "state_program_officer" ||
        user?.role === "state_office_manager";
      if (isStateRole && user?.stateId) {
        const stateCheck = await db.query<{ state_id: number | null }>(
          `SELECT state_id FROM reports WHERE id = $1`,
          [entityId],
        );
        if (stateCheck.rows.length > 0 && stateCheck.rows[0].state_id !== user.stateId) {
          return c.json({ error: "state_scope_forbidden" }, 403);
        }
      }
    }

    const { rows } = await db.query(
      `SELECT ${COMMENT_COLS} FROM comments c JOIN users u ON u.id = c.author_id
       WHERE c.entity_type = $1 AND c.entity_id = $2
       ORDER BY c.created_at ASC`,
      [entityType, entityId],
    );
    return c.json(rows);
  } finally {
    close();
  }
});

commentsRoutes.post("/comments", async (c) => {
  const user = c.get("currentUser")!;
  const { db, pool, close } = openDb(c);
  try {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const entityType = String(body.entityType ?? "");

    // Permission gate. Canonical rule: comments.create (HQ roles + ED).
    // RISK-001 exception: risk comments are additionally open to actors with
    // canonical risk mutation authority (risks.update — e.g. SPO within their
    // state), since SPO/SOM hold no comments.create by RBAC spec. SOM remains
    // read-only for risks (view-only monitoring role). Scope checks below
    // still apply in full.
    {
      const perms = permissionsFor(user);
      const canComment = hasPerm(perms, "comments.create");
      const riskAuthor = entityType === "risk" && hasPerm(perms, "risks.update");
      if (!canComment && !riskAuthor) {
        return c.json({ error: "forbidden", requiredPermission: "comments.create" }, 403);
      }
    }
    const entityId = Number(body.entityId);
    const commentType = String(body.commentType ?? "general");
    // Whitespace-only / empty sections are normalised to null (report-level).
    const section = (body.section == null ? "" : String(body.section).trim()) || null;
    const parentId = body.parentId == null ? null : Number(body.parentId);
    const text = String(body.body ?? "").trim();
    if (!VALID_ENTITY_TYPES.has(entityType) || !Number.isFinite(entityId)) {
      return c.json({ error: "entityType_and_entityId_required" }, 400);
    }
    if (!VALID_COMMENT_TYPES.has(commentType)) {
      return c.json({ error: "invalid_comment_type" }, 400);
    }
    if (!text) return c.json({ error: "body_required" }, 400);
    const meta = await loadEntityMeta(db, entityType, entityId);
    if (meta === undefined) return c.json({ error: "entity_not_found" }, 404);
    const guard = assertSectorAllowed(user, meta.sector);
    if (!guard.ok) return c.json(guard.body, guard.status as 403);

    // RISK-001: state scope for risk comments (SPO/SOM clamped to own state).
    if (entityType === "risk") {
      const stateGuard = await assertRiskStateScope(db, user, entityId);
      if (!stateGuard.ok) return c.json(stateGuard.body, stateGuard.status as 403);
    }

    // SPR-010: State Programme Report comments must use a canonical section
    // key (or no section at all — null renders as "General / Report-Level").
    // Other report types and entity types are unaffected.
    if (entityType === "report" && meta.reportType === "program_state") {
      if (section !== null && !isSprSectionKey(section)) {
        return c.json({ error: "invalid_section_key" }, 422);
      }
    }

    const allowed = ROLE_TYPE_ALLOW[user.role] ?? new Set<string>(["general"]);
    if (!allowed.has(commentType)) {
      return c.json({ error: "comment_type_not_allowed_for_role" }, 403);
    }

    if (parentId != null) {
      const p = await db.query(`SELECT id FROM comments WHERE id = $1 AND entity_type = $2 AND entity_id = $3`, [parentId, entityType, entityId]);
      if (!p.rows[0]) return c.json({ error: "invalid_parent" }, 400);
    }

    // RISK-005 (concurrency): risk comments have no DB-level FK to risks, so
    // a comment INSERT racing a project permanent delete could otherwise
    // orphan the new row (entity check reads before the delete commits, the
    // INSERT lands after the cascade purge). Lock the parent risk row in the
    // same transaction as the INSERT: the delete cascade's DELETE FROM risks
    // blocks on this lock until the comment commits (and its purge then sees
    // the committed row); a comment arriving after the risks delete blocks
    // and then fails closed when the risk is gone.
    let id: number;
    if (entityType === "risk") {
      const txClient = await pool.connect();
      try {
        await txClient.query("BEGIN");
        const lockCheck = await txClient.query(
          `SELECT 1 FROM risks WHERE id = $1 FOR UPDATE`,
          [entityId],
        );
        if (lockCheck.rows.length === 0) {
          await txClient.query("ROLLBACK");
          return c.json({ error: "entity_not_found" }, 404);
        }
        const { rows } = await txClient.query(
          `INSERT INTO comments (entity_type, entity_id, parent_id, section, comment_type, author_id, body)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           RETURNING id`,
          [entityType, entityId, parentId, section, commentType, user.id, text],
        );
        id = rows[0].id;
        await txClient.query("COMMIT");
      } catch (txErr) {
        await txClient.query("ROLLBACK").catch(() => {});
        throw txErr;
      } finally {
        txClient.release();
      }
    } else {
      const { rows } = await db.query<{ id: number }>(
        `INSERT INTO comments (entity_type, entity_id, parent_id, section, comment_type, author_id, body)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id`,
        [entityType, entityId, parentId, section, commentType, user.id, text],
      );
      id = rows[0].id;
    }
    const out = await db.query(
      `SELECT ${COMMENT_COLS} FROM comments c JOIN users u ON u.id = c.author_id WHERE c.id = $1`,
      [id],
    );
    await logAudit(db, {
      userId: user.id,
      action: parentId ? "comment_reply" : "comment_add",
      module: "comments",
      entityId: id,
      newValue: `${entityType}#${entityId}:${commentType}`,
    });

    // Notification creation (notifyEntityActors, the parent-author reply
    // notification, and the @mention-parsing block that resolves usernames
    // into recipients) is dropped — deferred to the not-yet-built
    // notification engine, same as every prior file in this port.

    return c.json(out.rows[0], 201);
  } finally {
    close();
  }
});

commentsRoutes.patch("/comments/:id", async (c) => {
  const user = c.get("currentUser")!;
  const { db, close } = openDb(c);
  try {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? "");
    if (!["resolve", "reopen"].includes(action)) {
      return c.json({ error: "invalid_action" }, 400);
    }
    // Permission gate: comments.create, or canonical risk mutation authority
    // for risk comments (RISK-001 — SPO holds risks.update, not comments.create).
    // Enumeration-safe: callers with neither permission are rejected BEFORE the
    // lookup, and risks.update-only callers get a uniform 403 for both absent
    // IDs and existing non-risk comments, so arbitrary comment IDs cannot be
    // probed for existence.
    const perms = permissionsFor(user);
    const canComment = hasPerm(perms, "comments.create");
    const canRiskMutate = hasPerm(perms, "risks.update");
    if (!canComment && !canRiskMutate) {
      return c.json({ error: "forbidden", requiredPermission: "comments.create" }, 403);
    }
    const cRes = await db.query<{
      id: number; entity_type: string; entity_id: number; author_id: number; comment_type: string;
    }>(`SELECT * FROM comments WHERE id = $1`, [id]);
    const cRow = cRes.rows[0];
    if (!cRow) {
      if (!canComment) return c.json({ error: "forbidden", requiredPermission: "comments.create" }, 403);
      return c.json({ error: "not_found" }, 404);
    }
    if (!canComment && cRow.entity_type !== "risk") {
      return c.json({ error: "forbidden", requiredPermission: "comments.create" }, 403);
    }
    const meta = await loadEntityMeta(db, cRow.entity_type, cRow.entity_id);
    const guard = assertSectorAllowed(user, meta?.sector ?? null);
    if (!guard.ok) return c.json(guard.body, guard.status as 403);
    // RISK-001: risk comments are additionally clamped to the actor's state
    // scope — a comment on an inaccessible risk cannot be resolved/reopened by ID.
    if (cRow.entity_type === "risk") {
      const stateGuard = await assertRiskStateScope(db, user, Number(cRow.entity_id));
      if (!stateGuard.ok) return c.json(stateGuard.body, stateGuard.status as 403);
    }
    // Authz: only the author, a super_admin/executive_director/PM (Full Operational
    // Access), or a role that may post the same comment_type can resolve/reopen.
    const role = user.role;
    const isAuthor = cRow.author_id === user.id;
    const isAdminish = hasFullOperationalAccess(user) || role === "executive_director";
    const canActOnType = ROLE_TYPE_ALLOW[role]?.has(cRow.comment_type) ?? false;
    if (!isAuthor && !isAdminish && !canActOnType) {
      return c.json({ error: "cannot_change_comment_status" }, 403);
    }
    const status = action === "resolve" ? "resolved" : "open";
    const resolvedAt = action === "resolve" ? new Date() : null;
    const resolvedBy = action === "resolve" ? user.id : null;
    await db.query(
      `UPDATE comments SET status = $1, resolved_at = $2, resolved_by_id = $3, updated_at = NOW() WHERE id = $4`,
      [status, resolvedAt, resolvedBy, id],
    );
    await logAudit(db, { userId: user.id, action: `comment_${action}`, module: "comments", entityId: id });
    const out = await db.query(
      `SELECT ${COMMENT_COLS} FROM comments c JOIN users u ON u.id = c.author_id WHERE c.id = $1`,
      [id],
    );
    return c.json(out.rows[0]);
  } finally {
    close();
  }
});

commentsRoutes.delete("/comments/:id", async (c) => {
  const user = c.get("currentUser")!;
  const { db, close } = openDb(c);
  try {
    const id = Number(c.req.param("id"));
    // Permission gate: comments.create, or canonical risk mutation authority
    // for risk comments (RISK-001). Enumeration-safe — see PATCH handler note.
    const perms = permissionsFor(user);
    const canComment = hasPerm(perms, "comments.create");
    const canRiskMutate = hasPerm(perms, "risks.update");
    if (!canComment && !canRiskMutate) {
      return c.json({ error: "forbidden", requiredPermission: "comments.create" }, 403);
    }
    const cRes = await db.query<{ author_id: number; created_at: string; entity_type: string; entity_id: number }>(
      `SELECT author_id, created_at, entity_type, entity_id FROM comments WHERE id = $1`, [id],
    );
    const cRow = cRes.rows[0];
    if (!cRow) {
      if (!canComment) return c.json({ error: "forbidden", requiredPermission: "comments.create" }, 403);
      return c.json({ error: "not_found" }, 404);
    }
    if (!canComment && cRow.entity_type !== "risk") {
      return c.json({ error: "forbidden", requiredPermission: "comments.create" }, 403);
    }
    // RISK-001: parent-entity scope enforced on delete-by-ID — a comment on an
    // inaccessible risk (wrong sector or state) cannot be deleted directly.
    if (cRow.entity_type === "risk") {
      const meta = await loadEntityMeta(db, "risk", Number(cRow.entity_id));
      const guard = assertSectorAllowed(user, meta?.sector ?? null);
      if (!guard.ok) return c.json(guard.body, guard.status as 403);
      const stateGuard = await assertRiskStateScope(db, user, Number(cRow.entity_id));
      if (!stateGuard.ok) return c.json(stateGuard.body, stateGuard.status as 403);
    }
    const isAuthor = cRow.author_id === user.id;
    // PM/super_admin (Full Operational Access) may delete any comment at any time.
    // Normal users may only delete their own comments within 15 minutes.
    const isFullAccess = hasFullOperationalAccess(user);
    const within15min = Date.now() - new Date(cRow.created_at).getTime() < 15 * 60 * 1000;
    if (!isFullAccess && !(isAuthor && within15min)) {
      return c.json({ error: "cannot_delete" }, 403);
    }
    await db.query(`DELETE FROM comments WHERE id = $1`, [id]);
    await logAudit(db, { userId: user.id, action: "comment_delete", module: "comments", entityId: id });
    return c.body(null, 204);
  } finally {
    close();
  }
});

/** Helper exposed for transitions: count unresolved required-correction comments. */
export async function unresolvedRequiredCorrections(
  db: QueryExecutor,
  entityType: string,
  entityId: number,
): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM comments
     WHERE entity_type = $1 AND entity_id = $2 AND comment_type = 'required_correction' AND status = 'open'`,
    [entityType, entityId],
  );
  return rows[0]?.n ?? 0;
}
