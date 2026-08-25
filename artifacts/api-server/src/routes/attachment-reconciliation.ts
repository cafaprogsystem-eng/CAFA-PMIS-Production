import { Router, type Request } from "express";
import { createHash } from "node:crypto";
import { pool } from "@workspace/db";
import { logAudit, requirePerm } from "../middlewares/currentUser";
import {
  RECONCILIATION_CLASSIFICATIONS,
  reconciliationPublicRow,
  runAttachmentReconciliationInventory,
} from "../lib/attachmentReconciliation";
import {
  buildStorageEvidenceInventory,
  migrationRecordClassification,
} from "../lib/storageEvidenceInventory";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { realtime } from "../lib/realtime";

const router = Router();
const objectStorage = new ObjectStorageService();
const OWNER_DISPOSITION_ROLES = new Set(["super_admin", "executive_director", "program_manager"]);
const SOURCE_TABLES: Record<string, string> = {
  resource: "program_resources",
  project_document: "project_documents",
  plan_attachment: "plan_attachments",
  report_attachment: "report_attachments",
  legacy_storage_record: "legacy_storage_records",
  voice_note: "voice_notes",
};

function isOwner(req: Request): boolean {
  return Boolean(req.currentUser && OWNER_DISPOSITION_ROLES.has(req.currentUser.role));
}

function cleanRationale(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const rationale = value.trim();
  return rationale.length >= 10 && rationale.length <= 2_000 ? rationale : null;
}

function validObjectPath(value: unknown): value is string {
  return typeof value === "string"
    && value.startsWith("/objects/")
    && value.length > "/objects/".length
    && !value.includes("..")
    && !value.includes("//");
}

async function setMessageUnavailable(client: { query: (...args: unknown[]) => Promise<unknown> }, messageId: number, metadataId: string) {
  const index = Number(metadataId.split(":")[1]);
  if (!Number.isInteger(index) || index < 0) return false;
  const current = await client.query(
    `SELECT attachments FROM messages WHERE id = $1 FOR UPDATE`,
    [messageId],
  ) as { rows: Array<{ attachments: unknown }> };
  const attachments = Array.isArray(current.rows[0]?.attachments)
    ? [...current.rows[0].attachments] as Array<Record<string, unknown>>
    : [];
  const item = attachments[index];
  if (!item || typeof item !== "object") return false;
  item.availabilityStatus = "unavailable";
  item.unavailableReason = "reconciliation_review_required";
  await client.query(`UPDATE messages SET attachments = $1::jsonb WHERE id = $2`, [
    JSON.stringify(attachments),
    messageId,
  ]);
  return true;
}

function publicRegisterRow(row: Record<string, unknown>) {
  return reconciliationPublicRow(row);
}

/**
 * Data-owner reconciliation matrix. This is deliberately separate from the
 * Filing & Archive registry: registry rows are discovery indexes, while these
 * rows are evidence and disposition history for unresolved metadata.
 */
