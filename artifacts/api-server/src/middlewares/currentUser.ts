import type { Request, Response, NextFunction } from "express";
import { pool } from "@workspace/db";
import { getActiveSession, type AuthenticatedSession } from "../lib/session";

function isManagedProfilePhotoPath(value: unknown): value is string {
  return typeof value === "string" && /^\/objects\/profiles\/[0-9a-f-]{36}$/i.test(value);
}

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
  avatarUrl: string | null;
  // Parsed list of assigned sectors. Only populated for Technical Coordinators —
  // for all other roles this is null, meaning "no sector restriction".
  sectors: string[] | null;
}

/** Development-only role-harness gate. Production always rejects the harness,
 * even if the environment variable was incorrectly set. */
export function isDemoRoleHarnessEnabled(
  env: { NODE_ENV?: string; CAFA_DEMO_MODE?: string } = process.env,
): boolean {
  return env.NODE_ENV !== "production" && env.CAFA_DEMO_MODE === "true";
}

// Returns the active sector restriction for the current request, or null if none.
// IMPORTANT: this is fail-closed for Technical Coordinators — a TC whose
// `sectors` parsed empty (legacy blank data, malformed CSV, etc.) gets an
// empty array, which translates to "match nothing" in SQL via
// `= ANY($n::text[])`, NOT to "no restriction". Without this, bad data would
// grant unrestricted access instead of denying by default.
export function tcSectorRestriction(req: Request): string[] | null {
  const u = req.currentUser;
  if (!u || u.role !== "technical_coordinator") return null;
  return u.sectors ?? [];
}

// Throws if the request is a TC and `sector` is not in their assigned set.
// Used to guard per-resource detail/mutation endpoints (project :id, report :id,
// risk :id, etc.) so a TC cannot read or act on out-of-sector records by ID.
export function assertSectorAllowed(req: Request, sector: string | null): { ok: true } | { ok: false; status: number; body: object } {
  const restriction = tcSectorRestriction(req);
  if (!restriction) return { ok: true };
  if (sector && restriction.includes(sector)) return { ok: true };
  return { ok: false, status: 403, body: { error: "sector_forbidden" } };
}

/**
 * Returns true when the requesting user is authorised to create or access HQ records.
 *
 * State-scoped roles (state_program_officer, state_office_manager) are denied
 * HQ-scoped operations — they may only work within their assigned Sudan State.
 * All organisation-wide roles (ED, PM, TC, SC, viewer, etc.) are permitted.
 *
 * Call this in any route that creates or reads an HQ record before trusting
 * the client-supplied locationType=hq value.
 */
export function isHqAuthorised(req: Request): boolean {
  const u = req.currentUser;
  if (!u) return false;
  const STATE_ONLY_ROLES = new Set(["state_office_manager", "state_program_officer"]);
  return !STATE_ONLY_ROLES.has(u.role);
}

// Async guard for state roles (state_program_officer, state_office_manager).
// State Office Managers may access projects in their assigned state. State
// Programme Officers are limited to explicit project_assignments; a direct
// assignment is the record-level scope and may legitimately reach a project
// outside the officer's ordinary state. Both roles still fail closed without a
// state assignment. Non-state roles always pass.
export async function assertStateAllowed(
  req: Request,
  projectId: number,
): Promise<{ ok: true } | { ok: false; status: number; body: object }> {
  const u = req.currentUser;
  if (!u) return { ok: false, status: 401, body: { error: "unauthorized" } };
  const isStateRole = u.role === "state_office_manager" || u.role === "state_program_officer";
  if (!isStateRole) return { ok: true };
  const stateId = u.stateId ?? null;
  if (stateId === null) {
    return { ok: false, status: 403, body: { error: "state_forbidden" } };
  }
  const { rows } = u.role === "state_program_officer"
    ? await pool.query(
      `SELECT 1 FROM project_assignments pa
       WHERE pa.project_id = $1 AND pa.user_id = $2
       LIMIT 1`,
      [projectId, u.id],
    )
    : await pool.query(
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

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      currentUser?: CurrentUser;
      authSession?: AuthenticatedSession;
    }
  }
}

