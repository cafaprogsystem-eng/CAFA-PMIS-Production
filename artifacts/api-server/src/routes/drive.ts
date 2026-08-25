import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { Readable } from "stream";
import { pool } from "@workspace/db";
import { logAudit, assertSectorAllowed, permissionsFor, hasPerm } from "../middlewares/currentUser";
import {
  uploadFile,
  downloadFileStream,
  archiveFile,
  deleteFile,
  testConnection,
  isConfigured as isS3Configured,
  getConfigStatus,
  batchPresignedUrls,
  buildObjectKey,
  MAX_ATTACHMENT_BYTES,
} from "../lib/awsS3";

const router: IRouter = Router();

// ── Multer ─────────────────────────────────────────────────────────────────
const BLOCKED_MIME = new Set([
  "application/x-sh",
  "application/x-executable",
  "text/x-shellscript",
  "application/x-msdownload",
  "application/x-httpd-php",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ATTACHMENT_BYTES },
  fileFilter: (_req, file, cb) => {
    if (BLOCKED_MIME.has(file.mimetype)) { cb(new Error("file_type_not_allowed")); return; }
    cb(null, true);
  },
});

// ── Auth guards ────────────────────────────────────────────────────────────
function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.currentUser) { res.status(401).json({ error: "unauthorized" }); return; }
  next();
}

const ADMIN_ROLES = new Set(["super_admin", "executive_director", "program_manager"]);
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.currentUser) { res.status(401).json({ error: "unauthorized" }); return; }
  if (!ADMIN_ROLES.has(req.currentUser.role)) { res.status(403).json({ error: "forbidden" }); return; }
  next();
}

// ── RISK-004: parent-Risk access guard for module='risks' operations ───────
// Drive rows are generic (module + record_id); for risk attachments the access
// decision must come from the PARENT RISK's canonical access rules, not from
// the drive_file's own state/sector metadata (which is caller-supplied at
// upload time and therefore untrustworthy).
// Canonical Risk access (mirrors PATCH /risks/:riskId and /risks/:riskId/history):
//   • 404 when the risk does not exist (or recordId is malformed)
//   • TC sector scope via the linked project's primary sector ONLY
//     (standalone risk → null sector → TC fails closed)
//   • SPO/SOM clamped to own state; null stateId fails closed
//   • PM / super_admin pass (Full Operational Access, Task #373)
type RiskRowForDrive = { stateId: number | null; projectId: number | null; sector: string | null };
type RiskAccessResult =
  | { ok: true; risk: RiskRowForDrive }
  | { ok: false; status: number; body: object };

async function assertRiskAccessForDriveOperation(req: Request, recordId: unknown): Promise<RiskAccessResult> {
  const riskId = Number(recordId);
  if (!Number.isInteger(riskId) || riskId <= 0) {
    return { ok: false, status: 404, body: { error: "risk_not_found" } };
  }
  const r = await pool.query<RiskRowForDrive>(
    `SELECT r.state_id AS "stateId", r.project_id AS "projectId", p.sector
     FROM risks r LEFT JOIN projects p ON p.id = r.project_id WHERE r.id = $1`,
    [riskId],
  );
  const risk = r.rows[0];
  if (!risk) return { ok: false, status: 404, body: { error: "risk_not_found" } };

  const guard = assertSectorAllowed(req, risk.sector);
  if (!guard.ok) return guard;

  const u = req.currentUser!;
  if (u.role === "state_program_officer" || u.role === "state_office_manager") {
    if (u.stateId == null || risk.stateId !== u.stateId) {
      return { ok: false, status: 403, body: { error: "state_forbidden" } };
    }
  }
  return { ok: true, risk };
}

// Mutations (upload / delete / replace) on risk attachments additionally
// require risk mutation authority. PM holds risks.update via Full Operational
// Access grants; super_admin via the "*" wildcard.
function hasRiskMutationPerm(req: Request): boolean {
  return hasPerm(permissionsFor(req.currentUser!), "risks.update");
}

