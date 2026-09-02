/**
 * Effective Access Resolver
 *
 * Computes a normalised, human-readable effective-access payload for a target
 * user by calling the canonical permissionsFor() function.  Used exclusively
 * by GET /users/:id/effective-access (requires users.manage).
 *
 * Security contract:
 *   - This function never returns passwords, hashes, invite tokens, API keys,
 *     session secrets, or any credential.
 *   - It calls permissionsFor() — the same function used in every route guard —
 *     so the Inspector reflects actual runtime permissions, not a stale copy.
 *   - Inactive accounts: runtimeActive=false; permissions marked "configured but
 *     runtime access blocked" so admins can distinguish intended vs effective.
 */

import { pool } from "@workspace/db";
import { permissionsFor, hasPerm } from "../middlewares/currentUser";
import type { CurrentUser } from "../middlewares/currentUser";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EffectiveAccessScope {
  /** True when the user's role carries no state restriction. */
  orgWide: boolean;
  stateId: number | null;
  stateName: string | null;
  /**
   * null  = no sector restriction (non-TC roles)
   * []    = TC with no sectors assigned → fail-closed (no access)
   * [...] = TC assigned to these sectors
   */
  sectors: string[] | null;
  /** Number of distinct projects in project_assignments for this user. */
  projectCount: number;
  /**
   * State-role project assignments are a separate record-level access path.
   * When true, a direct assignment can extend the user's project visibility
   * beyond their normal state restriction; details remain protected.
   */
  projectAssignmentsExtendScope: boolean;
}

export interface ModuleAction {
  action: string;
  label: string;
  result: "allowed" | "denied" | "conditional";
  /** Stable translation key for why the result is what it is. */
  reasonCode: string;
  /** Diagnostic fallback for non-localised API consumers; never rendered by the UI. */
  reason: string;
}

export interface ModuleAccess {
  module: string;
  label: string;
  actions: ModuleAction[];
}

export interface EffectiveAccess {
  userId: number;
  displayName: string;
  email: string;
  role: string;
  roleLabel: string;
  scope: EffectiveAccessScope;
  accountStatus: string;
  /** True when the account is active and would receive runtime access. */
  runtimeActive: boolean;
  modules: ModuleAccess[];
}

/** Minimal representation of a target user passed to resolveEffectiveAccess. */
export interface TargetUserForAccess {
  id: number;
  name: string;
  email: string;
  role: string;
  roleLabel: string | null;
  stateId: number | null;
  stateName: string | null;
  sector: string | null;
  scope: string;
  status: string;
}

// ── Role labels (mirrors routes/users.ts ROLE_LABELS) ──────────────────────
const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  executive_director: "Executive Director",
  program_manager: "Programme Manager",
  senior_program_coordinator: "Senior Programme Coordinator",
  technical_coordinator: "Technical Coordinator",
  state_office_manager: "State Office Manager",
  state_program_officer: "State Programme Officer",
  viewer: "Viewer",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function grantedAction(action: string, label: string, permKey: string, scopeNote: string): ModuleAction {
  return {
    action,
    label,
    result: scopeNote ? "conditional" : "allowed",
    reasonCode: scopeNote ? "scope_or_record_conditions" : "capability_granted",
    reason: scopeNote
      ? `Granted via '${permKey}' — ${scopeNote}`
      : `Granted via '${permKey}'`,
  };
}

function deniedAction(action: string, label: string, permKeys: string[]): ModuleAction {
  return {
    action,
    label,
    result: "denied",
    reasonCode: "capability_missing",
    reason: `Requires: ${permKeys.join(" or ")}`,
  };
}

/**
 * Some operational list routes are intentionally authenticated-but-ungated.
 * Keep this route fact separate from permissionsFor(): it reports actual list
 * access without falsely attributing it to a capability a role does not hold.
 */
function authenticatedScopedRead(
  action: string,
  label: string,
  scopeNote: string,
): ModuleAction {
  return {
    action,
    label,
    result: "conditional",
    reasonCode: "scope_or_record_conditions",
    reason: `Available to authenticated staff — ${scopeNote}`,
  };
}

