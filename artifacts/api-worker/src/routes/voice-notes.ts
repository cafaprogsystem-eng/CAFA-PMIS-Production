import { Hono } from "hono";
import type { Bindings, QueryExecutor } from "../lib/db";
import { openDb } from "../lib/db";
import {
  attachCurrentUser,
  requireAuth,
  requirePerm,
  logAudit,
  assertSectorAllowed,
  type CurrentUser,
  type Variables,
} from "../lib/rbac";
import { assertCanViewReport, assertAttachmentMutationAllowed } from "../lib/report-auth";
import {
  ObjectNotFoundError,
  getObjectEntityFile,
  getObjectEntityMetadata,
  downloadObject,
  deleteObjectSafely,
} from "../lib/storage";
import { isStorageDeleteSafeForRecord } from "../lib/evidence-ownership";
import { verifyUploadToken, UploadTokenError } from "../lib/upload-token";

/**
 * Ported from artifacts/api-server/src/routes/voice-notes.ts (466 lines) —
 * fourth file of the attachments group. Audio evidence attached to project /
 * plan / report / risk / comment entities, with an ATT-02 hardened path for
 * report-bound recordings (uploadToken from POST /storage/uploads/request-url,
 * verified server-side before registration) and a backward-compatible
 * objectPath-from-body path for the other entity types.
 *
 * Dropped: the source's runtime duck-typing fallback for "historical
 * unit-test storage doubles" around getObjectEntityMetadata — this worker
 * always calls the real function (there is no test-double storage layer
 * in this codebase), so only the production branch is ported.
 *
 * The `idx_voice_notes_object_path` unique index (confirmed live) is what
 * makes `ON CONFLICT (object_path) DO NOTHING` race-safe for concurrent
 * duplicate registrations of the same upload token.
 */

const ALLOWED_ENTITY_TYPES = ["project", "plan", "report", "risk", "comment"] as const;
type EntityType = (typeof ALLOWED_ENTITY_TYPES)[number];

interface VoiceNoteRow extends Record<string, unknown> {
  id: number;
  entityType: string;
  entityId: number;
  fileName: string;
  objectPath: string;
  contentType: string;
  durationSeconds: number;
  recordedById: number | null;
  createdAt: Date;
  availabilityStatus: string;
  unavailableReason: string | null;
}

const VOICE_NOTE_COLUMNS = `id, entity_type AS "entityType", entity_id AS "entityId", file_name AS "fileName",
       object_path AS "objectPath", content_type AS "contentType", duration_seconds AS "durationSeconds",
       recorded_by_id AS "recordedById", created_at AS "createdAt",
       availability_status AS "availabilityStatus", unavailable_reason AS "unavailableReason"`;

// Helper: load the effective sector for an entity so scope can be enforced.
async function loadVoiceNoteSector(
  db: QueryExecutor,
  entityType: string,
  entityId: number,
): Promise<string | null | undefined> {
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
    if (reportType === "project") return projectSector;
    // Activity Reports: source-aware.
    //   Standalone (project_id IS NULL): activity.sector is the ONLY authority.
    //   Project-linked: Project Primary Sector is the ONLY authority.
    // Fail-closed: null sector → assertSectorAllowed denies TC access.
    if (reportType === "activity") {
      return projectId === null ? activitySector : projectSector;
    }
    return effectiveSector;
  }
  if (entityType === "project") {
    const r = await db.query<{ sector: string | null }>(`SELECT sector FROM projects WHERE id = $1`, [entityId]);
    return r.rows[0]?.sector;
  }
  if (entityType === "plan") {
    const r = await db.query<{ sector: string | null }>(
      `SELECT COALESCE(NULLIF(pl.sector,''), p.sector) AS sector
       FROM plans pl LEFT JOIN projects p ON p.id = pl.project_id WHERE pl.id = $1`,
      [entityId],
    );
    return r.rows[0]?.sector;
  }
  // risk/comment — no sector scope; allow if authenticated
  return null;
}