// RISK-004 DTO allow-list: risk attachment responses expose only user-facing
// fields. Internal/structural fields (driveFileId S3 key, recordId, projectId,
// sector, visibilityLevel, permissionLevel, parentFileId, uploadedByUserId)
// are stripped for the risks module.
function riskAttachmentDto(r: Record<string, unknown>): Record<string, unknown> {
  return {
    id: r.id,
    name: r.name,
    mimeType: r.mimeType,
    size: r.size,
    status: r.status,
    createdAt: r.createdAt,
    uploaderName: r.uploaderName ?? null,
    uploaderRole: r.uploaderRole ?? null,
    driveLink: r.driveLink,
    versionNumber: r.versionNumber,
  };
}

// Strip path separators and control characters from download filenames before
// they reach the Content-Disposition header.
function sanitiseFilename(name: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[/\\\u0000-\u001f\u007f]/g, "_").trim();
  return cleaned || "download";
}

// ── POST /drive/upload ─────────────────────────────────────────────────────
router.post("/drive/upload", requireAuth, upload.single("file"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!isS3Configured()) {
      const s = getConfigStatus();
      res.status(503).json({
        error: "storage_not_configured",
        message: "AWS S3 storage is not configured",
        hint: !s.hasRegion
          ? "AWS_REGION is not set"
          : !s.hasBucket
          ? "AWS_S3_BUCKET is not set"
          : !s.hasAccessKey || !s.hasSecretKey
          ? "AWS_ACCESS_KEY_ID or AWS_SECRET_ACCESS_KEY is not set"
          : "Check server logs for configuration details",
      });
      return;
    }

    if (!req.file) { res.status(400).json({ error: "file_required" }); return; }
    if (req.file.size > MAX_ATTACHMENT_BYTES) {
      res.status(413).json({ error: "file_too_large", limitMB: Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024) });
      return;
    }

    const {
      module = "attachments",
      recordId,
      projectId,
      projectCode,
      stateName,
      sector,
      visibilityLevel = "internal",
      permissionLevel = "view",
    } = req.body as Record<string, string>;

    const user = req.currentUser!;

    // RISK-004: risk attachments require an accessible parent risk plus risk
    // mutation authority. The server derives state/sector/project from the
    // loaded risk record — caller-supplied values are ignored for risks.
    let riskParent: RiskRowForDrive | null = null;
    if (module === "risks") {
      const access = await assertRiskAccessForDriveOperation(req, recordId);
      if (!access.ok) { res.status(access.status).json(access.body); return; }
      if (!hasRiskMutationPerm(req)) {
        res.status(403).json({ error: "forbidden", requiredPermission: "risks.update" });
        return;
      }
      riskParent = access.risk;
    }

    // Build S3 key with module prefix
    const key = buildObjectKey(module, req.file.originalname);

    const result = await uploadFile({
      key,
      module,
      name: req.file.originalname,
      mimeType: req.file.mimetype,
      buffer: req.file.buffer,
    });

    // Persist metadata — drive_file_id stores the S3 object key,
    // drive_link stores the same key (presigned URL generated at read time).
    //
    // RISK-005 (concurrency): drive_files has no DB-level FK to risks, so a
    // risk-attachment upload racing a project permanent delete could
    // otherwise orphan metadata (the parent-risk check reads before the
    // delete commits, the INSERT lands after the cascade purge). For
    // module='risks' the INSERT runs in a transaction that re-locks the
    // parent risk row: the delete cascade's DELETE FROM risks blocks on this
    // lock until the upload commits (and its purge then sees the committed
    // row); an upload arriving after the risks delete blocks, fails closed,
    // and its already-uploaded physical object is removed best-effort.
    const insertSql = `INSERT INTO drive_files
         (drive_file_id, drive_link, name, mime_type, size, module, record_id, project_id,
          uploaded_by_user_id, user_role, state_id, sector, visibility_level, permission_level)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING id, drive_file_id AS "driveFileId", drive_link AS "driveLink", name,
                 mime_type AS "mimeType", size, module, record_id AS "recordId",
                 uploaded_by_user_id AS "uploadedByUserId", status, version_number AS "versionNumber",
                 created_at AS "createdAt"`;
    const insertParams = [
      result.fileKey,
      result.fileKey,     // store key in drive_link; presigned URL generated at read time
      result.fileName,
      req.file.mimetype,
      result.fileSize,
      module,
      recordId ? Number(recordId) : null,
      riskParent ? riskParent.projectId : (projectId ? Number(projectId) : null),
      user.id,
      user.role,
      riskParent ? riskParent.stateId : (user.stateId ?? null),
      riskParent ? riskParent.sector : (sector ?? user.sector ?? null),
      visibilityLevel,
      permissionLevel,
    ];

    let rows: Record<string, unknown>[];
    if (module === "risks") {
      const txClient = await pool.connect();
      try {
        await txClient.query("BEGIN");
        const lockCheck = await txClient.query(
          `SELECT 1 FROM risks WHERE id = $1 FOR UPDATE`,
          [Number(recordId)],
        );
        if (lockCheck.rows.length === 0) {
          await txClient.query("ROLLBACK");
          // Parent risk vanished (e.g. project permanent delete) — remove the
          // freshly uploaded physical object best-effort and fail closed.
          await deleteFile(result.fileKey).catch(() => {});
          res.status(404).json({ error: "risk_not_found" });
          return;
        }
        const inserted = await txClient.query(insertSql, insertParams);
        rows = inserted.rows;
        await txClient.query("COMMIT");
      } catch (txErr) {
        await txClient.query("ROLLBACK").catch(() => {});
        // Metadata was not committed — remove the already-uploaded physical
        // object best-effort so the failure leaves no orphaned storage.
        await deleteFile(result.fileKey).catch(() => {});
        throw txErr;
      } finally {
        txClient.release();
      }
    } else {
      ({ rows } = await pool.query(insertSql, insertParams));
    }

    // Registry indexing records the relationship only; it never creates a
    // second object. Plan ownership and its secure attachment flow stay here.
    if (module === "plans" && recordId && rows[0]?.id) {
      await pool.query(
        `INSERT INTO document_registry_entries
          (source_kind, source_id, classification, confidentiality, related_record_type, related_record_id)
         VALUES ('drive_file', $1, 'Plans & Workplans', 'internal', 'plan', $2)
         ON CONFLICT (source_kind, source_id) DO NOTHING`,
        [rows[0].id, Number(recordId)],
      );
    }

    await logAudit({ userId: user.id, action: "file_uploaded", module: "drive", entityId: rows[0].id as number });

    // RISK-004: allow-list DTO for risk attachments (no internal fields).
    // driveLink at insert time still holds the raw S3 key (presigned URLs are
    // generated at read time), so it is nulled for the risks DTO.
    res.json({
      ok: true,
      file: module === "risks" ? { ...riskAttachmentDto(rows[0]), driveLink: null } : rows[0],
    });
  } catch (err) { next(err); }
});

