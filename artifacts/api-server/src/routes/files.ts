import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { Readable } from "stream";
import { pool } from "@workspace/db";
import { hasPerm, logAudit, permissionsFor } from "../middlewares/currentUser";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import { nextResourceFileVersion } from "../lib/resourceFileVersion";
import { UploadTokenError, verifyUploadToken } from "../lib/uploadToken";
import { realtime } from "../lib/realtime";

/**
 * Filing & Archive is a metadata registry over authoritative attachments.
 * It never takes ownership of a parent record's storage, lifecycle or secure
 * download flow; registry rows simply make those files discoverable.
 */
const router: IRouter = Router();
const objectStorage = new ObjectStorageService();

const MAX_ATTACHMENT_BYTES = Number(process.env.MAX_ATTACHMENT_SIZE_MB ?? "25") * 1024 * 1024;

/** Ordered, approved filing taxonomy. HR Records remains readable as legacy
 * metadata, but is intentionally not offered in upload or active navigation. */
export const DOCUMENT_CLASSIFICATIONS = [
  "Governance & Legal", "Policies & Procedures", "Strategy & Planning",
  "Project Documents", "Plans & Workplans", "Programme Reports", "Donor Reports",
  "Financial & Budget", "Procurement & Logistics", "Monitoring & Evaluation",
  "Assessments & Research", "Partnerships", "Communications", "Training Materials",
  "Templates & Tools", "Technical Resources",
] as const;
const CLASSIFICATION_SET = new Set<string>(DOCUMENT_CLASSIFICATIONS);
const RESOURCE_SECTORS = new Set([
  "General / Cross-Cutting", "Health", "Nutrition", "WASH", "Education",
  "Protection", "Food Security & Livelihoods", "Shelter & NFI",
]);
const CONFIDENTIALITY_VALUES = new Set(["public", "internal", "confidential", "restricted"]);
const ARCHIVE_MANAGERS = new Set(["super_admin", "executive_director", "program_manager"]);


type ArchiveSource = "resource" | "project" | "plan" | "report";
type PrivateItem = {
  source: ArchiveSource;
  id: number;
  objectPath?: string | null;
  fileName?: string | null;
  contentType?: string | null;
  availabilityStatus?: string | null;
  module?: string | null;
  recordId?: number | null;
};

