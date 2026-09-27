import { Hono } from "hono";
import { createHash, randomUUID } from "node:crypto";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import "../lib/aws-sdk-polyfills";
import type { Bindings, QueryExecutor } from "../lib/db";
import { openDb } from "../lib/db";
import { attachCurrentUser, requireAuth, requirePerm, logAudit, type CurrentUser, type Variables } from "../lib/rbac";
import { uploadBuffer, getObjectEntityMetadata, deleteObject } from "../lib/storage";

/**
 * Ported from artifacts/api-server/src/routes/historical-storage-import.ts
 * (398 lines) — seventh and final file of the attachments group. This router
 * is deliberately separate from every other file in this group: it is an
 * administrator-operated, evidence-first bridge for records copied into
 * legacy_storage_records during the storage cutover — genuinely historical
 * AWS S3 data, not R2. Unlike drive.ts, this one is real and mounted (checked
 * before porting, this time): confirmed live in api-server's routes/index.ts,
 * and drive-usage-guard.test.ts's own permitted-files list explicitly
 * excludes it from the dead-code guard as "the explicitly scoped
 * administrative importer".
 *
 * The historical *source* stays real AWS S3 (HISTORICAL_IMPORT_S3_* secrets,
 * unset until an administrator configures them — status/import both degrade
 * to "not configured" exactly like the source does when they're absent, so
 * no new infrastructure decision was needed to port this safely). Only the
 * *destination* is this worker's canonical object storage, i.e. R2 via
 * lib/storage.ts's uploadBuffer/getObjectEntityMetadata/deleteObject.
 *
 * startLeaseHeartbeat's setInterval is safe here (unlike the sweep dropped
 * from lib/attachment-reconciliation.ts): it lives entirely within one
 * request's handler and is cleared before that handler returns, never
 * spanning requests.
 */

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

