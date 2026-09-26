import { randomBytes, createHash } from "node:crypto";
import type { QueryExecutor } from "./db";

/**
 * Ported from artifacts/api-server/src/lib/plan-registration-session.ts.
 *
 * Plan Registration Session — a short-lived, server-authoritative token that
 * authorises incremental PATCH calls on a newly-created Draft Plan by the
 * user who created it. Only the SHA-256 hash is stored; the raw token is
 * returned once and never persisted server-side. Any of three events
 * permanently revokes the session: Save & Finish, Cancel/Close, or Submit.
 */

/** Registration sessions expire after this many hours. */
const REGISTRATION_SESSION_EXPIRY_HOURS = 2;

/**
 * Creates a new registration session for the given plan and user.
 *
 * The caller MUST supply an active transactional client that already has a
 * transaction open (BEGIN issued). This function executes the INSERT using
 * that client and does NOT commit — the caller owns the transaction boundary.
 *
 * Returns the raw (bearer) token that the client must present on every
 * subsequent PATCH request.
 */
export async function createRegistrationSession(
  client: QueryExecutor,
  planId: number,
  userId: number,
): Promise<string> {
  const rawToken = Buffer.from(randomBytes(32)).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + REGISTRATION_SESSION_EXPIRY_HOURS * 60 * 60 * 1000);

  await client.query(
    `INSERT INTO plan_registration_sessions (plan_id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [planId, userId, tokenHash, expiresAt],
  );

  return rawToken;
}

/**
 * Validates a registration session token. Returns true only when a row
 * exists with the given token_hash, plan_id, and user_id, expires_at is in
 * the future, and closed_at is NULL.
 */
export async function validateRegistrationSession(
  db: QueryExecutor,
  rawToken: string,
  planId: number,
  userId: number,
): Promise<boolean> {
  if (!rawToken) return false;
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const r = await db.query(
    `SELECT 1 FROM plan_registration_sessions
     WHERE token_hash  = $1
       AND plan_id     = $2
       AND user_id     = $3
       AND expires_at  > NOW()
       AND closed_at  IS NULL
     LIMIT 1`,
    [tokenHash, planId, userId],
  );
  return r.rows.length > 0;
}

/**
 * Closes the registration session, permanently revoking it. When rawToken is
 * supplied, only the specific session matching that token hash is closed.
 * Idempotent: if the session is already closed or does not exist, this is a
 * no-op.
 */
export async function closeRegistrationSession(
  db: QueryExecutor,
  planId: number,
  userId: number,
  rawToken?: string,
): Promise<void> {
  if (rawToken) {
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    await db.query(
      `UPDATE plan_registration_sessions
       SET closed_at = NOW()
       WHERE plan_id    = $1
         AND user_id    = $2
         AND token_hash = $3
         AND closed_at IS NULL`,
      [planId, userId, tokenHash],
    );
  } else {
    // Fallback: close all active sessions for this plan+user.
    await db.query(
      `UPDATE plan_registration_sessions
       SET closed_at = NOW()
       WHERE plan_id   = $1
         AND user_id   = $2
         AND closed_at IS NULL`,
      [planId, userId],
    );
  }
}

/**
 * Revokes ALL active registration sessions for a plan. Called when the plan
 * is submitted for approval (status leaves "draft").
 */
export async function revokeRegistrationSessionsByPlan(db: QueryExecutor, planId: number): Promise<void> {
  await db.query(
    `UPDATE plan_registration_sessions
     SET closed_at = NOW()
     WHERE plan_id   = $1
       AND closed_at IS NULL`,
    [planId],
  );
}
