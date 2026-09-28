/**
 * Ported from artifacts/api-server/src/lib/attachmentReconciliation.ts.
 *
 * Evidence-based attachment/resource reconciliation. This module intentionally
 * does not search storage by filename. It inventories canonical metadata
 * owners, checks their exact stored identity with the provider, and keeps
 * unresolved records available for an explicit owner decision. The redacted
 * provider reference is suitable for an owner matrix; raw provider keys never
 * leave this module's resolver.
 *
 * NOT ported: runAttachmentUploadExpirySweep / startAttachmentUploadExpirySweep
 * / stopAttachmentUploadExpirySweep. Those back a setInterval-based background
 * sweep wired up by api-server's lib/scheduler.ts at process startup — a
 * long-lived-process pattern that doesn't translate to a request-scoped
 * Worker. routes/attachment-reconciliation.ts (this port's caller) never
 * imports them either. Porting the sweep needs a deliberate Cloudflare Cron
 * Trigger design (a `scheduled()` handler + wrangler.toml `[triggers]`
 * block), which is a separate decision from this route port and is left for
 * a follow-up.
 *
 * A full inventory scan performs one provider metadata check (and one short
 * transaction) per attachment-owning row, sequentially. On a large dataset
 * this can run long enough to be worth revisiting as a paginated or
 * queue-driven scan under a Worker's request wall-clock limit — flagged here
 * rather than solved, since the source itself runs it as an unbounded
 * long-lived-process operation with no such ceiling.
 */
import { createHash } from "node:crypto";
import type { Bindings, QueryExecutor } from "./db";
import { ObjectNotFoundError, getObjectEntityMetadata, isStorageConfigured } from "./storage";
import { migrationRecordClassification } from "./storage-evidence-inventory";
import { publishSupportingEvent } from "./realtime";

export const RECONCILIATION_CLASSIFICATIONS = [
  "OBJECT_RECOVERABLE",
  "PROVIDER_MAPPING_STALE",
  "METADATA_ORPHANED",
  "PARENT_REMOVED",
  "OBJECT_CONFIRMED_MISSING",
  "OWNER_DECISION_REQUIRED",
] as const;
export type ReconciliationClassification = (typeof RECONCILIATION_CLASSIFICATIONS)[number];
export type ReconciliationDisposition =
  | "KEEP_UNAVAILABLE"
  | "ARCHIVE_METADATA"
  | "REMOVE_METADATA"
  | "RECOVERED";
export type ReconciliationSourceKind =
  | "resource"
  | "project_document"
  | "plan_attachment"
  | "canonical_attachment"
  | "legacy_storage_record"
  | "report_attachment"
  | "voice_note"
  | "message_attachment"
  | "profile_avatar";

type SourceRow = {
  sourceKind: ReconciliationSourceKind;
  metadataId: string;
  sourceId: number;
  parentType: string | null;
  parentId: number | null;
  fileName: string | null;
  contentType: string | null;
  fileSize: number | null;
  uploadedById: number | null;
  uploadedAt: Date | string | null;
  lifecycleState: string | null;
  parentExists: boolean;
  parentRemoved: boolean;
  objectPath: string | null;
  legacyProviderKey: string | null;
  providerKind: "object_storage" | "historical";
  availabilityStatus: "available" | "unavailable";
  messageAttachmentIndex?: number;
};

type ProviderCheck = {
  resolution: "confirmed" | "missing" | "unavailable" | "malformed";
  size?: number;
  contentType?: string | null;
  detail: string;
};

/** This worker's storage is R2 end to end — no provider-selection question. */
function activeProvider(): string {
  return "r2";
}

function safeProviderReference(row: SourceRow): string {
  if (row.providerKind === "historical") {
    return `historical:record-${row.legacyProviderKey ? "linked" : "unknown"}`;
  }
  if (!row.objectPath) return `${activeProvider()}:unresolved-reference`;
  const digest = createHash("sha256").update(row.objectPath).digest("hex").slice(0, 12);
  return `${activeProvider()}:object-${digest}`;
}

