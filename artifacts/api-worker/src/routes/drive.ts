import { Hono, type Context, type MiddlewareHandler } from "hono";
import type { Bindings, QueryExecutor } from "../lib/db";
import { openDb } from "../lib/db";
import {
  attachCurrentUser,
  requireAuth,
  logAudit,
  assertSectorAllowed,
  permissionsFor,
  hasPerm,
  type CurrentUser,
  type Variables,
} from "../lib/rbac";
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
} from "../lib/drive-storage";

/**
 * Ported from artifacts/api-server/src/routes/drive.ts (744 lines) — fifth
 * file of the attachments group. A second, independent generic-attachment
 * system (table `drive_files`, direct multipart upload rather than the
 * presigned-upload-token flow every other file in this group uses) whose
 * storage backend (lib/drive-storage.ts, ported alongside this file) was
 * migrated from real AWS S3 onto R2 per explicit user decision — this
 * worker's storage is R2 end to end, and Drive gets no exception.
 *
 * Adapted: no multer in Workers — POST /drive/upload and
 * POST /drive/files/:id/replace parse `c.req.formData()` directly (the
 * standard Fetch API FormData Hono already wraps) instead of a multipart
 * middleware, with the same MIME/size checks applied by hand afterward.
 */

const BLOCKED_MIME = new Set([
  "application/x-sh",
  "application/x-executable",
  "text/x-shellscript",
  "application/x-msdownload",
  "application/x-httpd-php",
]);

const ADMIN_ROLES = new Set(["super_admin", "executive_director", "program_manager"]);
const requireAdmin: MiddlewareHandler<{ Bindings: Bindings; Variables: Variables }> = async (c, next) => {
  const user = c.get("currentUser");
  if (!user) return c.json({ error: "unauthorized" }, 401);
  if (!ADMIN_ROLES.has(user.role)) return c.json({ error: "forbidden" }, 403);
  return next();
};

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

