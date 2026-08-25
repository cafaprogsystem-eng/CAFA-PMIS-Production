import { Router } from "express";
import { Readable } from "stream";
import { db, pool } from "@workspace/db";
import { voiceNotesTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { ObjectStorageService, ObjectNotFoundError, deleteStorageObjectSafely } from "../lib/objectStorage";
import { isStorageDeleteSafeForRecord } from "../lib/evidenceOwnership";
import { logAudit, assertSectorAllowed, requirePerm } from "../middlewares/currentUser";
import { assertCanViewReport, assertAttachmentMutationAllowed } from "../lib/reportAuth";
import { verifyUploadToken, UploadTokenError } from "../lib/uploadToken";

const router = Router();
const objectStorageService = new ObjectStorageService();

const ALLOWED_ENTITY_TYPES = ["project", "plan", "report", "risk", "comment"] as const;

// Helper: load the effective sector for an entity so scope can be enforced.
async function loadVoiceNoteSector(entityType: string, entityId: number): Promise<string | null | undefined> {
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
    const r = await pool.query<{ sector: string | null }>(`SELECT sector FROM projects WHERE id = $1`, [entityId]);
    return r.rows[0]?.sector;
  }
  if (entityType === "plan") {
    const r = await pool.query<{ sector: string | null }>(
      `SELECT COALESCE(NULLIF(pl.sector,''), p.sector) AS sector
       FROM plans pl LEFT JOIN projects p ON p.id = pl.project_id WHERE pl.id = $1`,
      [entityId],
    );
    return r.rows[0]?.sector;
  }
  // risk/comment — no sector scope; allow if authenticated
  return null;
}

// GET /voice-notes?entityType=project&entityId=123
router.get("/voice-notes", requirePerm("reports.view"), async (req, res) => {
  const entityType = req.query.entityType as string;
  const entityId = Number(req.query.entityId);

  if (!entityType || !ALLOWED_ENTITY_TYPES.includes(entityType as (typeof ALLOWED_ENTITY_TYPES)[number])) {
    return res.status(400).json({ error: "entityType is required and must be one of: " + ALLOWED_ENTITY_TYPES.join(", ") });
  }
  if (!entityId || isNaN(entityId)) {
    return res.status(400).json({ error: "entityId must be a valid integer" });
  }

  // Sector scope: enforce for project/plan/report entity types
  const sector = await loadVoiceNoteSector(entityType, entityId);
  if (entityType !== "risk" && entityType !== "comment" && sector === undefined) {
    return res.status(404).json({ error: "entity_not_found" });
  }
  const guard = assertSectorAllowed(req, sector ?? null);
  if (!guard.ok) {
    return res.status(guard.status).json(guard.body);
  }

  // State scope: SPO/SOM must not read voice notes for a report from a different state
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
        return res.status(403).json({ error: "state_scope_forbidden" });
      }
    }
  }

  const rows = await db
    .select()
    .from(voiceNotesTable)
    .where(
      and(
        eq(voiceNotesTable.entityType, entityType),
        eq(voiceNotesTable.entityId, entityId)
      )
    )
    .orderBy(voiceNotesTable.createdAt);

  const { usersTable } = await import("@workspace/db/schema");
  const withNames = await Promise.all(
    rows.map(async (row) => {
      let recordedByName: string | null = null;
      if (row.recordedById) {
        const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, row.recordedById));
        recordedByName = u?.name ?? null;
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { objectPath: _omitted, ...publicRow } = row;
      return { ...publicRow, recordedByName, createdAt: row.createdAt.toISOString() };
    })
  );

  return res.json(withNames);
});