// ── GET /drive/files ───────────────────────────────────────────────────────
router.get("/drive/files", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { module, recordId, projectId, status = "active", search, limit = "50", offset = "0" } =
      req.query as Record<string, string>;
    const user = req.currentUser!;

    // RISK-004: listing risk attachments requires access to the parent risk.
    // The parent-risk check supersedes the drive_file metadata filters below,
    // which act on caller-supplied upload metadata rather than the risk itself.
    if (module === "risks") {
      const access = await assertRiskAccessForDriveOperation(req, recordId);
      if (!access.ok) { res.status(access.status).json(access.body); return; }
    }

    const params: unknown[] = [];
    const where: string[] = ["df.status = $1"];
    params.push(status);

    if (module) { params.push(module); where.push(`df.module = $${params.length}`); }
    if (recordId) { params.push(Number(recordId)); where.push(`df.record_id = $${params.length}`); }
    if (projectId) { params.push(Number(projectId)); where.push(`df.project_id = $${params.length}`); }
    if (search) { params.push(`%${search}%`); where.push(`df.name ILIKE $${params.length}`); }

    if (user.role === "state_office_manager" || user.role === "state_program_officer") {
      params.push(user.stateId); where.push(`df.state_id = $${params.length}`);
    }
    if (user.role === "technical_coordinator" && user.sectors?.length) {
      params.push(user.sectors); where.push(`df.sector = ANY($${params.length}::text[])`);
    }

    // RISK-004: parent-risk authorisation applied at SQL level, so BOTH the
    // page and the total count are computed over the accessible set only —
    // inaccessible risk rows cannot leak through pagination totals or hide
    // accessible records behind dropped page entries. Orphaned risk rows
    // (no matching parent risk) fail closed for scoped roles via EXISTS.
    if (module !== "risks") {
      if (user.role === "state_program_officer" || user.role === "state_office_manager") {
        if (user.stateId == null) {
          where.push(`df.module <> 'risks'`);
        } else {
          params.push(user.stateId);
          where.push(
            `(df.module <> 'risks' OR EXISTS (SELECT 1 FROM risks r WHERE r.id = df.record_id AND r.state_id = $${params.length}))`,
          );
        }
      } else if (user.role === "technical_coordinator") {
        const tcSectors = user.sectors?.length ? user.sectors : user.sector ? [user.sector] : [];
        if (!tcSectors.length) {
          where.push(`df.module <> 'risks'`);
        } else {
          params.push(tcSectors);
          where.push(
            `(df.module <> 'risks' OR EXISTS (SELECT 1 FROM risks r JOIN projects p ON p.id = r.project_id WHERE r.id = df.record_id AND p.sector = ANY($${params.length}::text[])))`,
          );
        }
      }
    }

    params.push(Number(limit), Number(offset));

    const { rows } = await pool.query(
      `SELECT df.id, df.drive_file_id AS "driveFileId", df.drive_link AS "driveLink",
              df.name, df.mime_type AS "mimeType", df.size, df.module, df.record_id AS "recordId",
              df.project_id AS "projectId", df.status, df.visibility_level AS "visibilityLevel",
              df.permission_level AS "permissionLevel", df.version_number AS "versionNumber",
              df.parent_file_id AS "parentFileId", df.sector, df.created_at AS "createdAt",
              u.name AS "uploaderName", u.role AS "uploaderRole"
       FROM drive_files df
       LEFT JOIN users u ON u.id = df.uploaded_by_user_id
       WHERE ${where.join(" AND ")}
       ORDER BY df.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total FROM drive_files df WHERE ${where.join(" AND ")}`,
      params.slice(0, params.length - 2),
    );

    let files: Record<string, unknown>[] = rows;
    const total: number = countRes.rows[0]?.total ?? 0;

    // Generate presigned URLs so the frontend "Open" button works.
    // RISK-004: risk rows NEVER fall back to the persisted drive_link (raw S3
    // object key) — an unavailable presign yields null for them.
    if (isS3Configured() && files.length > 0) {
      const keys = files.map((r) => r.driveFileId).filter(Boolean) as string[];
      const presigned = await batchPresignedUrls(keys);
      files = files.map((r) => ({
        ...r,
        driveLink:
          (typeof r.driveFileId === "string" && presigned.get(r.driveFileId)) ||
          (r.module === "risks" ? null : r.driveLink),
      }));
    } else {
      files = files.map((r) => (r.module === "risks" ? { ...r, driveLink: null } : r));
    }

    // RISK-004: allow-list DTO applied to EVERY risk row regardless of the
    // query path — strips driveFileId (S3 key), recordId, projectId, sector,
    // visibility/permission levels, parentFileId. Other modules unchanged.
    files = files.map((r) => (r.module === "risks" ? riskAttachmentDto(r) : r));

    res.json({ files, total });
  } catch (err) { next(err); }
});

