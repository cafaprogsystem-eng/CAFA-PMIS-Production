import { Hono, type Context } from "hono";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { Bindings, QueryExecutor } from "../lib/db";
import { openDb } from "../lib/db";
import {
  attachCurrentUser,
  requireAuth,
  logAudit,
  hasPerm,
  permissionsFor,
  assertSectorAllowed,
  type CurrentUser,
  type Variables,
} from "../lib/rbac";
import { assertAnySectorAllowed, assertPlanStateAllowed, isPlanCurrentlyEditable } from "./plans";
import {
  ObjectNotFoundError,
  getObjectEntityUploadURL,
  normalizeObjectEntityPath,
  getObjectEntityFile,
  downloadObject,
  getObjectEntityMetadata,
  finalizeObjectEntityUpload,
  deleteObjectSafely,
  isStorageConfigured,
} from "../lib/storage";
import { signUploadToken, verifyUploadToken, UploadTokenError } from "../lib/upload-token";
import { MAX_ATTACHMENT_BYTES } from "../lib/attachment-limits";
import { ALLOWED_ATTACHMENT_CONTENT_TYPES as ALLOWED_CONTENT_TYPES } from "../lib/attachment-content-types";
import { contentDispositionHeader } from "../lib/content-disposition";
import { hasUnsafeFileNameChar } from "../lib/safe-file-name";

/**
 * Ported from artifacts/api-server/src/routes/attachments.ts (683 lines) —
 * third file of the attachments group. This is the canonical, generic
 * Plan/Risk evidence-attachment system (table `attachments`, a durable
 * upload-operation state machine with row-level locking, replacement/
 * versioning, and a cleanup-job queue) — distinct from the legacy
 * `plan_attachments` table the Filing & Archive registry (routes/files.ts)
 * already reads.
 *
 * Dropped throughout (same reasoning as every prior file):
 * realtime.publishSupportingEvent.
 *
 * Adapted: the source's `assertCanonicalParent(req, ..., client = pool)`
 * detected whether it was called inside a transaction by comparing `client
 * === pool` (a module-level singleton) to decide whether to append `FOR
 * UPDATE`. Workers has no module-level pool — openDb(c) opens a fresh Pool
 * per request — so that identity trick doesn't translate; this port instead
 * takes an explicit `forUpdate` boolean, threaded by callers that pass a
 * transaction's PoolClient.
 *
 * `attachments.provider` is hardcoded to "s3" rather than ported from
 * activeProvider() — every real deployment (Workers and the still-running
 * Express stack alike) sets STORAGE_PROVIDER=s3, and R2 speaks the same
 * S3-compatible API, so this keeps the column's historical values consistent
 * across both stacks rather than introducing a new "r2" value future rows
 * would need to special-case.
 */

const UPLOAD_TTL_MS = 15 * 60 * 1000;

type ParentType = "plan" | "risk";
type Parent = {
  parentType: ParentType;
  parentId: number;
  stateId: number | null;
  locationType: string | null;
  sectors: string[];
  status: string;
  lastFinalApprovedAt: Date | string | null;
  createdById: number | null;
};
type AttachmentRow = Record<string, unknown>;
type GuardResult = { ok: true; parent: Parent } | { ok: false; status: number; body: object };

function badId(value: unknown): boolean {
  const id = Number(value);
  return !Number.isInteger(id) || id <= 0;
}

function normaliseMime(value: unknown): string {
  return String(value ?? "").split(";")[0].trim().toLowerCase();
}

function validFileName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 &&
    value.trim().length <= 255 && !hasUnsafeFileNameChar(value);
}

function normaliseSectors(value: unknown, fallback: string | null): string[] {
  const sectors = Array.isArray(value) ? value.map(String).filter(Boolean) : [];
  return sectors.length ? sectors : fallback ? [fallback] : [];
}

/**
 * Canonical parent guard. All scope is derived from Plan/Risk rows; caller
 * supplied state, sector, project, and visibility metadata are never trusted.
 */
