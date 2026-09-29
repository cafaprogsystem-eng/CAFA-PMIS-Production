import { Hono } from "hono";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import type { Bindings } from "../lib/db";
import { openDb } from "../lib/db";
import { createSession, revokeAllSessionsForUser, setSessionCookie } from "../lib/session";
import { disconnectUser } from "../lib/realtime";
import { permissionsFor, logAudit, type CurrentUser, type Variables } from "../lib/rbac";
import { validatePassword } from "../lib/password";
import {
  sendEmail,
  renderPasswordResetEmail,
  renderPasswordResetConfirmEmail,
  renderVerifyEmail,
  publicAppUrl,
  type EmailDeliveryStatus,
} from "../lib/mailer";
import { isRateLimited } from "../lib/rate-limit-store";

/**
 * Ported from artifacts/api-server/src/routes/auth.ts — everything except
 * /auth/login, /auth/me, /auth/logout, already hand-rolled directly in
 * index.ts. This was the highest-priority gap found by the systematic
 * api-server/routes/index.ts comparison: without these 8 routes, an
 * invited user has no way to consume their invite and set a password
 * (blocking all real staff onboarding), and there is no self-service
 * password recovery or email verification.
 *
 * The two createNotificationDeduped(...) calls in the source (a
 * "password_changed" and an "email_verified" in-app notice, both
 * mandatory + suppressEmail — i.e. purely supplementary to the dedicated
 * confirmation emails below, which ARE sent) are dropped, not ported
 * broken: lib/notifications.ts's ~900-line creation/dedup engine has not
 * been ported to this worker at all yet, for any route — this is the
 * same established, already-approved deferral used everywhere else in
 * this migration (notification *creation* stays out of scope pending a
 * dedicated pass), not a new decision made here.
 */

const RESET_RATE_MAX = 3;
const RESET_RATE_WINDOW_MS = 15 * 60 * 1000;
const VERIFY_RATE_MAX = 5;
const VERIFY_RATE_WINDOW_MS = 60 * 60 * 1000;

function hashToken(plain: string): string {
  return crypto.createHash("sha256").update(plain).digest("hex");
}

function clientIp(c: { req: { header(name: string): string | undefined } }): string {
  return c.req.header("CF-Connecting-IP") ?? "unknown";
}

export const authRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// INVITE LOOKUP ---------------------------------------------------------
// Public — used by the activation page to display who the invite is for.
authRoutes.get("/auth/invite/:token", async (c) => {
  const token = c.req.param("token");
  const { db, close } = openDb(c);
  try {
    const { rows } = await db.query<{
      id: number; name: string; email: string; role: string; roleLabel: string;
      sector: string | null; stateName: string | null; stateNameAr: string | null;
      expiresAt: string | null; status: string;
    }>(
      `SELECT u.id, u.name, u.email, u.role, u.role_label AS "roleLabel",
              u.sector, s.name AS "stateName", s.name_ar AS "stateNameAr", u.invite_expires_at AS "expiresAt", u.status
         FROM users u LEFT JOIN states s ON s.id = u.state_id
        WHERE u.invite_token = $1`,
      [token],
    );
    const row = rows[0];
    if (!row) return c.json({ error: "invite_invalid_or_used" }, 410);
    if (row.status === "active") return c.json({ error: "invite_already_accepted" }, 410);
    if (!row.expiresAt || new Date(row.expiresAt).getTime() < Date.now()) {
      return c.json({ error: "invite_expired" }, 410);
    }
    return c.json({
      name: row.name, email: row.email, role: row.role, roleLabel: row.roleLabel,
      sector: row.sector ?? null, stateName: row.stateName ?? null, stateNameAr: row.stateNameAr ?? null,
      expiresAt: new Date(row.expiresAt).toISOString(),
    });
  } finally {
    close();
  }
});

