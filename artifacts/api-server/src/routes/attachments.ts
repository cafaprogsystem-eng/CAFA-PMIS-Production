import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { pool } from "@workspace/db";
import {
  ObjectNotFoundError,
  ObjectStorageService,
  activeProvider,
  deleteStorageObjectSafely,
  isStorageConfigured,
} from "../lib/objectStorage";
import { hasPerm, logAudit, permissionsFor, assertSectorAllowed } from "../middlewares/currentUser";
import { assertAnySectorAllowed, assertPlanStateAllowed, isPlanCurrentlyEditable } from "./plans";
import { signUploadToken, UploadTokenError, verifyUploadToken } from "../lib/uploadToken";
import { realtime } from "../lib/realtime";
import { MAX_ATTACHMENT_BYTES } from "../lib/attachmentLimits";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();
const UPLOAD_TTL_MS = 15 * 60 * 1000;
const ALLOWED_CONTENT_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/zip",
  "application/x-zip-compressed",
]);
const SAFE_NAME_RE = /[/\\\u0000-\u001f\u007f]/;

type ParentType = "plan" | "risk";
type DbExecutor = {
  query: <T = Record<string, unknown>>(text: string, values?: unknown[]) => Promise<{ rows: T[] }>;
};
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
    value.trim().length <= 255 && !SAFE_NAME_RE.test(value);
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
  req: Request,
  parentType: ParentType,
  parentId: unknown,
  mutation = false,
  client: DbExecutor = pool,
): Promise<GuardResult> {
  if (badId(parentId)) {
    return { ok: false, status: 404, body: { error: `${parentType}_not_found` } };
  }
  const id = Number(parentId);
  let parent: Parent | undefined;
  if (parentType === "plan") {
    const planPermissions = permissionsFor(req.currentUser!);
    if (!mutation && !hasPerm(planPermissions, "plans.view") &&
        !hasPerm(planPermissions, "plans.update") && !hasPerm(planPermissions, "plans.create")) {
      return { ok: false, status: 403, body: { error: "forbidden", requiredPermission: "plans.view" } };
    }
    const result = await client.query<{
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
       WHERE pl.id = $1${client === pool ? "" : " FOR UPDATE"}`,
      [id],
    );
    const row = result.rows[0];
    if (!row) return { ok: false, status: 404, body: { error: "plan_not_found" } };
    parent = {
      parentType, parentId: id, stateId: row.stateId, locationType: row.locationType,
      sectors: normaliseSectors(row.sectors, row.sector), status: row.status,
      lastFinalApprovedAt: row.lastFinalApprovedAt, createdById: row.createdById,
    };
    const sectorGuard = assertAnySectorAllowed(req, parent.sectors);
    if (!sectorGuard.ok) return sectorGuard;
    const stateGuard = assertPlanStateAllowed(req, parent.stateId, parent.locationType);
    if (!stateGuard.ok) return stateGuard;
    if (mutation) {
      const canUpdate = hasPerm(permissionsFor(req.currentUser!), "plans.update") ||
        (hasPerm(permissionsFor(req.currentUser!), "plans.create") && parent.createdById === req.currentUser?.id);
      if (!canUpdate) {
        return { ok: false, status: 403, body: { error: "forbidden", requiredPermission: "plans.update" } };
      }
      // Reuse the Plan approval-lock authority rather than duplicating its
      // status/reopen rules in the attachment module.
      if (!(await isPlanCurrentlyEditable(id, parent.status, parent.lastFinalApprovedAt))) {
        return { ok: false, status: 409, body: { error: "plan_locked" } };
      }
    }
  } else {
    const riskPermissions = permissionsFor(req.currentUser!);
    if (!mutation && !hasPerm(riskPermissions, "risks.view") &&
        !hasPerm(riskPermissions, "risks.view.state") &&
        !hasPerm(riskPermissions, "risks.update") && !hasPerm(riskPermissions, "risks.create")) {
      return { ok: false, status: 403, body: { error: "forbidden", requiredPermission: "risks.view" } };
    }
    const result = await client.query<{
      stateId: number | null;
      projectId: number | null;
      sector: string | null;
      status: string;
    }>(
      `SELECT r.state_id AS "stateId", r.project_id AS "projectId", p.sector, r.status
       FROM risks r LEFT JOIN projects p ON p.id = r.project_id AND p.deleted_at IS NULL
       WHERE r.id = $1${client === pool ? "" : " FOR UPDATE"}`,
      [id],
    );
    const row = result.rows[0];
    if (!row) return { ok: false, status: 404, body: { error: "risk_not_found" } };
    parent = {
      parentType, parentId: id, stateId: row.stateId, locationType: row.stateId == null ? "hq" : "state",
      sectors: row.sector ? [row.sector] : [], status: row.status,
      lastFinalApprovedAt: null, createdById: null,
    };
    const sectorGuard = assertSectorAllowed(req, row.sector);
    if (!sectorGuard.ok) return sectorGuard;
    const isStateRole = req.currentUser?.role === "state_program_officer" ||
      req.currentUser?.role === "state_office_manager";
    if (isStateRole && (req.currentUser?.stateId == null || req.currentUser.stateId !== row.stateId)) {
      return { ok: false, status: 403, body: { error: "state_forbidden" } };
    }
    if (mutation && !hasPerm(permissionsFor(req.currentUser!), "risks.update")) {
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

async function getAttachment(id: number, client: DbExecutor = pool): Promise<AttachmentRow | undefined> {
  const result = await client.query<AttachmentRow>(
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

function descriptorError(res: Response, error: string, status = 400) {
  res.status(status).json({ error });
}

// Keep cleanup durable even when finalisation discovers invalid uploaded
// metadata. The scheduled worker owns provider deletion and retries; this
// transaction records both possible object identities first.
async function enqueueFailedUploadCleanup(
  client: DbExecutor,
  operationId: string,
  objectPath: string,
  finalObjectPath: string,
): Promise<void> {
  await client.query(
    `UPDATE attachment_upload_operations
     SET status = 'failed',
         cleanup_status = 'pending',
         cleanup_error = NULL,
         cleanup_completed_at = NULL
     WHERE operation_id = $1
       AND status = 'pending'`,
    [operationId],
  );
  await client.query(
    `INSERT INTO attachment_upload_cleanup_jobs
       (operation_id, object_path, final_object_path)
     VALUES ($1, $2, $3)
     ON CONFLICT (operation_id) DO NOTHING`,
    [operationId, objectPath, finalObjectPath],
  );
}

// Request a short-lived descriptor. The operation row is durable and binds
// parent, user, filename, MIME, size, and the one-time finalisation identity.
router.post("/attachments/upload-descriptors", async (req, res, next) => {
  try {
    if (!req.currentUser) { descriptorError(res, "unauthorized", 401); return; }
    const body = req.body as Record<string, unknown>;
    const parentType = body.parentType === "plan" || body.parentType === "risk" ? body.parentType : null;
    const parentId = body.parentId;
    const replacementAttachmentId = body.replacementAttachmentId == null ? null : Number(body.replacementAttachmentId);
    const size = Number(body.size);
    const contentType = normaliseMime(body.contentType);
    if (Number.isSafeInteger(size) && size > MAX_ATTACHMENT_BYTES) {
      descriptorError(res, "file_too_large", 413);
      return;
    }
    if (!parentType || badId(parentId) || !validFileName(body.fileName) ||
        !Number.isSafeInteger(size) || size <= 0 || !ALLOWED_CONTENT_TYPES.has(contentType)) {
      descriptorError(res, "invalid_attachment_metadata", !ALLOWED_CONTENT_TYPES.has(contentType) ? 415 : 400);
      return;
    }
    const guard = await assertCanonicalParent(req, parentType, parentId, true);
    if (!guard.ok) { res.status(guard.status).json(guard.body); return; }
    if (replacementAttachmentId !== null) {
      if (!Number.isInteger(replacementAttachmentId) || replacementAttachmentId <= 0) {
        descriptorError(res, "invalid_replacement_attachment", 400);
        return;
      }
      const replacement = await getAttachment(replacementAttachmentId);
      if (!replacement || replacement.status !== "active" ||
          replacement.parentType !== parentType || replacement.parentId !== Number(parentId)) {
        descriptorError(res, "replacement_parent_mismatch", 409);
        return;
      }
    }
    if (!isStorageConfigured().configured) {
      res.status(503).json({ error: "storage_not_configured" });
      return;
    }
    const operationId = randomUUID();
    const expiresAt = new Date(Date.now() + UPLOAD_TTL_MS);
    const uploadURL = await objectStorage.getObjectEntityUploadURL(contentType);
    const objectPath = objectStorage.normalizeObjectEntityPath(uploadURL);
    if (!objectPath.startsWith("/objects/uploads/")) {
      throw new Error("storage_provider_returned_invalid_upload_path");
    }
    const token = signUploadToken({
      objectPath, userId: req.currentUser.id, reportId: 0, entityType: "attachment",
      scope: "documents", operationId, parentType, parentId: Number(parentId),
      fileName: body.fileName.trim(), contentType, maxSize: size,
      iat: Math.floor(Date.now() / 1000), exp: Math.floor(expiresAt.getTime() / 1000),
    });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Lock the parent before creating the operation. A concurrent permanent
      // delete therefore cannot leave a descriptor that can later be finalised.
      const locked = await assertCanonicalParent(req, parentType, parentId, true, client);
      if (!locked.ok) {
        await client.query("ROLLBACK");
        res.status(locked.status).json(locked.body);
        return;
      }
      await client.query(
        `INSERT INTO attachment_upload_operations
          (operation_id, parent_type, parent_id, replacement_attachment_id, user_id, object_path, file_name,
           content_type, declared_size, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [operationId, parentType, Number(parentId), replacementAttachmentId,
          req.currentUser.id, objectPath,
          body.fileName.trim(), contentType, size, expiresAt],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      await deleteStorageObjectSafely(objectPath).catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    res.status(201).json({ operationId, uploadURL, uploadToken: token, expiresAt });
  } catch (err) { next(err); }
});

router.post("/attachments/operations/:operationId/finalize", async (req, res, next) => {
  try {
    if (!req.currentUser) { descriptorError(res, "unauthorized", 401); return; }
    const operationId = String(req.params.operationId);
    if (!/^[0-9a-f-]{36}$/i.test(operationId)) { descriptorError(res, "operation_not_found", 404); return; }
    const rawToken = typeof req.body?.uploadToken === "string" ? req.body.uploadToken : "";
    let descriptor;
    try { descriptor = verifyUploadToken(rawToken); }
    catch (error) {
      if (error instanceof UploadTokenError) { descriptorError(res, "invalid_upload_descriptor", 400); return; }
      throw error;
    }
    if (descriptor.operationId !== operationId || descriptor.userId !== req.currentUser.id ||
        descriptor.entityType !== "attachment" || !descriptor.parentType ||
        descriptor.parentId == null) {
      descriptorError(res, "invalid_upload_descriptor", 400);
      return;
    }
    const opResult = await pool.query<{
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
    if (!op || op.userId !== req.currentUser.id || op.parentType !== descriptor.parentType ||
        op.parentId !== descriptor.parentId) {
      descriptorError(res, "operation_not_found", 404);
      return;
    }
    if (op.status !== "pending" && op.status !== "finalised") {
      descriptorError(res, "operation_not_replayable", 409);
      return;
    }
    if (op.status === "finalised" && op.attachmentId) {
      // A completed replay needs current read authority, but does not take a
      // child-operation lock and therefore cannot contend with parent delete.
      const replayGuard = await assertCanonicalParent(req, op.parentType, op.parentId);
      if (!replayGuard.ok) {
        res.status(replayGuard.status).json(replayGuard.body);
        return;
      }
      const existing = await getAttachment(op.attachmentId);
      if (existing) { res.json(publicAttachment(existing)); return; }
      descriptorError(res, "attachment_not_found", 404);
      return;
    }
    if (op.status === "pending") {
      if (new Date(op.expiresAt).getTime() <= Date.now()) { descriptorError(res, "upload_descriptor_expired", 400); return; }
      if (descriptor.objectPath !== op.objectPath || descriptor.contentType !== op.contentType ||
          descriptor.maxSize !== op.declaredSize) {
        descriptorError(res, "invalid_upload_descriptor", 400);
        return;
      }
    }
    const deterministicFinalPath = `/objects/files/${operationId}`;
    // Persist the cleanup identity before taking the parent lock or calling the
    // provider. If deletion wins this race it removes both identities; if
    // finalisation wins, deletion waits for the parent lock and sees the same
    // durable final path after commit.
    if (op.status === "pending") {
      await pool.query(
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
      const parent = await assertCanonicalParent(
        req, op.parentType, op.parentId, false, client,
      );
      if (!parent.ok) {
        await client.query("ROLLBACK");
        res.status(parent.status).json(parent.body);
        return;
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
      if (!current || current.userId !== req.currentUser.id ||
          current.parentType !== descriptor.parentType || current.parentId !== descriptor.parentId ||
          current.status === "failed") {
        await client.query("ROLLBACK");
        descriptorError(res, "operation_not_replayable", 409);
        return;
      }
      if (current.status === "finalised" && current.attachmentId) {
        await client.query("COMMIT");
        const existing = await getAttachment(current.attachmentId);
        if (existing) { res.json(publicAttachment(existing)); return; }
        descriptorError(res, "attachment_not_found", 404);
        return;
      }
      if (current.status !== "pending") {
        await client.query("ROLLBACK");
        descriptorError(res, "operation_not_replayable", 409);
        return;
      }
      // The locked operation is still pending, so enforce write authority only
      // now. If a concurrent finaliser completed it while we waited, the
      // read-authorised replay above remains idempotent even after a Plan lock
      // or permission change. The parent lock is re-entrant on this client.
      const mutableParent = await assertCanonicalParent(
        req, current.parentType, current.parentId, true, client,
      );
      if (!mutableParent.ok) {
        await client.query("ROLLBACK");
        res.status(mutableParent.status).json(mutableParent.body);
        return;
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
          descriptorError(res, "replacement_parent_mismatch", 409);
          return;
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
      let metadata = await objectStorage.getObjectEntityMetadata(current.objectPath).catch((error: unknown) => {
        if (error instanceof ObjectNotFoundError) return null;
        throw error;
      });
      let finalObjectPath = deterministicFinalPath;
      if (metadata) {
        if (metadata.size !== current.declaredSize ||
            normaliseMime(metadata.contentType) !== current.contentType) {
          await enqueueFailedUploadCleanup(
            client, operationId, current.objectPath, deterministicFinalPath,
          );
          await client.query("COMMIT");
          descriptorError(res, "uploaded_object_metadata_mismatch", 422);
          return;
        }
        // Deterministic promotion makes a retry safe if the process exits
        // after the provider copy but before this transaction commits.
        finalObjectPath = await objectStorage.finalizeObjectEntityUpload(
          current.objectPath, "files", operationId,
        );
      } else {
        // A prior promotion may have succeeded before an interrupted database
        // transaction. Verify the deterministic final object again before
        // allowing the durable operation to complete on retry.
        metadata = await objectStorage.getObjectEntityMetadata(deterministicFinalPath).catch((error: unknown) => {
          if (error instanceof ObjectNotFoundError) return null;
          throw error;
        });
        if (!metadata) {
          await client.query("ROLLBACK");
          descriptorError(res, "uploaded_object_not_found", 422);
          return;
        }
      }
      if (metadata.size !== current.declaredSize ||
          normaliseMime(metadata.contentType) !== current.contentType) {
        await enqueueFailedUploadCleanup(
          client, operationId, current.objectPath, deterministicFinalPath,
        );
        await client.query("COMMIT");
        descriptorError(res, "uploaded_object_metadata_mismatch", 422);
        return;
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
          metadata.size, finalObjectPath, activeProvider(), operationId,
          req.currentUser.id, versionNumber],
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
    const attachment = await getAttachment(attachmentId);
    await logAudit({ userId: req.currentUser.id, action: "attachment_uploaded", module: currentModule(op.parentType), entityId: attachmentId });
    await realtime.publishSupportingEvent({
      entityType: "attachment",
      entityId: attachmentId,
      action: "finalized",
    });
    res.status(201).json(publicAttachment(attachment!));
  } catch (err) { next(err); }
});

function currentModule(parentType: ParentType): string {
  return parentType === "plan" ? "plans" : "risks";
}

async function listForParent(req: Request, res: Response, parentType: ParentType, parentId: string, next: NextFunction) {
  const guard = await assertCanonicalParent(req, parentType, parentId);
  if (!guard.ok) { res.status(guard.status).json(guard.body); return; }
  const result = await pool.query<AttachmentRow>(
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
  res.json({ items: result.rows.map(publicAttachment) });
  void next;
}

router.get("/plans/:planId/attachments", (req, res, next) => {
  listForParent(req, res, "plan", req.params.planId as string, next).catch(next);
});
router.get("/risks/:riskId/attachments", (req, res, next) => {
  listForParent(req, res, "risk", req.params.riskId as string, next).catch(next);
});

async function streamAttachment(req: Request, res: Response, attachmentId: string, disposition: "inline" | "attachment") {
  const id = Number(attachmentId);
  if (!Number.isInteger(id) || id <= 0) { descriptorError(res, "attachment_not_found", 404); return; }
  const attachment = await getAttachment(id);
  if (!attachment || attachment.status === "deleted") { descriptorError(res, "attachment_not_found", 404); return; }
  const parentType = attachment.parentType as ParentType;
  const guard = await assertCanonicalParent(req, parentType, attachment.parentId);
  if (!guard.ok) { res.status(guard.status).json(guard.body); return; }
  if (attachment.availabilityStatus === "unavailable") {
    res.status(410).json({ error: "file_unavailable", message: "File Unavailable" });
    return;
  }
  try {
    const file = await objectStorage.getObjectEntityFile(String(attachment.objectPath));
    const response = await objectStorage.downloadObject(file);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.setHeader("Content-Disposition", `${disposition}; filename="${String(attachment.fileName).replace(/["\\\r\n]/g, "_")}"`);
    if (response.body) Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
    else res.end();
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(410).json({ error: "file_unavailable", message: "File Unavailable" });
      return;
    }
    throw error;
  }
}

router.get("/attachments/:attachmentId/download", async (req, res, next) => {
  try { await streamAttachment(req, res, req.params.attachmentId as string, "attachment"); }
  catch (err) { next(err); }
});
router.get("/attachments/:attachmentId/preview", async (req, res, next) => {
  try { await streamAttachment(req, res, req.params.attachmentId as string, "inline"); }
  catch (err) { next(err); }
});

async function setLifecycle(req: Request, res: Response, attachmentId: string, status: "archived" | "deleted") {
  const id = Number(attachmentId);
  if (!Number.isInteger(id) || id <= 0) { descriptorError(res, "attachment_not_found", 404); return; }
  const existing = await getAttachment(id);
  if (!existing) { descriptorError(res, "attachment_not_found", 404); return; }
  const guard = await assertCanonicalParent(req, existing.parentType as ParentType, existing.parentId, true);
  if (!guard.ok) { res.status(guard.status).json(guard.body); return; }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Parent → attachment is the canonical lock order. It avoids a deadlock
    // against finalisation, which locks the same parent before replacement.
    const parent = await assertCanonicalParent(req, existing.parentType as ParentType, existing.parentId, true, client);
    if (!parent.ok) {
      await client.query("ROLLBACK");
      res.status(parent.status).json(parent.body);
      return;
    }
    const locked = await client.query<AttachmentRow>(
      `SELECT id, parent_type AS "parentType", parent_id AS "parentId", object_path AS "objectPath",
              status FROM attachments WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (!locked.rows[0]) {
      await client.query("ROLLBACK");
      descriptorError(res, "attachment_not_found", 404);
      return;
    }
    if (locked.rows[0].parentType !== existing.parentType || locked.rows[0].parentId !== existing.parentId) {
      await client.query("ROLLBACK");
      descriptorError(res, "attachment_parent_mismatch", 409);
      return;
    }
    await client.query(`UPDATE attachments SET status = $1, updated_at = NOW() WHERE id = $2`, [status, id]);
    await client.query("COMMIT");
    await logAudit({ userId: req.currentUser!.id, action: `attachment_${status}`, module: currentModule(locked.rows[0].parentType as ParentType), entityId: id });
    await realtime.publishSupportingEvent({
      entityType: "attachment",
      entityId: id,
      action: status,
    });
    if (status === "deleted") await deleteStorageObjectSafely(String(locked.rows[0].objectPath)).catch(() => {});
    res.json({ ok: true, status });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

router.post("/attachments/:attachmentId/archive", async (req, res, next) => {
  try { await setLifecycle(req, res, req.params.attachmentId as string, "archived"); }
  catch (err) { next(err); }
});
router.delete("/attachments/:attachmentId", async (req, res, next) => {
  try { await setLifecycle(req, res, req.params.attachmentId as string, "deleted"); }
  catch (err) { next(err); }
});

export default router;