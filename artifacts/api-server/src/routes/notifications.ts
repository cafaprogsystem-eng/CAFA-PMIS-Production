import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { normaliseNotificationLink, presentNotificationKind } from "../lib/notifications";
import { realtime } from "../lib/realtime";

const router: IRouter = Router();

const NOTIFICATION_MODULES = new Set([
  "project", "report", "plan", "risk", "comment", "conversation",
  "user", "document", "activity", "system",
]);
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_OFFSET = 10_000;

function parseIntegerQuery(raw: unknown, fallback: number, min: number, max: number): number | null {
  if (raw === undefined) return fallback;
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
}

router.get("/notifications", async (req, res, next) => {
  try {
    if (!req.currentUser) { res.status(401).json({ error: "unauthorized" }); return; }
    const unreadParam = req.query.unreadOnly;
    if (unreadParam !== undefined && unreadParam !== "true" && unreadParam !== "false") {
      res.status(422).json({ error: "invalid_query", detail: "unreadOnly must be true or false" }); return;
    }
    const unreadOnly = unreadParam === "true";
    const moduleParam = req.query.module;
    if (moduleParam !== undefined && (typeof moduleParam !== "string" || (moduleParam !== "all" && !NOTIFICATION_MODULES.has(moduleParam)))) {
      res.status(422).json({ error: "invalid_query", detail: "module is not supported" }); return;
    }
    const module = moduleParam && moduleParam !== "all" ? moduleParam : null;
    const limit = parseIntegerQuery(req.query.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
    const offset = parseIntegerQuery(req.query.offset, 0, 0, MAX_OFFSET);
    if (limit === null || offset === null) {
      res.status(422).json({
        error: "invalid_query",
        detail: `limit must be an integer from 1 to ${MAX_LIMIT}; offset must be an integer from 0 to ${MAX_OFFSET}`,
      });
      return;
    }

    const conditions: string[] = ["user_id = $1"];
    const params: unknown[] = [req.currentUser.id];
    if (unreadOnly) conditions.push("read_at IS NULL");
    if (module) {
      params.push(module);
      conditions.push(`entity_type = $${params.length}`);
    }

    const { rows } = await pool.query(
      `SELECT id, kind, entity_type AS "entityType", entity_id AS "entityId",
              message, link, read_at AS "readAt", created_at AS "createdAt"
       FROM notifications
       WHERE ${conditions.join(" AND ")}
        ORDER BY created_at DESC, id DESC
        LIMIT $${params.push(limit + 1) && params.length}
        OFFSET $${params.push(offset) && params.length}`,
      params,
    );
    // Scoped to the same `module` filter as the list above (but never
    // `unreadOnly`, which reflects the currently-selected tab, not the
    // module scope) — otherwise this count silently disagreed with what the
    // Unread tab's own module-filtered query actually returns, e.g. showing
    // "12" in the badge while filtering to Risks turned up only 3 rows.
    const unreadConditions = ["user_id = $1", "read_at IS NULL"];
    const unreadParams: unknown[] = [req.currentUser.id];
    if (module) {
      unreadParams.push(module);
      unreadConditions.push(`entity_type = $${unreadParams.length}`);
    }
    const unread = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM notifications WHERE ${unreadConditions.join(" AND ")}`,
      unreadParams,
    );
    // Historical rows retain their stored value; presentation maps only known
    // legacy aliases so clients receive the current taxonomy without a rewrite.
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((row) => ({
      ...row,
      kind: presentNotificationKind(String(row.kind)),
      // Historical rows are never rewritten, but an unsafe legacy destination
      // must not be handed to a browser navigation handler.
      link: normaliseNotificationLink(row.link),
    }));
    res.json({
      items,
      unread: unread.rows[0].n,
      pagination: {
        limit,
        offset,
        hasMore,
        nextOffset: hasMore ? offset + items.length : null,
      },
    });
  } catch (err) { next(err); }
});

router.patch("/notifications/:id/read", async (req, res, next) => {
  try {
    if (!req.currentUser) { res.status(401).json({ error: "unauthorized" }); return; }
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      res.status(422).json({ error: "invalid_notification_id" }); return;
    }
    const r = await pool.query(
      `UPDATE notifications SET read_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, req.currentUser.id],
    );
    if (!r.rows[0]) { res.status(404).json({ error: "not_found" }); return; }
    await realtime.publishSupportingEventToUser(req.currentUser.id, {
      entityType: "notification",
      entityId: id,
      action: "read",
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post("/notifications/read-all", async (req, res, next) => {
  try {
    if (!req.currentUser) { res.status(401).json({ error: "unauthorized" }); return; }
    const updated = await pool.query<{ id: number }>(
      `UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL RETURNING id`,
      [req.currentUser.id],
    );
    if (updated.rows[0]) {
      await realtime.publishSupportingEventToUser(req.currentUser.id, {
        entityType: "notification",
        entityId: updated.rows[0].id,
        action: "read_all",
      });
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