// ── POST /drive/files/:id/log-access ──────────────────────────────────────
router.post("/drive/files/:id/log-access", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const action = String(req.body?.action ?? "viewed");
    // Audit integrity: only log access events for real files, and apply the
    // parent-risk guard for risk attachments (RISK-004) so unauthorised actors
    // cannot forge audit entries.
    const file = await pool.query<{ module: string; record_id: number | null }>(
      `SELECT module, record_id FROM drive_files WHERE id = $1`,
      [id],
    );
    if (!file.rows.length) { res.status(404).json({ error: "not_found" }); return; }
    if (file.rows[0].module === "risks") {
      const access = await assertRiskAccessForDriveOperation(req, file.rows[0].record_id);
      if (!access.ok) { res.status(access.status).json(access.body); return; }
    }
    await logAudit({ userId: req.currentUser!.id, action: `file_${action}`, module: "drive", entityId: id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── PATCH /drive/files/:id ─────────────────────────────────────────────────
router.patch("/drive/files/:id", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const { status } = req.body as { status?: string };
    if (!status || !["active", "archived", "deleted"].includes(status)) {
      res.status(400).json({ error: "invalid_status" }); return;
    }

    // RISK-004: mutating a risk attachment requires access to the parent risk
    // plus risk mutation authority. Loaded BEFORE the UPDATE so an unauthorised
    // caller cannot change anything.
    const existing = await pool.query<{ module: string; record_id: number | null }>(
      `SELECT module, record_id FROM drive_files WHERE id = $1`,
      [id],
    );
    if (!existing.rows.length) { res.status(404).json({ error: "not_found" }); return; }
    if (existing.rows[0].module === "risks") {
      const access = await assertRiskAccessForDriveOperation(req, existing.rows[0].record_id);
      if (!access.ok) { res.status(access.status).json(access.body); return; }
      if (!hasRiskMutationPerm(req)) {
        res.status(403).json({ error: "forbidden", requiredPermission: "risks.update" });
        return;
      }
    }

    const { rows } = await pool.query(
      `UPDATE drive_files SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING id, status`,
      [status, id],
    );
    if (!rows.length) { res.status(404).json({ error: "not_found" }); return; }

    // Non-destructive archive — move to archive/ prefix in S3
    if (status === "deleted") {
      const file = await pool.query(
        `SELECT drive_file_id FROM drive_files WHERE id = $1`,
        [id],
      );
      const key = file.rows[0]?.drive_file_id as string | undefined;
      if (key && isS3Configured()) {
        await archiveFile(key).catch(() => {
          deleteFile(key).catch(() => {});
        });
      }
    }

    await logAudit({ userId: req.currentUser!.id, action: `file_${status}`, module: "drive", entityId: id });
    res.json({ ok: true, status });
  } catch (err) { next(err); }
});

// ── POST /drive/files/:id/replace ─────────────────────────────────────────
router.post("/drive/files/:id/replace", requireAuth, upload.single("file"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) { res.status(400).json({ error: "file_required" }); return; }
    const id = Number(req.params.id);

    const { rows: existing } = await pool.query(`SELECT * FROM drive_files WHERE id = $1`, [id]);
    if (!existing.length) { res.status(404).json({ error: "not_found" }); return; }
    const prev = existing[0];

    // RISK-004: replacing a risk attachment requires parent-risk access + risk
    // mutation authority.
    if (prev.module === "risks") {
      const access = await assertRiskAccessForDriveOperation(req, prev.record_id);
      if (!access.ok) { res.status(access.status).json(access.body); return; }
      if (!hasRiskMutationPerm(req)) {
        res.status(403).json({ error: "forbidden", requiredPermission: "risks.update" });
        return;
      }
    }

    const key = buildObjectKey(prev.module as string, req.file.originalname);
    const result = await uploadFile({
      key,
      module: prev.module as string,
      name: req.file.originalname,
      mimeType: req.file.mimetype,
      buffer: req.file.buffer,
    });

    await pool.query(`UPDATE drive_files SET status = 'archived', updated_at = NOW() WHERE id = $1`, [id]);

    const { rows } = await pool.query(
      `INSERT INTO drive_files
         (drive_file_id, drive_link, name, mime_type, size, module, record_id, project_id,
          uploaded_by_user_id, user_role, state_id, sector, visibility_level, permission_level,
          version_number, parent_file_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING id, name, version_number AS "versionNumber", drive_link AS "driveLink"`,
      [
        result.fileKey, result.fileKey, result.fileName, req.file.mimetype, result.fileSize,
        prev.module, prev.record_id, prev.project_id,
        req.currentUser!.id, req.currentUser!.role, prev.state_id, prev.sector,
        prev.visibility_level, prev.permission_level,
        (prev.version_number ?? 1) + 1, id,
      ],
    );

    await logAudit({ userId: req.currentUser!.id, action: "file_replaced", module: "drive", entityId: rows[0].id });
    // RISK-004: risk attachment responses never return the raw S3 key held in
    // drive_link at insert time — allow-list DTO with driveLink nulled.
    res.json({
      ok: true,
      file: prev.module === "risks" ? { ...riskAttachmentDto(rows[0]), driveLink: null } : rows[0],
    });
  } catch (err) { next(err); }
});

