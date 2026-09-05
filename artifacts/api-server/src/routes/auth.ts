import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { pool } from "@workspace/db";
import {
  clearSessionCookie,
  createSession,
  revokeAllSessionsForUser,
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
import { logger } from "../lib/logger";
import { isProductionEnv } from "../lib/env";
import {
  isRateLimited as isRateLimitedShared,
  isAccountLocked,
  recordFailedLogin,
  clearAccountFailures,
} from "../lib/rate-limit-store";

// 3 password reset requests per 15 min per IP
const RESET_RATE_MAX = 3;
const RESET_RATE_WINDOW_MS = 15 * 60 * 1000;
function isRateLimited(ip: string): Promise<boolean> {
  return isRateLimitedShared("password_reset_request", ip, RESET_RATE_MAX, RESET_RATE_WINDOW_MS);
}

function hashToken(plain: string): string {
  return crypto.createHash("sha256").update(plain).digest("hex");
}

// Precomputed once at startup and reused for every failed lookup, so a
// non-existent identifier takes the same time to reject as a wrong password
// on a real account. Without this, a fast DB miss (no row found) versus a
// ~50-100ms bcrypt comparison (row found, password wrong) lets an attacker
// distinguish "valid account" from "no such account" purely from response
// timing, even though the error message itself is already identical either way.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync("no-such-account-constant-time-placeholder", 12);

// Account-level lockout: N consecutive failed attempts against the SAME
// identifier locks it out for a cooldown period, independent of the caller's
// source IP. The existing authLimiter in app.ts is IP-keyed only, so a
// distributed attacker (rotating IPs / residential proxies) could otherwise
// brute-force one high-value account indefinitely since the IP-based limiter
// never trips for them. isAccountLocked/recordFailedLogin/clearAccountFailures
// are backed by the shared rate_limit_events table (lib/rate-limit-store.ts)
// so the lockout is enforced consistently regardless of which ECS task a
// given request lands on.

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

    const normalizedIdentifier = identifier.toLowerCase();
    if (await isAccountLocked(normalizedIdentifier)) {
      res.status(429).json({ error: "too_many_requests" });
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
      // Always run a real bcrypt comparison — see DUMMY_PASSWORD_HASH above.
      await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
      await recordFailedLogin(normalizedIdentifier);
      res.status(401).json({ error: "invalid_credentials" });
      return;
    }

    const ok = await bcrypt.compare(password, row.password_hash);
    if (!ok) {
      await recordFailedLogin(normalizedIdentifier);
      res.status(401).json({ error: "invalid_credentials" });
      return;
    }
    await clearAccountFailures(normalizedIdentifier);

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
    if (await isRateLimited(ip)) {
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

    // Never expose the raw reset link in production, regardless of *why*
    // delivery failed (stub mode, missing key, provider outage, bad
    // sender domain...) — this endpoint is public and unauthenticated, so
    // leaking a working reset link here is an account-takeover primitive,
    // not a debugging convenience. Non-production keeps the old
    // surface-the-link-for-testers behavior.
    if (!delivered) {
      if (isProductionEnv()) {
        logger.warn({ userId: user.id, kind: "password_reset" }, "[auth] password reset email failed to send — link withheld from API response");
      } else {
        res.json({ ...neutral, devResetLink: resetLink });
        return;
      }
    }
    res.json(neutral);
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

    // A password reset means any session established before it — a stolen
    // cookie, an unattended device — must not outlive the old credential.
    await revokeAllSessionsForUser(row.userId);
    realtime.disconnectUser(row.userId);

    // Post-reset notification uses the shared delivery/realtime/recipient
    // contract. The specialised confirmation email below remains authoritative.
    await createNotificationDeduped({
      userId: row.userId,
      kind: "password_changed",
      entityType: "user",
      entityId: row.userId,
      message: "Your password was successfully changed. If this was not you, contact your administrator.",
      link: "/profile",
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
const VERIFY_RATE_MAX = 5;
const VERIFY_RATE_WINDOW_MS = 60 * 60 * 1000;

router.post("/auth/send-verification-email", async (req, res, next) => {
  try {
    const ip = String(req.ip ?? req.socket?.remoteAddress ?? "unknown");
    if (await isRateLimitedShared("verify_email_send", ip, VERIFY_RATE_MAX, VERIFY_RATE_WINDOW_MS)) {
      res.status(429).json({ error: "too_many_requests" });
      return;
    }

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

    // Same rationale as /auth/forgot-password above: this endpoint is
    // public and unauthenticated, so a working verification link must
    // never leak into the API response in production.
    if (!delivered) {
      if (isProductionEnv()) {
        logger.warn({ userId: user.id, kind: "email_verification" }, "[auth] verification email failed to send — link withheld from API response");
      } else {
        res.json({ ...neutral, devVerifyLink: `${publicAppUrl()}/verify-email?token=${encodeURIComponent(plainToken)}` });
        return;
      }
    }
    res.json(neutral);
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
