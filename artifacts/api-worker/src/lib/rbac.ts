import type { MiddlewareHandler } from "hono";
import type { Bindings, Variables } from "./db";
import { openDb, type QueryExecutor } from "./db";
import { getActiveSession, type AuthenticatedSession } from "./session";

export type { Variables };

/**
 * Ported from artifacts/api-server/src/middlewares/currentUser.ts.
 *
 * permissionsFor() and hasPerm() are copied verbatim — this is the actual
 * access-control policy (which of the 8 valid roles gets which permission
 * string), not framework glue, and it must not drift from the Express
 * version by so much as one line while both stacks exist side by side.
 *
 * What changed in the rest of the file: every helper that read req/res or
 * the module-level `pool` now takes a CurrentUser/QueryExecutor argument
 * instead. requireAuth's Express PUBLIC_PATHS allow-list is dropped: a
 * Workers route decides it needs no auth by simply not listing requireAuth
 * as one of its handlers, rather than a single global gate with exceptions.
 * attachCurrentUser opens its own short-lived connection and closes it
 * before calling next() — unlike a request-scoped db a route handler
 * itself might return a streaming response for (see /ai/chat's comment
 * in index.ts), this middleware's own query always finishes before this
 * function returns, so there is no equivalent close-timing risk here.
 */

export interface CurrentUser {
  id: number;
  name: string;
  email: string;
  role: string;
  roleLabel: string;
  scope: string;
  stateId: number | null;
  stateName: string | null;
  stateNameAr?: string | null;
  sector: string | null;
  sectors: string[] | null;
  avatarUrl: string | null;
  languagePreference?: string;
}

export function isDemoRoleHarnessEnabled(env: { NODE_ENV?: string; CAFA_DEMO_MODE?: string }): boolean {
  return env.NODE_ENV !== "production" && env.CAFA_DEMO_MODE === "true";
}

/** null = no restriction; [] = fail-closed (matches nothing via = ANY($n::text[])). */
export function tcSectorRestriction(user: CurrentUser | undefined): string[] | null {
  if (!user || user.role !== "technical_coordinator") return null;
  return user.sectors ?? [];
}

export function assertSectorAllowed(
  user: CurrentUser | undefined,
  sector: string | null,
): { ok: true } | { ok: false; status: number; body: object } {
  const restriction = tcSectorRestriction(user);
  if (!restriction) return { ok: true };
  if (sector && restriction.includes(sector)) return { ok: true };
  return { ok: false, status: 403, body: { error: "sector_forbidden" } };
}

export function isHqAuthorised(user: CurrentUser | undefined): boolean {
  if (!user) return false;
  const STATE_ONLY_ROLES = new Set(["state_office_manager", "state_program_officer"]);
  return !STATE_ONLY_ROLES.has(user.role);
}

export async function assertStateAllowed(
  db: QueryExecutor,
  user: CurrentUser | undefined,
  projectId: number,
): Promise<{ ok: true } | { ok: false; status: number; body: object }> {
  if (!user) return { ok: false, status: 401, body: { error: "unauthorized" } };
  const isStateRole = user.role === "state_office_manager" || user.role === "state_program_officer";
  if (!isStateRole) return { ok: true };
  const stateId = user.stateId ?? null;
  if (stateId === null) {
    return { ok: false, status: 403, body: { error: "state_forbidden" } };
  }
  const { rows } = user.role === "state_program_officer"
    ? await db.query(
      `SELECT 1 FROM project_assignments pa
       WHERE pa.project_id = $1 AND pa.user_id = $2
       LIMIT 1`,
      [projectId, user.id],
    )
    : await db.query(
      `SELECT 1 FROM project_states ps
       WHERE ps.project_id = $1 AND ps.state_id = $2
       LIMIT 1`,
      [projectId, stateId],
    );
  if (rows.length === 0) {
    return { ok: false, status: 403, body: { error: "state_forbidden" } };
  }
  return { ok: true };
}

// Internal helper: wildcard `*` grants all permissions.
export function hasPerm(perms: string[], perm: string): boolean {
  return perms.includes("*") || perms.includes(perm);
}

