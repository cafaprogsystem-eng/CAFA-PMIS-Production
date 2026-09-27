import { Hono, type Context } from "hono";
import type { Bindings, QueryExecutor } from "../lib/db";
import { openDb } from "../lib/db";
import {
  attachCurrentUser,
  requireAuth,
  logAudit,
  hasPerm,
  permissionsFor,
  type CurrentUser,
  type Variables,
} from "../lib/rbac";
import {
  ObjectNotFoundError,
  getObjectEntityFile,
  downloadObject,
  getObjectEntityMetadata,
  finalizeObjectEntityUpload,
  deleteObject,
} from "../lib/storage";
import { nextResourceFileVersion } from "../lib/resource-file-version";
import { verifyUploadToken, UploadTokenError } from "../lib/upload-token";
import { MAX_ATTACHMENT_BYTES } from "../lib/attachment-limits";
import { contentDispositionHeader } from "../lib/content-disposition";
import { hasUnsafeFileNameChar } from "../lib/safe-file-name";

/**
 * Ported from artifacts/api-server/src/routes/files.ts (853 lines) — first
 * file of the attachments group (attachments.ts, drive.ts, files.ts,
 * attachment-reconciliation.ts, historical-storage-import.ts, voice-notes.ts,
 * plus routes/storage.ts, added to the group since it issues the upload
 * tokens attachments.ts/reports.ts/voice-notes.ts all depend on).
 *
 * Filing & Archive is a metadata registry over authoritative attachments. It
 * never takes ownership of a parent record's storage, lifecycle or secure
 * download flow; registry rows simply make those files discoverable. This
 * file is foundational to the group: projectScopeSql/planScopeSql/
 * reportScopeSql are exported for routes/storage.ts (batch 2) to reuse for
 * its own private-object authorization check.
 *
 * Dropped throughout (same reasoning as every prior file):
 * realtime.publishSupportingEvent.
 */

const objectStorageService = {
  getObjectEntityFile,
  downloadObject,
  getObjectEntityMetadata,
  finalizeObjectEntityUpload,
  deleteObject,
};

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
};