function resolveAction(
  action: string,
  label: string,
  perms: string[],
  candidates: Array<{ key: string; scopeNote: string }>,
): ModuleAction {
  const recordDependentActions = new Set([
    "view", "view_list", "create", "update", "edit", "delete",
    "approve_coordination", "approve_technical", "approve_final",
    "activate", "close", "reopen", "review", "send", "manage_members",
    "upload", "upload_attachments", "edit_structure", "edit_content",
    "update_indicators", "update_activities", "update_workplans",
    "create_beneficiaries", "announce",
  ]);
  for (const { key, scopeNote } of candidates) {
    if (hasPerm(perms, key)) {
      const effectiveScopeNote = scopeNote || (recordDependentActions.has(action)
        ? "record scope, ownership and workflow/lifecycle conditions still apply"
        : "");
      return grantedAction(action, label, key, effectiveScopeNote);
    }
  }
  return deniedAction(action, label, candidates.map((c) => c.key));
}

/**
 * State Programme Report authoring is type-specific. SPO is the normal author
 * through reports.create plus the route's SPO gate; SOM has a narrow fallback
 * capability only where no active SPO exists; super_admin uses the wildcard.
 * PM can use the Full Operational Access override with an explicit valid state.
 */
export function resolveProgramStateAuthoring(
  role: string,
  perms: string[],
  stateId: number | null,
): ModuleAction {
  if (hasPerm(perms, "*")) {
    return { action: "create_programme_state", label: "Create State Programme Reports", result: "conditional", reasonCode: "explicit_state_required", reason: "Requires an explicit valid state selection" };
  }
  if (role === "state_program_officer") {
    return stateId === null
      ? { action: "create_programme_state", label: "Create State Programme Reports", result: "denied", reasonCode: "state_not_assigned", reason: "State not assigned — access restricted" }
      : { action: "create_programme_state", label: "Create State Programme Reports", result: "allowed", reasonCode: "primary_state_author", reason: "Primary author for assigned state" };
  }
  if (role === "state_office_manager" && hasPerm(perms, "reports.program_state.create")) {
    return stateId === null
      ? { action: "create_programme_state", label: "Create State Programme Reports", result: "denied", reasonCode: "state_not_assigned", reason: "State not assigned — access restricted" }
      : { action: "create_programme_state", label: "Create State Programme Reports", result: "conditional", reasonCode: "spo_vacancy_required", reason: "Allowed only when no active State Programme Officer is assigned" };
  }
  if (role === "program_manager" && hasPerm(perms, "reports.create")) {
    return { action: "create_programme_state", label: "Create State Programme Reports", result: "conditional", reasonCode: "explicit_state_required", reason: "Requires an explicit valid state selection" };
  }
  return { action: "create_programme_state", label: "Create State Programme Reports", result: "denied", reasonCode: "report_type_not_assigned", reason: "This report type is not assigned to the role" };
}

// ── Main resolver ─────────────────────────────────────────────────────────────

