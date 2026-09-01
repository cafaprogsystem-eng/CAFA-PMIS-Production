/**
 * Plan Registration Session
 *
 * Provides a short-lived, server-authoritative token that authorises incremental
 * PATCH calls on a newly-created Draft Plan by the user who created it.
 *
 * Security properties:
 *  – Token is a cryptographically-random 32-byte (64-char hex) opaque bearer value.
 *  – Only the SHA-256 hash is stored; the raw token is never persisted.
 *  – The session is bound to both plan_id AND user_id — cross-plan and cross-user
 *    use is impossible without a matching row in the DB.
 *  – The session is explicitly time-limited (REGISTRATION_SESSION_EXPIRY_HOURS).
 *  – Any of three events permanently revokes the session:
 *      1. Save & Finish   — closeRegistrationSession() called atomically in PATCH.
 *      2. Cancel/Close    — closeRegistrationSession() called from the close endpoint.
 *      3. Submit          — the transitions route inlines the same UPDATE via its own
 *                            transaction client (not this module's revokeRegistrationSessionsByPlan
 *                            helper, which only accepts the shared pool) so the revoke commits
 *                            atomically with the status transition.
 *  – creator + draft status + zero approvals is NOT a sufficient substitute.
 *  – A missing, expired, or closed session always yields a 403; the raw token is
 *    the only client-held proof that a session is active.
 */

import { randomBytes, createHash } from "crypto";
import { pool } from "@workspace/db";

/**
 * Minimal structural type for a transactional query client.
 * Satisfied by the PoolClient returned by pool.connect() — avoids
 * a direct `pg` import that is not available in this package.
 */
interface TransactionalClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query(text: string, values?: unknown[]): Promise<{ rows: any[] }>;
}

/** Registration sessions expire after this many hours. */
const REGISTRATION_SESSION_EXPIRY_HOURS = 2;

/**
 * Retained as a no-op for callers compiled against older releases. The table
 * and index are owned by tracked migration 001, never by route startup.
 */
export async function ensureRegistrationSessionTable(): Promise<void> {}

// ─── Session lifecycle ────────────────────────────────────────────────────────

/**
 * Creates a new registration session for the given plan and user.
 *
 * The caller MUST supply an active PoolClient that already has a transaction
 * open (BEGIN issued).  This function executes the INSERT using that client
 * and does NOT commit — the caller owns the transaction boundary.
 *
 * Keeping the INSERT inside the caller's transaction guarantees atomicity:
 * if session creation fails, the surrounding transaction is rolled back and
 * no orphan Plan row is left behind.
 *
 * Returns the raw (bearer) token that the client must present on every
 * subsequent PATCH request.  Only the SHA-256 hash is stored in the DB;
 * the raw token is returned once and never persisted server-side.
 */
export async function createRegistrationSession(
  client: TransactionalClient,
  planId: number,
  userId: number,
): Promise<string> {
  const rawToken  = randomBytes(32).toString("hex");
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
 * Validates a registration session token.
 *
 * Returns true only when ALL of the following hold (evaluated from the DB):
 *  – A row exists with the given token_hash, plan_id, and user_id.
 *  – expires_at is in the future.
 *  – closed_at is NULL (session has not been explicitly revoked).
 *
 * Returns false for any missing, expired, closed, plan-mismatched,
 * or user-mismatched token — no partial truths.
 */
export async function validateRegistrationSession(
  rawToken: string,
  planId: number,
  userId: number,
): Promise<boolean> {
  if (!rawToken) return false;
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const r = await pool.query(
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
 * Closes the registration session, permanently revoking it.
 *
 * When rawToken is supplied, only the specific session matching that token hash
 * is closed (used when the client presents its token on Save & Finish or Cancel).
 *
 * Idempotent: if the session is already closed or does not exist, this is a no-op.
 */
export async function closeRegistrationSession(
  planId: number,
  userId: number,
  rawToken?: string,
): Promise<void> {
  if (rawToken) {
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    await pool.query(
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
    await pool.query(
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
 * Revokes ALL active registration sessions for a plan.
 *
 * Called when the plan is submitted for approval (status leaves "draft").
 * At that point no creator-session editing is possible regardless of token.
 */
export async function revokeRegistrationSessionsByPlan(planId: number): Promise<void> {
  await pool.query(
    `UPDATE plan_registration_sessions
     SET closed_at = NOW()
     WHERE plan_id   = $1
       AND closed_at IS NULL`,
    [planId],
  );
}
