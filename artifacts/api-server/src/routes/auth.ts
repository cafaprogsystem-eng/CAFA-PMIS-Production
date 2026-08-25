import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { pool } from "@workspace/db";
import {
  clearSessionCookie,
  createSession,
  revokeSession,
  setSessionCookie,
} from "../lib/session";
import { realtime } from "../lib/realtime";
import { permissionsFor, type CurrentUser } from "../middlewares/currentUser";
import { logAudit } from "../middlewares/currentUser";
import { validatePassword } from "../lib/password";
import {
  sendEmail,
  renderPasswordResetEmail,
  renderPasswordResetConfirmEmail,
  renderInviteEmail,
  renderVerifyEmail,
  publicAppUrl,
} from "../lib/mailer";
import { createNotificationDeduped } from "../lib/notifications";

// Simple in-memory rate limiter — configurable window/max.
function makeRateLimiter(max: number, windowMs: number) {
  const map = new Map<string, number[]>();
  return (ip: string): boolean => {
    const now = Date.now();
    const times = (map.get(ip) ?? []).filter((t) => now - t < windowMs);
    if (times.length >= max) return true;
    times.push(now);
    map.set(ip, times);
    return false;
  };
}

// 3 password reset requests per 15 min per IP
const resetRateMap = new Map<string, number[]>();
function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const window = 15 * 60 * 1000;
  const times = (resetRateMap.get(ip) ?? []).filter((t) => now - t < window);
  if (times.length >= 3) return true;
  times.push(now);
  resetRateMap.set(ip, times);
  return false;
}

function hashToken(plain: string): string {
  return crypto.createHash("sha256").update(plain).digest("hex");
}

const router: IRouter = Router();

router.post("/auth/login", async (req, res, next) => {
  try {
    const identifier = String(req.body?.identifier ?? req.body?.username ?? req.body?.email ?? "").trim();
    const password = String(req.body?.password ?? "");
    const remember = Boolean(req.body?.remember);

    if (!identifier || !password) {
      res.status(400).json({ error: "identifier_and_password_required" });
      return;
    }

    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.email, u.username, u.password_hash, u.role, u.role_label, u.scope, u.state_id, u.sector, u.status, s.name AS state_name
       FROM users u
       LEFT JOIN states s ON s.id = u.state_id
       WHERE LOWER(u.email) = LOWER($1) OR LOWER(u.username) = LOWER($1)
       LIMIT 1`,
      [identifier],
    );
    const row = rows[0];
    if (!row || !row.password_hash) {
      res.status(401).json({ error: "invalid_credentials" });
      return;
    }

    const ok = await bcrypt.compare(password, row.password_hash);
    if (!ok) {
      res.status(401).json({ error: "invalid_credentials" });
      return;
    }

    // Only active accounts may sign in.
    if (row.status && row.status !== "active") {
      res.status(403).json({ error: "account_not_active", status: row.status });
      return;
    }

    await pool.query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [row.id]);
    const { token } = await createSession(row.id, remember);
    setSessionCookie(res, token, remember);

    const user: CurrentUser = {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      roleLabel: row.role_label,
      scope: row.scope,
      stateId: row.state_id,
      stateName: row.state_name,
      sector: row.sector,
      avatarUrl: row.avatar_url ?? null,
      sectors: row.role === "technical_coordinator" && row.sector
        ? String(row.sector).split(",").map((s) => s.trim()).filter(Boolean)
        : null,
    };

    await logAudit({ userId: user.id, action: "login", module: "auth", entityId: user.id });

    res.json({
      user: { ...user, username: row.username ?? null, status: row.status ?? "active" },
      permissions: permissionsFor(user),
    });
  } catch (err) {
    next(err);
  }
});

// INVITE LOOKUP ---------------------------------------------------------
// Public — used by the activation page to display who the invite is for.
// Returns 410 Gone when the token is missing, expired, or already used.
router.get("/auth/invite/:token", async (req, res, next) => {
  try {
    const token = String(req.params.token ?? "");
    if (!token) { res.status(400).json({ error: "token_required" }); return; }
    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.email, u.role, u.role_label AS "roleLabel",
              u.sector, s.name AS "stateName", s.name_ar AS "stateNameAr", u.invite_expires_at AS "expiresAt", u.status
       FROM users u LEFT JOIN states s ON s.id = u.state_id
       WHERE u.invite_token = $1`,
      [token],
    );
    const row = rows[0];
    if (!row) { res.status(410).json({ error: "invite_invalid_or_used" }); return; }
    if (row.status === "active") { res.status(410).json({ error: "invite_already_accepted" }); return; }
    if (!row.expiresAt || new Date(row.expiresAt).getTime() < Date.now()) {
      res.status(410).json({ error: "invite_expired" });
      return;
    }
    res.json({
      name: row.name, email: row.email, role: row.role, roleLabel: row.roleLabel,
      sector: row.sector ?? null, stateName: row.stateName ?? null, stateNameAr: row.stateNameAr ?? null,
      expiresAt: new Date(row.expiresAt).toISOString(),
    });
  } catch (err) { next(err); }
});

