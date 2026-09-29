import { Hono } from "hono";
import crypto, { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import type { Bindings, QueryExecutor } from "../lib/db";
import { openDb } from "../lib/db";
import { attachCurrentUser, requireAuth, requirePerm, logAudit, type Variables } from "../lib/rbac";
import {
  sendEmail,
  renderInviteEmail,
  renderVerifyEmail,
  renderAccountActivatedEmail,
  renderAccountSuspendedEmail,
  renderAccountDeactivatedEmail,
  type EmailDeliveryStatus,
} from "../lib/mailer";
import { VALID_SECTOR_SET } from "../lib/sectors";
import { validatePassword } from "../lib/password";
import { assertActiveState } from "../lib/state-master";
import { revokeAllSessionsForUser } from "../lib/session";
import { isUserOnline, publishSupportingEvent, publishAuthorizationChanged, disconnectUser } from "../lib/realtime";

/**
 * Ported from artifacts/api-server/src/routes/users.ts.
 *
 * realtime.publishSupportingEvent / publishAuthorizationChanged /
 * disconnectUser / isUserOnline are now wired (Durable Objects phase, see
 * lib/realtime.ts). disconnectUser's effect was never security-critical here
 * (attachCurrentUser already re-checks status='active' from Postgres on
 * every single request, so a status change already takes effect on that
 * user's very next request regardless) — wiring it now is purely about
 * immediate UX (kick a live session now, don't wait for its next request).
 * revokeAllSessionsForUser (the reset-password path) does the real
 * security-relevant revocation at the DB session level, unchanged.
 *
 * GET /users/:id/effective-access is deferred: lib/effectiveAccess.ts (495
 * lines) exists solely for that one admin diagnostic endpoint and adds
 * nothing to core CRUD correctness.
 *
 * req.log's step-by-step debug logging (POST /users) is dropped rather than
 * ported to a Workers-appropriate logger — a later, dedicated pass across
 * every route should decide that once, not route by route.
 */

export const VALID_ROLES = new Set([
  "super_admin",
  "executive_director",
  "program_manager",
  "senior_program_coordinator",
  "technical_coordinator",
  "state_office_manager",
  "state_program_officer",
  "viewer",
]);
export const VALID_STATUSES = new Set(["active", "invited", "suspended", "inactive", "deactivated"]);
export const STATE_ROLES = new Set(["state_office_manager", "state_program_officer"]);

function normalizeSector(input: unknown): { value: string | null } | { error: string } {
  if (input === null || input === undefined || input === "") return { value: null };
  const list = Array.isArray(input)
    ? input.map((s) => String(s).trim()).filter(Boolean)
    : String(input).split(",").map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) return { value: null };
  for (const s of list) {
    if (!VALID_SECTOR_SET.has(s)) return { error: `invalid_sector:${s}` };
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of list) if (!seen.has(s)) { seen.add(s); out.push(s); }
  return { value: out.join(",") };
}

export const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  executive_director: "Executive Director",
  program_manager: "Program Manager",
  senior_program_coordinator: "Senior Program Coordinator",
  technical_coordinator: "Technical Coordinator",
  state_office_manager: "State Office Manager",
  state_program_officer: "State Program Officer",
};

export function deriveRoleLabel(role: string, stateName: string | null, sector: string | null): string {
  const base = ROLE_LABELS[role] ?? role;
  if (STATE_ROLES.has(role) && stateName) return `${base} — ${stateName}`;
  if (role === "technical_coordinator" && sector) return `${base} (${sector})`;
  return base;
}

export function scopeForRole(role: string): "hq" | "state" {
  return STATE_ROLES.has(role) ? "state" : "hq";
}

function parseUserId(idParam: string): number | null {
  const id = Number(idParam);
  return Number.isSafeInteger(id) && id >= 1 ? id : null;
}

function boundedInteger(raw: string | undefined, fallback: number, min: number, max: number): number | null {
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
}