export const voiceNotesRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

voiceNotesRoutes.use("/voice-notes", attachCurrentUser, requireAuth);
voiceNotesRoutes.use("/voice-notes/*", attachCurrentUser, requireAuth);

// GET /voice-notes?entityType=project&entityId=123
voiceNotesRoutes.get("/voice-notes", requirePerm("reports.view"), async (c) => {
  const user = c.get("currentUser");
  const { db, close } = openDb(c);
  try {
    const q = c.req.query();
    const entityType = q.entityType;
    const entityId = Number(q.entityId);

    if (!entityType || !ALLOWED_ENTITY_TYPES.includes(entityType as EntityType)) {
      return c.json({ error: "entityType is required and must be one of: " + ALLOWED_ENTITY_TYPES.join(", ") }, 400);
    }
    if (!entityId || Number.isNaN(entityId)) {
      return c.json({ error: "entityId must be a valid integer" }, 400);
    }

    // Sector scope: enforce for project/plan/report entity types
    const sector = await loadVoiceNoteSector(db, entityType, entityId);
    if (entityType !== "risk" && entityType !== "comment" && sector === undefined) {
      return c.json({ error: "entity_not_found" }, 404);
    }
    const guard = assertSectorAllowed(user, sector ?? null);
    if (!guard.ok) return c.json(guard.body, guard.status as 403);

    // State scope: SPO/SOM must not read voice notes for a report from a different state
    if (entityType === "report") {
      const isStateRole = user?.role === "state_program_officer" || user?.role === "state_office_manager";
      if (isStateRole && user?.stateId) {
        const stateCheck = await db.query<{ stateId: number | null }>(
          `SELECT state_id AS "stateId" FROM reports WHERE id = $1`,
          [entityId],
        );
        if (stateCheck.rows.length > 0 && stateCheck.rows[0].stateId !== user.stateId) {
          return c.json({ error: "state_scope_forbidden" }, 403);
        }
      }
    }

    const result = await db.query<VoiceNoteRow>(
      `SELECT ${VOICE_NOTE_COLUMNS}
       FROM voice_notes WHERE entity_type = $1 AND entity_id = $2 ORDER BY created_at`,
      [entityType, entityId],
    );

    const withNames = await Promise.all(result.rows.map(async (row) => {
      let recordedByName: string | null = null;
      if (row.recordedById) {
        const u = await db.query<{ name: string }>(`SELECT name FROM users WHERE id = $1`, [row.recordedById]);
        recordedByName = u.rows[0]?.name ?? null;
      }
      const { objectPath: _omitted, ...publicRow } = row;
      return { ...publicRow, recordedByName, createdAt: row.createdAt.toISOString() };
    }));

    return c.json(withNames);
  } finally {
    close();
  }
});