// ACCEPT INVITATION (query-param version) ------------------------------------
// Public — mirrors /auth/invite/:token but reads token from ?token= query param.
// Used by the /accept-invitation?token= frontend route from email links.
router.get("/auth/accept-invitation", async (req, res, next) => {
  try {
    const token = String(req.query.token ?? "");
    if (!token) { res.status(400).json({ error: "token_required" }); return; }
    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.email, u.role, u.role_label AS "roleLabel",
              u.sector, s.name AS "stateName", u.invite_expires_at AS "expiresAt", u.status
       FROM users u LEFT JOIN states s ON s.id = u.state_id
       WHERE u.invite_token = $1`,
      [token],
    );
    const row = rows[0];
    if (!row) { res.status(410).json({ error: "invite_invalid_or_used" }); return; }
    if (row.status === "active") { res.status(410).json({ error: "invite_already_accepted" }); return; }
    if (!row.expiresAt || new Date(row.expiresAt).getTime() < Date.now()) {
      res.status(410).json({ error: "invite_expired" }); return;
    }
    res.json({
      name: row.name, email: row.email, role: row.role, roleLabel: row.roleLabel,
      sector: row.sector ?? null, stateName: row.stateName ?? null,
      expiresAt: new Date(row.expiresAt).toISOString(),
    });
  } catch (err) { next(err); }
});

// ACCEPT INVITE ---------------------------------------------------------
// Public — sets the password from the invite token and auto-logs the user in.
// Token is single-use: cleared on success. Fails closed for expired/used tokens.
router.post("/auth/accept-invite", async (req, res, next) => {
  try {
    const token = String(req.body?.token ?? "");
    const password = String(req.body?.password ?? "");
    if (!token) { res.status(400).json({ error: "token_required" }); return; }
    const pw = validatePassword(password);
    if (!pw.ok) { res.status(400).json({ error: pw.error }); return; }

    // Look up first (read-only) so we can return distinct error codes (expired vs used).
    const { rows } = await pool.query(
      `SELECT u.id, u.invite_expires_at, u.status
         FROM users u WHERE u.invite_token = $1`,
      [token],
    );
    const preRow = rows[0];
    if (!preRow) { res.status(410).json({ error: "invite_invalid_or_used" }); return; }
    if (preRow.status === "active") { res.status(410).json({ error: "invite_already_accepted" }); return; }
    if (!preRow.invite_expires_at || new Date(preRow.invite_expires_at).getTime() < Date.now()) {
      res.status(410).json({ error: "invite_expired" });
      return;
    }

    const hash = await bcrypt.hash(password, 12);
    // Atomic claim: bind the UPDATE to the exact token + status + non-expired window
    // so a concurrent resend/cancel/accept invalidates this attempt. Returns the row
    // we successfully activated and joins state for the response payload.
    const claimed = await pool.query(
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
      [hash, token],
    );
    const row = claimed.rows[0];
    if (!row) {
      // Token was rotated/cancelled/accepted between our SELECT and UPDATE.
      res.status(410).json({ error: "invite_invalid_or_used" });
      return;
    }
    // Mark email verified — accepting the invite proves email ownership.
    await pool.query(
      `UPDATE users SET email_verified = TRUE, email_verified_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [row.id],
    );
    const { token: sessionToken } = await createSession(row.id, false);
    setSessionCookie(res, sessionToken, false);
    await logAudit({ userId: row.id, action: "invite_accept", module: "auth", entityId: row.id });

    const user: CurrentUser = {
      id: row.id, name: row.name, email: row.email,
      role: row.role, roleLabel: row.role_label, scope: row.scope,
      stateId: row.state_id, stateName: row.state_name,
      sector: row.sector, avatarUrl: row.avatar_url ?? null,
      sectors: row.role === "technical_coordinator" && row.sector
        ? String(row.sector).split(",").map((s) => s.trim()).filter(Boolean)
        : null,
    };
    res.json({ user, permissions: permissionsFor(user) });
  } catch (err) { next(err); }
});

