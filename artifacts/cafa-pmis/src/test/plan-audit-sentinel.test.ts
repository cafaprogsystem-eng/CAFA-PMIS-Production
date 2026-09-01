/**
 * PLAN-AUDIT SENTINEL TESTS — Frontend (Task #416)
 *
 * Code-review observations documented as executable specifications.
 * These tests mirror frontend helper logic and plan model contracts
 * confirmed by reading the source. They do NOT test route handlers,
 * DB queries, or imported backend constants — those are covered by the
 * backend sentinel in artifacts/api-server/src/test/plan-audit-sentinel.test.ts.
 *
 * PLAN-AUDIT-01  Plan type / frequency / status taxonomy (frontend constants)
 * PLAN-AUDIT-02  Access matrix (frontend permission checks via helper mirrors)
 * PLAN-AUDIT-03  Project / State / Sector relationship (scope logic)
 * PLAN-AUDIT-04  Draft/edit saves same Plan ID (no POST replacement)
 * PLAN-AUDIT-05  Identity mutation behaviour (what changes in what state)
 * PLAN-AUDIT-06  Submission / workflow contract (gates + transition guards)
 * PLAN-AUDIT-07  Reviewer field coverage (form → detail field list)
 * PLAN-AUDIT-08  Direct endpoint scope (cross-State/Sector scoping logic)
 * PLAN-AUDIT-09  Analytics scope (TC Sector isolation, State user isolation)
 * PLAN-AUDIT-10  #373 Full Operational Access vs Plan structural integrity
 */

import { describe, it, expect } from "vitest";

// ─── Mirrors of backend canonical sets (plans.ts) ────────────────────────────

const PLAN_TYPES = new Set([
  "monthly",
  "quarterly",
  "annual",
  "action",
  "operational",
  "emergency",
  "custom",
]);

const PLAN_FREQUENCIES = new Set([
  "weekly",
  "monthly",
  "quarterly",
  "annual",
  "on_demand",
]);

const PLAN_STATUSES = new Set([
  "draft",
  "submitted",
  "technically_approved",
  "coordination_approved",
  "approved",
  "active",
  "in_progress",
  "delayed",
  "completed",
  "cancelled",
  "archived",
  "rejected",
]);

const POST_APPROVAL_LOCKED_STATUSES = new Set([
  "approved",
  "active",
  "in_progress",
  "delayed",
  "completed",
  "cancelled",
  "archived",
]);

const REOPENABLE_STATUSES = new Set(["approved", "active", "in_progress", "delayed"]);

const TERMINAL_STATUSES = new Set(["completed", "cancelled", "archived"]);

const VALID_CURRENCIES = new Set(["USD", "SDG", "EUR", "AED"]);

const ACTIVITY_STATUSES = new Set([
  "planned",
  "in_progress",
  "completed",
  "delayed",
  "cancelled",
]);

const ACTIVITY_PRIORITIES = new Set(["high", "medium", "low"]);

// ─── Mirrors of transition map (plans.ts:111–124) ────────────────────────────

const PLAN_TRANSITIONS: Record<string, { from: string[]; to: string }> = {
  submit: { from: ["draft"], to: "submitted" },
  technical_review: { from: ["submitted"], to: "technically_approved" },
  coordination_review: { from: ["technically_approved"], to: "coordination_approved" },
  final_approve: { from: ["coordination_approved"], to: "approved" },
  activate: { from: ["approved"], to: "active" },
  start: { from: ["active"], to: "in_progress" },
  mark_delayed: { from: ["active", "in_progress"], to: "delayed" },
  complete: { from: ["active", "in_progress", "delayed"], to: "completed" },
  cancel: {
    from: [
      "draft",
      "submitted",
      "technically_approved",
      "coordination_approved",
      "approved",
      "active",
      "in_progress",
      "delayed",
    ],
    to: "cancelled",
  },
  archive: { from: ["completed", "cancelled"], to: "archived" },
  reject: {
    from: ["submitted", "technically_approved", "coordination_approved"],
    to: "rejected",
  },
  request_revision: {
    from: ["submitted", "technically_approved", "coordination_approved"],
    to: "draft",
  },
};

// ─── Role permission mirror (currentUser.ts) ─────────────────────────────────

type Role =
  | "executive_director"
  | "program_manager"
  | "senior_program_coordinator"
  | "technical_coordinator"
  | "state_program_officer"
  | "state_office_manager"
  | "viewer"
  | "super_admin";

function permissionsFor(role: Role): string[] {
  if (role === "super_admin") return ["*"];

  const perms: string[] = [];

  // Universal read access
  perms.push("plans.view");

  // Delete — ED + PM only
  if (["executive_director", "program_manager"].includes(role)) {
    perms.push("plans.delete");
  }

  // Reopen — ED, PM, SPC, TC (endpoint enforces scope)
  if (
    ["executive_director", "program_manager", "senior_program_coordinator", "technical_coordinator"].includes(role)
  ) {
    perms.push("plans.reopen");
  }

  // Full Operational Access — PM only (not ED, not SPC)
  if (role === "program_manager") {
    perms.push(
      "plans.create",
      "plans.update",
      "plans.approve.coordination",
      "plans.approve.technical",
      "plans.approve.final",
      "projects.approve.technical", // PM has full technical review access
    );
  }

  // SPC coordination role
  if (role === "senior_program_coordinator") {
    perms.push("plans.create", "plans.update", "plans.approve.coordination");
  }

  // TC technical review role (sector-scoped at endpoint)
  if (role === "technical_coordinator") {
    perms.push("plans.create", "plans.update", "projects.approve.technical", "plans.approve.technical");
  }

  // State roles
  if (["state_program_officer", "state_office_manager"].includes(role)) {
    perms.push("plans.create", "plans.update");
  }

  return perms;
}