async function assertCanonicalParent(
  db: QueryExecutor,
  user: CurrentUser | undefined,
  parentType: ParentType,
  parentId: unknown,
  mutation = false,
  forUpdate = false,
): Promise<GuardResult> {
  if (badId(parentId)) {
    return { ok: false, status: 404, body: { error: `${parentType}_not_found` } };
  }
  const id = Number(parentId);
  let parent: Parent;
  if (parentType === "plan") {
    const planPermissions = permissionsFor(user!);
    if (!mutation && !hasPerm(planPermissions, "plans.view") &&
        !hasPerm(planPermissions, "plans.update") && !hasPerm(planPermissions, "plans.create")) {
      return { ok: false, status: 403, body: { error: "forbidden", requiredPermission: "plans.view" } };
    }
    const result = await db.query<{
      stateId: number | null;
      locationType: string | null;
      sectors: unknown;
      sector: string | null;
      status: string;
      lastFinalApprovedAt: Date | string | null;
      createdById: number | null;
    }>(
      `SELECT pl.state_id AS "stateId",
              COALESCE(pl.location_type, CASE WHEN pl.state_id IS NOT NULL THEN 'state' ELSE NULL END) AS "locationType",
              pl.sectors, COALESCE(NULLIF(pl.sector, ''), p.sector) AS sector,
              pl.status, pl.last_final_approved_at AS "lastFinalApprovedAt",
              pl.created_by_id AS "createdById"
       FROM plans pl LEFT JOIN projects p ON p.id = pl.project_id
       WHERE pl.id = $1${forUpdate ? " FOR UPDATE OF pl" : ""}`,
      [id],
    );
    const row = result.rows[0];
    if (!row) return { ok: false, status: 404, body: { error: "plan_not_found" } };
    parent = {
      parentType, parentId: id, stateId: row.stateId, locationType: row.locationType,
      sectors: normaliseSectors(row.sectors, row.sector), status: row.status,
      lastFinalApprovedAt: row.lastFinalApprovedAt, createdById: row.createdById,
    };
    const sectorGuard = assertAnySectorAllowed(user, parent.sectors);
    if (!sectorGuard.ok) return sectorGuard;
    const stateGuard = assertPlanStateAllowed(user, parent.stateId, parent.locationType);
    if (!stateGuard.ok) return stateGuard;
    if (mutation) {
      const canUpdate = hasPerm(permissionsFor(user!), "plans.update") ||
        (hasPerm(permissionsFor(user!), "plans.create") && parent.createdById === user?.id);
      if (!canUpdate) {
        return { ok: false, status: 403, body: { error: "forbidden", requiredPermission: "plans.update" } };
      }
      // Reuse the Plan approval-lock authority rather than duplicating its
      // status/reopen rules in the attachment module.
      if (!(await isPlanCurrentlyEditable(db, id, parent.status, parent.lastFinalApprovedAt))) {
        return { ok: false, status: 409, body: { error: "plan_locked" } };
      }
    }
  } else {
    const riskPermissions = permissionsFor(user!);
    if (!mutation && !hasPerm(riskPermissions, "risks.view") &&
        !hasPerm(riskPermissions, "risks.view.state") &&
        !hasPerm(riskPermissions, "risks.update") && !hasPerm(riskPermissions, "risks.create")) {
      return { ok: false, status: 403, body: { error: "forbidden", requiredPermission: "risks.view" } };
    }
    const result = await db.query<{
      stateId: number | null;
      projectId: number | null;
      sector: string | null;
      status: string;
    }>(
      `SELECT r.state_id AS "stateId", r.project_id AS "projectId", p.sector, r.status
       FROM risks r LEFT JOIN projects p ON p.id = r.project_id AND p.deleted_at IS NULL
       WHERE r.id = $1${forUpdate ? " FOR UPDATE OF r" : ""}`,
      [id],
    );
    const row = result.rows[0];
    if (!row) return { ok: false, status: 404, body: { error: "risk_not_found" } };
    parent = {
      parentType, parentId: id, stateId: row.stateId, locationType: row.stateId == null ? "hq" : "state",
      sectors: row.sector ? [row.sector] : [], status: row.status,
      lastFinalApprovedAt: null, createdById: null,
    };
    const sectorGuard = assertSectorAllowed(user, row.sector);
    if (!sectorGuard.ok) return sectorGuard;
    const isStateRole = user?.role === "state_program_officer" || user?.role === "state_office_manager";
    if (isStateRole && (user?.stateId == null || user.stateId !== row.stateId)) {
      return { ok: false, status: 403, body: { error: "state_forbidden" } };
    }
    if (mutation && !hasPerm(permissionsFor(user!), "risks.update")) {
      return { ok: false, status: 403, body: { error: "forbidden", requiredPermission: "risks.update" } };
    }
  }
  return { ok: true, parent };
}