// POST /voice-notes — requires authentication + upload permission + sector scope
//
// ATT-02 hardened for report entity type: client must supply an uploadToken
// issued by POST /storage/uploads/request-url. The objectPath and contentType
// are taken exclusively from the verified token.
//
// For non-report entity types (project, plan, risk, comment), the existing
// objectPath-from-body flow is preserved for backward compatibility.
voiceNotesRoutes.post("/voice-notes", requirePerm("documents.upload"), async (c) => {
  const user = c.get("currentUser")!;
  const { db, close } = openDb(c);
  try {
    const body = (await c.req.json().catch(() => ({}))) as {
      entityType: string;
      entityId: number;
      fileName: string;
      uploadToken?: string;
      contentType?: string;
      durationSeconds: number;
      objectPath?: string;
    };
    const { entityType, entityId, fileName, uploadToken, contentType: bodyContentType, durationSeconds } = body;

    if (!entityType || !ALLOWED_ENTITY_TYPES.includes(entityType as EntityType)) {
      return c.json({ error: "Invalid entityType" }, 400);
    }
    if (!entityId || !fileName) {
      return c.json({ error: "entityId and fileName are required" }, 400);
    }

    // ── Report entity type: ATT-02 hardened path ─────────────────────────────
    if (entityType === "report") {
      const reportId = Number(entityId);

      // Require uploadToken for report voice notes.
      if (!uploadToken) {
        return c.json({ error: "uploadToken is required for report voice notes" }, 400);
      }

      // Validate duration before doing any DB work.
      const duration = Number(durationSeconds);
      if (!Number.isFinite(duration) || duration < 0 || duration > 300) {
        return c.json({ error: "durationSeconds must be between 0 and 300" }, 400);
      }

      // Re-authorise at registration time.
      const authCheck = await assertAttachmentMutationAllowed(db, user, reportId);
      if (!authCheck.ok) return c.json(authCheck.body, authCheck.status as 401 | 403 | 404 | 409);

      // Verify the upload token.
      let descriptor;
      try {
        descriptor = verifyUploadToken(uploadToken, c.env.SESSION_SECRET);
      } catch (err) {
        if (err instanceof UploadTokenError) {
          return c.json({ error: "invalid_upload_token", message: err.message }, 400);
        }
        throw err;
      }

      // Token must belong to the requesting user.
      if (descriptor.userId !== user.id) {
        return c.json({ error: "upload_token_user_mismatch" }, 403);
      }
      // Token must be bound to this specific report.
      if (descriptor.reportId !== reportId) {
        return c.json({ error: "upload_not_bound_to_report" }, 403);
      }
      // Token must be for a voice note.
      if (descriptor.entityType !== "voice_note") {
        return c.json({ error: "upload_token_entity_type_mismatch" }, 400);
      }

      // Verify the object was actually uploaded to storage before registering it.
      try {
        await getObjectEntityFile(c.env, descriptor.objectPath);
        const metadata = await getObjectEntityMetadata(c.env, descriptor.objectPath);
        if (
          metadata.size !== descriptor.maxSize
          || !metadata.contentType
          || metadata.contentType.split(";")[0].trim().toLowerCase() !== descriptor.contentType.split(";")[0].trim().toLowerCase()
        ) {
          return c.json({ error: "provider_metadata_mismatch" }, 422);
        }
      } catch (storageErr) {
        if (storageErr instanceof ObjectNotFoundError) {
          return c.json({
            error: "object_not_found_in_storage",
            message: "The voice note has not been uploaded yet. Upload the file before registering.",
          }, 422);
        }
        throw storageErr;
      }

      // Atomic INSERT relying on the idx_voice_notes_object_path unique index —
      // prevents race-prone duplicate registrations under concurrent retries.
      // ON CONFLICT DO NOTHING: if a duplicate exists, RETURNING yields no row;
      // we then fetch the existing row for an idempotent response.
      const inserted = await db.query<VoiceNoteRow>(
        `INSERT INTO voice_notes (entity_type, entity_id, file_name, object_path, content_type, duration_seconds, recorded_by_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (object_path) DO NOTHING
         RETURNING ${VOICE_NOTE_COLUMNS}`,
        [entityType, reportId, fileName, descriptor.objectPath, descriptor.contentType, duration, user.id],
      );

      const note = inserted.rows[0] ?? (await db.query<VoiceNoteRow>(
        `SELECT ${VOICE_NOTE_COLUMNS} FROM voice_notes WHERE object_path = $1`,
        [descriptor.objectPath],
      )).rows[0];

      await logAudit(db, {
        userId: user.id,
        action: "voice_note_created",
        module: entityType,
        entityId: reportId,
        newValue: JSON.stringify({ id: note.id, durationSeconds: note.durationSeconds }),
      });

      const { objectPath: _omitted, ...publicNote } = note;
      return c.json({
        ...publicNote,
        createdAt: note.createdAt.toISOString(),
        recordedByName: user.name ?? null,
      }, 201);
    }

    // ── Non-report entity types: backward-compatible path ────────────────────
    const objectPath = body.objectPath;
    if (!objectPath || !bodyContentType) {
      return c.json({ error: "entityId, fileName, objectPath, contentType are required" }, 400);
    }

    // Sector scope — same logic as GET (sector-scoped entity types are verified; risk/comment pass through)
    const sector = await loadVoiceNoteSector(db, entityType, Number(entityId));
    if (["project", "plan"].includes(entityType) && sector === undefined) {
      return c.json({ error: "entity_not_found" }, 404);
    }
    const guard = assertSectorAllowed(user, sector ?? null);
    if (!guard.ok) return c.json(guard.body, guard.status as 403);

    const inserted = await db.query<VoiceNoteRow>(
      `INSERT INTO voice_notes (entity_type, entity_id, file_name, object_path, content_type, duration_seconds, recorded_by_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING ${VOICE_NOTE_COLUMNS}`,
      [entityType, Number(entityId), fileName, objectPath, bodyContentType, Number(durationSeconds) || 0, user.id],
    );
    const note = inserted.rows[0];

    await logAudit(db, {
      userId: user.id,
      action: "voice_note_created",
      module: entityType,
      entityId: Number(entityId),
      newValue: JSON.stringify({ id: note.id, durationSeconds: note.durationSeconds }),
    });

    const { objectPath: _omitted2, ...publicNote2 } = note;
    return c.json({
      ...publicNote2,
      createdAt: note.createdAt.toISOString(),
      recordedByName: user.name ?? null,
    }, 201);
  } finally {
    close();
  }
});

