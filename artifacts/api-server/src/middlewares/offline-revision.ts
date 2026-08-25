import type { NextFunction, Request, Response } from "express";
import { pool } from "@workspace/db";

const REVISION_TABLES: Record<string, string> = {
  projects: "projects",
  plans: "plans",
  risks: "risks",
  reports: "reports",
};

/**
 * Applies only when an offline replay explicitly supplies the revision it
 * edited. Normal online requests remain backwards-compatible, while replayed
 * draft updates fail safely instead of overwriting a newer server version.
 *
 * Route handlers still run their current authentication, RBAC, scope and
 * lifecycle guards on every accepted replay; this middleware is an additional
 * precondition, not an alternative authorisation path.
 */
export async function offlineRevisionMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const baseRevision = req.header("x-base-revision");
  if (!baseRevision || !["PATCH", "PUT"].includes(req.method)) {
    next();
    return;
  }

  const match = req.path.match(/^\/(projects|plans|risks|reports)\/(\d+)$/);
  if (!match) {
    next();
    return;
  }
  const expected = new Date(baseRevision);
  if (Number.isNaN(expected.getTime())) {
    res.status(400).json({ error: "invalid_base_revision" });
    return;
  }

  const table = REVISION_TABLES[match[1]];
  try {
    const { rows } = await pool.query<{ updated_at: Date }>(
      `SELECT updated_at FROM ${table} WHERE id = $1`,
      [Number(match[2])],
    );
    if (rows.length === 0) {
      next();
      return;
    }
    const current = new Date(rows[0].updated_at);
    if (current.getTime() !== expected.getTime()) {
      res.status(409).json({
        error: "offline_conflict",
        code: "revision_mismatch",
        serverRevision: current.toISOString(),
      });
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
}
