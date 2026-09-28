import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { ZodError } from "zod";
import type { Bindings } from "./lib/db";
import { openDb } from "./lib/db";
import {
  createSession,
  getActiveSession,
  revokeSession,
  setSessionCookie,
  clearSessionCookie,
} from "./lib/session";
import { isAccountLocked, recordFailedLogin, clearAccountFailures } from "./lib/rate-limit-store";
import { disconnectSession } from "./lib/realtime";
import { getOpenAIClient, buildSystemPrompt } from "./lib/ai";
import { attachCurrentUser, requireAuth, isDemoRoleHarnessEnabled, type Variables } from "./lib/rbac";
import { notificationsRoutes } from "./routes/notifications";
import { meRoutes } from "./routes/me";
import { beneficiariesRoutes } from "./routes/beneficiaries";
import { searchRoutes } from "./routes/search";
import { usersRoutes } from "./routes/users";
import { projectsRoutes } from "./routes/projects";
import { statesRoutes } from "./routes/states";
import { risksRoutes } from "./routes/risks";
import { plansRoutes } from "./routes/plans";
import { reportsRoutes } from "./routes/reports";
import { commentsRoutes } from "./routes/comments";
import { filesRoutes } from "./routes/files";
import { storageRoutes } from "./routes/storage";
import { attachmentsRoutes } from "./routes/attachments";
import { voiceNotesRoutes } from "./routes/voice-notes";
import { attachmentReconciliationRoutes } from "./routes/attachment-reconciliation";
import { historicalStorageImportRoutes } from "./routes/historical-storage-import";
import { manualRoutes } from "./routes/manual";
import { conversationsRoutes } from "./routes/conversations";
import { auditRoutes } from "./routes/audit";
import { dashboardRoutes } from "./routes/dashboard";
import { healthRoutes } from "./routes/health";
import { profileRoutes } from "./routes/profile";
import { passwordResetAdminRoutes } from "./routes/password-reset-admin";
import { realtimeLocksRoutes } from "./routes/realtime-locks";

/**
 * /auth/* stays hand-rolled (session/login/logout have no RBAC/permission
 * check of their own — auth IS the thing being established) and does not
 * use attachCurrentUser/requireAuth, since attachCurrentUser depends on a
 * session already existing. Every other route mounted below (starting with
 * /ai/chat and routes/notifications.ts) uses lib/rbac.ts's
 * attachCurrentUser + requireAuth (+ requirePerm where a route needs more
 * than "any authenticated user") — the bulk CRUD-routes phase's foundation.
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

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

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
    if (session) {
      await revokeSession(db, session.id);
      // Terminate only this one session's realtime connections — other
      // devices/tabs logged in as the same user stay connected.
      await disconnectSession(c.env, session.id);
    }
    clearSessionCookie(c);
    return c.json({ ok: true });
  } finally {
    close();
  }
});

/**
 * WebSocket upgrade entrypoint for the realtime hub (Durable Object).
 * Reuses the normal session-cookie auth every REST route already runs, then
 * hands the resolved identity to the DO via a header — the DO itself never
 * parses or unsigns the session cookie. See
 * src/durable-objects/realtime-hub.ts and src/lib/realtime.ts.
 */
app.get("/realtime/connect", attachCurrentUser, requireAuth, async (c) => {
  if (c.req.header("Upgrade") !== "websocket") {
    return c.json({ error: "expected_websocket" }, 400);
  }
  const user = c.get("currentUser")!;
  const session = c.get("authSession")!;
  let identity = {
    id: user.id,
    name: user.name,
    role: user.role,
    stateId: user.stateId,
    sectors: user.sectors,
    sessionId: session.id,
  };

  // Dev-only role-switcher hint (see isDemoRoleHarnessEnabled) — only a
  // super_admin session may impersonate another active user for testing.
  const asUserId = c.req.query("asUserId");
  if (asUserId && isDemoRoleHarnessEnabled(c.env) && user.role === "super_admin") {
    const targetId = Number(asUserId);
    if (Number.isSafeInteger(targetId) && targetId !== user.id) {
      const { db, close } = openDb(c);
      try {
        const { rows } = await db.query<{
          id: number; name: string; role: string; state_id: number | null; sector: string | null; status: string;
        }>(
          `SELECT id, name, role, state_id, sector, status FROM users WHERE id = $1 LIMIT 1`,
          [targetId],
        );
        const row = rows[0];
        if (row && row.status === "active") {
          identity = {
            id: row.id,
            name: row.name,
            role: row.role,
            stateId: row.state_id,
            sectors: row.role === "technical_coordinator" && row.sector
              ? String(row.sector).split(",").map((s) => s.trim()).filter(Boolean)
              : null,
            sessionId: session.id,
          };
        }
      } finally {
        close();
      }
    }
  }

  const forwarded = new Request(c.req.raw, { headers: new Headers(c.req.raw.headers) });
  forwarded.headers.set("X-CAFA-Realtime-User", JSON.stringify(identity));
  const stub = c.env.REALTIME_HUB.get(c.env.REALTIME_HUB.idFromName("global"));
  return stub.fetch(forwarded);
});