function isOperator(user: CurrentUser | undefined): boolean {
  return Boolean(user && IMPORT_ROLES.has(user.role));
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

function startLeaseHeartbeat(db: QueryExecutor, operationId: string, runId: string): () => void {
  const timer = setInterval(() => {
    void db.query(
      `UPDATE historical_storage_import_attempts
       SET lease_expires_at = NOW() + INTERVAL '15 minutes'
       WHERE operation_id = $1 AND run_id = $2 AND status = 'running'`,
      [operationId, runId],
    ).catch(() => undefined);
  }, 60_000);
  return () => clearInterval(timer);
}

function legacyClient(env: Bindings): { client: S3Client; bucket: string } | null {
  const bucket = env.HISTORICAL_IMPORT_S3_BUCKET;
  if (!bucket) return null;
  return {
    bucket,
    client: new S3Client({
      region: env.HISTORICAL_IMPORT_S3_REGION || "us-east-1",
      endpoint: env.HISTORICAL_IMPORT_S3_ENDPOINT_URL,
      forcePathStyle: Boolean(env.HISTORICAL_IMPORT_S3_ENDPOINT_URL),
      credentials: env.HISTORICAL_IMPORT_S3_ACCESS_KEY_ID && env.HISTORICAL_IMPORT_S3_SECRET_ACCESS_KEY
        ? {
          accessKeyId: env.HISTORICAL_IMPORT_S3_ACCESS_KEY_ID,
          secretAccessKey: env.HISTORICAL_IMPORT_S3_SECRET_ACCESS_KEY,
        }
        : undefined,
    }),
  };
}

async function asBuffer(body: unknown): Promise<Uint8Array> {
  if (!body || typeof (body as { transformToByteArray?: unknown }).transformToByteArray !== "function") {
    throw new Error("historical_source_body_missing");
  }
  return (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
}

export const historicalStorageImportRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

historicalStorageImportRoutes.use("/storage-history/*", attachCurrentUser, requireAuth);

historicalStorageImportRoutes.get("/storage-history/status", requirePerm("storage.admin"), async (c) => {
  const user = c.get("currentUser");
  const { db, close } = openDb(c);
  try {
    if (!isOperator(user)) return c.json({ error: "forbidden" }, 403);
    const rows = await db.query<{ status: string; count: number }>(
      `SELECT status, COUNT(*)::int AS count
       FROM historical_storage_import_attempts GROUP BY status ORDER BY status`,
    );
    const records = await db.query<{ total: number; imported: number; unavailable: number }>(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE canonical_object_path IS NOT NULL)::int AS imported,
              COUNT(*) FILTER (WHERE availability_status = 'unavailable')::int AS unavailable
       FROM legacy_storage_records`,
    );
    return c.json({
      configured: Boolean(legacyClient(c.env)),
      records: records.rows[0] ?? { total: 0, imported: 0, unavailable: 0 },
      attempts: rows.rows,
    });
  } finally {
    close();
  }
});

historicalStorageImportRoutes.post("/storage-history/import", requirePerm("storage.admin"), async (c) => {
  const user = c.get("currentUser")!;
  const { db, pool, close } = openDb(c);
  try {
    if (!isOperator(user)) return c.json({ error: "forbidden" }, 403);
    const body = (await c.req.json().catch(() => ({}))) as { legacyRecordId?: unknown };
    const legacyRecordId = Number(body.legacyRecordId);
    if (!Number.isInteger(legacyRecordId)) {
      return c.json({ error: "invalid_import_request" }, 422);
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
        return c.json({ error: "reconciliation_required" }, 409);
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
        return c.json({ error: "destination_parent_missing" }, 422);
      }
      if (row.project_id != null && Number(parent.rows[0].projectId) !== Number(row.project_id)) {
        await client.query(
          `UPDATE legacy_storage_records
           SET availability_status='unavailable', reconciliation_note='source_destination_mismatch', updated_at=NOW()
           WHERE id=$1`,
          [legacyRecordId],
        );
        await client.query("COMMIT");
        return c.json({ error: "reconciliation_required" }, 409);
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
        return c.json({ status: "already_imported", attachmentId: previous.rows[0].attachment_id });
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
          return c.json({ error: "import_in_progress" }, 409);
        }
      }
      // Historical records are intentionally unavailable in normal runtime.
      // Availability is therefore not import eligibility: the explicit
      // administrator action re-verifies source bytes and metadata below.
      if (!row.provider_key || row.canonical_object_path) {
        await client.query("ROLLBACK");
        return c.json({ error: "reconciliation_required" }, 409);
      }
      runId = randomUUID();
      await client.query(
        `INSERT INTO historical_storage_import_runs (id, requested_by)
         VALUES ($1, $2)`,
        [runId, user.id],
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
      const source = legacyClient(c.env);
      if (!source) {
        await db.query(
          `UPDATE historical_storage_import_attempts SET status='failed', error_code='historical_import_not_configured', completed_at=NOW()
           WHERE operation_id=$1 AND run_id=$2 AND status='running'`,
          [operationId, runId],
        );
        return c.json({ error: "historical_import_not_configured" }, 503);
      }
      stopLeaseHeartbeat = startLeaseHeartbeat(db, operationId, runId);
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
          return c.json({ error: "import_in_progress" }, 409);
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
          return c.json({ error: "import_in_progress" }, 409);
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
          return c.json({ error: "import_in_progress" }, 409);
        }
        await client.query("COMMIT");
        return c.json({ error: "metadata_mismatch" }, 409);
      }
      const fingerprint = createHash("sha256").update(bytes).digest("hex");
      // Each lease owner receives a private temporary identity. That makes a
      // lost-lease cleanup safe: a retry cannot have claimed the same object.
      const uploadObjectId = `${operationId}:${runId}`.replace(/[^A-Za-z0-9:_-]/g, "_");
      const objectPath = await uploadBuffer(
        c.env, bytes, row.file_name, actualMime, "historical-import", uploadObjectId,
      );
      uploadedObjectPath = objectPath;
      const destinationMetadata = await getObjectEntityMetadata(c.env, objectPath);
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
          await deleteObject(c.env, uploadedObjectPath).catch(() => undefined);
          uploadedObjectPath = null;
          return c.json({ error: "import_in_progress" }, 409);
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
          await deleteObject(c.env, uploadedObjectPath).catch(() => undefined);
          uploadedObjectPath = null;
          return c.json({ error: "reconciliation_required" }, 409);
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
          await deleteObject(c.env, uploadedObjectPath).catch(() => undefined);
          uploadedObjectPath = null;
          return c.json({ error: "import_in_progress" }, 409);
        }
        const inserted = await final.query<{ id: number }>(
          `INSERT INTO attachments
             (parent_type, parent_id, file_name, content_type, size, object_path, provider, upload_operation_id, uploaded_by_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (upload_operation_id) DO UPDATE SET object_path = attachments.object_path
           RETURNING id`,
          [parentType, parentId, row.file_name, actualMime, bytes.length, objectPath, "historical_import", operationId, user.id],
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
        await logAudit(db, {
          userId: user.id,
          action: "historical_storage_imported",
          module: "storage",
          entityId: inserted.rows[0].id,
        }).catch(() => undefined);
        return c.json({ status: "imported", attachmentId: inserted.rows[0].id }, 201);
      } catch (error) {
        await final.query("ROLLBACK").catch(() => undefined);
        if (uploadedObjectPath) await deleteObject(c.env, uploadedObjectPath).catch(() => undefined);
        throw error;
      } finally {
        final.release();
      }
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      await db.query(
        `UPDATE historical_storage_import_attempts SET status='failed', error_code='import_failed', completed_at=NOW()
         WHERE operation_id=$1 AND run_id=$2 AND status='running'`,
        [operationId, runId],
      ).catch(() => undefined);
      throw error;
    } finally {
      stopLeaseHeartbeat?.();
      client.release();
    }
  } finally {
    close();
  }
});
