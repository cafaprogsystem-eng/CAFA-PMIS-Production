import { createHash } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { pool } from "@workspace/db";

const COMPLETED_TTL_MS = 24 * 60 * 60 * 1000;
// A claim with an unknown outcome must never expire into a fresh execution.
// If a process dies after a mutation commits but before its response recorder
// runs, retaining the claim is the only generic safe choice.
const IN_PROGRESS_EXPIRY = new Date("9999-12-31T23:59:59.999Z");
const IDEMPOTENT_METHODS = new Set(["POST", "PUT", "PATCH"]);

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

function requestHash(req: Request): string {
  return createHash("sha256")
    .update(`${req.method}\n${req.path}\n${stableJson(req.body ?? null)}`)
    .digest("hex");
}

let scheduledPrune: ReturnType<typeof setInterval> | null = null;
let activePrune: Promise<void> | null = null;

export async function pruneExpiredIdempotencyClaims(): Promise<void> {
  if (activePrune) return activePrune;
  activePrune = (async () => {
  try {
    await pool.query("DELETE FROM idempotency_log WHERE state = 'completed' AND expires_at < NOW()");
  } catch {
    // A failed cleanup must not change request handling.
  } finally {
    activePrune = null;
  }
  })();
  return activePrune;
}

export function startIdempotencyPruner(): void {
  if (scheduledPrune) return;
  void pruneExpiredIdempotencyClaims();
  scheduledPrune = setInterval(() => void pruneExpiredIdempotencyClaims(), 60 * 60 * 1000);
}

export async function stopIdempotencyPruner(): Promise<void> {
  if (scheduledPrune) clearInterval(scheduledPrune);
  scheduledPrune = null;
  await activePrune;
}

/**
 * Atomically claims an offline operation before its handler runs. A duplicate
 * can only replay a completed response; it can never enter a handler while
 * another request with the same operation is running.
 */
export async function idempotencyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const clientId = req.header("x-client-id");
  if (!clientId || clientId.length > 128 || !IDEMPOTENT_METHODS.has(req.method)) {
    next();
    return;
  }
  const actorId = req.currentUser?.id;
  if (!actorId) {
    next();
    return;
  }

  const operation = `${req.method} ${req.path}`;
  const hash = requestHash(req);
  try {
    const claim = await pool.query(
      `INSERT INTO idempotency_log
         (client_id, actor_id, operation, request_hash, state, expires_at)
       VALUES ($1, $2, $3, $4, 'in_progress', $5)
       ON CONFLICT (client_id) DO NOTHING
       RETURNING id`,
       [clientId, actorId, operation, hash, IN_PROGRESS_EXPIRY],
    );
    if (claim.rows.length > 0) {
      attachCompletionRecorder(req, res, clientId, actorId, hash);
      next();
      return;
    }

    const existing = await pool.query<{
      actor_id: number | null;
      request_hash: string | null;
      state: string | null;
      status_code: number | null;
      response_body: string | null;
    }>(
      `SELECT actor_id, request_hash, state, status_code, response_body
         FROM idempotency_log
         WHERE client_id = $1
        LIMIT 1`,
      [clientId],
    );
    const row = existing.rows[0];
    if (!row || row.actor_id !== actorId || row.request_hash !== hash) {
      res.status(409).json({ error: "idempotency_key_reused" });
      return;
    }
    if (row.state === "completed" && row.status_code) {
      res.status(row.status_code).type("json").send(row.response_body ?? "{}");
      return;
    }
    res.setHeader("Retry-After", "1");
    res.status(425).json({ error: "idempotency_in_progress" });
  } catch (error) {
    next(error);
  }
}

function attachCompletionRecorder(
  req: Request,
  res: Response,
  clientId: string,
  actorId: number,
  hash: string,
): void {
  const originalJson = res.json.bind(res) as (body: unknown) => Response;
  const originalSend = res.send.bind(res) as (body?: unknown) => Response;
  let responseBody: string | null = null;
  res.send = (body?: unknown): Response => {
    if (responseBody === null && body !== undefined) {
      responseBody = typeof body === "string" ? body : JSON.stringify(body);
    }
    return originalSend(body);
  };
  res.json = (body: unknown): Response => {
    responseBody = JSON.stringify(body);
    return originalJson(body);
  };

  res.once("finish", () => {
    const completed = res.statusCode >= 200 && res.statusCode < 300;
    if (!completed) {
      void pool.query(
        `DELETE FROM idempotency_log
          WHERE client_id = $1 AND actor_id = $2 AND request_hash = $3 AND state = 'in_progress'`,
        [clientId, actorId, hash],
      );
      return;
    }
    void pool.query(
      `UPDATE idempotency_log
          SET state = 'completed',
              status_code = $4,
              response_body = $5,
              expires_at = $6
        WHERE client_id = $1 AND actor_id = $2 AND request_hash = $3 AND state = 'in_progress'`,
      [clientId, actorId, hash, res.statusCode, responseBody, new Date(Date.now() + COMPLETED_TTL_MS)],
    );
  });
}