// ── GET /drive/files/:id/versions ─────────────────────────────────────────
router.get("/drive/files/:id/versions", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);

    // RISK-004: version history of a risk attachment requires parent-risk access.
    const root = await pool.query<{ module: string; record_id: number | null }>(
      `SELECT module, record_id FROM drive_files WHERE id = $1`,
      [id],
    );
    const isRiskFile = root.rows[0]?.module === "risks";
    if (isRiskFile) {
      const access = await assertRiskAccessForDriveOperation(req, root.rows[0]!.record_id);
      if (!access.ok) { res.status(access.status).json(access.body); return; }
    }

    const { rows } = await pool.query(
      `WITH RECURSIVE chain AS (
         SELECT id, parent_file_id FROM drive_files WHERE id = $1
         UNION ALL
         SELECT df.id, df.parent_file_id FROM drive_files df JOIN chain c ON df.id = c.parent_file_id
       )
       SELECT df.id, df.name, df.version_number AS "versionNumber", df.status,
              df.created_at AS "createdAt", df.drive_link AS "driveLink",
              u.name AS "uploaderName"
       FROM chain c JOIN drive_files df ON df.id = c.id
       LEFT JOIN users u ON u.id = df.uploaded_by_user_id
       ORDER BY df.version_number DESC`,
      [id],
    );
    // RISK-004: drive_link stores the raw S3 object key; risk attachment
    // version rows must never expose it. Presign at read time when possible,
    // otherwise return null — the protected download route is the fallback.
    let versions = rows;
    if (isRiskFile) {
      const keys = rows.map((r: Record<string, unknown>) => r.driveLink).filter(Boolean) as string[];
      const presigned = isS3Configured() && keys.length ? await batchPresignedUrls(keys) : new Map<string, string>();
      versions = rows.map((r: Record<string, unknown>) => ({
        ...r,
        driveLink: (typeof r.driveLink === "string" && presigned.get(r.driveLink)) || null,
      }));
    }
    res.json({ versions });
  } catch (err) { next(err); }
});