// GET /voice-notes/:id/stream  — proxy the audio stream (requires auth + scope)
voiceNotesRoutes.get("/voice-notes/:id/stream", requirePerm("reports.view"), async (c) => {
  const user = c.get("currentUser");
  const { db, close } = openDb(c);
  try {
    const id = Number(c.req.param("id"));
    const result = await db.query<VoiceNoteRow>(`SELECT ${VOICE_NOTE_COLUMNS} FROM voice_notes WHERE id = $1`, [id]);
    const note = result.rows[0];
    if (!note) return c.json({ error: "Not found" }, 404);
    if (note.availabilityStatus === "unavailable") {
      return c.json({ error: "file_unavailable", message: "File Unavailable" }, 410);
    }

    // For report-entity voice notes, apply the full canonical report-view auth
    // (sector scope + state scope). This closes the state-bypass gap where
    // a State 2 SPO could stream a State 1 report's voice note.
    if (note.entityType === "report") {
      const authResult = await assertCanViewReport(db, user, note.entityId);
      if (!authResult.ok) return c.json(authResult.body, authResult.status as 401 | 403 | 404);
    } else {
      // For project/plan/risk/comment entity types, preserve the existing
      // loadVoiceNoteSector + assertSectorAllowed logic exactly as before.
      const sector = await loadVoiceNoteSector(db, note.entityType, note.entityId);
      if (["project", "plan"].includes(note.entityType) && sector === undefined) {
        return c.json({ error: "entity_not_found" }, 404);
      }
      const guard = assertSectorAllowed(user, sector ?? null);
      if (!guard.ok) return c.json(guard.body, guard.status as 403);
    }

    try {
      const objectFile = await getObjectEntityFile(c.env, note.objectPath);
      const response = await downloadObject(c.env, objectFile);
      const headers = new Headers(response.headers);
      headers.set("Content-Type", note.contentType);
      headers.set("Accept-Ranges", "bytes");
      return new Response(response.body, { status: response.status, headers });
    } catch {
      return c.json({ error: "Audio file not found in storage" }, 404);
    }
  } finally {
    close();
  }
});

