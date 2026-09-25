import { Hono } from "hono";
import bcrypt from "bcryptjs";
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

export default app;