// ACCEPT INVITATION (query-param version) --------------------------------
// Public — mirrors /auth/invite/:token but reads token from ?token= query param.
authRoutes.get("/auth/accept-invitation", async (c) => {
  const token = c.req.query("token") ?? "";
  if (!token) return c.json({ error: "token_required" }, 400);
  const { db, close } = openDb(c);
  try {
    const { rows } = await db.query<{
      id: number; name: string; email: string; role: string; roleLabel: string;
      sector: string | null; stateName: string | null; expiresAt: string | null; status: string;
    }>(
      `SELECT u.id, u.name, u.email, u.role, u.role_label AS "roleLabel",
              u.sector, s.name AS "stateName", u.invite_expires_at AS "expiresAt", u.status
         FROM users u LEFT JOIN states s ON s.id = u.state_id
        WHERE u.invite_token = $1`,
      [token],
    );
    const row = rows[0];
    if (!row) return c.json({ error: "invite_invalid_or_used" }, 410);
    if (row.status === "active") return c.json({ error: "invite_already_accepted" }, 410);
    if (!row.expiresAt || new Date(row.expiresAt).getTime() < Date.now()) {
      return c.json({ error: "invite_expired" }, 410);
    }
    return c.json({
      name: row.name, email: row.email, role: row.role, roleLabel: row.roleLabel,
      sector: row.sector ?? null, stateName: row.stateName ?? null,
      expiresAt: new Date(row.expiresAt).toISOString(),
    });
  } finally {
    close();
  }
});