// GET /voice-notes/:id/url  — returns a URL to stream the audio (requires auth + scope)
// NOTE: GET /voice-notes list above already applies the full canonical auth
//       including state scope; no change needed there.
voiceNotesRoutes.get("/voice-notes/:id/url", requirePerm("reports.view"), async (c) => {
  const user = c.get("currentUser");
  const { db, close } = openDb(c);
  try {
    const id = Number(c.req.param("id"));
    const result = await db.query<VoiceNoteRow>(`SELECT ${VOICE_NOTE_COLUMNS} FROM voice_notes WHERE id = $1`, [id]);
    const note = result.rows[0];
    if (!note) return c.json({ error: "Not found" }, 404);

    // For report-entity voice notes, apply the full canonical report-view auth
    // (sector scope + state scope). Fixes the same state-bypass gap as /stream.
    if (note.entityType === "report") {
      const authResult = await assertCanViewReport(db, user, note.entityId);
      if (!authResult.ok) return c.json(authResult.body, authResult.status as 401 | 403 | 404);
    } else {
      // For project/plan/risk/comment entity types, preserve the existing logic.
      const sector = await loadVoiceNoteSector(db, note.entityType, note.entityId);
      if (["project", "plan"].includes(note.entityType) && sector === undefined) {
        return c.json({ error: "entity_not_found" }, 404);
      }
      const guard = assertSectorAllowed(user, sector ?? null);
      if (!guard.ok) return c.json(guard.body, guard.status as 403);
    }

    // Return a URL pointing to our stream proxy endpoint
    return c.json({ url: `/api/voice-notes/${id}/stream` });
  } finally {
    close();
  }
});

// DELETE /voice-notes/:id
// requirePerm ensures the caller is authenticated; the ownership check below is fail-closed.
voiceNotesRoutes.delete("/voice-notes/:id", requirePerm("reports.update"), async (c) => {
  const user = c.get("currentUser");
  const { db, close } = openDb(c);
  try {
    const id = Number(c.req.param("id"));
    const result = await db.query<VoiceNoteRow>(`SELECT ${VOICE_NOTE_COLUMNS} FROM voice_notes WHERE id = $1`, [id]);
    const note = result.rows[0];
    if (!note) return c.json({ error: "Not found" }, 404);

    // Fail closed: requirePerm should already gate unauthenticated requests, but
    // add an explicit 401 guard so this route is safe even if middleware is bypassed.
    if (!user) {
      return c.json({ error: "unauthorized" }, 401);
    }
    if (note.recordedById !== user.id && user.role !== "super_admin") {
      return c.json({ error: "Forbidden" }, 403);
    }

    // For report-entity voice notes, block deletion if the report is not a draft
    if (note.entityType === "report") {
      const reportCheck = await db.query<{ status: string }>(`SELECT status FROM reports WHERE id = $1`, [note.entityId]);
      if (reportCheck.rows.length > 0 && reportCheck.rows[0].status !== "draft") {
        return c.json({ error: "cannot_delete_voice_note_of_submitted_report" }, 409);
      }
    }

    // Storage-first: delete the storage object before removing the DB row.
    // Cross-table ownership check: only delete storage if the objectPath is NOT
    // also referenced in report_attachments (prevents destroying another record's
    // underlying object when a legacy client registered the same path as a voice note).
    const objectPath = note.objectPath;
    if (objectPath) {
      const storageSafe = await isStorageDeleteSafeForRecord(db, objectPath, "voice_notes");
      if (storageSafe) {
        try {
          await deleteObjectSafely(c.env, objectPath);
        } catch {
          console.error(`[ATT-05] voice_note_delete storage_error id=${id} entityType=${note.entityType} entityId=${note.entityId}`);
          return c.json({ error: "voice_note_storage_delete_failed" }, 500);
        }
      } else {
        console.warn(`[ATT-05] voice_note_delete skipping storage delete — objectPath cross-referenced in report_attachments id=${id}`);
      }
    }

    await db.query(`DELETE FROM voice_notes WHERE id = $1`, [id]);

    await logAudit(db, {
      userId: user?.id ?? null,
      action: "voice_note_deleted",
      module: note.entityType,
      entityId: note.entityId,
      oldValue: JSON.stringify({ id: note.id }),
    });

    return c.body(null, 204);
  } finally {
    close();
  }
});