function publicAttachment(row: AttachmentRow): Record<string, unknown> {
  return {
    id: row.id,
    parentType: row.parentType,
    parentId: row.parentId,
    fileName: row.fileName,
    contentType: row.contentType,
    size: row.size,
    status: row.status,
    availabilityStatus: row.availabilityStatus,
    versionNumber: row.versionNumber,
    uploadedAt: row.uploadedAt,
    uploadedByName: row.uploadedByName ?? null,
  };
}

async function getAttachment(db: QueryExecutor, id: number): Promise<AttachmentRow | undefined> {
  const result = await db.query<AttachmentRow>(
    `SELECT a.id, a.parent_type AS "parentType", a.parent_id AS "parentId",
            a.file_name AS "fileName", a.content_type AS "contentType", a.size,
            a.object_path AS "objectPath", a.provider, a.upload_operation_id AS "uploadOperationId",
            a.uploaded_by_id AS "uploadedById", a.version_number AS "versionNumber",
            a.status, a.availability_status AS "availabilityStatus",
            a.unavailable_reason AS "unavailableReason", a.created_at AS "uploadedAt",
            u.name AS "uploadedByName"
     FROM attachments a LEFT JOIN users u ON u.id = a.uploaded_by_id
     WHERE a.id = $1`,
    [id],
  );
  return result.rows[0];
}

// Keep cleanup durable even when finalisation discovers invalid uploaded
// metadata. The scheduled worker owns provider deletion and retries; this
// transaction records both possible object identities first.
async function enqueueFailedUploadCleanup(
  db: QueryExecutor,
  operationId: string,
  objectPath: string,
  finalObjectPath: string,
): Promise<void> {
  await db.query(
    `UPDATE attachment_upload_operations
     SET status = 'failed',
         cleanup_status = 'pending',
         cleanup_error = NULL,
         cleanup_completed_at = NULL
     WHERE operation_id = $1
       AND status = 'pending'`,
    [operationId],
  );
  await db.query(
    `INSERT INTO attachment_upload_cleanup_jobs
       (operation_id, object_path, final_object_path)
     VALUES ($1, $2, $3)
     ON CONFLICT (operation_id) DO NOTHING`,
    [operationId, objectPath, finalObjectPath],
  );
}

function currentModule(parentType: ParentType): string {
  return parentType === "plan" ? "plans" : "risks";
}

export const attachmentsRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

attachmentsRoutes.use("/attachments/*", attachCurrentUser, requireAuth);
attachmentsRoutes.use("/plans/:planId/attachments", attachCurrentUser, requireAuth);
attachmentsRoutes.use("/risks/:riskId/attachments", attachCurrentUser, requireAuth);