// ACCEPT INVITE -----------------------------------------------------------
// Public — sets the password from the invite token and auto-logs the user in.
authRoutes.post("/auth/accept-invite", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { token, password } = body as Record<string, unknown>;
  const tokenStr = String(token ?? "");
  const passwordStr = String(password ?? "");
  if (!tokenStr) return c.json({ error: "token_required" }, 400);
  const pw = validatePassword(passwordStr);
  if (!pw.ok) return c.json({ error: pw.error }, 400);

  const { db, close } = openDb(c);
  try {
    const preCheck = await db.query<{ id: number; invite_expires_at: string | null; status: string }>(
      `SELECT u.id, u.invite_expires_at, u.status FROM users u WHERE u.invite_token = $1`,
      [tokenStr],
    );
    const preRow = preCheck.rows[0];
    if (!preRow) return c.json({ error: "invite_invalid_or_used" }, 410);
    if (preRow.status === "active") return c.json({ error: "invite_already_accepted" }, 410);
    if (!preRow.invite_expires_at || new Date(preRow.invite_expires_at).getTime() < Date.now()) {
      return c.json({ error: "invite_expired" }, 410);
    }

    const hash = await bcrypt.hash(passwordStr, 12);
    // Atomic claim: bind the UPDATE to the exact token + status + non-expired
    // window so a concurrent resend/cancel/accept invalidates this attempt.
    const claimed = await db.query<{
      id: number; name: string; email: string; role: string; role_label: string;
      scope: string; state_id: number | null; sector: string | null; state_name: string | null;
    }>(
      `WITH upd AS (
         UPDATE users
            SET password_hash = $1, status = 'active', invite_token = NULL,
                invite_expires_at = NULL, invite_accepted_at = NOW(),
                last_login_at = NOW(), updated_at = NOW()
          WHERE invite_token = $2
            AND status = 'invited'
            AND invite_expires_at > NOW()
          RETURNING id, name, email, role, role_label, scope, state_id, sector
       )
       SELECT u.*, s.name AS state_name
         FROM upd u LEFT JOIN states s ON s.id = u.state_id`,
      [hash, tokenStr],
    );
    const row = claimed.rows[0];
    if (!row) return c.json({ error: "invite_invalid_or_used" }, 410);

    // Accepting the invite proves email ownership.
    await db.query(
      `UPDATE users SET email_verified = TRUE, email_verified_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [row.id],
    );
    const { token: sessionToken } = await createSession(db, row.id, false);
    setSessionCookie(c, sessionToken, false);
    await logAudit(db, { userId: row.id, action: "invite_accept", module: "auth", entityId: row.id });

    const currentUser: CurrentUser = {
      id: row.id, name: row.name, email: row.email,
      role: row.role, roleLabel: row.role_label, scope: row.scope,
      stateId: row.state_id, stateName: row.state_name,
      sector: row.sector, avatarUrl: null,
      sectors: row.role === "technical_coordinator" && row.sector
        ? String(row.sector).split(",").map((s) => s.trim()).filter(Boolean)
        : null,
    };
    return c.json({ user: currentUser, permissions: permissionsFor(currentUser) });
  } finally {
    close();
  }
});

// FORGOT PASSWORD -----------------------------------------------------------
// Public. Rate-limited (3/15 min per IP). Always returns the same neutral
// message regardless of whether the email exists, to prevent enumeration.
authRoutes.post("/auth/forgot-password", async (c) => {
  const { db, close } = openDb(c);
  try {
    const ip = clientIp(c);
    if (await isRateLimited(db, "password_reset_request", ip, RESET_RATE_MAX, RESET_RATE_WINDOW_MS)) {
      return c.json({ error: "too_many_requests" }, 429);
    }

    const body = await c.req.json().catch(() => ({}));
    const email = String((body as Record<string, unknown>).email ?? "").trim().toLowerCase();
    if (!email) return c.json({ error: "email_required" }, 400);

    const neutral = { ok: true, message: "If the email is registered, a password reset link has been sent." };

    const { rows } = await db.query<{ id: number; name: string; email: string }>(
      `SELECT id, name, email FROM users WHERE LOWER(email) = $1 AND status = 'active' LIMIT 1`,
      [email],
    );
    if (rows.length === 0) return c.json(neutral);
    const user = rows[0];

    await db.query(
      `UPDATE password_reset_tokens SET status = 'revoked', revoked_at = NOW()
        WHERE user_id = $1 AND status = 'active'`,
      [user.id],
    );

    const plainToken = Buffer.from(crypto.randomBytes(32)).toString("hex");
    const tokenHash = hashToken(plainToken);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    const tokenInsert = await db.query<{ id: number }>(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, ip_address, user_agent, source)
       VALUES ($1, $2, $3, $4, $5, 'forgot_password')
       RETURNING id`,
      [user.id, tokenHash, expiresAt.toISOString(), ip, c.req.header("User-Agent") ?? null],
    );
    const tokenId = tokenInsert.rows[0]?.id;

    const resetLink = `${publicAppUrl(c.env)}/reset-password?token=${encodeURIComponent(plainToken)}`;
    const { html, text, subject } = renderPasswordResetEmail(c.env, { name: user.name, email: user.email, token: plainToken, expiresAt });

    let delivered = false;
    let emailDelivery: EmailDeliveryStatus = "pending";
    try {
      const result = await sendEmail(c.env, db, {
        to: user.email, subject, html, text, kind: "password_reset", userId: user.id, meta: { resetLink },
      });
      delivered = result.delivered;
      emailDelivery = result.status;
    } catch (emailErr) {
      emailDelivery = "failed";
      console.warn("[auth] forgot-password email dispatch threw", emailErr);
    }
    if (tokenId) {
      await db.query(`UPDATE password_reset_tokens SET email_status = $1 WHERE id = $2`, [emailDelivery, tokenId]);
    }

    await logAudit(db, { userId: user.id, action: "forgot_password_request", module: "auth", entityId: user.id });

    // Never expose the raw reset link in production, regardless of *why*
    // delivery failed — this endpoint is public and unauthenticated, so
    // leaking a working reset link here is an account-takeover primitive,
    // not a debugging convenience. Non-production keeps the old
    // surface-the-link-for-testers behavior (see wrangler.toml's
    // env.production.vars NODE_ENV comment for why this is safe).
    if (!delivered) {
      if (c.env.NODE_ENV === "production") {
        console.warn("[auth] password reset email failed to send — link withheld from API response", { userId: user.id });
      } else {
        return c.json({ ...neutral, devResetLink: resetLink });
      }
    }
    return c.json(neutral);
  } finally {
    close();
  }
});

