/**
 * Report attachment and historical-storage boundary regression tests.
 *
 * Report attachments are canonical ObjectStorageService records. Historical
 * provider evidence is deliberately isolated in the administrator-only import
 * route and must never become a normal report runtime dependency.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const reports = fs.readFileSync(path.resolve(__dirname, "./reports.ts"), "utf8");
const attachments = fs.readFileSync(path.resolve(__dirname, "./attachments.ts"), "utf8");
const historicalImport = fs.readFileSync(path.resolve(__dirname, "./historical-storage-import.ts"), "utf8");
const routes = fs.readFileSync(path.resolve(__dirname, "./index.ts"), "utf8");
const migrations = fs.readFileSync(path.resolve(__dirname, "../lib/run-migrations.ts"), "utf8");
const openApi = fs.readFileSync(path.resolve(__dirname, "../../../../lib/api-spec/openapi.yaml"), "utf8");

describe("canonical report attachment contract", () => {
  it("uses ObjectStorageService only and never reintroduces a Drive runtime branch", () => {
    expect(reports).toContain('from "../lib/objectStorage"');
    expect(reports).toContain("objectStorageService.getObjectEntityFile(objectPath)");
    expect(reports).not.toMatch(/\bdrive_files\b|drive_file_id|driveFileId|downloadFileStream|awsS3/);
  });

  it("lists only public attachment fields and proxies downloads through the report parent", () => {
    const list = reports.slice(
      reports.indexOf('router.get(\n  "/reports/:reportId/attachments"'),
      reports.indexOf("// POST /reports/:reportId/attachments"),
    );
    expect(list).toContain("assertCanViewReport(req, reportId)");
    expect(list).toContain('availability_status AS "availabilityStatus"');
    expect(list).not.toContain("object_path");
    expect(list).not.toMatch(/provider|bucket|upload_operation_id/i);
    expect(reports).toContain("WHERE id = $1 AND report_id = $2");
    expect(reports).toContain('res.status(410).json({ error: "file_unavailable"');
    expect(reports).toContain("Readable.fromWeb");
    expect(reports).not.toContain("res.redirect(");
  });

  it("binds registration to a report-owned upload token and provider-verified metadata", () => {
    const registration = reports.slice(
      reports.indexOf('router.post(\n  "/reports/:reportId/attachments"'),
      reports.indexOf("// DELETE /reports/:reportId/attachments"),
    );
    for (const check of [
      "assertAttachmentMutationAllowed(req, reportId)",
      "descriptor.userId !== req.currentUser!.id",
      "descriptor.reportId !== reportId",
      'descriptor.entityType !== "attachment"',
      "objectStorageService.getObjectEntityMetadata(descriptor.objectPath)",
      "metadata.size !== descriptor.maxSize",
      "provider_metadata_mismatch",
      "ON CONFLICT (object_path) DO NOTHING",
      "document_registry_entries",
    ]) expect(registration).toContain(check);
    expect(registration).not.toMatch(/drive_file_id|driveFileId|awsS3/);
  });
});

describe("canonical plan and risk attachment contract", () => {
  it("derives all plan/risk authority from the parent, not caller metadata", () => {
    expect(attachments).toContain("async function assertCanonicalParent(");
    expect(attachments).toContain("assertAnySectorAllowed(req, parent.sectors)");
    expect(attachments).toContain("assertPlanStateAllowed(req, parent.stateId, parent.locationType)");
    expect(attachments).toContain("assertSectorAllowed(req, row.sector)");
    expect(attachments).toContain('router.get("/risks/:riskId/attachments"');
    expect(attachments).toContain("WHERE a.id = $1");
  });

  it("keeps storage identity and provider metadata server-side throughout list, download, and lifecycle flows", () => {
    const publicDto = attachments.slice(
      attachments.indexOf("function publicAttachment"),
      attachments.indexOf("async function getAttachment"),
    );
    for (const privateField of ["objectPath:", "provider:", "uploadOperationId:"]) {
      expect(publicDto).not.toContain(privateField);
    }
    expect(attachments).toContain('router.get("/attachments/:attachmentId/download"');
    expect(attachments).toContain('router.delete("/attachments/:attachmentId"');
    expect(attachments).toContain("deleteStorageObjectSafely(String(locked.rows[0].objectPath))");
    expect(attachments).not.toMatch(/\bdrive_files\b|driveFileId|awsS3/);
  });
});

describe("historical storage import isolation", () => {
  it("is authenticated, storage-admin gated, and restricted to explicit operators", () => {
    expect(historicalImport).toContain('router.get("/storage-history/status", requirePerm("storage.admin")');
    expect(historicalImport).toContain('router.post("/storage-history/import", requirePerm("storage.admin")');
    expect(historicalImport).toContain('new Set(["super_admin", "executive_director"])');
    expect(historicalImport).toContain('res.status(403).json({ error: "forbidden" })');
  });

  it("requires a configured historical source only during an explicit import request", () => {
    expect(historicalImport).toContain("function legacyClient()");
    expect(historicalImport).toContain("destinationForLegacyRecord");
    expect(historicalImport).not.toContain("req.body?.parentType");
    expect(historicalImport).not.toContain("req.body?.parentId");
    expect(historicalImport).toContain("Availability is therefore not import eligibility");
    expect(historicalImport).toContain('res.status(503).json({ error: "historical_import_not_configured" })');
    expect(routes).toContain("router.use(historicalStorageImportRouter)");
    expect(routes).not.toContain("driveRouter");
    expect(routes.indexOf("router.use(historicalStorageImportRouter)")).toBeGreaterThan(
      routes.indexOf("router.use(requireAuth)"),
    );
  });

  it("locks source and destination, verifies bytes and MIME, and records reconciliation evidence", () => {
    for (const evidence of [
      "FROM legacy_storage_records WHERE id = $1 FOR UPDATE",
      'SELECT id, project_id AS "projectId" FROM ${parentTable} WHERE id = $1 FOR UPDATE',
      "source_destination_mismatch",
      "unsupported_historical_destination",
      "error_code='metadata_mismatch'",
      "RETURNING id",
      "reconciliation_note='import_metadata_mismatch'",
      'FROM legacy_storage_records WHERE id=$1 FOR UPDATE',
      "Every importer transaction locks in this order",
      "lease_expires_at",
      "stale_attempt_recovered",
      "destination_parent_changed",
      "startLeaseHeartbeat",
      "operation_id = $1 AND run_id = $2",
      "Each lease owner receives a private temporary identity",
      "metadata_mismatch",
      "createHash(\"sha256\").update(bytes).digest(\"hex\")",
      "destination_verification_failed",
      "historical_storage_import_attempts",
      "source_evidence=$3::jsonb",
      "reconciliation_note='migrated_to_canonical_storage'",
      'action: "historical_storage_imported"',
    ]) expect(historicalImport).toContain(evidence);
    expect(historicalImport).toContain("destinationMetadata.contentType");
    expect(historicalImport).toContain("}).catch(() => undefined)");
  });

  it("is idempotent and creates provider-neutral canonical attachment metadata", () => {
    expect(historicalImport).toContain('res.json({ status: "already_imported", attachmentId: previous.rows[0].attachment_id })');
    expect(historicalImport).toContain("ON CONFLICT (upload_operation_id)");
    expect(historicalImport).toContain('"historical_import"');
    expect(historicalImport).not.toMatch(/drive_file_id|driveFileId|downloadFileStream/);
    expect(migrations).toContain('name: "047_historical_storage_import_lease"');
    expect(migrations).toContain("lease_expires_at TIMESTAMPTZ");
  });
});

describe("cutover schema and public API guards", () => {
  it("preserves legacy references as unavailable evidence while removing active report Drive metadata", () => {
    expect(migrations).toContain('name: "046_historical_storage_import_boundary"');
    expect(migrations).toContain("CREATE TABLE IF NOT EXISTS legacy_storage_records");
    expect(migrations).toContain("availability_status TEXT NOT NULL DEFAULT 'unavailable'");
    expect(migrations).toContain("ALTER TABLE report_attachments DROP COLUMN IF EXISTS drive_file_id");
  });

  it("exposes only canonical attachment endpoints in the public API contract", () => {
    expect(openApi).toContain("/attachments/upload-descriptors:");
    expect(openApi).toContain("/attachments/operations/{operationId}/finalize:");
    expect(openApi).not.toMatch(/\/drive\b|driveFileId|googleDriveFileId|googleDriveUrl/);
  });
});