function integer(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function archiveManager(user: CurrentUser | undefined): boolean {
  return !!user && ARCHIVE_MANAGERS.has(user.role);
}

function resourcePermission(user: CurrentUser | undefined, permission: string): boolean {
  return !!user && hasPerm(permissionsFor(user), permission);
}

function archiveViewEnabled(user: CurrentUser | undefined): boolean {
  return !!user && (archiveManager(user) || hasPerm(permissionsFor(user), "documents.view"));
}

/**
 * Confidentiality gate for direct-upload program_resources.
 *
 * "public"/"internal" remain visible to anyone holding program_resources.view
 * (today, every authenticated role). "confidential"/"restricted" are visible
 * only to:
 *   - the file's own uploader,
 *   - an ARCHIVE_MANAGERS role (super_admin, executive_director,
 *     program_manager) — the same administrative-override group this file
 *     already uses to bypass project/plan/report scope checks, or
 *   - a State Program Officer, when the resource is tagged with their own
 *     state (program_resources.state_id) — resources with no state tag stay
 *     restricted to uploader + archive managers only.
 * Appends param(s) and returns the SQL fragment to AND into the resource
 * branch's WHERE clause.
 */
export function resourceConfidentialitySql(user: CurrentUser | undefined, params: unknown[]): string {
  if (archiveManager(user)) return "TRUE";
  const uploaderIdx = params.push(user?.id ?? -1);
  const stateClause =
    user?.role === "state_program_officer" && user.stateId != null
      ? ` OR pr.state_id = $${params.push(user.stateId)}`
      : "";
  return `(COALESCE(dre.confidentiality, pr.confidentiality, 'internal') NOT IN ('confidential', 'restricted')
           OR pr.uploaded_by_id = $${uploaderIdx}${stateClause})`;
}

/**
 * Sector scope for direct-upload program_resources.
 *
 * Only technical_coordinator is sector-scoped here, matching the convention
 * projectScopeSql/planScopeSql/reportScopeSql all use — no other role is
 * restricted by sector. "General / Cross-Cutting" is a deliberate
 * not-sector-specific taxonomy value, so it stays visible to every TC rather
 * than becoming permanently invisible to all of them.
 */
export function resourceSectorScopeSql(user: CurrentUser | undefined, params: unknown[]): string {
  if (archiveManager(user)) return "TRUE";
  if (user?.role !== "technical_coordinator") return "TRUE";
  const sectors = user.sectors?.length ? user.sectors : user.sector ? [user.sector] : [];
  if (!sectors.length) return "FALSE";
  params.push(sectors);
  return `(pr.sector = ANY($${params.length}::text[]) OR pr.sector = 'General / Cross-Cutting')`;
}

export function projectScopeSql(user: CurrentUser | undefined, params: unknown[], alias = "p"): string {
  if (archiveManager(user)) return `${alias}.deleted_at IS NULL`;
  if (!archiveViewEnabled(user)) return "FALSE";
  if (user!.role === "technical_coordinator") {
    const sectors = user!.sectors?.length ? user!.sectors : user!.sector ? [user!.sector] : [];
    if (!sectors.length) return "FALSE";
    params.push(sectors);
    return `${alias}.deleted_at IS NULL AND ${alias}.sector = ANY($${params.length}::text[])`;
  }
  if (user!.role === "state_program_officer" || user!.role === "state_office_manager") {
    if (user!.stateId == null) return "FALSE";
    params.push(user!.stateId);
    return `${alias}.deleted_at IS NULL AND EXISTS (
      SELECT 1 FROM project_states ps WHERE ps.project_id = ${alias}.id AND ps.state_id = $${params.length}
    )`;
  }
  return `${alias}.deleted_at IS NULL`;
}

export function reportScopeSql(user: CurrentUser | undefined, params: unknown[]): string {
  if (!resourcePermission(user, "reports.view")) return "FALSE";
  if (archiveManager(user)) return "TRUE";
  if (!archiveViewEnabled(user)) return "FALSE";
  if (user!.role === "technical_coordinator") {
    const sectors = user!.sectors?.length ? user!.sectors : user!.sector ? [user!.sector] : [];
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
  if (user!.role === "state_program_officer" || user!.role === "state_office_manager") {
    if (user!.stateId == null) return "FALSE";
    params.push(user!.stateId);
    return `r.state_id = $${params.length}`;
  }
  return "TRUE";
}

export function planScopeSql(user: CurrentUser | undefined, params: unknown[]): string {
  if (archiveManager(user)) return "TRUE";
  if (!archiveViewEnabled(user)) return "FALSE";
  if (user!.role === "technical_coordinator") {
    const sectors = user!.sectors?.length ? user!.sectors : user!.sector ? [user!.sector] : [];
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
  if (user!.role === "state_program_officer" || user!.role === "state_office_manager") {
    if (user!.stateId == null) return "FALSE";
    params.push(user!.stateId);
    return `pl.location_type IS DISTINCT FROM 'hq' AND pl.state_id = $${params.length}`;
  }
  return "TRUE";
}

function baseProjectionSql(user: CurrentUser | undefined, params: unknown[]): string {
  const projectScope = projectScopeSql(user, params);
  const planScope = planScopeSql(user, params);
  const reportScope = reportScopeSql(user, params);
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
       'direct_upload'::text AS "sourceKind", 'Direct upload'::text AS "sourceLabel", NULL::text AS "relatedRecordTitle",
      s.id AS "stateId", s.name AS "stateName", s.name_ar AS "stateNameAr"
    FROM program_resources pr
    LEFT JOIN users u ON u.id = pr.uploaded_by_id
    LEFT JOIN document_registry_entries dre ON dre.source_kind = 'resource' AND dre.source_id = pr.id
    LEFT JOIN states s ON s.id = pr.state_id
    WHERE ${resourcePermission(user, "program_resources.view") ? "TRUE" : "FALSE"}
      AND ${resourceConfidentialitySql(user, params)}
      AND ${resourceSectorScopeSql(user, params)}
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
      concat_ws(' — ', p.code, p.title) AS "relatedRecordTitle",
      NULL::integer AS "stateId", NULL::text AS "stateName", NULL::text AS "stateNameAr"
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
      concat_ws(' — ', pl.code, pl.title) AS "relatedRecordTitle",
      NULL::integer AS "stateId", NULL::text AS "stateName", NULL::text AS "stateNameAr"
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
      r.title AS "relatedRecordTitle",
      NULL::integer AS "stateId", NULL::text AS "stateName", NULL::text AS "stateNameAr"
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
    stateId: row.stateId,
    stateName: row.stateName,
    stateNameAr: row.stateNameAr,
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

export const filesRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

filesRoutes.use("/files", attachCurrentUser, requireAuth);
filesRoutes.use("/files/*", attachCurrentUser, requireAuth);

// GET /files — server-side search, filters and bounded deterministic pagination.
filesRoutes.get("/files", async (c) => {
  const user = c.get("currentUser");
  const { db, close } = openDb(c);
  try {
    const q = c.req.query();
    const { search, source, classification, status = "active", sector, confidentiality, page = "1", pageSize = "25" } = q;
    const safePage = Math.max(1, Math.min(100000, Number.parseInt(page, 10) || 1));
    const safeSize = Math.max(10, Math.min(100, Number.parseInt(pageSize, 10) || 25));
    const params: unknown[] = [];
    const projection = baseProjectionSql(user, params);
    const where: string[] = [];
    if (status !== "all") { params.push(status); where.push(`status = $${params.length}`); }
    if (source && ["resource", "project", "plan", "report"].includes(source)) { params.push(source); where.push(`source = $${params.length}`); }
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
    const counted = await db.query<{ total: number }>(`WITH archive_items AS (${projection}) SELECT COUNT(*)::int AS total FROM archive_items ${whereSql}`, params);
    params.push(safeSize, (safePage - 1) * safeSize);
    const listed = await db.query<Record<string, unknown>>(
      `WITH archive_items AS (${projection})
       SELECT * FROM archive_items ${whereSql}
       ORDER BY "updatedAt" DESC, source, id DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return c.json({
      items: listed.rows.map(publicItem),
      total: counted.rows[0]?.total ?? 0,
      page: safePage,
      pageSize: safeSize,
    });
  } finally {
    close();
  }
});

filesRoutes.get("/files/summary", async (c) => {
  const user = c.get("currentUser");
  const { db, close } = openDb(c);
  try {
    const params: unknown[] = [];
    const projection = baseProjectionSql(user, params);
    const result = await db.query<{ total: number; active: number; archived: number }>(
      `WITH archive_items AS (${projection})
       SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'active')::int AS active,
              COUNT(*) FILTER (WHERE status = 'archived')::int AS archived
       FROM archive_items`,
      params,
    );
    return c.json(result.rows[0] ?? { total: 0, active: 0, archived: 0 });
  } finally {
    close();
  }
});

filesRoutes.get("/files/classifications", async (c) => {
  const user = c.get("currentUser");
  const { db, close } = openDb(c);
  try {
    const q = c.req.query();
    const { status = "all", source, search, sector, confidentiality } = q;
    const projectionParams: unknown[] = [];
    const projection = baseProjectionSql(user, projectionParams);
    const params = [...projectionParams];
    const where: string[] = [];
    if (status === "active" || status === "archived" || status === "deleted") {
      params.push(status);
      where.push(`status = $${params.length}`);
    }
    if (source && ["resource", "project", "plan", "report"].includes(source)) {
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
    const result = await db.query<{ source: ArchiveSource; classification: string | null; count: number | string }>(
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
    if (source && ["resource", "project", "plan", "report"].includes(source)) {
      totalsParams.push(source);
      totalsWhere.push(`source = $${totalsParams.length}`);
    }
    const totalsWhereSql = totalsWhere.length ? `WHERE ${totalsWhere.join(" AND ")}` : "";
    const totals = await db.query<{ total: number | string; archived: number | string }>(
      `WITH archive_items AS (${projection})
       SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'archived')::int AS archived
       FROM archive_items ${totalsWhereSql}`,
      totalsParams,
    );
    return c.json({
      classifications,
      total: Number(totals.rows[0]?.total ?? 0),
      archived: Number(totals.rows[0]?.archived ?? 0),
    });
  } finally {
    close();
  }
});

async function privateItem(db: QueryExecutor, user: CurrentUser | undefined, source: ArchiveSource, id: number): Promise<PrivateItem | null> {
  if (source === "resource") {
    if (!resourcePermission(user, "program_resources.view")) return null;
    const result = await db.query<{
      id: number; object_path: string; file_name: string; content_type: string | null;
      availability_status: string; confidentiality: string; uploaded_by_id: number | null; state_id: number | null;
      sector: string | null;
    }>(
      `SELECT pr.id, pr.object_path, pr.file_name, pr.content_type, pr.availability_status,
              COALESCE(dre.confidentiality, pr.confidentiality, 'internal') AS confidentiality,
              pr.uploaded_by_id, pr.state_id, pr.sector
       FROM program_resources pr
       LEFT JOIN document_registry_entries dre ON dre.source_kind = 'resource' AND dre.source_id = pr.id
       WHERE pr.id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) return null;
    // Same rule as the listing query's resourceConfidentialitySql: confidential/
    // restricted files are readable only by their uploader, an archive manager,
    // or (when the resource carries a state tag) a State Program Officer for
    // that same state. Return null (→ 404, same as "not found") rather than
    // 403, so a restricted file's existence isn't distinguishable from a
    // nonexistent one.
    const isRestricted = row.confidentiality === "confidential" || row.confidentiality === "restricted";
    const isScopedSpo = user?.role === "state_program_officer" && user.stateId != null && user.stateId === row.state_id;
    if (isRestricted && !archiveManager(user) && row.uploaded_by_id !== user?.id && !isScopedSpo) return null;
    // Same rule as the listing query's resourceSectorScopeSql: a TC may only
    // view a resource in their own sector(s), or one tagged as the
    // not-sector-specific "General / Cross-Cutting" value.
    if (
      user?.role === "technical_coordinator" && !archiveManager(user) &&
      row.sector !== "General / Cross-Cutting" &&
      !(user.sectors?.length ? user.sectors : user.sector ? [user.sector] : []).includes(row.sector ?? "")
    ) return null;
    return {
      source, id, objectPath: row.object_path,
      fileName: row.file_name, contentType: row.content_type,
      availabilityStatus: row.availability_status,
    };
  }
  if (!archiveViewEnabled(user)) return null;
  if (source === "plan") {
    const params: unknown[] = [];
    const scope = planScopeSql(user, params);
    params.push(id);
    const result = await db.query<{ id: number; object_path: string; availability_status: string }>(
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

async function streamArchiveItem(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  db: QueryExecutor,
  user: CurrentUser | undefined,
  source: ArchiveSource,
  id: number,
  download: boolean,
): Promise<Response> {
  const item = await privateItem(db, user, source, id);
  if (!item) return c.json({ error: "file_not_found" }, 404);
  if (item.availabilityStatus === "unavailable") {
    return c.json({ error: "file_unavailable", message: "File Unavailable" }, 410);
  }
  try {
    const object = await objectStorageService.getObjectEntityFile(c.env, item.objectPath!);
    const storageResponse = await objectStorageService.downloadObject(c.env, object);
    const headers = new Headers(storageResponse.headers);
    // A resource ID is stable across replacements while its canonical object
    // changes. Never let a browser reuse an older binary for that stable proxy
    // URL after a replacement or archive/restore lifecycle transition.
    headers.set("Cache-Control", "private, no-store");
    headers.set("Content-Disposition", contentDispositionHeader(item.fileName ?? null, download ? "attachment" : "inline"));
    await logAudit(db, { userId: user!.id, action: download ? "file_archive_downloaded" : "file_archive_previewed", module: "files", entityId: id });
    return new Response(storageResponse.body, { status: storageResponse.status, headers });
  } catch (error) {
    if (error instanceof ObjectNotFoundError) return c.json({ error: "file_not_found" }, 404);
    throw error;
  }
}

filesRoutes.get("/files/:source/:id/preview", async (c) => {
  const user = c.get("currentUser");
  const { db, close } = openDb(c);
  try {
    const paramSource = c.req.param("source");
    const source = paramSource === "resource" ? "resource" : paramSource === "plan" ? "plan" : null;
    const id = integer(c.req.param("id"));
    if (!source || !id) return c.json({ error: "file_not_found" }, 404);
    return await streamArchiveItem(c, db, user, source, id, false);
  } finally {
    close();
  }
});

filesRoutes.get("/files/:source/:id/download", async (c) => {
  const user = c.get("currentUser");
  const { db, close } = openDb(c);
  try {
    const paramSource = c.req.param("source");
    const source = paramSource === "resource" ? "resource" : paramSource === "plan" ? "plan" : null;
    const id = integer(c.req.param("id"));
    if (!source || !id) return c.json({ error: "file_not_found" }, 404);
    return await streamArchiveItem(c, db, user, source, id, true);
  } finally {
    close();
  }
});

// A single archive upload only creates a resource record via canonical object
// storage. Parent-bound attachment workflows stay with their parent modules.
filesRoutes.post("/files/upload", async (c) => {
  const user = c.get("currentUser")!;
  const { db, pool, close } = openDb(c);
  try {
    if (!resourcePermission(user, "documents.upload") && !resourcePermission(user, "program_resources.upload")) {
      return c.json({ error: "forbidden", requiredPermission: "documents.upload" }, 403);
    }
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const title = String(body.title ?? "").trim();
    const description = String(body.description ?? "").trim();
    const classification = String(body.classification ?? "").trim();
    const sector = String(body.sector ?? "").trim();
    const confidentiality = String(body.confidentiality ?? "internal").trim();
    const stateIdRaw = body.stateId;
    const stateId = stateIdRaw === undefined || stateIdRaw === null || stateIdRaw === "" ? null : Number(stateIdRaw);
    const retentionRaw = String(body.retentionYears ?? "").trim();
    const retentionYears = retentionRaw ? Number(retentionRaw) : null;
    const objectPath = String(body.objectPath ?? "");
    const fileName = String(body.fileName ?? "");
    const uploadToken = body.uploadToken;
    const declaredContentType = String(body.contentType ?? "").split(";")[0].trim().toLowerCase();
    let tags: string[] = [];
    if (Array.isArray(body.tags)) {
      tags = body.tags as string[];
    } else {
      try { tags = body.tags ? JSON.parse(String(body.tags)) : []; } catch { tags = []; }
    }
    if (!title || title.length > 500) return c.json({ error: "invalid_title" }, 422);
    if (description.length > 20_000) return c.json({ error: "invalid_description" }, 422);
    if (!CLASSIFICATION_SET.has(classification)) return c.json({ error: "invalid_classification" }, 422);
    if (!RESOURCE_SECTORS.has(sector)) return c.json({ error: "invalid_sector" }, 422);
    if (!CONFIDENTIALITY_VALUES.has(confidentiality)) return c.json({ error: "invalid_confidentiality" }, 422);
    if (stateId !== null && (!Number.isInteger(stateId) || stateId <= 0)) return c.json({ error: "invalid_state_id" }, 422);
    if (!objectPath.startsWith("/objects/uploads/") || !fileName || fileName.length > 255 || hasUnsafeFileNameChar(fileName)) {
      return c.json({ error: "invalid_upload_descriptor" }, 422);
    }
    if (typeof uploadToken !== "string") return c.json({ error: "upload_token_required" }, 400);
    let descriptor;
    try { descriptor = verifyUploadToken(uploadToken, c.env.SESSION_SECRET); } catch (error) {
      if (error instanceof UploadTokenError) return c.json({ error: "invalid_upload_token" }, 400);
      throw error;
    }
    if (
      descriptor.userId !== user.id ||
      descriptor.scope !== "documents" ||
      descriptor.reportId !== 0 ||
      descriptor.entityType !== "attachment" ||
      descriptor.objectPath !== objectPath ||
      descriptor.fileName !== fileName ||
      descriptor.contentType !== declaredContentType
    ) return c.json({ error: "upload_descriptor_mismatch" }, 422);
    if (retentionYears !== null && (!Number.isInteger(retentionYears) || retentionYears < 1 || retentionYears > 100)) {
      return c.json({ error: "invalid_retention_years" }, 422);
    }
    if (!Array.isArray(tags) || tags.length > 50 || tags.some((tag) => typeof tag !== "string" || !tag.trim() || tag.length > 100)) {
      return c.json({ error: "invalid_tags" }, 422);
    }
    tags = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
    if (stateId !== null) {
      const stateCheck = await db.query(`SELECT 1 FROM states WHERE id = $1`, [stateId]);
      if (stateCheck.rows.length === 0) return c.json({ error: "invalid_state_id" }, 422);
    }
    let verified: { size: number; contentType?: string };
    try {
      verified = await objectStorageService.getObjectEntityMetadata(c.env, objectPath);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) return c.json({ error: "object_not_found_in_storage" }, 422);
      throw error;
    }
    const contentType = verified.contentType?.split(";")[0].trim().toLowerCase() || declaredContentType || "application/octet-stream";
    if (verified.size !== descriptor.maxSize || verified.size > MAX_ATTACHMENT_BYTES) {
      return c.json({ error: "upload_size_mismatch" }, 422);
    }
    if (contentType !== descriptor.contentType) {
      return c.json({ error: "upload_content_type_mismatch" }, 422);
    }
    const finalObjectPath = await objectStorageService.finalizeObjectEntityUpload(c.env, objectPath, "files");
    let insertedId: number;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query<{ id: number }>(
        `INSERT INTO program_resources
          (title, category, sector, description, tags, file_name, content_type, file_size, object_path,
           uploaded_by_id, confidentiality, retention_years, state_id)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [title, classification, sector, description || null, JSON.stringify(tags), fileName, contentType, verified.size,
          finalObjectPath, user.id, confidentiality, retentionYears, stateId],
      );
      insertedId = inserted.rows[0].id;
      await client.query(
        `INSERT INTO document_registry_entries
          (source_kind, source_id, title, description, classification, confidentiality, retention_years, tags, related_record_type)
         VALUES ('resource', $1, $2, $3, $4, $5, $6, $7::jsonb, 'direct_upload')`,
        [insertedId, title, description || null, classification, confidentiality, retentionYears, JSON.stringify(tags)],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      await objectStorageService.deleteObject(c.env, finalObjectPath).catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    await logAudit(db, { userId: user.id, action: "file_archive_uploaded", module: "files", entityId: insertedId });
    return c.json({ id: insertedId, source: "resource" }, 201);
  } finally {
    close();
  }
});

filesRoutes.patch("/files/resource/:id", async (c) => {
  const user = c.get("currentUser")!;
  const { db, close } = openDb(c);
  try {
    const id = integer(c.req.param("id"));
    if (!id) return c.json({ error: "file_not_found" }, 404);
    if (!resourcePermission(user, "program_resources.edit")) return c.json({ error: "forbidden" }, 403);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const { status, title, category, sector, description, versionNumber, effectiveDate, tags, stateId } = body as {
      status?: string; title?: string; category?: string; sector?: string; description?: string;
      versionNumber?: number; effectiveDate?: string; tags?: string[]; stateId?: number | string | null;
    };
    if (status !== undefined && !["active", "archived"].includes(status)) return c.json({ error: "invalid_status" }, 422);
    if (category !== undefined && !CLASSIFICATION_SET.has(category)) return c.json({ error: "invalid_category" }, 422);
    if (sector !== undefined && !RESOURCE_SECTORS.has(sector)) return c.json({ error: "invalid_sector" }, 422);
    if (title !== undefined && (typeof title !== "string" || !title.trim() || title.length > 500)) return c.json({ error: "invalid_title" }, 422);
    if (description !== undefined && (typeof description !== "string" || description.length > 20_000)) return c.json({ error: "invalid_description" }, 422);
    if (versionNumber !== undefined && (!Number.isInteger(versionNumber) || versionNumber < 1 || versionNumber > 100_000)) return c.json({ error: "invalid_version_number" }, 422);
    if (effectiveDate !== undefined && (typeof effectiveDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) || Number.isNaN(new Date(`${effectiveDate}T00:00:00.000Z`).getTime()) || new Date(`${effectiveDate}T00:00:00.000Z`).toISOString().slice(0, 10) !== effectiveDate)) return c.json({ error: "invalid_effective_date" }, 422);
    if (tags !== undefined && (!Array.isArray(tags) || tags.length > 50 || tags.some((tag) => typeof tag !== "string" || !tag.trim() || tag.length > 100))) return c.json({ error: "invalid_tags" }, 422);
    // stateId is nullable/optional: absent → leave untouched; null/"" → explicitly
    // clear the state tag; otherwise → must be a real states.id.
    const stateIdTouched = stateId !== undefined;
    let normalizedStateId: number | null = null;
    if (stateIdTouched && stateId !== null && stateId !== "") {
      normalizedStateId = Number(stateId);
      if (!Number.isInteger(normalizedStateId) || normalizedStateId <= 0) return c.json({ error: "invalid_state_id" }, 422);
      const stateCheck = await db.query(`SELECT 1 FROM states WHERE id = $1`, [normalizedStateId]);
      if (stateCheck.rows.length === 0) return c.json({ error: "invalid_state_id" }, 422);
    }
    const updated = await db.query<{ id: number }>(
      `UPDATE program_resources SET
        title = COALESCE($1, title), category = COALESCE($2, category), sector = COALESCE($3, sector),
        description = COALESCE($4, description), version_number = COALESCE($5, version_number),
        effective_date = COALESCE($6::date, effective_date), tags = COALESCE($7, tags),
        status = COALESCE($8, status), state_id = CASE WHEN $10::boolean THEN $11::integer ELSE state_id END,
        updated_at = NOW()
       WHERE id = $9 RETURNING id`,
      [title?.trim() || null, category ?? null, sector ?? null, description ?? null, versionNumber ?? null, effectiveDate ?? null, tags ?? null, status ?? null, id, stateIdTouched, normalizedStateId],
    );
    if (!updated.rows.length) return c.json({ error: "file_not_found" }, 404);
    await logAudit(db, { userId: user.id, action: `file_archive_resource_${status ?? "updated"}`, module: "files", entityId: id });
    return c.json({ ok: true });
  } finally {
    close();
  }
});

/**
 * Direct archive resources use the same signed, provider-neutral upload
 * contract as their creation flow. Parent-bound attachments deliberately do
 * not use this route: their owning module remains the lifecycle authority.
 */
filesRoutes.post("/files/resource/:id/replace", async (c) => {
  const user = c.get("currentUser")!;
  const { db, pool, close } = openDb(c);
  try {
    const id = integer(c.req.param("id"));
    if (!id) return c.json({ error: "file_not_found" }, 404);
    if (!resourcePermission(user, "program_resources.edit")) return c.json({ error: "forbidden" }, 403);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const objectPath = String(body.objectPath ?? "");
    const fileName = String(body.fileName ?? "");
    const uploadToken = body.uploadToken;
    const declaredContentType = String(body.contentType ?? "").split(";")[0].trim().toLowerCase();
    if (!objectPath.startsWith("/objects/uploads/") || !fileName || fileName.length > 255 || hasUnsafeFileNameChar(fileName)) {
      return c.json({ error: "invalid_upload_descriptor" }, 422);
    }
    if (typeof uploadToken !== "string") return c.json({ error: "upload_token_required" }, 400);
    let descriptor;
    try { descriptor = verifyUploadToken(uploadToken, c.env.SESSION_SECRET); } catch (error) {
      if (error instanceof UploadTokenError) return c.json({ error: "invalid_upload_token" }, 400);
      throw error;
    }
    if (
      descriptor.userId !== user.id ||
      descriptor.scope !== "documents" ||
      descriptor.reportId !== 0 ||
      descriptor.entityType !== "attachment" ||
      descriptor.objectPath !== objectPath ||
      descriptor.fileName !== fileName ||
      descriptor.contentType !== declaredContentType
    ) return c.json({ error: "upload_descriptor_mismatch" }, 422);
    let verified: { size: number; contentType?: string };
    try {
      verified = await objectStorageService.getObjectEntityMetadata(c.env, objectPath);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) return c.json({ error: "object_not_found_in_storage" }, 422);
      throw error;
    }
    const contentType = verified.contentType?.split(";")[0].trim().toLowerCase() || declaredContentType || "application/octet-stream";
    if (verified.size !== descriptor.maxSize || verified.size > MAX_ATTACHMENT_BYTES) {
      return c.json({ error: "upload_size_mismatch" }, 422);
    }
    if (contentType !== descriptor.contentType) {
      return c.json({ error: "upload_content_type_mismatch" }, 422);
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
        await objectStorageService.deleteObject(c.env, objectPath).catch(() => undefined);
        return c.json({ error: "file_not_found" }, 404);
      }
      previousObjectPath = existing.rows[0].object_path;
      const nextVersion = nextResourceFileVersion(existing.rows[0].version_number);
      finalObjectPath = await objectStorageService.finalizeObjectEntityUpload(c.env, objectPath, "files");
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
      await objectStorageService.deleteObject(c.env, finalObjectPath ?? objectPath).catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    if (previousObjectPath) {
      try {
        await objectStorageService.deleteObject(c.env, previousObjectPath);
      } catch {
        await logAudit(db, { userId: user.id, action: "file_archive_resource_replacement_cleanup_failed", module: "files", entityId: id });
      }
    }
    await logAudit(db, { userId: user.id, action: "file_archive_resource_replaced", module: "files", entityId: id });
    return c.json({ ok: true });
  } finally {
    close();
  }
});

filesRoutes.delete("/files/resource/:id", async (c) => {
  const user = c.get("currentUser")!;
  const { db, pool, close } = openDb(c);
  try {
    const id = integer(c.req.param("id"));
    if (!id) return c.json({ error: "file_not_found" }, 404);
    if (!resourcePermission(user, "program_resources.delete")) return c.json({ error: "forbidden" }, 403);
    const client = await pool.connect();
    let deletedRow: { id: number; object_path: string | null } | undefined;
    try {
      await client.query("BEGIN");
      // The registry is a dependent index, not a document owner (same pattern
      // as projects.ts/reports.ts) — remove its entry in the same transaction
      // before removing the row it indexes, so a direct-upload delete never
      // leaves an orphaned document_registry_entries row behind.
      await client.query(
        `DELETE FROM document_registry_entries WHERE source_kind = 'resource' AND source_id = $1`,
        [id],
      );
      const deleted = await client.query<{ id: number; object_path: string | null }>(
        `DELETE FROM program_resources WHERE id = $1 RETURNING id, object_path`,
        [id],
      );
      deletedRow = deleted.rows[0];
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    if (!deletedRow) return c.json({ error: "file_not_found" }, 404);
    await logAudit(db, { userId: user.id, action: "file_archive_resource_deleted", module: "files", entityId: id });
    if (deletedRow.object_path) {
      try {
        await objectStorageService.deleteObject(c.env, deletedRow.object_path);
      } catch {
        // The record is no longer addressable. Preserve an explicit audit trail
        // so an administrator can reconcile a provider-side cleanup failure.
        await logAudit(db, { userId: user.id, action: "file_archive_resource_storage_cleanup_failed", module: "files", entityId: id });
      }
    }
    return c.json({ ok: true });
  } finally {
    close();
  }
});