export async function resolveEffectiveAccess(
  target: TargetUserForAccess,
): Promise<EffectiveAccess> {
  const role = target.role;
  const roleLabel = ROLE_LABELS[role] ?? role;

  // Build a CurrentUser shape compatible with permissionsFor()
  const sectors: string[] | null =
    role === "technical_coordinator" && target.sector
      ? target.sector.split(",").map((s) => s.trim()).filter(Boolean)
      : role === "technical_coordinator"
        ? []  // TC with no sector → fail-closed
        : null;

  const userLike: CurrentUser = {
    id: target.id,
    name: target.name,
    email: target.email,
    role,
    roleLabel,
    scope: target.scope,
    stateId: target.stateId,
    stateName: target.stateName,
    sector: target.sector,
    sectors,
    avatarUrl: null,
  };

  // Canonical permissions — same function used in every route guard.
  const perms = permissionsFor(userLike);

  // Scope
  const STATE_ROLES = new Set(["state_office_manager", "state_program_officer"]);
  const orgWide = !STATE_ROLES.has(role) && role !== "technical_coordinator";

  const assignmentResult = await pool.query<{ n: number }>(
    `SELECT COUNT(DISTINCT project_id)::int AS n FROM project_assignments WHERE user_id = $1`,
    [target.id],
  );
  const projectCount = assignmentResult.rows[0]?.n ?? 0;

  const scope: EffectiveAccessScope = {
    orgWide,
    stateId: target.stateId,
    stateName: target.stateName,
    sectors,
    projectCount,
    projectAssignmentsExtendScope: STATE_ROLES.has(role) && projectCount > 0,
  };

  // Human-readable scope labels for reason strings
  const stateScopeNote = orgWide
    ? "organisation-wide"
    : target.stateName
      ? `state-scoped to ${target.stateName}`
      : "state-scoped (no state assigned — access restricted)";

  const sectorScopeNote =
    sectors === null
      ? "organisation-wide"
      : sectors.length > 0
        ? `sector-scoped to: ${sectors.join(", ")}`
        : "no sector assigned — access restricted";
  const operationalScopeNote = role === "technical_coordinator"
    ? sectorScopeNote
    : orgWide
      ? "organisation-wide"
      : stateScopeNote;

  // Per-module action matrix
  const modules: ModuleAccess[] = [
    {
      module: "projects",
      label: "Projects",
      actions: [
        authenticatedScopedRead("view_list", "View project list", operationalScopeNote),
        resolveAction("create", "Create projects", perms, [{ key: "projects.create", scopeNote: orgWide ? "" : stateScopeNote }]),
        resolveAction("update", "Edit projects", perms, [{ key: "projects.update", scopeNote: orgWide ? "" : stateScopeNote }]),
        resolveAction("approve_coordination", "Coordination review", perms, [{ key: "projects.approve.coordination", scopeNote: "" }]),
        resolveAction("approve_technical", "Technical review", perms, [{ key: "projects.approve.technical", scopeNote: role === "technical_coordinator" ? sectorScopeNote : "" }]),
        resolveAction("approve_final", "Final approval", perms, [{ key: "projects.approve.final", scopeNote: "" }]),
        resolveAction("activate", "Activate approved projects", perms, [{ key: "projects.activate", scopeNote: "" }]),
        resolveAction("close", "Close projects", perms, [{ key: "projects.close", scopeNote: "" }]),
        resolveAction("delete", "Delete projects", perms, [{ key: "projects.delete", scopeNote: "" }]),
      ],
    },
    {
      module: "reports",
      label: "Reports",
      actions: [
        resolveAction("view", "View reports", perms, [
          { key: "reports.view",       scopeNote: role === "technical_coordinator" ? sectorScopeNote : orgWide ? "organisation-wide" : stateScopeNote },
          { key: "reports.view.state", scopeNote: stateScopeNote },
        ]),
        resolveAction("create", "Create / submit reports", perms, [{ key: "reports.create", scopeNote: role === "technical_coordinator" ? sectorScopeNote : orgWide ? "" : stateScopeNote }]),
        resolveProgramStateAuthoring(role, perms, target.stateId),
        resolveAction("update", "Edit draft reports", perms, [{ key: "reports.update", scopeNote: "" }]),
        resolveAction("delete", "Delete draft reports", perms, [{ key: "reports.delete", scopeNote: "" }]),
        resolveAction("approve_coordination", "Coordination review", perms, [{ key: "reports.approve.coordination", scopeNote: "" }]),
        resolveAction("approve_technical", "Technical review", perms, [{ key: "reports.approve.technical", scopeNote: role === "technical_coordinator" ? sectorScopeNote : "" }]),
        resolveAction("approve_final", "Final approval", perms, [{ key: "reports.approve.final", scopeNote: "" }]),
      ],
    },
    {
      module: "plans",
      label: "Plans",
      actions: [
        authenticatedScopedRead("view", "View plans", operationalScopeNote),
        resolveAction("create", "Create plans", perms, [{ key: "plans.create", scopeNote: orgWide ? "" : stateScopeNote }]),
        resolveAction("update", "Edit plans", perms, [{ key: "plans.update", scopeNote: "" }]),
        resolveAction("approve_coordination", "Coordination review", perms, [{ key: "plans.approve.coordination", scopeNote: "" }]),
        resolveAction("approve_technical", "Technical review", perms, [{ key: "plans.approve.technical", scopeNote: role === "technical_coordinator" ? sectorScopeNote : "" }]),
        resolveAction("approve_final", "Final approval", perms, [{ key: "plans.approve.final", scopeNote: "" }]),
        resolveAction("reopen", "Reopen approved plans", perms, [{ key: "plans.reopen", scopeNote: role === "technical_coordinator" ? sectorScopeNote : "" }]),
        resolveAction("delete", "Delete plans", perms, [{ key: "plans.delete", scopeNote: "" }]),
      ],
    },
    {
      module: "risks",
      label: "Risks",
      actions: [
        resolveAction("view", "View risks", perms, [
          { key: "risks.view",       scopeNote: role === "technical_coordinator" ? sectorScopeNote : "organisation-wide" },
          { key: "risks.view.state", scopeNote: stateScopeNote },
        ]),
        resolveAction("create", "Create risks", perms, [{ key: "risks.create", scopeNote: orgWide ? "" : stateScopeNote }]),
        resolveAction("update", "Update risks", perms, [{ key: "risks.update", scopeNote: "" }]),
        // RISK-BD-05: individual risks are never directly deletable by any role —
        // a risk is only ever removed as a cascade side effect of permanently
        // deleting its linked Project (see routes/risks.ts, RISK-DEL-14). No
        // "Delete risks" action belongs here; risks.delete is not a real,
        // reachable capability and must not be advertised as one.
        resolveAction("administer_risks", "Administer risk register", perms, [{ key: "risks.admin", scopeNote: "" }]),
      ],
    },
    {
      module: "budget",
      label: "Budget & Finance",
      actions: [
        resolveAction("view", "View budget data", perms, [
          { key: "budget.view.all",    scopeNote: "all locations" },
          { key: "budget.view.sector", scopeNote: sectorScopeNote },
          { key: "budget.view.state",  scopeNote: stateScopeNote },
          { key: "budget.view",        scopeNote: orgWide ? "scoped" : stateScopeNote },
        ]),
        resolveAction("create", "Create budget entries", perms, [{ key: "budget.create", scopeNote: role === "technical_coordinator" ? sectorScopeNote : "" }]),
        resolveAction("edit", "Edit budget entries", perms, [{ key: "budget.edit", scopeNote: "" }]),
        resolveAction("review", "Review budgets", perms, [{ key: "budget.review", scopeNote: "" }]),
        resolveAction("approve_final", "Final approval", perms, [{ key: "budget.approve.final", scopeNote: "" }]),
      ],
    },
    {
      module: "users",
      label: "User Management",
      actions: [
        resolveAction("view", "View user directory", perms, [{ key: "users.view", scopeNote: "" }]),
        resolveAction("manage", "Create / edit / delete users", perms, [{ key: "users.manage", scopeNote: "" }]),
      ],
    },
    {
      module: "dashboard",
      label: "Dashboard",
      actions: [
        resolveAction("view", "View dashboard", perms, [
          { key: "dashboard.view.org",   scopeNote: "organisation-wide" },
          { key: "dashboard.view.state", scopeNote: stateScopeNote },
        ]),
      ],
    },
    {
      module: "audit",
      label: "Audit Log",
      actions: [
        resolveAction("view", "View audit log", perms, [
          { key: "audit.view", scopeNote: orgWide ? "organisation-wide" : `${stateScopeNote} (server-enforced)` },
        ]),
      ],
    },
    {
      module: "documents",
      label: "Documents",
      actions: [
        resolveAction("view", "View documents", perms, [{ key: "documents.view", scopeNote: "" }]),
        resolveAction("upload", "Upload documents", perms, [{ key: "documents.upload", scopeNote: "" }]),
      ],
    },
    {
      module: "messages",
      label: "Communications",
      actions: [
        resolveAction("view", "View messages", perms, [{ key: "messages.view", scopeNote: role === "viewer" ? "text-only for viewer" : "" }]),
        resolveAction("create", "Create conversations", perms, [{ key: "messages.create", scopeNote: "" }]),
        resolveAction("send", "Send messages", perms, [{ key: "messages.send", scopeNote: "" }]),
        resolveAction("manage_members", "Manage conversation members", perms, [{ key: "messages.manage_members", scopeNote: "" }]),
        resolveAction("announce", "Send organisation announcements", perms, [{ key: "messages.announce", scopeNote: "" }]),
        resolveAction("upload_attachments", "Upload attachments", perms, [{ key: "messages.attachments.upload", scopeNote: "" }]),
      ],
    },
    {
      module: "notifications",
      label: "Notifications",
      actions: [
        resolveAction("view", "View own notifications", perms, [{ key: "notifications.view", scopeNote: "self-scoped" }]),
      ],
    },
    {
      module: "states",
      label: "State Registry",
      actions: [
        resolveAction("view", "View state reference data", perms, [{ key: "states.view", scopeNote: "" }]),
      ],
    },
    {
      module: "comments",
      label: "Comments",
      actions: [
        resolveAction("create", "Create workflow comments", perms, [{ key: "comments.create", scopeNote: "record workflow rules still apply" }]),
      ],
    },
    {
      module: "programme_operations",
      label: "Programme Operations",
      actions: [
        resolveAction("update_indicators", "Update indicators", perms, [{ key: "indicators.update", scopeNote: stateScopeNote }]),
        resolveAction("update_activities", "Update activities", perms, [{ key: "activities.update", scopeNote: stateScopeNote }]),
        resolveAction("update_workplans", "Update workplans", perms, [{ key: "workplans.update", scopeNote: stateScopeNote }]),
        resolveAction("create_beneficiaries", "Record beneficiaries", perms, [{ key: "beneficiaries.create", scopeNote: stateScopeNote }]),
      ],
    },
    {
      module: "settings",
      label: "System Settings",
      actions: [
        resolveAction("view_settings", "View system settings", perms, [{ key: "settings.view", scopeNote: "" }]),
      ],
    },
    {
      module: "ai",
      label: "AI Governance",
      actions: [
        resolveAction("manage_settings", "Manage AI settings", perms, [{ key: "ai.settings.manage", scopeNote: "" }]),
        resolveAction("view_logs", "View AI logs", perms, [{ key: "ai.logs.view", scopeNote: "" }]),
      ],
    },
    {
      module: "storage",
      label: "File Repository",
      actions: [
        resolveAction("administer", "Administer file repository", perms, [{ key: "storage.admin", scopeNote: "" }]),
      ],
    },
    {
      module: "manual",
      label: "System Manual",
      actions: [
        resolveAction("view", "View manual", perms, [{ key: "manual.view", scopeNote: "" }]),
        resolveAction("edit_structure", "Create / delete chapters", perms, [{ key: "manual.edit", scopeNote: "" }]),
        resolveAction("edit_content", "Edit sections & SOPs", perms, [{ key: "manual.edit.content", scopeNote: "" }]),
        resolveAction("manage_training", "Manage training videos & certificates", perms, [{ key: "training_videos.manage", scopeNote: "" }]),
      ],
    },
    {
      module: "program_resources",
      label: "Programme Resources",
      actions: [
        resolveAction("view", "View resources", perms, [{ key: "program_resources.view", scopeNote: "" }]),
        resolveAction("upload", "Upload resources", perms, [{ key: "program_resources.upload", scopeNote: "" }]),
        resolveAction("edit", "Edit resources", perms, [{ key: "program_resources.edit", scopeNote: "" }]),
        resolveAction("delete", "Delete resources", perms, [{ key: "program_resources.delete", scopeNote: "" }]),
      ],
    },
  ];

  // If the account is not active, mark all granted permissions as "configured but blocked"
  const runtimeActive = target.status === "active";
  if (!runtimeActive) {
    for (const mod of modules) {
      for (const act of mod.actions) {
        if (act.result !== "denied") {
          act.result = "conditional";
          act.reason = `Configured: ${act.reason} — Runtime blocked: account is ${target.status}`;
        }
      }
    }
  }

  return {
    userId: target.id,
    displayName: target.name,
    email: target.email,
    role,
    roleLabel,
    scope,
    accountStatus: target.status,
    runtimeActive,
    modules,
  };
}
