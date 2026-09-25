import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import type { AppContext, Bindings, QueryExecutor } from "./lib/db";
import { openDb } from "./lib/db";
import {
  createSession,
  getActiveSession,
  revokeSession,
  setSessionCookie,
  clearSessionCookie,
} from "./lib/session";
import { isAccountLocked, recordFailedLogin, clearAccountFailures } from "./lib/rate-limit-store";
import { getOpenAIClient, buildSystemPrompt } from "./lib/ai";

/**
 * Phase 2 proof: session/auth on Hono + Hyperdrive, ported from
 * artifacts/api-server's routes/auth.ts + lib/session.ts + lib/rate-limit-store.ts.
 *
 * Deliberately out of scope here (belongs to the later, larger CRUD-routes
 * phase): permissionsFor()/RBAC, audit logging, email flows (invite/reset/
 * verify), and the express-rate-limit IP-based limiter. This proves the
 * identifier → lockout → bcrypt → session → cookie path end to end, which
 * every other route will build on.
 */

interface UserRow extends Record<string, unknown> {
  id: number;
  name: string;
  email: string;
  username: string | null;
  password_hash: string | null;
  role: string;
  role_label: string;
  scope: string;
  state_id: number | null;
  sector: string | null;
  status: string;
}

interface LoginBody {
  identifier?: string;
  username?: string;
  email?: string;
  password?: string;
  remember?: boolean;
}

// See auth.ts's own comment: a constant-time placeholder so a non-existent
// identifier costs the same bcrypt comparison as a wrong password on a real
// account — otherwise response timing alone reveals which is which.
// Computed lazily, not at module scope: Workers restricts some APIs (crypto
// randomness included) to inside a request's execution context, so an eager
// top-level bcrypt.hashSync() throws during startup validation even though
// the identical call works fine once a request is actually in flight.
let dummyPasswordHash: string | undefined;
function dummyPasswordHashFor(): string {
  dummyPasswordHash ??= bcrypt.hashSync("no-such-account-constant-time-placeholder", 12);
  return dummyPasswordHash;
}

const app = new Hono<{ Bindings: Bindings }>();

app.post("/auth/login", async (c) => {
  const body = await c.req.json<LoginBody>().catch((): LoginBody => ({}));
  const identifier = String(body.identifier ?? body.username ?? body.email ?? "").trim();
  const password = String(body.password ?? "");
  const remember = Boolean(body.remember);

  if (!identifier || !password) {
    return c.json({ error: "identifier_and_password_required" }, 400);
  }

  const { db, close } = openDb(c);
  try {
    const normalizedIdentifier = identifier.toLowerCase();
    if (await isAccountLocked(db, normalizedIdentifier)) {
      return c.json({ error: "too_many_requests" }, 429);
    }

    const { rows } = await db.query<UserRow>(
      `SELECT id, name, email, username, password_hash, role, role_label, scope, state_id, sector, status
         FROM users
        WHERE LOWER(email) = LOWER($1) OR LOWER(username) = LOWER($1)
        LIMIT 1`,
      [identifier],
    );
    const row = rows[0];

    if (!row || !row.password_hash) {
      await bcrypt.compare(password, dummyPasswordHashFor());
      await recordFailedLogin(db, normalizedIdentifier);
      return c.json({ error: "invalid_credentials" }, 401);
    }

    const ok = await bcrypt.compare(password, row.password_hash);
    if (!ok) {
      await recordFailedLogin(db, normalizedIdentifier);
      return c.json({ error: "invalid_credentials" }, 401);
    }
    await clearAccountFailures(db, normalizedIdentifier);

    if (row.status !== "active") {
      return c.json({ error: "account_not_active", status: row.status }, 403);
    }

    await db.query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [row.id]);
    const { token } = await createSession(db, row.id, remember);
    setSessionCookie(c, token, remember);

    return c.json({
      user: {
        id: row.id,
        name: row.name,
        email: row.email,
        username: row.username,
        role: row.role,
        roleLabel: row.role_label,
        scope: row.scope,
        stateId: row.state_id,
        sector: row.sector,
        status: row.status,
      },
    });
  } finally {
    close();
  }
});

app.get("/auth/me", async (c) => {
  const { db, close } = openDb(c);
  try {
    const session = await getActiveSession(c, db);
    if (!session) return c.json({ error: "unauthenticated" }, 401);

    const { rows } = await db.query<UserRow>(
      `SELECT id, name, email, username, password_hash, role, role_label, scope, state_id, sector, status
         FROM users WHERE id = $1 LIMIT 1`,
      [session.userId],
    );
    const row = rows[0];
    if (!row || row.status !== "active") return c.json({ error: "unauthenticated" }, 401);

    return c.json({
      user: {
        id: row.id,
        name: row.name,
        email: row.email,
        username: row.username,
        role: row.role,
        roleLabel: row.role_label,
        scope: row.scope,
        stateId: row.state_id,
        sector: row.sector,
        status: row.status,
      },
    });
  } finally {
    close();
  }
});

app.post("/auth/logout", async (c) => {
  const { db, close } = openDb(c);
  try {
    const session = await getActiveSession(c, db);
    if (session) await revokeSession(db, session.id);
    clearSessionCookie(c);
    return c.json({ ok: true });
  } finally {
    close();
  }
});

// ── AI Assistant (ported from routes/ai.ts's /ai/chat only — see lib/ai.ts) ──

interface AiUserRow extends Record<string, unknown> {
  id: number;
  name: string;
  role: string;
  role_label: string;
  state_id: number | null;
  state_name: string | null;
  sector: string | null;
}