// FORGOT PASSWORD -----------------------------------------------------------
// Public. Rate-limited (3/15 min per IP). Always returns the same neutral message
// regardless of whether the email exists, to prevent user enumeration.
router.post("/auth/forgot-password", async (req, res, next) => {
  try {
    const ip = String(req.ip ?? req.socket?.remoteAddress ?? "unknown");
    if (isRateLimited(ip)) {
      res.status(429).json({ error: "too_many_requests" });
      return;
    }

    const email = String(req.body?.email ?? "").trim().toLowerCase();
    if (!email) { res.status(400).json({ error: "email_required" }); return; }

    // Neutral response regardless of whether the email exists.
    const neutral = { ok: true, message: "If the email is registered, a password reset link has been sent." };

    const { rows } = await pool.query(
      `SELECT id, name, email FROM users WHERE LOWER(email) = $1 AND status = 'active' LIMIT 1`,
      [email],
    );
    if (rows.length === 0) { res.json(neutral); return; }
    const user = rows[0];

    // Revoke any existing active tokens for this user.
    await pool.query(
      `UPDATE password_reset_tokens SET status = 'revoked', revoked_at = NOW()
       WHERE user_id = $1 AND status = 'active'`,
      [user.id],
    );

    const plainToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashToken(plainToken);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    const tokenInsert = await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, ip_address, user_agent, source)
       VALUES ($1, $2, $3, $4, $5, 'forgot_password')
       RETURNING id`,
      [user.id, tokenHash, expiresAt.toISOString(), ip, req.headers["user-agent"] ?? null],
    );
    const tokenId = tokenInsert.rows[0]?.id;

    const resetLink = `${publicAppUrl()}/reset-password?token=${encodeURIComponent(plainToken)}`;

    const { html, text, subject } = renderPasswordResetEmail({ name: user.name, email: user.email, token: plainToken, expiresAt });
    const { delivered } = await sendEmail({ to: user.email, subject, html, text, kind: "password_reset", userId: user.id, meta: { resetLink } });
    if (delivered && tokenId) {
      await pool.query(`UPDATE password_reset_tokens SET email_status = 'sent' WHERE id = $1`, [tokenId]);
    }

    await logAudit({ userId: user.id, action: "forgot_password_request", module: "auth", entityId: user.id });

    // In dev mode (mailer stubbed), surface the link directly so testers can use it.
    res.json({ ...neutral, ...(delivered ? {} : { devResetLink: resetLink }) });
  } catch (err) { next(err); }
});

// VALIDATE RESET TOKEN -------------------------------------------------------
// Public. Used by the reset-password page to check token validity before rendering the form.
router.get("/auth/reset-password/validate", async (req, res, next) => {
  try {
    const plain = String(req.query.token ?? "");
    if (!plain) { res.status(400).json({ error: "token_required" }); return; }
    const tHash = hashToken(plain);
    const { rows } = await pool.query(
      `SELECT prt.id, prt.status, prt.expires_at AS "expiresAt", u.email, u.name
       FROM password_reset_tokens prt
       JOIN users u ON u.id = prt.user_id
       WHERE prt.token_hash = $1`,
      [tHash],
    );
    const row = rows[0];
    if (!row) { res.status(410).json({ error: "token_invalid" }); return; }
    if (row.status === "used") { res.status(410).json({ error: "token_used" }); return; }
    if (row.status === "revoked") { res.status(410).json({ error: "token_revoked" }); return; }
    if (new Date(row.expiresAt).getTime() < Date.now()) {
      await pool.query(`UPDATE password_reset_tokens SET status = 'expired' WHERE id = $1`, [row.id]);
      res.status(410).json({ error: "token_expired" }); return;
    }
    res.json({ ok: true, email: row.email, name: row.name });
  } catch (err) { next(err); }
});

// RESET PASSWORD ------------------------------------------------------------
// Public. Validates token, sets new password, marks token used, notifies user.
router.post("/auth/reset-password", async (req, res, next) => {
  try {
    const plain = String(req.body?.token ?? "");
    const newPassword = String(req.body?.password ?? "");
    if (!plain) { res.status(400).json({ error: "token_required" }); return; }

    const pw = validatePassword(newPassword);
    if (!pw.ok) { res.status(400).json({ error: pw.error }); return; }

    const tHash = hashToken(plain);
    const { rows } = await pool.query(
      `SELECT prt.id, prt.status, prt.expires_at AS "expiresAt", prt.user_id AS "userId", u.email, u.name
       FROM password_reset_tokens prt
       JOIN users u ON u.id = prt.user_id
       WHERE prt.token_hash = $1`,
      [tHash],
    );
    const row = rows[0];
    if (!row) { res.status(410).json({ error: "token_invalid" }); return; }
    if (row.status === "used") { res.status(410).json({ error: "token_used" }); return; }
    if (row.status === "revoked") { res.status(410).json({ error: "token_revoked" }); return; }
    if (new Date(row.expiresAt).getTime() < Date.now()) {
      await pool.query(`UPDATE password_reset_tokens SET status = 'expired' WHERE id = $1`, [row.id]);
      res.status(410).json({ error: "token_expired" }); return;
    }

    const hash = await bcrypt.hash(newPassword, 12);

    // Atomic: update password + mark token used in one transaction.
    await pool.query("BEGIN");
    try {
      await pool.query(`UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [hash, row.userId]);
      await pool.query(
        `UPDATE password_reset_tokens SET status = 'used', used_at = NOW() WHERE id = $1`,
        [row.id],
      );
      await pool.query("COMMIT");
    } catch (txErr) {
      await pool.query("ROLLBACK");
      throw txErr;
    }

    // Post-reset notification uses the shared delivery/realtime/recipient
    // contract. The specialised confirmation email below remains authoritative.
    await createNotificationDeduped({
      userId: row.userId,
      kind: "password_changed",
      entityType: "user",
      entityId: row.userId,
      message: "Your password was successfully changed. If this was not you, contact your administrator.",
      link: "/users",
      dedupeKey: `password-changed:${row.id}`,
      mandatory: true,
      suppressEmail: true,
    });

    const { html, text, subject } = renderPasswordResetConfirmEmail({ name: row.name, email: row.email });
    await sendEmail({ to: row.email, subject, html, text, kind: "password_reset_confirm" });

    await logAudit({ userId: row.userId, action: "password_reset", module: "auth", entityId: row.userId });

    res.json({ ok: true });
  } catch (err) { next(err); }
});

