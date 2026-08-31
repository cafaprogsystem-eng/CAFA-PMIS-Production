import type { Request, Response } from "express";
import crypto from "node:crypto";
import { pool } from "@workspace/db";
import { isProductionEnv } from "./env";

const COOKIE_NAME = "cafa_sid";
const DEFAULT_MAX_AGE_MS = 8 * 60 * 60 * 1000; // 8 hours
const REMEMBER_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface AuthenticatedSession {
  id: string;
  userId: number;
  expiresAt: Date;
}

function hashSessionToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function isLegacyUserIdCookie(value: string): boolean {
  return /^\d+$/.test(value);
}

/** Create the one server-authoritative session used by HTTP and realtime. */
export async function createSession(
  userId: number,
  remember = false,
): Promise<{ session: AuthenticatedSession; token: string }> {
  const token = crypto.randomBytes(32).toString("base64url");
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + (remember ? REMEMBER_MAX_AGE_MS : DEFAULT_MAX_AGE_MS));

  await pool.query(
    `INSERT INTO auth_sessions (id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [id, userId, hashSessionToken(token), expiresAt.toISOString()],
  );

  return { session: { id, userId, expiresAt }, token };
}

/** Look up an active session by its opaque, unsigned token. */
export async function getActiveSessionFromToken(token: string): Promise<AuthenticatedSession | null> {
  if (!token || isLegacyUserIdCookie(token)) return null;
  const result = await pool.query<{
    id: string;
    user_id: number;
    expires_at: Date | string;
  }>(
    `SELECT id, user_id, expires_at
       FROM auth_sessions
      WHERE token_hash = $1
        AND revoked_at IS NULL
        AND expires_at > NOW()
      LIMIT 1`,
    [hashSessionToken(token)],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    expiresAt: row.expires_at instanceof Date ? row.expires_at : new Date(row.expires_at),
  };
}

/**
 * Re-check an already authenticated transport session by durable ID.
 *
 * Socket.IO stores only the opaque session ID after its initial handshake.
 * Looking it up again immediately before an operational delivery makes logout,
 * administrative revocation, and expiry authoritative without waiting for a
 * socket disconnect event.
 */
export async function getActiveSessionById(sessionId: string): Promise<AuthenticatedSession | null> {
  if (!sessionId) return null;
  const result = await pool.query<{
    id: string;
    user_id: number;
    expires_at: Date | string;
  }>(
    `SELECT id, user_id, expires_at
       FROM auth_sessions
      WHERE id = $1
        AND revoked_at IS NULL
        AND expires_at > NOW()
      LIMIT 1`,
    [sessionId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    expiresAt: row.expires_at instanceof Date ? row.expires_at : new Date(row.expires_at),
  };
}

/**
 * Express's cookie-parser has already verified the signature by the time this
 * helper runs. Numeric signed cookies are deliberately rejected: they are the
 * legacy user-ID format and must never regain access.
 */
export async function getActiveSession(req: Request): Promise<AuthenticatedSession | null> {
  const signed = req.signedCookies?.[COOKIE_NAME];
  if (typeof signed !== "string" || isLegacyUserIdCookie(signed)) return null;
  return getActiveSessionFromToken(signed);
}

/** Unsign a raw cookie value for Socket.IO, which does not use Express middleware. */
export function unsignSessionCookieValue(value: string, secret: string): string | false {
  if (!value.startsWith("s:")) return false;
  const encoded = value.slice(2);
  const dotIndex = encoded.lastIndexOf(".");
  if (dotIndex < 0) return false;
  const token = encoded.slice(0, dotIndex);
  const signature = encoded.slice(dotIndex + 1);
  const expected = crypto
    .createHmac("sha256", secret)
    .update(token)
    .digest("base64")
    .replace(/=+$/, "");
  const actual = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actual.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(actual, expectedBuffer) ? token : false;
}

/** Revoke only the targeted session. Repeated revocation is intentionally safe. */
export async function revokeSession(sessionId: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE auth_sessions
        SET revoked_at = NOW()
      WHERE id = $1 AND revoked_at IS NULL
      RETURNING id`,
    [sessionId],
  );
  return result.rows.length > 0;
}

/**
 * Revoke every active session belonging to a user — used whenever their
 * password changes, so a session established before the change (a stolen
 * cookie, an unattended device) cannot outlive the credential that was meant
 * to lock it out. Pass `exceptSessionId` to keep the caller's own session
 * alive for a self-service change; omit it (admin-triggered reset, forgot-
 * password) to sign the user out everywhere.
 */
export async function revokeAllSessionsForUser(
  userId: number,
  exceptSessionId?: string,
): Promise<number> {
  const result = await pool.query(
    `UPDATE auth_sessions
        SET revoked_at = NOW()
      WHERE user_id = $1
        AND revoked_at IS NULL
        AND id IS DISTINCT FROM $2
      RETURNING id`,
    [userId, exceptSessionId ?? null],
  );
  return result.rows.length;
}

export function setSessionCookie(res: Response, token: string, remember = false): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    signed: true,
    secure: isProductionEnv(),
    maxAge: remember ? REMEMBER_MAX_AGE_MS : DEFAULT_MAX_AGE_MS,
    path: "/",
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, {
    path: "/",
    httpOnly: true,
    signed: true,
    secure: isProductionEnv(),
    sameSite: "lax",
  });
}
