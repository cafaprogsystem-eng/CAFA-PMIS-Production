import { Router } from "express";
import { createHash, randomUUID } from "node:crypto";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { pool } from "@workspace/db";
import { logAudit, requirePerm } from "../middlewares/currentUser";
import { ObjectStorageService } from "../lib/objectStorage";

/**
 * This router is deliberately separate from user file workflows. It is an
 * administrator-operated, evidence-first bridge for records copied into
 * legacy_storage_records during the storage cutover. The legacy client is
 * constructed only inside an import request, so normal startup never reads
 * nor requires historical provider credentials.
 */
const router = Router();
const objectStorage = new ObjectStorageService();
const IMPORT_ROLES = new Set(["super_admin", "executive_director"]);
type HistoricalDestination = { parentType: "plan" | "risk"; parentId: number };
type HistoricalRecordMapping = {
  module: string | null;
  recordId: number | null;
  projectId: number | null;
};

function normaliseMime(value: string | null | undefined): string {
  return String(value ?? "").split(";")[0].trim().toLowerCase();
}

function isOperator(req: { currentUser?: { role: string } }) {
  return Boolean(req.currentUser && IMPORT_ROLES.has(req.currentUser.role));
}

/**
 * Historical storage cannot be reassigned by an operator. The destination is
 * derived exclusively from the source record copied at cutover. Only the
 * legacy plan/risk modules have a safe, canonical attachment destination;
 * other historical modules remain evidence for owner reconciliation.
 */
function destinationForLegacyRecord(record: HistoricalRecordMapping): HistoricalDestination | null {
  if (!Number.isInteger(record.recordId)) return null;
  if (record.module === "plans") return { parentType: "plan", parentId: record.recordId! };
  if (record.module === "risks") return { parentType: "risk", parentId: record.recordId! };
  return null;
}

function startLeaseHeartbeat(operationId: string, runId: string): () => void {
  const timer = setInterval(() => {
    void pool.query(
      `UPDATE historical_storage_import_attempts
       SET lease_expires_at = NOW() + INTERVAL '15 minutes'
       WHERE operation_id = $1 AND run_id = $2 AND status = 'running'`,
      [operationId, runId],
    ).catch(() => undefined);
  }, 60_000);
  timer.unref();
  return () => clearInterval(timer);
}

function legacyClient(): { client: S3Client; bucket: string } | null {
  const bucket = process.env.HISTORICAL_IMPORT_S3_BUCKET;
  if (!bucket) return null;
  return {
    bucket,
    client: new S3Client({
      region: process.env.HISTORICAL_IMPORT_S3_REGION || process.env.S3_REGION || "us-east-1",
      endpoint: process.env.HISTORICAL_IMPORT_S3_ENDPOINT_URL,
      forcePathStyle: Boolean(process.env.HISTORICAL_IMPORT_S3_ENDPOINT_URL),
      credentials: process.env.HISTORICAL_IMPORT_S3_ACCESS_KEY_ID && process.env.HISTORICAL_IMPORT_S3_SECRET_ACCESS_KEY
        ? {
          accessKeyId: process.env.HISTORICAL_IMPORT_S3_ACCESS_KEY_ID,
          secretAccessKey: process.env.HISTORICAL_IMPORT_S3_SECRET_ACCESS_KEY,
        }
        : undefined,
    }),
  };
}

