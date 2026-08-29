/**
 * USER-SEC / USER-FUNC closure sentinels.
 *
 * These tests intentionally examine the route and migration contracts rather
 * than a mocked database response: they guard the security properties that
 * must apply before any query is reached (permission, ID and page bounds).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const usersRoute = readFileSync(new URL("../routes/users.ts", import.meta.url), "utf8");
const authRoute = readFileSync(new URL("../routes/auth.ts", import.meta.url), "utf8");
const resetRegistryRoute = readFileSync(new URL("../routes/password-reset-admin.ts", import.meta.url), "utf8");
const routeIndex = readFileSync(new URL("../routes/index.ts", import.meta.url), "utf8");
const migrations = readFileSync(new URL("../lib/run-migrations.ts", import.meta.url), "utf8");
const currentUser = readFileSync(new URL("../middlewares/currentUser.ts", import.meta.url), "utf8");

describe("USER-SEC: administrative authority and lifecycle protection", () => {
  it("uses canonical permissions and validates every administrative direct-ID route", () => {
    for (const route of [
      'router.post("/users/:id/resend-invite", requirePerm("users.manage"), requireValidUserId',
      'router.post("/users/:id/cancel-invite", requirePerm("users.manage"), requireValidUserId',
      'router.post("/users/:id/resend-verification", requirePerm("users.manage"), requireValidUserId',
      'router.patch("/users/:id", requirePerm("users.manage"), requireValidUserId',
      'router.post("/users/:id/status", requirePerm("users.manage"), requireValidUserId',
      'router.post("/users/:id/reset-password", requirePerm("users.manage"), requireValidUserId',
      'router.delete("/users/:id", requirePerm("users.manage"), requireValidUserId',
    ]) {
      expect(usersRoute).toContain(route);
    }
    expect(usersRoute).toContain('router.get("/users", requirePerm("users.view")');
    expect(usersRoute).toContain('error: "cannot_modify_own_access"');
    expect(usersRoute).toContain('error: "cannot_change_own_status"');
    expect(currentUser).toContain('if (row && row.status === "active")');
  });

  it("normalises identities and has a database backstop for concurrent collisions", () => {
    expect(usersRoute).toContain('trim().toLowerCase()');
    expect(migrations).toContain('name: "035_user_identity_uniqueness"');
    expect(migrations).toContain('users_normalised_email_unique');
    expect(migrations).toContain('users_normalised_username_unique');
  });

  it("grandfathers unchanged inactive State assignments on profile/status PATCHes", () => {
    const patchRoute = usersRoute.slice(
      usersRoute.indexOf('router.patch("/users/:id"'),
      usersRoute.indexOf("// CHANGE STATUS"),
    );
    expect(patchRoute).toContain("const stateAssignmentChanged = finalStateId !== existingStateId");
    expect(patchRoute).toContain("const roleNewlyRequiresState =");
    expect(patchRoute).toContain(
      "if (finalStateId && (stateAssignmentChanged || roleNewlyRequiresState))",
    );
    expect(patchRoute).not.toContain("const finalActiveState = finalStateId");
    expect(patchRoute).toContain("SELECT name FROM states WHERE id = $1");
  });

  it("requires an active State for new State-role assignments and clears incompatible scope on role changes", () => {
    const createRoute = usersRoute.slice(
      usersRoute.indexOf('router.post("/users"'),
      usersRoute.indexOf('router.post("/users/:id/resend-invite"'),
    );
    const patchRoute = usersRoute.slice(
      usersRoute.indexOf('router.patch("/users/:id"'),
      usersRoute.indexOf("// CHANGE STATUS"),
    );
    expect(createRoute).toContain('error: "state_required_for_state_role"');
    expect(createRoute).toContain("const activeState = stateId ? await assertActiveState(stateId) : null");
    expect(createRoute).toContain("if (stateId && !stateName)");
    expect(patchRoute).toContain("if (STATE_ROLES.has(finalRole) && !finalStateId)");
    expect(patchRoute).toContain("if (finalStateId && (stateAssignmentChanged || roleNewlyRequiresState))");
    expect(patchRoute).toContain("next_.state_id = null;");
    expect(patchRoute).toContain("next_.sector = null;");
  });
});

describe("USER-FUNC: bounded truthful directory contract", () => {
  it("uses deterministic paginated server-side filtering and the eight canonical roles", () => {
    expect(usersRoute).toContain('const limit = boundedInteger(req.query.limit, 25, 1, 100)');
    expect(usersRoute).toContain('ORDER BY LOWER(u.name) ASC, u.id ASC');
    expect(usersRoute).toContain("LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}");
    expect(usersRoute).toContain("COALESCE(u.sector, '')");
    expect(usersRoute).toContain("items: rows");
    expect(usersRoute).toContain("nextOffset:");
    expect(usersRoute).toContain('u.last_seen_at AS "lastSeenAt"');
    expect(usersRoute).toContain("isOnline: realtime.isUserOnline(user.id)");
    for (const role of [
      "super_admin", "executive_director", "program_manager", "senior_program_coordinator",
      "technical_coordinator", "state_office_manager", "state_program_officer", "viewer",
    ]) expect(usersRoute).toContain(`"${role}"`);
  });

  it("does not put invitation tokens in directory or invitation-list responses", () => {
    const listSurface = usersRoute.slice(usersRoute.indexOf('router.get("/users"'), usersRoute.indexOf("// GET by id"));
    expect(listSurface).not.toContain('invite_token AS "inviteToken"');
    expect(usersRoute).toContain("invite_token is intentionally excluded");
  });

  it("pages invitations with full filtered lifecycle totals and records non-secret lifecycle before/after audit data", () => {
    expect(usersRoute).toContain('router.get("/users/invitations", requirePerm("users.manage")');
    expect(usersRoute).toContain("COUNT(*) FILTER (");
    expect(usersRoute).toContain("FROM users u\n       LEFT JOIN states s ON s.id = u.state_id\n       ${whereClause}");
    expect(usersRoute).toContain("res.json({\n      invitations: rows,\n      total,\n      summary: {");
    expect(usersRoute).toContain("pending: summary.pending ?? 0");
    expect(usersRoute).toContain("accepted: summary.accepted ?? 0");
    expect(usersRoute).toContain("expired: summary.expired ?? 0");
    expect(usersRoute).toContain("cancelled: summary.cancelled ?? 0");
    expect(usersRoute).toContain('action: "invite_resend"');
    expect(usersRoute).toContain('action: "invite_cancel"');
    expect(usersRoute).toContain("oldValue: JSON.stringify");
    expect(usersRoute).toContain("newValue: JSON.stringify");
  });

  it("keeps invitation delivery status truthful and rejects re-inviting accepted accounts", () => {
    expect(usersRoute).toContain('inviteEmailStatus = "failed"');
    expect(usersRoute).toContain("invite_email_status = $1");
    expect(usersRoute).toContain('if (u.inviteAcceptedAt) { res.status(409).json({ error: "invite_already_accepted" }); return; }');
    expect(usersRoute).toContain('if (u.status !== "invited" && !(u.status === "deactivated" && u.invitedById !== null))');
    expect(usersRoute).toContain('u.status === "deactivated" && u.invitedById !== null');
    expect(usersRoute).toContain('u.invited_by_id AS "invitedById"');
    expect(usersRoute).toContain("emailDelivery: inviteEmailStatus");
    expect(usersRoute).toContain("emailDelivered: delivered, emailDelivery");
  });
});

describe("RESET-REGISTRY: canonical, filtered administrative audit contract", () => {
  it("has one reachable reset registry owner after the authenticated router boundary", () => {
    expect(authRoute).not.toContain('router.get("/password-reset-tokens"');
    expect(authRoute).not.toContain('router.post("/password-reset-tokens/:id/resend"');
    expect(routeIndex).toContain("router.use(passwordResetAdminRouter);");
    expect(resetRegistryRoute).toContain('router.get("/password-reset-tokens", requireHqAdmin');
  });

  it("returns only the persisted registry fields and pages every validated filter", () => {
    for (const field of [
      'prt.source', 'prt.email_status AS "emailStatus"', 'prt.created_at AS "requestedAt"',
      'prt.expires_at AS "expiresAt"', 'prt.used_at AS "usedAt"', 'prt.revoked_at AS "revokedAt"',
      'prt.resolved_at AS "resolvedAt"', 'prt.handled_at AS "handledAt"',
    ]) expect(resetRegistryRoute).toContain(field);

    expect(resetRegistryRoute).toContain("RESET_STATUSES.includes");
    expect(resetRegistryRoute).toContain("RESET_SOURCES.includes");
    expect(resetRegistryRoute).toContain("boundedInteger(limit, 25, 1, 100)");
    expect(resetRegistryRoute).toContain("boundedInteger(offset, 0, 0, Number.MAX_SAFE_INTEGER)");
    expect(resetRegistryRoute).toContain("${whereClause}");
    expect(resetRegistryRoute).toContain("filterParams");
    expect(resetRegistryRoute).toContain('COUNT(*) FILTER (WHERE prt.status = \'revoked\')::int AS revoked');
    expect(resetRegistryRoute).toContain("nextOffset:");
  });

  it("keeps lifecycle-changing actions gated by the established administrative guard", () => {
    for (const action of ["cancel", "resolve", "resend"]) {
      expect(resetRegistryRoute).toContain(`router.post("/password-reset-tokens/:id/${action}", requireHqAdmin`);
    }
    expect(resetRegistryRoute).toContain("WHERE id = $1 AND status = 'active'");
    expect(resetRegistryRoute).toContain('["super_admin", "executive_director", "program_manager"].includes(role)');
  });
});