async function currentAiUser(c: AppContext, db: QueryExecutor): Promise<AiUserRow | null> {
  const session = await getActiveSession(c, db);
  if (!session) return null;
  const { rows } = await db.query<AiUserRow>(
    `SELECT u.id, u.name, u.role, u.role_label, u.state_id, s.name AS state_name, u.sector
       FROM users u
       LEFT JOIN states s ON s.id = u.state_id
      WHERE u.id = $1 AND u.status = 'active'
      LIMIT 1`,
    [session.userId],
  );
  return rows[0] ?? null;
}

app.post("/ai/chat", async (c) => {
  // Not wrapped in try/finally around the whole handler: once streamSSE()
  // returns, its callback keeps running in the background (Hono doesn't
  // await it — see hono/dist/helper/streaming/sse.js's fire-and-forget
  // run()), so closing the pool here would race the callback's own later
  // queries. Each early-return guard below closes db itself; the streaming
  // path closes it only after its final INSERT.
  const { db, close } = openDb(c);

  const user = await currentAiUser(c, db);
  if (!user) { close(); return c.json({ error: "unauthenticated" }, 401); }

  // Guard 1: environment-level flag.
  if (String(c.env.AI_ENABLED ?? "").toLowerCase() !== "true") {
    close();
    return c.json({
      error: "ai_disabled",
      reason: "uat_mode",
      message: "AI Assistant is currently disabled for UAT. It is ready to be activated after live deployment.",
    }, 503);
  }

  // Guard 2: admin DB toggle — singleton row id=1.
  const { rows: settingsRows } = await db.query<{
    enabled: string; system_prompt_extra: string | null; response_language: string | null;
  }>(`SELECT * FROM ai_settings WHERE id = 1`);
  const settings = settingsRows[0];
  if (settings?.enabled === "false") {
    close();
    return c.json({ error: "ai_disabled", message: "The AI assistant is currently disabled by the administrator." }, 503);
  }

  const body = await c.req.json<{ message?: string; currentPage?: string; sessionId?: string; lang?: string }>().catch(() => ({}) as Record<string, never>);
  const message = String(body.message ?? "").trim();
  if (!message) { close(); return c.json({ error: "message_required" }, 400); }

  // Guard 3: per-user daily message cap.
  const dailyLimit = Number(c.env.AI_DAILY_MESSAGE_LIMIT ?? 50);
  const { rows: usageRows } = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM ai_chat_messages
     WHERE user_id = $1 AND role = 'user' AND created_at >= date_trunc('day', NOW())`,
    [user.id],
  );
  if (Number(usageRows[0]?.count ?? 0) >= dailyLimit) {
    close();
    return c.json({
      error: "ai_daily_limit_reached",
      limit: dailyLimit,
      message: `You have reached today's limit of ${dailyLimit} AI messages. Please try again tomorrow.`,
    }, 429);
  }

  const sessionId = body.sessionId ?? crypto.randomUUID();
  const currentModule = String(body.currentPage ?? "/").slice(0, 120);
  const responseLang = body.lang ?? settings?.response_language ?? "auto";

  const { rows: historyRows } = await db.query<{ role: "user" | "assistant"; content: string }>(
    `SELECT role, content FROM ai_chat_messages
     WHERE user_id = $1 AND session_id = $2
     ORDER BY created_at ASC LIMIT 20`,
    [user.id, sessionId],
  );

  await db.query(
    `INSERT INTO ai_chat_messages (user_id, session_id, role, content, module, user_role, status)
     VALUES ($1, $2, 'user', $3, $4, $5, 'success')`,
    [user.id, sessionId, message, currentModule, user.role],
  );

  const systemPrompt = buildSystemPrompt({
    user: {
      name: user.name, role: user.role, roleLabel: user.role_label,
      stateName: user.state_name, sector: user.sector,
    },
    currentPage: currentModule,
    lang: responseLang,
    extraPrompt: settings?.system_prompt_extra,
  });

  const chatMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: systemPrompt },
    ...historyRows.map((r) => ({ role: r.role, content: r.content })),
    { role: "user", content: message },
  ];

  return streamSSE(c, async (stream) => {
    let fullResponse = "";
    let promptTokens: number | null = null;
    let completionTokens: number | null = null;
    let assistantStatus: "success" | "failed" = "success";

    try {
      const openai = getOpenAIClient(c.env);
      const completionStream = await openai.chat.completions.create({
        model: "gpt-5-mini",
        max_completion_tokens: 2048,
        messages: chatMessages,
        stream: true,
        stream_options: { include_usage: true },
      });

      for await (const chunk of completionStream) {
        if (chunk.usage) {
          promptTokens = chunk.usage.prompt_tokens ?? null;
          completionTokens = chunk.usage.completion_tokens ?? null;
        }
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          fullResponse += content;
          await stream.writeSSE({ data: JSON.stringify({ content }) });
        }
      }
    } catch {
      // The raw OpenAI error (rate limits, auth failures...) is not
      // something to show a user as if the assistant said it.
      assistantStatus = "failed";
      fullResponse = "Sorry, something went wrong while generating a response. Please try again.";
      await stream.writeSSE({ data: JSON.stringify({ content: fullResponse }) });
    }

    try {
      await db.query(
        `INSERT INTO ai_chat_messages
           (user_id, session_id, role, content, module, user_role, status, prompt_tokens, completion_tokens)
         VALUES ($1, $2, 'assistant', $3, $4, $5, $6, $7, $8)`,
        [user.id, sessionId, fullResponse, currentModule, user.role, assistantStatus, promptTokens, completionTokens],
      );
    } finally {
      close();
    }
  });
});

export default app;