// ── GET /drive/files/:id/download ─────────────────────────────────────────
router.get("/drive/files/:id/download", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await pool.query(
      `SELECT drive_file_id AS "fileKey", name, mime_type AS "mimeType",
              state_id AS "stateId", sector, module, record_id AS "recordId",
              availability_status AS "availabilityStatus"
       FROM drive_files WHERE id = $1 AND status = 'active'`,
      [id],
    );
    if (!rows.length) { res.status(404).json({ error: "not_found" }); return; }
    const file = rows[0];
    if (file.availabilityStatus === "unavailable") {
      res.status(410).json({ error: "file_unavailable", message: "File Unavailable" }); return;
    }
    const user = req.currentUser!;

    if (file.module === "risks") {
      // RISK-004: the access decision comes from the parent risk's canonical
      // rules, NOT from the drive_file's caller-supplied state/sector metadata.
      const access = await assertRiskAccessForDriveOperation(req, file.recordId);
      if (!access.ok) { res.status(access.status).json(access.body); return; }
    } else {
      if ((user.role === "state_office_manager" || user.role === "state_program_officer") && file.stateId && file.stateId !== user.stateId) {
        res.status(403).json({ error: "forbidden" }); return;
      }
      if (user.role === "technical_coordinator" && user.sectors?.length && file.sector && !user.sectors.includes(file.sector)) {
        res.status(403).json({ error: "forbidden" }); return;
      }
    }

    await logAudit({ userId: user.id, action: "file_downloaded", module: "drive", entityId: id });

    if (!isS3Configured()) { res.status(503).json({ error: "storage_not_configured" }); return; }

    const s3Stream = await downloadFileStream(file.fileKey as string);
    if (!s3Stream) { res.status(502).json({ error: "storage_unavailable" }); return; }

    res.setHeader("Content-Type", file.mimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(sanitiseFilename(String(file.name ?? "")))}"`);
    Readable.fromWeb(s3Stream).pipe(res);
  } catch (err) { next(err); }
});