// ── AI Assistant (ported from routes/ai.ts's /ai/chat only — see lib/ai.ts) ──

app.post("/ai/chat", attachCurrentUser, requireAuth, async (c) => {
  const user = c.get("currentUser")!;

  // Not wrapped in try/finally around the whole handler: once streamSSE()
  // returns, its callback keeps running in the background (Hono doesn't
  // await it — see hono/dist/helper/streaming/sse.js's fire-and-forget
  // run()), so closing the pool here would race the callback's own later
  // queries. Each early-return guard below closes db itself; the streaming
  // path closes it only after its final INSERT.
  const { db, close } = openDb(c);

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
      name: user.name, role: user.role, roleLabel: user.roleLabel,
      stateName: user.stateName, sector: user.sector,
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

app.route("/", notificationsRoutes);
app.route("/", meRoutes);
app.route("/", beneficiariesRoutes);
app.route("/", searchRoutes);
app.route("/", usersRoutes);
app.route("/", projectsRoutes);
app.route("/", statesRoutes);
app.route("/", risksRoutes);
app.route("/", plansRoutes);
app.route("/", reportsRoutes);
app.route("/", commentsRoutes);
app.route("/", filesRoutes);
app.route("/", storageRoutes);
app.route("/", attachmentsRoutes);
app.route("/", voiceNotesRoutes);
app.route("/", attachmentReconciliationRoutes);
app.route("/", historicalStorageImportRoutes);
app.route("/", manualRoutes);
app.route("/", conversationsRoutes);
app.route("/", auditRoutes);
app.route("/", dashboardRoutes);
app.route("/", healthRoutes);
app.route("/", profileRoutes);
app.route("/", passwordResetAdminRoutes);
app.route("/", realtimeLocksRoutes);

/**
 * Ported from artifacts/api-server/src/lib/error-handler.ts's
 * createApiErrorHandler: routes call `.parse()` directly (see
 * routes/projects.ts, routes/beneficiaries.ts) and rely on this catch-all to
 * turn a thrown ZodError into a 400 with field details, exactly like the
 * Express version's app-level error middleware — no per-route try/catch.
 * A 5xx (or unrecognised) error is redacted to a generic message; only an
 * error carrying an explicit `errorCode` string is trusted to surface its
 * own .message to the client.
 */
app.onError((err, c) => {
  if (err instanceof ZodError) {
    const first = err.issues[0];
    const fieldPath = first?.path.length ? first.path.join(".") : "input";
    const message = first?.message ?? "Validation failed";
    return c.json({
      error: "validation_error",
      detail: `${fieldPath}: ${message}`,
      fields: err.issues.map((e) => ({ path: e.path.join("."), message: e.message })),
    }, 400);
  }

  const anyErr = err as unknown as Record<string, unknown>;
  const requestedStatus = typeof anyErr?.status === "number"
    ? anyErr.status
    : typeof anyErr?.statusCode === "number" ? anyErr.statusCode : 500;
  const status = Number.isInteger(requestedStatus) && requestedStatus >= 400 && requestedStatus <= 599
    ? requestedStatus
    : 500;

  console.error("[unhandled-error]", err);

  if (status >= 500) {
    return c.json({ error: "server_error", detail: "Internal Server Error" }, 500);
  }

  const errorCode = typeof anyErr?.errorCode === "string" ? anyErr.errorCode : null;
  if (!errorCode) {
    return c.json({ error: "request_failed", detail: "Request failed" }, status as 400);
  }

  const message = typeof anyErr?.message === "string" ? anyErr.message : "Request failed";
  return c.json({ error: errorCode, detail: message }, status as 400);
});

// Durable Object classes must be exported from the Worker's main entrypoint
// module for the wrangler.toml [[durable_objects.bindings]] class_name to
// resolve.
export { RealtimeHub } from "./durable-objects/realtime-hub";

/**
 * The frontend (the generated API client in lib/api-client-react, and
 * socket.ts) calls every endpoint under an /api prefix — a holdover from the
 * AWS nginx/Express setup, where nginx proxied everything to Express and
 * Express itself mounted its router under /api alongside the compiled SPA.
 * `app` above has no such prefix (its routes are bare, e.g. `/me`,
 * `/realtime/connect`), which was invisible all migration long because every
 * test hit the Worker directly. Mounting the whole app under /api here is
 * the one place that needs to know about that prefix — everything else
 * (route files, the Durable Object, lib/realtime.ts's internal DO calls)
 * stays unprefixed and unaware of it. The realtime WS upgrade path in
 * particular is unaffected: the DO dispatches on the Upgrade header, not the
 * request path (see durable-objects/realtime-hub.ts's fetch()).
 */
const root = new Hono<{ Bindings: Bindings; Variables: Variables }>();
root.route("/api", app);

export default root;
