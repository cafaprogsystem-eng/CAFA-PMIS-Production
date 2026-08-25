/**
 * Cross-table evidence ownership helpers for ATT-05.
 *
 * The UNIQUE indexes on report_attachments(object_path) and voice_notes(object_path)
 * are per-table, not global.  A path could appear once in each table (e.g. if the
 * legacy non-report voice-note registration path accepts a client-supplied objectPath
 * matching an attachment).  Before deleting a storage object we must confirm the path
 * is not referenced by any record in the OTHER table.
 */

import { pool } from "@workspace/db";

export type EvidenceTable = "report_attachments" | "voice_notes";

/**
 * Returns true when it is safe to delete the storage object for `objectPath`
 * as part of removing a record in `ownerTable`.
 *
 * Safe means: the path does NOT appear in the other evidence table.
 *
 * The UNIQUE index on each table guarantees at most one record per path within
 * that table, so a cross-table count of 0 + 1 (the owner) = exactly one global
 * reference, which is safe to delete.
 *
 * If any other record references the path, skip the storage delete and log a
 * warning — the DB row for the owner is still removed; only the storage object
 * is preserved to avoid data loss.
 */
export async function isStorageDeleteSafeForRecord(
  objectPath: string,
  ownerTable: EvidenceTable,
): Promise<boolean> {
  if (!objectPath || !objectPath.startsWith("/objects/")) return false;

  const otherTable =
    ownerTable === "report_attachments" ? "voice_notes" : "report_attachments";

  // We only need to know whether ANY row in the other table references this path.
  const result = await pool.query<{ id: number }>(
    `SELECT id FROM ${otherTable} WHERE object_path = $1 LIMIT 1`,
    [objectPath],
  );

  return (result.rowCount ?? 0) === 0; // safe if no cross-table reference
}

/**
 * For batch report deletion: given the full set of objectPaths being deleted
 * for a report (from BOTH report_attachments and voice_notes for that report),
 * returns the deduplicated subset that is safe to delete from storage.
 *
 * A path is safe to delete when no record OUTSIDE the deletion set references it:
 *   - No row in report_attachments with a different report_id holds this path, AND
 *   - No row in voice_notes not belonging to this report holds this path.
 *
 * Paths shared WITHIN the deletion set (e.g. same path in both an attachment
 * and a voice note for the same report) are correctly classified as safe —
 * because after the deletion, no record will reference them.
 *
 * Returns the safe subset (unique) and the skipped subset (external references).
 */
export async function partitionSafeStoragePathsForReport(
  reportId: number,
  allObjectPaths: string[], // deduplicated union of attachment + voice note paths
): Promise<{ safe: string[]; skipped: string[] }> {
  if (allObjectPaths.length === 0) return { safe: [], skipped: [] };

  // Paths referenced by report_attachments records NOT belonging to this report
  const attResult = await pool.query<{ object_path: string }>(
    `SELECT object_path FROM report_attachments
     WHERE object_path = ANY($1) AND report_id != $2`,
    [allObjectPaths, reportId],
  );

  // Paths referenced by voice_notes records NOT belonging to this report
  const vnResult = await pool.query<{ object_path: string }>(
    `SELECT object_path FROM voice_notes
     WHERE object_path = ANY($1)
       AND NOT (entity_type = 'report' AND entity_id = $2)`,
    [allObjectPaths, reportId],
  );

  // External references: paths held by records NOT in the deletion set
  const externallyReferenced = new Set([
    ...attResult.rows.map((r) => r.object_path),
    ...vnResult.rows.map((r) => r.object_path),
  ]);

  const safe: string[] = [];
  const skipped: string[] = [];

  for (const p of allObjectPaths) {
    if (externallyReferenced.has(p)) {
      skipped.push(p);
    } else {
      safe.push(p);
    }
  }

  return { safe, skipped };
}
