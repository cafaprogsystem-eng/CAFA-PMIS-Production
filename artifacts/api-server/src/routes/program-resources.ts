import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { logAudit, requirePerm } from "../middlewares/currentUser";
import { PR_SECTOR_SET } from "../lib/sectors";
import { realtime } from "../lib/realtime";

const router: IRouter = Router();

const VALID_CATEGORIES = new Set([
  "SOPs", "Policies", "Templates", "Guidelines", "Manuals", "Technical Resources",
]);
// Program Resources uses the canonical 7 Main Sectors + "General / Cross-Cutting"
const VALID_SECTORS = PR_SECTOR_SET;

// Normalise a PG date column value to YYYY-MM-DD or null.
function normDate(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

// ── GET /program-resources/stats ─────────────────────────────────────────────
router.get("/program-resources/stats", async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'active')                                     AS total,
        COUNT(*) FILTER (WHERE status = 'active' AND category = 'SOPs')              AS sops,
        COUNT(*) FILTER (WHERE status = 'active' AND category = 'Policies')          AS policies,
        COUNT(*) FILTER (WHERE status = 'active' AND category = 'Templates')         AS templates,
        COUNT(*) FILTER (WHERE status = 'active' AND category = 'Guidelines')        AS guidelines,
        COUNT(*) FILTER (WHERE status = 'active' AND category = 'Manuals')           AS manuals,
        COUNT(*) FILTER (WHERE status = 'active' AND category = 'Technical Resources') AS technical_resources,
        (
          SELECT COALESCE(json_agg(r ORDER BY r.updated_at DESC), '[]'::json)
          FROM (
            SELECT pr.id, pr.title, pr.category, pr.updated_at
            FROM program_resources pr WHERE pr.status = 'active'
            ORDER BY pr.updated_at DESC LIMIT 5
          ) r
        ) AS recently_updated
      FROM program_resources
    `);
    const r = rows[0];
    res.json({
      total:             Number(r.total),
      sops:              Number(r.sops),
      policies:          Number(r.policies),
      templates:         Number(r.templates),
      guidelines:        Number(r.guidelines),
      manuals:           Number(r.manuals),
      technicalResources: Number(r.technical_resources),
      recentlyUpdated:   r.recently_updated ?? [],
    });
  } catch (err) { next(err); }
});

// ── GET /program-resources/uploaders ─────────────────────────────────────────
// Deduplicated list of users who have uploaded at least one resource.
router.get("/program-resources/uploaders", async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT DISTINCT u.id, u.name
      FROM program_resources pr
      JOIN users u ON u.id = pr.uploaded_by_id
      ORDER BY u.name
    `);
    res.json(rows);
  } catch (err) { next(err); }
});

// ── GET /program-resources ────────────────────────────────────────────────────
router.get("/program-resources", async (req, res, next) => {
  try {
    const { search, category, sector, uploadedBy, dateFrom, dateTo, status } = req.query as Record<string, string>;
    const params: unknown[] = [];
    const where: string[] = [];

    const statusFilter = status === "all" ? null : (status || "active");
    if (statusFilter) {
      params.push(statusFilter);
      where.push(`pr.status = $${params.length}`);
    }

    if (search?.trim()) {
      params.push(`%${search.trim().toLowerCase()}%`);
      const i = params.length;
      where.push(
        `(LOWER(pr.title) LIKE $${i} OR LOWER(COALESCE(pr.description,'')) LIKE $${i} OR LOWER(COALESCE(pr.tags,'')) LIKE $${i})`,
      );
    }
    if (category) { params.push(category); where.push(`pr.category = $${params.length}`); }
    if (sector)   { params.push(sector);   where.push(`pr.sector = $${params.length}`); }
    if (uploadedBy) { params.push(Number(uploadedBy)); where.push(`pr.uploaded_by_id = $${params.length}`); }
    if (dateFrom) { params.push(dateFrom); where.push(`pr.effective_date >= $${params.length}::date`); }
    if (dateTo)   { params.push(dateTo);   where.push(`pr.effective_date <= $${params.length}::date`); }

    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const { rows } = await pool.query(`
      SELECT
        pr.id,
        pr.title,
        pr.category,
        pr.sector,
        pr.description,
        pr.version_number  AS "versionNumber",
        pr.effective_date  AS "effectiveDate",
        pr.tags,
        pr.file_name       AS "fileName",
        pr.content_type    AS "contentType",
        pr.file_size       AS "fileSize",
        pr.object_path     AS "objectPath",
        pr.status,
        pr.created_at      AS "createdAt",
        pr.updated_at      AS "updatedAt",
        u.id               AS "uploadedById",
        u.name             AS "uploadedByName"
      FROM program_resources pr
      LEFT JOIN users u ON u.id = pr.uploaded_by_id
      ${clause}
      ORDER BY pr.updated_at DESC
    `, params);

    const resources = rows.map((r) => ({
      ...r,
      effectiveDate: normDate(r.effectiveDate),
    }));

    res.json({ resources, total: resources.length });
  } catch (err) { next(err); }
});