// Request a short-lived descriptor. The operation row is durable and binds
// parent, user, filename, MIME, size, and the one-time finalisation identity.
attachmentsRoutes.post("/attachments/upload-descriptors", async (c) => {
  const user = c.get("currentUser")!;
  const { db, pool, close } = openDb(c);
  try {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const parentType = body.parentType === "plan" || body.parentType === "risk" ? body.parentType : null;
    const parentId = body.parentId;
    const replacementAttachmentId = body.replacementAttachmentId == null ? null : Number(body.replacementAttachmentId);
    const size = Number(body.size);
    const contentType = normaliseMime(body.contentType);
    if (Number.isSafeInteger(size) && size > MAX_ATTACHMENT_BYTES) {
      return c.json({ error: "file_too_large" }, 413);
    }
    if (!parentType || badId(parentId) || !validFileName(body.fileName) ||
        !Number.isSafeInteger(size) || size <= 0 || !ALLOWED_CONTENT_TYPES.has(contentType)) {
      return c.json({ error: "invalid_attachment_metadata" }, !ALLOWED_CONTENT_TYPES.has(contentType) ? 415 : 400);
    }
    const guard = await assertCanonicalParent(db, user, parentType, parentId, true);
    if (!guard.ok) return c.json(guard.body, guard.status as 403 | 404 | 409);
    if (replacementAttachmentId !== null) {
      if (!Number.isInteger(replacementAttachmentId) || replacementAttachmentId <= 0) {
        return c.json({ error: "invalid_replacement_attachment" }, 400);
      }
      const replacement = await getAttachment(db, replacementAttachmentId);
      if (!replacement || replacement.status !== "active" ||
          replacement.parentType !== parentType || replacement.parentId !== Number(parentId)) {
        return c.json({ error: "replacement_parent_mismatch" }, 409);
      }
    }
    if (!isStorageConfigured(c.env).configured) {
      return c.json({ error: "storage_not_configured" }, 503);
    }
    const operationId = randomUUID();
    const expiresAt = new Date(Date.now() + UPLOAD_TTL_MS);
    const uploadURL = await getObjectEntityUploadURL(c.env, contentType);
    const objectPath = normalizeObjectEntityPath(c.env, uploadURL);
    if (!objectPath.startsWith("/objects/uploads/")) {
      throw new Error("storage_provider_returned_invalid_upload_path");
    }
    const fileName = (body.fileName as string).trim();
    const token = signUploadToken({
      objectPath, userId: user.id, reportId: 0, entityType: "attachment",
      scope: "documents", operationId, parentType, parentId: Number(parentId),
      fileName, contentType, maxSize: size,
      iat: Math.floor(Date.now() / 1000), exp: Math.floor(expiresAt.getTime() / 1000),
    }, c.env.SESSION_SECRET);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Lock the parent before creating the operation. A concurrent permanent
      // delete therefore cannot leave a descriptor that can later be finalised.
      const locked = await assertCanonicalParent(client, user, parentType, parentId, true, true);
      if (!locked.ok) {
        await client.query("ROLLBACK");
        return c.json(locked.body, locked.status as 403 | 404 | 409);
      }
      await client.query(
        `INSERT INTO attachment_upload_operations
          (operation_id, parent_type, parent_id, replacement_attachment_id, user_id, object_path, file_name,
           content_type, declared_size, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [operationId, parentType, Number(parentId), replacementAttachmentId,
          user.id, objectPath, fileName, contentType, size, expiresAt],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      await deleteObjectSafely(c.env, objectPath).catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    return c.json({ operationId, uploadURL, uploadToken: token, expiresAt }, 201);
  } finally {
    close();
  }
});

attachmentsRoutes.post("/attachments/operations/:operationId/finalize", async (c) => {
  const user = c.get("currentUser")!;
  const { db, pool, close } = openDb(c);
  try {
    const operationId = c.req.param("operationId");
    if (!/^[0-9a-f-]{36}$/i.test(operationId)) return c.json({ error: "operation_not_found" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const rawToken = typeof body.uploadToken === "string" ? body.uploadToken : "";
    let descriptor;
    try {
      descriptor = verifyUploadToken(rawToken, c.env.SESSION_SECRET);
    } catch (error) {
      if (error instanceof UploadTokenError) return c.json({ error: "invalid_upload_descriptor" }, 400);
      throw error;
    }
    if (descriptor.operationId !== operationId || descriptor.userId !== user.id ||
        descriptor.entityType !== "attachment" || !descriptor.parentType ||
        descriptor.parentId == null) {
      return c.json({ error: "invalid_upload_descriptor" }, 400);
    }
    const opResult = await db.query<{
      operationId: string; parentType: ParentType; parentId: number; userId: number;
      objectPath: string; fileName: string; contentType: string; declaredSize: number;
      expiresAt: Date | string; status: string; attachmentId: number | null;
      replacementAttachmentId: number | null;
    }>(
      `SELECT operation_id AS "operationId", parent_type AS "parentType", parent_id AS "parentId",
              user_id AS "userId", object_path AS "objectPath", file_name AS "fileName",
              content_type AS "contentType", declared_size AS "declaredSize",
              expires_at AS "expiresAt", status, attachment_id AS "attachmentId",
              replacement_attachment_id AS "replacementAttachmentId"
       FROM attachment_upload_operations WHERE operation_id = $1`,
      [operationId],
    );
    const op = opResult.rows[0];
    if (!op || op.userId !== user.id || op.parentType !== descriptor.parentType ||
        op.parentId !== descriptor.parentId) {
      return c.json({ error: "operation_not_found" }, 404);
    }
    if (op.status !== "pending" && op.status !== "finalised") {
      return c.json({ error: "operation_not_replayable" }, 409);
    }
    if (op.status === "finalised" && op.attachmentId) {
      // A completed replay needs current read authority, but does not take a
      // child-operation lock and therefore cannot contend with parent delete.
      const replayGuard = await assertCanonicalParent(db, user, op.parentType, op.parentId);
      if (!replayGuard.ok) return c.json(replayGuard.body, replayGuard.status as 403 | 404 | 409);
      const existing = await getAttachment(db, op.attachmentId);
      if (existing) return c.json(publicAttachment(existing));
      return c.json({ error: "attachment_not_found" }, 404);
    }
    if (op.status === "pending") {
      if (new Date(op.expiresAt).getTime() <= Date.now()) return c.json({ error: "upload_descriptor_expired" }, 400);
      if (descriptor.objectPath !== op.objectPath || descriptor.contentType !== op.contentType ||
          descriptor.maxSize !== op.declaredSize) {
        return c.json({ error: "invalid_upload_descriptor" }, 400);
      }
    }
    const deterministicFinalPath = `/objects/files/${operationId}`;
    // Persist the cleanup identity before taking the parent lock or calling the
    // provider. If deletion wins this race it removes both identities; if
    // finalisation wins, deletion waits for the parent lock and sees the same
    // durable final path after commit.
    if (op.status === "pending") {
      await db.query(
        `UPDATE attachment_upload_operations
         SET final_object_path = $1
         WHERE operation_id = $2 AND status = 'pending'`,
        [deterministicFinalPath, operationId],
      );
    }

    const client = await pool.connect();
    let attachmentId: number;
    try {
      await client.query("BEGIN");
      // Lock in the global parent → child order. Parent deletion uses this
      // same order before deleting pending operations, so it cannot form a
      // cycle with finalisation.
      const parent = await assertCanonicalParent(client, user, op.parentType, op.parentId, false, true);
      if (!parent.ok) {
        await client.query("ROLLBACK");
        return c.json(parent.body, parent.status as 403 | 404 | 409);
      }
      const lockedOp = await client.query<typeof op>(
        `SELECT operation_id AS "operationId", parent_type AS "parentType", parent_id AS "parentId",
                user_id AS "userId", object_path AS "objectPath", file_name AS "fileName",
                content_type AS "contentType", declared_size AS "declaredSize",
                expires_at AS "expiresAt", status, attachment_id AS "attachmentId",
                replacement_attachment_id AS "replacementAttachmentId"
         FROM attachment_upload_operations WHERE operation_id = $1 FOR UPDATE`,
        [operationId],
      );
      const current = lockedOp.rows[0];
      if (!current || current.userId !== user.id ||
          current.parentType !== descriptor.parentType || current.parentId !== descriptor.parentId ||
          current.status === "failed") {
        await client.query("ROLLBACK");
        return c.json({ error: "operation_not_replayable" }, 409);
      }
      if (current.status === "finalised" && current.attachmentId) {
        await client.query("COMMIT");
        const existing = await getAttachment(db, current.attachmentId);
        if (existing) return c.json(publicAttachment(existing));
        return c.json({ error: "attachment_not_found" }, 404);
      }
      if (current.status !== "pending") {
        await client.query("ROLLBACK");
        return c.json({ error: "operation_not_replayable" }, 409);
      }
      // The locked operation is still pending, so enforce write authority only
      // now. If a concurrent finaliser completed it while we waited, the
      // read-authorised replay above remains idempotent even after a Plan lock
      // or permission change. The parent lock is re-entrant on this client.
      const mutableParent = await assertCanonicalParent(client, user, current.parentType, current.parentId, true, true);
      if (!mutableParent.ok) {
        await client.query("ROLLBACK");
        return c.json(mutableParent.body, mutableParent.status as 403 | 404 | 409);
      }
      let versionNumber = 1;
      let replacementAttachmentToArchive: number | null = null;
      // Lock and verify replacement before irreversible provider promotion.
      // The order is always parent → attachment, matching lifecycle changes.
      if (current.replacementAttachmentId) {
        const previous = await client.query<AttachmentRow>(
          `SELECT id, parent_type AS "parentType", parent_id AS "parentId", version_number AS "versionNumber"
           FROM attachments WHERE id = $1 AND status = 'active' FOR UPDATE`,
          [current.replacementAttachmentId],
        );
        const old = previous.rows[0];
        if (!old || old.parentType !== current.parentType || old.parentId !== current.parentId) {
          await client.query("ROLLBACK");
          return c.json({ error: "replacement_parent_mismatch" }, 409);
        }
        versionNumber = Number(old.versionNumber) + 1;
        replacementAttachmentToArchive = Number(old.id);
      } else {
        const latest = await client.query<{ versionNumber: number }>(
          `SELECT COALESCE(MAX(version_number), 0) AS "versionNumber"
           FROM attachments WHERE parent_type = $1 AND parent_id = $2`,
          [current.parentType, current.parentId],
        );
        versionNumber = Number(latest.rows[0]?.versionNumber ?? 0) + 1;
      }
      // The parent remains FOR UPDATE while the storage object is verified,
      // promoted, and registered. Parent deletion therefore cannot land in
      // between provider promotion and metadata registration.
      let metadata = await getObjectEntityMetadata(c.env, current.objectPath).catch((error: unknown) => {
        if (error instanceof ObjectNotFoundError) return null;
        throw error;
      });
      let finalObjectPath = deterministicFinalPath;
      if (metadata) {
        if (metadata.size !== current.declaredSize ||
            normaliseMime(metadata.contentType) !== current.contentType) {
          await enqueueFailedUploadCleanup(client, operationId, current.objectPath, deterministicFinalPath);
          await client.query("COMMIT");
          return c.json({ error: "uploaded_object_metadata_mismatch" }, 422);
        }
        // Deterministic promotion makes a retry safe if the process exits
        // after the provider copy but before this transaction commits.
        finalObjectPath = await finalizeObjectEntityUpload(c.env, current.objectPath, "files", operationId);
      } else {
        // A prior promotion may have succeeded before an interrupted database
        // transaction. Verify the deterministic final object again before
        // allowing the durable operation to complete on retry.
        metadata = await getObjectEntityMetadata(c.env, deterministicFinalPath).catch((error: unknown) => {
          if (error instanceof ObjectNotFoundError) return null;
          throw error;
        });
        if (!metadata) {
          await client.query("ROLLBACK");
          return c.json({ error: "uploaded_object_not_found" }, 422);
        }
      }
      if (metadata.size !== current.declaredSize ||
          normaliseMime(metadata.contentType) !== current.contentType) {
        await enqueueFailedUploadCleanup(client, operationId, current.objectPath, deterministicFinalPath);
        await client.query("COMMIT");
        return c.json({ error: "uploaded_object_metadata_mismatch" }, 422);
      }
      if (replacementAttachmentToArchive !== null) {
        await client.query(`UPDATE attachments SET status = 'archived', updated_at = NOW() WHERE id = $1`, [replacementAttachmentToArchive]);
      }
      const inserted = await client.query<{ id: number }>(
        `INSERT INTO attachments
          (parent_type, parent_id, file_name, content_type, size, object_path, provider,
           upload_operation_id, uploaded_by_id, version_number)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING id`,
        [current.parentType, current.parentId, current.fileName, current.contentType,
          metadata.size, finalObjectPath, "s3", operationId, user.id, versionNumber],
      );
      attachmentId = inserted.rows[0].id;
      await client.query(
        `UPDATE attachment_upload_operations
         SET status = 'finalised', attachment_id = $1, finalised_at = NOW()
         WHERE operation_id = $2`,
        [attachmentId, operationId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    const attachment = await getAttachment(db, attachmentId);
    await logAudit(db, { userId: user.id, action: "attachment_uploaded", module: currentModule(op.parentType), entityId: attachmentId });
    return c.json(publicAttachment(attachment!), 201);
  } finally {
    close();
  }
});

async function listForParent(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  db: QueryExecutor,
  user: CurrentUser | undefined,
  parentType: ParentType,
  parentId: string,
): Promise<Response> {
  const guard = await assertCanonicalParent(db, user, parentType, parentId);
  if (!guard.ok) return c.json(guard.body, guard.status as 403 | 404 | 409);
  const result = await db.query<AttachmentRow>(
    `SELECT a.id, a.parent_type AS "parentType", a.parent_id AS "parentId",
            a.file_name AS "fileName", a.content_type AS "contentType", a.size,
            a.status, a.availability_status AS "availabilityStatus",
            a.version_number AS "versionNumber", a.created_at AS "uploadedAt",
            u.name AS "uploadedByName"
     FROM attachments a LEFT JOIN users u ON u.id = a.uploaded_by_id
     WHERE a.parent_type = $1 AND a.parent_id = $2 AND a.status <> 'deleted'
     ORDER BY a.version_number DESC, a.created_at DESC, a.id DESC`,
    [parentType, Number(parentId)],
  );
  return c.json({ items: result.rows.map(publicAttachment) });
}

attachmentsRoutes.get("/plans/:planId/attachments", async (c) => {
  const user = c.get("currentUser");
  const { db, close } = openDb(c);
  try {
    return await listForParent(c, db, user, "plan", c.req.param("planId"));
  } finally {
    close();
  }
});
attachmentsRoutes.get("/risks/:riskId/attachments", async (c) => {
  const user = c.get("currentUser");
  const { db, close } = openDb(c);
  try {
    return await listForParent(c, db, user, "risk", c.req.param("riskId"));
  } finally {
    close();
  }
});

async function streamAttachment(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  db: QueryExecutor,
  user: CurrentUser | undefined,
  attachmentId: string,
  disposition: "inline" | "attachment",
): Promise<Response> {
  const id = Number(attachmentId);
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: "attachment_not_found" }, 404);
  const attachment = await getAttachment(db, id);
  if (!attachment || attachment.status === "deleted") return c.json({ error: "attachment_not_found" }, 404);
  const parentType = attachment.parentType as ParentType;
  const guard = await assertCanonicalParent(db, user, parentType, attachment.parentId);
  if (!guard.ok) return c.json(guard.body, guard.status as 403 | 404 | 409);
  if (attachment.availabilityStatus === "unavailable") {
    return c.json({ error: "file_unavailable", message: "File Unavailable" }, 410);
  }
  try {
    const file = await getObjectEntityFile(c.env, String(attachment.objectPath));
    const response = await downloadObject(c.env, file);
    const headers = new Headers(response.headers);
    headers.set("Content-Disposition", contentDispositionHeader(String(attachment.fileName), disposition));
    return new Response(response.body, { status: response.status, headers });
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      return c.json({ error: "file_unavailable", message: "File Unavailable" }, 410);
    }
    throw error;
  }
}

attachmentsRoutes.get("/attachments/:attachmentId/download", async (c) => {
  const user = c.get("currentUser");
  const { db, close } = openDb(c);
  try {
    return await streamAttachment(c, db, user, c.req.param("attachmentId"), "attachment");
  } finally {
    close();
  }
});
attachmentsRoutes.get("/attachments/:attachmentId/preview", async (c) => {
  const user = c.get("currentUser");
  const { db, close } = openDb(c);
  try {
    return await streamAttachment(c, db, user, c.req.param("attachmentId"), "inline");
  } finally {
    close();
  }
});

async function setLifecycle(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  db: QueryExecutor,
  pool: Pool,
  user: CurrentUser,
  attachmentId: string,
  status: "archived" | "deleted",
): Promise<Response> {
  const id = Number(attachmentId);
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: "attachment_not_found" }, 404);
  const existing = await getAttachment(db, id);
  if (!existing) return c.json({ error: "attachment_not_found" }, 404);
  const guard = await assertCanonicalParent(db, user, existing.parentType as ParentType, existing.parentId, true);
  if (!guard.ok) return c.json(guard.body, guard.status as 403 | 404 | 409);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Parent → attachment is the canonical lock order. It avoids a deadlock
    // against finalisation, which locks the same parent before replacement.
    const parent = await assertCanonicalParent(client, user, existing.parentType as ParentType, existing.parentId, true, true);
    if (!parent.ok) {
      await client.query("ROLLBACK");
      return c.json(parent.body, parent.status as 403 | 404 | 409);
    }
    const locked = await client.query<AttachmentRow>(
      `SELECT id, parent_type AS "parentType", parent_id AS "parentId", object_path AS "objectPath",
              status FROM attachments WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (!locked.rows[0]) {
      await client.query("ROLLBACK");
      return c.json({ error: "attachment_not_found" }, 404);
    }
    if (locked.rows[0].parentType !== existing.parentType || locked.rows[0].parentId !== existing.parentId) {
      await client.query("ROLLBACK");
      return c.json({ error: "attachment_parent_mismatch" }, 409);
    }
    await client.query(`UPDATE attachments SET status = $1, updated_at = NOW() WHERE id = $2`, [status, id]);
    await client.query("COMMIT");
    await logAudit(db, { userId: user.id, action: `attachment_${status}`, module: currentModule(locked.rows[0].parentType as ParentType), entityId: id });
    if (status === "deleted") await deleteObjectSafely(c.env, String(locked.rows[0].objectPath)).catch(() => {});
    return c.json({ ok: true, status });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

attachmentsRoutes.post("/attachments/:attachmentId/archive", async (c) => {
  const user = c.get("currentUser")!;
  const { db, pool, close } = openDb(c);
  try {
    return await setLifecycle(c, db, pool, user, c.req.param("attachmentId"), "archived");
  } finally {
    close();
  }
});
attachmentsRoutes.delete("/attachments/:attachmentId", async (c) => {
  const user = c.get("currentUser")!;
  const { db, pool, close } = openDb(c);
  try {
    return await setLifecycle(c, db, pool, user, c.req.param("attachmentId"), "deleted");
  } finally {
    close();
  }
});
