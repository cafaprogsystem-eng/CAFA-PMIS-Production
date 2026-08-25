import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(join(process.cwd(), "src/routes/files.ts"), "utf8");

describe("FILE-SEC / File & Archive contract", () => {
  it("projects source records without exposing storage paths or S3 keys", () => {
    const dto = SOURCE.slice(SOURCE.indexOf("function publicItem"), SOURCE.indexOf("// GET /files"));
    for (const internal of ["objectPath", "driveFileId", "drive_link", "object_path"]) {
      expect(dto).not.toContain(internal);
    }
    expect(dto).toContain("previewUrl");
    expect(dto).toContain("downloadUrl");
    expect(dto).toContain("reference: row.reference");
    expect(dto).toContain("sourceKind: row.sourceKind");
  });

  it("uses canonical parents for scoped registry rows before count and pagination", () => {
    expect(SOURCE).toContain("function projectScopeSql");
    expect(SOURCE).toContain("function planScopeSql");
    expect(SOURCE).toContain("function reportScopeSql");
    expect(SOURCE).toContain("JOIN projects p");
    expect(SOURCE).toContain("JOIN reports r");
    expect(SOURCE).toContain("JOIN plans pl");
    expect(SOURCE).toContain("FROM project_documents pd");
    expect(SOURCE).toContain("FROM plan_attachments pa");
    expect(SOURCE).toContain("FROM report_attachments ra");
    expect(SOURCE).toContain("SELECT COUNT(*)::int AS total FROM archive_items");
    expect(SOURCE).toContain('const { status = "all", source, search, sector, confidentiality } = req.query');
    expect(SOURCE).toContain("FROM archive_items ${whereSql}");
    expect(SOURCE).not.toMatch(/\bdrive_files\b|driveFileId|drive_link/);
  });

  it("FILE-CLASS-VIS-04/05 — returns the ordered approved taxonomy with full scoped totals", () => {
    expect(SOURCE).toContain("DOCUMENT_CLASSIFICATIONS");
    expect(SOURCE).toContain("HR Records remains readable as legacy");
    expect(SOURCE).toContain("for (const category of DOCUMENT_CLASSIFICATIONS)");
    expect(SOURCE).toContain("count: counts.get(category) ?? 0");
    expect(SOURCE).toContain("const totalsWhereSql");
    expect(SOURCE).toContain("COUNT(*) FILTER (WHERE status = 'archived')::int AS archived");
    expect(SOURCE).toContain("FROM archive_items ${totalsWhereSql}");
    expect(SOURCE).toContain("baseProjectionSql(req, projectionParams)");
    expect(SOURCE).toContain("ObjectStorageService");
  });

  it("indexes parent-owned attachments without exposing their storage implementation", () => {
    expect(SOURCE).toContain("FROM project_documents pd");
    expect(SOURCE).toContain("FROM report_attachments ra");
    expect(SOURCE).toContain("'Project Documents'");
    expect(SOURCE).toContain("'Plans & Workplans'");
    expect(SOURCE).toContain("'Programme Reports'");
    expect(SOURCE).toContain("document_registry_entries");
    expect(SOURCE).toContain("/api/projects/${row.recordId}/documents/${row.id}/download");
    expect(SOURCE).toContain("/api/reports/${row.recordId}/attachments/${row.id}/download");
    expect(SOURCE).toContain("p.code AS reference");
    expect(SOURCE).toContain("pl.code AS reference");
    expect(SOURCE).toContain("'plan_attachment'::text AS \"sourceKind\"");
    expect(SOURCE).toContain("'report_attachment'::text AS \"sourceKind\"");
  });

  it("persists direct-upload metadata and applies authoritative plan/report scopes", () => {
    expect(SOURCE).toContain("(source_kind, source_id, title, description, classification");
    expect(SOURCE).toContain("COALESCE(dre.retention_years, pr.retention_years)");
    expect(SOURCE).toContain("r.state_id = $${params.length}");
    expect(SOURCE).toContain("pl.location_type IS DISTINCT FROM 'hq' AND pl.state_id = $${params.length}");
    expect(SOURCE).toContain("jsonb_array_elements_text");
    expect(SOURCE).toContain('if (!resourcePermission(req, "reports.view")) return "FALSE"');
    expect(SOURCE).toContain("reportScopeSql");
  });

  it("uses a verified, provider-neutral object upload before creating a direct archive record", () => {
    const uploadRoute = SOURCE.slice(SOURCE.indexOf('router.post("/files/upload"'), SOURCE.indexOf('router.patch("/files/resource/:id"'));
    expect(uploadRoute).toContain('objectPath.startsWith("/objects/uploads/")');
    expect(uploadRoute).toContain("await objectStorage.getObjectEntityMetadata(objectPath)");
    expect(uploadRoute).toContain('await objectStorage.finalizeObjectEntityUpload(objectPath, "files")');
    expect(uploadRoute).toContain("INSERT INTO program_resources");
    expect(uploadRoute).toContain("VALUES ('resource'");
    expect(uploadRoute).toContain("await objectStorage.deleteObject(finalObjectPath)");
    expect(uploadRoute).not.toContain("await uploadFile({");
  });

  it("keeps source-preserving lifecycle routes and secure proxy endpoints", () => {
    expect(SOURCE).toContain('router.get("/files/:source/:id/preview"');
    expect(SOURCE).toContain('router.get("/files/:source/:id/download"');
    expect(SOURCE).toContain('router.post("/files/resource/:id/replace"');
    expect(SOURCE).toContain('await objectStorage.finalizeObjectEntityUpload(objectPath, "files")');
    expect(SOURCE).toContain("Parent-bound attachments deliberately do");
    expect(SOURCE).toContain("their owning module remains the lifecycle authority");
    expect(SOURCE).toContain("canManageArchiveLifecycle: row.canManageArchiveLifecycle === true");
    expect(SOURCE).toContain('router.patch("/files/resource/:id"');
    expect(SOURCE).toContain('router.delete("/files/resource/:id"');
    expect(SOURCE).toContain('res.setHeader("Cache-Control", "private, no-store")');
    expect(SOURCE).toContain("logAudit");
    expect(SOURCE).not.toMatch(/\/files\/drive|\/api\/drive|\bdrive_files\b/);
  });
});