// Public routes that do not require a current user. Invite acceptance must be
// reachable by a user that does not yet have a session.
const PUBLIC_PATHS = new Set([
  "/auth/login",
  "/auth/accept-invite",
  "/auth/accept-invitation",
  "/auth/forgot-password",
  "/auth/reset-password",
  "/auth/reset-password/validate",
  "/health",
  "/healthz",
]);
const PUBLIC_PREFIXES = ["/auth/invite/"];

export async function attachCurrentUser(req: Request, _res: Response, next: NextFunction) {
  try {
    // Prefer signed session cookie. Only an explicitly enabled non-production
    // demo harness permits a super_admin session to override identity.
    // The session user is verified as super_admin BEFORE honouring the header so
    // a non-admin cannot escalate privileges by injecting the header.
    // It is never honoured in production regardless of the environment flag.
    const session = await getActiveSession(req);
    req.authSession = session ?? undefined;
    let id: number | null = session?.userId ?? null;

    if (isDemoRoleHarnessEnabled() && session) {
      const headerRaw = req.header("x-user-id");
      if (headerRaw) {
        const headerId = Number(headerRaw);
        if (headerId && headerId !== session.userId) {
          const { rows: sessionRows } = await pool.query(
            `SELECT role FROM users WHERE id = $1 AND status = 'active' LIMIT 1`,
            [session.userId],
          );
          if (sessionRows[0]?.role === "super_admin") {
            id = headerId;
          }
        }
      }
    }

    if (id) {
      const result = await pool.query(
        `SELECT u.id, u.name, u.email, u.role, u.role_label, u.scope, u.state_id, u.sector, u.status, u.avatar_url,
                s.name AS state_name, s.name_ar AS state_name_ar
         FROM users u
         LEFT JOIN states s ON s.id = u.state_id
         WHERE u.id = $1
         LIMIT 1`,
        [id],
      );
      const row = result.rows[0];
      // Only attach if the user exists AND is still active. Suspended / deactivated /
      // inactive / invited accounts lose access immediately on the next request,
      // even if their session cookie is still valid.
      if (row && row.status === "active") {
        // Sector for TC may be a comma-separated list (multi-sector assignment).
        const sectors = row.role === "technical_coordinator" && row.sector
          ? String(row.sector).split(",").map((s: string) => s.trim()).filter(Boolean)
          : null;
        req.currentUser = {
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
          // The stored object key is private implementation metadata. Profile
          // photos are always dereferenced through the self-owned proxy route.
          avatarUrl: isManagedProfilePhotoPath(row.avatar_url) ? "/api/profile/photo" : null,
          sectors,
        };
      }
    }
    next();
  } catch (err) {
    next(err);
  }
}

// Gate: any /api request without a current user (and not in the public allow-list) returns 401.
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.currentUser) {
    next();
    return;
  }
  const path = req.path;
  if (PUBLIC_PATHS.has(path) || PUBLIC_PREFIXES.some((p) => path.startsWith(p))) {
    next();
    return;
  }
  res.status(401).json({ error: "unauthorized" });
}

// Internal helper: wildcard `*` grants all permissions.
export function hasPerm(perms: string[], perm: string): boolean {
  return perms.includes("*") || perms.includes(perm);
}

// Middleware factory — rejects with 403 if the authenticated user lacks `perm`.
// Use on every mutating route (create, update, approve, delete).
export function requirePerm(perm: string, message?: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.currentUser) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const perms = permissionsFor(req.currentUser);
    if (hasPerm(perms, perm)) {
      next();
    } else {
      res.status(403).json({ error: "forbidden", message: message ?? "You do not have permission to perform this action.", requiredPermission: perm });
    }
  };
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

export async function logAudit(opts: {
  userId: number | null;
  action: string;
  module: string;
  entityId?: number | null;
  oldValue?: string | null;
  newValue?: string | null;
  /** Set to true when PM/super_admin used Full Operational Access override (e.g. self-review). */
  usedOverride?: boolean;
  /** Required human-readable reason when usedOverride is true. */
  overrideReason?: string | null;
}) {
  await pool.query(
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
