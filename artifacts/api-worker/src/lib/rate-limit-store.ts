import type { QueryExecutor } from "./db";

/**
 * Ported from artifacts/api-server/src/lib/rate-limit-store.ts — the
 * account-lockout subset only (the express-rate-limit Store class stays
 * behind; Hono needs its own general-purpose limiter middleware later, a
 * separate concern from session/auth). Same shared rate_limit_events table,
 * unchanged: this was already framework-agnostic raw SQL.
 */

async function recordEvent(db: QueryExecutor, bucket: string, key: string): Promise<void> {
  await db.query(`INSERT INTO rate_limit_events (bucket, key) VALUES ($1, $2)`, [bucket, key]);
}

const ACCOUNT_LOCKOUT_BUCKET = "account_lockout";
export const ACCOUNT_LOCKOUT_THRESHOLD = 10;
export const ACCOUNT_LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
export const ACCOUNT_LOCKOUT_DURATION_MS = 15 * 60 * 1000;

export async function isAccountLocked(db: QueryExecutor, identifier: string): Promise<boolean> {
  const { rows } = await db.query<{ occurred_at: string }>(
    `SELECT occurred_at FROM rate_limit_events
     WHERE bucket = $1 AND key = $2
     ORDER BY occurred_at DESC
     LIMIT $3`,
    [ACCOUNT_LOCKOUT_BUCKET, identifier, ACCOUNT_LOCKOUT_THRESHOLD],
  );
  if (rows.length < ACCOUNT_LOCKOUT_THRESHOLD) return false;

  const newest = new Date(rows[0].occurred_at).getTime();
  const oldest = new Date(rows[rows.length - 1].occurred_at).getTime();
  if (newest - oldest > ACCOUNT_LOCKOUT_WINDOW_MS) return false;

  return Date.now() < newest + ACCOUNT_LOCKOUT_DURATION_MS;
}

export async function recordFailedLogin(db: QueryExecutor, identifier: string): Promise<void> {
  await recordEvent(db, ACCOUNT_LOCKOUT_BUCKET, identifier);
}

export async function clearAccountFailures(db: QueryExecutor, identifier: string): Promise<void> {
  await db.query(`DELETE FROM rate_limit_events WHERE bucket = $1 AND key = $2`, [
    ACCOUNT_LOCKOUT_BUCKET,
    identifier,
  ]);
}

/**
 * Ported from routes/profile.ts's express-rate-limit-backed password-change
 * limiter (5 requests / 15 min, keyed by user id — this route requires an
 * existing session, so it's a per-account request-rate limit, not a
 * failed-attempt lockout like the login one above). express-rate-limit's
 * `skip: () => !isProductionEnv()` (disabled outside production) has no
 * Workers equivalent kept here — this is a security control, not a dev
 * convenience worth reintroducing, so it now applies in every environment.
 */
const PASSWORD_CHANGE_BUCKET = "profile_password_change";
export const PASSWORD_CHANGE_LIMIT = 5;
export const PASSWORD_CHANGE_WINDOW_MS = 15 * 60 * 1000;

export async function isPasswordChangeRateLimited(db: QueryExecutor, userId: number): Promise<boolean> {
  const { rows } = await db.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM rate_limit_events
      WHERE bucket = $1 AND key = $2 AND occurred_at > NOW() - INTERVAL '15 minutes'`,
    [PASSWORD_CHANGE_BUCKET, String(userId)],
  );
  return Number(rows[0]?.count ?? 0) >= PASSWORD_CHANGE_LIMIT;
}

export async function recordPasswordChangeAttempt(db: QueryExecutor, userId: number): Promise<void> {
  await recordEvent(db, PASSWORD_CHANGE_BUCKET, String(userId));
}