function integer(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function contentDisposition(name: string | null | undefined, download: boolean): string {
  const safe = String(name ?? "download").replace(/[/\\\u0000-\u001f\u007f"]/g, "_").trim() || "download";
  const ascii = safe.replace(/[^\x20-\x7e]/g, "_");
  return `${download ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

function archiveManager(req: Request): boolean {
  return !!req.currentUser && ARCHIVE_MANAGERS.has(req.currentUser.role);
}

function resourcePermission(req: Request, permission: string): boolean {
  return !!req.currentUser && hasPerm(permissionsFor(req.currentUser), permission);
}

function archiveViewEnabled(req: Request): boolean {
  return !!req.currentUser && (
    archiveManager(req) || hasPerm(permissionsFor(req.currentUser), "documents.view")
  );
}

function projectScopeSql(req: Request, params: unknown[], alias = "p"): string {
  const user = req.currentUser!;
  if (archiveManager(req)) return `${alias}.deleted_at IS NULL`;
  if (!archiveViewEnabled(req)) return "FALSE";
  if (user.role === "technical_coordinator") {
    const sectors = user.sectors?.length ? user.sectors : user.sector ? [user.sector] : [];
    if (!sectors.length) return "FALSE";
    params.push(sectors);
    return `${alias}.deleted_at IS NULL AND ${alias}.sector = ANY($${params.length}::text[])`;
  }
  if (user.role === "state_program_officer" || user.role === "state_office_manager") {
    if (user.stateId == null) return "FALSE";
    params.push(user.stateId);
    return `${alias}.deleted_at IS NULL AND EXISTS (
      SELECT 1 FROM project_states ps WHERE ps.project_id = ${alias}.id AND ps.state_id = $${params.length}
    )`;
  }
  return `${alias}.deleted_at IS NULL`;
}

function reportScopeSql(req: Request, params: unknown[]): string {
  const user = req.currentUser!;
  if (!resourcePermission(req, "reports.view")) return "FALSE";
  if (archiveManager(req)) return "TRUE";
  if (!archiveViewEnabled(req)) return "FALSE";
  if (user.role === "technical_coordinator") {
    const sectors = user.sectors?.length ? user.sectors : user.sector ? [user.sector] : [];
    if (!sectors.length) return "FALSE";
    params.push(sectors);
    return `(
      CASE
        WHEN r.report_type = 'project' THEN p.sector
        WHEN r.report_type = 'activity' THEN CASE WHEN r.project_id IS NULL THEN act.sector ELSE p.sector END
        ELSE COALESCE(NULLIF(r.sector, ''), p.sector)
      END
    ) = ANY($${params.length}::text[])`;
  }
  if (user.role === "state_program_officer" || user.role === "state_office_manager") {
    if (user.stateId == null) return "FALSE";
    params.push(user.stateId);
    return `r.state_id = $${params.length}`;
  }
  return "TRUE";
}

function planScopeSql(req: Request, params: unknown[]): string {
  const user = req.currentUser!;
  if (archiveManager(req)) return "TRUE";
  if (!archiveViewEnabled(req)) return "FALSE";
  if (user.role === "technical_coordinator") {
    const sectors = user.sectors?.length ? user.sectors : user.sector ? [user.sector] : [];
    if (!sectors.length) return "FALSE";
    params.push(sectors);
    return `EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(
        CASE
          WHEN jsonb_array_length(COALESCE(pl.sectors, '[]'::jsonb)) > 0 THEN pl.sectors
          WHEN NULLIF(pl.sector, '') IS NOT NULL THEN jsonb_build_array(pl.sector)
          WHEN NULLIF(p.sector, '') IS NOT NULL THEN jsonb_build_array(p.sector)
          ELSE '[]'::jsonb
        END
      ) AS effective_sector(value)
      WHERE effective_sector.value = ANY($${params.length}::text[])
    )`;
  }
  if (user.role === "state_program_officer" || user.role === "state_office_manager") {
    if (user.stateId == null) return "FALSE";
    params.push(user.stateId);
    return `pl.location_type IS DISTINCT FROM 'hq' AND pl.state_id = $${params.length}`;
  }
  return "TRUE";
}

function baseProjectionSql(req: Request, params: unknown[]): string {
  const projectScope = projectScopeSql(req, params);
  const planScope = planScopeSql(req, params);
  const reportScope = reportScopeSql(req, params);
  return `
    SELECT
      'resource'::text AS source, pr.id, pr.title AS name, pr.file_name AS "fileName",
      pr.content_type AS "contentType", pr.file_size AS size, pr.status, pr.availability_status AS "availabilityStatus",
      COALESCE(dre.classification, pr.category) AS classification, pr.sector, NULL::text AS module,
       NULL::integer AS "recordId", NULL::text AS reference, pr.version_number AS "versionLabel",
       FALSE AS "canManageArchiveLifecycle",
      pr.description, pr.effective_date AS "effectiveDate",
      pr.updated_at AS "updatedAt", pr.created_at AS "createdAt",
      u.name AS "uploadedByName", COALESCE(dre.confidentiality, pr.confidentiality, 'internal') AS confidentiality,
      COALESCE(dre.retention_years, pr.retention_years) AS "retentionYears", COALESCE(dre.tags, '[]'::jsonb) AS tags,
       'direct_upload'::text AS "sourceKind", 'Direct upload'::text AS "sourceLabel", NULL::text AS "relatedRecordTitle"
    FROM program_resources pr
    LEFT JOIN users u ON u.id = pr.uploaded_by_id
    LEFT JOIN document_registry_entries dre ON dre.source_kind = 'resource' AND dre.source_id = pr.id
    WHERE ${resourcePermission(req, "program_resources.view") ? "TRUE" : "FALSE"}
    UNION ALL
    SELECT
      'project'::text AS source, pd.id, pd.file_name AS name, pd.file_name AS "fileName",
      pd.content_type AS "contentType", pd.size, 'active'::text AS status, pd.availability_status AS "availabilityStatus",
      COALESCE(dre.classification, 'Project Documents') AS classification, p.sector, 'projects'::text AS module,
       pd.project_id AS "recordId", p.code AS reference, NULL::text AS "versionLabel", FALSE AS "canManageArchiveLifecycle",
      NULL::text AS description, NULL::date AS "effectiveDate", pd.uploaded_at AS "updatedAt",
      pd.uploaded_at AS "createdAt", u.name AS "uploadedByName",
      COALESCE(dre.confidentiality, 'internal') AS confidentiality, dre.retention_years AS "retentionYears",
       COALESCE(dre.tags, '[]'::jsonb) AS tags, 'project_attachment'::text AS "sourceKind", 'Project attachment'::text AS "sourceLabel",
      concat_ws(' — ', p.code, p.title) AS "relatedRecordTitle"
    FROM project_documents pd
    JOIN projects p ON p.id = pd.project_id
    LEFT JOIN users u ON u.id = pd.uploaded_by_id
    LEFT JOIN document_registry_entries dre ON dre.source_kind = 'project_document' AND dre.source_id = pd.id
    WHERE ${projectScope}
    UNION ALL
    SELECT
      'plan'::text AS source, pa.id, pa.file_name AS name, pa.file_name AS "fileName",
      pa.content_type AS "contentType", pa.size, 'active'::text AS status, pa.availability_status AS "availabilityStatus",
      COALESCE(dre.classification, 'Plans & Workplans') AS classification,
      COALESCE(NULLIF(pl.sector, ''), p.sector) AS sector, 'plans'::text AS module,
       pa.plan_id AS "recordId", pl.code AS reference, NULL::text AS "versionLabel", FALSE AS "canManageArchiveLifecycle",
      NULL::text AS description, NULL::date AS "effectiveDate", pa.uploaded_at AS "updatedAt",
      pa.uploaded_at AS "createdAt", u.name AS "uploadedByName",
      COALESCE(dre.confidentiality, 'internal') AS confidentiality, dre.retention_years AS "retentionYears",
       COALESCE(dre.tags, '[]'::jsonb) AS tags, 'plan_attachment'::text AS "sourceKind", 'Plan attachment'::text AS "sourceLabel",
      concat_ws(' — ', pl.code, pl.title) AS "relatedRecordTitle"
    FROM plan_attachments pa
    JOIN plans pl ON pl.id = pa.plan_id
    LEFT JOIN projects p ON p.id = pl.project_id
    LEFT JOIN users u ON u.id = pa.uploaded_by_id
    LEFT JOIN document_registry_entries dre ON dre.source_kind = 'plan_attachment' AND dre.source_id = pa.id
    WHERE ${planScope}
    UNION ALL
    SELECT
      'report'::text AS source, ra.id, ra.file_name AS name, ra.file_name AS "fileName",
      ra.content_type AS "contentType", ra.size,
      CASE WHEN r.status = 'archived' THEN 'archived' ELSE 'active' END AS status, ra.availability_status AS "availabilityStatus",
      COALESCE(dre.classification,
        CASE WHEN COALESCE(r.sections->>'reportingAudience', r.sections->>'reportAudience', '') = 'donor'
                  OR r.kind ILIKE '%donor%' THEN 'Donor Reports' ELSE 'Programme Reports' END) AS classification,
      COALESCE(NULLIF(r.sector, ''), p.sector) AS sector, 'reports'::text AS module,
      ra.report_id AS "recordId", NULL::text AS reference, NULL::text AS "versionLabel", FALSE AS "canManageArchiveLifecycle",
      NULL::text AS description, NULL::date AS "effectiveDate", ra.uploaded_at AS "updatedAt",
      ra.uploaded_at AS "createdAt", u.name AS "uploadedByName",
      COALESCE(dre.confidentiality, 'internal') AS confidentiality, dre.retention_years AS "retentionYears",
       COALESCE(dre.tags, '[]'::jsonb) AS tags, 'report_attachment'::text AS "sourceKind", 'Report attachment'::text AS "sourceLabel",
      r.title AS "relatedRecordTitle"
    FROM report_attachments ra
    JOIN reports r ON r.id = ra.report_id
    LEFT JOIN projects p ON p.id = r.project_id
    LEFT JOIN activities act ON act.id = r.activity_id
    LEFT JOIN users u ON u.id = ra.uploaded_by_id
    LEFT JOIN document_registry_entries dre ON dre.source_kind = 'report_attachment' AND dre.source_id = ra.id
    WHERE ${reportScope}
  `;
}

function publicItem(row: Record<string, unknown>) {
  return {
    source: row.source,
    id: row.id,
    name: row.name,
    fileName: row.fileName,
    contentType: row.contentType,
    size: row.size,
    status: row.status,
    availabilityStatus: row.availabilityStatus === "unavailable" ? "unavailable" : "available",
    classification: row.classification,
    sector: row.sector,
    module: row.module,
    recordId: row.recordId,
    reference: row.reference,
    canManageArchiveLifecycle: row.canManageArchiveLifecycle === true,
    versionLabel: row.versionLabel,
    description: row.description,
    effectiveDate: row.effectiveDate instanceof Date ? row.effectiveDate.toISOString().slice(0, 10) : row.effectiveDate,
    updatedAt: row.updatedAt,
    createdAt: row.createdAt,
    uploadedByName: row.uploadedByName,
    confidentiality: row.confidentiality,
    retentionYears: row.retentionYears,
    tags: Array.isArray(row.tags) ? row.tags : [],
    sourceKind: row.sourceKind,
    sourceLabel: row.sourceLabel,
    relatedRecordTitle: row.relatedRecordTitle,
    previewUrl: row.source === "project"
      ? `/api/projects/${row.recordId}/documents/${row.id}/download`
      : row.source === "report"
        ? `/api/reports/${row.recordId}/attachments/${row.id}/download`
        : `/api/files/${row.source}/${row.id}/preview`,
    downloadUrl: row.source === "project"
      ? `/api/projects/${row.recordId}/documents/${row.id}/download`
      : row.source === "report"
        ? `/api/reports/${row.recordId}/attachments/${row.id}/download`
        : `/api/files/${row.source}/${row.id}/download`,
  };
}

// GET /files — server-side search, filters and bounded deterministic pagination.
router.get("/files", async (req, res, next) => {
  try {
    const { search, source, classification, status = "active", sector, confidentiality, page = "1", pageSize = "25" } =
      req.query as Record<string, string>;
    const safePage = Math.max(1, Math.min(100000, Number.parseInt(page, 10) || 1));
    const safeSize = Math.max(10, Math.min(100, Number.parseInt(pageSize, 10) || 25));
    const params: unknown[] = [];
    const projection = baseProjectionSql(req, params);
    const where: string[] = [];
    if (status !== "all") { params.push(status); where.push(`status = $${params.length}`); }
    if (["resource", "project", "plan", "report"].includes(source)) { params.push(source); where.push(`source = $${params.length}`); }
    if (classification?.trim()) { params.push(classification.trim()); where.push(`classification = $${params.length}`); }
    if (sector?.trim()) { params.push(sector.trim()); where.push(`sector = $${params.length}`); }
    if (confidentiality && CONFIDENTIALITY_VALUES.has(confidentiality)) {
      params.push(confidentiality); where.push(`confidentiality = $${params.length}`);
    }
    if (search?.trim()) {
      params.push(`%${search.trim()}%`);
      where.push(`(name ILIKE $${params.length} OR COALESCE(description, '') ILIKE $${params.length}
        OR COALESCE(classification, '') ILIKE $${params.length} OR COALESCE("relatedRecordTitle", '') ILIKE $${params.length}
        OR COALESCE(tags::text, '') ILIKE $${params.length})`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const counted = await pool.query(`WITH archive_items AS (${projection}) SELECT COUNT(*)::int AS total FROM archive_items ${whereSql}`, params);
    params.push(safeSize, (safePage - 1) * safeSize);
    const listed = await pool.query(
      `WITH archive_items AS (${projection})
       SELECT * FROM archive_items ${whereSql}
       ORDER BY "updatedAt" DESC, source, id DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    res.json({
      items: listed.rows.map(publicItem),
      total: counted.rows[0]?.total ?? 0,
      page: safePage,
      pageSize: safeSize,
    });
  } catch (error) { next(error); }
});