function dateValue(value: Date | string | null): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function parseMessageAttachments(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  }
  if (typeof value === "string") {
    try {
      return parseMessageAttachments(JSON.parse(value));
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Historical rows may retain a Drive link after a canonical object path has
 * been written. The canonical path is authoritative for reconciliation; a
 * compatibility link is evidence only and must never downgrade the record to
 * a legacy migration candidate.
 */
export function providerKindForLinkedAttachment(
  objectPath: string | null,
  legacyProviderKey: string | null,
): "object_storage" | "historical" {
  if (objectPath !== null) return "object_storage";
  return legacyProviderKey !== null ? "historical" : "object_storage";
}

async function sourceRows(db: QueryExecutor): Promise<SourceRow[]> {
  const result = await db.query<SourceRow & { objectPath: string | null; legacyProviderKey: string | null }>(`
    SELECT * FROM (
      SELECT 'resource'::text AS "sourceKind", pr.id::text AS "metadataId", pr.id AS "sourceId",
        'resource'::text AS "parentType", NULL::int AS "parentId", pr.file_name AS "fileName",
        pr.content_type AS "contentType", pr.file_size AS "fileSize", pr.uploaded_by_id AS "uploadedById",
        pr.created_at AS "uploadedAt", pr.status AS "lifecycleState", TRUE AS "parentExists",
        FALSE AS "parentRemoved", pr.object_path AS "objectPath", NULL::text AS "legacyProviderKey",
        'object_storage'::text AS "providerKind", pr.availability_status AS "availabilityStatus"
      FROM program_resources pr
      UNION ALL
      SELECT 'project_document', pd.id::text, pd.id, 'project', pd.project_id, pd.file_name,
        pd.content_type, pd.size, pd.uploaded_by_id, pd.uploaded_at, 'active',
        (p.id IS NOT NULL), (p.id IS NOT NULL AND p.deleted_at IS NOT NULL), pd.object_path, NULL::text,
        'object_storage',
        pd.availability_status
      FROM project_documents pd LEFT JOIN projects p ON p.id = pd.project_id
      UNION ALL
      SELECT 'plan_attachment', pa.id::text, pa.id, 'plan', pa.plan_id, pa.file_name,
        pa.content_type, pa.size, pa.uploaded_by_id, pa.uploaded_at, pl.status,
        (pl.id IS NOT NULL), FALSE, pa.object_path, NULL,
        'object_storage', pa.availability_status
      FROM plan_attachments pa LEFT JOIN plans pl ON pl.id = pa.plan_id
      UNION ALL
      SELECT 'canonical_attachment', a.id::text, a.id, a.parent_type, a.parent_id,
        a.file_name, a.content_type, a.size, a.uploaded_by_id, a.created_at, a.status,
        CASE a.parent_type
          WHEN 'plan' THEN EXISTS (SELECT 1 FROM plans pl WHERE pl.id = a.parent_id)
          WHEN 'risk' THEN EXISTS (SELECT 1 FROM risks r WHERE r.id = a.parent_id)
          ELSE FALSE END,
        FALSE, a.object_path, NULL, 'object_storage', a.availability_status
      FROM attachments a
      UNION ALL
      SELECT 'legacy_storage_record', ls.id::text, ls.id,
        CASE WHEN ls.module IN ('projects','reports','plans','risks') THEN
          CASE ls.module WHEN 'projects' THEN 'project' WHEN 'reports' THEN 'report'
            WHEN 'plans' THEN 'plan' ELSE 'risk' END ELSE NULL END,
        ls.record_id, ls.file_name, ls.content_type, ls.file_size, NULL::integer, ls.source_created_at,
        ls.status,
        CASE WHEN ls.record_id IS NULL THEN TRUE
          WHEN ls.module = 'projects' THEN EXISTS (SELECT 1 FROM projects p WHERE p.id = ls.record_id)
          WHEN ls.module = 'reports' THEN EXISTS (SELECT 1 FROM reports r WHERE r.id = ls.record_id)
          WHEN ls.module = 'plans' THEN EXISTS (SELECT 1 FROM plans pl WHERE pl.id = ls.record_id)
          WHEN ls.module = 'risks' THEN EXISTS (SELECT 1 FROM risks r WHERE r.id = ls.record_id)
          ELSE FALSE END,
        CASE WHEN ls.module = 'projects' THEN EXISTS (SELECT 1 FROM projects p WHERE p.id = ls.record_id AND p.deleted_at IS NOT NULL)
          ELSE FALSE END,
        ls.canonical_object_path, ls.provider_key, 'historical', ls.availability_status
      FROM legacy_storage_records ls
      UNION ALL
      SELECT 'report_attachment', ra.id::text, ra.id, 'report', ra.report_id, ra.file_name,
        ra.content_type, ra.size, ra.uploaded_by_id, ra.uploaded_at, r.status,
        (r.id IS NOT NULL), FALSE, ra.object_path, NULL::text,
        'object_storage',
        ra.availability_status
      FROM report_attachments ra LEFT JOIN reports r ON r.id = ra.report_id
      UNION ALL
      SELECT 'voice_note', vn.id::text, vn.id, vn.entity_type, vn.entity_id, vn.file_name,
        vn.content_type, NULL, vn.recorded_by_id, vn.created_at, 'active',
        CASE vn.entity_type
          WHEN 'project' THEN EXISTS (SELECT 1 FROM projects p WHERE p.id = vn.entity_id)
          WHEN 'plan' THEN EXISTS (SELECT 1 FROM plans pl WHERE pl.id = vn.entity_id)
          WHEN 'report' THEN EXISTS (SELECT 1 FROM reports r WHERE r.id = vn.entity_id)
          WHEN 'risk' THEN EXISTS (SELECT 1 FROM risks r WHERE r.id = vn.entity_id)
          WHEN 'comment' THEN EXISTS (SELECT 1 FROM comments c WHERE c.id = vn.entity_id)
          ELSE FALSE END,
        FALSE, vn.object_path, NULL, 'object_storage', vn.availability_status
      FROM voice_notes vn
      UNION ALL
      SELECT 'profile_avatar', u.id::text, u.id, 'profile', u.id, 'Profile photo',
        NULL::text, NULL::bigint, u.id, u.updated_at, 'active',
        TRUE, FALSE, u.avatar_url, NULL::text, 'object_storage', 'available'
      FROM users u
      WHERE u.avatar_url LIKE '/objects/profiles/%'
    ) inventory
  `);

  const messages = await db.query<{
    id: number;
    conversationId: number;
    senderId: number;
    createdAt: Date | string;
    deletedAt: Date | string | null;
    attachments: unknown;
  }>(`SELECT id, conversation_id AS "conversationId", sender_id AS "senderId",
             created_at AS "createdAt", deleted_at AS "deletedAt", attachments
      FROM messages WHERE attachments IS NOT NULL`);

  const messageRows: SourceRow[] = [];
  for (const message of messages.rows) {
    const attachments = parseMessageAttachments(message.attachments);
    attachments.forEach((attachment, index) => {
      const objectPath = typeof attachment.objectPath === "string"
        ? attachment.objectPath
        : typeof attachment.url === "string" ? attachment.url : null;
      const contentType = typeof attachment.contentType === "string"
        ? attachment.contentType
        : null;
      const fileSize = typeof attachment.size === "number" && Number.isFinite(attachment.size)
        ? attachment.size : null;
      messageRows.push({
        sourceKind: "message_attachment",
        metadataId: `${message.id}:${index}`,
        sourceId: message.id,
        parentType: "message",
        parentId: message.id,
        fileName: typeof attachment.name === "string" ? attachment.name : null,
        contentType,
        fileSize,
        uploadedById: message.senderId,
        uploadedAt: message.createdAt,
        lifecycleState: message.deletedAt ? "deleted" : "active",
        parentExists: true,
        parentRemoved: Boolean(message.deletedAt),
        objectPath,
        legacyProviderKey: null,
        providerKind: "object_storage",
        availabilityStatus: attachment.availabilityStatus === "unavailable" ? "unavailable" : "available",
        messageAttachmentIndex: index,
      });
    });
  }
  const canonicalisedRows = result.rows.map((row) => ({
    ...row,
    // The UNION ALL above mixes `integer` size/file_size columns (resource,
    // project_document, plan_attachment, canonical_attachment) with `bigint`
    // ones (report_attachment, legacy_storage_record); Postgres widens the
    // whole UNIONed column to bigint, and node-postgres returns bigint as a
    // string to avoid precision loss. Left uncoerced, `row.fileSize` is a
    // string for every row while `provider.size` (from the storage HEAD
    // response) is a real number, so `provider.size !== row.fileSize` is
    // always true even on an exact match — silently forcing every
    // provider-confirmed row into OWNER_DECISION_REQUIRED instead of
    // OBJECT_RECOVERABLE. Confirmed via `pg_typeof` against the real UNION;
    // fixed identically in api-server's lib/attachmentReconciliation.ts.
    fileSize: row.fileSize == null ? null : Number(row.fileSize),
    providerKind: (row.sourceKind === "project_document"
      || row.sourceKind === "report_attachment"
      || row.sourceKind === "legacy_storage_record")
      ? providerKindForLinkedAttachment(row.objectPath, row.legacyProviderKey)
      : row.providerKind,
  }));
  return [...canonicalisedRows, ...messageRows];
}

async function checkProvider(env: Bindings, row: SourceRow): Promise<ProviderCheck> {
  if (row.providerKind === "historical") {
    // A historical source is intentionally never contacted during normal
    // reconciliation. The explicit administrator importer performs source
    // authentication and exact byte/metadata checks when an owner approves it.
    return { resolution: "unavailable", detail: "historical_import_required" };
  }
  if (!row.objectPath || !row.objectPath.startsWith("/objects/") || row.objectPath.includes("..") || row.objectPath.includes("//")) {
    return { resolution: "malformed", detail: "object_reference_malformed" };
  }
  if (!isStorageConfigured(env).configured) return { resolution: "unavailable", detail: "provider_not_configured" };
  try {
    const metadata = await getObjectEntityMetadata(env, row.objectPath);
    return {
      resolution: "confirmed",
      size: metadata.size,
      contentType: metadata.contentType ?? null,
      detail: "provider_metadata_confirmed",
    };
  } catch (error) {
    if (error instanceof ObjectNotFoundError) return { resolution: "missing", detail: "provider_object_not_found" };
    return { resolution: "unavailable", detail: "provider_metadata_unavailable" };
  }
}

export function classifyReconciliationEvidence(
  row: Pick<SourceRow, "sourceKind" | "parentExists" | "parentRemoved" | "providerKind" | "fileSize" | "contentType">,
  provider: ProviderCheck,
): {
  classification: ReconciliationClassification;
  reason: string;
} {
  // A soft-deleted canonical parent still exists as a row, but attachment
  // metadata must be classified as removed before any provider is consulted.
  if (row.parentRemoved) {
    return { classification: "PARENT_REMOVED", reason: "canonical_parent_removed" };
  }
  if (!row.parentExists) {
    return { classification: "METADATA_ORPHANED", reason: "canonical_parent_not_found" };
  }
  if (row.providerKind === "historical" && provider.resolution === "malformed") {
    return { classification: "PROVIDER_MAPPING_STALE", reason: provider.detail };
  }
  if (provider.resolution === "missing") {
    return { classification: "OBJECT_CONFIRMED_MISSING", reason: provider.detail };
  }
  if (provider.resolution !== "confirmed") {
    return { classification: "OWNER_DECISION_REQUIRED", reason: provider.detail };
  }
  // Profile metadata retains only a managed private-object identity. A
  // provider-confirmed avatar is already canonical; absent historic size/MIME
  // fields are explicit evidence, never values inferred from a filename/URL.
  if (row.sourceKind === "profile_avatar") {
    return {
      classification: "OBJECT_RECOVERABLE",
      reason: "canonical_profile_avatar_identity_confirmed_historical_size_mime_unavailable",
    };
  }
  // Both exact size and MIME are required. Missing integrity metadata is never
  // promoted to a recovery candidate, even when a provider object exists.
  if (
    row.fileSize == null ||
    provider.size !== row.fileSize ||
    !row.contentType ||
    !provider.contentType ||
    provider.contentType.split(";")[0].trim().toLowerCase() !== row.contentType.split(";")[0].trim().toLowerCase()
  ) {
    return { classification: "OWNER_DECISION_REQUIRED", reason: "provider_metadata_conflicts_or_integrity_missing" };
  }
  return { classification: "OBJECT_RECOVERABLE", reason: "canonical_identity_and_exact_metadata_confirmed" };
}

async function updateSourceAvailability(db: QueryExecutor, row: SourceRow, unavailable: boolean, reason: string): Promise<void> {
  const status = unavailable ? "unavailable" : "available";
  if (row.sourceKind === "message_attachment") {
    if (row.messageAttachmentIndex == null) return;
    const current = await db.query<{ attachments: unknown }>(
      `SELECT attachments FROM messages WHERE id = $1 FOR UPDATE`,
      [row.sourceId],
    );
    const attachments = parseMessageAttachments(current.rows[0]?.attachments);
    const attachment = attachments[row.messageAttachmentIndex];
    if (!attachment) return;
    attachment.availabilityStatus = status;
    if (unavailable) attachment.unavailableReason = "reconciliation_review_required";
    else delete attachment.unavailableReason;
    await db.query(`UPDATE messages SET attachments = $1::jsonb WHERE id = $2`, [JSON.stringify(attachments), row.sourceId]);
    return;
  }
  // Users do not carry attachment availability columns. Keep the reconciliation
  // record for a managed avatar, but never mutate profile metadata or infer a
  // replacement photo from an unavailable provider response.
  if (row.sourceKind === "profile_avatar") return;
  const table = {
    resource: "program_resources",
    project_document: "project_documents",
    plan_attachment: "plan_attachments",
    canonical_attachment: "attachments",
    legacy_storage_record: "legacy_storage_records",
    report_attachment: "report_attachments",
    voice_note: "voice_notes",
  }[row.sourceKind as Exclude<ReconciliationSourceKind, "message_attachment" | "profile_avatar">];
  if (row.sourceKind === "legacy_storage_record") {
    // Imported historical metadata is evidence only. Its canonical attachment
    // is the serving record; verification must not reactivate the retired
    // source or erase the completed-import reconciliation note.
    if (row.objectPath) return;
    // The cutover evidence table has a reconciliation note, not the
    // unavailable_reason column used by active attachment tables.
    await db.query(
      `UPDATE legacy_storage_records
       SET availability_status = $1, reconciliation_note = $2, updated_at = NOW()
       WHERE id = $3`,
      [status, unavailable ? reason : null, row.sourceId],
    );
    return;
  }
  await db.query(
    `UPDATE ${table} SET availability_status = $1, unavailable_reason = $2 WHERE id = $3`,
    [status, unavailable ? reason : null, row.sourceId],
  );
}

export async function runAttachmentReconciliationInventory(
  env: Bindings,
  db: QueryExecutor,
  pool: { connect(): Promise<QueryExecutor & { query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>; release(): void }> },
): Promise<{
  generatedAt: string;
  total: number;
  classifications: Record<ReconciliationClassification, number>;
  safelyRecovered: number;
  confirmedMissing: number;
  orphanMetadata: number;
  ownerDecisionRequired: number;
  changes: number;
  intentionallyUnchanged: number;
}> {
  const rows = await sourceRows(db);
  const counts = Object.fromEntries(RECONCILIATION_CLASSIFICATIONS.map((key) => [key, 0])) as Record<ReconciliationClassification, number>;
  let changes = 0;
  let intentionallyUnchanged = 0;
  let lastChangedEntryId: number | null = null;
  for (const row of rows) {
    const provider = await checkProvider(env, row);
    const { classification, reason } = classifyReconciliationEvidence(row, provider);
    counts[classification]++;
    const unavailable = classification !== "OBJECT_RECOVERABLE";
    const evidence = {
      providerKind: row.providerKind === "historical" ? "historical_storage" : activeProvider(),
      resolution: provider.resolution,
      detail: provider.detail,
      expectedSizePresent: row.fileSize != null,
      observedSize: provider.size ?? null,
      expectedContentTypePresent: Boolean(row.contentType),
      observedContentType: provider.contentType ?? null,
    };
    const before = {
      objectPathPresent: Boolean(row.objectPath),
      providerKind: row.providerKind,
      availabilityStatus: row.availabilityStatus,
      sourceIdentityFingerprint: createHash("sha256").update(JSON.stringify({
        objectPath: row.objectPath,
        legacyProviderKey: row.legacyProviderKey,
        fileName: row.fileName,
        contentType: row.contentType,
        fileSize: row.fileSize,
        parentType: row.parentType,
        parentId: row.parentId,
      })).digest("hex"),
    };
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const prior = await client.query<{ classification: ReconciliationClassification; disposition: ReconciliationDisposition | null }>(
        `SELECT classification, disposition
         FROM attachment_reconciliation_entries
         WHERE source_kind = $1 AND metadata_id = $2
         FOR UPDATE`,
        [row.sourceKind, row.metadataId],
      );
      const hasOwnerDisposition = prior.rows[0]?.disposition != null;
      const changed = !(
        prior.rows[0]?.classification === classification
        && (hasOwnerDisposition || unavailable === (row.availabilityStatus === "unavailable"))
      );
      if (!changed) {
        intentionallyUnchanged++;
      } else {
        changes++;
      }
      // An explicit owner decision is durable. We continue refreshing evidence
      // for the matrix but never make an attachment usable again automatically.
      if (!hasOwnerDisposition) {
        await updateSourceAvailability(client, row, unavailable, reason);
      }
      const inserted = await client.query<{ id: number }>(
        `INSERT INTO attachment_reconciliation_entries
          (source_kind, metadata_id, source_id, parent_type, parent_id, file_name, content_type,
           file_size, uploaded_by_id, uploaded_at, lifecycle_state, provider_reference,
           parent_exists, parent_removed, object_resolution, object_evidence, classification, reason,
           classified_at, before_metadata, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18,NOW(),$19::jsonb,NOW())
         ON CONFLICT (source_kind, metadata_id) DO UPDATE SET
           source_id = EXCLUDED.source_id, parent_type = EXCLUDED.parent_type, parent_id = EXCLUDED.parent_id,
           file_name = EXCLUDED.file_name, content_type = EXCLUDED.content_type, file_size = EXCLUDED.file_size,
           uploaded_by_id = EXCLUDED.uploaded_by_id, uploaded_at = EXCLUDED.uploaded_at,
           lifecycle_state = EXCLUDED.lifecycle_state, provider_reference = EXCLUDED.provider_reference,
           parent_exists = EXCLUDED.parent_exists, parent_removed = EXCLUDED.parent_removed,
           object_resolution = EXCLUDED.object_resolution, object_evidence = EXCLUDED.object_evidence,
           classification = EXCLUDED.classification, reason = EXCLUDED.reason,
           classified_at = EXCLUDED.classified_at,
           before_metadata = COALESCE(attachment_reconciliation_entries.before_metadata, EXCLUDED.before_metadata),
           updated_at = NOW()
         RETURNING id`,
        [
          row.sourceKind, row.metadataId, row.sourceId, row.parentType, row.parentId, row.fileName,
          row.contentType, row.fileSize, row.uploadedById, dateValue(row.uploadedAt), row.lifecycleState,
          safeProviderReference(row), row.parentExists, row.parentRemoved, provider.resolution,
          JSON.stringify(evidence), classification, reason, JSON.stringify(before),
        ],
      );
      await client.query("COMMIT");
      if (changed) lastChangedEntryId = inserted.rows[0]?.id ?? lastChangedEntryId;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  // One metadata-only refetch hint for the whole scan, not one per row — a
  // scan can touch hundreds of rows, and these events are id-only "go
  // refetch" hints anyway (see lib/realtime.ts).
  if (lastChangedEntryId !== null) {
    await publishSupportingEvent(env, { entityType: "attachment_reconciliation", entityId: lastChangedEntryId, action: "inventory_changed" });
  }
  return {
    generatedAt: new Date().toISOString(),
    total: rows.length,
    classifications: counts,
    safelyRecovered: counts.OBJECT_RECOVERABLE,
    confirmedMissing: counts.OBJECT_CONFIRMED_MISSING,
    orphanMetadata: counts.METADATA_ORPHANED,
    ownerDecisionRequired: counts.OWNER_DECISION_REQUIRED,
    changes,
    intentionallyUnchanged,
  };
}

export function reconciliationPublicRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    metadataId: row.metadataId,
    sourceKind: row.sourceKind,
    sourceId: row.sourceId,
    parentType: row.parentType,
    parentId: row.parentId,
    fileName: row.fileName,
    contentType: row.contentType,
    fileSize: row.fileSize,
    uploadedAt: row.uploadedAt,
    lifecycleState: row.lifecycleState,
    providerReference: row.providerReference,
    migrationClassification: migrationRecordClassification(
      String(row.classification ?? ""),
      row.providerReference,
    ),
    parentExists: row.parentExists,
    parentRemoved: row.parentRemoved,
    objectResolution: row.objectResolution,
    objectEvidence: row.objectEvidence,
    classification: row.classification,
    reason: row.reason,
    classifiedAt: row.classifiedAt,
    disposition: row.disposition,
    dispositionReason: row.dispositionReason,
    dispositionAt: row.dispositionAt,
  };
}