// VALIDATE RESET TOKEN --------------------------------------------------
// Public. Used by the reset-password page to check token validity before
// rendering the form.
authRoutes.get("/auth/reset-password/validate", async (c) => {
  const plain = c.req.query("token") ?? "";
  if (!plain) return c.json({ error: "token_required" }, 400);
  const { db, close } = openDb(c);
  try {
    const tHash = hashToken(plain);
    const { rows } = await db.query<{
      id: number; status: string; expiresAt: string; email: string; name: string;
    }>(
      `SELECT prt.id, prt.status, prt.expires_at AS "expiresAt", u.email, u.name
         FROM password_reset_tokens prt
         JOIN users u ON u.id = prt.user_id
        WHERE prt.token_hash = $1`,
      [tHash],
    );
    const row = rows[0];
    if (!row) return c.json({ error: "token_invalid" }, 410);
    if (row.status === "used") return c.json({ error: "token_used" }, 410);
    if (row.status === "revoked") return c.json({ error: "token_revoked" }, 410);
    if (new Date(row.expiresAt).getTime() < Date.now()) {
      await db.query(`UPDATE password_reset_tokens SET status = 'expired' WHERE id = $1`, [row.id]);
      return c.json({ error: "token_expired" }, 410);
    }
    return c.json({ ok: true, email: row.email, name: row.name });
  } finally {
    close();
  }
});

// RESET PASSWORD ----------------------------------------------------------
// Public. Validates token, sets new password, marks token used, notifies user.
authRoutes.post("/auth/reset-password", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { token, password: newPassword } = body as Record<string, unknown>;
  const plain = String(token ?? "");
  const newPasswordStr = String(newPassword ?? "");
  if (!plain) return c.json({ error: "token_required" }, 400);
  const pw = validatePassword(newPasswordStr);
  if (!pw.ok) return c.json({ error: pw.error }, 400);

  const { db, pool, close } = openDb(c);
  try {
    const tHash = hashToken(plain);
    const { rows } = await db.query<{
      id: number; status: string; expiresAt: string; userId: number; email: string; name: string;
    }>(
      `SELECT prt.id, prt.status, prt.expires_at AS "expiresAt", prt.user_id AS "userId", u.email, u.name
         FROM password_reset_tokens prt
         JOIN users u ON u.id = prt.user_id
        WHERE prt.token_hash = $1`,
      [tHash],
    );
    const row = rows[0];
    if (!row) return c.json({ error: "token_invalid" }, 410);
    if (row.status === "used") return c.json({ error: "token_used" }, 410);
    if (row.status === "revoked") return c.json({ error: "token_revoked" }, 410);
    if (new Date(row.expiresAt).getTime() < Date.now()) {
      await db.query(`UPDATE password_reset_tokens SET status = 'expired' WHERE id = $1`, [row.id]);
      return c.json({ error: "token_expired" }, 410);
    }

    const hash = await bcrypt.hash(newPasswordStr, 12);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [hash, row.userId]);
      await client.query(`UPDATE password_reset_tokens SET status = 'used', used_at = NOW() WHERE id = $1`, [row.id]);
      await client.query("COMMIT");
    } catch (txErr) {
      await client.query("ROLLBACK");
      throw txErr;
    } finally {
      client.release();
    }

    // A password reset means any session established before it — a stolen
    // cookie, an unattended device — must not outlive the old credential.
    await revokeAllSessionsForUser(db, row.userId);
    await disconnectUser(c.env, row.userId);

    const { html, text, subject } = renderPasswordResetConfirmEmail(c.env, { name: row.name, email: row.email });
    await sendEmail(c.env, db, { to: row.email, subject, html, text, kind: "password_reset_confirm" });

    await logAudit(db, { userId: row.userId, action: "password_reset", module: "auth", entityId: row.userId });

    return c.json({ ok: true });
  } finally {
    close();
  }
});