function auditUserSnapshot(user: Record<string, unknown>, stateName: string | null) {
  return {
    name: user.name,
    email: user.email,
    username: user.username ?? null,
    role: user.role,
    scope: user.scope,
    state: stateName,
    sector: user.sector ?? null,
    status: user.status,
  };
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

const USER_COLS = `
  u.id, u.name, u.username, u.email, u.phone, u.role, u.role_label AS "roleLabel",
  u.scope, u.state_id AS "stateId", s.name AS "stateName", s.name_ar AS "stateNameAr", u.sector,
  u.status, u.language_preference AS "languagePreference",
  u.office_location AS "officeLocation",
  u.last_login_at AS "lastLoginAt", u.last_seen_at AS "lastSeenAt",
  u.created_at AS "createdAt", u.updated_at AS "updatedAt",
  (u.invite_token IS NOT NULL) AS "hasInvite",
  u.email_verified AS "emailVerified", u.email_verified_at AS "emailVerifiedAt"
`;

interface UserListRow extends Record<string, unknown> {
  id: number;
  name: string;
  username: string | null;
  email: string;
  phone: string | null;
  role: string;
  roleLabel: string;
  scope: string;
  stateId: number | null;
  stateName: string | null;
  stateNameAr: string | null;
  sector: string | null;
  status: string;
  languagePreference: string;
  officeLocation: string | null;
  lastLoginAt: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
  hasInvite: boolean;
  emailVerified: boolean;
  emailVerifiedAt: string | null;
}

async function withPresence<T extends { id: number; lastSeenAt?: Date | string | null }>(
  env: Bindings,
  user: T,
): Promise<T & { isOnline: boolean; lastSeenAt: Date | string | null }> {
  return {
    ...user,
    isOnline: await isUserOnline(env, user.id),
    lastSeenAt: user.lastSeenAt ?? null,
  };
}

/** Publishes the user-directory refetch hint, plus an authorization-changed
 *  signal when the change affects what the user themselves can see/do. */
async function publishUserDirectoryChange(
  env: Bindings, userId: number, action: string, authorizationChanged = false,
): Promise<void> {
  await publishSupportingEvent(env, { entityType: "user", entityId: userId, action });
  if (authorizationChanged) await publishAuthorizationChanged(env, userId);
}

async function dispatchInviteEmail(
  env: Bindings,
  db: QueryExecutor,
  opts: {
    name: string; email: string; roleLabel: string; stateName: string | null; sector: string | null;
    token: string; expiresAt: Date; userId?: number | null; message?: string | null;
  },
): Promise<{ delivered: boolean; status: EmailDeliveryStatus }> {
  const rendered = renderInviteEmail(env, opts);
  const result = await sendEmail(env, db, {
    to: opts.email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    kind: "user.invite",
    userId: opts.userId ?? null,
    meta: { roleLabel: opts.roleLabel, stateName: opts.stateName, sector: opts.sector, expiresAt: opts.expiresAt.toISOString() },
  });
  return { delivered: result.delivered, status: result.status };
}

interface UserRow extends Record<string, unknown> {
  id: number;
  name: string;
  email: string;
  username: string | null;
  role: string;
  status: string;
  state_id: number | null;
  sector: string | null;
  scope: string;
  invite_token: string | null;
  invite_expires_at: string | null;
  invite_accepted_at: string | null;
  invite_email_status: string | null;
  invited_by_id: number | null;
  password_hash: string | null;
}

export const usersRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

usersRoutes.use("/users/*", attachCurrentUser, requireAuth);

// FOR-MESSAGING ----------------------------------------------------------
usersRoutes.get("/users/for-messaging", async (c) => {
  const me = c.get("currentUser")!;
  const search = (c.req.query("search") ?? "").trim();
  const limit = Math.min(parseInt(c.req.query("limit") ?? "30", 10) || 30, 100);

  const { db, close } = openDb(c);
  try {
    const params: unknown[] = [me.id];
    let searchClause = "";
    if (search) {
      params.push(`%${search}%`);
      const sp = params.length;
      searchClause = `AND (u.name ILIKE $${sp} OR u.email ILIKE $${sp} OR u.username ILIKE $${sp})`;
    }
    params.push(limit);
    const limitPlaceholder = `$${params.length}`;

    const { rows } = await db.query(
      `SELECT u.id, u.name, u.email, u.role, u.role_label AS "roleLabel",
              u.scope, u.state_id AS "stateId", s.name AS "stateName", s.name_ar AS "stateNameAr", u.sector
       FROM users u
       LEFT JOIN states s ON s.id = u.state_id
       WHERE u.id != $1
         AND u.status = 'active'
         ${searchClause}
       ORDER BY u.name ASC
       LIMIT ${limitPlaceholder}`,
      params,
    );
    return c.json(rows);
  } finally {
    close();
  }
});

// LIST -------------------------------------------------------------------
usersRoutes.get("/users", requirePerm("users.view"), async (c) => {
  const q = c.req.query("q");
  const role = c.req.query("role");
  const status = c.req.query("status");
  const stateIdRaw = c.req.query("stateId");
  const sector = c.req.query("sector");
  // Max raised 100 -> 500 for the System Activity Presence tab, which
  // deliberately fetches every user in one page (limit: 200) rather than
  // paginating — 100 rejected that request outright (400), not a partial
  // page. The main Users Management screen still pages at 25, unaffected.
  const limit = boundedInteger(c.req.query("limit"), 25, 1, 500);
  const offset = boundedInteger(c.req.query("offset"), 0, 0, 100_000);
  if (limit === null || offset === null) return c.json({ error: "invalid_pagination" }, 400);
  if (role && !VALID_ROLES.has(role)) return c.json({ error: "invalid_role_filter" }, 400);
  if (status && !VALID_STATUSES.has(status)) return c.json({ error: "invalid_status_filter" }, 400);
  if (sector && !VALID_SECTOR_SET.has(sector)) return c.json({ error: "invalid_sector_filter" }, 400);
  const parsedStateId = stateIdRaw === undefined || stateIdRaw === ""
    ? null
    : boundedInteger(stateIdRaw, 0, 1, 2_147_483_647);
  if (parsedStateId === null && stateIdRaw !== undefined && stateIdRaw !== "") {
    return c.json({ error: "invalid_state_filter" }, 400);
  }

  const { db, close } = openDb(c);
  try {
    const where: string[] = [];
    const params: unknown[] = [];

    if (q && q.trim()) {
      params.push(`%${q.trim().toLowerCase()}%`);
      where.push(`(LOWER(u.name) LIKE $${params.length} OR LOWER(u.email) LIKE $${params.length} OR LOWER(COALESCE(u.username,'')) LIKE $${params.length})`);
    }
    if (role) { params.push(role); where.push(`u.role = $${params.length}`); }
    if (status) { params.push(status); where.push(`u.status = $${params.length}`); }
    if (parsedStateId !== null) { params.push(parsedStateId); where.push(`u.state_id = $${params.length}`); }
    if (sector) {
      params.push(sector);
      where.push(`(',' || COALESCE(u.sector, '') || ',') LIKE ('%,' || $${params.length} || ',%')`);
    }

    const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";
    const count = await db.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM users u ${whereSql}`,
      params,
    );
    const pageParams = [...params, limit, offset];
    const sql = `
      SELECT ${USER_COLS}
      FROM users u
      LEFT JOIN states s ON s.id = u.state_id
      ${whereSql}
      ORDER BY LOWER(u.name) ASC, u.id ASC
      LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}
    `;
    const { rows } = await db.query<UserListRow>(sql, pageParams);
    const total = count.rows[0]?.total ?? 0;
    return c.json({
      items: await Promise.all(rows.map((row) => withPresence(c.env, row))),
      total,
      limit,
      offset,
      hasMore: offset + rows.length < total,
      nextOffset: offset + rows.length < total ? offset + rows.length : null,
    });
  } finally {
    close();
  }
});

// SUMMARY (for dashboard cards) -------------------------------------------
usersRoutes.get("/users/summary", requirePerm("users.view"), async (c) => {
  const { db, close } = openDb(c);
  try {
    const total = await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM users`);
    const byStatus = await db.query<{ status: string; n: number }>(`SELECT status, COUNT(*)::int AS n FROM users GROUP BY status`);
    const byRole = await db.query<{ role: string; n: number }>(`SELECT role, COUNT(*)::int AS n FROM users GROUP BY role ORDER BY role`);
    const byState = await db.query(`
      SELECT s.id AS "stateId", s.name AS "stateName", s.name_ar AS "stateNameAr", COUNT(u.id)::int AS n
      FROM states s LEFT JOIN users u ON u.state_id = s.id
      GROUP BY s.id, s.name, s.name_ar HAVING COUNT(u.id) > 0 ORDER BY s.name
    `);
    return c.json({
      total: total.rows[0].n,
      byStatus: byStatus.rows,
      byRole: byRole.rows.map((r) => ({ role: r.role, label: ROLE_LABELS[r.role] ?? r.role, n: r.n })),
      byState: byState.rows,
    });
  } finally {
    close();
  }
});

