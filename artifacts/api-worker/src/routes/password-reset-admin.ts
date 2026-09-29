import { Hono } from "hono";
import crypto from "node:crypto";
import type { Bindings } from "../lib/db";
import { openDb } from "../lib/db";
import { attachCurrentUser, requireAuth, logAudit, type Variables } from "../lib/rbac";
import { sendEmail, renderPasswordResetEmail, publicAppUrl, type EmailDeliveryStatus } from "../lib/mailer";

/**
 * Ported from artifacts/api-server/src/routes/password-reset-admin.ts —
 * another route file silently missing from the whole Cloudflare port
 * (found via the systematic api-server/routes/index.ts comparison).
 *
 * requireHqAdmin is a raw role-list check in the source, not a permission
 * string — reimplemented the same way rather than forcing it through
 * requirePerm, which gates on the permission table, not a hardcoded role
 * list.
 *
 * Note: this manages EXISTING password_reset_tokens rows (list/cancel/
 * resolve/resend); the self-service "forgot password" flow that CREATES the
 * first row (api-server's routes/auth.ts) has not been ported to this
 * worker either — a separate gap outside routes/profile.ts,
 * routes/health.ts, this file, and routes/ai.ts, flagged for the
 * systematic full comparison pass, not fixed here.
 */

const RESET_STATUSES = ["active", "used", "expired", "revoked"] as const;
const RESET_SOURCES = ["forgot_password", "admin_reset"] as const;

function hashToken(plain: string): string {
  return crypto.createHash("sha256").update(plain).digest("hex");
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

export const passwordResetAdminRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

passwordResetAdminRoutes.use("/password-reset-tokens/*", attachCurrentUser, requireAuth, async (c, next) => {
  const role = c.get("currentUser")!.role;
  if (!["super_admin", "executive_director", "program_manager"].includes(role)) {
    return c.json({ error: "forbidden" }, 403);
  }
  return next();
});

passwordResetAdminRoutes.get("/password-reset-tokens", async (c) => {
  const { db, close } = openDb(c);
  try {
    const status = c.req.query("status");
    const source = c.req.query("source");
    const search = c.req.query("search");
    const limit = c.req.query("limit");
    const offset = c.req.query("offset");

    await db.query(
      `UPDATE password_reset_tokens SET status = 'expired'
        WHERE status = 'active' AND expires_at < NOW()`,
    );

    const params: unknown[] = [];
    const where: string[] = [];

    if (status && (RESET_STATUSES as readonly string[]).includes(status)) {
      params.push(status);
      where.push(`prt.status = $${params.length}`);
    }
    if (source && (RESET_SOURCES as readonly string[]).includes(source)) {
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

    const { rows } = await db.query(
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

    const summaryRes = await db.query<{
      total: number; active: number; used: number; expired: number; revoked: number;
      selfService: number; adminReset: number;
    }>(
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

    return c.json({
      tokens: rows,
      total: summary.total,
      summary,
      limit: pageLimit,
      offset: pageOffset,
      hasMore: pageOffset + rows.length < summary.total,
      nextOffset: pageOffset + rows.length < summary.total ? pageOffset + rows.length : null,
    });
  } finally {
    close();
  }
});

passwordResetAdminRoutes.post("/password-reset-tokens/:id/cancel", async (c) => {
  const actor = c.get("currentUser")!;
  const id = Number(c.req.param("id"));
  const { db, close } = openDb(c);
  try {
    const { rows } = await db.query<{ id: number; userId: number }>(
      `UPDATE password_reset_tokens
          SET status = 'revoked', revoked_at = NOW(),
              handled_by_id = $2, handled_at = NOW()
        WHERE id = $1 AND status = 'active'
        RETURNING id, user_id AS "userId"`,
      [id, actor.id],
    );
    if (rows.length === 0) return c.json({ error: "not_found_or_not_active" }, 404);
    await logAudit(db, { userId: actor.id, action: "password_reset_cancelled", module: "password_reset", entityId: id });
    return c.json({ ok: true });
  } finally {
    close();
  }
});

passwordResetAdminRoutes.post("/password-reset-tokens/:id/resolve", async (c) => {
  const actor = c.get("currentUser")!;
  const id = Number(c.req.param("id"));
  const { db, close } = openDb(c);
  try {
    const { rows } = await db.query<{ id: number }>(
      `UPDATE password_reset_tokens
          SET resolved_at = NOW(), handled_by_id = $2, handled_at = NOW()
        WHERE id = $1
        RETURNING id`,
      [id, actor.id],
    );
    if (rows.length === 0) return c.json({ error: "not_found" }, 404);
    await logAudit(db, { userId: actor.id, action: "password_reset_resolved", module: "password_reset", entityId: id });
    return c.json({ ok: true });
  } finally {
    close();
  }
});

passwordResetAdminRoutes.post("/password-reset-tokens/:id/resend", async (c) => {
  const actor = c.get("currentUser")!;
  const id = Number(c.req.param("id"));
  const { db, close } = openDb(c);
  try {
    const { rows } = await db.query<{ userId: number; name: string; email: string }>(
      `SELECT prt.user_id AS "userId", u.name, u.email
         FROM password_reset_tokens prt JOIN users u ON u.id = prt.user_id
        WHERE prt.id = $1`,
      [id],
    );
    if (rows.length === 0) return c.json({ error: "not_found" }, 404);
    const user = rows[0];

    // Revoke all active tokens for this user
    await db.query(
      `UPDATE password_reset_tokens SET status = 'revoked', revoked_at = NOW(),
          handled_by_id = $2, handled_at = NOW()
        WHERE user_id = $1 AND status = 'active'`,
      [user.userId, actor.id],
    );

    const plainToken = Buffer.from(crypto.randomBytes(32)).toString("hex");
    const tokenHash = hashToken(plainToken);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    const newTokenInsert = await db.query<{ id: number }>(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, ip_address, user_agent, source, handled_by_id, handled_at)
       VALUES ($1, $2, $3, $4, $5, 'admin_reset', $6, NOW())
       RETURNING id`,
      [user.userId, tokenHash, expiresAt.toISOString(),
        c.req.header("CF-Connecting-IP") ?? null, c.req.header("User-Agent") ?? null, actor.id],
    );
    const newTokenId = newTokenInsert.rows[0]?.id;

    const resetLink = `${publicAppUrl(c.env)}/reset-password?token=${encodeURIComponent(plainToken)}`;
    const { html, text, subject } = renderPasswordResetEmail(c.env, { name: user.name, email: user.email, token: plainToken, expiresAt });

    let delivered = false;
    let emailDelivery: EmailDeliveryStatus = "pending";
    try {
      const result = await sendEmail(c.env, db, {
        to: user.email, subject, html, text, kind: "password_reset", userId: user.userId,
        meta: { resetLink, adminResend: true },
      });
      delivered = result.delivered;
      emailDelivery = result.status;
    } catch (emailErr) {
      emailDelivery = "failed";
      console.warn("[password-reset-admin:resend] email dispatch failed", emailErr);
    }
    if (newTokenId) {
      await db.query(`UPDATE password_reset_tokens SET email_status = $1 WHERE id = $2`, [emailDelivery, newTokenId]);
    }

    // The audit trail must reflect what actually happened — an admin relying on
    // this log to confirm a user was notified must not see "sent" for a
    // delivery that failed.
    await logAudit(db, {
      userId: actor.id,
      action: delivered ? "password_reset_email_sent" : "password_reset_email_failed",
      module: "password_reset",
      entityId: user.userId,
    });

    return c.json({ ok: true, resetLink, delivered, emailDelivery });
  } finally {
    close();
  }
});
