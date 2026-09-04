import { pool } from "@workspace/db";
import type { Store as ExpressRateLimitStore, Options as ExpressRateLimitOptions, IncrementResponse } from "express-rate-limit";

// ---------------------------------------------------------------------------
// Shared, cross-process rate-limit / account-lockout store.
//
// Every counter this file replaces used to be a plain in-memory Map (or
// express-rate-limit's default MemoryStore) — correct with exactly one
// running task, but silently weakened the moment a second task joins behind
// the load balancer: each task keeps its own independent counter, so a limit
// meant to trip at N requests effectively allows close to N *per task*
// before either one notices. That's most serious for the account-lockout
// guard below, which exists specifically to stop a brute-force attack
// regardless of how many tasks are running.
//
// Backed by a single shared table (rate_limit_events — migration 068)
// instead of a new service (e.g. ElastiCache/Redis): the volume here is a
// handful of auth-adjacent counters, not general high-frequency traffic, and
// every request already has a pool connection to this same database.
// ---------------------------------------------------------------------------

async function recordEvent(bucket: string, key: string): Promise<void> {
  await pool.query(`INSERT INTO rate_limit_events (bucket, key) VALUES ($1, $2)`, [bucket, key]);
}

async function countEvents(bucket: string, key: string, windowMs: number): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM rate_limit_events
     WHERE bucket = $1 AND key = $2 AND occurred_at > NOW() - ($3 || ' milliseconds')::interval`,
    [bucket, key, windowMs],
  );
  return Number(rows[0]?.count ?? 0);
}

// ---------------------------------------------------------------------------
// Manual sliding-window limiter — replaces the hand-rolled
// `Map<string, number[]>` pattern (password-reset request, verification
// email resend). Matches the original semantics exactly: a request that
// would be the (max+1)th within the window is rejected and NOT recorded;
// otherwise it's recorded and allowed.
// ---------------------------------------------------------------------------

export async function isRateLimited(bucket: string, key: string, max: number, windowMs: number): Promise<boolean> {
  const count = await countEvents(bucket, key, windowMs);
  if (count >= max) return true;
  await recordEvent(bucket, key);
  return false;
}

// ---------------------------------------------------------------------------
// Account-level lockout — N consecutive failed attempts against the SAME
// identifier locks it out for a cooldown period, independent of the
// caller's source IP (a distributed attacker rotating IPs/residential
// proxies would otherwise never trip an IP-based limiter).
//
// recordFailedLogin() is only ever called while NOT locked (the login
// handler checks isAccountLocked() first and short-circuits), so once a
// lockout triggers, no further failure rows are added until it clears —
// meaning the most recent THRESHOLD rows for an identifier are always
// exactly the ones that triggered its current (or most recent) lockout.
// isAccountLocked() reconstructs the original Map-based semantics (a fixed
// "locked until" timestamp set once, at the triggering failure) purely from
// that row history, with no separate lockout-state table needed.
// ---------------------------------------------------------------------------

const ACCOUNT_LOCKOUT_BUCKET = "account_lockout";
export const ACCOUNT_LOCKOUT_THRESHOLD = 10;
export const ACCOUNT_LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
export const ACCOUNT_LOCKOUT_DURATION_MS = 15 * 60 * 1000;

export async function isAccountLocked(identifier: string): Promise<boolean> {
  const { rows } = await pool.query<{ occurred_at: string }>(
    `SELECT occurred_at FROM rate_limit_events
     WHERE bucket = $1 AND key = $2
     ORDER BY occurred_at DESC
     LIMIT $3`,
    [ACCOUNT_LOCKOUT_BUCKET, identifier, ACCOUNT_LOCKOUT_THRESHOLD],
  );
  if (rows.length < ACCOUNT_LOCKOUT_THRESHOLD) return false;

  const newest = new Date(rows[0].occurred_at).getTime();
  const oldest = new Date(rows[rows.length - 1].occurred_at).getTime();
  // The threshold-th most recent failure only ever triggered a lock if it
  // fell within one lockout window of the (threshold)-th-oldest one, same
  // as the original sliding-window check performed at record time.
  if (newest - oldest > ACCOUNT_LOCKOUT_WINDOW_MS) return false;

  return Date.now() < newest + ACCOUNT_LOCKOUT_DURATION_MS;
}

export async function recordFailedLogin(identifier: string): Promise<void> {
  await recordEvent(ACCOUNT_LOCKOUT_BUCKET, identifier);
}

export async function clearAccountFailures(identifier: string): Promise<void> {
  await pool.query(`DELETE FROM rate_limit_events WHERE bucket = $1 AND key = $2`, [ACCOUNT_LOCKOUT_BUCKET, identifier]);
}

// ---------------------------------------------------------------------------
// express-rate-limit Store — same shared table, one instance per limiter
// (app.ts), each with its own bucket name so limiters never share counters.
// ---------------------------------------------------------------------------

export class PgRateLimitStore implements ExpressRateLimitStore {
  private readonly bucket: string;
  private windowMs = 0;

  constructor(bucket: string) {
    this.bucket = bucket;
  }

  init(options: ExpressRateLimitOptions): void {
    this.windowMs = options.windowMs;
  }

  async increment(key: string): Promise<IncrementResponse> {
    await recordEvent(this.bucket, key);
    const totalHits = await countEvents(this.bucket, key, this.windowMs);
    return { totalHits, resetTime: new Date(Date.now() + this.windowMs) };
  }

  async decrement(key: string): Promise<void> {
    // Undoes one increment (used only when skipSuccessfulRequests/
    // skipFailedRequests is configured — neither limiter sets those today,
    // but implemented for correctness): remove this key's single most
    // recent event row.
    await pool.query(
      `DELETE FROM rate_limit_events WHERE id = (
         SELECT id FROM rate_limit_events WHERE bucket = $1 AND key = $2 ORDER BY occurred_at DESC LIMIT 1
       )`,
      [this.bucket, key],
    );
  }

  async resetKey(key: string): Promise<void> {
    await pool.query(`DELETE FROM rate_limit_events WHERE bucket = $1 AND key = $2`, [this.bucket, key]);
  }
}

// ---------------------------------------------------------------------------
// Periodic cleanup — mirrors middlewares/idempotency.ts's pruner pattern.
// Rows older than every bucket's own window are pure noise; a generous
// fixed retention (longest window in use, with headroom) keeps this one
// query simple instead of tracking each bucket's own window here too.
// ---------------------------------------------------------------------------

const RATE_LIMIT_EVENT_RETENTION_MS = 24 * 60 * 60 * 1000;

let scheduledPrune: ReturnType<typeof setInterval> | null = null;
let activePrune: Promise<void> | null = null;

export async function pruneExpiredRateLimitEvents(): Promise<void> {
  if (activePrune) return activePrune;
  activePrune = (async () => {
    try {
      await pool.query(
        `DELETE FROM rate_limit_events WHERE occurred_at < NOW() - ($1 || ' milliseconds')::interval`,
        [RATE_LIMIT_EVENT_RETENTION_MS],
      );
    } catch {
      // A failed cleanup must not change request handling.
    } finally {
      activePrune = null;
    }
  })();
  return activePrune;
}

export function startRateLimitEventPruner(): void {
  if (scheduledPrune) return;
  void pruneExpiredRateLimitEvents();
  scheduledPrune = setInterval(() => void pruneExpiredRateLimitEvents(), 60 * 60 * 1000);
}

export async function stopRateLimitEventPruner(): Promise<void> {
  if (scheduledPrune) clearInterval(scheduledPrune);
  scheduledPrune = null;
  await activePrune;
}
