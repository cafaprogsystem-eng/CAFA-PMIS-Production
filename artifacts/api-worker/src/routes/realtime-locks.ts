import { Hono } from "hono";
import type { Bindings } from "../lib/db";
import { openDb } from "../lib/db";
import { attachCurrentUser, requireAuth, type Variables } from "../lib/rbac";
import {
  canAccessOperationalRecord,
  canMutateOperationalRecord,
  parseOperationalEntityId,
  parseOperationalEntityType,
  type OperationalEntityType,
} from "../lib/operational-access";
import { broadcastLock } from "../lib/realtime";

/**
 * Ported from artifacts/api-server/src/routes/realtime.ts (204 lines) — the
 * cross-cutting record-locking feature (5-minute-TTL "someone else is
 * editing this record" guard over projects/reports/plans/risks). Never
 * ported before this phase; locked_by/locked_at columns already exist on
 * every target table, no migration needed.
 */

function tableFor(entityType: OperationalEntityType): string {
  return entityType === "project"
    ? "projects"
    : entityType === "report"
      ? "reports"
      : entityType === "plan"
        ? "plans"
        : "risks";
}

/** Route parameters are strings; retain the canonical positive-integer boundary. */
function parseRouteEntityId(value: string | undefined): number | null {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  return parseOperationalEntityId(Number(value));
}

const LOCK_TTL_MS = 5 * 60 * 1000;

export const realtimeLocksRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

realtimeLocksRoutes.use("/realtime/locks/*", attachCurrentUser, requireAuth);

realtimeLocksRoutes.post("/realtime/locks/acquire", async (c) => {
  const user = c.get("currentUser")!;
  const { db, close } = openDb(c);
  try {
    const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
    const entityType = parseOperationalEntityType(body?.entityType);
    const entityId = parseOperationalEntityId(body?.entityId);
    if (!entityType || !entityId) {
      return c.json({ error: "invalid_entity" }, 400);
    }
    if (!await canAccessOperationalRecord(db, user, entityType, entityId)) {
      return c.json({ error: "record_forbidden" }, 403);
    }
    if (!canMutateOperationalRecord(user, entityType)) {
      return c.json({ error: "record_lock_forbidden" }, 403);
    }

    const table = tableFor(entityType);

    const existing = await db.query<{
      locked_by: number | null;
      locked_at: Date | null;
      locked_by_name: string | null;
    }>(
      `SELECT t.locked_by, t.locked_at, u.name AS locked_by_name
       FROM ${table} t
       LEFT JOIN users u ON u.id = t.locked_by
       WHERE t.id = $1`,
      [entityId],
    );

    const row = existing.rows[0];
    if (!row) {
      return c.json({ error: "not_found" }, 404);
    }

    const lockAge =
      row.locked_at
        ? Date.now() - new Date(row.locked_at).getTime()
        : Infinity;

    if (
      row.locked_by !== null &&
      row.locked_by !== user.id &&
      lockAge < LOCK_TTL_MS
    ) {
      return c.json({
        error: "record_locked",
        lockedBy: { id: row.locked_by, name: row.locked_by_name },
        lockedAt: row.locked_at,
      }, 409);
    }

    await db.query(
      `UPDATE ${table} SET locked_by = $1, locked_at = NOW() WHERE id = $2`,
      [user.id, entityId],
    );

    await broadcastLock(c.env, entityType, entityId, {
      action: "locked",
      lockedBy: { id: user.id, name: user.name },
    });

    return c.json({ ok: true });
  } finally {
    close();
  }
});

realtimeLocksRoutes.delete("/realtime/locks/release", async (c) => {
  const user = c.get("currentUser")!;
  const { db, close } = openDb(c);
  try {
    const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
    const entityType = parseOperationalEntityType(body?.entityType);
    const entityId = parseOperationalEntityId(body?.entityId);
    if (!entityType || !entityId) {
      return c.json({ error: "invalid_entity" }, 400);
    }
    if (!await canAccessOperationalRecord(db, user, entityType, entityId)) {
      return c.json({ error: "record_forbidden" }, 403);
    }
    if (!canMutateOperationalRecord(user, entityType)) {
      return c.json({ error: "record_lock_forbidden" }, 403);
    }

    const table = tableFor(entityType);

    const released = await db.query(
      `UPDATE ${table} SET locked_by = NULL, locked_at = NULL
       WHERE id = $1 AND locked_by = $2`,
      [entityId, user.id],
    );

    // No state changed when another user owns the lock, so there is no success
    // event to publish. The mutation is an autocommit statement; delivery only
    // begins after PostgreSQL has acknowledged it.
    if ((released.rowCount ?? 0) > 0) {
      await broadcastLock(c.env, entityType, entityId, { action: "unlocked" });
    }
    return c.json({ ok: true });
  } finally {
    close();
  }
});

realtimeLocksRoutes.get("/realtime/locks/:entityType/:entityId", async (c) => {
  const user = c.get("currentUser")!;
  const { db, close } = openDb(c);
  try {
    const entityType = parseOperationalEntityType(c.req.param("entityType"));
    const entityId = parseRouteEntityId(c.req.param("entityId"));
    if (!entityType || !entityId) {
      return c.json({ error: "invalid_entity" }, 400);
    }
    if (!await canAccessOperationalRecord(db, user, entityType, entityId)) {
      return c.json({ error: "record_forbidden" }, 403);
    }

    const table = tableFor(entityType);

    const r = await db.query<{
      locked_by: number | null;
      locked_at: Date | null;
      locked_by_name: string | null;
    }>(
      `SELECT t.locked_by, t.locked_at, u.name AS locked_by_name
       FROM ${table} t
       LEFT JOIN users u ON u.id = t.locked_by
       WHERE t.id = $1`,
      [entityId],
    );

    const row = r.rows[0];
    if (!row) {
      return c.json({ error: "not_found" }, 404);
    }

    const lockAge =
      row.locked_at
        ? Date.now() - new Date(row.locked_at).getTime()
        : Infinity;
    const isActive =
      row.locked_by !== null && lockAge < LOCK_TTL_MS;

    return c.json({
      locked: isActive,
      lockedBy: isActive
        ? { id: row.locked_by, name: row.locked_by_name }
        : null,
      lockedAt: isActive ? row.locked_at : null,
    });
  } finally {
    close();
  }
});