async function assertRiskAccessForDriveOperation(
  db: QueryExecutor,
  user: CurrentUser | undefined,
  recordId: unknown,
): Promise<RiskAccessResult> {
  const riskId = Number(recordId);
  if (!Number.isInteger(riskId) || riskId <= 0) {
    return { ok: false, status: 404, body: { error: "risk_not_found" } };
  }
  const r = await db.query<RiskRowForDrive>(
    `SELECT r.state_id AS "stateId", r.project_id AS "projectId", p.sector
     FROM risks r LEFT JOIN projects p ON p.id = r.project_id WHERE r.id = $1`,
    [riskId],
  );
  const risk = r.rows[0];
  if (!risk) return { ok: false, status: 404, body: { error: "risk_not_found" } };

  const guard = assertSectorAllowed(user, risk.sector);
  if (!guard.ok) return guard;

  const u = user!;
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
function hasRiskMutationPerm(user: CurrentUser): boolean {
  return hasPerm(permissionsFor(user), "risks.update");
}

// Fail-closed Technical Coordinator sector restriction for the Drive module.
// An empty result means "match nothing", never "no restriction" — a TC whose
// `sectors` parsed empty (no assignment, legacy blank data) must be denied
// everything, not granted everything. Falls back to the legacy singular
// `sector` field when `sectors` was not populated.
function tcDriveSectors(user: { sectors: string[] | null; sector: string | null }): string[] {
  return user.sectors?.length ? user.sectors : user.sector ? [user.sector] : [];
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
// they reach the Content-Disposition header. Character-code comparison
// rather than a regex literal embedding raw control-character escapes.
function sanitiseFilename(name: string): string {
  let cleaned = "";
  for (let i = 0; i < name.length; i++) {
    const ch = name[i];
    const code = name.charCodeAt(i);
    cleaned += ch === "/" || ch === "\\" || code <= 31 || code === 127 ? "_" : ch;
  }
  cleaned = cleaned.trim();
  return cleaned || "download";
}

export const driveRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

driveRoutes.use("/drive/*", attachCurrentUser, requireAuth);
driveRoutes.use("/storage/health", attachCurrentUser, requireAuth);

// ── POST /drive/upload ─────────────────────────────────────────────────────
driveRoutes.post("/drive/upload", async (c) => {
  const user = c.get("currentUser")!;
  const { db, pool, close } = openDb(c);
  try {
    if (!isS3Configured(c.env)) {
      const s = getConfigStatus(c.env);
      return c.json({
        error: "storage_not_configured",
        message: "R2 storage is not configured",
        hint: !s.hasRegion
          ? "R2_ENDPOINT_URL is not set"
          : !s.hasBucket
          ? "R2_BUCKET is not set"
          : !s.hasAccessKey || !s.hasSecretKey
          ? "R2_ACCESS_KEY_ID or R2_SECRET_ACCESS_KEY is not set"
          : "Check worker configuration for details",
      }, 503);
    }

    const formData = await c.req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) return c.json({ error: "file_required" }, 400);
    if (BLOCKED_MIME.has(file.type)) return c.json({ error: "file_type_not_allowed" }, 400);
    if (file.size > MAX_ATTACHMENT_BYTES) {
      return c.json({ error: "file_too_large", limitMB: Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024) }, 413);
    }

    const module = String(formData.get("module") ?? "attachments");
    const recordId = formData.get("recordId");
    const projectId = formData.get("projectId");
    const sector = formData.get("sector");
    const visibilityLevel = String(formData.get("visibilityLevel") ?? "internal");
    const permissionLevel = String(formData.get("permissionLevel") ?? "view");

    // RISK-004: risk attachments require an accessible parent risk plus risk
    // mutation authority. The server derives state/sector/project from the
    // loaded risk record — caller-supplied values are ignored for risks.
    let riskParent: RiskRowForDrive | null = null;
    if (module === "risks") {
      const access = await assertRiskAccessForDriveOperation(db, user, recordId);
      if (!access.ok) return c.json(access.body, access.status as 403 | 404);
      if (!hasRiskMutationPerm(user)) {
        return c.json({ error: "forbidden", requiredPermission: "risks.update" }, 403);
      }
      riskParent = access.risk;
    }

    const buffer = new Uint8Array(await file.arrayBuffer());
    const key = buildObjectKey(module, file.name);
    const result = await uploadFile(c.env, {
      key,
      module,
      name: file.name,
      mimeType: file.type,
      buffer,
    });

    // Persist metadata — drive_file_id stores the R2 object key,
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
      result.fileKey, // store key in drive_link; presigned URL generated at read time
      result.fileName,
      file.type,
      result.fileSize,
      module,
      recordId ? Number(recordId) : null,
      riskParent ? riskParent.projectId : (projectId ? Number(projectId) : null),
      user.id,
      user.role,
      riskParent ? riskParent.stateId : (user.stateId ?? null),
      riskParent ? riskParent.sector : (sector ? String(sector) : (user.sector ?? null)),
      visibilityLevel,
      permissionLevel,
    ];

    let rows: Record<string, unknown>[];
    if (module === "risks") {
      const txClient = await pool.connect();
      try {
        await txClient.query("BEGIN");
        const lockCheck = await txClient.query(`SELECT 1 FROM risks WHERE id = $1 FOR UPDATE`, [Number(recordId)]);
        if (lockCheck.rows.length === 0) {
          await txClient.query("ROLLBACK");
          // Parent risk vanished (e.g. project permanent delete) — remove the
          // freshly uploaded physical object best-effort and fail closed.
          await deleteFile(c.env, result.fileKey).catch(() => {});
          return c.json({ error: "risk_not_found" }, 404);
        }
        const inserted = await txClient.query(insertSql, insertParams);
        rows = inserted.rows;
        await txClient.query("COMMIT");
      } catch (txErr) {
        await txClient.query("ROLLBACK").catch(() => {});
        // Metadata was not committed — remove the already-uploaded physical
        // object best-effort so the failure leaves no orphaned storage.
        await deleteFile(c.env, result.fileKey).catch(() => {});
        throw txErr;
      } finally {
        txClient.release();
      }
    } else {
      ({ rows } = await db.query(insertSql, insertParams));
    }

    // Registry indexing records the relationship only; it never creates a
    // second object. Plan ownership and its secure attachment flow stay here.
    if (module === "plans" && recordId && rows[0]?.id) {
      await db.query(
        `INSERT INTO document_registry_entries
          (source_kind, source_id, classification, confidentiality, related_record_type, related_record_id)
         VALUES ('drive_file', $1, 'Plans & Workplans', 'internal', 'plan', $2)
         ON CONFLICT (source_kind, source_id) DO NOTHING`,
        [rows[0].id, Number(recordId)],
      );
    }

    await logAudit(db, { userId: user.id, action: "file_uploaded", module: "drive", entityId: rows[0].id as number });

    // RISK-004: allow-list DTO for risk attachments (no internal fields).
    // driveLink at insert time still holds the raw R2 key (presigned URLs are
    // generated at read time), so it is nulled for the risks DTO.
    return c.json({
      ok: true,
      file: module === "risks" ? { ...riskAttachmentDto(rows[0]), driveLink: null } : rows[0],
    });
  } finally {
    close();
  }
});