// SEND VERIFICATION EMAIL ---------------------------------------------------
// Public. Rate-limited (5/hour per IP). Sends or resends a verification email.
authRoutes.post("/auth/send-verification-email", async (c) => {
  const { db, close } = openDb(c);
  try {
    const ip = clientIp(c);
    if (await isRateLimited(db, "verify_email_send", ip, VERIFY_RATE_MAX, VERIFY_RATE_WINDOW_MS)) {
      return c.json({ error: "too_many_requests" }, 429);
    }

    const body = await c.req.json().catch(() => ({}));
    const email = String((body as Record<string, unknown>).email ?? "").trim().toLowerCase();
    if (!email) return c.json({ error: "email_required" }, 400);

    const neutral = { ok: true, message: "If that email is registered, a verification link has been sent." };

    const { rows } = await db.query<{ id: number; name: string; email: string; emailVerified: boolean | null }>(
      `SELECT id, name, email, email_verified AS "emailVerified" FROM users WHERE LOWER(email) = $1 AND status NOT IN ('deactivated') LIMIT 1`,
      [email],
    );
    if (rows.length === 0) return c.json(neutral);
    const user = rows[0];
    if (user.emailVerified) return c.json({ ok: true, alreadyVerified: true });

    await db.query(
      `UPDATE email_verification_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL`,
      [user.id],
    );

    const plainToken = Buffer.from(crypto.randomBytes(32)).toString("hex");
    const tokenHash = hashToken(plainToken);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await db.query(
      `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at, ip_address) VALUES ($1, $2, $3, $4)`,
      [user.id, tokenHash, expiresAt.toISOString(), ip],
    );

    const { html, text, subject } = renderVerifyEmail(c.env, { name: user.name, email: user.email, token: plainToken, expiresAt });
    const { delivered } = await sendEmail(c.env, db, { to: user.email, subject, html, text, kind: "email_verification", userId: user.id });
    await logAudit(db, { userId: user.id, action: "verification_email_sent", module: "auth", entityId: user.id });

    // Same rationale as /auth/forgot-password above.
    if (!delivered) {
      if (c.env.NODE_ENV === "production") {
        console.warn("[auth] verification email failed to send — link withheld from API response", { userId: user.id });
      } else {
        return c.json({ ...neutral, devVerifyLink: `${publicAppUrl(c.env)}/verify-email?token=${encodeURIComponent(plainToken)}` });
      }
    }
    return c.json(neutral);
  } finally {
    close();
  }
});

// VERIFY EMAIL --------------------------------------------------------------
// Public. Validates token, marks email_verified=true.
authRoutes.get("/auth/verify-email", async (c) => {
  const plain = c.req.query("token") ?? "";
  if (!plain) return c.json({ error: "token_required" }, 400);
  const tokenHash = hashToken(plain);

  const { db, pool, close } = openDb(c);
  try {
    const { rows } = await db.query<{
      id: number; userId: number; usedAt: string | null; expiresAt: string;
      email: string; emailVerified: boolean | null;
    }>(
      `SELECT evt.id, evt.user_id AS "userId", evt.used_at AS "usedAt", evt.expires_at AS "expiresAt",
              u.email, u.email_verified AS "emailVerified"
         FROM email_verification_tokens evt
         JOIN users u ON u.id = evt.user_id
        WHERE evt.token_hash = $1`,
      [tokenHash],
    );
    const row = rows[0];
    if (!row) return c.json({ error: "token_invalid" }, 410);
    if (row.usedAt) return c.json({ error: "token_used" }, 410);
    if (new Date(row.expiresAt).getTime() < Date.now()) return c.json({ error: "token_expired" }, 410);
    if (row.emailVerified) {
      await db.query(`UPDATE email_verification_tokens SET used_at = NOW() WHERE id = $1`, [row.id]);
      return c.json({ ok: true, alreadyVerified: true });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE users SET email_verified = TRUE, email_verified_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [row.userId],
      );
      await client.query(`UPDATE email_verification_tokens SET used_at = NOW() WHERE id = $1`, [row.id]);
      await client.query("COMMIT");
    } catch (txErr) {
      await client.query("ROLLBACK");
      throw txErr;
    } finally {
      client.release();
    }

    await logAudit(db, { userId: row.userId, action: "email_verified", module: "auth", entityId: row.userId });

    return c.json({ ok: true });
  } finally {
    close();
  }
});
