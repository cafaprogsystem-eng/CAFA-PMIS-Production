/**
 * RBAC-INSP / RBAC-PERM closure sentinels.
 *
 * Guards the security properties of the Access & Permissions Inspector
 * endpoint and the canonical permission model without requiring a live DB.
 *
 * Tests cover:
 *   - Inspector endpoint auth guards (users.manage required)
 *   - Inspector response never exposes credentials
 *   - permissionsFor() wildcard coverage for super_admin
 *   - Unknown/legacy roles fail-closed to universal-only
 *   - TC with empty sectors fails closed on module capabilities
 *   - State roles with null stateId fail-closed (documented in routes)
 *   - ORG_WIDE_STATE_ROLES in frontend no longer contains phantom roles
 *   - resolveEffectiveAccess module structure contract
 *   - system-permission-matrix.md exists and covers all 8 roles
 *   - rbac-security-audit.md exists with required sections
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { permissionsFor, type CurrentUser } from "../middlewares/currentUser";
import { resolveProgramStateAuthoring } from "../lib/effectiveAccess";

const usersRoute      = readFileSync(new URL("../routes/users.ts",               import.meta.url), "utf8");
const currentUser     = readFileSync(new URL("../middlewares/currentUser.ts",    import.meta.url), "utf8");
const effectiveAccess = readFileSync(new URL("../lib/effectiveAccess.ts",        import.meta.url), "utf8");
const messagesPage = readFileSync(
  new URL("../../../../artifacts/cafa-pmis/src/pages/messages.tsx", import.meta.url), "utf8",
);
const frontendPerms   = readFileSync(
  new URL("../../../../artifacts/cafa-pmis/src/lib/permissions.ts", import.meta.url), "utf8",
);
const permMatrix = readFileSync(
  new URL("../../../../docs/audit-reports/system-permission-matrix.md", import.meta.url), "utf8",
);
const secAudit = readFileSync(
  new URL("../../../../docs/audit-reports/rbac-security-audit.md", import.meta.url), "utf8",
);

// ── Inspector endpoint security ───────────────────────────────────────────────

describe("RBAC-INSP: effective-access endpoint security", () => {
  it("requires users.manage on the effective-access endpoint", () => {
    expect(usersRoute).toContain(
      'router.get("/users/:id/effective-access", requirePerm("users.manage"), requireValidUserId',
    );
  });

  it("is registered before the generic /users/:id GET to avoid route shadowing", () => {
    const eaIdx  = usersRoute.indexOf('router.get("/users/:id/effective-access"');
    const getIdx = usersRoute.indexOf('router.get("/users/:id", requirePerm("users.view")');
    expect(eaIdx).toBeGreaterThan(0);
    expect(getIdx).toBeGreaterThan(0);
    expect(eaIdx).toBeLessThan(getIdx);
  });

  it("calls resolveEffectiveAccess from the lib module", () => {
    expect(usersRoute).toContain("resolveEffectiveAccess");
    expect(usersRoute).toContain('from "../lib/effectiveAccess"');
  });

  it("returns 404 for unknown users (not_found error)", () => {
    expect(usersRoute).toContain(
      'res.status(404).json({ error: "not_found" })',
    );
  });
});

// ── resolveEffectiveAccess credential safety ──────────────────────────────────

describe("RBAC-INSP: resolveEffectiveAccess never exposes credentials", () => {
  it("does not reference password, hash, token, or key fields in the returned payload", () => {
    // The returned payload struct must not include credential fields.
    const CREDENTIAL_FIELDS = [
      "password",
      "password_hash",
      "invite_token",
      "reset_token",
      "api_key",
      "session_secret",
    ];
    // effectiveAccess.ts should not place any of these in the returned object literal
    const returnSection = effectiveAccess.slice(effectiveAccess.indexOf("return {"));
    for (const field of CREDENTIAL_FIELDS) {
      // Allow the word in comments (e.g. "never returns passwords") — only fail
      // if it appears as an object key or value.
      const keyPattern = new RegExp(`[:\\.\\[]\\s*"?${field}"?`, "i");
      expect(keyPattern.test(returnSection)).toBe(false);
    }
  });

  it("builds the payload from permissionsFor() — the canonical runtime gate", () => {
    expect(effectiveAccess).toContain("permissionsFor(userLike)");
    expect(effectiveAccess).toContain("from \"../middlewares/currentUser\"");
  });

  it("queries project_assignments for projectCount — no fabricated values", () => {
    expect(effectiveAccess).toContain("project_assignments");
    expect(effectiveAccess).toContain("projectCount");
  });

  it("models authenticated-but-ungated project and plan lists as route facts, not capabilities", () => {
    expect(effectiveAccess).toContain("authenticatedScopedRead(\"view_list\", \"View project list\", operationalScopeNote)");
    expect(effectiveAccess).toContain("authenticatedScopedRead(\"view\", \"View plans\", operationalScopeNote)");
    expect(effectiveAccess).not.toContain('{ key: "projects.create",     scopeNote: orgWide ? "organisation-wide" : stateScopeNote }');
  });

  it("treats Technical Coordinators as sector-scoped rather than organisation-wide", () => {
    expect(effectiveAccess).toContain('role !== "technical_coordinator"');
    expect(effectiveAccess).toContain('role === "technical_coordinator"\n    ? sectorScopeNote');
  });
});

// ── permissionsFor() canonical model ─────────────────────────────────────────

describe("RBAC-PERM: canonical permission model invariants", () => {
  it("super_admin receives the wildcard * permission", () => {
    expect(currentUser).toContain('"*"');
    // Wildcard check comes before specific perm check in hasPerm
    const haPerm = currentUser.slice(currentUser.indexOf("function hasPerm"));
    expect(haPerm).toContain('"*"');
  });

  it("hasPerm checks wildcard before specific capability", () => {
    const haPerm = currentUser.slice(
      currentUser.indexOf("function hasPerm"),
      currentUser.indexOf("function hasPerm") + 400,
    );
    const wildcardIdx  = haPerm.indexOf('"*"');
    const includesIdx  = haPerm.indexOf(".includes(perm)");
    expect(wildcardIdx).toBeGreaterThan(-1);
    expect(includesIdx).toBeGreaterThan(-1);
    // Wildcard guard appears before the specific-capability check
    expect(wildcardIdx).toBeLessThan(includesIdx);
  });

  it("viewer receives its documented organisation-wide read and collaboration capabilities", () => {
    const viewer: CurrentUser = {
      id: 1, name: "Viewer", email: "viewer@example.test", role: "viewer",
      roleLabel: "Viewer", scope: "hq", stateId: null, stateName: null,
      sector: null, sectors: null, avatarUrl: null,
    };
    expect(permissionsFor(viewer)).toEqual(expect.arrayContaining([
      "dashboard.view.org", "projects.view", "reports.view", "plans.view",
      "risks.view", "budget.view", "budget.view.all", "documents.view",
      "audit.view", "messages.view", "messages.create", "messages.send",
      "messages.manage_members",
    ]));
    expect(permissionsFor(viewer)).not.toContain("messages.attachments.upload");
    expect(permissionsFor(viewer)).not.toContain("comments.create");
  });

  it("keeps announcement creation aligned across frontend, canonical permissions and route", () => {
    expect(messagesPage).toContain('new Set(["super_admin", "executive_director", "program_manager"])');
    expect(messagesPage).not.toContain("senior_program_coordinator\"])");
    expect(currentUser).toContain('["executive_director", "program_manager"].includes(role)');
    const conversationsRoute = readFileSync(new URL("../routes/conversations.ts", import.meta.url), "utf8");
    expect(conversationsRoute).toContain('new Set(["super_admin", "executive_director", "program_manager"])');
  });

  it("communication create/send/member capabilities are granted to every canonical role", () => {
    const roles = [
      "executive_director", "program_manager", "senior_program_coordinator",
      "technical_coordinator", "state_office_manager", "state_program_officer", "viewer",
    ];
    for (const role of roles) {
      const user: CurrentUser = {
        id: 1, name: role, email: `${role}@example.test`, role, roleLabel: role,
        scope: "hq", stateId: null, stateName: null, sector: null, sectors: null, avatarUrl: null,
      };
      expect(permissionsFor(user)).toEqual(expect.arrayContaining([
        "messages.create", "messages.send", "messages.manage_members",
      ]));
    }
  });

  it.each([
    ["super_admin", ["*"], ["reports.create"]],
    ["executive_director", ["users.view", "budget.view.all", "ai.settings.manage", "storage.admin"], ["reports.create", "projects.create"]],
    ["program_manager", ["projects.activate", "projects.close", "budget.approve.final", "reports.approve.final"], ["users.manage"]],
    ["senior_program_coordinator", ["projects.approve.coordination", "reports.approve.coordination", "budget.review"], ["projects.approve.final", "budget.approve.final"]],
    ["technical_coordinator", ["projects.approve.technical", "reports.approve.technical", "indicators.update", "budget.view.sector"], ["reports.approve.final", "budget.view.all"]],
    ["state_office_manager", ["dashboard.view.state", "reports.program_state.create", "risks.view.state"], ["reports.create", "comments.create"]],
    ["state_program_officer", ["activities.update", "workplans.update", "beneficiaries.create", "projects.update"], ["comments.create", "reports.approve.technical"]],
    ["viewer", ["projects.view", "reports.view", "plans.view", "audit.view"], ["comments.create", "documents.upload"]],
  ])("grants %s its canonical role-specific capabilities", (role, allowed, denied) => {
    const user: CurrentUser = {
      id: 1, name: role, email: `${role}@example.test`, role, roleLabel: role,
      scope: "hq", stateId: null, stateName: null, sector: null, sectors: null, avatarUrl: null,
    };
    const permissions = permissionsFor(user);
    for (const permission of allowed) expect(permissions).toContain(permission);
    for (const permission of denied) expect(permissions).not.toContain(permission);
  });

  it.each([
    ["super_admin", ["*"], null, "conditional"],
    ["state_program_officer", ["reports.create"], 1, "allowed"],
    ["state_program_officer", ["reports.create"], null, "denied"],
    ["state_office_manager", ["reports.program_state.create"], 1, "conditional"],
    ["state_office_manager", ["reports.program_state.create"], null, "denied"],
    ["program_manager", ["reports.create"], 1, "conditional"],
  ])("models State Programme Report authoring for %s", (role, permissions, stateId, result) => {
    expect(resolveProgramStateAuthoring(role, permissions, stateId).result).toBe(result);
  });

  it("all 8 VALID_ROLES are declared in users.ts", () => {
    for (const role of [
      "super_admin", "executive_director", "program_manager",
      "senior_program_coordinator", "technical_coordinator",
      "state_office_manager", "state_program_officer", "viewer",
    ]) {
      expect(usersRoute).toContain(`"${role}"`);
    }
  });

  it("TC with empty sectors fails closed — tcSectorRestriction returns []", () => {
    // tcSectorRestriction must handle blank/null sector for TC
    expect(currentUser).toContain("tcSectorRestriction");
    const fn = currentUser.slice(
      currentUser.indexOf("function tcSectorRestriction") > -1
        ? currentUser.indexOf("function tcSectorRestriction")
        : currentUser.indexOf("tcSectorRestriction"),
      currentUser.indexOf("tcSectorRestriction") + 600,
    );
    expect(fn).toContain("technical_coordinator");
    // The implementation must return an empty array (not null) for TC with no sector
    // so that ANY($n::text[]) matches nothing (fail-closed).
    expect(fn).toContain("[]");
  });

  it("state roles fail-closed when stateId is null", () => {
    // The shared state guard must explicitly reject a missing assignment.
    expect(currentUser).toContain("if (stateId === null)");
  });
});

// ── Frontend phantom-role cleanup ─────────────────────────────────────────────

describe("RBAC-PERM: frontend permissions.ts is free of phantom roles", () => {
  it("ORG_WIDE_STATE_ROLES no longer contains hq_sector_coordinator", () => {
    const orgWideBlock = frontendPerms.slice(
      frontendPerms.indexOf("ORG_WIDE_STATE_ROLES"),
      frontendPerms.indexOf("ORG_WIDE_STATE_ROLES") + 500,
    ).replace(/\/\/.*$/gm, "");
    expect(orgWideBlock).not.toContain('"hq_sector_coordinator"');
  });

  it("ORG_WIDE_STATE_ROLES no longer contains hq_sector_officer", () => {
    const orgWideBlock = frontendPerms.slice(
      frontendPerms.indexOf("ORG_WIDE_STATE_ROLES"),
      frontendPerms.indexOf("ORG_WIDE_STATE_ROLES") + 500,
    ).replace(/\/\/.*$/gm, "");
    expect(orgWideBlock).not.toContain('"hq_sector_officer"');
  });

  it("all 8 valid backend roles are present in ORG_WIDE_STATE_ROLES or SINGLE_STATE_ROLES", () => {
    const orgWide = [
      "super_admin", "executive_director", "program_manager",
      "senior_program_coordinator", "technical_coordinator",
    ];
    const stateScoped = ["state_program_officer", "state_office_manager"];
    for (const r of orgWide) expect(frontendPerms).toContain(`"${r}"`);
    for (const r of stateScoped) expect(frontendPerms).toContain(`"${r}"`);
  });
});

// ── Audit document completeness ───────────────────────────────────────────────

describe("RBAC-AUDIT: audit documents exist and are complete", () => {
  it("system-permission-matrix.md covers all 8 roles", () => {
    for (const role of [
      "super_admin", "executive_director", "program_manager",
      "senior_program_coordinator", "technical_coordinator",
      "state_office_manager", "state_program_officer", "viewer",
    ]) {
      expect(permMatrix).toContain(role);
    }
  });

  it("system-permission-matrix.md documents all key modules", () => {
    for (const mod of [
      "Projects", "Reports", "Plans", "Risks", "Budget", "Users",
      "Dashboard", "Audit", "Communications",
    ]) {
      expect(permMatrix).toContain(mod === "Users" ? "User Management" : mod);
    }
  });

  it("rbac-security-audit.md has required sections", () => {
    for (const section of [
      "Architecture", "Findings", "CRITICAL", "HIGH", "MEDIUM", "LOW",
      "Security Fixes", "Scope Isolation", "Fail-Closed", "Inspector",
    ]) {
      expect(secAudit).toContain(section);
    }
  });

  it("rbac-security-audit.md documents the phantom-role fix", () => {
    expect(secAudit).toContain("hq_sector_coordinator");
    expect(secAudit).toContain("phantom");
  });

  it("effectiveAccess.ts exports resolveEffectiveAccess and TargetUserForAccess", () => {
    expect(effectiveAccess).toContain("export async function resolveEffectiveAccess");
    expect(effectiveAccess).toContain("export interface TargetUserForAccess");
  });

  it("Inspector module covers every canonical capability domain", () => {
    for (const mod of [
      "projects", "reports", "plans", "risks", "budget",
      "users", "dashboard", "audit", "documents", "messages",
      "notifications", "states", "comments", "programme_operations",
      "settings", "ai", "storage", "manual", "program_resources",
    ]) {
      expect(effectiveAccess).toContain(`module: "${mod}"`);
    }
  });

  it("makes the direct project-assignment access path explicit for state roles", () => {
    expect(effectiveAccess).toContain("projectAssignmentsExtendScope");
    expect(effectiveAccess).toContain("project_assignments");
  });

  it("represents every canonical capability granted by permissionsFor", () => {
    const capabilityLiterals = [
      ...currentUser.matchAll(/"([a-z_]+\.[a-z_]+(?:\.[a-z_]+)?)"/g),
    ].map((match) => match[1]).filter((value) => value.includes("."));
    const canonicalCapabilities = [...new Set(capabilityLiterals)]
      .filter((value) => !["program_state_spo_available"].includes(value));
    const routeFactCapabilities = new Set([
      "projects.view",
      "projects.view.state",
      "plans.view",
    ]);

    for (const capability of canonicalCapabilities) {
      if (routeFactCapabilities.has(capability)) continue;
      expect(effectiveAccess, `missing Inspector row for ${capability}`).toContain(`"${capability}"`);
    }
    expect(effectiveAccess).toContain('authenticatedScopedRead("view_list", "View project list", operationalScopeNote)');
    expect(effectiveAccess).toContain('authenticatedScopedRead("view", "View plans", operationalScopeNote)');
  });

  it("represents wildcard-only route capabilities as explicit Inspector actions", () => {
    // risks.delete deliberately excluded: RISK-BD-05 — no DELETE /risks/:id route
    // exists for any role, including super_admin via wildcard (routes/risks.ts,
    // pinned by RISK-DEL-14). Unlike settings.view/risks.admin, it corresponds to
    // no real, reachable capability, so it must not have an Inspector row either.
    for (const capability of ["settings.view", "risks.admin"]) {
      expect(effectiveAccess, `missing wildcard Inspector row for ${capability}`).toContain(`"${capability}"`);
    }
    expect(effectiveAccess, "risks.delete is not a real capability (RISK-BD-05) and must not have an Inspector row").not.toContain('"risks.delete"');
  });
});