// ── GET /drive/admin/status ────────────────────────────────────────────────
router.get("/drive/admin/status", requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cfgStatus = getConfigStatus();

    const statsRes = await pool.query(`SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status = 'active')::int AS active,
      COUNT(*) FILTER (WHERE status = 'archived')::int AS archived,
      COUNT(*) FILTER (WHERE status = 'deleted')::int AS deleted,
      COALESCE(SUM(size),0)::bigint AS "totalBytes"
     FROM drive_files`);

    if (!cfgStatus.configured) {
      res.json({
        provider: "s3",
        enabled: false,
        configured: false,
        bucket: cfgStatus.bucket,
        region: cfgStatus.region,
        connectionOk: false,
        lastError: !cfgStatus.hasRegion
          ? "AWS_REGION is not set"
          : !cfgStatus.hasBucket
          ? "AWS_S3_BUCKET is not set"
          : !cfgStatus.hasAccessKey || !cfgStatus.hasSecretKey
          ? "AWS credentials (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY) are not set"
          : "Configuration incomplete — check server logs",
        dbStats: statsRes.rows[0],
        diagnostics: {
          hasRegion: cfgStatus.hasRegion,
          hasBucket: cfgStatus.hasBucket,
          hasAccessKey: cfgStatus.hasAccessKey,
          hasSecretKey: cfgStatus.hasSecretKey,
        },
      });
      return;
    }

    const connResult = await testConnection();
    res.json({
      provider: "s3",
      enabled: true,
      configured: true,
      bucket: cfgStatus.bucket,
      region: cfgStatus.region,
      connectionOk: connResult.ok,
      lastError: connResult.lastError ?? null,
      dbStats: statsRes.rows[0],
      diagnostics: {
        hasRegion: cfgStatus.hasRegion,
        hasBucket: cfgStatus.hasBucket,
        hasAccessKey: cfgStatus.hasAccessKey,
        hasSecretKey: cfgStatus.hasSecretKey,
      },
    });
  } catch (err) { next(err); }
});

// ── POST /drive/admin/test-connection ─────────────────────────────────────
router.post("/drive/admin/test-connection", requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cfgStatus = getConfigStatus();
    if (!cfgStatus.configured) {
      res.json({ ok: false, connected: false, configured: false, provider: "s3", lastError: "AWS S3 storage is not configured" });
      return;
    }
    const result = await testConnection();
    res.json({ ok: result.ok, connected: result.ok, configured: true, provider: "s3", lastError: result.lastError ?? null });
  } catch (err) { next(err); }
});

// ── GET /drive/admin/health ────────────────────────────────────────────────
// Lightweight health check — returns 200 if S3 is reachable, 503 otherwise
router.get("/drive/admin/health", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!isS3Configured()) {
      res.status(503).json({ ok: false, provider: "aws-s3", reason: "not_configured" });
      return;
    }
    const result = await testConnection();
    const cfg = getConfigStatus();
    if (result.ok) {
      res.json({ ok: true, provider: "aws-s3", bucket: cfg.bucket });
    } else {
      res.status(503).json({ ok: false, provider: "aws-s3", bucket: cfg.bucket, reason: result.lastError });
    }
  } catch (err) { next(err); }
});

// ── GET /storage/health ────────────────────────────────────────────────────
// Public alias at the /storage/health path as specified in the API contract.
// No admin role required — any authenticated user can call it (for frontend
// connectivity checks). Returns 200 { ok, provider, bucket } or 503 on error.
router.get("/storage/health", requireAuth, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const cfg = getConfigStatus();
    if (!cfg.configured) {
      res.status(503).json({ ok: false, provider: "aws-s3", bucket: cfg.bucket, reason: "not_configured" });
      return;
    }
    const result = await testConnection();
    if (result.ok) {
      res.json({ ok: true, provider: "aws-s3", bucket: cfg.bucket });
    } else {
      res.status(503).json({ ok: false, provider: "aws-s3", bucket: cfg.bucket, reason: result.lastError });
    }
  } catch (err) { next(err); }
});

export default router;