// ── GET /program-resources/:id ────────────────────────────────────────────────
router.get("/program-resources/:id", async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        pr.id,
        pr.title,
        pr.category,
        pr.sector,
        pr.description,
        pr.version_number  AS "versionNumber",
        pr.effective_date  AS "effectiveDate",
        pr.tags,
        pr.file_name       AS "fileName",
        pr.content_type    AS "contentType",
        pr.file_size       AS "fileSize",
        pr.object_path     AS "objectPath",
        pr.status,
        pr.created_at      AS "createdAt",
        pr.updated_at      AS "updatedAt",
        u.id               AS "uploadedById",
        u.name             AS "uploadedByName"
      FROM program_resources pr
      LEFT JOIN users u ON u.id = pr.uploaded_by_id
      WHERE pr.id = $1
    `, [req.params.id]);

    if (!rows.length) { res.status(404).json({ error: "not_found" }); return; }
    res.json({ ...rows[0], effectiveDate: normDate(rows[0].effectiveDate) });
  } catch (err) { next(err); }
});

// ── POST /program-resources ───────────────────────────────────────────────────
router.post("/program-resources", requirePerm("program_resources.upload"), async (req, res, next) => {
  try {
    const user = req.currentUser!;
    const { title, category, sector, description, versionNumber, effectiveDate, tags, fileName, contentType, fileSize, objectPath } = req.body ?? {};

    if (!title?.trim())                            { res.status(400).json({ error: "title_required" }); return; }
    if (!category || !VALID_CATEGORIES.has(category)) { res.status(400).json({ error: "invalid_category" }); return; }
    if (!sector   || !VALID_SECTORS.has(sector))   { res.status(400).json({ error: "invalid_sector" }); return; }
    if (!fileName || !objectPath)                  { res.status(400).json({ error: "file_required" }); return; }

    const { rows } = await pool.query(`
      INSERT INTO program_resources
        (title, category, sector, description, version_number, effective_date, tags,
         file_name, content_type, file_size, object_path, uploaded_by_id)
      VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8, $9, $10, $11, $12)
      RETURNING id, title, category, created_at AS "createdAt"
    `, [
      title.trim(), category, sector,
      description ?? null, versionNumber ?? null,
      effectiveDate ?? null, tags ?? null,
      fileName, contentType ?? null, fileSize ?? null, objectPath,
      user.id,
    ]);

    await logAudit({ userId: user.id, action: "program_resource_created", module: "program_resources", entityId: rows[0].id });
    await realtime.publishSupportingEvent({
      entityType: "program_resource",
      entityId: rows[0].id,
      action: "created",
    });
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// ── PATCH /program-resources/:id ─────────────────────────────────────────────
router.patch("/program-resources/:id", requirePerm("program_resources.edit"), async (req, res, next) => {
  try {
    const user = req.currentUser!;
    const id = Number(req.params.id);
    const { rows: ex } = await pool.query(`SELECT id FROM program_resources WHERE id = $1`, [id]);
    if (!ex.length) { res.status(404).json({ error: "not_found" }); return; }

    const { title, category, sector, description, versionNumber, effectiveDate, tags, status, fileName, contentType, fileSize, objectPath } = req.body ?? {};

    if (category && !VALID_CATEGORIES.has(category)) { res.status(400).json({ error: "invalid_category" }); return; }
    if (sector   && !VALID_SECTORS.has(sector))   { res.status(400).json({ error: "invalid_sector" }); return; }
    if (status   && !["active", "archived"].includes(status)) { res.status(400).json({ error: "invalid_status" }); return; }

    await pool.query(`
      UPDATE program_resources SET
        title          = COALESCE($1,  title),
        category       = COALESCE($2,  category),
        sector         = COALESCE($3,  sector),
        description    = COALESCE($4,  description),
        version_number = COALESCE($5,  version_number),
        effective_date = COALESCE($6::date, effective_date),
        tags           = COALESCE($7,  tags),
        status         = COALESCE($8,  status),
        file_name      = COALESCE($9,  file_name),
        content_type   = COALESCE($10, content_type),
        file_size      = COALESCE($11, file_size),
        object_path    = COALESCE($12, object_path),
        updated_at     = NOW()
      WHERE id = $13
    `, [
      title ?? null, category ?? null, sector ?? null, description ?? null,
      versionNumber ?? null, effectiveDate ?? null, tags ?? null, status ?? null,
      fileName ?? null, contentType ?? null, fileSize ?? null, objectPath ?? null,
      id,
    ]);

    await logAudit({ userId: user.id, action: "program_resource_updated", module: "program_resources", entityId: id });
    await realtime.publishSupportingEvent({
      entityType: "program_resource",
      entityId: id,
      action: "updated",
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── DELETE /program-resources/:id ────────────────────────────────────────────
router.delete("/program-resources/:id", requirePerm("program_resources.delete"), async (req, res, next) => {
  try {
    const user = req.currentUser!;
    const id = Number(req.params.id);
    const { rows } = await pool.query(`DELETE FROM program_resources WHERE id = $1 RETURNING id`, [id]);
    if (!rows.length) { res.status(404).json({ error: "not_found" }); return; }
    await logAudit({ userId: user.id, action: "program_resource_deleted", module: "program_resources", entityId: id });
    await realtime.publishSupportingEvent({
      entityType: "program_resource",
      entityId: id,
      action: "deleted",
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
