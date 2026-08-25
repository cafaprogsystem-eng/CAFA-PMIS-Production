import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import { pool } from "@workspace/db";
import { logAudit } from "../middlewares/currentUser";
import { sendEmail, renderPasswordResetEmail, publicAppUrl } from "../lib/mailer";

const router: IRouter = Router();
const RESET_STATUSES = ["active", "used", "expired", "revoked"] as const;
const RESET_SOURCES = ["forgot_password", "admin_reset"] as const;

function requireHqAdmin(req: any, res: any, next: any) {
  if (!req.currentUser) { res.status(401).json({ error: "unauthorized" }); return; }
  const role = req.currentUser.role;
  if (!["super_admin", "executive_director", "program_manager"].includes(role)) {
    res.status(403).json({ error: "forbidden" }); return;
  }
  next();
}

function hashToken(plain: string): string {
  return crypto.createHash("sha256").update(plain).digest("hex");
}

// Auto-expire stale tokens helper
async function autoExpire() {
  await pool.query(
    `UPDATE password_reset_tokens SET status = 'expired'
     WHERE status = 'active' AND expires_at < NOW()`,
  );
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

// GET /password-reset-tokens — admin list with filters
router.get("/password-reset-tokens", requireHqAdmin, async (req, res, next) => {
  try {
    const { status, source, search, limit, offset } = req.query as Record<string, string | undefined>;

    await autoExpire();

    const params: unknown[] = [];
    const where: string[] = [];

    if (status && RESET_STATUSES.includes(status as typeof RESET_STATUSES[number])) {
      params.push(status);
      where.push(`prt.status = $${params.length}`);
    }
    if (source && RESET_SOURCES.includes(source as typeof RESET_SOURCES[number])) {
      params.push(source);
      where.push(`prt.source = $${params.length}`);
    }
    const normalisedSearch = search?.trim();
    if (normalisedSearch) {
      params.push(`%${normalisedSearch}%`);
      where.push(`(LOWER(u.name) LIKE LOWER($${params.length}) OR LOWER(u.email) LIKE LOWER($${params.length}))`);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const filterParams = [...params];
    const pageLimit = boundedInteger(limit, 25, 1, 100);
    const pageOffset = boundedInteger(offset, 0, 0, Number.MAX_SAFE_INTEGER);

    params.push(pageLimit, pageOffset);
    const limitIdx = params.length - 1;
    const offsetIdx = params.length;

    const { rows } = await pool.query(
      `SELECT prt.id, prt.status, prt.source, prt.email_status AS "emailStatus",
              prt.created_at AS "requestedAt",
              prt.expires_at AS "expiresAt",
              prt.used_at AS "usedAt",
              prt.revoked_at AS "revokedAt",
              prt.resolved_at AS "resolvedAt",
              prt.handled_at AS "handledAt",
              prt.ip_address AS "ipAddress",
              u.id AS "userId", u.name AS "userName", u.email AS "userEmail", u.role,
              hb.name AS "handledByName"
       FROM password_reset_tokens prt
       JOIN users u ON u.id = prt.user_id
       LEFT JOIN users hb ON hb.id = prt.handled_by_id
       ${whereClause}
       ORDER BY prt.created_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );

    const summaryRes = await pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE prt.status = 'active')::int AS active,
         COUNT(*) FILTER (WHERE prt.status = 'used')::int AS used,
         COUNT(*) FILTER (WHERE prt.status = 'expired')::int AS expired,
         COUNT(*) FILTER (WHERE prt.status = 'revoked')::int AS revoked,
         COUNT(*) FILTER (WHERE prt.source = 'forgot_password')::int AS "selfService",
         COUNT(*) FILTER (WHERE prt.source = 'admin_reset')::int AS "adminReset"
       FROM password_reset_tokens prt
       JOIN users u ON u.id = prt.user_id
       ${whereClause}`,
      filterParams,
    );
    const summary = summaryRes.rows[0] ?? {
      total: 0, active: 0, used: 0, expired: 0, revoked: 0, selfService: 0, adminReset: 0,
    };

    res.json({
      tokens: rows,
      total: summary.total,
      summary,
      limit: pageLimit,
      offset: pageOffset,
      hasMore: pageOffset + rows.length < summary.total,
      nextOffset: pageOffset + rows.length < summary.total ? pageOffset + rows.length : null,
    });
  } catch (err) { next(err); }
});

// POST /password-reset-tokens/:id/cancel — admin cancel an active token
router.post("/password-reset-tokens/:id/cancel", requireHqAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await pool.query(
      `UPDATE password_reset_tokens
       SET status = 'revoked', revoked_at = NOW(),
           handled_by_id = $2, handled_at = NOW()
       WHERE id = $1 AND status = 'active'
       RETURNING id, user_id AS "userId"`,
      [id, req.currentUser!.id],
    );
    if (rows.length === 0) { res.status(404).json({ error: "not_found_or_not_active" }); return; }
    await logAudit({ userId: req.currentUser!.id, action: "password_reset_cancelled", module: "password_reset", entityId: id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /password-reset-tokens/:id/resolve — mark a request as resolved (admin follow-up)
router.post("/password-reset-tokens/:id/resolve", requireHqAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await pool.query(
      `UPDATE password_reset_tokens
       SET resolved_at = NOW(), handled_by_id = $2, handled_at = NOW()
       WHERE id = $1
       RETURNING id`,
      [id, req.currentUser!.id],
    );
    if (rows.length === 0) { res.status(404).json({ error: "not_found" }); return; }
    await logAudit({ userId: req.currentUser!.id, action: "password_reset_resolved", module: "password_reset", entityId: id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /password-reset-tokens/:id/resend — admin resend reset link for a token's user
router.post("/password-reset-tokens/:id/resend", requireHqAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await pool.query(
      `SELECT prt.user_id AS "userId", u.name, u.email
       FROM password_reset_tokens prt JOIN users u ON u.id = prt.user_id
       WHERE prt.id = $1`,
      [id],
    );
    if (rows.length === 0) { res.status(404).json({ error: "not_found" }); return; }
    const user = rows[0];

    // Revoke all active tokens for this user
    await pool.query(
      `UPDATE password_reset_tokens SET status = 'revoked', revoked_at = NOW(),
       handled_by_id = $2, handled_at = NOW()
       WHERE user_id = $1 AND status = 'active'`,
      [user.userId, req.currentUser!.id],
    );

    const plainToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashToken(plainToken);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    const newTokenInsert = await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, ip_address, user_agent, source, handled_by_id, handled_at)
       VALUES ($1, $2, $3, $4, $5, 'admin_reset', $6, NOW())
       RETURNING id`,
      [user.userId, tokenHash, expiresAt.toISOString(),
       req.ip ?? null, req.headers["user-agent"] ?? null, req.currentUser!.id],
    );
    const newTokenId = newTokenInsert.rows[0]?.id;

    const resetLink = `${publicAppUrl()}/reset-password?token=${encodeURIComponent(plainToken)}`;
    const { html, text, subject } = renderPasswordResetEmail({ name: user.name, email: user.email, token: plainToken, expiresAt });
    const { delivered } = await sendEmail({ to: user.email, subject, html, text, kind: "password_reset", userId: user.userId, meta: { resetLink, adminResend: true } });
    if (delivered && newTokenId) {
      await pool.query(`UPDATE password_reset_tokens SET email_status = 'sent' WHERE id = $1`, [newTokenId]);
    }

    await logAudit({ userId: req.currentUser!.id, action: "password_reset_email_sent", module: "password_reset", entityId: user.userId });

    res.json({ ok: true, resetLink });
  } catch (err) { next(err); }
});

export default router;
