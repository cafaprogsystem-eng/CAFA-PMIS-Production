import { Hono } from "hono";
import type { Bindings } from "../lib/db";
import { openDb } from "../lib/db";
import { attachCurrentUser, requireAuth, requirePerm, type Variables } from "../lib/rbac";
import { checkFromDomainVerification } from "../lib/mailer";

/**
 * New admin module (not a port — this system-activity module doesn't exist
 * in the source AWS system) combining the email delivery log and live user
 * presence in one place, gated behind the new system.monitoring.view
 * permission. email_logs is already populated by every lib/mailer.ts
 * sendEmail() call regardless of outcome (stub/pending, sent, or failed) —
 * this route only reads it. Presence (isOnline/lastSeenAt) is deliberately
 * NOT duplicated here: the frontend reuses the existing GET /users response,
 * which already carries both fields via routes/users.ts's withPresence().
 */
export const adminMonitoringRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

adminMonitoringRoutes.use("/admin/email-logs", attachCurrentUser, requireAuth, requirePerm("system.monitoring.view"));
adminMonitoringRoutes.use("/admin/email-domain-status", attachCurrentUser, requireAuth, requirePerm("system.monitoring.view"));

adminMonitoringRoutes.get("/admin/email-domain-status", async (c) => {
  const result = await checkFromDomainVerification(c.env);
  return c.json(result);
});

adminMonitoringRoutes.get("/admin/email-logs", async (c) => {
  const search = c.req.query("search");
  const status = c.req.query("status");
  const limit = Math.min(Number(c.req.query("limit") ?? "50") || 50, 200);
  const offset = Number(c.req.query("offset") ?? "0") || 0;

  const { db, close } = openDb(c);
  try {
    const params: unknown[] = [];
    const where: string[] = [];
    if (search) {
      params.push(`%${search}%`);
      where.push(`(LOWER(e.email_to) LIKE LOWER($${params.length}) OR LOWER(e.subject) LIKE LOWER($${params.length}) OR LOWER(u.name) LIKE LOWER($${params.length}))`);
    }
    if (status && ["pending", "sent", "failed"].includes(status)) {
      params.push(status);
      where.push(`e.status = $${params.length}`);
    }
    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    params.push(limit, offset);
    const { rows } = await db.query(
      `SELECT e.id, e.email_to AS "emailTo", e.email_type AS "emailType", e.subject,
              e.status, e.provider_name AS "providerName", e.provider_message_id AS "providerMessageId",
              e.error_message AS "errorMessage", e.created_at AS "createdAt", e.sent_at AS "sentAt",
              u.id AS "userId", u.name AS "userName"
         FROM email_logs e
         LEFT JOIN users u ON u.id = e.user_id
         ${whereClause}
        ORDER BY e.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const { rows: countRows } = await db.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM email_logs e LEFT JOIN users u ON u.id = e.user_id ${whereClause}`,
      params.slice(0, params.length - 2),
    );
    return c.json({ items: rows, total: countRows[0]?.total ?? 0, limit, offset });
  } finally {
    close();
  }
});
