import { Hono } from "hono";
import type { Bindings } from "../lib/db";
import { openDb } from "../lib/db";
import { attachCurrentUser, requireAuth, type Variables } from "../lib/rbac";
import { normaliseNotificationLink, presentNotificationKind } from "../lib/notifications";

/**
 * Ported from artifacts/api-server/src/routes/notifications.ts — the first
 * real route file of the bulk CRUD-routes phase, proving the RBAC
 * foundation (lib/rbac.ts) end to end. Every authenticated role gets
 * notifications.view (see permissionsFor), so requireAuth alone gates
 * these — no requirePerm needed.
 *
 * realtime.publishSupportingEventToUser(...) calls from the original are
 * dropped, not stubbed: real-time push is deliberately the last migration
 * phase (Durable Objects). Marking a notification read still commits to
 * Postgres immediately; a client just won't see the badge update on
 * another open tab until its next poll/reconnect, the same graceful
 * degradation the current AWS app already relies on for a missed
 * broadcast.
 */

const NOTIFICATION_MODULES = new Set([
  "project", "report", "plan", "risk", "comment", "conversation",
  "user", "document", "activity", "system",
]);
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_OFFSET = 10_000;

function parseIntegerQuery(raw: string | undefined, fallback: number, min: number, max: number): number | null {
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
}

export const notificationsRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

notificationsRoutes.use("/notifications/*", attachCurrentUser, requireAuth);

notificationsRoutes.get("/notifications", async (c) => {
  const user = c.get("currentUser")!;
  const unreadParam = c.req.query("unreadOnly");
  if (unreadParam !== undefined && unreadParam !== "true" && unreadParam !== "false") {
    return c.json({ error: "invalid_query", detail: "unreadOnly must be true or false" }, 422);
  }
  const unreadOnly = unreadParam === "true";
  const moduleParam = c.req.query("module");
  if (moduleParam !== undefined && moduleParam !== "all" && !NOTIFICATION_MODULES.has(moduleParam)) {
    return c.json({ error: "invalid_query", detail: "module is not supported" }, 422);
  }
  const moduleFilter = moduleParam && moduleParam !== "all" ? moduleParam : null;
  const limit = parseIntegerQuery(c.req.query("limit"), DEFAULT_LIMIT, 1, MAX_LIMIT);
  const offset = parseIntegerQuery(c.req.query("offset"), 0, 0, MAX_OFFSET);
  if (limit === null || offset === null) {
    return c.json({
      error: "invalid_query",
      detail: `limit must be an integer from 1 to ${MAX_LIMIT}; offset must be an integer from 0 to ${MAX_OFFSET}`,
    }, 422);
  }

  const { db, close } = openDb(c);
  try {
    const conditions: string[] = ["user_id = $1"];
    const params: unknown[] = [user.id];
    if (unreadOnly) conditions.push("read_at IS NULL");
    if (moduleFilter) {
      params.push(moduleFilter);
      conditions.push(`entity_type = $${params.length}`);
    }

    const { rows } = await db.query<{
      id: number; kind: string; entityType: string; entityId: number;
      message: string; link: string | null; readAt: string | null; createdAt: string;
    }>(
      `SELECT id, kind, entity_type AS "entityType", entity_id AS "entityId",
              message, link, read_at AS "readAt", created_at AS "createdAt"
       FROM notifications
       WHERE ${conditions.join(" AND ")}
        ORDER BY created_at DESC, id DESC
        LIMIT $${params.push(limit + 1) && params.length}
        OFFSET $${params.push(offset) && params.length}`,
      params,
    );

    // Scoped to the same module filter as the list above (never unreadOnly,
    // which reflects the currently-selected tab, not the module scope).
    const unreadConditions = ["user_id = $1", "read_at IS NULL"];
    const unreadParams: unknown[] = [user.id];
    if (moduleFilter) {
      unreadParams.push(moduleFilter);
      unreadConditions.push(`entity_type = $${unreadParams.length}`);
    }
    const unread = await db.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM notifications WHERE ${unreadConditions.join(" AND ")}`,
      unreadParams,
    );

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((row) => ({
      ...row,
      kind: presentNotificationKind(row.kind),
      link: normaliseNotificationLink(row.link),
    }));
    return c.json({
      items,
      unread: unread.rows[0].n,
      pagination: {
        limit,
        offset,
        hasMore,
        nextOffset: hasMore ? offset + items.length : null,
      },
    });
  } finally {
    close();
  }
});

notificationsRoutes.patch("/notifications/:id/read", async (c) => {
  const user = c.get("currentUser")!;
  const id = Number(c.req.param("id"));
  if (!Number.isSafeInteger(id) || id <= 0) {
    return c.json({ error: "invalid_notification_id" }, 422);
  }
  const { db, close } = openDb(c);
  try {
    const r = await db.query<{ id: number }>(
      `UPDATE notifications SET read_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, user.id],
    );
    if (!r.rows[0]) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  } finally {
    close();
  }
});

notificationsRoutes.post("/notifications/read-all", async (c) => {
  const user = c.get("currentUser")!;
  const { db, close } = openDb(c);
  try {
    await db.query(
      `UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL RETURNING id`,
      [user.id],
    );
    return c.json({ ok: true });
  } finally {
    close();
  }
});
