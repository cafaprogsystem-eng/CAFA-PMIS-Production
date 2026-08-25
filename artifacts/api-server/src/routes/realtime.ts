import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import {
  canAccessOperationalRecord,
  canMutateOperationalRecord,
  parseOperationalEntityId,
  parseOperationalEntityType,
  realtime,
  type OperationalEntityType,
} from "../lib/realtime";

const router: IRouter = Router();

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
function parseRouteEntityId(value: unknown): number | null {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  return parseOperationalEntityId(Number(value));
}

router.post("/realtime/locks/acquire", async (req, res, next) => {
  try {
    if (!req.currentUser) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const entityType = parseOperationalEntityType(req.body?.entityType);
    const entityId = parseOperationalEntityId(req.body?.entityId);
    if (!entityType || !entityId) {
      res.status(400).json({ error: "invalid_entity" });
      return;
    }
    if (!await canAccessOperationalRecord(req.currentUser, entityType, entityId)) {
      res.status(403).json({ error: "record_forbidden" });
      return;
    }
    if (!canMutateOperationalRecord(req.currentUser, entityType)) {
      res.status(403).json({ error: "record_lock_forbidden" });
      return;
    }

    const table = tableFor(entityType);

    const existing = await pool.query<{
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
      res.status(404).json({ error: "not_found" });
      return;
    }

    const lockAge =
      row.locked_at
        ? Date.now() - new Date(row.locked_at).getTime()
        : Infinity;
    const LOCK_TTL_MS = 5 * 60 * 1000;

    if (
      row.locked_by !== null &&
      row.locked_by !== req.currentUser.id &&
      lockAge < LOCK_TTL_MS
    ) {
      res.status(409).json({
        error: "record_locked",
        lockedBy: { id: row.locked_by, name: row.locked_by_name },
        lockedAt: row.locked_at,
      });
      return;
    }

    await pool.query(
      `UPDATE ${table} SET locked_by = $1, locked_at = NOW() WHERE id = $2`,
      [req.currentUser.id, entityId],
    );

    await realtime.broadcastLock(entityType, entityId, {
      action: "locked",
      lockedBy: { id: req.currentUser.id, name: req.currentUser.name },
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete("/realtime/locks/release", async (req, res, next) => {
  try {
    if (!req.currentUser) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const entityType = parseOperationalEntityType(req.body?.entityType);
    const entityId = parseOperationalEntityId(req.body?.entityId);
    if (!entityType || !entityId) {
      res.status(400).json({ error: "invalid_entity" });
      return;
    }
    if (!await canAccessOperationalRecord(req.currentUser, entityType, entityId)) {
      res.status(403).json({ error: "record_forbidden" });
      return;
    }
    if (!canMutateOperationalRecord(req.currentUser, entityType)) {
      res.status(403).json({ error: "record_lock_forbidden" });
      return;
    }

    const table = tableFor(entityType);

    const released = await pool.query(
      `UPDATE ${table} SET locked_by = NULL, locked_at = NULL
       WHERE id = $1 AND locked_by = $2`,
      [entityId, req.currentUser.id],
    );

    // No state changed when another user owns the lock, so there is no success
    // event to publish. The mutation is an autocommit statement; delivery only
    // begins after PostgreSQL has acknowledged it.
    if ((released.rowCount ?? 0) > 0) {
      await realtime.broadcastLock(entityType, entityId, { action: "unlocked" });
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get("/realtime/locks/:entityType/:entityId", async (req, res, next) => {
  try {
    if (!req.currentUser) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const entityType = parseOperationalEntityType(req.params.entityType);
    const entityId = parseRouteEntityId(req.params.entityId);
    if (!entityType || !entityId) {
      res.status(400).json({ error: "invalid_entity" });
      return;
    }
    if (!await canAccessOperationalRecord(req.currentUser, entityType, entityId)) {
      res.status(403).json({ error: "record_forbidden" });
      return;
    }

    const table = tableFor(entityType);
    const LOCK_TTL_MS = 5 * 60 * 1000;

    const r = await pool.query<{
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
      res.status(404).json({ error: "not_found" });
      return;
    }

    const lockAge =
      row.locked_at
        ? Date.now() - new Date(row.locked_at).getTime()
        : Infinity;
    const isActive =
      row.locked_by !== null && lockAge < LOCK_TTL_MS;

    res.json({
      locked: isActive,
      lockedBy: isActive
        ? { id: row.locked_by, name: row.locked_by_name }
        : null,
      lockedAt: isActive ? row.locked_at : null,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