router.get("/attachment-reconciliation", requirePerm("storage.admin"), async (req, res, next) => {
  try {
    if (req.query.refresh === "true") await runAttachmentReconciliationInventory();
    const params: unknown[] = [];
    const filters: string[] = [];
    if (typeof req.query.classification === "string" && RECONCILIATION_CLASSIFICATIONS.includes(req.query.classification as never)) {
      params.push(req.query.classification);
      filters.push(`classification = $${params.length}`);
    }
    if (typeof req.query.sourceKind === "string") {
      params.push(req.query.sourceKind);
      filters.push(`source_kind = $${params.length}`);
    }
    if (req.query.unresolved === "true") filters.push(`disposition IS NULL`);
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(500, Math.max(1, Number(req.query.pageSize) || 100));
    params.push(pageSize, (page - 1) * pageSize);
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const counted = await pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM attachment_reconciliation_entries ${where}`,
      params.slice(0, -2),
    );
    const listed = await pool.query(
      `SELECT id, metadata_id AS "metadataId", source_kind AS "sourceKind", source_id AS "sourceId",
              parent_type AS "parentType", parent_id AS "parentId", file_name AS "fileName",
              content_type AS "contentType", file_size AS "fileSize", uploaded_at AS "uploadedAt",
              lifecycle_state AS "lifecycleState", provider_reference AS "providerReference",
              parent_exists AS "parentExists", parent_removed AS "parentRemoved",
              object_resolution AS "objectResolution", object_evidence AS "objectEvidence",
              classification, reason, classified_at AS "classifiedAt",
              disposition, disposition_reason AS "dispositionReason",
              disposition_at AS "dispositionAt"
       FROM attachment_reconciliation_entries ${where}
       ORDER BY classified_at DESC, id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    res.json({
      items: listed.rows.map(publicRegisterRow),
      total: Number(counted.rows[0]?.total ?? 0),
      page,
      pageSize,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/attachment-reconciliation/report", requirePerm("storage.admin"), async (req, res, next) => {
  try {
    if (req.query.refresh === "true") await runAttachmentReconciliationInventory();
    const result = await pool.query<{
      total: string;
      classification: string;
      count: string;
      changes: string;
      intentionallyUnchanged: string;
    }>(
      `SELECT COUNT(*)::text AS total, classification, COUNT(*)::text AS count,
              COUNT(*) FILTER (WHERE disposition IS NOT NULL)::text AS changes,
              COUNT(*) FILTER (WHERE disposition IS NULL)::text AS "intentionallyUnchanged"
       FROM attachment_reconciliation_entries
       GROUP BY classification`,
    );
    const classifications = Object.fromEntries(RECONCILIATION_CLASSIFICATIONS.map((key) => [key, 0])) as Record<string, number>;
    let total = 0;
    let dispositioned = 0;
    for (const row of result.rows) {
      classifications[row.classification] = Number(row.count);
      total += Number(row.count);
      dispositioned += Number(row.changes);
    }
    const ownerActionRequired = classifications.OWNER_DECISION_REQUIRED
      + classifications.PROVIDER_MAPPING_STALE
      + classifications.OBJECT_CONFIRMED_MISSING
      + classifications.METADATA_ORPHANED
      + classifications.PARENT_REMOVED;
    res.json({
      totalRecords: total,
      classifications,
      safelyRecoveredRecords: classifications.OBJECT_RECOVERABLE,
      confirmedMissingObjects: classifications.OBJECT_CONFIRMED_MISSING,
      orphanMetadata: classifications.METADATA_ORPHANED,
      ownerDecisionRequired: ownerActionRequired,
      changes: dispositioned,
      intentionallyUnchanged: Math.max(0, total - dispositioned),
      preventionEvidence: {
        providerAuthoritativeValidation: true,
        serverControlledFinalisation: true,
        parentBoundAccessPreserved: true,
        filenameOnlyRecovery: false,
      },
      finalStatus: ownerActionRequired > 0 ? "MITIGATED — OWNER ACTION REQUIRED" : "CLOSED",
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Administrator-only migration baseline. The source/surface manifest is
 * deterministic and checked in; record counts are refreshed from canonical
 * attachment owners on request. Provider references are reduced to categories
 * and the reconciliation rows remain available through the separate matrix.
 */
router.get("/attachment-reconciliation/inventory", requirePerm("storage.admin"), async (req, res, next) => {
  try {
    const refreshed = req.query.refresh === "true";
    if (refreshed) await runAttachmentReconciliationInventory();

    const records = await pool.query<{
      classification: string;
      sourceKind: string;
      providerReference: string | null;
    }>(
      `SELECT classification, source_kind AS "sourceKind", provider_reference AS "providerReference"
       FROM attachment_reconciliation_entries`,
    );
    const migrationClassifications = [
      "migratable",
      "already_canonical",
      "missing",
      "orphaned",
      "parent_removed",
      "owner_decision_required",
    ] as const;
    const classificationCounts = Object.fromEntries(
      migrationClassifications.map((classification) => [classification, 0]),
    ) as Record<(typeof migrationClassifications)[number], number>;
    const bySourceKind: Record<string, Record<string, number>> = {};
    const byProvider: Record<string, number> = {
      historical_storage: 0,
      canonical_object_storage: 0,
      unresolved_provider: 0,
    };

    for (const record of records.rows) {
      const migrationClassification = migrationRecordClassification(
        record.classification,
        record.providerReference,
      );
      classificationCounts[migrationClassification]++;
      bySourceKind[record.sourceKind] ??= Object.fromEntries(
        migrationClassifications.map((classification) => [classification, 0]),
      );
      bySourceKind[record.sourceKind][migrationClassification]++;

      if (record.providerReference?.startsWith("historical:")) {
        byProvider.historical_storage++;
      } else if (record.providerReference) {
        byProvider.canonical_object_storage++;
      } else {
        byProvider.unresolved_provider++;
      }
    }

    const latest = await pool.query<{ generatedAt: string | null }>(
      `SELECT MAX(classified_at)::text AS "generatedAt" FROM attachment_reconciliation_entries`,
    );
    res.json({
      ...buildStorageEvidenceInventory(),
      generatedAt: new Date().toISOString(),
      refreshed,
      recordInventory: {
        total: records.rows.length,
        lastReconciliationAt: latest.rows[0]?.generatedAt ?? null,
        migrationClassifications: classificationCounts,
        bySourceKind,
        byProvider,
        ownerDecisionPath: {
          missing: "Keep metadata and File Unavailable status; an authorised owner must prove the exact replacement object before recovery.",
          orphaned: "Do not infer a parent; retain metadata for steward review and resolve the parent or record a documented disposition.",
          parentRemoved: "Treat the parent lifecycle as authoritative; retain evidence and obtain an owner decision before any metadata action.",
          ownerDecisionRequired: "Resolve conflicting or incomplete size/MIME/provider evidence with an authorised owner; never recover by filename.",
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post("/attachment-reconciliation/:id/disposition", requirePerm("storage.admin"), async (req, res, next) => {
  const client = await pool.connect();
  try {
    if (!isOwner(req)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const id = Number(req.params.id);
    const action = String(req.body?.action ?? "").toUpperCase();
    const rationale = cleanRationale(req.body?.rationale);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "invalid_reconciliation_id" });
      return;
    }
    if (!["KEEP_UNAVAILABLE", "ARCHIVE_METADATA", "REMOVE_METADATA"].includes(action)) {
      res.status(422).json({ error: "invalid_disposition" });
      return;
    }
    if (!rationale) {
      res.status(422).json({ error: "rationale_required", message: "Provide a rationale of at least 10 characters." });
      return;
    }

    await client.query("BEGIN");
    const entry = await client.query<{
      id: number;
      sourceKind: string;
      sourceId: number;
      metadataId: string;
      parentType: string | null;
      parentId: number | null;
      classification: string;
      disposition: string | null;
      beforeMetadata: unknown;
    }>(
      `SELECT id, source_kind AS "sourceKind", source_id AS "sourceId", metadata_id AS "metadataId",
              parent_type AS "parentType", parent_id AS "parentId", classification,
              disposition, before_metadata AS "beforeMetadata"
       FROM attachment_reconciliation_entries WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const row = entry.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "reconciliation_not_found" });
      return;
    }
    if (row.disposition) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "reconciliation_already_dispositioned" });
      return;
    }

    if (action === "REMOVE_METADATA") {
      if (row.sourceKind !== "resource") {
        await client.query("ROLLBACK");
        res.status(422).json({ error: "source_lifecycle_does_not_allow_removal" });
        return;
      }
      const source = await client.query<{ id: number; objectPath: string; fileName: string; contentType: string | null; fileSize: number | null; parentType: string; parentId: number | null }>(
        `SELECT id, object_path AS "objectPath", file_name AS "fileName", content_type AS "contentType",
                file_size AS "fileSize", 'resource'::text AS "parentType", NULL::int AS "parentId"
         FROM program_resources WHERE id = $1 FOR UPDATE`,
        [row.sourceId],
      );
      const expectedIdentity = (row.beforeMetadata as { sourceIdentityFingerprint?: string } | null)?.sourceIdentityFingerprint;
      const current = source.rows[0];
      const currentIdentity = current ? createHash("sha256").update(JSON.stringify({
        objectPath: current.objectPath,
        legacyProviderKey: null,
        fileName: current.fileName,
        contentType: current.contentType,
        fileSize: current.fileSize,
        parentType: current.parentType,
        parentId: current.parentId,
      })).digest("hex") : null;
      if (!expectedIdentity || currentIdentity !== expectedIdentity) {
        await client.query("ROLLBACK");
        res.status(409).json({ error: "reconciliation_source_changed" });
        return;
      }
      await client.query(`DELETE FROM program_resources WHERE id = $1`, [row.sourceId]);
    } else if (action === "ARCHIVE_METADATA") {
      if (row.sourceKind === "resource") {
        await client.query(`UPDATE program_resources SET status = 'archived', availability_status = 'unavailable', unavailable_reason = $1, updated_at = NOW() WHERE id = $2`, [
          "owner_archived_during_reconciliation", row.sourceId,
        ]);
      } else if (row.sourceKind === "legacy_storage_record") {
        const file = await client.query<{ module: string; recordId: number | null; projectId: number | null }>(
          `SELECT module, record_id AS "recordId", project_id AS "projectId" FROM legacy_storage_records WHERE id = $1 FOR UPDATE`,
          [row.sourceId],
        );
        const historical = file.rows[0];
        if (!historical || historical.module !== "attachments" || historical.recordId != null || historical.projectId != null) {
          await client.query("ROLLBACK");
          res.status(422).json({ error: "source_lifecycle_does_not_allow_archiving" });
          return;
        }
        await client.query(`UPDATE legacy_storage_records SET status = 'archived', availability_status = 'unavailable', reconciliation_note = $1, updated_at = NOW() WHERE id = $2`, [
          "owner_archived_during_reconciliation", row.sourceId,
        ]);
      } else {
        await client.query("ROLLBACK");
        res.status(422).json({ error: "source_lifecycle_does_not_allow_archiving" });
        return;
      }
    } else if (row.sourceKind === "message_attachment") {
      const ok = await setMessageUnavailable(client, row.sourceId, row.metadataId);
      if (!ok) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "attachment_metadata_not_found" });
        return;
      }
    } else if (row.sourceKind === "profile_avatar") {
      // A profile avatar has no availability columns. KEEP_UNAVAILABLE is a
      // record-only, audited owner decision; archive/remove/recover are
      // intentionally rejected by the branches above/below.
    } else {
      const table = SOURCE_TABLES[row.sourceKind];
      if (!table) {
        await client.query("ROLLBACK");
        res.status(422).json({ error: "unsupported_source" });
        return;
      }
      await client.query(
        `UPDATE ${table} SET availability_status = 'unavailable', unavailable_reason = $1 WHERE id = $2`,
        ["owner_kept_unavailable", row.sourceId],
      );
    }

    await client.query(
      `UPDATE attachment_reconciliation_entries
       SET disposition = $1, disposition_reason = $2, disposition_by = $3,
           disposition_at = NOW(), after_metadata = $4::jsonb, updated_at = NOW()
       WHERE id = $5`,
      [action, rationale, req.currentUser!.id, JSON.stringify({ action, availabilityStatus: action === "REMOVE_METADATA" ? "removed" : "unavailable" }), id],
    );
    await client.query("COMMIT");
    await logAudit({
      userId: req.currentUser!.id,
      action: `attachment_reconciliation_${action.toLowerCase()}`,
      module: row.sourceKind,
      entityId: row.sourceId,
      oldValue: JSON.stringify({ classification: row.classification, before: row.beforeMetadata }),
      newValue: JSON.stringify({ rationale }),
    });
    await realtime.publishSupportingEvent({
      entityType: "attachment_reconciliation",
      entityId: id,
      action: "disposition_changed",
    });
    res.json({ ok: true, disposition: action });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    next(error);
  } finally {
    client.release();
  }
});

router.post("/attachment-reconciliation/:id/recover", requirePerm("storage.admin"), async (req, res, next) => {
  const client = await pool.connect();
  try {
    if (!isOwner(req)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const id = Number(req.params.id);
    const targetObjectPath = req.body?.targetObjectPath;
    const rationale = cleanRationale(req.body?.rationale);
    if (!Number.isInteger(id) || id <= 0 || !validObjectPath(targetObjectPath) || !rationale) {
      res.status(422).json({ error: "proven_recovery_requires_valid_path_and_rationale" });
      return;
    }
    await client.query("BEGIN");
    const entry = await client.query<{
      sourceKind: string;
      sourceId: number;
      classification: string;
      disposition: string | null;
    }>(
      `SELECT source_kind AS "sourceKind", source_id AS "sourceId", classification, disposition
       FROM attachment_reconciliation_entries WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const row = entry.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "reconciliation_not_found" });
      return;
    }
    if (
      row.disposition
      || row.sourceKind === "message_attachment"
      || row.sourceKind === "legacy_storage_record"
      || row.sourceKind === "profile_avatar"
    ) {
      await client.query("ROLLBACK");
      res.status(422).json({ error: "source_not_recoverable_by_object_mapping" });
      return;
    }
    const table = SOURCE_TABLES[row.sourceKind];
    if (!table) {
      await client.query("ROLLBACK");
      res.status(422).json({ error: "unsupported_source" });
      return;
    }
    const current = await client.query<{ objectPath: string; contentType: string | null; fileSize: number | null }>(
      `SELECT object_path AS "objectPath", content_type AS "contentType",
              ${row.sourceKind === "voice_note" ? "NULL::bigint" : row.sourceKind === "resource" ? "file_size" : "size"} AS "fileSize"
       FROM ${table} WHERE id = $1 FOR UPDATE`,
      [row.sourceId],
    );
    const metadata = current.rows[0];
    if (!metadata || metadata.fileSize == null || !metadata.contentType) {
      await client.query("ROLLBACK");
      res.status(422).json({ error: "recovery_integrity_metadata_missing" });
      return;
    }
    let verified;
    try {
      verified = await objectStorage.getObjectEntityMetadata(targetObjectPath);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        await client.query("ROLLBACK");
        res.status(422).json({ error: "recovery_object_not_found" });
        return;
      }
      throw error;
    }
    if (
      verified.size !== Number(metadata.fileSize)
      || !verified.contentType
      || verified.contentType.split(";")[0].trim().toLowerCase() !== metadata.contentType.split(";")[0].trim().toLowerCase()
    ) {
      await client.query("ROLLBACK");
      res.status(422).json({ error: "recovery_provider_metadata_mismatch" });
      return;
    }
    await client.query(
      `UPDATE ${table} SET object_path = $1, availability_status = 'available', unavailable_reason = NULL${row.sourceKind === "resource" ? ", updated_at = NOW()" : ""} WHERE id = $2`,
      [targetObjectPath, row.sourceId],
    );
    await client.query(
      `UPDATE attachment_reconciliation_entries
       SET classification = 'OBJECT_RECOVERABLE', reason = 'owner_confirmed_exact_provider_metadata',
           disposition = 'RECOVERED', disposition_reason = $1, disposition_by = $2,
           disposition_at = NOW(), object_resolution = 'confirmed',
           after_metadata = $3::jsonb, updated_at = NOW()
       WHERE id = $4`,
      [rationale, req.currentUser!.id, JSON.stringify({ size: verified.size, contentType: verified.contentType }), id],
    );
    await client.query("COMMIT");
    await logAudit({
      userId: req.currentUser!.id,
      action: "attachment_reconciliation_recovered",
      module: row.sourceKind,
      entityId: row.sourceId,
      newValue: JSON.stringify({ rationale, evidence: "exact_provider_size_and_content_type" }),
    });
    await realtime.publishSupportingEvent({
      entityType: "attachment_reconciliation",
      entityId: id,
      action: "recovered",
    });
    res.json({ ok: true, disposition: "RECOVERED" });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    next(error);
  } finally {
    client.release();
  }
});

export default router;