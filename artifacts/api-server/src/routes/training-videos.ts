import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import crypto from "node:crypto";
import fsSync from "node:fs";
import path from "node:path";
import { pool } from "@workspace/db";
import { hasPerm, permissionsFor, requireAuth, requirePerm } from "../middlewares/currentUser";
import { logAudit } from "../middlewares/currentUser";
import { generateModuleVideo } from "../lib/video-generator";
import { FULL_VIDEO_TITLE, FULL_VIDEO_MODULE } from "../lib/full-system-video-script";
import { TRAINING_VIDEO_MODULES } from "../lib/training-video-modules";
import multer from "multer";

// Schema is owned exclusively by tracked migration 052_runtime_schema_authority.
const router: IRouter = Router();
const DATA_DIR = "/home/runner/workspace/data/training-videos";
const COMPLETION_THRESHOLD = 90; // percent required to mark as complete

// Multer for manual upload (500 MB limit, MP4 only)
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => { fsSync.mkdirSync(DATA_DIR, { recursive: true }); cb(null, DATA_DIR); },
    filename:    (_req, _file, cb) => { cb(null, `manual_${Date.now()}.mp4`); },
  }),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    (file.mimetype === "video/mp4" || file.originalname.endsWith(".mp4")) ? cb(null, true) : cb(new Error("MP4 only"));
  },
});

// Permission guard — training_videos.manage (SA via "*", ED, PM). Shared with
// the read-scoping isAdmin checks below via hasPerm/permissionsFor instead of
// each re-declaring its own copy of the same role list.
const requireVideoAdmin = requirePerm("training_videos.manage");

function isVideoAdmin(req: Request): boolean {
  return hasPerm(permissionsFor(req.currentUser!), "training_videos.manage");
}

// Base video SELECT (no completion data — used for admin/internal queries)
const VIDEO_SELECT = `
  SELECT v.id, v.title, v.module_name AS "moduleName", v.role_access AS "roleAccess",
         v.language, v.description, v.file_path AS "filePath", v.duration, v.status,
         v.category, v.view_count AS "viewCount",
         v.generated_by AS "generatedBy", v.uploaded_by_id AS "uploadedById",
         v.error_message AS "errorMessage",
         v.progress_pct AS "progressPct", v.progress_label AS "progressLabel",
         v.created_at AS "createdAt", v.updated_at AS "updatedAt",
         u.name AS "uploadedByName"
  FROM training_videos v
  LEFT JOIN users u ON u.id = COALESCE(v.uploaded_by_id, v.generated_by)
`;

// Video SELECT with per-user completion data ($1 = userId in LEFT JOIN)
const VIDEO_SELECT_WITH_COMPLETION = `
  SELECT v.id, v.title, v.module_name AS "moduleName", v.role_access AS "roleAccess",
         v.language, v.description, v.file_path AS "filePath", v.duration, v.status,
         v.category, v.view_count AS "viewCount",
         v.generated_by AS "generatedBy", v.uploaded_by_id AS "uploadedById",
         v.error_message AS "errorMessage",
         v.progress_pct AS "progressPct", v.progress_label AS "progressLabel",
         v.created_at AS "createdAt", v.updated_at AS "updatedAt",
         u.name AS "uploadedByName",
         tc.completion_status AS "userCompletionStatus",
         tc.watch_percent AS "userWatchPercent",
         tc.last_position_seconds AS "userLastPosition",
         cert.certificate_id AS "userCertificateId"
  FROM training_videos v
  LEFT JOIN users u ON u.id = COALESCE(v.uploaded_by_id, v.generated_by)
  LEFT JOIN training_completions tc ON tc.training_video_id = v.id AND tc.user_id = $1
  LEFT JOIN training_certificates cert ON cert.training_video_id = v.id AND cert.user_id = $1 AND cert.is_active = TRUE
`;

// Full certificate SELECT with joins
const CERT_SELECT = `
  SELECT
    cert.id, cert.certificate_id AS "certificateId",
    cert.user_id AS "userId", cert.training_video_id AS "trainingVideoId",
    cert.issued_at AS "issuedAt", cert.revoked_at AS "revokedAt",
    cert.reissued_at AS "reissuedAt", cert.reissued_by_id AS "reissuedById",
    cert.revoked_by_id AS "revokedById", cert.is_active AS "isActive",
    v.title AS "trainingVideoTitle",
    u.name AS "userName", u.role AS "userRole", u.email AS "userEmail"
  FROM training_certificates cert
  JOIN training_videos v ON v.id = cert.training_video_id
  JOIN users u ON u.id = cert.user_id
`;

