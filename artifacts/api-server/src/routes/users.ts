import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { pool } from "@workspace/db";
import { logAudit, requirePerm } from "../middlewares/currentUser";
import {
  sendEmail,
  renderInviteEmail,
  renderAccountActivatedEmail,
  renderAccountSuspendedEmail,
  renderAccountDeactivatedEmail,
  type EmailDeliveryStatus,
} from "../lib/mailer";
import { VALID_SECTORS, VALID_SECTOR_SET } from "../lib/sectors";
export { VALID_SECTORS };
import { validatePassword } from "../lib/password";
import { resolveEffectiveAccess } from "../lib/effectiveAccess";
import { assertActiveState } from "../lib/state-master";
import { realtime } from "../lib/realtime";

async function dispatchInviteEmail(opts: {
  name: string; email: string; roleLabel: string; stateName: string | null; sector: string | null;
  token: string; expiresAt: Date; userId?: number | null; message?: string | null;
}): Promise<{ delivered: boolean; status: EmailDeliveryStatus }> {
  const rendered = renderInviteEmail(opts);
  const result = await sendEmail({
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

const router: IRouter = Router();

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


// Normalises an incoming sector value (string | string[] | null) to a
// comma-separated string for storage, or null. Returns { error } on bad input.
function normalizeSector(input: unknown): { value: string | null } | { error: string } {
  if (input === null || input === undefined || input === "") return { value: null };
  const list = Array.isArray(input)
    ? input.map((s) => String(s).trim()).filter(Boolean)
    : String(input).split(",").map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) return { value: null };
  for (const s of list) {
    if (!VALID_SECTOR_SET.has(s)) return { error: `invalid_sector:${s}` };
  }
  // Dedupe preserving order.
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

function requireValidUserId(req: Request, res: Response, next: NextFunction) {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) {
    res.status(400).json({ error: "invalid_user_id" });
    return;
  }
  res.locals.userId = id;
  next();
}

function boundedInteger(raw: unknown, fallback: number, min: number, max: number): number | null {
  if (raw === undefined || raw === "") return fallback;
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
}

function auditUserSnapshot(user: Record<string, unknown>) {
  return {
    name: user.name,
    email: user.email,
    username: user.username ?? null,
    role: user.role,
    scope: user.scope,
    stateId: user.state_id ?? user.stateId ?? null,
    sector: user.sector ?? null,
    status: user.status,
  };
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Note: invite_token is intentionally excluded from these column lists — it is a
// reusable account-setup secret and is only returned once, in the response body
// of the route that issued it (create-user or reset-password-with-invite).
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

function withPresence<T extends { id: number; lastSeenAt?: Date | string | null }>(
  user: T,
): T & { isOnline: boolean; lastSeenAt: Date | string | null } {
  return {
    ...user,
    isOnline: realtime.isUserOnline(user.id),
    lastSeenAt: user.lastSeenAt ?? null,
  };
}

async function publishUserDirectoryChange(
  userId: number,
  action: "created" | "updated" | "status_changed" | "deleted" | "invite_changed",
  authorizationChanged = false,
): Promise<void> {
  await realtime.publishSupportingEvent({
    entityType: "user",
    entityId: userId,
    action,
  });
  if (authorizationChanged) await realtime.publishAuthorizationChanged(userId);
}

// FOR-MESSAGING ----------------------------------------------------------
// Any authenticated user can fetch a minimal user list for messaging.
// Returns active users only, excludes the caller, supports ?search= and ?limit=
// Does NOT expose invite tokens, password hashes, or admin-only fields.
router.get("/users/for-messaging", async (req, res, next) => {
  try {
    const me = req.currentUser!;
    const search = String(req.query.search ?? "").trim();
    const limit = Math.min(parseInt(String(req.query.limit ?? "30"), 10), 100);

    const params: unknown[] = [me.id];
    let searchClause = "";
    if (search) {
      params.push(`%${search}%`);
      const sp = params.length;
      searchClause = `AND (u.name ILIKE $${sp} OR u.email ILIKE $${sp} OR u.username ILIKE $${sp})`;
    }
    params.push(limit);
    const limitPlaceholder = `$${params.length}`;

    const { rows } = await pool.query(
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
    res.json(rows);
  } catch (err) { next(err); }
});

// LIST -------------------------------------------------------------------
// The administration directory is deliberately paginated and server-filtered.
// `users.view` is a read capability; only `users.manage` can mutate accounts.
router.get("/users", requirePerm("users.view"), async (req, res, next) => {
  try {
    const { q, role, status, stateId, sector } = req.query;
    const limit = boundedInteger(req.query.limit, 25, 1, 100);
    const offset = boundedInteger(req.query.offset, 0, 0, 100_000);
    if (limit === null || offset === null) {
      res.status(400).json({ error: "invalid_pagination" });
      return;
    }
    if (typeof role === "string" && role && !VALID_ROLES.has(role)) {
      res.status(400).json({ error: "invalid_role_filter" });
      return;
    }
    if (typeof status === "string" && status && !VALID_STATUSES.has(status)) {
      res.status(400).json({ error: "invalid_status_filter" });
      return;
    }
    if (typeof sector === "string" && sector && !VALID_SECTOR_SET.has(sector)) {
      res.status(400).json({ error: "invalid_sector_filter" });
      return;
    }
    const parsedStateId = stateId === undefined || stateId === ""
      ? null
      : boundedInteger(stateId, 0, 1, 2_147_483_647);
    if (parsedStateId === null && stateId !== undefined && stateId !== "") {
      res.status(400).json({ error: "invalid_state_filter" });
      return;
    }
    const where: string[] = [];
    const params: unknown[] = [];

    if (typeof q === "string" && q.trim()) {
      params.push(`%${q.trim().toLowerCase()}%`);
      where.push(`(LOWER(u.name) LIKE $${params.length} OR LOWER(u.email) LIKE $${params.length} OR LOWER(COALESCE(u.username,'')) LIKE $${params.length})`);
    }
    if (typeof role === "string" && role) {
      params.push(role);
      where.push(`u.role = $${params.length}`);
    }
    if (typeof status === "string" && status) {
      params.push(status);
      where.push(`u.status = $${params.length}`);
    }
    if (parsedStateId !== null) {
      params.push(parsedStateId);
      where.push(`u.state_id = $${params.length}`);
    }
    if (typeof sector === "string" && sector) {
      params.push(sector);
      where.push(`(',' || COALESCE(u.sector, '') || ',') LIKE ('%,' || $${params.length} || ',%')`);
    }

    const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";
    const count = await pool.query(
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
    const { rows } = await pool.query(sql, pageParams);
    const total = count.rows[0]?.total ?? 0;
    res.json({
      items: rows.map(withPresence),
      total,
      limit,
      offset,
      hasMore: offset + rows.length < total,
      nextOffset: offset + rows.length < total ? offset + rows.length : null,
    });
  } catch (err) {
    next(err);
  }
});

// SUMMARY (for dashboard cards) -----------------------------------------
router.get("/users/summary", requirePerm("users.view"), async (_req, res, next) => {
  try {
    const total = await pool.query(`SELECT COUNT(*)::int AS n FROM users`);
    const byStatus = await pool.query(`SELECT status, COUNT(*)::int AS n FROM users GROUP BY status`);
    const byRole = await pool.query(`SELECT role, COUNT(*)::int AS n FROM users GROUP BY role ORDER BY role`);
    const byState = await pool.query(`
      SELECT s.id AS "stateId", s.name AS "stateName", s.name_ar AS "stateNameAr", COUNT(u.id)::int AS n
      FROM states s LEFT JOIN users u ON u.state_id = s.id
      GROUP BY s.id, s.name, s.name_ar HAVING COUNT(u.id) > 0 ORDER BY s.name
    `);
    res.json({
      total: total.rows[0].n,
      byStatus: byStatus.rows,
      byRole: byRole.rows.map((r) => ({ role: r.role, label: ROLE_LABELS[r.role] ?? r.role, n: r.n })),
      byState: byState.rows,
    });
  } catch (err) {
    next(err);
  }
});

// GET /users/invitations — list all invited users with invite status ----
// Super-admin only: invite tokens are time-limited credentials and must not
// be exposed to lower-privilege roles.
router.get("/users/invitations", requirePerm("users.manage"), async (req, res, next) => {
  try {
    const { search, status, role, stateId, emailDelivery } = req.query as Record<string, string>;
    const limit = boundedInteger(req.query.limit, 25, 1, 100);
    const offset = boundedInteger(req.query.offset, 0, 0, 100_000);
    if (limit === null || offset === null) {
      res.status(400).json({ error: "invalid_pagination" });
      return;
    }
    if (role && role !== "all" && !VALID_ROLES.has(role)) {
      res.status(400).json({ error: "invalid_role_filter" });
      return;
    }
    if (status && status !== "all" && !["pending", "expired", "accepted", "cancelled"].includes(status)) {
      res.status(400).json({ error: "invalid_invitation_status_filter" });
      return;
    }
    if (emailDelivery && emailDelivery !== "all" && !["pending", "sent", "failed"].includes(emailDelivery)) {
      res.status(400).json({ error: "invalid_email_delivery_filter" });
      return;
    }
    if (stateId && stateId !== "all" && boundedInteger(stateId, 0, 1, 2_147_483_647) === null) {
      res.status(400).json({ error: "invalid_state_filter" });
      return;
    }
    const params: unknown[] = [];
    // Base filter: include pending/expired (status=invited), accepted (invite_accepted_at set),
    // or cancelled (deactivated with invited_by_id set — i.e. was created via invite flow)
    const where: string[] = [
      "(u.status = 'invited' OR u.invite_accepted_at IS NOT NULL OR (u.status = 'deactivated' AND u.invited_by_id IS NOT NULL))",
    ];

    if (search) {
      params.push(`%${search}%`);
      where.push(`(LOWER(u.name) LIKE LOWER($${params.length}) OR LOWER(u.email) LIKE LOWER($${params.length}))`);
    }
    if (role && role !== "all") {
      params.push(role);
      where.push(`u.role = $${params.length}`);
    }
    if (stateId && stateId !== "all") {
      params.push(Number(stateId));
      where.push(`u.state_id = $${params.length}`);
    }
    if (emailDelivery && emailDelivery !== "all") {
      params.push(emailDelivery);
      where.push(`u.invite_email_status = $${params.length}`);
    }

    // Derive invite status for filter
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
    params.push(limit, offset);
    const lIdx = params.length - 1;
    const oIdx = params.length;

    const { rows } = await pool.query(
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

    // These totals deliberately reuse the exact authorised/filterable dataset as
    // the page query, before LIMIT/OFFSET is applied. Keep acceptance ahead of
    // cancellation to match the lifecycle shown in the client.
    const summaryRes = await pool.query(
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
      params.slice(0, params.length - 2),
    );

    const summary = summaryRes.rows[0] ?? {
      total: 0,
      pending: 0,
      accepted: 0,
      expired: 0,
      cancelled: 0,
    };
    const total = summary.total ?? 0;
    const hasMore = offset + rows.length < total;
    res.json({
      invitations: rows,
      total,
      summary: {
        total,
        pending: summary.pending ?? 0,
        accepted: summary.accepted ?? 0,
        expired: summary.expired ?? 0,
        cancelled: summary.cancelled ?? 0,
      },
      limit,
      offset,
      hasMore,
      nextOffset: hasMore ? offset + rows.length : null,
    });
  } catch (err) { next(err); }
});

// GET effective-access — read-only permission inspector (requires users.manage)
router.get("/users/:id/effective-access", requirePerm("users.manage"), requireValidUserId, async (req, res, next) => {
  try {
    const { rows } = await pool.query<{
      id: number; name: string; email: string; role: string;
      stateId: number | null; stateName: string | null; stateNameAr: string | null; sector: string | null;
      scope: string; status: string;
    }>(
      `SELECT u.id, u.name, u.email, u.role,
              u.state_id AS "stateId", u.sector, u.scope, u.status,
              s.name AS "stateName", s.name_ar AS "stateNameAr"
         FROM users u
         LEFT JOIN states s ON s.id = u.state_id
        WHERE u.id = $1`,
      [res.locals.userId],
    );
    const target = rows[0];
    if (!target) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const access = await resolveEffectiveAccess({
      id: target.id,
      name: target.name,
      email: target.email,
      role: target.role,
      roleLabel: null,
      stateId: target.stateId ?? null,
      stateName: target.stateName ?? null,
      sector: target.sector ?? null,
      scope: target.scope ?? "hq",
      status: target.status ?? "active",
    });
    res.json(access);
  } catch (err) {
    next(err);
  }
});

// GET by id -------------------------------------------------------------
router.get("/users/:id", requirePerm("users.view"), requireValidUserId, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${USER_COLS} FROM users u LEFT JOIN states s ON s.id = u.state_id WHERE u.id = $1`,
      [res.locals.userId],
    );
    if (!rows[0]) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json(withPresence(rows[0]));
  } catch (err) {
    next(err);
  }
});

// CREATE ----------------------------------------------------------------
router.post("/users", requirePerm("users.manage"), async (req, res, next) => {
  const body = req.body ?? {};
  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const username = String(body.username ?? email.split("@")[0].replace(/[^a-z0-9._-]/gi, "")).trim().toLowerCase();
  const phone = body.phone ? String(body.phone).trim() : null;
  const role = String(body.role ?? "");
  let stateId = body.stateId === null || body.stateId === undefined || body.stateId === "" ? null : Number(body.stateId);
  const language = body.languagePreference === "ar" ? "ar" : "en";
  const status = body.status === undefined ? "invited" : String(body.status);
  const sendInvite = status === "invited" || !body.password;
  const password = String(body.password ?? "");
  const inviteExpiresInDays = body.inviteExpiresInDays ? Math.max(1, Math.min(90, Number(body.inviteExpiresInDays))) : 7;
  const inviteMessage = body.inviteMessage ? String(body.inviteMessage).trim().slice(0, 500) : null;

  req.log.info({ name, email, username, role, stateId, sendInvite }, "[users:create] request received");

  // ── STEP 1: Input validation ─────────────────────────────────────────
  const sectorParsed = normalizeSector(body.sector);
  if ("error" in sectorParsed) {
    req.log.warn({ error: sectorParsed.error, sector: body.sector }, "[users:create] FAIL step:validation — invalid sector");
    res.status(400).json({ error: sectorParsed.error, step: "validation", detail: `Invalid sector: "${body.sector}"` });
    return;
  }
  let sector = sectorParsed.value;

  if (!name || !email || !username) {
    req.log.warn({ name, email, username }, "[users:create] FAIL step:validation — required fields missing");
    res.status(400).json({ error: "name_username_email_required", step: "validation", detail: "Name, username and email are all required" });
    return;
  }
  if (!isValidEmail(email)) {
    res.status(400).json({ error: "invalid_email", step: "validation" });
    return;
  }
  if (!VALID_STATUSES.has(status)) {
    res.status(400).json({ error: "invalid_status", step: "validation" });
    return;
  }
  if (stateId !== null && (!Number.isSafeInteger(stateId) || stateId < 1)) {
    res.status(400).json({ error: "invalid_state", step: "state_validation" });
    return;
  }
  req.log.info("[users:create] PASS step:validation");

  // ── STEP 2: Role validation ──────────────────────────────────────────
  if (!VALID_ROLES.has(role)) {
    req.log.warn({ role }, "[users:create] FAIL step:role_validation — unknown role");
    res.status(400).json({ error: "invalid_role", step: "role_validation", detail: `"${role}" is not a recognised role` });
    return;
  }
  req.log.info({ role }, "[users:create] PASS step:role_validation");

  // ── STEP 3: State / sector validation ───────────────────────────────
  if (STATE_ROLES.has(role) && !stateId) {
    req.log.warn({ role, stateId }, "[users:create] FAIL step:state_validation — state required");
    res.status(400).json({ error: "state_required_for_state_role", step: "state_validation", detail: `Role "${role}" requires an assigned state` });
    return;
  }
  if (role === "technical_coordinator" && !sector) {
    req.log.warn({ role }, "[users:create] FAIL step:state_validation — sector required for TC");
    res.status(400).json({ error: "sector_required_for_technical_coordinator", step: "state_validation", detail: "Technical Coordinator must be assigned a sector" });
    return;
  }
  // Scope is derived from the role, not supplied by the client. A State is
  // only meaningful for state roles and sector assignment only for TCs.
  if (!STATE_ROLES.has(role)) stateId = null;
  if (role !== "technical_coordinator") sector = null;
  req.log.info({ role, stateId, sector }, "[users:create] PASS step:state_validation");

  try {
    // ── STEP 4: Uniqueness check ─────────────────────────────────────
    const dupe = await pool.query(
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
      // If the conflict is on email AND this is a pending invite, give the more specific error
      if (onEmail && sendInvite && dupeRow.status === "invited") {
        const stillActive =
          !dupeRow.invite_expires_at ||
          new Date(dupeRow.invite_expires_at) > new Date();
        if (stillActive) {
          req.log.warn({ email }, "[users:create] FAIL step:uniqueness_check — duplicate active invitation");
          res.status(409).json({
            error: "duplicate_active_invitation",
            step: "uniqueness_check",
            detail: `An active invitation is already pending for "${email}". Cancel or resend the existing one.`,
          });
          return;
        }
      }
      req.log.warn({ conflictOn: onEmail ? "email" : "username", email, username }, "[users:create] FAIL step:uniqueness_check — conflict");
      res.status(409).json({
        error: onEmail ? "email_already_exists" : "username_already_exists",
        step: "uniqueness_check",
        detail: onEmail ? `Email "${email}" is already registered to another account` : `Username "${username}" is already taken`,
      });
      return;
    }
    req.log.info("[users:create] PASS step:uniqueness_check");

    // New user scope assignments are operational writes and therefore require
    // an active State; user reads continue to left-join inactive State labels.
    const activeState = stateId ? await assertActiveState(stateId) : null;
    const stateName = activeState?.ok ? activeState.state.name : null;
    if (stateId && !stateName) {
      const stateError = activeState && !activeState.ok ? activeState.error : "invalid_state";
      req.log.warn({ stateId }, "[users:create] FAIL step:state_validation — state ID not found");
      res.status(400).json({
        error: stateError,
        step: "state_validation",
        detail: stateError === "inactive_state" ? `State ID ${stateId} is inactive` : `State ID ${stateId} does not exist`,
      });
      return;
    }

    const roleLabel = deriveRoleLabel(role, stateName, sector);
    const scope = scopeForRole(role);

    let passwordHash: string | null = null;
    let inviteToken: string | null = null;
    let inviteExpiresAt: Date | null = null;
    if (sendInvite) {
      inviteToken = randomBytes(24).toString("hex");
      inviteExpiresAt = new Date(Date.now() + inviteExpiresInDays * 24 * 60 * 60 * 1000);
    } else {
      const pw = validatePassword(password);
      if (!pw.ok) {
        req.log.warn({ validationError: pw.error }, "[users:create] FAIL step:validation — password invalid");
        res.status(400).json({ error: pw.error, step: "validation", detail: "Password does not meet the minimum requirements" });
        return;
      }
      passwordHash = await bcrypt.hash(password, 12);
    }

    // ── STEP 5: Create user record ──────────────────────────────────
    let id: number;
    try {
      const { rows } = await pool.query(
        `INSERT INTO users (name, email, username, phone, password_hash, role, role_label, scope, state_id, sector, status, language_preference, invite_token, invite_expires_at, invited_by_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING id`,
        [name, email, username, phone, passwordHash, role, roleLabel, scope, stateId, sector, sendInvite ? "invited" : status, language, inviteToken, inviteExpiresAt, req.currentUser?.id ?? null],
      );
      id = rows[0].id;
      req.log.info({ userId: id }, "[users:create] PASS step:user_record — row inserted");
    } catch (dbErr) {
      const pg = dbErr as { code?: string; constraint?: string; detail?: string; message?: string };
      req.log.error({ pgCode: pg.code, constraint: pg.constraint, pgDetail: pg.detail, pgMessage: pg.message }, "[users:create] FAIL step:user_record — DB error");
      if (pg.code === "23505") {
        const onEmail = pg.constraint?.includes("email") || pg.detail?.includes("email");
        res.status(409).json({
          error: onEmail ? "email_already_exists" : "username_already_exists",
          step: "user_record",
          detail: pg.detail ?? "Unique constraint violation on user record",
        });
      } else if (pg.code === "23503") {
        res.status(400).json({ error: "foreign_key_violation", step: "user_record", detail: pg.detail ?? "Foreign key constraint violated (invalid state or reference)" });
      } else if (pg.code === "23502") {
        res.status(400).json({ error: "required_field_null", step: "user_record", detail: pg.detail ?? "A required database field was null" });
      } else {
        res.status(500).json({ error: "db_error", step: "user_record", detail: pg.message ?? "Unexpected database error while creating user record" });
      }
      return;
    }

    // ── STEP 6: Audit log ───────────────────────────────────────────
    try {
      await logAudit({
        userId: req.currentUser?.id ?? null,
        action: "create",
        module: "users",
        entityId: id,
        newValue: JSON.stringify({ name, email, username, role, stateId, status: sendInvite ? "invited" : status }),
      });
      req.log.info({ userId: id }, "[users:create] PASS step:audit_log");
    } catch (auditErr) {
      req.log.warn({ err: auditErr, userId: id }, "[users:create] audit log write failed (non-fatal, continuing)");
    }

    const out = await pool.query(
      `SELECT ${USER_COLS} FROM users u LEFT JOIN states s ON s.id = u.state_id WHERE u.id = $1`,
      [id],
    );

    // ── STEP 7: Dispatch invite email ───────────────────────────────
    let inviteEmailStatus: EmailDeliveryStatus = "pending";
    if (sendInvite && inviteToken && inviteExpiresAt) {
      try {
        const { delivered, status: deliveryStatus } = await dispatchInviteEmail({
          name, email, roleLabel, stateName, sector,
          token: inviteToken, expiresAt: inviteExpiresAt, userId: id,
          message: inviteMessage,
        });
        inviteEmailStatus = deliveryStatus;
        await pool.query(`UPDATE users SET invite_email_status = $1 WHERE id = $2`, [inviteEmailStatus, id]);
        req.log.info({ userId: id, delivered, inviteEmailStatus }, "[users:create] PASS step:invite_email");
      } catch (emailErr) {
        inviteEmailStatus = "failed";
        await pool.query(`UPDATE users SET invite_email_status = 'failed' WHERE id = $1`, [id]);
        req.log.warn({ err: emailErr, userId: id }, "[users:create] invite email dispatch failed (non-fatal, user record already created)");
      }
    }

    req.log.info({ userId: id, role, inviteEmailStatus }, "[users:create] completed successfully");
    await publishUserDirectoryChange(id, "created");
    res.status(201).json({
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
    });
  } catch (err) {
    req.log.error({ err }, "[users:create] unexpected unhandled error");
    next(err);
  }
});

// RESEND INVITE ---------------------------------------------------------
router.post("/users/:id/resend-invite", requirePerm("users.manage"), requireValidUserId, async (req, res, next) => {
  try {
    const id = res.locals.userId as number;
    const u = (await pool.query(
      `SELECT u.id, u.name, u.email, u.role_label AS "roleLabel", u.sector, u.status,
              u.invite_expires_at AS "inviteExpiresAt", u.invite_accepted_at AS "inviteAcceptedAt",
              u.invite_email_status AS "inviteEmailStatus",
              u.invited_by_id AS "invitedById",
              (u.password_hash IS NOT NULL) AS "hadPassword", s.name AS "stateName"
       FROM users u LEFT JOIN states s ON s.id = u.state_id WHERE u.id = $1`,
      [id],
    )).rows[0];
    if (!u) { res.status(404).json({ error: "not_found" }); return; }
    if (u.inviteAcceptedAt) { res.status(409).json({ error: "invite_already_accepted" }); return; }
    if (u.status !== "invited" && !(u.status === "deactivated" && u.invitedById !== null)) {
      res.status(400).json({ error: "user_not_invited" });
      return;
    }
    const expiresInDays = req.body?.expiresInDays ? Math.max(1, Math.min(90, Number(req.body.expiresInDays))) : 7;
    const message = req.body?.message ? String(req.body.message).trim().slice(0, 500) : null;
    const token = randomBytes(24).toString("hex");
    const expires = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
    await pool.query(
      `UPDATE users SET invite_token = $1, invite_expires_at = $2, status = 'invited', invite_email_status = 'pending', password_hash = NULL, updated_at = NOW() WHERE id = $3`,
      [token, expires, id],
    );
    let delivered = false;
    let emailDelivery: EmailDeliveryStatus = "pending";
    try {
      ({ delivered, status: emailDelivery } = await dispatchInviteEmail({
        name: u.name, email: u.email, roleLabel: u.roleLabel,
        stateName: u.stateName ?? null, sector: u.sector ?? null,
        token, expiresAt: expires, userId: u.id, message,
      }));
      await pool.query(`UPDATE users SET invite_email_status = $1 WHERE id = $2`, [emailDelivery, id]);
    } catch (emailErr) {
      emailDelivery = "failed";
      await pool.query(`UPDATE users SET invite_email_status = 'failed' WHERE id = $1`, [id]);
      req.log.warn({ err: emailErr, userId: id }, "[users:resend-invite] invite email dispatch failed");
    }
    await logAudit({
      userId: req.currentUser?.id ?? null,
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
    await publishUserDirectoryChange(id, "invite_changed");
    res.json({ ok: true, inviteToken: token, expiresAt: expires.toISOString(), emailDelivered: delivered, emailDelivery });
  } catch (err) {
    next(err);
  }
});

// CANCEL INVITE ---------------------------------------------------------
router.post("/users/:id/cancel-invite", requirePerm("users.manage"), requireValidUserId, async (req, res, next) => {
  try {
    const id = res.locals.userId as number;
    const u = (await pool.query(
      `SELECT id, status, invite_expires_at AS "inviteExpiresAt", invite_email_status AS "inviteEmailStatus"
       FROM users WHERE id = $1`,
      [id],
    )).rows[0];
    if (!u) { res.status(404).json({ error: "not_found" }); return; }
    if (u.status !== "invited") { res.status(400).json({ error: "user_not_invited" }); return; }
    await pool.query(
      `UPDATE users SET invite_token = NULL, invite_expires_at = NULL, status = 'deactivated', updated_at = NOW() WHERE id = $1`,
      [id],
    );
    await logAudit({
      userId: req.currentUser?.id ?? null,
      action: "invite_cancel",
      module: "users",
      entityId: id,
      oldValue: JSON.stringify({
        status: u.status,
        inviteExpiresAt: u.inviteExpiresAt ?? null,
        inviteEmailStatus: u.inviteEmailStatus ?? null,
      }),
      newValue: JSON.stringify({
        status: "deactivated",
        inviteExpiresAt: null,
        inviteEmailStatus: u.inviteEmailStatus ?? null,
      }),
    });
    await publishUserDirectoryChange(id, "invite_changed", true);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// RESEND VERIFICATION ---------------------------------------------------
router.post("/users/:id/resend-verification", requirePerm("users.manage"), requireValidUserId, async (req, res, next) => {
  try {
    const id = res.locals.userId as number;
    const { rows } = await pool.query(
      `SELECT id, name, email, email_verified AS "emailVerified", status FROM users WHERE id = $1`,
      [id],
    );
    const u = rows[0];
    if (!u) { res.status(404).json({ error: "not_found" }); return; }
    if (u.emailVerified) { res.status(400).json({ error: "already_verified" }); return; }

    const crypto = await import("node:crypto");
    const plainToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(plainToken).digest("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await pool.query(
      `UPDATE email_verification_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL`,
      [id],
    );
    await pool.query(
      `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at, ip_address) VALUES ($1, $2, $3, $4)`,
      [id, tokenHash, expiresAt.toISOString(), req.ip ?? null],
    );

    const { renderVerifyEmail: render, sendEmail: send } = await import("../lib/mailer");
    const { html, text, subject } = render({ name: u.name, email: u.email, token: plainToken, expiresAt });
    const { delivered } = await send({ to: u.email, subject, html, text, kind: "email_verification", userId: id });
    await logAudit({ userId: req.currentUser?.id ?? null, action: "verification_email_resent", module: "users", entityId: id });

    res.json({ ok: true, delivered });
  } catch (err) { next(err); }
});

// UPDATE ----------------------------------------------------------------
router.patch("/users/:id", requirePerm("users.manage"), requireValidUserId, async (req, res, next) => {
  try {
    const id = res.locals.userId as number;
    const existing = (await pool.query(`SELECT * FROM users WHERE id = $1`, [id])).rows[0];
    if (!existing) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    const body = req.body ?? {};
    const hasOwn = (key: string) => Object.prototype.hasOwnProperty.call(body, key);
    // A super administrator must not be able to accidentally remove their
    // own authority or session access through a direct endpoint call.
    if (id === req.currentUser?.id && ["role", "status", "stateId", "sector"].some(hasOwn)) {
      res.status(400).json({ error: "cannot_modify_own_access" });
      return;
    }
    const next_: Record<string, unknown> = {};

    if (typeof body.name === "string") {
      if (!body.name.trim()) { res.status(400).json({ error: "name_required" }); return; }
      next_.name = body.name.trim();
    }
    if (typeof body.email === "string") {
      const email = body.email.trim().toLowerCase();
      if (!isValidEmail(email)) { res.status(400).json({ error: "invalid_email" }); return; }
      next_.email = email;
    }
    if (typeof body.username === "string") {
      const username = body.username.trim().toLowerCase();
      if (!username) { res.status(400).json({ error: "username_required" }); return; }
      next_.username = username;
    }
    if (body.phone !== undefined) next_.phone = body.phone ? String(body.phone).trim() : null;
    if (body.languagePreference === "en" || body.languagePreference === "ar") next_.language_preference = body.languagePreference;
    if (body.sector !== undefined) {
      const parsed = normalizeSector(body.sector);
      if ("error" in parsed) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      next_.sector = parsed.value;
    }

    if (typeof body.role === "string") {
      if (!VALID_ROLES.has(body.role)) {
        res.status(400).json({ error: "invalid_role" });
        return;
      }
      next_.role = body.role;
      next_.scope = scopeForRole(body.role);
    }
    if (body.stateId !== undefined) {
      const stateId = body.stateId === null || body.stateId === "" ? null : Number(body.stateId);
      if (stateId !== null && (!Number.isSafeInteger(stateId) || stateId < 1)) {
        res.status(400).json({ error: "invalid_state" });
        return;
      }
      next_.state_id = stateId;
    }
    if (body.officeLocation !== undefined) {
      next_.office_location = body.officeLocation ? String(body.officeLocation).trim() : null;
    }
    if (typeof body.status === "string") {
      if (!VALID_STATUSES.has(body.status)) {
        res.status(400).json({ error: "invalid_status" });
        return;
      }
      next_.status = body.status;
    }

    // Validate state role requires state.
    const finalRole = (next_.role as string) ?? existing.role;
    let finalStateId = next_.state_id !== undefined ? next_.state_id : existing.state_id;
    if (STATE_ROLES.has(finalRole) && !finalStateId) {
      res.status(400).json({ error: "state_required_for_state_role" });
      return;
    }
    if (!STATE_ROLES.has(finalRole)) {
      finalStateId = null;
      next_.state_id = null;
    }
    // For TC, re-validate the *effective* sector against the taxonomy — not just
    // when sector was sent in this request. Changing role to TC without touching
    // sector must not silently accept a stale/legacy/blank value.
    if (finalRole === "technical_coordinator") {
      const effective = next_.sector !== undefined ? (next_.sector as string | null) : existing.sector;
      const reparsed = normalizeSector(effective);
      if ("error" in reparsed) {
        res.status(400).json({ error: reparsed.error });
        return;
      }
      if (!reparsed.value) {
        res.status(400).json({ error: "sector_required_for_technical_coordinator" });
        return;
      }
      next_.sector = reparsed.value;
    } else {
      // Historical sector values are not applicable after a TC role change.
      next_.sector = null;
    }

    const existingStateId = existing.state_id == null ? null : Number(existing.state_id);
    const stateAssignmentChanged = finalStateId !== existingStateId;
    const roleNewlyRequiresState =
      next_.role !== undefined &&
      finalRole !== existing.role &&
      STATE_ROLES.has(finalRole) &&
      !STATE_ROLES.has(existing.role);
    // Existing inactive State assignments are historical data and must not
    // prevent unrelated status/profile updates. Require an active State only
    // when this PATCH introduces/replaces the assignment, or when a role
    // transition newly makes a State mandatory.
    let validatedStateName: string | null = null;
    if (finalStateId && (stateAssignmentChanged || roleNewlyRequiresState)) {
      const activeState = await assertActiveState(Number(finalStateId));
      if (!activeState.ok) {
        res.status(400).json({ error: activeState.error });
        return;
      }
      validatedStateName = activeState.state.name;
    }

    // Re-derive role_label whenever role/state/sector change.
    if (next_.role !== undefined || next_.state_id !== undefined || next_.sector !== undefined) {
      const finalSector = next_.sector !== undefined ? (next_.sector as string | null) : existing.sector;
      // Label generation is a read concern: preserve an inactive historical
      // State's name without treating it as a new operational assignment.
      let stateName = validatedStateName;
      if (finalStateId && stateName === null) {
        const state = await pool.query<{ name: string }>(
          `SELECT name FROM states WHERE id = $1`,
          [Number(finalStateId)],
        );
        stateName = state.rows[0]?.name ?? null;
      }
      next_.role_label = deriveRoleLabel(finalRole, stateName, finalSector);
    }

    // Uniqueness checks if email or username changed.
    if (next_.email && next_.email !== existing.email) {
      const dupe = await pool.query(`SELECT id FROM users WHERE LOWER(email) = $1 AND id <> $2`, [next_.email, id]);
      if (dupe.rows[0]) {
        res.status(409).json({ error: "email_taken" });
        return;
      }
    }
    if (next_.username && next_.username !== existing.username) {
      const dupe = await pool.query(`SELECT id FROM users WHERE LOWER(COALESCE(username,'')) = $1 AND id <> $2`, [next_.username, id]);
      if (dupe.rows[0]) {
        res.status(409).json({ error: "username_taken" });
        return;
      }
    }

    const keys = Object.keys(next_);
    if (keys.length === 0) {
      res.json({ ok: true, changed: 0 });
      return;
    }

    const sets = keys.map((k, i) => `${k} = $${i + 2}`);
    sets.push(`updated_at = NOW()`);
    await pool.query(`UPDATE users SET ${sets.join(", ")} WHERE id = $1`, [id, ...keys.map((k) => next_[k])]);
    const authorizationChanged = ["role", "scope", "state_id", "sector", "status"].some((key) => key in next_);
    await publishUserDirectoryChange(
      id,
      next_.status !== undefined ? "status_changed" : "updated",
      authorizationChanged,
    );
    if (next_.status !== undefined && next_.status !== "active") realtime.disconnectUser(id);

    await logAudit({
      userId: req.currentUser?.id ?? null,
      action: "update",
      module: "users",
      entityId: id,
      oldValue: JSON.stringify(auditUserSnapshot(existing)),
      newValue: JSON.stringify(auditUserSnapshot({ ...existing, ...next_ })),
    });

    const out = await pool.query(
      `SELECT ${USER_COLS} FROM users u LEFT JOIN states s ON s.id = u.state_id WHERE u.id = $1`,
      [id],
    );
    res.json(withPresence(out.rows[0]));
  } catch (err) {
    next(err);
  }
});

// CHANGE STATUS ---------------------------------------------------------
router.post("/users/:id/status", requirePerm("users.manage"), requireValidUserId, async (req, res, next) => {
  try {
    const id = res.locals.userId as number;
    const status = String(req.body?.status ?? "");
    if (!VALID_STATUSES.has(status)) {
      res.status(400).json({ error: "invalid_status" });
      return;
    }
    if (id === req.currentUser?.id && status !== "active") {
      res.status(400).json({ error: "cannot_change_own_status" });
      return;
    }
    const existing = (await pool.query(
      `SELECT * FROM users WHERE id = $1`, [id],
    )).rows[0];
    if (!existing) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    await pool.query(`UPDATE users SET status = $1, updated_at = NOW() WHERE id = $2`, [status, id]);
    await publishUserDirectoryChange(id, "status_changed", true);
    if (status !== "active") realtime.disconnectUser(id);
    await logAudit({
      userId: req.currentUser?.id ?? null,
      action: "status_change",
      module: "users",
      entityId: id,
      oldValue: JSON.stringify(auditUserSnapshot(existing)),
      newValue: JSON.stringify(auditUserSnapshot({ ...existing, status })),
    });

    // Dispatch status-change notification emails (fire-and-forget; non-fatal).
    try {
      const emailOpts = { name: existing.name as string, email: existing.email as string };
      if (status === "active" && existing.status !== "active") {
        const t = renderAccountActivatedEmail(emailOpts);
        await sendEmail({ to: emailOpts.email, subject: t.subject, html: t.html, text: t.text, kind: "account_activated", userId: id });
      } else if (status === "suspended") {
        const t = renderAccountSuspendedEmail(emailOpts);
        await sendEmail({ to: emailOpts.email, subject: t.subject, html: t.html, text: t.text, kind: "account_suspended", userId: id });
      } else if (status === "deactivated") {
        const t = renderAccountDeactivatedEmail(emailOpts);
        await sendEmail({ to: emailOpts.email, subject: t.subject, html: t.html, text: t.text, kind: "account_deactivated", userId: id });
      }
    } catch (emailErr) {
      req.log.warn({ err: emailErr, userId: id, status }, "[users:status] status email dispatch failed (non-fatal)");
    }

    res.json({ ok: true, status });
  } catch (err) {
    next(err);
  }
});

// RESET PASSWORD --------------------------------------------------------
router.post("/users/:id/reset-password", requirePerm("users.manage"), requireValidUserId, async (req, res, next) => {
  try {
    const id = res.locals.userId as number;
    const newPassword = String(req.body?.password ?? "");
    const sendInvite = Boolean(req.body?.invite);
    if (id === req.currentUser?.id && sendInvite) {
      res.status(400).json({ error: "cannot_change_own_status" });
      return;
    }

    const existing = (await pool.query(`SELECT id, email FROM users WHERE id = $1`, [id])).rows[0];
    if (!existing) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    if (sendInvite) {
      const inviteToken = randomBytes(24).toString("hex");
      const inviteExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await pool.query(
        `UPDATE users SET password_hash = NULL, invite_token = $1, invite_expires_at = $2, status = 'invited', updated_at = NOW() WHERE id = $3`,
        [inviteToken, inviteExpiresAt, id],
      );
      await publishUserDirectoryChange(id, "invite_changed", true);
      realtime.disconnectUser(id);
      await logAudit({ userId: req.currentUser?.id ?? null, action: "password_reset_invite", module: "users", entityId: id });
      res.json({ ok: true, inviteToken });
      return;
    }

    const pwCheck = validatePassword(newPassword);
    if (!pwCheck.ok) {
      res.status(400).json({ error: pwCheck.error });
      return;
    }
    const hash = await bcrypt.hash(newPassword, 12);
    await pool.query(
      `UPDATE users SET password_hash = $1, invite_token = NULL, invite_expires_at = NULL, updated_at = NOW() WHERE id = $2`,
      [hash, id],
    );
    await logAudit({ userId: req.currentUser?.id ?? null, action: "password_reset", module: "users", entityId: id });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// DELETE ----------------------------------------------------------------
router.delete("/users/:id", requirePerm("users.manage"), requireValidUserId, async (req, res, next) => {
  try {
    const id = res.locals.userId as number;
    if (id === req.currentUser?.id) {
      res.status(400).json({ error: "cannot_delete_self" });
      return;
    }
    const existing = (await pool.query(`SELECT name, email, role FROM users WHERE id = $1`, [id])).rows[0];
    if (!existing) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    await pool.query(`DELETE FROM users WHERE id = $1`, [id]);
    await publishUserDirectoryChange(id, "deleted", true);
    realtime.disconnectUser(id);
    await logAudit({
      userId: req.currentUser?.id ?? null,
      action: "delete",
      module: "users",
      entityId: id,
      oldValue: JSON.stringify(existing),
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
