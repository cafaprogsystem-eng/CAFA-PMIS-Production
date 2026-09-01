/**
 * FILES-RESOURCE-DELETE-REGISTRY-CLEANUP — DELETE /files/resource/:id deleted
 * the program_resources row (and best-effort the storage object) but never
 * touched its document_registry_entries row (source_kind='resource',
 * source_id=id), unlike routes/projects.ts and routes/reports.ts, which both
 * explicitly delete their own document_registry_entries rows in the same
 * transaction before removing the row they index. Every direct-upload
 * delete left an orphaned registry row behind.
 *
 * Now both deletes happen in one transaction: document_registry_entries
 * first (the dependent index), then program_resources (the row it indexes).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(__dirname, "../routes/files.ts"), "utf8");

describe("FILES-RESOURCE-DELETE-REGISTRY-CLEANUP", () => {
  const deleteRoute = src.slice(
    src.indexOf('router.delete("/files/resource/:id"'),
    src.indexOf('router.delete("/files/resource/:id"') + 2000,
  );

  it("deletes the document_registry_entries row for this resource before removing program_resources", () => {
    const registryIdx = deleteRoute.indexOf("DELETE FROM document_registry_entries WHERE source_kind = 'resource'");
    const resourceIdx = deleteRoute.indexOf("DELETE FROM program_resources WHERE id = $1 RETURNING");
    expect(registryIdx).toBeGreaterThan(-1);
    expect(resourceIdx).toBeGreaterThan(-1);
    expect(registryIdx).toBeLessThan(resourceIdx);
  });

  it("both deletes run inside the same client transaction (BEGIN...COMMIT), with rollback on error", () => {
    expect(deleteRoute).toContain('await client.query("BEGIN");');
    expect(deleteRoute).toContain('await client.query("COMMIT");');
    expect(deleteRoute).toContain('await client.query("ROLLBACK")');
  });

  it("still 404s when the resource row never existed (empty deletedRow, not a thrown error)", () => {
    expect(deleteRoute).toContain("if (!deletedRow) { res.status(404).json({ error: \"file_not_found\" }); return; }");
  });

  it("still best-effort deletes the storage object and audits a cleanup failure", () => {
    expect(deleteRoute).toContain("if (deletedRow.object_path) {");
    expect(deleteRoute).toContain("await objectStorage.deleteObject(deletedRow.object_path);");
    expect(deleteRoute).toContain("file_archive_resource_storage_cleanup_failed");
  });
});