async function asBuffer(body: unknown): Promise<Buffer> {
  if (!body || typeof (body as { transformToByteArray?: unknown }).transformToByteArray !== "function") {
    throw new Error("historical_source_body_missing");
  }
  const bytes = await (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
  return Buffer.from(bytes);
}

router.get("/storage-history/status", requirePerm("storage.admin"), async (req, res, next) => {
  try {
    if (!isOperator(req)) { res.status(403).json({ error: "forbidden" }); return; }
    const { rows } = await pool.query(
      `SELECT status, COUNT(*)::int AS count
       FROM historical_storage_import_attempts GROUP BY status ORDER BY status`,
    );
    const records = await pool.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE canonical_object_path IS NOT NULL)::int AS imported,
              COUNT(*) FILTER (WHERE availability_status = 'unavailable')::int AS unavailable
       FROM legacy_storage_records`,
    );
    res.json({
      configured: Boolean(legacyClient()),
      records: records.rows[0] ?? { total: 0, imported: 0, unavailable: 0 },
      attempts: rows,
    });
  } catch (error) { next(error); }
});

router.post("/storage-history/import", requirePerm("storage.admin"), async (req, res, next) => {
  try {
    if (!isOperator(req)) { res.status(403).json({ error: "forbidden" }); return; }
    const legacyRecordId = Number(req.body?.legacyRecordId);
    if (!Number.isInteger(legacyRecordId)) {
      res.status(422).json({ error: "invalid_import_request" }); return;
    }

    const client = await pool.connect();
    let operationId = `historical-storage:${legacyRecordId}:unmapped`;
    let uploadedObjectPath: string | null = null;
    let runId: string | null = null;
    let stopLeaseHeartbeat: (() => void) | null = null;
    try {
      await client.query("BEGIN");
      const record = await client.query<{
        id: number; provider_key: string | null; file_name: string; content_type: string | null;
        file_size: number | null; availability_status: string; canonical_object_path: string | null;
        module: string | null; record_id: number | null; project_id: number | null;
      }>(
        `SELECT id, provider_key, file_name, content_type, file_size, availability_status, canonical_object_path,
                module, record_id, project_id
         FROM legacy_storage_records WHERE id = $1 FOR UPDATE`,
        [legacyRecordId],
      );
      const row = record.rows[0];
      const mappedDestination = row && destinationForLegacyRecord({
        module: row.module,
        recordId: row.record_id,
        projectId: row.project_id,
      });
      if (!row || !mappedDestination) {
        if (row) {
          await client.query(
            `UPDATE legacy_storage_records
             SET availability_status='unavailable', reconciliation_note='unsupported_historical_destination', updated_at=NOW()
             WHERE id=$1`,
            [legacyRecordId],
          );
          await client.query("COMMIT");
        } else {
          await client.query("ROLLBACK");
        }
        res.status(409).json({ error: "reconciliation_required" }); return;
      }
      const { parentType, parentId } = mappedDestination;
      operationId = `historical-storage:${legacyRecordId}:${parentType}:${parentId}`;
      const parentTable = parentType === "plan" ? "plans" : "risks";
      const parent = await client.query<{ id: number; projectId: number | null }>(
        `SELECT id, project_id AS "projectId" FROM ${parentTable} WHERE id = $1 FOR UPDATE`,
        [parentId],
      );
      if (!parent.rows.length) {
        await client.query("ROLLBACK");
        res.status(422).json({ error: "destination_parent_missing" }); return;
      }
      if (row.project_id != null && Number(parent.rows[0].projectId) !== Number(row.project_id)) {
        await client.query(
          `UPDATE legacy_storage_records
           SET availability_status='unavailable', reconciliation_note='source_destination_mismatch', updated_at=NOW()
           WHERE id=$1`,
          [legacyRecordId],
        );
        await client.query("COMMIT");
        res.status(409).json({ error: "reconciliation_required" }); return;
      }
      const previous = await client.query<{
        status: string; attachment_id: number | null; destination_object_path: string | null;
      }>(
        `SELECT status, attachment_id, destination_object_path
         FROM historical_storage_import_attempts
         WHERE legacy_record_id = $1 AND parent_type = $2 AND parent_id = $3 FOR UPDATE`,
        [legacyRecordId, parentType, parentId],
      );
      if (previous.rows[0]?.status === "imported") {
        await client.query("COMMIT");
        res.json({ status: "already_imported", attachmentId: previous.rows[0].attachment_id });
        return;
      }
      if (previous.rows[0]?.status === "running") {
        const recovered = await client.query(
          `UPDATE historical_storage_import_attempts
           SET status='failed', error_code='stale_attempt_recovered', completed_at=NOW()
           WHERE legacy_record_id=$1 AND parent_type=$2 AND parent_id=$3
             AND status='running'
             AND (lease_expires_at IS NULL OR lease_expires_at <= NOW())
           RETURNING id`,
          [legacyRecordId, parentType, parentId],
        );
        if (!recovered.rows.length) {
          await client.query("COMMIT");
          res.status(409).json({ error: "import_in_progress" }); return;
        }
      }
      // Historical records are intentionally unavailable in normal runtime.
      // Availability is therefore not import eligibility: the explicit
      // administrator action re-verifies source bytes and metadata below.
      if (!row.provider_key || row.canonical_object_path) {
        await client.query("ROLLBACK");
        res.status(409).json({ error: "reconciliation_required" }); return;
      }
      runId = randomUUID();
      await client.query(
        `INSERT INTO historical_storage_import_runs (id, requested_by)
         VALUES ($1, $2)`,
        [runId, req.currentUser!.id],
      );
      await client.query(
        `INSERT INTO historical_storage_import_attempts
          (run_id, legacy_record_id, parent_type, parent_id, operation_id, status, lease_expires_at)
          VALUES ($1,$2,$3,$4,$5,'running', NOW() + INTERVAL '15 minutes')
         ON CONFLICT (legacy_record_id, parent_type, parent_id)
          DO UPDATE SET run_id = EXCLUDED.run_id, status = 'running',
            error_code = NULL, completed_at = NULL, lease_expires_at = EXCLUDED.lease_expires_at`,
        [runId, legacyRecordId, parentType, parentId, operationId],
      );
      await client.query("COMMIT");

      // Construct historical-provider clients only after the record and its
      // canonical destination have passed the binding checks above.
      const source = legacyClient();
      if (!source) {
        await pool.query(
          `UPDATE historical_storage_import_attempts SET status='failed', error_code='historical_import_not_configured', completed_at=NOW()
           WHERE operation_id=$1 AND run_id=$2 AND status='running'`,
          [operationId, runId],
        );
        res.status(503).json({ error: "historical_import_not_configured" }); return;
      }
      stopLeaseHeartbeat = startLeaseHeartbeat(operationId, runId);
      const downloaded = await source.client.send(new GetObjectCommand({ Bucket: source.bucket, Key: row.provider_key }));
      const bytes = await asBuffer(downloaded.Body);
      const actualMime = downloaded.ContentType ?? row.content_type ?? "application/octet-stream";
      if ((row.file_size != null && Number(row.file_size) !== bytes.length)
        || (row.content_type && downloaded.ContentType && normaliseMime(row.content_type) !== normaliseMime(downloaded.ContentType))) {
        await client.query("BEGIN");
        const mismatchSource = await client.query<{ id: number; canonicalObjectPath: string | null }>(
          `SELECT id, canonical_object_path AS "canonicalObjectPath"
           FROM legacy_storage_records WHERE id=$1 FOR UPDATE`,
          [legacyRecordId],
        );
        if (!mismatchSource.rows.length || mismatchSource.rows[0].canonicalObjectPath) {
          await client.query("ROLLBACK");
          res.status(409).json({ error: "import_in_progress" }); return;
        }
        const mismatch = await client.query(
          `UPDATE historical_storage_import_attempts
           SET status='reconciliation_required', source_evidence=$1::jsonb, error_code='metadata_mismatch', completed_at=NOW()
            WHERE operation_id=$2 AND run_id=$3 AND status='running'
            RETURNING id`,
          [JSON.stringify({ expectedSize: row.file_size, actualSize: bytes.length, expectedMime: row.content_type, actualMime: downloaded.ContentType }), operationId, runId],
        );
        if (!mismatch.rows.length) {
          await client.query("ROLLBACK");
          res.status(409).json({ error: "import_in_progress" }); return;
        }
        const legacyMismatch = await client.query(
          `UPDATE legacy_storage_records
           SET availability_status='unavailable', reconciliation_note='import_metadata_mismatch', updated_at=NOW()
           WHERE id=$1 AND canonical_object_path IS NULL
           RETURNING id`,
          [legacyRecordId],
        );
        if (!legacyMismatch.rows.length) {
          await client.query("ROLLBACK");
          res.status(409).json({ error: "import_in_progress" }); return;
        }
        await client.query("COMMIT");
        res.status(409).json({ error: "metadata_mismatch" }); return;
      }
      const fingerprint = createHash("sha256").update(bytes).digest("hex");
      // Each lease owner receives a private temporary identity. That makes a
      // lost-lease cleanup safe: a retry cannot have claimed the same object.
      const uploadObjectId = `${operationId}:${runId}`.replace(/[^A-Za-z0-9:_-]/g, "_");
      const objectPath = await objectStorage.uploadBuffer(
        bytes, row.file_name, actualMime, "historical-import", uploadObjectId,
      );
      uploadedObjectPath = objectPath;
      const destinationMetadata = await objectStorage.getObjectEntityMetadata(objectPath);
      if (destinationMetadata.size !== bytes.length || normaliseMime(destinationMetadata.contentType) !== normaliseMime(actualMime)) {
        throw new Error("destination_verification_failed");
      }

      const final = await pool.connect();
      try {
        await final.query("BEGIN");
        // Every importer transaction locks in this order: source evidence,
        // canonical parent, then import attempt. This prevents a duplicate
        // request from deadlocking a terminal import.
        const finalSource = await final.query<{ id: number; canonicalObjectPath: string | null }>(
          `SELECT id, canonical_object_path AS "canonicalObjectPath"
           FROM legacy_storage_records WHERE id=$1 FOR UPDATE`,
          [legacyRecordId],
        );
        if (!finalSource.rows.length || finalSource.rows[0].canonicalObjectPath) {
          await final.query("ROLLBACK");
          await objectStorage.deleteObject(uploadedObjectPath).catch(() => undefined);
          uploadedObjectPath = null;
          res.status(409).json({ error: "import_in_progress" });
          return;
        }
        const finalParent = await final.query<{ id: number; projectId: number | null }>(
          `SELECT id, project_id AS "projectId" FROM ${parentTable} WHERE id = $1 FOR UPDATE`,
          [parentId],
        );
        if (!finalParent.rows.length || (
          row.project_id != null && Number(finalParent.rows[0].projectId) !== Number(row.project_id)
        )) {
          await final.query(
            `UPDATE historical_storage_import_attempts
             SET status='reconciliation_required', error_code='destination_parent_changed', completed_at=NOW()
             WHERE operation_id=$1 AND run_id=$2 AND status='running'`,
            [operationId, runId],
          );
          await final.query("COMMIT");
          await objectStorage.deleteObject(uploadedObjectPath).catch(() => undefined);
          uploadedObjectPath = null;
          res.status(409).json({ error: "reconciliation_required" });
          return;
        }
        // Only the request that still owns the renewable import lease may
        // finalize the deterministic operation. This prevents a stale worker
        // from completing after a retry has reclaimed the attempt.
        const claim = await final.query(
          `UPDATE historical_storage_import_attempts
           SET lease_expires_at = NOW() + INTERVAL '15 minutes'
           WHERE operation_id = $1 AND run_id = $2
             AND status = 'running' AND lease_expires_at > NOW()
           RETURNING id`,
          [operationId, runId],
        );
        if (!claim.rows.length) {
          await final.query("ROLLBACK");
          await objectStorage.deleteObject(uploadedObjectPath).catch(() => undefined);
          uploadedObjectPath = null;
          res.status(409).json({ error: "import_in_progress" });
          return;
        }
        const inserted = await final.query<{ id: number }>(
          `INSERT INTO attachments
             (parent_type, parent_id, file_name, content_type, size, object_path, provider, upload_operation_id, uploaded_by_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (upload_operation_id) DO UPDATE SET object_path = attachments.object_path
           RETURNING id`,
          [parentType, parentId, row.file_name, actualMime, bytes.length, objectPath, "historical_import", operationId, req.currentUser!.id],
        );
        await final.query(
          `UPDATE historical_storage_import_attempts
           SET status='imported', attachment_id=$1, destination_object_path=$2,
                source_evidence=$3::jsonb, completed_at=NOW(), lease_expires_at=NULL
            WHERE operation_id=$4 AND run_id=$5`,
           [inserted.rows[0].id, objectPath, JSON.stringify({ sha256: fingerprint, size: bytes.length, mimeType: actualMime }), operationId, runId],
        );
        await final.query(
          `UPDATE legacy_storage_records
           SET canonical_object_path=$1, imported_at=NOW(), availability_status='unavailable',
               reconciliation_note='migrated_to_canonical_storage', updated_at=NOW()
            WHERE id=$2 AND canonical_object_path IS NULL`,
          [objectPath, legacyRecordId],
        );
        await final.query(`UPDATE historical_storage_import_runs SET status='completed', completed_at=NOW() WHERE id=(SELECT run_id FROM historical_storage_import_attempts WHERE operation_id=$1)`, [operationId]);
        await final.query("COMMIT");
         uploadedObjectPath = null;
        // The import transaction is already committed. Audit persistence must
        // never turn a completed, idempotent import into a failed attempt.
        await logAudit({
          userId: req.currentUser!.id,
          action: "historical_storage_imported",
          module: "storage",
          entityId: inserted.rows[0].id,
        }).catch(() => undefined);
        res.status(201).json({ status: "imported", attachmentId: inserted.rows[0].id });
      } catch (error) {
        await final.query("ROLLBACK").catch(() => undefined);
         if (uploadedObjectPath) await objectStorage.deleteObject(uploadedObjectPath).catch(() => undefined);
        throw error;
      } finally { final.release(); }
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      await pool.query(
        `UPDATE historical_storage_import_attempts SET status='failed', error_code='import_failed', completed_at=NOW()
         WHERE operation_id=$1 AND run_id=$2 AND status='running'`,
        [operationId, runId],
      ).catch(() => undefined);
      throw error;
    } finally {
      stopLeaseHeartbeat?.();
      client.release();
    }
  } catch (error) { next(error); }
});

export default router;