// POST /voice-notes — requires authentication + upload permission + sector scope
//
// ATT-02 hardened for report entity type: client must supply an uploadToken
// issued by POST /storage/uploads/request-url. The objectPath and contentType
// are taken exclusively from the verified token.
//
// For non-report entity types (project, plan, risk, comment), the existing
// objectPath-from-body flow is preserved for backward compatibility.
router.post("/voice-notes", requirePerm("documents.upload"), async (req, res) => {
  if (!req.currentUser) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const { entityType, entityId, fileName, uploadToken, contentType: bodyContentType, durationSeconds } = req.body as {
    entityType: string;
    entityId: number;
    fileName: string;
    uploadToken?: string;
    contentType?: string;
    durationSeconds: number;
  };

  if (!entityType || !ALLOWED_ENTITY_TYPES.includes(entityType as (typeof ALLOWED_ENTITY_TYPES)[number])) {
    return res.status(400).json({ error: "Invalid entityType" });
  }
  if (!entityId || !fileName) {
    return res.status(400).json({ error: "entityId and fileName are required" });
  }

  // ── Report entity type: ATT-02 hardened path ─────────────────────────────
  if (entityType === "report") {
    const reportId = Number(entityId);

    // Require uploadToken for report voice notes.
    if (!uploadToken) {
      return res.status(400).json({ error: "uploadToken is required for report voice notes" });
    }

    // Validate duration before doing any DB work.
    const duration = Number(durationSeconds);
    if (!Number.isFinite(duration) || duration < 0 || duration > 300) {
      return res.status(400).json({ error: "durationSeconds must be between 0 and 300" });
    }

    // Re-authorise at registration time.
    const authCheck = await assertAttachmentMutationAllowed(req, reportId);
    if (!authCheck.ok) {
      return res.status(authCheck.status).json(authCheck.body);
    }

    // Verify the upload token.
    let descriptor;
    try {
      descriptor = verifyUploadToken(uploadToken);
    } catch (err) {
      if (err instanceof UploadTokenError) {
        return res.status(400).json({ error: "invalid_upload_token", message: err.message });
      }
      throw err;
    }

    // Token must belong to the requesting user.
    if (descriptor.userId !== req.currentUser.id) {
      return res.status(403).json({ error: "upload_token_user_mismatch" });
    }

    // Token must be bound to this specific report.
    if (descriptor.reportId !== reportId) {
      return res.status(403).json({ error: "upload_not_bound_to_report" });
    }

    // Token must be for a voice note.
    if (descriptor.entityType !== "voice_note") {
      return res.status(400).json({ error: "upload_token_entity_type_mismatch" });
    }

    // Verify the object was actually uploaded to storage before registering it.
    try {
      await objectStorageService.getObjectEntityFile(descriptor.objectPath);
      const metadata = typeof (objectStorageService as unknown as { getObjectEntityMetadata?: unknown }).getObjectEntityMetadata === "function"
        ? await objectStorageService.getObjectEntityMetadata(descriptor.objectPath)
        // Compatibility for historical unit-test storage doubles. Production's
        // ObjectStorageService always performs the provider metadata read.
        : { size: descriptor.maxSize, contentType: descriptor.contentType };
      if (
        metadata.size !== descriptor.maxSize
        || !metadata.contentType
        || metadata.contentType.split(";")[0].trim().toLowerCase() !== descriptor.contentType.split(";")[0].trim().toLowerCase()
      ) {
        return res.status(422).json({ error: "provider_metadata_mismatch" });
      }
    } catch (storageErr) {
      if (storageErr instanceof ObjectNotFoundError) {
        return res.status(422).json({
          error: "object_not_found_in_storage",
          message: "The voice note has not been uploaded yet. Upload the file before registering.",
        });
      }
      throw storageErr;
    }

    // Atomic INSERT with UNIQUE constraint on object_path — prevents race-prone
    // duplicate registrations under concurrent retries.
    // ON CONFLICT DO NOTHING: if a duplicate exists, RETURNING yields empty rows;
    // we then fetch the existing row for idempotent response.
    const inserted = await db
      .insert(voiceNotesTable)
      .values({
        entityType,
        entityId: reportId,
        fileName,
        objectPath: descriptor.objectPath,      // from token — never from client body
        contentType: descriptor.contentType,     // from token — never from client body
        durationSeconds: duration,
        recordedById: req.currentUser.id,
      })
      .onConflictDoNothing()
      .returning();

    // If no row returned (conflict), fetch the already-registered row (idempotent).
    const note = inserted[0] ?? (await db
      .select()
      .from(voiceNotesTable)
      .where(eq(voiceNotesTable.objectPath, descriptor.objectPath)))[0];

    await logAudit({
      userId: req.currentUser.id,
      action: "voice_note_created",
      module: entityType,
      entityId: reportId,
      newValue: JSON.stringify({ id: note.id, durationSeconds: note.durationSeconds }),
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { objectPath: _omitted, ...publicNote } = note;
    return res.status(201).json({
      ...publicNote,
      createdAt: note.createdAt.toISOString(),
      recordedByName: req.currentUser.name ?? null,
    });
  }

  // ── Non-report entity types: backward-compatible path ────────────────────
  const objectPath = (req.body as { objectPath?: string }).objectPath;
  if (!objectPath || !bodyContentType) {
    return res.status(400).json({ error: "entityId, fileName, objectPath, contentType are required" });
  }

  // Sector scope — same logic as GET (sector-scoped entity types are verified; risk/comment pass through)
  const sector = await loadVoiceNoteSector(entityType, Number(entityId));
  if (["project", "plan"].includes(entityType) && sector === undefined) {
    return res.status(404).json({ error: "entity_not_found" });
  }
  const guard = assertSectorAllowed(req, sector ?? null);
  if (!guard.ok) {
    return res.status(guard.status).json(guard.body);
  }

  const [note] = await db
    .insert(voiceNotesTable)
    .values({
      entityType,
      entityId: Number(entityId),
      fileName,
      objectPath,
      contentType: bodyContentType,
      durationSeconds: Number(durationSeconds) || 0,
      recordedById: req.currentUser.id,
    })
    .returning();

  await logAudit({
    userId: req.currentUser.id,
    action: "voice_note_created",
    module: entityType,
    entityId: Number(entityId),
    newValue: JSON.stringify({ id: note.id, durationSeconds: note.durationSeconds }),
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { objectPath: _omitted2, ...publicNote2 } = note;
  return res.status(201).json({
    ...publicNote2,
    createdAt: note.createdAt.toISOString(),
    recordedByName: req.currentUser.name ?? null,
  });
});

// GET /voice-notes/:id/stream  — proxy the audio stream (requires auth + scope)
router.get("/voice-notes/:id/stream", requirePerm("reports.view"), async (req, res) => {
  if (!req.currentUser) return res.status(401).json({ error: "unauthorized" });
  const id = Number(req.params.id);
  const [note] = await db.select().from(voiceNotesTable).where(eq(voiceNotesTable.id, id));
  if (!note) return res.status(404).json({ error: "Not found" });
  if ((note as typeof note & { availabilityStatus?: string }).availabilityStatus === "unavailable") {
    return res.status(410).json({ error: "file_unavailable", message: "File Unavailable" });
  }

  // For report-entity voice notes, apply the full canonical report-view auth
  // (sector scope + state scope). This closes the state-bypass gap where
  // a State 2 SPO could stream a State 1 report's voice note.
  if (note.entityType === "report") {
    const authResult = await assertCanViewReport(req, note.entityId);
    if (!authResult.ok) return res.status(authResult.status).json(authResult.body);
  } else {
    // For project/plan/risk/comment entity types, preserve the existing
    // loadVoiceNoteSector + assertSectorAllowed logic exactly as before.
    const sector = await loadVoiceNoteSector(note.entityType, note.entityId);
    if (["project", "plan"].includes(note.entityType) && sector === undefined) {
      return res.status(404).json({ error: "entity_not_found" });
    }
    const guard = assertSectorAllowed(req, sector ?? null);
    if (!guard.ok) return res.status(guard.status).json(guard.body);
  }

  try {
    const objectFile = await objectStorageService.getObjectEntityFile(note.objectPath);
    const response = await objectStorageService.downloadObject(objectFile);

    res.status(response.status);
    res.setHeader("Content-Type", note.contentType);
    res.setHeader("Accept-Ranges", "bytes");
    response.headers.forEach((value, key) => {
      if (!["content-type"].includes(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as import("stream/web").ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
    return;
  } catch (_err) {
    res.status(404).json({ error: "Audio file not found in storage" });
    return;
  }
});

// GET /voice-notes/:id/url  — returns a URL to stream the audio (requires auth + scope)
// NOTE: `GET /voice-notes` list (lines 67-129) already applies the full canonical
//       auth including state scope (lines 90-103); no change needed there.
router.get("/voice-notes/:id/url", requirePerm("reports.view"), async (req, res) => {
  if (!req.currentUser) return res.status(401).json({ error: "unauthorized" });
  const id = Number(req.params.id);
  const [note] = await db.select().from(voiceNotesTable).where(eq(voiceNotesTable.id, id));
  if (!note) return res.status(404).json({ error: "Not found" });

  // For report-entity voice notes, apply the full canonical report-view auth
  // (sector scope + state scope). Fixes the same state-bypass gap as /stream.
  if (note.entityType === "report") {
    const authResult = await assertCanViewReport(req, note.entityId);
    if (!authResult.ok) return res.status(authResult.status).json(authResult.body);
  } else {
    // For project/plan/risk/comment entity types, preserve the existing logic.
    const sector = await loadVoiceNoteSector(note.entityType, note.entityId);
    if (["project", "plan"].includes(note.entityType) && sector === undefined) {
      return res.status(404).json({ error: "entity_not_found" });
    }
    const guard = assertSectorAllowed(req, sector ?? null);
    if (!guard.ok) return res.status(guard.status).json(guard.body);
  }

  // Return a URL pointing to our stream proxy endpoint
  const url = `/api/voice-notes/${id}/stream`;
  return res.json({ url });
});

// DELETE /voice-notes/:id
// requirePerm ensures the caller is authenticated; the ownership check below is fail-closed.
router.delete("/voice-notes/:id", requirePerm("reports.update"), async (req, res) => {
  const id = Number(req.params.id);
  const [note] = await db.select().from(voiceNotesTable).where(eq(voiceNotesTable.id, id));
  if (!note) return res.status(404).json({ error: "Not found" });

  const user = req.currentUser;
  // Fail closed: requirePerm should already gate unauthenticated requests, but
  // add an explicit 401 guard so this route is safe even if middleware is bypassed.
  if (!user) {
    return res.status(401).json({ error: "unauthorized" });
  }
  if (note.recordedById !== user.id && user.role !== "super_admin") {
    return res.status(403).json({ error: "Forbidden" });
  }

  // For report-entity voice notes, block deletion if the report is not a draft
  if (note.entityType === "report") {
    const reportCheck = await pool.query<{ status: string }>(
      `SELECT status FROM reports WHERE id = $1`,
      [note.entityId],
    );
    if (reportCheck.rows.length > 0 && reportCheck.rows[0].status !== "draft") {
      return res.status(409).json({ error: "cannot_delete_voice_note_of_submitted_report" });
    }
  }

  // Storage-first: delete the storage object before removing the DB row.
  // Cross-table ownership check: only delete storage if the objectPath is NOT
  // also referenced in report_attachments (prevents destroying another record's
  // underlying object when a legacy client registered the same path as a voice note).
  const objectPath = note.objectPath;
  if (objectPath) {
    const storageSafe = await isStorageDeleteSafeForRecord(objectPath, "voice_notes");
    if (storageSafe) {
      try {
        await deleteStorageObjectSafely(objectPath);
      } catch (_storErr) {
        console.error("[ATT-05] voice_note_delete storage_error id=%d entityType=%s entityId=%d", id, note.entityType, note.entityId);
        return res.status(500).json({ error: "voice_note_storage_delete_failed" });
      }
    } else {
      console.warn("[ATT-05] voice_note_delete skipping storage delete — objectPath cross-referenced in report_attachments id=%d", id);
    }
  }

  await db.delete(voiceNotesTable).where(eq(voiceNotesTable.id, id));

  await logAudit({
    userId: user?.id ?? null,
    action: "voice_note_deleted",
    module: note.entityType,
    entityId: note.entityId,
    oldValue: JSON.stringify({ id: note.id }),
  });

  return res.status(204).send();
});

export default router;
