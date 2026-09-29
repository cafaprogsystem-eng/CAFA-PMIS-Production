import { Hono } from "hono";
import type { Bindings } from "../lib/db";
import { openDb } from "../lib/db";
import { attachCurrentUser, requireAuth, requirePerm, hasPerm, permissionsFor, logAudit, type Variables } from "../lib/rbac";

/**
 * Ported from artifacts/api-server/src/routes/ai.ts — everything except
 * /ai/chat, which was already ported directly into index.ts (see the
 * comment there and lib/ai.ts). This completes the file: settings
 * (read/write the ai_settings singleton), a user's own chat history, and
 * the admin-only full usage log. Found missing via the systematic
 * api-server/routes/index.ts comparison.
 */

const AI_ENV_ENABLED_KEY = "AI_ENABLED";

export const aiRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

aiRoutes.use("/ai/*", attachCurrentUser, requireAuth);

// Every authenticated user calls this (the chat widget uses it to decide
// whether to render itself and which response language to request), so it
// stays open to all — but systemPromptExtra is the admin's custom internal
// system-prompt instructions, readable only by whoever could have written it
// (ai.settings.manage) or is auditing AI usage (ai.logs.view).
aiRoutes.get("/ai/settings", async (c) => {
  const { db, close } = openDb(c);
  try {
    const { rows } = await db.query<{
      enabled: string | null; system_prompt_extra: string | null;
      response_language: string | null; updated_at: string;
    }>(`SELECT * FROM ai_settings WHERE id = 1`);
    const row = rows[0];
    const perms = permissionsFor(c.get("currentUser")!);
    const canSeeAdminConfig = hasPerm(perms, "ai.settings.manage") || hasPerm(perms, "ai.logs.view");
    const envEnabled = String(c.env[AI_ENV_ENABLED_KEY] ?? "").toLowerCase() === "true";
    return c.json({
      enabled: row?.enabled ?? "true",
      envEnabled,
      ...(envEnabled ? {} : { reason: "uat_mode" }),
      systemPromptExtra: canSeeAdminConfig ? (row?.system_prompt_extra ?? null) : null,
      responseLanguage: row?.response_language ?? "auto",
      ...(row ? { updatedAt: row.updated_at } : {}),
    });
  } finally {
    close();
  }
});

aiRoutes.put("/ai/settings", requirePerm("ai.settings.manage"), async (c) => {
  const user = c.get("currentUser")!;
  const body = await c.req.json().catch(() => ({}));
  const { enabled, systemPromptExtra, responseLanguage } = body as Record<string, unknown>;
  const params = [enabled ?? "true", systemPromptExtra ?? null, responseLanguage ?? "auto", user.id];

  const { db, close } = openDb(c);
  try {
    // UPDATE only — never INSERT during a normal save/enable/disable. This is
    // safe because the singleton row (id=1) is guaranteed to exist after the
    // one-time migration. INSERT is used only as a last-resort fallback if
    // the row is somehow absent (e.g. fresh empty DB).
    const result = await db.query(
      `UPDATE ai_settings
          SET enabled            = $1,
              system_prompt_extra = $2,
              response_language  = $3,
              updated_at         = NOW(),
              updated_by         = $4
        WHERE id = 1`,
      params,
    );

    if ((result.rowCount ?? 0) === 0) {
      await db.query(
        `INSERT INTO ai_settings (id, enabled, system_prompt_extra, response_language, updated_at, updated_by)
         VALUES (1, $1, $2, $3, NOW(), $4)`,
        params,
      );
    }

    await logAudit(db, { userId: user.id, action: "ai_settings_updated", module: "ai", entityId: null });
    return c.json({ ok: true });
  } finally {
    close();
  }
});

aiRoutes.get("/ai/history", async (c) => {
  const user = c.get("currentUser")!;
  const sessionId = c.req.query("sessionId");
  const limit = c.req.query("limit") ?? "50";

  const { db, close } = openDb(c);
  try {
    const params: unknown[] = [user.id];
    let where = "user_id = $1";
    if (sessionId) {
      params.push(sessionId);
      where += ` AND session_id = $${params.length}`;
    }
    params.push(Number(limit));
    const { rows } = await db.query(
      `SELECT id, session_id AS "sessionId", role, content, module,
              status, prompt_tokens AS "promptTokens", completion_tokens AS "completionTokens",
              created_at AS "createdAt"
         FROM ai_chat_messages
        WHERE ${where}
        ORDER BY created_at DESC
        LIMIT $${params.length}`,
      params,
    );
    return c.json({ messages: rows });
  } finally {
    close();
  }
});

aiRoutes.get("/ai/logs", requirePerm("ai.logs.view"), async (c) => {
  const search = c.req.query("search");
  const limit = c.req.query("limit") ?? "200";
  const offset = c.req.query("offset") ?? "0";

  const { db, close } = openDb(c);
  try {
    const params: unknown[] = [];
    let where = "";
    if (search) {
      params.push(`%${search}%`);
      where = `WHERE LOWER(m.content) LIKE LOWER($${params.length}) OR LOWER(u.name) LIKE LOWER($${params.length})`;
    }
    params.push(Number(limit), Number(offset));
    const { rows } = await db.query(
      `SELECT m.id, m.session_id AS "sessionId", m.role, m.content, m.module,
              m.user_role AS "userRole", m.status,
              m.prompt_tokens AS "promptTokens",
              m.completion_tokens AS "completionTokens",
              m.created_at AS "createdAt",
              u.id AS "userId", u.name AS "userName", u.role AS "userRoleDb"
         FROM ai_chat_messages m
         JOIN users u ON u.id = m.user_id
         ${where}
        ORDER BY m.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const { rows: countRows } = await db.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM ai_chat_messages m JOIN users u ON u.id = m.user_id ${where}`,
      params.slice(0, params.length - 2),
    );
    return c.json({ messages: rows, total: countRows[0]?.total ?? 0 });
  } finally {
    close();
  }
});

aiRoutes.delete("/ai/history", async (c) => {
  const user = c.get("currentUser")!;
  const { db, close } = openDb(c);
  try {
    await db.query(`DELETE FROM ai_chat_messages WHERE user_id = $1`, [user.id]);
    await logAudit(db, { userId: user.id, action: "delete_history", module: "ai", entityId: user.id });
    return c.json({ ok: true });
  } finally {
    close();
  }
});