// Certificate IDs are shown/printed on the certificate but must not be
// enumerable — the verification endpoint below returns each holder's name,
// role, and email for any certificate_id it's given. A sequential counter
// (CAFA-PMIS-2026-000001, 000002, ...) let any authenticated user harvest
// every staff member's PII by walking the counter. The random suffix carries
// 48 bits of entropy — practically unguessable — while keeping the same
// human-readable, printable format.
function generateCertificateId(): string {
  const year = new Date().getFullYear();
  const random = crypto.randomBytes(6).toString("hex").toUpperCase();
  return `CAFA-PMIS-${year}-${random}`;
}

function probeDuration(filePath: string): number {
  try {
    const out = require("child_process").execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
    ).toString().trim();
    return Math.round(parseFloat(out)) || 0;
  } catch { return 0; }
}

// ---------------------------------------------------------------------------
// GET /training-videos — legacy: single full-system video
// ---------------------------------------------------------------------------
router.get("/training-videos", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `${VIDEO_SELECT}
       WHERE v.module_name=$1
       ORDER BY v.created_at DESC LIMIT 1`,
      [FULL_VIDEO_MODULE],
    );
    res.json({ video: rows[0] ?? null });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /training-videos/all — multi-video library with per-user completion
// ---------------------------------------------------------------------------
router.get("/training-videos/all", requireAuth, async (req, res, next) => {
  try {
    const userId = req.currentUser!.id;
    const isAdmin = isVideoAdmin(req);
    const { search, category } = req.query as Record<string, string>;

    const conditions: string[] = [];
    const params: unknown[] = [userId]; // $1 = userId for LEFT JOIN
    let p = 2;

    if (!isAdmin) {
      conditions.push(`v.status = 'published'`);
    }
    if (category) {
      conditions.push(`v.category = $${p++}`);
      params.push(category);
    }
    if (search?.trim()) {
      conditions.push(`(v.title ILIKE $${p} OR v.description ILIKE $${p})`);
      params.push(`%${search.trim()}%`); p++;
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const { rows } = await pool.query(
      `${VIDEO_SELECT_WITH_COMPLETION} ${where} ORDER BY v.created_at DESC`,
      params,
    );
    res.json({ videos: rows });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /training-videos/stats — dashboard stats
// ---------------------------------------------------------------------------
router.get("/training-videos/stats", requireAuth, async (req, res, next) => {
  try {
    const { rows: totals } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'published') AS published,
        COUNT(*) FILTER (WHERE status = 'draft') AS draft,
        COUNT(DISTINCT category) FILTER (WHERE status = 'published') AS categories,
        SUM(view_count) AS total_views,
        SUM(duration) FILTER (WHERE status = 'published') AS total_duration
      FROM training_videos
    `);
    const { rows: topViewed } = await pool.query(`
      ${VIDEO_SELECT}
      WHERE v.status = 'published' AND v.view_count > 0
      ORDER BY v.view_count DESC LIMIT 3
    `);
    const { rows: recent } = await pool.query(`
      ${VIDEO_SELECT}
      WHERE v.status = 'published'
      ORDER BY v.created_at DESC LIMIT 3
    `);
    const { rows: byCat } = await pool.query(`
      SELECT category, COUNT(*) AS count
      FROM training_videos
      WHERE status = 'published' AND category IS NOT NULL
      GROUP BY category
      ORDER BY count DESC
    `);
    res.json({ totals: totals[0], topViewed, recent, byCategory: byCat });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /training-videos/completion-analytics — admin training analytics
// ---------------------------------------------------------------------------
router.get("/training-videos/completion-analytics", requireAuth, requireVideoAdmin, async (req, res, next) => {
  try {
    const { rows: summary } = await pool.query(`
      SELECT
        COUNT(DISTINCT u.id)                                                                          AS "totalUsers",
        COUNT(DISTINCT tc.user_id) FILTER (WHERE tc.completion_status = 'completed')                 AS "completedUsers",
        COUNT(DISTINCT tc.user_id) FILTER (WHERE tc.completion_status = 'in_progress')               AS "inProgressUsers",
        COUNT(DISTINCT cert.user_id) FILTER (WHERE cert.is_active = TRUE)                            AS "certificatesIssued"
      FROM users u
      LEFT JOIN training_completions tc ON tc.user_id = u.id
      LEFT JOIN training_certificates cert ON cert.user_id = u.id AND cert.is_active = TRUE
      WHERE u.status = 'active'
    `);

    const { rows: byRole } = await pool.query(`
      SELECT
        u.role,
        COUNT(DISTINCT u.id)                                                              AS total,
        COUNT(DISTINCT tc.user_id) FILTER (WHERE tc.completion_status = 'completed')     AS completed,
        COUNT(DISTINCT tc.user_id) FILTER (WHERE tc.completion_status = 'in_progress')   AS "inProgress"
      FROM users u
      LEFT JOIN training_completions tc ON tc.user_id = u.id
      WHERE u.status = 'active'
      GROUP BY u.role
      ORDER BY u.role
    `);

    const { rows: recentCerts } = await pool.query(`
      ${CERT_SELECT}
      WHERE cert.is_active = TRUE
      ORDER BY cert.issued_at DESC
      LIMIT 10
    `);

    res.json({
      summary: summary[0],
      byRole,
      recentCerts,
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /training-videos/my-stats — per-user training summary
// ---------------------------------------------------------------------------
router.get("/training-videos/my-stats", requireAuth, async (req, res, next) => {
  try {
    const userId = req.currentUser!.id;

    const { rows: totals } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'published')                                                            AS "totalVideos",
        COUNT(*) FILTER (WHERE status = 'published' AND tc.completion_status = 'completed')                    AS "completed",
        COUNT(*) FILTER (WHERE status = 'published' AND tc.completion_status = 'in_progress')                  AS "inProgress",
        COUNT(*) FILTER (WHERE status = 'published' AND (tc.completion_status IS NULL OR tc.completion_status = 'not_started')) AS "notStarted",
        COALESCE(SUM(tc.total_watch_seconds) FILTER (WHERE tc.user_id = $1), 0)                               AS "totalWatchSeconds"
      FROM training_videos v
      LEFT JOIN training_completions tc ON tc.training_video_id = v.id AND tc.user_id = $1
    `, [userId]);

    const { rows: certRows } = await pool.query(
      `SELECT COUNT(*) AS "certificatesEarned" FROM training_certificates WHERE user_id=$1 AND is_active=TRUE`,
      [userId],
    );

    const total    = Number(totals[0].totalVideos);
    const completed = Number(totals[0].completed);
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

    res.json({
      totalVideos:      total,
      completed,
      inProgress:       Number(totals[0].inProgress),
      notStarted:       Number(totals[0].notStarted),
      totalWatchSeconds: Number(totals[0].totalWatchSeconds),
      certificatesEarned: Number(certRows[0].certificatesEarned),
      completionRate,
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /training-videos/add — create + upload individual categorized video
// ---------------------------------------------------------------------------
router.post(
  "/training-videos/add",
  requireAuth, requireVideoAdmin,
  (req, res, next) => { upload.single("video")(req, res, err => err ? next(err) : next()); },
  async (req, res, next) => {
    try {
      if (!req.file) { res.status(400).json({ error: "no_file" }); return; }

      const { title, description, category, moduleName, language = "ar" } = req.body ?? {};
      if (!title?.trim()) { res.status(400).json({ error: "title_required" }); return; }

      const newPath = path.join(DATA_DIR, `upload_${Date.now()}.mp4`);
      fsSync.mkdirSync(DATA_DIR, { recursive: true });
      fsSync.renameSync(req.file.path, newPath);

      const duration = probeDuration(newPath);

      const { rows } = await pool.query(
        `INSERT INTO training_videos
           (title, module_name, role_access, language, description, category, status,
            uploaded_by_id, generated_by, file_path, duration, progress_pct, progress_label)
         VALUES ($1, $2, 'all', $3, $4, $5, 'published', $6, $6, $7, $8, 100, 'Uploaded manually')
         RETURNING id`,
        [
          title.trim(),
          moduleName || "general",
          language,
          description ?? null,
          category ?? null,
          req.currentUser!.id,
          newPath,
          duration,
        ],
      );
      const id = rows[0].id as number;
      await logAudit({ userId: req.currentUser!.id, action: "upload_training_video", module: "manual", entityId: id });

      res.json({ ok: true, videoId: id, duration });
    } catch (err) { next(err); }
  },
);

// ---------------------------------------------------------------------------
// POST /training-videos/upload-new — legacy: replace full-system video
// ---------------------------------------------------------------------------
router.post(
  "/training-videos/upload-new",
  requireAuth, requireVideoAdmin,
  (req, res, next) => { upload.single("video")(req, res, err => err ? next(err) : next()); },
  async (req, res, next) => {
    try {
      if (!req.file) { res.status(400).json({ error: "no_file" }); return; }

      await pool.query(`DELETE FROM training_videos WHERE module_name=$1`, [FULL_VIDEO_MODULE]);

      const newPath = path.join(DATA_DIR, `upload_${Date.now()}.mp4`);
      fsSync.mkdirSync(DATA_DIR, { recursive: true });
      fsSync.renameSync(req.file.path, newPath);

      const duration = probeDuration(newPath);

      const { rows } = await pool.query(
        `INSERT INTO training_videos
           (title, module_name, role_access, language, description, status,
            uploaded_by_id, generated_by, file_path, duration, progress_pct, progress_label)
         VALUES ($1, $2, 'all', 'ar', $3, 'published', $4, $4, $5, $6, 100, 'Uploaded manually')
         RETURNING id`,
        [FULL_VIDEO_TITLE, FULL_VIDEO_MODULE,
         "Comprehensive walkthrough of all CAFA PMIS modules with voice-over and captions.",
         req.currentUser!.id, newPath, duration],
      );
      const id = rows[0].id as number;
      await logAudit({ userId: req.currentUser!.id, action: "upload_new_training_video", module: "manual", entityId: id });

      res.json({ ok: true, videoId: id, duration });
    } catch (err) { next(err); }
  },
);

// ---------------------------------------------------------------------------
// POST /training-videos/generate — start full-system video generation
// ---------------------------------------------------------------------------
router.post("/training-videos/generate", requireAuth, requireVideoAdmin, async (req, res, next) => {
  try {
    const moduleKey = String(req.body?.moduleKey ?? FULL_VIDEO_MODULE);
    const moduleConfig = TRAINING_VIDEO_MODULES[moduleKey];
    if (!moduleConfig) {
      res.status(400).json({ error: "unknown_module", knownModules: Object.keys(TRAINING_VIDEO_MODULES) });
      return;
    }

    const { rows: existing } = await pool.query(
      `SELECT id FROM training_videos WHERE module_name=$1 AND status='processing' LIMIT 1`,
      [moduleKey],
    );
    if (existing.length) {
      res.status(409).json({ error: "generation_in_progress", videoId: existing[0].id });
      return;
    }

    const { rows } = await pool.query(
      `INSERT INTO training_videos
         (title, module_name, role_access, language, description, status,
          uploaded_by_id, generated_by, progress_pct, progress_label)
       VALUES ($1, $2, 'all', 'en', $3, 'processing', $4, $4, 0, 'Starting…')
       RETURNING id`,
      [
        moduleConfig.videoTitle,
        moduleKey,
        moduleConfig.description,
        req.currentUser!.id,
      ],
    );
    const videoId = rows[0].id as number;
    await logAudit({ userId: req.currentUser!.id, action: "generate_training_video", module: "manual", entityId: videoId });

    setImmediate(() => {
      generateModuleVideo(videoId, moduleConfig).catch(err => console.error(`Video generation ${videoId} failed:`, err));
    });

    res.status(202).json({ ok: true, videoId, message: "Generation started" });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /training-videos/:id — single video detail
// ---------------------------------------------------------------------------
router.get("/training-videos/:id", requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await pool.query(`${VIDEO_SELECT} WHERE v.id=$1`, [id]);
    if (!rows.length) { res.status(404).json({ error: "not_found" }); return; }
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /training-videos/:id/regenerate
// ---------------------------------------------------------------------------
router.post("/training-videos/:id/regenerate", requireAuth, requireVideoAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await pool.query(
      `SELECT file_path AS "filePath", module_name AS "moduleName" FROM training_videos WHERE id=$1`,
      [id],
    );
    if (!rows.length) { res.status(404).json({ error: "not_found" }); return; }

    const moduleConfig = TRAINING_VIDEO_MODULES[rows[0].moduleName];
    if (!moduleConfig) {
      res.status(400).json({ error: "unknown_module", moduleName: rows[0].moduleName });
      return;
    }

    if (rows[0].filePath) {
      try { fsSync.unlinkSync(rows[0].filePath); } catch { /* ignore */ }
    }

    await pool.query(
      `UPDATE training_videos SET status='processing', progress_pct=0, progress_label='Restarting…',
       error_message=NULL, file_path=NULL, duration=NULL, updated_at=NOW() WHERE id=$1`,
      [id],
    );
    await logAudit({ userId: req.currentUser!.id, action: "regenerate_training_video", module: "manual", entityId: id });

    setImmediate(() => {
      generateModuleVideo(id, moduleConfig).catch(err => console.error(`Regeneration ${id} failed:`, err));
    });

    res.json({ ok: true, message: "Regeneration started" });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// PATCH /training-videos/:id — update metadata + status
// ---------------------------------------------------------------------------
router.patch("/training-videos/:id", requireAuth, requireVideoAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { status, title, description, category, moduleName } = req.body ?? {};

    if (status && !["draft", "published"].includes(status)) {
      res.status(400).json({ error: "invalid_status" }); return;
    }

    await pool.query(
      `UPDATE training_videos SET
         status      = COALESCE($1, status),
         title       = COALESCE($2, title),
         description = COALESCE($3, description),
         category    = COALESCE($4, category),
         module_name = COALESCE($5, module_name),
         updated_at  = NOW()
       WHERE id=$6`,
      [status ?? null, title ?? null, description ?? null, category ?? null, moduleName ?? null, id],
    );
    await logAudit({ userId: req.currentUser!.id, action: "update_training_video", module: "manual", entityId: id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// DELETE /training-videos/:id
// ---------------------------------------------------------------------------
router.delete("/training-videos/:id", requireAuth, requireVideoAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await pool.query(`DELETE FROM training_videos WHERE id=$1 RETURNING file_path AS "filePath"`, [id]);
    if (!rows.length) { res.status(404).json({ error: "not_found" }); return; }
    if (rows[0].filePath) { try { fsSync.unlinkSync(rows[0].filePath); } catch { /* ignore */ } }
    await logAudit({ userId: req.currentUser!.id, action: "delete_training_video", module: "manual", entityId: id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /training-videos/:id/upload — manual MP4 upload for existing record
// ---------------------------------------------------------------------------
router.post(
  "/training-videos/:id/upload",
  requireAuth, requireVideoAdmin,
  (req, res, next) => { upload.single("video")(req, res, err => err ? next(err) : next()); },
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!req.file) { res.status(400).json({ error: "no_file" }); return; }
      const { rows } = await pool.query(`SELECT file_path AS "filePath" FROM training_videos WHERE id=$1`, [id]);
      if (!rows.length) { res.status(404).json({ error: "not_found" }); return; }
      if (rows[0].filePath) { try { fsSync.unlinkSync(rows[0].filePath); } catch { /* ignore */ } }

      const newPath = path.join(DATA_DIR, `${id}.mp4`);
      fsSync.renameSync(req.file.path, newPath);

      const duration = probeDuration(newPath);

      await pool.query(
        `UPDATE training_videos SET file_path=$1, duration=$2, status='published',
         error_message=NULL, progress_pct=100, progress_label='Uploaded manually', updated_at=NOW() WHERE id=$3`,
        [newPath, duration, id],
      );
      await logAudit({ userId: req.currentUser!.id, action: "upload_training_video", module: "manual", entityId: id });

      res.json({ ok: true, duration });
    } catch (err) { next(err); }
  },
);

// ---------------------------------------------------------------------------
// GET /training-videos/:id/stream — range-request streaming + view count
// ---------------------------------------------------------------------------
router.get("/training-videos/:id/stream", requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await pool.query(
      `SELECT file_path AS "filePath", title, status FROM training_videos WHERE id=$1`, [id],
    );
    if (!rows.length) { res.status(404).json({ error: "not_found" }); return; }
    const v = rows[0];

    const isAdmin = isVideoAdmin(req);
    if (v.status !== "published" && !isAdmin) { res.status(403).json({ error: "forbidden" }); return; }

    if (!v.filePath || !fsSync.existsSync(v.filePath)) {
      res.status(404).json({ error: "file_not_found" }); return;
    }

    const range = req.headers.range;
    if (!range || range.startsWith("bytes=0-")) {
      pool.query(`UPDATE training_videos SET view_count = view_count + 1 WHERE id=$1`, [id]).catch(() => {});
    }

    const fileSize = fsSync.statSync(v.filePath).size;

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = Math.max(0, parseInt(parts[0], 10) || 0);
      const end   = Math.min(fileSize - 1, parts[1] ? (parseInt(parts[1], 10) || fileSize - 1) : fileSize - 1);
      if (start >= fileSize) { res.writeHead(416, { "Content-Range": `bytes */${fileSize}` }); res.end(); return; }
      res.writeHead(206, {
        "Content-Range":  `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges":  "bytes",
        "Content-Length": end - start + 1,
        "Content-Type":   "video/mp4",
      });
      fsSync.createReadStream(v.filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { "Content-Length": fileSize, "Content-Type": "video/mp4", "Accept-Ranges": "bytes" });
      fsSync.createReadStream(v.filePath).pipe(res);
    }
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /training-videos/:id/download — force-download
// ---------------------------------------------------------------------------
router.get("/training-videos/:id/download", requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await pool.query(`SELECT file_path AS "filePath", title, status FROM training_videos WHERE id=$1`, [id]);
    if (!rows.length) { res.status(404).json({ error: "not_found" }); return; }
    const v = rows[0];
    const isAdmin = isVideoAdmin(req);
    if (v.status !== "published" && !isAdmin) { res.status(403).json({ error: "forbidden" }); return; }
    if (!v.filePath || !fsSync.existsSync(v.filePath)) { res.status(404).json({ error: "file_not_found" }); return; }
    res.setHeader("Content-Disposition", `attachment; filename="${v.title.replace(/[^a-z0-9]/gi, "_")}.mp4"`);
    res.setHeader("Content-Type", "video/mp4");
    fsSync.createReadStream(v.filePath).pipe(res);
  } catch (err) { next(err); }
});

// ===========================================================================
// COMPLETION TRACKING
// ===========================================================================

// ---------------------------------------------------------------------------
// GET /training-videos/:id/progress — current user's completion record
// ---------------------------------------------------------------------------
router.get("/training-videos/:id/progress", requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const userId = req.currentUser!.id;
    const { rows } = await pool.query(
      `SELECT id, user_id AS "userId", training_video_id AS "trainingVideoId",
              started_at AS "startedAt", last_watched_at AS "lastWatchedAt", completed_at AS "completedAt",
              watch_percent AS "watchPercent", completion_status AS "completionStatus",
              total_watch_seconds AS "totalWatchSeconds", last_position_seconds AS "lastPositionSeconds",
              certificate_issued AS "certificateIssued"
       FROM training_completions WHERE training_video_id=$1 AND user_id=$2`,
      [id, userId],
    );
    res.json({ completion: rows[0] ?? null });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /training-videos/:id/progress — upsert watch progress (auto-save)
// ---------------------------------------------------------------------------
router.post("/training-videos/:id/progress", requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const userId = req.currentUser!.id;
    const { watchPercent, lastPositionSeconds, totalWatchSeconds } = req.body ?? {};

    const pct  = Math.min(100, Math.max(0, Number(watchPercent) || 0));
    const pos  = Math.max(0, Number(lastPositionSeconds) || 0);
    const secs = Math.max(0, Number(totalWatchSeconds) || 0);
    const newStatus = pct >= COMPLETION_THRESHOLD ? "completed" : pct > 0 ? "in_progress" : "not_started";

    await pool.query(`
      INSERT INTO training_completions
        (user_id, training_video_id, watch_percent, last_position_seconds, total_watch_seconds,
         completion_status, started_at, last_watched_at, completed_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW(),
        CASE WHEN $6 = 'completed' THEN NOW() ELSE NULL END)
      ON CONFLICT (user_id, training_video_id) DO UPDATE SET
        watch_percent         = GREATEST(training_completions.watch_percent, EXCLUDED.watch_percent),
        last_position_seconds = EXCLUDED.last_position_seconds,
        total_watch_seconds   = GREATEST(training_completions.total_watch_seconds, EXCLUDED.total_watch_seconds),
        completion_status     = CASE
          WHEN training_completions.completion_status = 'completed' THEN 'completed'
          ELSE EXCLUDED.completion_status
        END,
        last_watched_at = NOW(),
        completed_at    = CASE
          WHEN training_completions.completed_at IS NOT NULL THEN training_completions.completed_at
          WHEN EXCLUDED.completion_status = 'completed' THEN NOW()
          ELSE NULL
        END
    `, [userId, id, pct, pos, secs, newStatus]);

    res.json({ ok: true, status: newStatus });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /training-videos/:id/complete — mark complete + issue certificate
// ---------------------------------------------------------------------------
router.post("/training-videos/:id/complete", requireAuth, async (req, res, next) => {
  const id = Number(req.params.id);
  const userId = req.currentUser!.id;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Lock this user's completion row for the whole transaction — closes the
    // race where two concurrent calls (double-click, two open tabs) could
    // both read certificate_issued=FALSE before either commits, each
    // inserting its own certificate. The second call now blocks here until
    // the first commits, then correctly sees certificate_issued=TRUE.
    const { rows: compRows } = await client.query(
      `SELECT completion_status, watch_percent, certificate_issued
       FROM training_completions WHERE training_video_id=$1 AND user_id=$2 FOR UPDATE`,
      [id, userId],
    );

    if (!compRows.length || compRows[0].completion_status !== "completed") {
      await client.query("ROLLBACK");
      res.status(400).json({ error: "not_completed" }); return;
    }

    // Return existing active certificate if already issued
    if (compRows[0].certificate_issued) {
      const { rows: existing } = await client.query(
        `${CERT_SELECT} WHERE cert.user_id=$1 AND cert.training_video_id=$2 AND cert.is_active=TRUE
         ORDER BY cert.issued_at DESC LIMIT 1`,
        [userId, id],
      );
      await client.query("COMMIT");
      res.json({ certificate: existing[0] ?? null });
      return;
    }

    // Issue new certificate
    const { rows: certRows } = await client.query(`
      WITH issued AS (
        INSERT INTO training_certificates (certificate_id, user_id, training_video_id)
        VALUES ($1, $2, $3)
        RETURNING *
      )
      SELECT
        issued.id, issued.certificate_id AS "certificateId",
        issued.user_id AS "userId", issued.training_video_id AS "trainingVideoId",
        issued.issued_at AS "issuedAt", issued.revoked_at AS "revokedAt",
        issued.is_active AS "isActive",
        v.title AS "trainingVideoTitle",
        u.name AS "userName", u.role AS "userRole"
      FROM issued
      JOIN training_videos v ON v.id = issued.training_video_id
      JOIN users u ON u.id = issued.user_id
    `, [generateCertificateId(), userId, id]);

    await client.query(
      `UPDATE training_completions SET certificate_issued=TRUE WHERE user_id=$1 AND training_video_id=$2`,
      [userId, id],
    );
    await logAudit({ userId, action: "certificate_issued", module: "manual", entityId: certRows[0].id }, client);
    await client.query("COMMIT");

    res.json({ certificate: certRows[0] });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// ===========================================================================
// CERTIFICATES
// ===========================================================================

// ---------------------------------------------------------------------------
// GET /training-certificates/my — current user's certificates
// ---------------------------------------------------------------------------
router.get("/training-certificates/my", requireAuth, async (req, res, next) => {
  try {
    const userId = req.currentUser!.id;
    const { rows } = await pool.query(
      `${CERT_SELECT} WHERE cert.user_id=$1 ORDER BY cert.issued_at DESC`,
      [userId],
    );
    res.json({ certificates: rows });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /training-certificates/verify/:certId — public verification lookup
// (listed in PUBLIC_PREFIXES in middlewares/currentUser.ts — reachable with no session)
// ---------------------------------------------------------------------------
router.get("/training-certificates/verify/:certId", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `${CERT_SELECT} WHERE cert.certificate_id=$1`,
      [req.params.certId],
    );
    if (!rows.length) { res.status(404).json({ error: "not_found" }); return; }
    res.json({ certificate: rows[0] });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /training-certificates — admin: all certificates
// ---------------------------------------------------------------------------
router.get("/training-certificates", requireAuth, requireVideoAdmin, async (req, res, next) => {
  try {
    const { search, isActive } = req.query as Record<string, string>;
    const conditions: string[] = [];
    const params: unknown[] = [];
    let p = 1;

    if (isActive !== undefined && isActive !== "") {
      conditions.push(`cert.is_active=$${p++}`);
      params.push(isActive === "true");
    }
    if (search?.trim()) {
      conditions.push(`(u.name ILIKE $${p} OR cert.certificate_id ILIKE $${p} OR v.title ILIKE $${p})`);
      params.push(`%${search.trim()}%`); p++;
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const { rows } = await pool.query(
      `${CERT_SELECT} ${where} ORDER BY cert.issued_at DESC`,
      params,
    );
    res.json({ certificates: rows });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /training-certificates/:id/revoke — admin
// ---------------------------------------------------------------------------
router.post("/training-certificates/:id/revoke", requireAuth, requireVideoAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await pool.query(
      `UPDATE training_certificates SET is_active=FALSE, revoked_at=NOW(), revoked_by_id=$1
       WHERE id=$2 RETURNING id`,
      [req.currentUser!.id, id],
    );
    if (!rows.length) { res.status(404).json({ error: "not_found" }); return; }
    await logAudit({ userId: req.currentUser!.id, action: "certificate_revoked", module: "manual", entityId: id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /training-certificates/:id/reissue — admin
// ---------------------------------------------------------------------------
router.post("/training-certificates/:id/reissue", requireAuth, requireVideoAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows: orig } = await pool.query(
      `SELECT user_id, training_video_id FROM training_certificates WHERE id=$1`, [id],
    );
    if (!orig.length) { res.status(404).json({ error: "not_found" }); return; }

    // A revoked certificate must not be silently restored without
    // re-confirming the underlying completion is still genuinely valid — it
    // may have been revoked precisely because the completion itself was
    // found invalid, and reissuing here previously never re-checked that.
    const { rows: completion } = await pool.query(
      `SELECT completion_status FROM training_completions WHERE user_id=$1 AND training_video_id=$2`,
      [orig[0].user_id, orig[0].training_video_id],
    );
    if (!completion.length || completion[0].completion_status !== "completed") {
      res.status(409).json({ error: "completion_not_valid" });
      return;
    }

    // Revoke old cert
    await pool.query(
      `UPDATE training_certificates SET is_active=FALSE, revoked_at=NOW(), revoked_by_id=$1 WHERE id=$2`,
      [req.currentUser!.id, id],
    );

    // Issue replacement
    const { rows: newRows } = await pool.query(`
      WITH issued AS (
        INSERT INTO training_certificates
          (certificate_id, user_id, training_video_id, reissued_by_id, reissued_at)
        VALUES ($1, $2, $3, $4, NOW())
        RETURNING *
      )
      SELECT
        issued.id, issued.certificate_id AS "certificateId",
        issued.user_id AS "userId", issued.training_video_id AS "trainingVideoId",
        issued.issued_at AS "issuedAt", issued.is_active AS "isActive",
        v.title AS "trainingVideoTitle",
        u.name AS "userName", u.role AS "userRole"
      FROM issued
      JOIN training_videos v ON v.id = issued.training_video_id
      JOIN users u ON u.id = issued.user_id
    `, [generateCertificateId(), orig[0].user_id, orig[0].training_video_id, req.currentUser!.id]);

    await logAudit({ userId: req.currentUser!.id, action: "certificate_reissued", module: "manual", entityId: newRows[0].id });
    res.json({ certificate: newRows[0] });
  } catch (err) { next(err); }
});

export default router;