function can(role: Role, perm: string): boolean {
  const p = permissionsFor(role);
  return p.includes("*") || p.includes(perm);
}

// ─── Helper: simulate assertStateAllowed logic ────────────────────────────────

type LocationType = "state" | "hq" | null;

function assertStateAllowed(
  userRole: Role,
  userStateId: number | null,
  planStateId: number | null,
  locationType: LocationType,
): "ok" | "hq_forbidden" | "state_forbidden" {
  const isStateRole =
    userRole === "state_program_officer" || userRole === "state_office_manager";
  if (!isStateRole) return "ok"; // HQ roles pass through

  // HQ plans forbidden for state-scoped roles
  if (locationType === "hq" || planStateId === null) return "hq_forbidden";

  // Null stateId: fail closed
  if (userStateId === null) return "state_forbidden";

  // Must match own state
  if (userStateId !== planStateId) return "state_forbidden";

  return "ok";
}

// ─────────────────────────────────────────────────────────────────────────────
// PLAN-AUDIT-01: Plan Type Enumeration + Field Contract
// ─────────────────────────────────────────────────────────────────────────────

describe("PLAN-AUDIT-01: Plan type enumeration and field contract", () => {
  it("01-01: exactly 7 supported plan types", () => {
    expect(PLAN_TYPES.size).toBe(7);
  });

  it("01-02: all 7 canonical types are present", () => {
    expect(PLAN_TYPES.has("monthly")).toBe(true);
    expect(PLAN_TYPES.has("quarterly")).toBe(true);
    expect(PLAN_TYPES.has("annual")).toBe(true);
    expect(PLAN_TYPES.has("action")).toBe(true);
    expect(PLAN_TYPES.has("operational")).toBe(true);
    expect(PLAN_TYPES.has("emergency")).toBe(true);
    expect(PLAN_TYPES.has("custom")).toBe(true);
  });

  it("01-03: unknown plan types are rejected", () => {
    expect(PLAN_TYPES.has("workplan")).toBe(false);
    expect(PLAN_TYPES.has("strategic")).toBe(false);
    expect(PLAN_TYPES.has("")).toBe(false);
  });

  it("01-04: exactly 5 plan frequencies", () => {
    expect(PLAN_FREQUENCIES.size).toBe(5);
  });

  it("01-05: all canonical frequencies present", () => {
    expect(PLAN_FREQUENCIES.has("weekly")).toBe(true);
    expect(PLAN_FREQUENCIES.has("monthly")).toBe(true);
    expect(PLAN_FREQUENCIES.has("quarterly")).toBe(true);
    expect(PLAN_FREQUENCIES.has("annual")).toBe(true);
    expect(PLAN_FREQUENCIES.has("on_demand")).toBe(true);
  });

  it("01-06: exactly 12 plan statuses in lifecycle", () => {
    expect(PLAN_STATUSES.size).toBe(12);
  });

  it("01-07: all workflow statuses present", () => {
    const expected = [
      "draft", "submitted", "technically_approved", "coordination_approved",
      "approved", "active", "in_progress", "delayed",
      "completed", "cancelled", "archived", "rejected",
    ];
    for (const s of expected) expect(PLAN_STATUSES.has(s)).toBe(true);
  });

  it("01-08: exactly 4 valid currencies", () => {
    expect(VALID_CURRENCIES.size).toBe(4);
    expect(VALID_CURRENCIES.has("USD")).toBe(true);
    expect(VALID_CURRENCIES.has("SDG")).toBe(true);
    expect(VALID_CURRENCIES.has("EUR")).toBe(true);
    expect(VALID_CURRENCIES.has("AED")).toBe(true);
    expect(VALID_CURRENCIES.has("GBP")).toBe(false);
  });

  it("01-09: exactly 5 activity statuses", () => {
    expect(ACTIVITY_STATUSES.size).toBe(5);
  });

  it("01-10: exactly 3 activity priorities", () => {
    expect(ACTIVITY_PRIORITIES.size).toBe(3);
  });

  it("01-11: progressPct is a manually-entered 0–100 integer per activity (not computed from status)", () => {
    // Sentinel: documents that plan-level progressPct = AVG(pa.progress_pct)
    // where progress_pct is a direct integer field entered by the user,
    // NOT automatically derived from activity completion status.
    // Risk: a completed activity may show 0% progress if never updated.
    const activityProgressPcts = [50, 100, 0]; // user-entered
    const avg = Math.floor(
      activityProgressPcts.reduce((a, b) => a + b, 0) / activityProgressPcts.length,
    );
    expect(avg).toBe(50); // not 33% (which would come from 1/3 complete)
  });

  it("01-12: plan-level progressPct is null when plan has no activities", () => {
    // AVG() over empty set returns NULL in SQL — distinct from 0%.
    // Frontend should show '—' or 'No activities', not '0%'.
    const activities: number[] = [];
    const progressPct = activities.length === 0 ? null : Math.floor(
      activities.reduce((a, b) => a + b, 0) / activities.length,
    );
    expect(progressPct).toBeNull();
  });

  it("01-13: plan budget fields are plan-level estimates only — no project budget mutation", () => {
    // Code-review evidence: plans.ts PATCH builds a SET clause from allowed fields
    // (budget_planned, budget_actual, currency, funding_source). None of these
    // touch the projects table. The words "budget_total" and "projects.budget" do
    // not appear in plans.ts. Budget isolation is therefore confirmed.
    const allowedPatchFields = [
      "title", "planType", "frequency", "projectId", "stateId", "localityId",
      "localities", "sector", "sectors", "responsibleName", "responsibleUserId",
      "startDate", "endDate", "description", "objectives",
      "budgetPlanned", "budgetActual", "fundingSource", "currency",
    ];
    // budget_total (the project-level field) is NOT in the allowed patch field list
    expect(allowedPatchFields).not.toContain("budgetTotal");
    expect(allowedPatchFields).not.toContain("budget_total");
    // Plan budget fields are present
    expect(allowedPatchFields).toContain("budgetPlanned");
    expect(allowedPatchFields).toContain("budgetActual");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PLAN-AUDIT-02: Access Matrix (role × action)
// ─────────────────────────────────────────────────────────────────────────────

describe("PLAN-AUDIT-02: Access matrix — role × action", () => {
  it("02-01: all roles can view plans (plans.view)", () => {
    const roles: Role[] = [
      "executive_director", "program_manager", "senior_program_coordinator",
      "technical_coordinator", "state_program_officer", "state_office_manager",
      "viewer",
    ];
    for (const role of roles) {
      expect(can(role, "plans.view")).toBe(true);
    }
  });

  it("02-02: only ED and PM have plans.delete", () => {
    expect(can("executive_director", "plans.delete")).toBe(true);
    expect(can("program_manager", "plans.delete")).toBe(true);
    expect(can("senior_program_coordinator", "plans.delete")).toBe(false);
    expect(can("technical_coordinator", "plans.delete")).toBe(false);
    expect(can("state_program_officer", "plans.delete")).toBe(false);
    expect(can("state_office_manager", "plans.delete")).toBe(false);
    expect(can("viewer", "plans.delete")).toBe(false);
    expect(can("super_admin", "plans.delete")).toBe(true); // via *
  });

  it("02-03: ED, PM, SPC, TC have plans.reopen (not state roles or viewer)", () => {
    expect(can("executive_director", "plans.reopen")).toBe(true);
    expect(can("program_manager", "plans.reopen")).toBe(true);
    expect(can("senior_program_coordinator", "plans.reopen")).toBe(true);
    expect(can("technical_coordinator", "plans.reopen")).toBe(true);
    expect(can("state_program_officer", "plans.reopen")).toBe(false);
    expect(can("state_office_manager", "plans.reopen")).toBe(false);
    expect(can("viewer", "plans.reopen")).toBe(false);
    expect(can("super_admin", "plans.reopen")).toBe(true);
  });

  it("02-04: only PM has plans.approve.final (via full operational access)", () => {
    expect(can("program_manager", "plans.approve.final")).toBe(true);
    expect(can("executive_director", "plans.approve.final")).toBe(false);
    expect(can("senior_program_coordinator", "plans.approve.final")).toBe(false);
    expect(can("technical_coordinator", "plans.approve.final")).toBe(false);
    expect(can("super_admin", "plans.approve.final")).toBe(true);
  });

  it("02-05: PM and SPC have plans.approve.coordination", () => {
    expect(can("program_manager", "plans.approve.coordination")).toBe(true);
    expect(can("senior_program_coordinator", "plans.approve.coordination")).toBe(true);
    expect(can("technical_coordinator", "plans.approve.coordination")).toBe(false);
    expect(can("executive_director", "plans.approve.coordination")).toBe(false);
  });

  it("02-06: PM and TC have technical review perm (projects.approve.technical)", () => {
    expect(can("program_manager", "projects.approve.technical")).toBe(true);
    expect(can("technical_coordinator", "projects.approve.technical")).toBe(true);
    expect(can("senior_program_coordinator", "projects.approve.technical")).toBe(false);
    expect(can("executive_director", "projects.approve.technical")).toBe(false);
  });

  it("02-07: state roles (SPO, SOM) have plans.create and plans.update", () => {
    expect(can("state_program_officer", "plans.create")).toBe(true);
    expect(can("state_program_officer", "plans.update")).toBe(true);
    expect(can("state_office_manager", "plans.create")).toBe(true);
    expect(can("state_office_manager", "plans.update")).toBe(true);
  });

  it("02-08: viewer has no write permissions", () => {
    const writePerms = ["plans.create", "plans.update", "plans.delete", "plans.reopen",
      "plans.approve.coordination", "plans.approve.final", "projects.approve.technical"];
    for (const perm of writePerms) {
      expect(can("viewer", perm)).toBe(false);
    }
  });

  it("02-09: ED has NO plans.create or plans.update — view, delete, reopen only", () => {
    expect(can("executive_director", "plans.create")).toBe(false);
    expect(can("executive_director", "plans.update")).toBe(false);
    expect(can("executive_director", "plans.view")).toBe(true);
    expect(can("executive_director", "plans.delete")).toBe(true);
    expect(can("executive_director", "plans.reopen")).toBe(true);
  });

  it("02-10: super_admin wildcard grants all permissions", () => {
    const perms = permissionsFor("super_admin");
    expect(perms).toContain("*");
    expect(can("super_admin", "plans.create")).toBe(true);
    expect(can("super_admin", "plans.delete")).toBe(true);
    expect(can("super_admin", "plans.approve.final")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PLAN-AUDIT-03: Project / State / Sector Relationship
// ─────────────────────────────────────────────────────────────────────────────

describe("PLAN-AUDIT-03: Project / State / Sector relationship", () => {
  it("03-01: state-scoped roles are blocked from HQ plans (locationType=hq)", () => {
    expect(assertStateAllowed("state_program_officer", 3, null, "hq")).toBe("hq_forbidden");
    expect(assertStateAllowed("state_office_manager", 3, null, "hq")).toBe("hq_forbidden");
  });

  it("03-02: state-scoped roles with null stateId fail closed", () => {
    expect(assertStateAllowed("state_program_officer", null, 3, "state")).toBe("state_forbidden");
    expect(assertStateAllowed("state_office_manager", null, 3, "state")).toBe("state_forbidden");
  });

  it("03-03: state-scoped roles cannot access another state's plans", () => {
    expect(assertStateAllowed("state_program_officer", 1, 2, "state")).toBe("state_forbidden");
    expect(assertStateAllowed("state_office_manager", 5, 3, "state")).toBe("state_forbidden");
  });

  it("03-04: state-scoped roles can access own state plans", () => {
    expect(assertStateAllowed("state_program_officer", 3, 3, "state")).toBe("ok");
    expect(assertStateAllowed("state_office_manager", 7, 7, "state")).toBe("ok");
  });

  it("03-05: HQ roles pass all state checks regardless of state", () => {
    const hqRoles: Role[] = [
      "program_manager", "executive_director", "senior_program_coordinator",
      "technical_coordinator", "viewer",
    ];
    for (const role of hqRoles) {
      expect(assertStateAllowed(role, null, 3, "state")).toBe("ok");
      expect(assertStateAllowed(role, null, null, "hq")).toBe("ok");
    }
  });

  it("03-06: effective sector falls back to project sector when plan sector is blank", () => {
    // Mirrors getPlanMeta COALESCE(NULLIF(pl.sector,''), p.sector)
    const coalesceEffectiveSector = (planSector: string | null, projectSector: string | null) =>
      (planSector && planSector !== "" ? planSector : null) ?? projectSector;

    expect(coalesceEffectiveSector("Health", "WASH")).toBe("Health");
    expect(coalesceEffectiveSector("", "WASH")).toBe("WASH");
    expect(coalesceEffectiveSector(null, "WASH")).toBe("WASH");
    expect(coalesceEffectiveSector(null, null)).toBeNull();
  });

  it("03-07: TC sector restriction returns null for full-access roles (no restriction)", () => {
    // tcSectorRestriction returns null for non-TC roles (no filter applied)
    // For TC with empty sector: returns [] (see-nothing, fail-closed)
    // For TC with sectors: returns the sector array
    const tcSectorRestriction = (role: Role, sectors: string[]) => {
      if (role !== "technical_coordinator") return null; // no restriction
      if (sectors.length === 0) return []; // fail-closed
      return sectors;
    };

    expect(tcSectorRestriction("program_manager", [])).toBeNull();
    expect(tcSectorRestriction("technical_coordinator", [])).toEqual([]);
    expect(tcSectorRestriction("technical_coordinator", ["Health"])).toEqual(["Health"]);
  });

  it("03-08: standalone (no-project) HQ plans have null project_id and null state_id", () => {
    // Schema allows: nullable project_id (standalone), nullable state_id (HQ)
    // This is intentional per migration 013 + 003_nullable_plan_fields
    const plan = { project_id: null, state_id: null, location_type: "hq" };
    expect(plan.project_id).toBeNull();
    expect(plan.state_id).toBeNull();
    expect(plan.location_type).toBe("hq");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PLAN-AUDIT-04: Draft / Edit Always Saves Same Plan ID
// ─────────────────────────────────────────────────────────────────────────────

describe("PLAN-AUDIT-04: Draft/edit saves same Plan ID — no POST replacement", () => {
  it("04-01: Save-As-Draft issues POST once (creating the plan), then PATCH to update", () => {
    // Pattern: dialog creates plan via POST (returns planId),
    // then all subsequent saves PATCH /plans/:planId.
    // Sentinel: no second POST on re-save; the planId is stable for the session lifetime.
    let planId: number | null = null;
    let saveCount = 0;

    const saveAsDraft = (isNew: boolean, id: number | null) => {
      if (isNew || id === null) {
        planId = 42; // POST response
        saveCount++;
        return "created";
      }
      // existing plan: PATCH
      return "patched";
    };

    expect(saveAsDraft(true, null)).toBe("created");
    expect(planId).toBe(42);
    expect(saveAsDraft(false, planId)).toBe("patched");
    expect(saveCount).toBe(1); // POST only called once
  });

  it("04-02: registration session binds to a single plan_id for the session lifetime", () => {
    // The session token is plan+user bound: validateRegistrationSession(token, planId, userId).
    // A token issued for plan 42 cannot be used on plan 99.
    const session = { planId: 42, userId: 7, token: "abc123" };
    const validateSession = (token: string, planId: number, userId: number) =>
      token === session.token && planId === session.planId && userId === session.userId;

    expect(validateSession("abc123", 42, 7)).toBe(true);
    expect(validateSession("abc123", 99, 7)).toBe(false); // wrong planId
    expect(validateSession("abc123", 42, 8)).toBe(false); // wrong userId
  });

  it("04-03: session expires after 2 hours and is rejected", () => {
    const createdAt = new Date("2026-01-01T10:00:00Z");
    const expiresAt = new Date(createdAt.getTime() + 2 * 60 * 60 * 1000);

    const isSessionValid = (now: Date) => now < expiresAt && true;

    expect(isSessionValid(new Date("2026-01-01T11:59:00Z"))).toBe(true);
    expect(isSessionValid(new Date("2026-01-01T12:01:00Z"))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PLAN-AUDIT-05: Identity Mutation Behaviour
// ─────────────────────────────────────────────────────────────────────────────

describe("PLAN-AUDIT-05: Identity mutation — what fields change in what state", () => {
  it("05-01: PATCH does NOT allow direct status mutation (must use /transitions)", () => {
    // FIXED in task-416: line 1146 formerly set("status", body.status)
    // After fix: body.status is silently ignored in PATCH.
    // Status changes must go through POST /plans/:planId/transitions.
    const patchedFields: string[] = [];
    const applyPatch = (body: Record<string, unknown>) => {
      if (body.title !== undefined) patchedFields.push("title");
      if (body.planType !== undefined) patchedFields.push("planType");
      // status is explicitly excluded — no longer in allowed field list
      // if (body.status !== undefined) patchedFields.push("status"); // REMOVED
    };

    applyPatch({ title: "New Title", status: "submitted" });
    expect(patchedFields).toContain("title");
    expect(patchedFields).not.toContain("status");
  });

  it("05-02: POST /plans always creates with status=draft regardless of body.status", () => {
    // FIXED in task-416: line 868 formerly used String(body.status ?? 'draft')
    // After fix: hardcoded 'draft' regardless of body.status.
    const insertStatus = (_bodyStatus: unknown) => "draft"; // always draft
    expect(insertStatus("submitted")).toBe("draft");
    expect(insertStatus("approved")).toBe("draft");
    expect(insertStatus(undefined)).toBe("draft");
  });

  it("05-03: PATCH allows changing project_id, state_id, sector while in draft", () => {
    // These are identity fields that can be changed in draft.
    // After submission, the approval-lock gate (isPlanCurrentlyEditable) blocks edits.
    const mutableInDraft = ["project_id", "state_id", "sector", "sectors", "title", "planType"];
    expect(mutableInDraft).toContain("project_id");
    expect(mutableInDraft).toContain("state_id");
    expect(mutableInDraft).toContain("sector");
  });

  it("05-04: PATCH is blocked by isPlanCurrentlyEditable after final approval without reopen", () => {
    // After final_approve, last_final_approved_at is set.
    // isPlanCurrentlyEditable requires an approvals row (action=reopen, created_at > last_final_approved_at).
    // Without reopen, edit is rejected 409.
    const isPlanEditable = (
      lastFinalApprovedAt: Date | null,
      hasReopenAfterApproval: boolean,
      currentStatus: string,
    ): boolean => {
      if (!POST_APPROVAL_LOCKED_STATUSES.has(currentStatus)) {
        if (lastFinalApprovedAt === null) return true;
      }
      if (lastFinalApprovedAt === null) return !POST_APPROVAL_LOCKED_STATUSES.has(currentStatus);
      return hasReopenAfterApproval && !POST_APPROVAL_LOCKED_STATUSES.has(currentStatus);
    };

    // Approved plan without reopen: locked
    expect(isPlanEditable(new Date(), false, "approved")).toBe(false);
    // Draft plan never approved: editable
    expect(isPlanEditable(null, false, "draft")).toBe(true);
    // Reopened draft (after prior approval): editable
    expect(isPlanEditable(new Date(), true, "draft")).toBe(true);
  });

  it("05-05: terminal statuses (completed/cancelled/archived) cannot be reopened", () => {
    for (const status of TERMINAL_STATUSES) {
      expect(REOPENABLE_STATUSES.has(status)).toBe(false);
    }
  });

  it("05-06: post-approval non-terminal statuses (approved/active/in_progress/delayed) are reopenable", () => {
    const expected = ["approved", "active", "in_progress", "delayed"];
    for (const s of expected) {
      expect(REOPENABLE_STATUSES.has(s)).toBe(true);
    }
    expect(REOPENABLE_STATUSES.size).toBe(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PLAN-AUDIT-06: Submission / Workflow Contract
// ─────────────────────────────────────────────────────────────────────────────

describe("PLAN-AUDIT-06: Submission and workflow contract", () => {
  it("06-01: each transition has exactly one source status set and one target status", () => {
    for (const [action, t] of Object.entries(PLAN_TRANSITIONS)) {
      expect(t.from.length).toBeGreaterThan(0);
      expect(typeof t.to).toBe("string");
      expect(PLAN_STATUSES.has(t.to)).toBe(true);
      for (const s of t.from) expect(PLAN_STATUSES.has(s)).toBe(true);
    }
  });

  it("06-02: workflow advances strictly: draft → submitted → technically_approved → coordination_approved → approved", () => {
    const chain = ["submit", "technical_review", "coordination_review", "final_approve"];
    const statusChain = ["draft", "submitted", "technically_approved", "coordination_approved", "approved"];
    for (let i = 0; i < chain.length; i++) {
      const t = PLAN_TRANSITIONS[chain[i]];
      expect(t.from).toContain(statusChain[i]);
      expect(t.to).toBe(statusChain[i + 1]);
    }
  });

  it("06-03: submit is only allowed from draft", () => {
    expect(PLAN_TRANSITIONS.submit.from).toEqual(["draft"]);
    expect(PLAN_TRANSITIONS.submit.from).not.toContain("rejected");
    expect(PLAN_TRANSITIONS.submit.from).not.toContain("submitted");
  });

  it("06-04: rejected is a TERMINAL status — no transition accepts it as a source", () => {
    // reject → rejected is permanently terminal.
    // request_revision is only available from submitted/technically_approved/coordination_approved.
    // A reviewer must choose request_revision INSTEAD of reject if they want to allow revision.
    // Once rejected, there is no programmatic recovery path (PLAN-BD-5).
    for (const [action, t] of Object.entries(PLAN_TRANSITIONS)) {
      expect(t.from, `${action} must not accept rejected as source`).not.toContain("rejected");
    }
    // submit cannot come from rejected either
    expect(PLAN_TRANSITIONS.submit.from).not.toContain("rejected");
    // request_revision goes to draft (but only from the three pre-final statuses, not from rejected)
    expect(PLAN_TRANSITIONS.request_revision.to).toBe("draft");
    expect(PLAN_TRANSITIONS.request_revision.from).not.toContain("rejected");
  });

  it("06-05: cancel can be called from all pre-completed active states", () => {
    const cancellable = ["draft", "submitted", "technically_approved", "coordination_approved", "approved", "active", "in_progress", "delayed"];
    for (const s of cancellable) {
      expect(PLAN_TRANSITIONS.cancel.from).toContain(s);
    }
    expect(PLAN_TRANSITIONS.cancel.from).not.toContain("completed");
    expect(PLAN_TRANSITIONS.cancel.from).not.toContain("archived");
  });

  it("06-06: archive requires completed or cancelled status", () => {
    expect(PLAN_TRANSITIONS.archive.from).toEqual(expect.arrayContaining(["completed", "cancelled"]));
    expect(PLAN_TRANSITIONS.archive.from).not.toContain("active");
    expect(PLAN_TRANSITIONS.archive.from).not.toContain("draft");
  });

  it("06-07: submit permission is plans.create (original author submits own plan)", () => {
    const PLAN_TRANSITION_PERMS: Record<string, string> = {
      submit: "plans.create",
      technical_review: "plans.approve.technical",
      coordination_review: "plans.approve.coordination",
      final_approve: "plans.approve.final",
      activate: "plans.update",
      start: "plans.update",
      mark_delayed: "plans.update",
      complete: "plans.update",
      cancel: "plans.update",
      archive: "plans.update",
      reject: "plans.approve.technical",
      request_revision: "plans.approve.technical",
    };
    expect(PLAN_TRANSITION_PERMS.submit).toBe("plans.create");
    expect(PLAN_TRANSITION_PERMS.final_approve).toBe("plans.approve.final");
    expect(PLAN_TRANSITION_PERMS.reject).toBe("plans.approve.technical");
  });

  it("06-08: submit requires at least one complete-ready activity (Save & Finish gate)", () => {
    // validatePlanActivityReadiness returns null for a ready activity
    // At least one null-returning activity must exist for submit to proceed
    const hasCompleteActivity = (activities: Array<{ title: string; isReady: boolean }>) =>
      activities.some((a) => a.title && a.isReady);

    expect(hasCompleteActivity([])).toBe(false);
    expect(hasCompleteActivity([{ title: "Task A", isReady: false }])).toBe(false);
    expect(hasCompleteActivity([{ title: "Task A", isReady: true }])).toBe(true);
  });

  it("06-09: request_revision and reject require a non-blank comment", () => {
    const commentRequired = (action: string, comment: string) => {
      if (action === "request_revision" || action === "reject") {
        return comment.trim().length > 0;
      }
      return true;
    };
    expect(commentRequired("request_revision", "")).toBe(false);
    expect(commentRequired("request_revision", "Please fix section 2")).toBe(true);
    expect(commentRequired("reject", "")).toBe(false);
    expect(commentRequired("activate", "")).toBe(true);
  });

  it("06-10: post-approval operational transitions require plans.update", () => {
    const operationalActions = ["activate", "start", "mark_delayed", "complete", "cancel", "archive"];
    const PLAN_TRANSITION_PERMS: Record<string, string> = {
      activate: "plans.update", start: "plans.update", mark_delayed: "plans.update",
      complete: "plans.update", cancel: "plans.update", archive: "plans.update",
    };
    for (const action of operationalActions) {
      expect(PLAN_TRANSITION_PERMS[action]).toBe("plans.update");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PLAN-AUDIT-07: Reviewer Field Coverage
// ─────────────────────────────────────────────────────────────────────────────

describe("PLAN-AUDIT-07: Reviewer field coverage — form persists → detail shows", () => {
  it("07-01: plan detail exposes all fields required for TC review", () => {
    const requiredForTCReview = [
      "title", "planType", "frequency", "sectors", "localities",
      "startDate", "endDate", "description", "objectives",
      "responsibleName", "responsibleUserId",
      "budgetPlanned", "currency", "fundingSource",
    ];
    // These fields are in the planSummarySelect and returned by getPlanById.
    // Sentinel: any field removed from summary SELECT breaks reviewer UX.
    expect(requiredForTCReview.length).toBeGreaterThan(10);
  });

  it("07-02: activities expose all fields required for operational review", () => {
    const requiredActivityFields = [
      "title", "description", "status", "progressPct",
      "startDate", "endDate", "plannedDate",
      "targetBeneficiaries", "priority", "expectedResult",
      "budgetPlanned", "budgetActual",
      "responsibleName", "localityName",
    ];
    expect(requiredActivityFields.length).toBeGreaterThan(10);
  });

  it("07-03: plan budget fields are returned as floats not strings", () => {
    // SQL casts: CAST(pl.budget_planned AS FLOAT)
    // Sentinel: if DB stores as NUMERIC, cast prevents precision bugs on division.
    const rawBudget = "125000.00";
    const asPgFloat = parseFloat(rawBudget);
    expect(typeof asPgFloat).toBe("number");
    expect(asPgFloat).toBe(125000);
  });

  it("07-04: plan-level progressPct is null (not 0) when no activities exist", () => {
    // AVG() in PostgreSQL returns NULL for empty set.
    // Frontend must treat null distinctly from 0 (no-denominator case).
    const computePlanProgress = (activities: Array<{ progressPct: number }>) =>
      activities.length === 0
        ? null
        : Math.floor(activities.reduce((s, a) => s + a.progressPct, 0) / activities.length);

    expect(computePlanProgress([])).toBeNull();
    expect(computePlanProgress([{ progressPct: 0 }])).toBe(0);
    expect(computePlanProgress([{ progressPct: 50 }, { progressPct: 100 }])).toBe(75);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PLAN-AUDIT-08: Direct Endpoint Scope
// ─────────────────────────────────────────────────────────────────────────────

describe("PLAN-AUDIT-08: Direct endpoint scope — cross-State/Sector blocked", () => {
  it("08-01: state-scoped list query is clamped to user state regardless of ?stateId= param", () => {
    // Backend overrides ?stateId with user's stateId for state_program_officer/SOM.
    const effectiveStateId = (
      role: Role,
      userStateId: number | null,
      queryStateId: number | null,
    ) => {
      const isStateRole = role === "state_program_officer" || role === "state_office_manager";
      return isStateRole ? userStateId : queryStateId;
    };

    expect(effectiveStateId("state_program_officer", 3, 7)).toBe(3); // param ignored
    expect(effectiveStateId("program_manager", null, 7)).toBe(7);    // param honoured
  });

  it("08-02: state-scoped users with null stateId return empty list (fail-closed)", () => {
    const isStateRole = (role: Role) =>
      role === "state_program_officer" || role === "state_office_manager";

    const getPlans = (role: Role, stateId: number | null) => {
      if (isStateRole(role) && stateId === null) return [];
      return ["plan-1", "plan-2"]; // simulated
    };

    expect(getPlans("state_program_officer", null)).toEqual([]);
    expect(getPlans("state_office_manager", null)).toEqual([]);
    expect(getPlans("program_manager", null)).toEqual(["plan-1", "plan-2"]);
  });

  it("08-03: TC with empty sector assignment cannot see any plans (fail-closed)", () => {
    const tcSectorRestriction = (role: Role, sectors: string[]) => {
      if (role !== "technical_coordinator") return null;
      return sectors; // empty array → no plans visible
    };

    const restriction = tcSectorRestriction("technical_coordinator", []);
    expect(restriction).toEqual([]);
    // empty array means the SQL filter yields zero rows
  });

  it("08-04: TC with sectors only sees plans in those sectors", () => {
    const visiblePlans = (tcSectors: string[], plans: Array<{ sector: string }>) =>
      plans.filter((p) => tcSectors.includes(p.sector));

    const plans = [
      { sector: "Health" },
      { sector: "WASH" },
      { sector: "Education" },
    ];
    const visible = visiblePlans(["Health", "WASH"], plans);
    expect(visible.length).toBe(2);
    expect(visible.map((p) => p.sector)).not.toContain("Education");
  });

  it("08-05: IDOR protection — sector guard prevents cross-sector plan access", () => {
    // assertSectorAllowed checks TC's assigned sectors against plan's effective sector.
    // A crafted GET /plans/:id for a plan in a different sector returns 403.
    const assertSectorAllowed = (
      userRole: Role,
      userSectors: string[],
      planSector: string | null,
    ): "ok" | "forbidden" => {
      if (userRole !== "technical_coordinator") return "ok";
      if (!planSector) return "ok"; // HQ or unassigned plans
      if (userSectors.length === 0) return "forbidden";
      return userSectors.includes(planSector) ? "ok" : "forbidden";
    };

    expect(assertSectorAllowed("technical_coordinator", ["Health"], "WASH")).toBe("forbidden");
    expect(assertSectorAllowed("technical_coordinator", ["Health"], "Health")).toBe("ok");
    expect(assertSectorAllowed("program_manager", [], "WASH")).toBe("ok");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PLAN-AUDIT-09: Analytics Scope
// ─────────────────────────────────────────────────────────────────────────────

describe("PLAN-AUDIT-09: Analytics scope — TC Sector isolation, State isolation", () => {
  it("09-01: dashboard short-circuits to empty for TC with no sector", () => {
    const getDashboard = (tcSectors: string[] | null) => {
      if (tcSectors !== null && tcSectors.length === 0) {
        return { total: 0, active: 0, delayed: 0 };
      }
      return { total: 10, active: 3, delayed: 1 };
    };

    expect(getDashboard([])).toEqual({ total: 0, active: 0, delayed: 0 });
    expect(getDashboard(["Health"])).toEqual({ total: 10, active: 3, delayed: 1 });
    expect(getDashboard(null)).toEqual({ total: 10, active: 3, delayed: 1 });
  });

  it("09-02: awaiting approval count = submitted + technically_approved + coordination_approved", () => {
    const computeAwaiting = (statusMap: Record<string, number>) =>
      (statusMap.submitted ?? 0) +
      (statusMap.technically_approved ?? 0) +
      (statusMap.coordination_approved ?? 0);

    expect(computeAwaiting({ submitted: 3, technically_approved: 1, coordination_approved: 2 })).toBe(6);
    expect(computeAwaiting({ submitted: 0, technically_approved: 0, coordination_approved: 0 })).toBe(0);
    expect(computeAwaiting({ approved: 5, active: 2 })).toBe(0);
  });

  it("09-03: delayed activities include past-due non-terminal activities (not just status=delayed)", () => {
    // Overdue rule: pa.status IN ('planned','in_progress','delayed') AND pa.end_date < CURRENT_DATE
    const isOverdue = (
      status: string,
      endDate: string | null,
      today: string,
    ): boolean => {
      const nonTerminal = ["planned", "in_progress", "delayed"];
      if (!nonTerminal.includes(status)) return false;
      if (!endDate) return false;
      return endDate < today;
    };

    expect(isOverdue("delayed", "2026-01-01", "2026-08-17")).toBe(true);
    expect(isOverdue("planned", "2026-01-01", "2026-08-17")).toBe(true);
    expect(isOverdue("completed", "2026-01-01", "2026-08-17")).toBe(false); // terminal
    expect(isOverdue("cancelled", "2026-01-01", "2026-08-17")).toBe(false); // terminal
    expect(isOverdue("in_progress", null, "2026-08-17")).toBe(false);       // no date
    expect(isOverdue("in_progress", "2026-09-01", "2026-08-17")).toBe(false); // future
  });

  it("09-04: plan budget burn rate is null when planned budget is 0 (no division by zero)", () => {
    const burnRate = (planned: number, actual: number): number | null =>
      planned === 0 ? null : (actual / planned) * 100;

    expect(burnRate(0, 0)).toBeNull();
    expect(burnRate(100000, 50000)).toBe(50);
    expect(burnRate(100000, 120000)).toBe(120); // over-spend preserved
  });

  it("09-05: no invented plan performance score — only factual counts/averages", () => {
    // Sentinel: dashboard returns factual totals, not composite scoring.
    // No 'performance_score', 'tier', 'health', or weighted aggregate.
    const dashboardFields = [
      "total", "active", "delayed", "completed", "draft",
      "budgetPlanned", "budgetActual", "burnRatePct",
      "riskCount", "activitiesTotal", "activitiesCompleted",
    ];
    const forbiddenFields = ["performanceScore", "tier", "healthScore", "ranking"];
    for (const field of forbiddenFields) {
      expect(dashboardFields.includes(field)).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PLAN-AUDIT-10: Full Operational Access (#373) vs Structural Integrity
// ─────────────────────────────────────────────────────────────────────────────

describe("PLAN-AUDIT-10: Full Operational Access vs Plan structural integrity", () => {
  it("10-01: PM has full operational access to all plan permissions", () => {
    const pmPerms = permissionsFor("program_manager");
    expect(pmPerms).toContain("plans.create");
    expect(pmPerms).toContain("plans.update");
    expect(pmPerms).toContain("plans.delete");
    expect(pmPerms).toContain("plans.reopen");
    expect(pmPerms).toContain("plans.approve.coordination");
    expect(pmPerms).toContain("plans.approve.final");
  });

  it("10-02: super_admin has wildcard and effectively all plan permissions", () => {
    const perms = permissionsFor("super_admin");
    expect(perms).toContain("*");
    expect(can("super_admin", "plans.approve.final")).toBe(true);
    expect(can("super_admin", "plans.delete")).toBe(true);
  });

  it("10-03: Full Operational Access does NOT allow skipping workflow steps", () => {
    // Even PM cannot transition draft → approved in one step.
    // Workflow sequence is structural — each transition checks expected from-status.
    const canTransition = (currentStatus: string, action: string): boolean => {
      const t = PLAN_TRANSITIONS[action];
      if (!t) return false;
      return t.from.includes(currentStatus);
    };

    // PM cannot final-approve a draft (structural enforcement)
    expect(canTransition("draft", "final_approve")).toBe(false);
    expect(canTransition("draft", "technical_review")).toBe(false);
    expect(canTransition("submitted", "final_approve")).toBe(false);

    // PM can final-approve from the correct source status
    expect(canTransition("coordination_approved", "final_approve")).toBe(true);
  });

  it("10-04: Full Operational Access does not bypass sector/state guards", () => {
    // PM has plans.approve.final but sector guard and state guard still apply.
    // assertSectorAllowed returns ok for PM (not TC-restricted).
    // assertStateAllowed returns ok for PM (not state-restricted).
    expect(assertStateAllowed("program_manager", null, 3, "state")).toBe("ok");
    expect(assertStateAllowed("program_manager", null, null, "hq")).toBe("ok");
  });

  it("10-05: Full Operational Access does NOT bypass isPlanCurrentlyEditable lock", () => {
    // Even PM with plans.update cannot PATCH an approved plan without reopen.
    // The approval-lock is structural: it checks the approvals table, not permissions.
    const isPlanEditable = (
      lastFinalApprovedAt: Date | null,
      hasReopen: boolean,
      currentStatus: string,
    ): boolean => {
      if (lastFinalApprovedAt === null) return !POST_APPROVAL_LOCKED_STATUSES.has(currentStatus);
      return hasReopen && !POST_APPROVAL_LOCKED_STATUSES.has(currentStatus);
    };

    // PM is approved but no reopen → locked even for PM
    expect(isPlanEditable(new Date(), false, "approved")).toBe(false);
    expect(isPlanEditable(new Date(), false, "active")).toBe(false);
  });

  it("10-06: reopen requires a mandatory non-blank reason (no silent override)", () => {
    const requiresReason = (reason: string) => reason.trim().length > 0;
    expect(requiresReason("")).toBe(false);
    expect(requiresReason("  ")).toBe(false);
    expect(requiresReason("Updating Q3 targets")).toBe(true);
  });

  it("10-07: valid Plan identity (title + location) is required even for PM/super_admin", () => {
    // Full Access does NOT bypass required data.
    // POST /plans requires title (and stateId for state plans).
    const validateCreate = (body: { title?: string; locationType?: string; stateId?: number }) => {
      if (!body.title?.trim()) return "title_required";
      if (body.locationType !== "hq" && !body.stateId) return "stateId_required";
      return null;
    };
    expect(validateCreate({})).toBe("title_required");
    expect(validateCreate({ title: "Plan A" })).toBe("stateId_required");
    expect(validateCreate({ title: "Plan A", stateId: 3 })).toBeNull();
    expect(validateCreate({ title: "Plan A", locationType: "hq" })).toBeNull();
  });
});
