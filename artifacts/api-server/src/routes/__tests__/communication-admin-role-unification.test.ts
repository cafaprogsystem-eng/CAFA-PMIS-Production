/**
 * COMMUNICATION-ADMIN-ROLE-UNIFICATION — DELETE /messages/:msgId hand-inlined
 * its own 3-role admin check (`["super_admin", "executive_director",
 * "program_manager"].includes(...)`), silently omitting
 * senior_program_coordinator — the role that every OTHER admin capability in
 * this file (rename, add-member, remove-member, via isAdminRole/ADMIN_ROLES)
 * already includes. An SPC could rename a conversation or manage its members
 * but could not delete-for-everyone another user's message or bypass the
 * 15-minute window, for no documented reason — accidental drift, not a
 * deliberate narrower scope.
 *
 * Now DELETE /messages/:msgId uses the same isAdminRole() helper as every
 * other admin check in this file.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SRC = fs.readFileSync(path.resolve(__dirname, "../conversations.ts"), "utf8");

describe("COMMUNICATION-ADMIN-ROLE-UNIFICATION: a single source of truth for admin roles", () => {
  it("ADMIN_ROLES / isAdminRole includes all 4 roles, including senior_program_coordinator", () => {
    expect(SRC).toContain(
      'const ADMIN_ROLES = ["super_admin", "executive_director", "program_manager", "senior_program_coordinator"] as const;',
    );
  });

  it("DELETE /messages/:msgId's admin check now calls isAdminRole(...) instead of a hand-inlined 3-role list", () => {
    const deleteRoute = SRC.slice(SRC.indexOf('router.delete("/messages/'), SRC.indexOf('router.delete("/messages/') + 3000);
    expect(deleteRoute).toContain("const isAdmin = isAdminRole(req.currentUser!.role);");
    expect(deleteRoute).not.toContain('["super_admin", "executive_director", "program_manager"].includes(req.currentUser!.role)');
  });

  it("every isAdminRole/ADMIN_ROLES-gated capability in this file shares the exact same 4-role definition (no other role list has silently drifted)", () => {
    const usages = [...SRC.matchAll(/isAdminRole\(/g)];
    // rename, remove-member, add-member, message-delete, announcement-followup — at least 5 call sites
    expect(usages.length).toBeGreaterThanOrEqual(5);
    // No second, competing role-literal list remains anywhere in the file.
    expect(SRC).not.toMatch(/\["super_admin",\s*"executive_director",\s*"program_manager"\]\.includes/);
  });
});