// ── Role model notes ──────────────────────────────────────────────────────────
//
// AUTHORITATIVE VALID ROLES (enforced by VALID_ROLES set in routes/users.ts):
//   super_admin, executive_director, program_manager,
//   senior_program_coordinator, technical_coordinator,
//   state_office_manager, state_program_officer, viewer
//
// programme_assistant / program_assistant:
//   Documented in the CAFA PMIS Role Guide (manual-role-guide.tsx) as
//   "Programme Assistant". NOT in VALID_ROLES — cannot be assigned to any user.
//   Also referenced in dashboard.ts as an explicitly excluded role.
//   A user who somehow carries this role falls through all if-blocks below
//   and receives only the universal read-only permissions (notifications, manual,
//   states, messages, program_resources). They do NOT receive reports.view,
//   projects.view, plans.view, budget.view, or any approval permission.
//   → FAIL-CLOSED for all module-level access (by design, not by accident).
//
// project_officer:
//   Appears in ONE dashboard.ts comment (line ~194) as a hypothetically-excluded
//   role. It is NOT defined in VALID_ROLES, has no users in the database, and
//   has no block in this function. It is NOT an active or historical CAFA role.
//   Any request carrying role='project_officer' would fall through to the same
//   universal-only permissions as an unknown role → fail-closed for Reports.
//
// ─────────────────────────────────────────────────────────────────────────────
// Permissions for the 8 valid CAFA Program Department roles.
// (Spec: Super Admin, Executive Director, Program Manager, Senior Program Coordinator,
//  Technical Coordinator, State Office Manager, State Program Officer.)
export function permissionsFor(user: CurrentUser): string[] {
  const perms: string[] = [];
  const role = user.role;

  // Super Admin: full access wildcard.
  if (role === "super_admin") {
    perms.push("*");
    return perms;
  }

  // Universal read-only permissions every authenticated role receives.
  perms.push("notifications.view", "manual.view", "states.view", "messages.view", "program_resources.view");

  // Communication attachments are an explicit capability, independent from
  // document-repository uploads. Operational messaging roles may share files
  // and record voice notes; viewer accounts retain text-only communication.
  if ([
    "executive_director",
    "program_manager",
    "senior_program_coordinator",
    "technical_coordinator",
    "state_office_manager",
    "state_program_officer",
  ].includes(role)) {
    perms.push("messages.attachments.upload");
  }

  // User management — only Program Manager gets read access; create/edit/delete is super-admin only.
  if (role === "program_manager") {
    perms.push("users.view");
  }

  // Org-wide dashboard / read visibility + audit trail access.
  if (["executive_director", "program_manager", "senior_program_coordinator", "technical_coordinator"].includes(role)) {
    perms.push("dashboard.view.org", "audit.view");
  }

  // Executive Director can view (but not manage) all users.
  if (role === "executive_director") {
    perms.push("users.view");
  }

  // Destructive deletions — restricted to organisational leadership only.
  // plans.update MUST NOT imply plans.delete (spec requirement).
  if (["executive_director", "program_manager"].includes(role)) {
    perms.push("projects.delete", "plans.delete");
  }

  // Reopen Approved Plans — granted to leadership and coordination roles.
  // Separate from plans.update, plans.create, and plans.delete — none of those imply this.
  // TC scope is enforced at the endpoint via assertSectorAllowed / tcSectorRestriction.
  // super_admin receives via "*". ED and PM have strategic/final-approval authority.
  // Senior Program Coordinator: within their authorised Programme scope only.
  // Technical Coordinator: strictly Sector-scoped; empty sector assignment fails closed.
  if (["executive_director", "program_manager", "senior_program_coordinator", "technical_coordinator"].includes(role)) {
    perms.push("plans.reopen");
  }

  // Full Operational Access — Program Manager (Global Governance Rule, Task #373).
  // PM has system-wide operational access across all CAFA PMIS modules.
  // See docs/audit-reports/global-full-operational-access-governance.md.
  if (role === "program_manager") {
    perms.push(
      // Projects
      "projects.create",
      "projects.update",
      "projects.approve.final",
      "projects.activate",
      "projects.close",
      // Documents
      "documents.upload",
      "documents.view",
      // Reports — full lifecycle access
      "reports.create",
      "reports.update",            // Edit drafts (own or cross-author via ownership bypass)
      "reports.delete",            // Delete drafts (own or cross-author via ownership bypass)
      "reports.approve.coordination",
      "reports.approve.technical",
      "reports.approve.final",
      "reports.view",              // Organisation-wide read
      // Plans — full lifecycle access
      "plans.create",
      "plans.update",
      "plans.approve.coordination",
      "plans.approve.technical",
      "plans.approve.final",
      // Projects — full lifecycle access (technical/coordination review stages)
      "projects.approve.coordination",
      "projects.approve.technical",
      // Budget: full access — view org-wide, create, edit, review, final approval
      "budget.view",
      "budget.view.all",
      "budget.create",
      "budget.edit",
      "budget.review",
      "budget.approve.final",
      // Risks
      "risks.create",
      "risks.update",
      // Comments
      "comments.create",
      // Communication Centre
      "messages.create",
      "messages.send",
      "messages.manage_members",
      // Manual editing
      "manual.edit",
      "manual.edit.content",
      // User management (read)
      "users.view",
    );
  }

  // Coordination review (Senior Program Coordinator).
  if (role === "senior_program_coordinator") {
    perms.push(
      "projects.approve.coordination",
      "reports.approve.coordination",
      "reports.view",              // Organisation-wide read
      "plans.approve.coordination",
      "users.view",
      // Budget: view all + create + edit + review (no final approval)
      "budget.view",
      "budget.view.all",
      "budget.create",
      "budget.edit",
      "budget.review",
    );
  }

  // Technical review (Technical Coordinator) — sector-scoped; also a report and plan creator.
  if (role === "technical_coordinator") {
    perms.push(
      "projects.approve.technical",
      "plans.approve.technical",
      "reports.create",
      "reports.update",
      "reports.delete",
      "reports.view",              // Organisation-wide read (sector-scoped at route level)
      "reports.approve.technical", // Technical review step for Project + Activity reports
      "indicators.update",
      // Budget: view + create + edit, scoped to assigned sector via tcSectorRestriction
      "budget.view",
      "budget.view.sector",
      "budget.create",
      "budget.edit",
    );
  }

  // Executive Director: view-only across all budget data, no write authority.
  if (role === "executive_director") {
    perms.push(
      "budget.view",
      "budget.view.all",
      "reports.view", // Organisation-wide read (no write or approval authority)
    );
  }

  // State Office Manager: VIEW ONLY — monitoring and read access for their assigned state.
  // SOM is not part of any approval chain. They must NOT create, edit, submit, review,
  // approve, reject, request revision, or archive any report.
  // Note: reports.approve.state was removed here in Migration 008; the state_review step
  // was eliminated from the Project/Activity workflow. SOM has no approval authority.
  // audit.view is granted but the /audit-log route enforces state_id scoping server-side.
  if (role === "state_office_manager") {
    perms.push(
      "dashboard.view.state",
      "projects.view.state",
      "reports.view",              // Read access only (state-scoped at route level)
      "reports.view.state",        // Legacy — kept for backward compat
      "risks.view.state",
      // Budget: view-only, state-scoped
      "budget.view",
      "budget.view.state",
      "audit.view",
      // SPR-003/004 (SPR-BD-2): bounded fallback SPR authoring ONLY. This narrow
      // permission opens the outer POST /reports gate; the route's program_state
      // author gate then verifies server-side that no active SPO covers the SOM's
      // state before allowing creation. It grants NOTHING for project, activity,
      // or hq_sector reports — those type-specific gates exclude SOM.
      "reports.program_state.create",
    );
  }

  // State Program Officer: main operational user — creates & updates everything in their state.
  // No comments access per RBAC spec.
  // audit.view is granted but the /audit-log route enforces state_id scoping server-side.
  if (role === "state_program_officer") {
    perms.push(
      "dashboard.view.state",
      "projects.create",
      "projects.update",
      "projects.view.state",
      "reports.create",
      "reports.update",
      "reports.delete",
      "reports.view",              // Read access (state-scoped at route level)
      "reports.view.state",        // Legacy — kept for backward compat
      "activities.update",
      "workplans.update",
      "beneficiaries.create",
      "risks.create",
      "risks.update",
      "risks.view.state",
      "plans.create",
      "plans.update",
      "documents.upload",
      "documents.view",
      // Budget: view-only in Budget Module, state-scoped.
      // Budget entry during Project Registration is allowed (enforced by project workflow
      // — project must be in draft or returned-for-revision status to allow budget edits).
      "budget.view",
      "budget.view.state",
      "audit.view",
    );
  }

  // HQ-level create / edit perms (PM + SC + TC; excludes state roles and ED who are view-only).
  if (["program_manager", "senior_program_coordinator", "technical_coordinator"].includes(role)) {
    perms.push(
      "projects.create",
      "projects.update",
      "reports.create",
      "reports.update",
      "reports.delete",
      "risks.create",
      "risks.update",
      "plans.create",
      "plans.update",
      "documents.upload",
      "documents.view",
      "program_resources.upload",
      "program_resources.edit",
      "program_resources.delete",
    );
  }

  // Manual admin (create/delete chapters, SOPs): PM only.
  if (role === "program_manager") {
    perms.push("manual.edit");
  }
  // Manual content edit (update sections, patch chapters): PM + Senior Coordinator.
  if (["program_manager", "senior_program_coordinator"].includes(role)) {
    perms.push("manual.edit.content");
  }

  // Communication Centre actions are granted to the eight valid CAFA roles.
  // Keep attachment upload separate from send so routes and UI can enforce the
  // same dedicated capability without borrowing documents.upload.
  if ([
    "executive_director",
    "program_manager",
    "senior_program_coordinator",
    "technical_coordinator",
    "state_office_manager",
    "state_program_officer",
    "viewer",
  ].includes(role)) {
    perms.push(
      "messages.send",
      "messages.create",
      "messages.manage_members",
    );
  }
  // Announcements: HQ leadership only (super_admin gets via *, ED/PM explicit).
  if (["executive_director", "program_manager"].includes(role)) {
    perms.push("messages.announce");
  }

  // AI: settings management for SA (via *) and Executive Director.
  if (role === "executive_director") {
    perms.push("ai.settings.manage", "ai.logs.view");
  }
  // AI logs: SA (via *) and PM monitoring oversight.
  if (role === "program_manager") {
    perms.push("ai.logs.view");
  }

  // Document Repository admin access: super_admin gets it via "*"; explicit grant for ED + PM.
  if (["executive_director", "program_manager"].includes(role)) {
    perms.push("storage.admin");
  }

  // Document view: HQ leadership + SOM monitoring (SPO already granted above).
  if (["executive_director", "state_office_manager"].includes(role)) {
    perms.push("documents.view");
  }

  // Budget org-level view for PM (already added per-role above; this line kept as a safety net).
  // Note: SC, TC, state roles, ED all receive their budget.view.* scopes in their own blocks above.

  // Risk read visibility for all HQ roles (state roles get restricted view above).
  if (["executive_director", "program_manager", "senior_program_coordinator", "technical_coordinator"].includes(role)) {
    perms.push("risks.view");
  }

  // Viewer: read-only access to org-wide data, no write or approval authority.
  if (role === "viewer") {
    perms.push(
      "dashboard.view.org",
      "projects.view",
      "reports.view",
      "risks.view",
      "plans.view",
      "budget.view",
      "budget.view.all",
      "documents.view",
      "audit.view",
    );
    return Array.from(new Set(perms));
  }

  // PRJ-036: minimal project-domain read permission. Gates donor reference-data
  // reads (GET /projects/donors). Granted to every role that legitimately needs
  // to reference donors when creating, editing, or reviewing projects.
  // Viewer receives it in its own block above; super_admin via "*".
  if ([
    "executive_director",
    "program_manager",
    "senior_program_coordinator",
    "technical_coordinator",
    "state_office_manager",
    "state_program_officer",
  ].includes(role)) {
    perms.push("projects.view");
  }

  // Comments: only granted to HQ roles + Executive Director.
  // State Office Manager and State Program Officer have NO comments access (spec).
  if (!["state_office_manager", "state_program_officer"].includes(role)) {
    perms.push("comments.create");
  }

  return Array.from(new Set(perms));
}

