import { Pool } from "pg";
import type { Bindings } from "./lib/db";
import { checkAllDueDates } from "./lib/due-date-checker";
import { evaluateMonthlyReportingDeadlines } from "./lib/monthly-reporting-deadline";

/**
 * Cron Triggers entry point — the Cloudflare-native replacement for the
 * source's setInterval-based schedulers (lib/due-date-checker.ts's
 * startDueDateChecker, lib/monthly-reporting-deadline.ts's own poll loop),
 * which have no equivalent in a stateless Workers isolate. Both cron
 * patterns below are registered in wrangler.toml's [env.production.triggers]
 * only — this never runs against the ongoing test/dev environment.
 *
 * openDb() (lib/db.ts) can't be reused here — it's built on a Hono Context
 * for c.env/c.executionCtx.waitUntil, and a scheduled() invocation has
 * neither; the same two-line Pool-per-invocation pattern is inlined
 * directly against ctx.waitUntil instead.
 */
export async function scheduled(event: ScheduledController, env: Bindings, ctx: ExecutionContext): Promise<void> {
  const pool = new Pool({ connectionString: env.HYPERDRIVE.connectionString, max: 5 });
  try {
    if (event.cron === "0 */6 * * *") {
      await checkAllDueDates(pool, env);
    } else if (event.cron === "*/15 * * * *") {
      await evaluateMonthlyReportingDeadlines(pool, pool, env);
    } else {
      console.warn("[scheduled] unrecognised cron pattern", event.cron);
    }
  } finally {
    ctx.waitUntil(pool.end());
  }
}
