import crypto from "node:crypto";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { QueryExecutor, AppContext } from "./db";

/**
 * Ported from artifacts/api-server/src/lib/session.ts. The DB-backed session
 * model and every node:crypto call carry over unchanged under Workers'
 * nodejs_compat — only the cookie read/write and the Express Request/Response
 * types change, since Hono has its own cookie helpers and this Worker has no
 * Express `signedCookies` middleware to lean on.
 */

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

export async function createSession(
  db: QueryExecutor,
  userId: number,
  remember = false,
): Promise<{ session: AuthenticatedSession; token: string }> {
  // @cloudflare/workers-types' Uint8Array globals shadow @types/node's richer
  // Buffer typing for randomBytes()'s return value (runtime behavior is a real
  // Buffer either way, under nodejs_compat) — Buffer.from(...) re-wraps it in
  // a type that still has toString(encoding).
  const token = Buffer.from(crypto.randomBytes(32)).toString("base64url");
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + (remember ? REMEMBER_MAX_AGE_MS : DEFAULT_MAX_AGE_MS));

  await db.query(
    `INSERT INTO auth_sessions (id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [id, userId, hashSessionToken(token), expiresAt.toISOString()],
  );

  return { session: { id, userId, expiresAt }, token };
}

export async function getActiveSessionFromToken(
  db: QueryExecutor,
  token: string,
): Promise<AuthenticatedSession | null> {
  if (!token || isLegacyUserIdCookie(token)) return null;
  const result = await db.query<{
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

export async function getActiveSessionById(
  db: QueryExecutor,
  sessionId: string,
): Promise<AuthenticatedSession | null> {
  if (!sessionId) return null;
  const result = await db.query<{
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

/** Mirrors cookie-signature's format exactly: `s:<value>.<hmac-sha256(base64, no padding)>`. */
export function signCookieValue(value: string, secret: string): string {
  const signature = crypto
    .createHmac("sha256", secret)
    .update(value)
    .digest("base64")
    .replace(/=+$/, "");
  return `s:${value}.${signature}`;
}

/** Ported verbatim — plain node:crypto, no Express dependency in the original either. */
export function unsignCookieValue(value: string, secret: string): string | false {
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

export async function revokeSession(db: QueryExecutor, sessionId: string): Promise<boolean> {
  const result = await db.query(
    `UPDATE auth_sessions
        SET revoked_at = NOW()
      WHERE id = $1 AND revoked_at IS NULL
      RETURNING id`,
    [sessionId],
  );
  return result.rows.length > 0;
}

export async function revokeAllSessionsForUser(
  db: QueryExecutor,
  userId: number,
  exceptSessionId?: string,
): Promise<number> {
  const result = await db.query(
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

/** Read + verify the session cookie for the current request, if any. */
export async function getActiveSession(
  c: AppContext,
  db: QueryExecutor,
): Promise<AuthenticatedSession | null> {
  const signed = getCookie(c, COOKIE_NAME);
  if (!signed) return null;
  const token = unsignCookieValue(signed, c.env.SESSION_SECRET);
  if (token === false || isLegacyUserIdCookie(token)) return null;
  return getActiveSessionFromToken(db, token);
}

export function setSessionCookie(c: AppContext, token: string, remember = false): void {
  const signed = signCookieValue(token, c.env.SESSION_SECRET);
  setCookie(c, COOKIE_NAME, signed, {
    httpOnly: true,
    sameSite: "Lax",
    secure: true,
    maxAge: Math.floor((remember ? REMEMBER_MAX_AGE_MS : DEFAULT_MAX_AGE_MS) / 1000),
    path: "/",
  });
}

export function clearSessionCookie(c: AppContext): void {
  // Bug fix (found live during pre-launch certification): must match every
  // attribute setSessionCookie set (httpOnly/sameSite/secure), not just
  // path — the session is still fully revoked server-side either way, but
  // a mismatched clearing Set-Cookie is a real regression from the
  // source's behavior, not something to leave as-is.
  deleteCookie(c, COOKIE_NAME, { path: "/", httpOnly: true, sameSite: "Lax", secure: true });
}
