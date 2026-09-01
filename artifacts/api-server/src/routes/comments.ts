import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { logAudit, assertSectorAllowed, permissionsFor, hasPerm } from "../middlewares/currentUser";
import { assertCanViewReport } from "../lib/reportAuth";
import { hasFullOperationalAccess } from "../lib/accessControl";
import { realtime } from "../lib/realtime";
import { createNotificationDeduped, notifyEntityActors } from "../lib/notifications";
import { isSprSectionKey, getSprSectionLabel } from "../lib/sprSections";

const router: IRouter = Router();

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

async function entityLink(entityType: string, entityId: number): Promise<string> {
  if (entityType === "report") {
    const r = await pool.query<{ report_type: string | null }>(
      `SELECT report_type FROM reports WHERE id = $1`, [entityId],
    );
    const t = r.rows[0]?.report_type ?? "project";
    const slug = t === "hq_sector" ? "hq-sector" : t === "program_state" ? "program-state" : "project";
    return `/reports/${slug}?open=${entityId}`;
  }
  if (entityType === "plan") return `/plans/${entityId}`;
  if (entityType === "risk") return `/risks`;
  return `/projects/${entityId}`;
}

type EntityMeta = { sector: string | null; reportType: string | null };

// Returns undefined when the entity does not exist. reportType is only set for
// entityType === "report" (used by the SPR-010 section taxonomy validation) and
// is fetched in the same query as the sector — no extra round-trip.
async function loadEntityMeta(entityType: string, entityId: number): Promise<EntityMeta | undefined> {
  if (entityType === "project") {
    const r = await pool.query<{ sector: string | null }>(`SELECT sector FROM projects WHERE id = $1`, [entityId]);
    if (!r.rows[0]) return undefined;
    return { sector: r.rows[0].sector, reportType: null };
  }
  if (entityType === "report") {
    // Security rule: Project Reports use Project Primary Sector ONLY for TC scope.
    // Activity Reports are source-aware: project-linked uses p.sector; standalone uses act.sector.
    // r.sector is display-only and must not widen TC access.
    const r = await pool.query<{
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
    const r = await pool.query<{ sector: string | null }>(
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
    const r = await pool.query<{ sector: string | null }>(
      `SELECT p.sector FROM risks r LEFT JOIN projects p ON p.id = r.project_id WHERE r.id = $1`,
      [entityId],
    );
    if (!r.rows[0]) return undefined;
    return { sector: r.rows[0].sector, reportType: null };
  }
  return undefined;
}

/**
 * @mention used to resolve any `@username` in the comment body against ALL
 * active users org-wide, with zero check that the mentioned person actually
 * has any relationship to (or view authority over) the entity being
 * commented on — so mentioning a guessed/enumerated username silently
 * disclosed the entity's existence and a working deep link to a
 * stateId/sector they were never authorised to see.
 *
 * routes/conversations.ts already gets this right for its own @mention
 * feature ("mentionedUserIds are validated by the send-message handler and
 * contain only active conversation members. Never resolve identities from
 * text.") — this mirrors that principle for comments: a resolved username
 * only becomes a notification recipient when they pass the SAME visibility
 * rule that gates a direct GET of the entity (the "all other org-wide roles
 * pass; only technical_coordinator is sector-scoped and only
 * state_program_officer/state_office_manager are state-scoped" rule already
 * used by resolveReportViewAccess and the reportScopeSql/projectScopeSql/
 * planScopeSql family in routes/files.ts).
 */
export async function authorizedMentionRecipientIds(
  entityType: string,
  entityId: number,
  usernames: string[],
  excludeUserId: number,
): Promise<number[]> {
  const ORG_WIDE_CLAUSE = `u.role NOT IN ('technical_coordinator', 'state_program_officer', 'state_office_manager')`;
  const SECTOR_CLAUSE = (sectorExpr: string) => `
    (u.role = 'technical_coordinator' AND ${sectorExpr} IS NOT NULL AND EXISTS (
      SELECT 1 FROM unnest(string_to_array(u.sector, ',')) AS seg(val) WHERE trim(seg.val) = ${sectorExpr}
    ))`;

  if (entityType === "project") {
    const { rows } = await pool.query<{ id: number }>(
      `SELECT u.id FROM users u, projects p
       WHERE p.id = $1 AND u.username = ANY($2::text[]) AND u.status = 'active' AND u.id != $3
         AND (
           ${ORG_WIDE_CLAUSE}
           OR ${SECTOR_CLAUSE("p.sector")}
           OR (u.role IN ('state_program_officer','state_office_manager') AND u.state_id IS NOT NULL
               AND EXISTS (SELECT 1 FROM project_states ps WHERE ps.project_id = p.id AND ps.state_id = u.state_id))
         )`,
      [entityId, usernames, excludeUserId],
    );
    return rows.map((r) => r.id);
  }
  if (entityType === "report") {
    const { rows } = await pool.query<{ id: number }>(
      `SELECT u.id
       FROM users u, (
         SELECT r.state_id,
                CASE
                  WHEN r.report_type = 'project' THEN p.sector
                  WHEN r.report_type = 'activity' THEN CASE WHEN r.project_id IS NULL THEN act.sector ELSE p.sector END
                  ELSE COALESCE(NULLIF(r.sector,''), p.sector)
                END AS sector
         FROM reports r
         LEFT JOIN projects p ON p.id = r.project_id
         LEFT JOIN activities act ON act.id = r.activity_id
         WHERE r.id = $1
       ) rc
       WHERE u.username = ANY($2::text[]) AND u.status = 'active' AND u.id != $3
         AND (
           ${ORG_WIDE_CLAUSE}
           OR ${SECTOR_CLAUSE("rc.sector")}
           OR (u.role IN ('state_program_officer','state_office_manager') AND rc.state_id IS NOT NULL
               AND u.state_id = rc.state_id)
         )`,
      [entityId, usernames, excludeUserId],
    );
    return rows.map((r) => r.id);
  }
  if (entityType === "plan") {
    const { rows } = await pool.query<{ id: number }>(
      `SELECT u.id
       FROM users u, plans pl LEFT JOIN projects p ON p.id = pl.project_id
       WHERE pl.id = $1 AND u.username = ANY($2::text[]) AND u.status = 'active' AND u.id != $3
         AND (
           ${ORG_WIDE_CLAUSE}
           OR ${SECTOR_CLAUSE("COALESCE(NULLIF(pl.sector,''), p.sector)")}
           OR (u.role IN ('state_program_officer','state_office_manager')
               AND pl.location_type IS DISTINCT FROM 'hq' AND pl.state_id IS NOT NULL
               AND u.state_id = pl.state_id)
         )`,
      [entityId, usernames, excludeUserId],
    );
    return rows.map((r) => r.id);
  }
  if (entityType === "risk") {
    // RISK-BD-07: standalone risks (no project) carry no sector/state data
    // anywhere, so neither the TC-sector nor the SPO/SOM-state branch can
    // ever match one — only org-wide roles may be mentioned on it, exactly
    // like the equivalent risks.ts view-scope rule.
    const { rows } = await pool.query<{ id: number }>(
      `SELECT u.id
       FROM users u, risks r LEFT JOIN projects p ON p.id = r.project_id
       WHERE r.id = $1 AND u.username = ANY($2::text[]) AND u.status = 'active' AND u.id != $3
         AND (
           ${ORG_WIDE_CLAUSE}
           OR ${SECTOR_CLAUSE("p.sector")}
           OR (u.role IN ('state_program_officer','state_office_manager') AND r.state_id IS NOT NULL
               AND u.state_id = r.state_id)
         )`,
      [entityId, usernames, excludeUserId],
    );
    return rows.map((r) => r.id);
  }
  return [];
}

// RISK-001: state scope for risk comments — mirrors PATCH /risks/:riskId and
// GET /risks/:riskId/history. State roles (SPO/SOM) may only touch comments on
// risks in their own state; a state user with a null stateId fails closed.
// PM / super_admin pass (Full Operational Access, Task #373) as they are not
// state roles and hold no TC sector restriction.
async function assertRiskStateScope(
  req: { currentUser?: { role: string; stateId?: number | null } | null },
  riskId: number,
): Promise<{ ok: true } | { ok: false; status: number; body: object }> {
  const u = req.currentUser;
  if (!u) return { ok: false, status: 401, body: { error: "unauthorized" } };
  const isStateRole = u.role === "state_program_officer" || u.role === "state_office_manager";
  if (!isStateRole) return { ok: true };
  if (u.stateId == null) return { ok: false, status: 403, body: { error: "state_forbidden" } };
  const r = await pool.query<{ state_id: number | null }>(
    `SELECT state_id FROM risks WHERE id = $1`,
    [riskId],
  );
  if (!r.rows[0]) return { ok: false, status: 404, body: { error: "entity_not_found" } };
  if (r.rows[0].state_id !== u.stateId) {
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

router.get("/comments", async (req, res, next) => {
  try {
    if (!req.currentUser) { res.status(401).json({ error: "unauthorized" }); return; }
    const entityType = String(req.query.entityType ?? "");
    const entityId = Number(req.query.entityId);
    if (!VALID_ENTITY_TYPES.has(entityType) || !Number.isFinite(entityId)) {
      res.status(400).json({ error: "entityType_and_entityId_required" });
      return;
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
      const perms = permissionsFor(req.currentUser);
      if (!hasPerm(perms, "risks.view") && !hasPerm(perms, "risks.view.state")) {
        res.status(403).json({ error: "forbidden", requiredPermission: "risks.view" });
        return;
      }
      const meta = await loadEntityMeta("risk", entityId);
      if (meta === undefined) { res.status(404).json({ error: "entity_not_found" }); return; }
      const guard = assertSectorAllowed(req, meta.sector);
      if (!guard.ok) { res.status(guard.status).json(guard.body); return; }
      const stateGuard = await assertRiskStateScope(req, entityId);
      if (!stateGuard.ok) { res.status(stateGuard.status).json(stateGuard.body); return; }
      const { rows } = await pool.query(
        `SELECT ${COMMENT_COLS} FROM comments c JOIN users u ON u.id = c.author_id
         WHERE c.entity_type = 'risk' AND c.entity_id = $1
         ORDER BY c.created_at ASC`,
        [entityId],
      );
      res.json(rows);
      return;
    }

    const canComment = hasPerm(permissionsFor(req.currentUser), "comments.create");
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
          req.currentUser.role === "state_program_officer" ||
          req.currentUser.role === "state_office_manager";
        if (!isStateRole || req.currentUser.stateId == null) {
          res.status(403).json({ error: "forbidden", requiredPermission: "comments.create" });
          return;
        }
        const gate = await pool.query<{ ok: boolean }>(
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
          [entityId, req.currentUser.stateId],
        );
        if (!gate.rows[0]?.ok) {
          res.status(403).json({ error: "forbidden", requiredPermission: "comments.create" });
          return;
        }
        // Return only revision_request comments — narrowly scoped read.
        const { rows } = await pool.query(
          `SELECT ${COMMENT_COLS} FROM comments c JOIN users u ON u.id = c.author_id
           WHERE c.entity_type = 'plan' AND c.entity_id = $1
             AND c.comment_type = 'revision_request'
           ORDER BY c.created_at ASC`,
          [entityId],
        );
        res.json(rows);
        return;
      }

      // ── Report read-only exceptions (SPR-010, HQSR-005) ─────────────────
      if (entityType !== "report") {
        res.status(403).json({ error: "forbidden", requiredPermission: "comments.create" });
        return;
      }
      // Retain the canonical report-view check (state + sector scope, 404 on
      // missing report) before applying the narrower authorship gate.
      const view = await assertCanViewReport(req, entityId);
      if (!view.ok) { res.status(view.status).json(view.body); return; }
      const gate = await pool.query<{ ok: boolean }>(
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
        [entityId, req.currentUser.id],
      );
      if (!gate.rows[0]?.ok) {
        res.status(403).json({ error: "forbidden", requiredPermission: "comments.create" });
        return;
      }
      const { rows } = await pool.query(
        `SELECT ${COMMENT_COLS} FROM comments c JOIN users u ON u.id = c.author_id
         WHERE c.entity_type = $1 AND c.entity_id = $2
         ORDER BY c.created_at ASC`,
        [entityType, entityId],
      );
      res.json(rows);
      return;
    }

    const meta = await loadEntityMeta(entityType, entityId);
    if (meta === undefined) { res.status(404).json({ error: "entity_not_found" }); return; }
    const guard = assertSectorAllowed(req, meta.sector);
    if (!guard.ok) { res.status(guard.status).json(guard.body); return; }

    // State scope: SPO/SOM must not read comments on a report from a different state.
    // This mirrors the GET /reports/:reportId state scope check.
    if (entityType === "report") {
      const isStateRole =
        req.currentUser?.role === "state_program_officer" ||
        req.currentUser?.role === "state_office_manager";
      if (isStateRole && req.currentUser?.stateId) {
        const stateCheck = await pool.query<{ state_id: number | null }>(
          `SELECT state_id FROM reports WHERE id = $1`,
          [entityId],
        );
        if (stateCheck.rows.length > 0 && stateCheck.rows[0].state_id !== req.currentUser.stateId) {
          res.status(403).json({ error: "state_scope_forbidden" });
          return;
        }
      }
    }

    const { rows } = await pool.query(
      `SELECT ${COMMENT_COLS} FROM comments c JOIN users u ON u.id = c.author_id
       WHERE c.entity_type = $1 AND c.entity_id = $2
       ORDER BY c.created_at ASC`,
      [entityType, entityId],
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.post("/comments", async (req, res, next) => {
  try {
    if (!req.currentUser) { res.status(401).json({ error: "unauthorized" }); return; }
    const body = req.body ?? {};
    const entityType = String(body.entityType ?? "");

    // Permission gate. Canonical rule: comments.create (HQ roles + ED).
    // RISK-001 exception: risk comments are additionally open to actors with
    // canonical risk mutation authority (risks.update — e.g. SPO within their
    // state), since SPO/SOM hold no comments.create by RBAC spec. SOM remains
    // read-only for risks (view-only monitoring role). Scope checks below
    // still apply in full.
    {
      const perms = permissionsFor(req.currentUser);
      const canComment = hasPerm(perms, "comments.create");
      const riskAuthor = entityType === "risk" && hasPerm(perms, "risks.update");
      if (!canComment && !riskAuthor) {
        res.status(403).json({ error: "forbidden", requiredPermission: "comments.create" });
        return;
      }
    }
    const entityId = Number(body.entityId);
    const commentType = String(body.commentType ?? "general");
    // Whitespace-only / empty sections are normalised to null (report-level).
    const section = (body.section == null ? "" : String(body.section).trim()) || null;
    const parentId = body.parentId == null ? null : Number(body.parentId);
    const text = String(body.body ?? "").trim();
    if (!VALID_ENTITY_TYPES.has(entityType) || !Number.isFinite(entityId)) {
      res.status(400).json({ error: "entityType_and_entityId_required" });
      return;
    }
    if (!VALID_COMMENT_TYPES.has(commentType)) {
      res.status(400).json({ error: "invalid_comment_type" });
      return;
    }
    if (!text) { res.status(400).json({ error: "body_required" }); return; }
    const meta = await loadEntityMeta(entityType, entityId);
    if (meta === undefined) { res.status(404).json({ error: "entity_not_found" }); return; }
    const guard = assertSectorAllowed(req, meta.sector);
    if (!guard.ok) { res.status(guard.status).json(guard.body); return; }

    // RISK-001: state scope for risk comments (SPO/SOM clamped to own state).
    if (entityType === "risk") {
      const stateGuard = await assertRiskStateScope(req, entityId);
      if (!stateGuard.ok) { res.status(stateGuard.status).json(stateGuard.body); return; }
    }

    // SPR-010: State Programme Report comments must use a canonical section
    // key (or no section at all — null renders as "General / Report-Level").
    // Other report types and entity types are unaffected.
    if (entityType === "report" && meta.reportType === "program_state") {
      if (section !== null && !isSprSectionKey(section)) {
        res.status(422).json({ error: "invalid_section_key" });
        return;
      }
    }

    const allowed = ROLE_TYPE_ALLOW[req.currentUser.role] ?? new Set<string>(["general"]);
    if (!allowed.has(commentType)) {
      res.status(403).json({ error: "comment_type_not_allowed_for_role" });
      return;
    }

    if (parentId != null) {
      const p = await pool.query(`SELECT id FROM comments WHERE id = $1 AND entity_type = $2 AND entity_id = $3`, [parentId, entityType, entityId]);
      if (!p.rows[0]) { res.status(400).json({ error: "invalid_parent" }); return; }
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
          res.status(404).json({ error: "entity_not_found" });
          return;
        }
        const { rows } = await txClient.query(
          `INSERT INTO comments (entity_type, entity_id, parent_id, section, comment_type, author_id, body)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           RETURNING id`,
          [entityType, entityId, parentId, section, commentType, req.currentUser.id, text],
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
      const { rows } = await pool.query(
        `INSERT INTO comments (entity_type, entity_id, parent_id, section, comment_type, author_id, body)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id`,
        [entityType, entityId, parentId, section, commentType, req.currentUser.id, text],
      );
      id = rows[0].id;
    }
    const out = await pool.query(
      `SELECT ${COMMENT_COLS} FROM comments c JOIN users u ON u.id = c.author_id WHERE c.id = $1`,
      [id],
    );
    await logAudit({
      userId: req.currentUser.id,
      action: parentId ? "comment_reply" : "comment_add",
      module: "comments",
      entityId: id,
      newValue: `${entityType}#${entityId}:${commentType}`,
    });

    // Notify the entity's stakeholders. Replies also ping the parent's author.
    const kind = parentId ? "comment_replied" : "comment_added";
    // SPR-010: include the section context in the notification for SPR
    // comments tagged with a canonical section key.
    const sectionSuffix =
      meta.reportType === "program_state" && section && isSprSectionKey(section)
        ? ` — ${getSprSectionLabel(section)}`
        : "";
    const message = parentId
      ? `${req.currentUser.name} replied to a comment`
      : `${req.currentUser.name} added a ${commentType.replace(/_/g, " ")} comment${sectionSuffix}`;
    const link = await entityLink(entityType, entityId);
    await notifyEntityActors({
      entityType, entityId, kind, message, exceptUserId: req.currentUser.id, link,
      dedupeKey: `comment-event:${id}`,
    });
    if (parentId != null) {
      const parentAuthor = await pool.query<{ author_id: number }>(`SELECT author_id FROM comments WHERE id = $1`, [parentId]);
      const pid = parentAuthor.rows[0]?.author_id;
      if (pid && pid !== req.currentUser.id) {
        await createNotificationDeduped({
          userId: pid, kind, entityType, entityId, message, link,
          dedupeKey: `comment-event:${id}`,
        });
      }
    }

    // @mention notifications — parse @username patterns and notify each
    // mentioned user, but only those actually authorised to view this entity
    // (see authorizedMentionRecipientIds above).
    const mentionMatches = [...text.matchAll(/@([\w.]+)/g)];
    if (mentionMatches.length > 0) {
      const usernames = [...new Set(mentionMatches.map(m => m[1]))];
      const authorizedIds = await authorizedMentionRecipientIds(entityType, entityId, usernames, req.currentUser.id);
      for (const recipientId of authorizedIds) {
        await createNotificationDeduped({
          userId: recipientId,
          kind: "mention",
          entityType,
          entityId,
          message: `${req.currentUser.name} mentioned you in a comment`,
          link,
          dedupeKey: `comment-mention:${id}`,
        });
      }
    }

    res.status(201).json(out.rows[0]);
  } catch (err) { next(err); }
});

router.patch("/comments/:id", async (req, res, next) => {
  try {
    if (!req.currentUser) { res.status(401).json({ error: "unauthorized" }); return; }
    const id = Number(req.params.id);
    const action = String(req.body?.action ?? "");
    if (!["resolve", "reopen"].includes(action)) {
      res.status(400).json({ error: "invalid_action" });
      return;
    }
    // Permission gate: comments.create, or canonical risk mutation authority
    // for risk comments (RISK-001 — SPO holds risks.update, not comments.create).
    // Enumeration-safe: callers with neither permission are rejected BEFORE the
    // lookup, and risks.update-only callers get a uniform 403 for both absent
    // IDs and existing non-risk comments, so arbitrary comment IDs cannot be
    // probed for existence.
    const perms = permissionsFor(req.currentUser);
    const canComment = hasPerm(perms, "comments.create");
    const canRiskMutate = hasPerm(perms, "risks.update");
    if (!canComment && !canRiskMutate) {
      res.status(403).json({ error: "forbidden", requiredPermission: "comments.create" });
      return;
    }
    const c = (await pool.query(`SELECT * FROM comments WHERE id = $1`, [id])).rows[0];
    if (!c) {
      if (!canComment) { res.status(403).json({ error: "forbidden", requiredPermission: "comments.create" }); return; }
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (!canComment && c.entity_type !== "risk") {
      res.status(403).json({ error: "forbidden", requiredPermission: "comments.create" });
      return;
    }
    const meta = await loadEntityMeta(c.entity_type, c.entity_id);
    const guard = assertSectorAllowed(req, meta?.sector ?? null);
    if (!guard.ok) { res.status(guard.status).json(guard.body); return; }
    // RISK-001: risk comments are additionally clamped to the actor's state
    // scope — a comment on an inaccessible risk cannot be resolved/reopened by ID.
    if (c.entity_type === "risk") {
      const stateGuard = await assertRiskStateScope(req, Number(c.entity_id));
      if (!stateGuard.ok) { res.status(stateGuard.status).json(stateGuard.body); return; }
    }
    // Authz: only the author, a super_admin/executive_director/PM (Full Operational
    // Access), or a role that may post the same comment_type can resolve/reopen.
    const role = req.currentUser.role;
    const isAuthor = c.author_id === req.currentUser.id;
    const isAdminish = hasFullOperationalAccess(req.currentUser) || role === "executive_director";
    const canActOnType = ROLE_TYPE_ALLOW[role]?.has(c.comment_type) ?? false;
    if (!isAuthor && !isAdminish && !canActOnType) {
      res.status(403).json({ error: "cannot_change_comment_status" });
      return;
    }
    const status = action === "resolve" ? "resolved" : "open";
    const resolvedAt = action === "resolve" ? new Date() : null;
    const resolvedBy = action === "resolve" ? req.currentUser.id : null;
    await pool.query(
      `UPDATE comments SET status = $1, resolved_at = $2, resolved_by_id = $3, updated_at = NOW() WHERE id = $4`,
      [status, resolvedAt, resolvedBy, id],
    );
    await logAudit({ userId: req.currentUser.id, action: `comment_${action}`, module: "comments", entityId: id });
    const out = await pool.query(
      `SELECT ${COMMENT_COLS} FROM comments c JOIN users u ON u.id = c.author_id WHERE c.id = $1`,
      [id],
    );
    res.json(out.rows[0]);
  } catch (err) { next(err); }
});

router.delete("/comments/:id", async (req, res, next) => {
  try {
    if (!req.currentUser) { res.status(401).json({ error: "unauthorized" }); return; }
    const id = Number(req.params.id);
    // Permission gate: comments.create, or canonical risk mutation authority
    // for risk comments (RISK-001). Enumeration-safe — see PATCH handler note.
    const perms = permissionsFor(req.currentUser);
    const canComment = hasPerm(perms, "comments.create");
    const canRiskMutate = hasPerm(perms, "risks.update");
    if (!canComment && !canRiskMutate) {
      res.status(403).json({ error: "forbidden", requiredPermission: "comments.create" });
      return;
    }
    const c = (await pool.query(
      `SELECT author_id, created_at, entity_type, entity_id FROM comments WHERE id = $1`, [id],
    )).rows[0];
    if (!c) {
      if (!canComment) { res.status(403).json({ error: "forbidden", requiredPermission: "comments.create" }); return; }
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (!canComment && c.entity_type !== "risk") {
      res.status(403).json({ error: "forbidden", requiredPermission: "comments.create" });
      return;
    }
    // RISK-001: parent-entity scope enforced on delete-by-ID — a comment on an
    // inaccessible risk (wrong sector or state) cannot be deleted directly.
    if (c.entity_type === "risk") {
      const meta = await loadEntityMeta("risk", Number(c.entity_id));
      const guard = assertSectorAllowed(req, meta?.sector ?? null);
      if (!guard.ok) { res.status(guard.status).json(guard.body); return; }
      const stateGuard = await assertRiskStateScope(req, Number(c.entity_id));
      if (!stateGuard.ok) { res.status(stateGuard.status).json(stateGuard.body); return; }
    }
    const isAuthor = c.author_id === req.currentUser.id;
    // PM/super_admin (Full Operational Access) may delete any comment at any time.
    // Normal users may only delete their own comments within 15 minutes.
    const isFullAccess = hasFullOperationalAccess(req.currentUser);
    const within15min = Date.now() - new Date(c.created_at).getTime() < 15 * 60 * 1000;
    if (!isFullAccess && !(isAuthor && within15min)) {
      res.status(403).json({ error: "cannot_delete" });
      return;
    }
    await pool.query(`DELETE FROM comments WHERE id = $1`, [id]);
    await logAudit({ userId: req.currentUser.id, action: "comment_delete", module: "comments", entityId: id });
    res.status(204).end();
  } catch (err) { next(err); }
});

// Helper exposed for transitions: count unresolved required-correction comments.
export async function unresolvedRequiredCorrections(entityType: string, entityId: number): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM comments
     WHERE entity_type = $1 AND entity_id = $2 AND comment_type = 'required_correction' AND status = 'open'`,
    [entityType, entityId],
  );
  return rows[0]?.n ?? 0;
}

export default router;