// SEND VERIFICATION EMAIL ---------------------------------------------------
// Public. Rate-limited (5/hour per IP). Sends or resends a verification email.
const verifyRateLimit = makeRateLimiter(5, 60 * 60 * 1000);

router.post("/auth/send-verification-email", async (req, res, next) => {
  try {
    const ip = String(req.ip ?? req.socket?.remoteAddress ?? "unknown");
    if (verifyRateLimit(ip)) { res.status(429).json({ error: "too_many_requests" }); return; }

    const email = String(req.body?.email ?? "").trim().toLowerCase();
    if (!email) { res.status(400).json({ error: "email_required" }); return; }

    const neutral = { ok: true, message: "If that email is registered, a verification link has been sent." };

    const { rows } = await pool.query(
      `SELECT id, name, email, email_verified AS "emailVerified" FROM users WHERE LOWER(email) = $1 AND status NOT IN ('deactivated') LIMIT 1`,
      [email],
    );
    if (rows.length === 0) { res.json(neutral); return; }
    const user = rows[0];
    if (user.emailVerified) { res.json({ ok: true, alreadyVerified: true }); return; }

    // Invalidate existing active tokens for this user.
    await pool.query(
      `UPDATE email_verification_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL`,
      [user.id],
    );

    const plainToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(plainToken).digest("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await pool.query(
      `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at, ip_address) VALUES ($1, $2, $3, $4)`,
      [user.id, tokenHash, expiresAt.toISOString(), ip],
    );

    const { html, text, subject } = renderVerifyEmail({
      name: user.name, email: user.email, token: plainToken, expiresAt,
    });
    const { delivered } = await sendEmail({ to: user.email, subject, html, text, kind: "email_verification", userId: user.id });
    await logAudit({ userId: user.id, action: "verification_email_sent", module: "auth", entityId: user.id });

    res.json({ ...neutral, ...(delivered ? {} : { devVerifyLink: `${publicAppUrl()}/verify-email?token=${encodeURIComponent(plainToken)}` }) });
  } catch (err) { next(err); }
});