router.get("/files/summary", async (req, res, next) => {
  try {
    const params: unknown[] = [];
    const projection = baseProjectionSql(req, params);
    const result = await pool.query(
      `WITH archive_items AS (${projection})
       SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'active')::int AS active,
              COUNT(*) FILTER (WHERE status = 'archived')::int AS archived
       FROM archive_items`,
      params,
    );
    res.json(result.rows[0] ?? { total: 0, active: 0, archived: 0 });
  } catch (error) { next(error); }
});

router.get("/files/classifications", async (req, res, next) => {
  try {
    const { status = "all", source, search, sector, confidentiality } = req.query as Record<string, string>;
    const projectionParams: unknown[] = [];
    const projection = baseProjectionSql(req, projectionParams);
    const params = [...projectionParams];
    const where: string[] = [];
    if (status === "active" || status === "archived" || status === "deleted") {
      params.push(status);
      where.push(`status = $${params.length}`);
    }
    if (["resource", "project", "plan", "report"].includes(source)) {
      params.push(source);
      where.push(`source = $${params.length}`);
    }
    if (sector?.trim()) { params.push(sector.trim()); where.push(`sector = $${params.length}`); }
    if (confidentiality && CONFIDENTIALITY_VALUES.has(confidentiality)) {
      params.push(confidentiality); where.push(`confidentiality = $${params.length}`);
    }
    if (search?.trim()) {
      params.push(`%${search.trim()}%`);
      where.push(`(name ILIKE $${params.length} OR COALESCE(description, '') ILIKE $${params.length}
        OR COALESCE("relatedRecordTitle", '') ILIKE $${params.length} OR COALESCE(tags::text, '') ILIKE $${params.length})`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const result = await pool.query<{ source: ArchiveSource; classification: string | null; count: number | string }>(
      `WITH archive_items AS (${projection})
       SELECT source, classification, COUNT(*)::int AS count
        FROM archive_items ${whereSql}
        GROUP BY source, classification ORDER BY source, classification`,
      params,
    );
    const counts = new Map<string, number>();
    for (const row of result.rows) {
      if (row.classification) counts.set(row.classification, (counts.get(row.classification) ?? 0) + Number(row.count));
    }

    const classifications: Array<{ source: ArchiveSource; classification: string; count: number }> = [];
    for (const category of DOCUMENT_CLASSIFICATIONS) {
      classifications.push({
        source: "resource",
        classification: category,
        count: counts.get(category) ?? 0,
      });
    }

    const totalsParams = [...projectionParams];
    const totalsWhere: string[] = [];
    if (["resource", "project", "plan", "report"].includes(source)) {
      totalsParams.push(source);
      totalsWhere.push(`source = $${totalsParams.length}`);
    }
    const totalsWhereSql = totalsWhere.length ? `WHERE ${totalsWhere.join(" AND ")}` : "";
    const totals = await pool.query<{ total: number | string; archived: number | string }>(
      `WITH archive_items AS (${projection})
       SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'archived')::int AS archived
       FROM archive_items ${totalsWhereSql}`,
      totalsParams,
    );
    res.json({
      classifications,
      total: Number(totals.rows[0]?.total ?? 0),
      archived: Number(totals.rows[0]?.archived ?? 0),
    });
  } catch (error) { next(error); }
});

async function privateItem(req: Request, source: ArchiveSource, id: number): Promise<PrivateItem | null> {
  if (source === "resource") {
    if (!resourcePermission(req, "program_resources.view")) return null;
    const result = await pool.query<{ id: number; object_path: string; file_name: string; content_type: string | null; availability_status: string }>(
      `SELECT id, object_path, file_name, content_type, availability_status FROM program_resources WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? {
      source, id, objectPath: result.rows[0].object_path,
      fileName: result.rows[0].file_name, contentType: result.rows[0].content_type,
      availabilityStatus: result.rows[0].availability_status,
    } : null;
  }
  if (!archiveViewEnabled(req)) return null;
  if (source === "plan") {
    const params: unknown[] = [];
    const scope = planScopeSql(req, params);
    params.push(id);
    const result = await pool.query<{ id: number; object_path: string; availability_status: string }>(
      `SELECT pa.id, pa.object_path, pa.availability_status
       FROM plan_attachments pa
       JOIN plans pl ON pl.id = pa.plan_id
       LEFT JOIN projects p ON p.id = pl.project_id
       WHERE ${scope} AND pa.id = $${params.length}`,
      params,
    );
    return result.rows[0] ? { source, id, objectPath: result.rows[0].object_path, availabilityStatus: result.rows[0].availability_status } : null;
  }
  return null;
}

async function streamArchiveItem(req: Request, res: Response, source: ArchiveSource, id: number, download: boolean) {
  const item = await privateItem(req, source, id);
  if (!item) { res.status(404).json({ error: "file_not_found" }); return; }
  if (item.availabilityStatus === "unavailable") {
    res.status(410).json({ error: "file_unavailable", message: "File Unavailable" });
    return;
  }
  try {
    const object = await objectStorage.getObjectEntityFile(item.objectPath!);
    const response = await objectStorage.downloadObject(object);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    // A resource ID is stable across replacements while its canonical object
    // changes. Never let a browser reuse an older binary for that stable proxy
    // URL after a replacement or archive/restore lifecycle transition.
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", contentDisposition(item.fileName, download));
    await logAudit({ userId: req.currentUser!.id, action: download ? "file_archive_downloaded" : "file_archive_previewed", module: "files", entityId: id });
    if (response.body) Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
    else res.end();
  } catch (error) {
    if (error instanceof ObjectNotFoundError) { res.status(404).json({ error: "file_not_found" }); return; }
    throw error;
  }
}

router.get("/files/:source/:id/preview", async (req, res, next) => {
  const source = req.params.source === "resource" ? "resource" : req.params.source === "plan" ? "plan" : null;
  const id = integer(req.params.id);
  if (!source || !id) { res.status(404).json({ error: "file_not_found" }); return; }
  try { await streamArchiveItem(req, res, source, id, false); } catch (error) { next(error); }
});

router.get("/files/:source/:id/download", async (req, res, next) => {
  const source = req.params.source === "resource" ? "resource" : req.params.source === "plan" ? "plan" : null;
  const id = integer(req.params.id);
  if (!source || !id) { res.status(404).json({ error: "file_not_found" }); return; }
  try { await streamArchiveItem(req, res, source, id, true); } catch (error) { next(error); }
});

// A single archive upload only creates a resource record via canonical ObjectStorageService.
// Parent-bound attachment workflows stay with their parent modules.
router.post("/files/upload", async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!resourcePermission(req, "documents.upload") && !resourcePermission(req, "program_resources.upload")) {
      res.status(403).json({ error: "forbidden", requiredPermission: "documents.upload" }); return;
    }
    const title = String(req.body?.title ?? "").trim();
    const description = String(req.body?.description ?? "").trim();
    const classification = String(req.body?.classification ?? "").trim();
    const sector = String(req.body?.sector ?? "").trim();
    const confidentiality = String(req.body?.confidentiality ?? "internal").trim();
    const retentionRaw = String(req.body?.retentionYears ?? "").trim();
    const retentionYears = retentionRaw ? Number(retentionRaw) : null;
    const objectPath = String(req.body?.objectPath ?? "");
    const fileName = String(req.body?.fileName ?? "");
    const uploadToken = req.body?.uploadToken;
    const declaredContentType = String(req.body?.contentType ?? "").split(";")[0].trim().toLowerCase();
    let tags: string[] = [];
    if (Array.isArray(req.body?.tags)) {
      tags = req.body.tags;
    } else {
      try { tags = req.body?.tags ? JSON.parse(String(req.body.tags)) : []; } catch { tags = []; }
    }
    if (!title || title.length > 500) { res.status(422).json({ error: "invalid_title" }); return; }
    if (description.length > 20_000) { res.status(422).json({ error: "invalid_description" }); return; }
    if (!CLASSIFICATION_SET.has(classification)) { res.status(422).json({ error: "invalid_classification" }); return; }
    if (!RESOURCE_SECTORS.has(sector)) { res.status(422).json({ error: "invalid_sector" }); return; }
    if (!CONFIDENTIALITY_VALUES.has(confidentiality)) { res.status(422).json({ error: "invalid_confidentiality" }); return; }
    if (!objectPath.startsWith("/objects/uploads/") || !fileName || fileName.length > 255 || /[/\\\u0000-\u001f\u007f]/.test(fileName)) {
      res.status(422).json({ error: "invalid_upload_descriptor" }); return;
    }
    if (typeof uploadToken !== "string") { res.status(400).json({ error: "upload_token_required" }); return; }
    let descriptor;
    try { descriptor = verifyUploadToken(uploadToken); } catch (error) {
      if (error instanceof UploadTokenError) { res.status(400).json({ error: "invalid_upload_token" }); return; }
      throw error;
    }
    if (
      descriptor.userId !== req.currentUser!.id ||
      descriptor.scope !== "documents" ||
      descriptor.reportId !== 0 ||
      descriptor.entityType !== "attachment" ||
      descriptor.objectPath !== objectPath ||
      descriptor.fileName !== fileName ||
      descriptor.contentType !== declaredContentType
    ) { res.status(422).json({ error: "upload_descriptor_mismatch" }); return; }
    if (retentionYears !== null && (!Number.isInteger(retentionYears) || retentionYears < 1 || retentionYears > 100)) {
      res.status(422).json({ error: "invalid_retention_years" }); return;
    }
    if (!Array.isArray(tags) || tags.length > 50 || tags.some((tag) => typeof tag !== "string" || !tag.trim() || tag.length > 100)) {
      res.status(422).json({ error: "invalid_tags" }); return;
    }
    tags = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
    let verified: { size: number; contentType?: string };
    try {
      verified = await objectStorage.getObjectEntityMetadata(objectPath);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) { res.status(422).json({ error: "object_not_found_in_storage" }); return; }
      throw error;
    }
    const contentType = verified.contentType?.split(";")[0].trim().toLowerCase() || declaredContentType || "application/octet-stream";
    if (verified.size !== descriptor.maxSize || verified.size > MAX_ATTACHMENT_BYTES) {
      res.status(422).json({ error: "upload_size_mismatch" }); return;
    }
    if (contentType !== descriptor.contentType) {
      res.status(422).json({ error: "upload_content_type_mismatch" }); return;
    }
    const finalObjectPath = await objectStorage.finalizeObjectEntityUpload(objectPath, "files");
    let inserted: { rows: Array<{ id: number }> };
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      inserted = await client.query<{ id: number }>(
        `INSERT INTO program_resources
          (title, category, sector, description, tags, file_name, content_type, file_size, object_path,
           uploaded_by_id, confidentiality, retention_years)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [title, classification, sector, description || null, JSON.stringify(tags), fileName, contentType, verified.size,
          finalObjectPath, req.currentUser!.id, confidentiality, retentionYears],
      );
      await client.query(
        `INSERT INTO document_registry_entries
          (source_kind, source_id, title, description, classification, confidentiality, retention_years, tags, related_record_type)
         VALUES ('resource', $1, $2, $3, $4, $5, $6, $7::jsonb, 'direct_upload')`,
        [inserted.rows[0].id, title, description || null, classification, confidentiality, retentionYears, JSON.stringify(tags)],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      await objectStorage.deleteObject(finalObjectPath).catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    await logAudit({ userId: req.currentUser!.id, action: "file_archive_uploaded", module: "files", entityId: inserted.rows[0].id });
    await realtime.publishSupportingEvent({
      entityType: "file",
      entityId: inserted.rows[0].id,
      action: "created",
    });
    res.status(201).json({ id: inserted.rows[0].id, source: "resource" });
  } catch (error) { next(error); }
});

router.patch("/files/resource/:id", async (req, res, next) => {
  try {
    const id = integer(req.params.id);
    if (!id) { res.status(404).json({ error: "file_not_found" }); return; }
    if (!resourcePermission(req, "program_resources.edit")) { res.status(403).json({ error: "forbidden" }); return; }
    const { status, title, category, sector, description, versionNumber, effectiveDate, tags } = req.body ?? {};
    if (status !== undefined && !["active", "archived"].includes(status)) { res.status(422).json({ error: "invalid_status" }); return; }
    if (category !== undefined && !CLASSIFICATION_SET.has(category)) { res.status(422).json({ error: "invalid_category" }); return; }
    if (sector !== undefined && !RESOURCE_SECTORS.has(sector)) { res.status(422).json({ error: "invalid_sector" }); return; }
    if (title !== undefined && (typeof title !== "string" || !title.trim() || title.length > 500)) { res.status(422).json({ error: "invalid_title" }); return; }
    if (description !== undefined && (typeof description !== "string" || description.length > 20_000)) { res.status(422).json({ error: "invalid_description" }); return; }
    if (versionNumber !== undefined && (!Number.isInteger(versionNumber) || versionNumber < 1 || versionNumber > 100_000)) { res.status(422).json({ error: "invalid_version_number" }); return; }
    if (effectiveDate !== undefined && (typeof effectiveDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) || Number.isNaN(new Date(`${effectiveDate}T00:00:00.000Z`).getTime()) || new Date(`${effectiveDate}T00:00:00.000Z`).toISOString().slice(0, 10) !== effectiveDate)) { res.status(422).json({ error: "invalid_effective_date" }); return; }
    if (tags !== undefined && (!Array.isArray(tags) || tags.length > 50 || tags.some((tag) => typeof tag !== "string" || !tag.trim() || tag.length > 100))) { res.status(422).json({ error: "invalid_tags" }); return; }
    const updated = await pool.query(
      `UPDATE program_resources SET
        title = COALESCE($1, title), category = COALESCE($2, category), sector = COALESCE($3, sector),
        description = COALESCE($4, description), version_number = COALESCE($5, version_number),
        effective_date = COALESCE($6::date, effective_date), tags = COALESCE($7, tags),
        status = COALESCE($8, status), updated_at = NOW()
       WHERE id = $9 RETURNING id`,
      [title?.trim() || null, category ?? null, sector ?? null, description ?? null, versionNumber ?? null, effectiveDate ?? null, tags ?? null, status ?? null, id],
    );
    if (!updated.rows.length) { res.status(404).json({ error: "file_not_found" }); return; }
    await logAudit({ userId: req.currentUser!.id, action: `file_archive_resource_${status ?? "updated"}`, module: "files", entityId: id });
    await realtime.publishSupportingEvent({
      entityType: "file",
      entityId: id,
      action: status === "archived" ? "archived" : "updated",
    });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

/**
 * Direct archive resources use the same signed, provider-neutral upload
 * contract as their creation flow. Parent-bound attachments deliberately do
 * not use this route: their owning module remains the lifecycle authority.
 */
router.post("/files/resource/:id/replace", async (req, res, next) => {
  try {
    const id = integer(req.params.id);
    if (!id) { res.status(404).json({ error: "file_not_found" }); return; }
    if (!resourcePermission(req, "program_resources.edit")) { res.status(403).json({ error: "forbidden" }); return; }
    const objectPath = String(req.body?.objectPath ?? "");
    const fileName = String(req.body?.fileName ?? "");
    const uploadToken = req.body?.uploadToken;
    const declaredContentType = String(req.body?.contentType ?? "").split(";")[0].trim().toLowerCase();
    if (!objectPath.startsWith("/objects/uploads/") || !fileName || fileName.length > 255 || /[/\\\u0000-\u001f\u007f]/.test(fileName)) {
      res.status(422).json({ error: "invalid_upload_descriptor" }); return;
    }
    if (typeof uploadToken !== "string") { res.status(400).json({ error: "upload_token_required" }); return; }
    let descriptor;
    try { descriptor = verifyUploadToken(uploadToken); } catch (error) {
      if (error instanceof UploadTokenError) { res.status(400).json({ error: "invalid_upload_token" }); return; }
      throw error;
    }
    if (
      descriptor.userId !== req.currentUser!.id ||
      descriptor.scope !== "documents" ||
      descriptor.reportId !== 0 ||
      descriptor.entityType !== "attachment" ||
      descriptor.objectPath !== objectPath ||
      descriptor.fileName !== fileName ||
      descriptor.contentType !== declaredContentType
    ) { res.status(422).json({ error: "upload_descriptor_mismatch" }); return; }
    let verified: { size: number; contentType?: string };
    try {
      verified = await objectStorage.getObjectEntityMetadata(objectPath);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) { res.status(422).json({ error: "object_not_found_in_storage" }); return; }
      throw error;
    }
    const contentType = verified.contentType?.split(";")[0].trim().toLowerCase() || declaredContentType || "application/octet-stream";
    if (verified.size !== descriptor.maxSize || verified.size > MAX_ATTACHMENT_BYTES) {
      res.status(422).json({ error: "upload_size_mismatch" }); return;
    }
    if (contentType !== descriptor.contentType) {
      res.status(422).json({ error: "upload_content_type_mismatch" }); return;
    }
    const client = await pool.connect();
    let finalObjectPath: string | null = null;
    let previousObjectPath: string | null = null;
    try {
      await client.query("BEGIN");
      const existing = await client.query<{ object_path: string; version_number: string | null }>(
        `SELECT object_path, version_number FROM program_resources WHERE id = $1 AND status = 'active' FOR UPDATE`,
        [id],
      );
      if (!existing.rows.length) {
        await client.query("ROLLBACK");
        await objectStorage.deleteObject(objectPath).catch(() => undefined);
        res.status(404).json({ error: "file_not_found" });
        return;
      }
      previousObjectPath = existing.rows[0].object_path;
      const nextVersion = nextResourceFileVersion(existing.rows[0].version_number);
      finalObjectPath = await objectStorage.finalizeObjectEntityUpload(objectPath, "files");
      await client.query(
        `UPDATE program_resources
         SET file_name = $1, content_type = $2, file_size = $3, object_path = $4,
             version_number = $5,
             updated_at = NOW()
         WHERE id = $6`,
        [fileName, contentType, verified.size, finalObjectPath, nextVersion, id],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      await objectStorage.deleteObject(finalObjectPath ?? objectPath).catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    if (previousObjectPath) {
      try {
        await objectStorage.deleteObject(previousObjectPath);
      } catch {
        await logAudit({ userId: req.currentUser!.id, action: "file_archive_resource_replacement_cleanup_failed", module: "files", entityId: id });
      }
    }
    await logAudit({ userId: req.currentUser!.id, action: "file_archive_resource_replaced", module: "files", entityId: id });
    await realtime.publishSupportingEvent({
      entityType: "file",
      entityId: id,
      action: "replaced",
    });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

router.delete("/files/resource/:id", async (req, res, next) => {
  try {
    const id = integer(req.params.id);
    if (!id) { res.status(404).json({ error: "file_not_found" }); return; }
    if (!resourcePermission(req, "program_resources.delete")) { res.status(403).json({ error: "forbidden" }); return; }
    const deleted = await pool.query<{ id: number; object_path: string | null }>(`DELETE FROM program_resources WHERE id = $1 RETURNING id, object_path`, [id]);
    if (!deleted.rows.length) { res.status(404).json({ error: "file_not_found" }); return; }
    await logAudit({ userId: req.currentUser!.id, action: "file_archive_resource_deleted", module: "files", entityId: id });
    if (deleted.rows[0].object_path) {
      try {
        await objectStorage.deleteObject(deleted.rows[0].object_path);
      } catch {
        // The record is no longer addressable. Preserve an explicit audit trail
        // so an administrator can reconcile a provider-side cleanup failure.
        await logAudit({ userId: req.currentUser!.id, action: "file_archive_resource_storage_cleanup_failed", module: "files", entityId: id });
      }
    }
    await realtime.publishSupportingEvent({
      entityType: "file",
      entityId: id,
      action: "deleted",
    });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

export default router;