// ── GET /drive/files ───────────────────────────────────────────────────────
driveRoutes.get("/drive/files", async (c) => {
  const user = c.get("currentUser")!;
  const { db, close } = openDb(c);
  try {
    const q = c.req.query();
    const { module, recordId, projectId, status = "active", search, limit = "50", offset = "0" } = q;

    // RISK-004: listing risk attachments requires access to the parent risk.
    // The parent-risk check supersedes the drive_file metadata filters below,
    // which act on caller-supplied upload metadata rather than the risk itself.
    if (module === "risks") {
      const access = await assertRiskAccessForDriveOperation(db, user, recordId);
      if (!access.ok) return c.json(access.body, access.status as 403 | 404);
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
    if (user.role === "technical_coordinator") {
      const tcSectors = tcDriveSectors(user);
      params.push(tcSectors); where.push(`df.sector = ANY($${params.length}::text[])`);
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
        const tcSectors = tcDriveSectors(user);
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

    const { rows } = await db.query<Record<string, unknown>>(
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

    const countRes = await db.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM drive_files df WHERE ${where.join(" AND ")}`,
      params.slice(0, params.length - 2),
    );

    let files: Record<string, unknown>[] = rows;
    const total: number = countRes.rows[0]?.total ?? 0;

    // Generate presigned URLs so the frontend "Open" button works.
    // RISK-004: risk rows NEVER fall back to the persisted drive_link (raw R2
    // object key) — an unavailable presign yields null for them.
    if (isS3Configured(c.env) && files.length > 0) {
      const keys = files.map((r) => r.driveFileId).filter(Boolean) as string[];
      const presigned = await batchPresignedUrls(c.env, keys);
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
    // query path — strips driveFileId (R2 key), recordId, projectId, sector,
    // visibility/permission levels, parentFileId. Other modules unchanged.
    files = files.map((r) => (r.module === "risks" ? riskAttachmentDto(r) : r));

    return c.json({ files, total });
  } finally {
    close();
  }
});

// ── POST /drive/files/:id/log-access ──────────────────────────────────────
driveRoutes.post("/drive/files/:id/log-access", async (c) => {
  const user = c.get("currentUser")!;
  const { db, close } = openDb(c);
  try {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json().catch(() => ({}))) as { action?: string };
    const action = String(body.action ?? "viewed");
    // Audit integrity: only log access events for real files, and apply the
    // parent-risk guard for risk attachments (RISK-004) so unauthorised actors
    // cannot forge audit entries.
    const file = await db.query<{ module: string; record_id: number | null }>(
      `SELECT module, record_id FROM drive_files WHERE id = $1`,
      [id],
    );
    if (!file.rows.length) return c.json({ error: "not_found" }, 404);
    if (file.rows[0].module === "risks") {
      const access = await assertRiskAccessForDriveOperation(db, user, file.rows[0].record_id);
      if (!access.ok) return c.json(access.body, access.status as 403 | 404);
    }
    await logAudit(db, { userId: user.id, action: `file_${action}`, module: "drive", entityId: id });
    return c.json({ ok: true });
  } finally {
    close();
  }
});

// ── PATCH /drive/files/:id ─────────────────────────────────────────────────
driveRoutes.patch("/drive/files/:id", async (c) => {
  const user = c.get("currentUser")!;
  const { db, close } = openDb(c);
  try {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json().catch(() => ({}))) as { status?: string };
    const { status } = body;
    if (!status || !["active", "archived", "deleted"].includes(status)) {
      return c.json({ error: "invalid_status" }, 400);
    }

    // RISK-004: mutating a risk attachment requires access to the parent risk
    // plus risk mutation authority. Loaded BEFORE the UPDATE so an unauthorised
    // caller cannot change anything.
    const existing = await db.query<{ module: string; record_id: number | null }>(
      `SELECT module, record_id FROM drive_files WHERE id = $1`,
      [id],
    );
    if (!existing.rows.length) return c.json({ error: "not_found" }, 404);
    if (existing.rows[0].module === "risks") {
      const access = await assertRiskAccessForDriveOperation(db, user, existing.rows[0].record_id);
      if (!access.ok) return c.json(access.body, access.status as 403 | 404);
      if (!hasRiskMutationPerm(user)) {
        return c.json({ error: "forbidden", requiredPermission: "risks.update" }, 403);
      }
    }

    const { rows } = await db.query<{ id: number; status: string }>(
      `UPDATE drive_files SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING id, status`,
      [status, id],
    );
    if (!rows.length) return c.json({ error: "not_found" }, 404);

    // Non-destructive archive — move to archive/ prefix in R2
    if (status === "deleted") {
      const file = await db.query<{ drive_file_id: string }>(`SELECT drive_file_id FROM drive_files WHERE id = $1`, [id]);
      const key = file.rows[0]?.drive_file_id;
      if (key && isS3Configured(c.env)) {
        await archiveFile(c.env, key).catch(() => {
          deleteFile(c.env, key).catch(() => {});
        });
      }
    }

    await logAudit(db, { userId: user.id, action: `file_${status}`, module: "drive", entityId: id });
    return c.json({ ok: true, status });
  } finally {
    close();
  }
});

// ── POST /drive/files/:id/replace ─────────────────────────────────────────
driveRoutes.post("/drive/files/:id/replace", async (c) => {
  const user = c.get("currentUser")!;
  const { db, close } = openDb(c);
  try {
    const formData = await c.req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) return c.json({ error: "file_required" }, 400);
    const id = Number(c.req.param("id"));

    const { rows: existing } = await db.query<Record<string, unknown>>(`SELECT * FROM drive_files WHERE id = $1`, [id]);
    if (!existing.length) return c.json({ error: "not_found" }, 404);
    const prev = existing[0];

    // RISK-004: replacing a risk attachment requires parent-risk access + risk
    // mutation authority.
    if (prev.module === "risks") {
      const access = await assertRiskAccessForDriveOperation(db, user, prev.record_id);
      if (!access.ok) return c.json(access.body, access.status as 403 | 404);
      if (!hasRiskMutationPerm(user)) {
        return c.json({ error: "forbidden", requiredPermission: "risks.update" }, 403);
      }
    }

    const buffer = new Uint8Array(await file.arrayBuffer());
    const key = buildObjectKey(prev.module as string, file.name);
    const result = await uploadFile(c.env, {
      key,
      module: prev.module as string,
      name: file.name,
      mimeType: file.type,
      buffer,
    });

    await db.query(`UPDATE drive_files SET status = 'archived', updated_at = NOW() WHERE id = $1`, [id]);

    const { rows } = await db.query<{ id: number; name: string; versionNumber: number; driveLink: string }>(
      `INSERT INTO drive_files
         (drive_file_id, drive_link, name, mime_type, size, module, record_id, project_id,
          uploaded_by_user_id, user_role, state_id, sector, visibility_level, permission_level,
          version_number, parent_file_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING id, name, version_number AS "versionNumber", drive_link AS "driveLink"`,
      [
        result.fileKey, result.fileKey, result.fileName, file.type, result.fileSize,
        prev.module, prev.record_id, prev.project_id,
        user.id, user.role, prev.state_id, prev.sector,
        prev.visibility_level, prev.permission_level,
        (Number(prev.version_number) || 1) + 1, id,
      ],
    );

    await logAudit(db, { userId: user.id, action: "file_replaced", module: "drive", entityId: rows[0].id });
    // RISK-004: risk attachment responses never return the raw R2 key held in
    // drive_link at insert time — allow-list DTO with driveLink nulled.
    return c.json({
      ok: true,
      file: prev.module === "risks" ? { ...riskAttachmentDto(rows[0]), driveLink: null } : rows[0],
    });
  } finally {
    close();
  }
});

// ── GET /drive/files/:id/versions ─────────────────────────────────────────
driveRoutes.get("/drive/files/:id/versions", async (c) => {
  const user = c.get("currentUser")!;
  const { db, close } = openDb(c);
  try {
    const id = Number(c.req.param("id"));

    // RISK-004: version history of a risk attachment requires parent-risk access.
    const root = await db.query<{ module: string; record_id: number | null }>(
      `SELECT module, record_id FROM drive_files WHERE id = $1`,
      [id],
    );
    const isRiskFile = root.rows[0]?.module === "risks";
    if (isRiskFile) {
      const access = await assertRiskAccessForDriveOperation(db, user, root.rows[0]!.record_id);
      if (!access.ok) return c.json(access.body, access.status as 403 | 404);
    }

    const { rows } = await db.query<Record<string, unknown>>(
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
    // RISK-004: drive_link stores the raw R2 object key; risk attachment
    // version rows must never expose it. Presign at read time when possible,
    // otherwise return null — the protected download route is the fallback.
    let versions = rows;
    if (isRiskFile) {
      const keys = rows.map((r) => r.driveLink).filter(Boolean) as string[];
      const presigned = isS3Configured(c.env) && keys.length ? await batchPresignedUrls(c.env, keys) : new Map<string, string>();
      versions = rows.map((r) => ({
        ...r,
        driveLink: (typeof r.driveLink === "string" && presigned.get(r.driveLink)) || null,
      }));
    }
    return c.json({ versions });
  } finally {
    close();
  }
});

// ── GET /drive/files/:id/download ─────────────────────────────────────────
driveRoutes.get("/drive/files/:id/download", async (c) => {
  const user = c.get("currentUser")!;
  const { db, close } = openDb(c);
  try {
    const id = Number(c.req.param("id"));
    const { rows } = await db.query<{
      fileKey: string; name: string; mimeType: string | null; stateId: number | null;
      sector: string | null; module: string; recordId: number | null; availabilityStatus: string;
    }>(
      `SELECT drive_file_id AS "fileKey", name, mime_type AS "mimeType",
              state_id AS "stateId", sector, module, record_id AS "recordId",
              availability_status AS "availabilityStatus"
       FROM drive_files WHERE id = $1 AND status = 'active'`,
      [id],
    );
    if (!rows.length) return c.json({ error: "not_found" }, 404);
    const file = rows[0];
    if (file.availabilityStatus === "unavailable") {
      return c.json({ error: "file_unavailable", message: "File Unavailable" }, 410);
    }

    if (file.module === "risks") {
      // RISK-004: the access decision comes from the parent risk's canonical
      // rules, NOT from the drive_file's caller-supplied state/sector metadata.
      const access = await assertRiskAccessForDriveOperation(db, user, file.recordId);
      if (!access.ok) return c.json(access.body, access.status as 403 | 404);
    } else {
      if ((user.role === "state_office_manager" || user.role === "state_program_officer") && file.stateId && file.stateId !== user.stateId) {
        return c.json({ error: "forbidden" }, 403);
      }
      if (user.role === "technical_coordinator") {
        const tcSectors = tcDriveSectors(user);
        if (!file.sector || !tcSectors.includes(file.sector)) {
          return c.json({ error: "forbidden" }, 403);
        }
      }
    }

    await logAudit(db, { userId: user.id, action: "file_downloaded", module: "drive", entityId: id });

    if (!isS3Configured(c.env)) return c.json({ error: "storage_not_configured" }, 503);

    const stream = await downloadFileStream(c.env, file.fileKey);
    if (!stream) return c.json({ error: "storage_unavailable" }, 502);

    const headers = new Headers({
      "Content-Type": file.mimeType || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(sanitiseFilename(file.name ?? ""))}"`,
    });
    return new Response(stream, { headers });
  } finally {
    close();
  }
});

// ── GET /drive/admin/status ────────────────────────────────────────────────
driveRoutes.get("/drive/admin/status", requireAdmin, async (c) => {
  const { db, close } = openDb(c);
  try {
    const cfgStatus = getConfigStatus(c.env);

    const statsRes = await db.query<{ total: number; active: number; archived: number; deleted: number; totalBytes: string }>(
      `SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'active')::int AS active,
        COUNT(*) FILTER (WHERE status = 'archived')::int AS archived,
        COUNT(*) FILTER (WHERE status = 'deleted')::int AS deleted,
        COALESCE(SUM(size),0)::bigint AS "totalBytes"
       FROM drive_files`,
    );

    if (!cfgStatus.configured) {
      return c.json({
        provider: "r2",
        enabled: false,
        configured: false,
        bucket: cfgStatus.bucket,
        region: cfgStatus.region,
        connectionOk: false,
        lastError: !cfgStatus.hasRegion
          ? "R2_ENDPOINT_URL is not set"
          : !cfgStatus.hasBucket
          ? "R2_BUCKET is not set"
          : !cfgStatus.hasAccessKey || !cfgStatus.hasSecretKey
          ? "R2 credentials (R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY) are not set"
          : "Configuration incomplete — check worker configuration",
        dbStats: statsRes.rows[0],
        diagnostics: {
          hasRegion: cfgStatus.hasRegion,
          hasBucket: cfgStatus.hasBucket,
          hasAccessKey: cfgStatus.hasAccessKey,
          hasSecretKey: cfgStatus.hasSecretKey,
        },
      });
    }

    const connResult = await testConnection(c.env);
    return c.json({
      provider: "r2",
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
  } finally {
    close();
  }
});

// ── POST /drive/admin/test-connection ─────────────────────────────────────
driveRoutes.post("/drive/admin/test-connection", requireAdmin, async (c) => {
  const cfgStatus = getConfigStatus(c.env);
  if (!cfgStatus.configured) {
    return c.json({ ok: false, connected: false, configured: false, provider: "r2", lastError: "R2 storage is not configured" });
  }
  const result = await testConnection(c.env);
  return c.json({ ok: result.ok, connected: result.ok, configured: true, provider: "r2", lastError: result.lastError ?? null });
});

// ── GET /drive/admin/health ────────────────────────────────────────────────
// Lightweight health check — returns 200 if R2 is reachable, 503 otherwise.
// Admin-only despite the generic reason/bucket fields below: on failure
// `reason` can carry raw provider error text, which the "/admin/" path implies
// is restricted to admins — requireAuth alone would let any authenticated
// user of any role reach it. GET /storage/health remains the intentionally
// public-to-any-authenticated-user alias for frontend connectivity checks.
driveRoutes.get("/drive/admin/health", requireAdmin, async (c) => {
  if (!isS3Configured(c.env)) {
    return c.json({ ok: false, provider: "r2", reason: "not_configured" }, 503);
  }
  const result = await testConnection(c.env);
  const cfg = getConfigStatus(c.env);
  if (result.ok) {
    return c.json({ ok: true, provider: "r2", bucket: cfg.bucket });
  }
  return c.json({ ok: false, provider: "r2", bucket: cfg.bucket, reason: result.lastError }, 503);
});

// ── GET /storage/health ────────────────────────────────────────────────────
// Public alias at the /storage/health path as specified in the API contract.
// No admin role required — any authenticated user can call it (for frontend
// connectivity checks). Returns 200 { ok, provider, bucket } or 503 on error.
driveRoutes.get("/storage/health", async (c) => {
  const cfg = getConfigStatus(c.env);
  if (!cfg.configured) {
    return c.json({ ok: false, provider: "r2", bucket: cfg.bucket, reason: "not_configured" }, 503);
  }
  const result = await testConnection(c.env);
  if (result.ok) {
    return c.json({ ok: true, provider: "r2", bucket: cfg.bucket });
  }
  return c.json({ ok: false, provider: "r2", bucket: cfg.bucket, reason: result.lastError }, 503);
});