// VERIFY EMAIL --------------------------------------------------------------
// Public. Validates token, marks email_verified=true.
router.get("/auth/verify-email", async (req, res, next) => {
  try {
    const plain = String(req.query.token ?? "");
    if (!plain) { res.status(400).json({ error: "token_required" }); return; }
    const tokenHash = crypto.createHash("sha256").update(plain).digest("hex");

    const { rows } = await pool.query(
      `SELECT evt.id, evt.user_id AS "userId", evt.used_at AS "usedAt", evt.expires_at AS "expiresAt",
              u.email, u.email_verified AS "emailVerified"
       FROM email_verification_tokens evt
       JOIN users u ON u.id = evt.user_id
       WHERE evt.token_hash = $1`,
      [tokenHash],
    );
    const row = rows[0];
    if (!row) { res.status(410).json({ error: "token_invalid" }); return; }
    if (row.usedAt) { res.status(410).json({ error: "token_used" }); return; }
    if (new Date(row.expiresAt).getTime() < Date.now()) {
      res.status(410).json({ error: "token_expired" }); return;
    }
    if (row.emailVerified) {
      await pool.query(`UPDATE email_verification_tokens SET used_at = NOW() WHERE id = $1`, [row.id]);
      res.json({ ok: true, alreadyVerified: true }); return;
    }

    await pool.query("BEGIN");
    try {
      await pool.query(
        `UPDATE users SET email_verified = TRUE, email_verified_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [row.userId],
      );
      await pool.query(`UPDATE email_verification_tokens SET used_at = NOW() WHERE id = $1`, [row.id]);
      await pool.query("COMMIT");
    } catch (txErr) {
      await pool.query("ROLLBACK");
      throw txErr;
    }

    await logAudit({ userId: row.userId, action: "email_verified", module: "auth", entityId: row.userId });
    await createNotificationDeduped({
      userId: row.userId,
      kind: "email_verified",
      entityType: "user",
      entityId: row.userId,
      message: "Your email address has been verified.",
      link: "/profile",
      dedupeKey: `email-verified:${row.id}`,
      // Verification is an account-security confirmation; preserve the former
      // always-visible in-app acknowledgement without generating a second email.
      mandatory: true,
      suppressEmail: true,
    });

    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post("/auth/logout", async (req, res, next) => {
  try {
    // Use the session identity, not the demo-mode effective identity. This
    // ensures logout revokes the actual cookie holder's session exactly once.
    const session = req.authSession;
    if (session) {
      await revokeSession(session.id);
      realtime.disconnectSession(session.id);
      await logAudit({ userId: session.userId, action: "logout", module: "auth", entityId: session.userId });
    }
    clearSessionCookie(res);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
