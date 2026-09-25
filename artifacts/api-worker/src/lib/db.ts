import { Pool } from "pg";
import type { Context } from "hono";

export interface Bindings {
  HYPERDRIVE: Hyperdrive;
  SESSION_SECRET: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_ENDPOINT_URL: string;
  R2_BUCKET: string;
  EMAIL_ENABLED?: string;
  EMAIL_PROVIDER?: string;
  EMAIL_API_KEY?: string;
  EMAIL_FROM_ADDRESS?: string;
  EMAIL_FROM_NAME?: string;
  EMAIL_REPLY_TO?: string;
  PUBLIC_APP_URL?: string;
  AI_ENABLED?: string;
  AI_DAILY_MESSAGE_LIMIT?: string;
  AI_INTEGRATIONS_OPENAI_API_KEY?: string;
  AI_INTEGRATIONS_OPENAI_BASE_URL?: string;
}

export type AppContext = Context<{ Bindings: Bindings }>;

export interface QueryExecutor {
  query<T extends Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}

/**
 * One Pool per request, closed after the response is sent. Hyperdrive does
 * the real connection pooling/caching at the edge — a fresh, small local
 * Pool per request is Cloudflare's documented pattern for node-postgres, not
 * wasteful the way it would be against a directly-dialled database.
 */
export function openDb(c: AppContext): { db: QueryExecutor; close: () => void } {
  const pool = new Pool({ connectionString: c.env.HYPERDRIVE.connectionString, max: 5 });
  return {
    db: pool,
    close: () => c.executionCtx.waitUntil(pool.end()),
  };
}
