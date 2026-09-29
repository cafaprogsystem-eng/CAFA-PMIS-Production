import { Hono } from "hono";
import type { Bindings } from "../lib/db";
import type { Variables } from "../lib/rbac";

/**
 * Ported from artifacts/api-server/src/routes/health.ts. /readyz is dropped,
 * not ported broken: it gated on lib/runtime-readiness.ts's in-memory
 * `markRuntimeReady()` boot flag, a long-running-ECS-process concept with no
 * Workers equivalent (a stateless per-request isolate has no boot phase to
 * gate on — porting it literally would mean the flag is never set and the
 * route would 503 forever).
 */
export const healthRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

healthRoutes.get("/healthz", (c) => {
  c.header("Cache-Control", "no-store, no-cache, must-revalidate");
  c.header("Pragma", "no-cache");
  return c.json({ status: "ok" });
});