// GET /users/invitations ---------------------------------------------------
usersRoutes.get("/users/invitations", requirePerm("users.manage"), async (c) => {
  const search = c.req.query("search");
  const status = c.req.query("status");
  const role = c.req.query("role");
  const stateId = c.req.query("stateId");
  const emailDelivery = c.req.query("emailDelivery");
  const limit = boundedInteger(c.req.query("limit"), 25, 1, 100);
  const offset = boundedInteger(c.req.query("offset"), 0, 0, 100_000);
  if (limit === null || offset === null) return c.json({ error: "invalid_pagination" }, 400);
  if (role && role !== "all" && !VALID_ROLES.has(role)) return c.json({ error: "invalid_role_filter" }, 400);
  if (status && status !== "all" && !["pending", "expired", "accepted", "cancelled"].includes(status)) {
    return c.json({ error: "invalid_invitation_status_filter" }, 400);
  }
  if (emailDelivery && emailDelivery !== "all" && !["pending", "sent", "failed"].includes(emailDelivery)) {
    return c.json({ error: "invalid_email_delivery_filter" }, 400);
  }
  if (stateId && stateId !== "all" && boundedInteger(stateId, 0, 1, 2_147_483_647) === null) {
    return c.json({ error: "invalid_state_filter" }, 400);
  }

  const { db, close } = openDb(c);
  try {
    const params: unknown[] = [];
    const where: string[] = [
      "(u.status = 'invited' OR u.invite_accepted_at IS NOT NULL OR (u.status = 'deactivated' AND u.invited_by_id IS NOT NULL))",
    ];

    if (search) {
      params.push(`%${search}%`);
      where.push(`(LOWER(u.name) LIKE LOWER($${params.length}) OR LOWER(u.email) LIKE LOWER($${params.length}))`);
    }
    if (role && role !== "all") { params.push(role); where.push(`u.role = $${params.length}`); }
    if (stateId && stateId !== "all") { params.push(Number(stateId)); where.push(`u.state_id = $${params.length}`); }
    if (emailDelivery && emailDelivery !== "all") { params.push(emailDelivery); where.push(`u.invite_email_status = $${params.length}`); }

    if (status && status !== "all") {
      if (status === "pending") {
        where.push(`(u.status = 'invited' AND (u.invite_expires_at IS NULL OR u.invite_expires_at > NOW()))`);
      } else if (status === "expired") {
        where.push(`(u.status = 'invited' AND u.invite_expires_at IS NOT NULL AND u.invite_expires_at <= NOW())`);
      } else if (status === "accepted") {
        where.push(`u.invite_accepted_at IS NOT NULL`);
      } else if (status === "cancelled") {
        where.push(`(u.status = 'deactivated' AND u.invited_by_id IS NOT NULL)`);
      }
    }

    const whereClause = `WHERE ${where.join(" AND ")}`;
    const summaryParams = [...params];
    params.push(limit, offset);
    const lIdx = params.length - 1;
    const oIdx = params.length;

    const { rows } = await db.query(
      `SELECT u.id, u.name, u.email, u.role, u.role_label AS "roleLabel",
              u.status, u.invite_expires_at AS "inviteExpiresAt",
               u.invite_email_status AS "inviteEmailStatus",
              u.invite_accepted_at AS "inviteAcceptedAt",
              u.created_at AS "invitedAt",
              s.name AS "stateName", s.name_ar AS "stateNameAr", u.sector,
              ib.name AS "invitedByName"
       FROM users u
       LEFT JOIN states s ON s.id = u.state_id
       LEFT JOIN users ib ON ib.id = u.invited_by_id
       ${whereClause}
       ORDER BY u.created_at DESC
       LIMIT $${lIdx} OFFSET $${oIdx}`,
      params,
    );

    const summaryRes = await db.query<{
      total: number; pending: number; accepted: number; expired: number; cancelled: number;
    }>(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (
           WHERE u.invite_accepted_at IS NULL
             AND u.status = 'invited'
             AND (u.invite_expires_at IS NULL OR u.invite_expires_at > NOW())
         )::int AS pending,
         COUNT(*) FILTER (WHERE u.invite_accepted_at IS NOT NULL)::int AS accepted,
         COUNT(*) FILTER (
           WHERE u.invite_accepted_at IS NULL
             AND u.status = 'invited'
             AND u.invite_expires_at IS NOT NULL
             AND u.invite_expires_at <= NOW()
         )::int AS expired,
         COUNT(*) FILTER (
           WHERE u.invite_accepted_at IS NULL
             AND u.status = 'deactivated'
             AND u.invited_by_id IS NOT NULL
         )::int AS cancelled
       FROM users u
       LEFT JOIN states s ON s.id = u.state_id
       ${whereClause}`,
      summaryParams,
    );

    const summary = summaryRes.rows[0] ?? { total: 0, pending: 0, accepted: 0, expired: 0, cancelled: 0 };
    const total = summary.total ?? 0;
    const hasMore = offset + rows.length < total;
    return c.json({
      invitations: rows,
      total,
      summary,
      limit,
      offset,
      hasMore,
      nextOffset: hasMore ? offset + rows.length : null,
    });
  } finally {
    close();
  }
});

// GET by id -----------------------------------------------------------------
usersRoutes.get("/users/:id", requirePerm("users.view"), async (c) => {
  const id = parseUserId(c.req.param("id"));
  if (id === null) return c.json({ error: "invalid_user_id" }, 400);

  const { db, close } = openDb(c);
  try {
    const { rows } = await db.query<UserListRow>(
      `SELECT ${USER_COLS} FROM users u LEFT JOIN states s ON s.id = u.state_id WHERE u.id = $1`,
      [id],
    );
    if (!rows[0]) return c.json({ error: "not_found" }, 404);
    return c.json(await withPresence(c.env, rows[0]));
  } finally {
    close();
  }
});

// CREATE ----------------------------------------------------------------
usersRoutes.post("/users", requirePerm("users.manage"), async (c) => {
  const actor = c.get("currentUser")!;
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const name = String((body as any).name ?? "").trim();
  const email = String((body as any).email ?? "").trim().toLowerCase();
  const username = String((body as any).username ?? email.split("@")[0].replace(/[^a-z0-9._-]/gi, "")).trim().toLowerCase();
  const phone = (body as any).phone ? String((body as any).phone).trim() : null;
  const role = String((body as any).role ?? "");
  let stateId = (body as any).stateId === null || (body as any).stateId === undefined || (body as any).stateId === "" ? null : Number((body as any).stateId);
  const language = (body as any).languagePreference === "ar" ? "ar" : "en";
  const status = (body as any).status === undefined ? "invited" : String((body as any).status);
  const sendInvite = status === "invited" || !(body as any).password;
  const password = String((body as any).password ?? "");
  const inviteExpiresInDays = (body as any).inviteExpiresInDays ? Math.max(1, Math.min(90, Number((body as any).inviteExpiresInDays))) : 7;
  const inviteMessage = (body as any).inviteMessage ? String((body as any).inviteMessage).trim().slice(0, 500) : null;

  const sectorParsed = normalizeSector((body as any).sector);
  if ("error" in sectorParsed) {
    return c.json({ error: sectorParsed.error, step: "validation", detail: `Invalid sector: "${(body as any).sector}"` }, 400);
  }
  let sector = sectorParsed.value;

  if (!name || !email || !username) {
    return c.json({ error: "name_username_email_required", step: "validation", detail: "Name, username and email are all required" }, 400);
  }
  if (!isValidEmail(email)) return c.json({ error: "invalid_email", step: "validation" }, 400);
  if (!VALID_STATUSES.has(status)) return c.json({ error: "invalid_status", step: "validation" }, 400);
  if (stateId !== null && (!Number.isSafeInteger(stateId) || stateId < 1)) {
    return c.json({ error: "invalid_state", step: "state_validation" }, 400);
  }

  if (!VALID_ROLES.has(role)) {
    return c.json({ error: "invalid_role", step: "role_validation", detail: `"${role}" is not a recognised role` }, 400);
  }

  if (STATE_ROLES.has(role) && !stateId) {
    return c.json({ error: "state_required_for_state_role", step: "state_validation", detail: `Role "${role}" requires an assigned state` }, 400);
  }
  if (role === "technical_coordinator" && !sector) {
    return c.json({ error: "sector_required_for_technical_coordinator", step: "state_validation", detail: "Technical Coordinator must be assigned a sector" }, 400);
  }
  if (!STATE_ROLES.has(role)) stateId = null;
  if (role !== "technical_coordinator") sector = null;

  const { db, close } = openDb(c);
  try {
    const dupe = await db.query<{ id: number; email: string; username: string; status: string; invite_expires_at: string | null }>(
      `SELECT id, email, COALESCE(username,'') AS username, status,
              invite_expires_at
       FROM users
       WHERE LOWER(email) = $1 OR LOWER(COALESCE(username,'')) = $2
       LIMIT 1`,
      [email, username],
    );
    if (dupe.rows[0]) {
      const dupeRow = dupe.rows[0];
      const onEmail = dupeRow.email?.toLowerCase() === email;
      if (onEmail && sendInvite && dupeRow.status === "invited") {
        const stillActive = !dupeRow.invite_expires_at || new Date(dupeRow.invite_expires_at) > new Date();
        if (stillActive) {
          return c.json({
            error: "duplicate_active_invitation",
            step: "uniqueness_check",
            detail: `An active invitation is already pending for "${email}". Cancel or resend the existing one.`,
          }, 409);
        }
      }
      return c.json({
        error: onEmail ? "email_already_exists" : "username_already_exists",
        step: "uniqueness_check",
        detail: onEmail ? `Email "${email}" is already registered to another account` : `Username "${username}" is already taken`,
      }, 409);
    }

    const activeState = stateId ? await assertActiveState(db, stateId) : null;
    const stateName = activeState?.ok ? activeState.state.name : null;
    if (stateId && !stateName) {
      const stateError = activeState && !activeState.ok ? activeState.error : "invalid_state";
      return c.json({
        error: stateError,
        step: "state_validation",
        detail: stateError === "inactive_state" ? `State ID ${stateId} is inactive` : `State ID ${stateId} does not exist`,
      }, 400);
    }

    const roleLabel = deriveRoleLabel(role, stateName, sector);
    const scope = scopeForRole(role);

    let passwordHash: string | null = null;
    let inviteToken: string | null = null;
    let inviteExpiresAt: Date | null = null;
    if (sendInvite) {
      inviteToken = Buffer.from(randomBytes(24)).toString("hex");
      inviteExpiresAt = new Date(Date.now() + inviteExpiresInDays * 24 * 60 * 60 * 1000);
    } else {
      const pw = validatePassword(password);
      if (!pw.ok) {
        return c.json({ error: pw.error, step: "validation", detail: "Password does not meet the minimum requirements" }, 400);
      }
      passwordHash = await bcrypt.hash(password, 12);
    }

    let id: number;
    try {
      const { rows } = await db.query<{ id: number }>(
        `INSERT INTO users (name, email, username, phone, password_hash, role, role_label, scope, state_id, sector, status, language_preference, invite_token, invite_expires_at, invited_by_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING id`,
        [name, email, username, phone, passwordHash, role, roleLabel, scope, stateId, sector, sendInvite ? "invited" : status, language, inviteToken, inviteExpiresAt, actor.id],
      );
      id = rows[0].id;
    } catch (dbErr) {
      const pg = dbErr as { code?: string; constraint?: string; detail?: string; message?: string };
      if (pg.code === "23505") {
        const onEmail = pg.constraint?.includes("email") || pg.detail?.includes("email");
        return c.json({
          error: onEmail ? "email_already_exists" : "username_already_exists",
          step: "user_record",
          detail: pg.detail ?? "Unique constraint violation on user record",
        }, 409);
      } else if (pg.code === "23503") {
        return c.json({ error: "foreign_key_violation", step: "user_record", detail: pg.detail ?? "Foreign key constraint violated (invalid state or reference)" }, 400);
      } else if (pg.code === "23502") {
        return c.json({ error: "required_field_null", step: "user_record", detail: pg.detail ?? "A required database field was null" }, 400);
      }
      return c.json({ error: "db_error", step: "user_record", detail: pg.message ?? "Unexpected database error while creating user record" }, 500);
    }

    await logAudit(db, {
      userId: actor.id,
      action: "create",
      module: "users",
      entityId: id,
      newValue: JSON.stringify({ name, email, username, role, state: stateName, status: sendInvite ? "invited" : status }),
    });

    const out = await db.query(
      `SELECT ${USER_COLS} FROM users u LEFT JOIN states s ON s.id = u.state_id WHERE u.id = $1`,
      [id],
    );

    let inviteEmailStatus: EmailDeliveryStatus = "pending";
    if (sendInvite && inviteToken && inviteExpiresAt) {
      try {
        const { status: deliveryStatus } = await dispatchInviteEmail(c.env, db, {
          name, email, roleLabel, stateName, sector,
          token: inviteToken, expiresAt: inviteExpiresAt, userId: id,
          message: inviteMessage,
        });
        inviteEmailStatus = deliveryStatus;
        await db.query(`UPDATE users SET invite_email_status = $1 WHERE id = $2`, [inviteEmailStatus, id]);
      } catch {
        inviteEmailStatus = "failed";
        await db.query(`UPDATE users SET invite_email_status = 'failed' WHERE id = $1`, [id]);
      }
    }

    await publishUserDirectoryChange(c.env, id, "created");
    return c.json({
      user: out.rows[0],
      inviteToken,
      emailDelivered: inviteEmailStatus === "sent",
      emailDelivery: inviteEmailStatus,
      steps: {
        validation: true,
        role_validation: true,
        state_validation: true,
        uniqueness_check: true,
        user_record: true,
        audit_log: true,
        invite_email: sendInvite,
      },
    }, 201);
  } finally {
    close();
  }
});

// RESEND INVITE ---------------------------------------------------------
usersRoutes.post("/users/:id/resend-invite", requirePerm("users.manage"), async (c) => {
  const actor = c.get("currentUser")!;
  const id = parseUserId(c.req.param("id"));
  if (id === null) return c.json({ error: "invalid_user_id" }, 400);
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);

  const { db, close } = openDb(c);
  try {
    const u = (await db.query<UserRow & { roleLabel: string; stateName: string | null; hadPassword: boolean }>(
      `SELECT u.id, u.name, u.email, u.role_label AS "roleLabel", u.sector, u.status,
              u.invite_expires_at AS "inviteExpiresAt", u.invite_accepted_at AS "inviteAcceptedAt",
              u.invite_email_status AS "inviteEmailStatus",
              u.invited_by_id AS "invitedById",
              (u.password_hash IS NOT NULL) AS "hadPassword", s.name AS "stateName"
       FROM users u LEFT JOIN states s ON s.id = u.state_id WHERE u.id = $1`,
      [id],
    )).rows[0] as any;
    if (!u) return c.json({ error: "not_found" }, 404);
    if (u.inviteAcceptedAt) return c.json({ error: "invite_already_accepted" }, 409);
    if (u.status !== "invited" && !(u.status === "deactivated" && u.invitedById !== null)) {
      return c.json({ error: "user_not_invited" }, 400);
    }
    const expiresInDays = (body as any).expiresInDays ? Math.max(1, Math.min(90, Number((body as any).expiresInDays))) : 7;
    const message = (body as any).message ? String((body as any).message).trim().slice(0, 500) : null;
    const token = Buffer.from(randomBytes(24)).toString("hex");
    const expires = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
    await db.query(
      `UPDATE users SET invite_token = $1, invite_expires_at = $2, status = 'invited', invite_email_status = 'pending', password_hash = NULL, updated_at = NOW() WHERE id = $3`,
      [token, expires, id],
    );
    let delivered = false;
    let emailDelivery: EmailDeliveryStatus = "pending";
    try {
      const result = await dispatchInviteEmail(c.env, db, {
        name: u.name, email: u.email, roleLabel: u.roleLabel,
        stateName: u.stateName ?? null, sector: u.sector ?? null,
        token, expiresAt: expires, userId: u.id, message,
      });
      delivered = result.delivered;
      emailDelivery = result.status;
      await db.query(`UPDATE users SET invite_email_status = $1 WHERE id = $2`, [emailDelivery, id]);
    } catch {
      emailDelivery = "failed";
      await db.query(`UPDATE users SET invite_email_status = 'failed' WHERE id = $1`, [id]);
    }
    await logAudit(db, {
      userId: actor.id,
      action: "invite_resend",
      module: "users",
      entityId: id,
      oldValue: JSON.stringify({
        status: u.status,
        inviteExpiresAt: u.inviteExpiresAt ?? null,
        inviteEmailStatus: u.inviteEmailStatus ?? null,
        passwordConfigured: Boolean(u.hadPassword),
      }),
      newValue: JSON.stringify({
        status: "invited",
        inviteExpiresAt: expires.toISOString(),
        inviteEmailStatus: emailDelivery,
        passwordConfigured: false,
      }),
    });
    await publishUserDirectoryChange(c.env, id, "invite_changed");
    return c.json({ ok: true, inviteToken: token, expiresAt: expires.toISOString(), emailDelivered: delivered, emailDelivery });
  } finally {
    close();
  }
});

// CANCEL INVITE ---------------------------------------------------------
usersRoutes.post("/users/:id/cancel-invite", requirePerm("users.manage"), async (c) => {
  const actor = c.get("currentUser")!;
  const id = parseUserId(c.req.param("id"));
  if (id === null) return c.json({ error: "invalid_user_id" }, 400);

  const { db, close } = openDb(c);
  try {
    const u = (await db.query<{ id: number; status: string; inviteExpiresAt: string | null; inviteEmailStatus: string | null }>(
      `SELECT id, status, invite_expires_at AS "inviteExpiresAt", invite_email_status AS "inviteEmailStatus"
       FROM users WHERE id = $1`,
      [id],
    )).rows[0];
    if (!u) return c.json({ error: "not_found" }, 404);
    if (u.status !== "invited") return c.json({ error: "user_not_invited" }, 400);
    await db.query(
      `UPDATE users SET invite_token = NULL, invite_expires_at = NULL, status = 'deactivated', updated_at = NOW() WHERE id = $1`,
      [id],
    );
    await logAudit(db, {
      userId: actor.id,
      action: "invite_cancel",
      module: "users",
      entityId: id,
      oldValue: JSON.stringify({ status: u.status, inviteExpiresAt: u.inviteExpiresAt ?? null, inviteEmailStatus: u.inviteEmailStatus ?? null }),
      newValue: JSON.stringify({ status: "deactivated", inviteExpiresAt: null, inviteEmailStatus: u.inviteEmailStatus ?? null }),
    });
    await publishUserDirectoryChange(c.env, id, "invite_changed", true);
    return c.json({ ok: true });
  } finally {
    close();
  }
});

// RESEND VERIFICATION ---------------------------------------------------
usersRoutes.post("/users/:id/resend-verification", requirePerm("users.manage"), async (c) => {
  const actor = c.get("currentUser")!;
  const id = parseUserId(c.req.param("id"));
  if (id === null) return c.json({ error: "invalid_user_id" }, 400);

  const { db, close } = openDb(c);
  try {
    const { rows } = await db.query<{ id: number; name: string; email: string; emailVerified: boolean; status: string }>(
      `SELECT id, name, email, email_verified AS "emailVerified", status FROM users WHERE id = $1`,
      [id],
    );
    const u = rows[0];
    if (!u) return c.json({ error: "not_found" }, 404);
    if (u.emailVerified) return c.json({ error: "already_verified" }, 400);

    const plainToken = Buffer.from(crypto.randomBytes(32)).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(plainToken).digest("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await db.query(`UPDATE email_verification_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL`, [id]);
    await db.query(
      `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at, ip_address) VALUES ($1, $2, $3, $4)`,
      [id, tokenHash, expiresAt.toISOString(), c.req.header("CF-Connecting-IP") ?? null],
    );

    const { html, text, subject } = renderVerifyEmail(c.env, { name: u.name, email: u.email, token: plainToken, expiresAt });
    const { delivered } = await sendEmail(c.env, db, { to: u.email, subject, html, text, kind: "email_verification", userId: id });
    await logAudit(db, { userId: actor.id, action: "verification_email_resent", module: "users", entityId: id });

    return c.json({ ok: true, delivered });
  } finally {
    close();
  }
});

// UPDATE ----------------------------------------------------------------
usersRoutes.patch("/users/:id", requirePerm("users.manage"), async (c) => {
  const actor = c.get("currentUser")!;
  const id = parseUserId(c.req.param("id"));
  if (id === null) return c.json({ error: "invalid_user_id" }, 400);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

  const { db, close } = openDb(c);
  try {
    const existing = (await db.query(`SELECT * FROM users WHERE id = $1`, [id])).rows[0] as any;
    if (!existing) return c.json({ error: "not_found" }, 404);

    const hasOwn = (key: string) => Object.prototype.hasOwnProperty.call(body, key);
    if (id === actor.id && ["role", "status", "stateId", "sector"].some(hasOwn)) {
      return c.json({ error: "cannot_modify_own_access" }, 400);
    }
    const next_: Record<string, unknown> = {};

    if (typeof body.name === "string") {
      if (!body.name.trim()) return c.json({ error: "name_required" }, 400);
      next_.name = body.name.trim();
    }
    if (typeof body.email === "string") {
      const email = body.email.trim().toLowerCase();
      if (!isValidEmail(email)) return c.json({ error: "invalid_email" }, 400);
      next_.email = email;
    }
    if (typeof body.username === "string") {
      const username = body.username.trim().toLowerCase();
      if (!username) return c.json({ error: "username_required" }, 400);
      next_.username = username;
    }
    if (body.phone !== undefined) next_.phone = body.phone ? String(body.phone).trim() : null;
    if (body.languagePreference === "en" || body.languagePreference === "ar") next_.language_preference = body.languagePreference;
    if (body.sector !== undefined) {
      const parsed = normalizeSector(body.sector);
      if ("error" in parsed) return c.json({ error: parsed.error }, 400);
      next_.sector = parsed.value;
    }

    if (typeof body.role === "string") {
      if (!VALID_ROLES.has(body.role)) return c.json({ error: "invalid_role" }, 400);
      next_.role = body.role;
      next_.scope = scopeForRole(body.role);
    }
    if (body.stateId !== undefined) {
      const stateId = body.stateId === null || body.stateId === "" ? null : Number(body.stateId);
      if (stateId !== null && (!Number.isSafeInteger(stateId) || stateId < 1)) return c.json({ error: "invalid_state" }, 400);
      next_.state_id = stateId;
    }
    if (body.officeLocation !== undefined) {
      next_.office_location = body.officeLocation ? String(body.officeLocation).trim() : null;
    }
    if (typeof body.status === "string") {
      if (!VALID_STATUSES.has(body.status)) return c.json({ error: "invalid_status" }, 400);
      next_.status = body.status;
    }

    const finalRole = (next_.role as string) ?? existing.role;
    let finalStateId = next_.state_id !== undefined ? next_.state_id : existing.state_id;
    if (STATE_ROLES.has(finalRole) && !finalStateId) return c.json({ error: "state_required_for_state_role" }, 400);
    if (!STATE_ROLES.has(finalRole)) {
      finalStateId = null;
      next_.state_id = null;
    }
    if (finalRole === "technical_coordinator") {
      const effective = next_.sector !== undefined ? (next_.sector as string | null) : existing.sector;
      const reparsed = normalizeSector(effective);
      if ("error" in reparsed) return c.json({ error: reparsed.error }, 400);
      if (!reparsed.value) return c.json({ error: "sector_required_for_technical_coordinator" }, 400);
      next_.sector = reparsed.value;
    } else {
      next_.sector = null;
    }

    const existingStateId = existing.state_id == null ? null : Number(existing.state_id);
    const stateAssignmentChanged = finalStateId !== existingStateId;
    const roleNewlyRequiresState =
      next_.role !== undefined &&
      finalRole !== existing.role &&
      STATE_ROLES.has(finalRole) &&
      !STATE_ROLES.has(existing.role);
    let validatedStateName: string | null = null;
    if (finalStateId && (stateAssignmentChanged || roleNewlyRequiresState)) {
      const activeState = await assertActiveState(db, Number(finalStateId));
      if (!activeState.ok) return c.json({ error: activeState.error }, 400);
      validatedStateName = activeState.state.name;
    }

    if (next_.role !== undefined || next_.state_id !== undefined || next_.sector !== undefined) {
      const finalSector = next_.sector !== undefined ? (next_.sector as string | null) : existing.sector;
      let stateName = validatedStateName;
      if (finalStateId && stateName === null) {
        const state = await db.query<{ name: string }>(`SELECT name FROM states WHERE id = $1`, [Number(finalStateId)]);
        stateName = state.rows[0]?.name ?? null;
      }
      next_.role_label = deriveRoleLabel(finalRole, stateName, finalSector);
    }

    if (next_.email && next_.email !== existing.email) {
      const dupe = await db.query(`SELECT id FROM users WHERE LOWER(email) = $1 AND id <> $2`, [next_.email, id]);
      if (dupe.rows[0]) return c.json({ error: "email_taken" }, 409);
    }
    if (next_.username && next_.username !== existing.username) {
      const dupe = await db.query(`SELECT id FROM users WHERE LOWER(COALESCE(username,'')) = $1 AND id <> $2`, [next_.username, id]);
      if (dupe.rows[0]) return c.json({ error: "username_taken" }, 409);
    }

    const keys = Object.keys(next_);
    if (keys.length === 0) return c.json({ ok: true, changed: 0 });

    const sets = keys.map((k, i) => `${k} = $${i + 2}`);
    sets.push(`updated_at = NOW()`);
    try {
      await db.query(`UPDATE users SET ${sets.join(", ")} WHERE id = $1`, [id, ...keys.map((k) => next_[k])]);
    } catch (dbErr) {
      const pg = dbErr as { code?: string; constraint?: string; detail?: string };
      if (pg.code === "23505") {
        const onEmail = pg.constraint?.includes("email") || pg.detail?.includes("email");
        return c.json({ error: onEmail ? "email_taken" : "username_taken" }, 409);
      }
      throw dbErr;
    }

    const stateIdsToName = [...new Set([existingStateId, finalStateId].filter((v): v is number => v != null))];
    const stateNameById = stateIdsToName.length
      ? new Map((await db.query<{ id: number; name: string }>(
          `SELECT id, name FROM states WHERE id = ANY($1::int[])`,
          [stateIdsToName],
        )).rows.map((r) => [r.id, r.name]))
      : new Map<number, string>();

    await logAudit(db, {
      userId: actor.id,
      action: "update",
      module: "users",
      entityId: id,
      oldValue: JSON.stringify(auditUserSnapshot(existing, existingStateId != null ? (stateNameById.get(existingStateId) ?? null) : null)),
      newValue: JSON.stringify(auditUserSnapshot({ ...existing, ...next_ }, finalStateId != null ? (stateNameById.get(Number(finalStateId)) ?? null) : null)),
    });

    // next_.sector (and often next_.state_id) is ALWAYS derived above
    // regardless of what this request actually touched (role→sector/state_id
    // reconciliation runs unconditionally), so checking mere key presence in
    // next_ made authorizationChanged true for every PATCH, even a plain name
    // or phone edit — forcing publishUserDirectoryChange's realtime broadcast
    // to treat it as a real permission change every time. Compare the final
    // derived value against what actually existed before instead.
    const authorizationChanged =
      (next_.role !== undefined && next_.role !== existing.role) ||
      (next_.scope !== undefined && next_.scope !== existing.scope) ||
      stateAssignmentChanged ||
      next_.sector !== existing.sector ||
      (next_.status !== undefined && next_.status !== existing.status);
    await publishUserDirectoryChange(
      c.env, id, next_.status !== undefined ? "status_changed" : "updated", authorizationChanged,
    );
    if (next_.status !== undefined && next_.status !== "active") await disconnectUser(c.env, id);

    const out = await db.query<UserListRow>(
      `SELECT ${USER_COLS} FROM users u LEFT JOIN states s ON s.id = u.state_id WHERE u.id = $1`,
      [id],
    );
    return c.json(await withPresence(c.env, out.rows[0]));
  } finally {
    close();
  }
});

// CHANGE STATUS ---------------------------------------------------------
usersRoutes.post("/users/:id/status", requirePerm("users.manage"), async (c) => {
  const actor = c.get("currentUser")!;
  const id = parseUserId(c.req.param("id"));
  if (id === null) return c.json({ error: "invalid_user_id" }, 400);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const status = String(body.status ?? "");
  if (!VALID_STATUSES.has(status)) return c.json({ error: "invalid_status" }, 400);
  if (id === actor.id && status !== "active") return c.json({ error: "cannot_change_own_status" }, 400);

  const { db, close } = openDb(c);
  try {
    const existing = (await db.query(`SELECT * FROM users WHERE id = $1`, [id])).rows[0] as any;
    if (!existing) return c.json({ error: "not_found" }, 404);
    await db.query(`UPDATE users SET status = $1, updated_at = NOW() WHERE id = $2`, [status, id]);
    await publishUserDirectoryChange(c.env, id, "status_changed", true);
    if (status !== "active") await disconnectUser(c.env, id);
    await logAudit(db, {
      userId: actor.id,
      action: "status_change",
      module: "users",
      entityId: id,
      oldValue: JSON.stringify(auditUserSnapshot(existing, null)),
      newValue: JSON.stringify(auditUserSnapshot({ ...existing, status }, null)),
    });

    try {
      const emailOpts = { name: existing.name as string, email: existing.email as string };
      if (status === "active" && existing.status !== "active") {
        const t = renderAccountActivatedEmail(c.env, emailOpts);
        await sendEmail(c.env, db, { to: emailOpts.email, subject: t.subject, html: t.html, text: t.text, kind: "account_activated", userId: id });
      } else if (status === "suspended") {
        const t = renderAccountSuspendedEmail(c.env, emailOpts);
        await sendEmail(c.env, db, { to: emailOpts.email, subject: t.subject, html: t.html, text: t.text, kind: "account_suspended", userId: id });
      } else if (status === "deactivated") {
        const t = renderAccountDeactivatedEmail(c.env, emailOpts);
        await sendEmail(c.env, db, { to: emailOpts.email, subject: t.subject, html: t.html, text: t.text, kind: "account_deactivated", userId: id });
      }
    } catch {
      // Non-fatal: status change already committed.
    }

    return c.json({ ok: true, status });
  } finally {
    close();
  }
});

// RESET PASSWORD --------------------------------------------------------
usersRoutes.post("/users/:id/reset-password", requirePerm("users.manage"), async (c) => {
  const actor = c.get("currentUser")!;
  const id = parseUserId(c.req.param("id"));
  if (id === null) return c.json({ error: "invalid_user_id" }, 400);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const newPassword = String(body.password ?? "");
  const sendInvite = Boolean(body.invite);
  if (id === actor.id && sendInvite) return c.json({ error: "cannot_change_own_status" }, 400);

  const { db, close } = openDb(c);
  try {
    const existing = (await db.query<{ id: number; email: string }>(`SELECT id, email FROM users WHERE id = $1`, [id])).rows[0];
    if (!existing) return c.json({ error: "not_found" }, 404);

    if (sendInvite) {
      const inviteToken = Buffer.from(randomBytes(24)).toString("hex");
      const inviteExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await db.query(
        `UPDATE users SET password_hash = NULL, invite_token = $1, invite_expires_at = $2, status = 'invited', updated_at = NOW() WHERE id = $3`,
        [inviteToken, inviteExpiresAt, id],
      );
      await revokeAllSessionsForUser(db, id);
      await publishUserDirectoryChange(c.env, id, "invite_changed", true);
      await disconnectUser(c.env, id);
      await logAudit(db, { userId: actor.id, action: "password_reset_invite", module: "users", entityId: id });
      return c.json({ ok: true, inviteToken });
    }

    const pwCheck = validatePassword(newPassword);
    if (!pwCheck.ok) return c.json({ error: pwCheck.error }, 400);
    const hash = await bcrypt.hash(newPassword, 12);
    await db.query(
      `UPDATE users SET password_hash = $1, invite_token = NULL, invite_expires_at = NULL, updated_at = NOW() WHERE id = $2`,
      [hash, id],
    );
    await revokeAllSessionsForUser(db, id);
    await disconnectUser(c.env, id);
    await logAudit(db, { userId: actor.id, action: "password_reset", module: "users", entityId: id });
    return c.json({ ok: true });
  } finally {
    close();
  }
});

// DELETE ----------------------------------------------------------------
usersRoutes.delete("/users/:id", requirePerm("users.manage"), async (c) => {
  const actor = c.get("currentUser")!;
  const id = parseUserId(c.req.param("id"));
  if (id === null) return c.json({ error: "invalid_user_id" }, 400);
  if (id === actor.id) return c.json({ error: "cannot_delete_self" }, 400);

  const { db, close } = openDb(c);
  try {
    const existing = (await db.query(`SELECT name, email, role FROM users WHERE id = $1`, [id])).rows[0];
    if (!existing) return c.json({ error: "not_found" }, 404);
    await db.query(`DELETE FROM users WHERE id = $1`, [id]);
    await logAudit(db, { userId: actor.id, action: "delete", module: "users", entityId: id, oldValue: JSON.stringify(existing) });
    await publishUserDirectoryChange(c.env, id, "deleted", true);
    await disconnectUser(c.env, id);
    return c.json({ ok: true });
  } finally {
    close();
  }
});