export async function logAudit(
  db: QueryExecutor,
  opts: {
    userId: number | null;
    action: string;
    module: string;
    entityId?: number | null;
    oldValue?: string | null;
    newValue?: string | null;
    usedOverride?: boolean;
    overrideReason?: string | null;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO audit_log (user_id, action, module, entity_id, old_value, new_value, used_override, override_reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      opts.userId,
      opts.action,
      opts.module,
      opts.entityId ?? null,
      opts.oldValue ?? null,
      opts.newValue ?? null,
      opts.usedOverride ?? false,
      opts.overrideReason ?? null,
    ],
  );
}

export type { AuthenticatedSession };

interface AttachUserRow extends Record<string, unknown> {
  id: number;
  name: string;
  email: string;
  role: string;
  role_label: string;
  scope: string;
  state_id: number | null;
  sector: string | null;
  status: string;
  avatar_url: string | null;
  language_preference: string;
  state_name: string | null;
  state_name_ar: string | null;
}

function isManagedProfilePhotoPath(value: unknown): value is string {
  return typeof value === "string" && /^\/objects\/profiles\/[0-9a-f-]{36}$/i.test(value);
}

/** Populates c.get('currentUser') / c.get('authSession') for every request — attach this before requireAuth/requirePerm. */
export const attachCurrentUser: MiddlewareHandler<{ Bindings: Bindings; Variables: Variables }> = async (c, next) => {
  const { db, close } = openDb(c);
  try {
    const session = await getActiveSession(c, db);
    c.set("authSession", session ?? undefined);
    if (session) {
      const { rows } = await db.query<AttachUserRow>(
        `SELECT u.id, u.name, u.email, u.role, u.role_label, u.scope, u.state_id, u.sector, u.status,
                u.avatar_url, u.language_preference, s.name AS state_name, s.name_ar AS state_name_ar
           FROM users u
           LEFT JOIN states s ON s.id = u.state_id
          WHERE u.id = $1
          LIMIT 1`,
        [session.userId],
      );
      const row = rows[0];
      // Only attach if the user exists AND is still active. Suspended /
      // deactivated / inactive / invited accounts lose access immediately on
      // the next request, even if their session cookie is still valid.
      if (row && row.status === "active") {
        const sectors = row.role === "technical_coordinator" && row.sector
          ? String(row.sector).split(",").map((s) => s.trim()).filter(Boolean)
          : null;
        c.set("currentUser", {
          id: row.id,
          name: row.name,
          email: row.email,
          role: row.role,
          roleLabel: row.role_label,
          scope: row.scope,
          stateId: row.state_id,
          stateName: row.state_name,
          stateNameAr: row.state_name_ar,
          sector: row.sector,
          sectors,
          // The stored object key is private implementation metadata.
          // Profile photos are always dereferenced through the self-owned
          // proxy route.
          avatarUrl: isManagedProfilePhotoPath(row.avatar_url) ? "/api/profile/photo" : null,
          languagePreference: row.language_preference,
        });
      }
    }
  } finally {
    close();
  }
  await next();
};

/** Gate: rejects with 401 if attachCurrentUser found no active session. Mount attachCurrentUser first. */
export const requireAuth: MiddlewareHandler<{ Bindings: Bindings; Variables: Variables }> = async (c, next) => {
  if (!c.get("currentUser")) return c.json({ error: "unauthorized" }, 401);
  return next();
};

/** Rejects with 403 if the authenticated user lacks `perm`. Mount attachCurrentUser + requireAuth first. */
export function requirePerm(perm: string, message?: string): MiddlewareHandler<{ Bindings: Bindings; Variables: Variables }> {
  return async (c, next) => {
    const user = c.get("currentUser");
    if (!user) return c.json({ error: "unauthorized" }, 401);
    if (!hasPerm(permissionsFor(user), perm)) {
      return c.json({
        error: "forbidden",
        message: message ?? "You do not have permission to perform this action.",
        requiredPermission: perm,
      }, 403);
    }
    return next();
  };
}
