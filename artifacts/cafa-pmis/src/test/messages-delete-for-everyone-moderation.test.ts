/**
 * MESSAGES-DELETE-FOR-EVERYONE-MODERATION — the frontend "Delete for
 * everyone" control (pages/messages.tsx) only ever checked
 * `isOwn && withinWindow`, so it never exposed a way for a moderator
 * (super_admin/executive_director/program_manager/senior_program_coordinator)
 * to delete someone else's message or bypass the 15-minute window — even
 * though the backend (routes/conversations.ts's isAdminRole check) already
 * allows exactly that. MESSAGE_MODERATION_ROLES mirrors the backend's
 * ADMIN_ROLES exactly, and canDeleteForEveryone/the menu item's render gate
 * both now account for it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(__dirname, "../pages/messages.tsx"), "utf8");

describe("MESSAGES-DELETE-FOR-EVERYONE-MODERATION", () => {
  it("MESSAGE_MODERATION_ROLES mirrors the backend's 4-role ADMIN_ROLES exactly", () => {
    expect(src).toContain(
      'const MESSAGE_MODERATION_ROLES = new Set(["super_admin", "executive_director", "program_manager", "senior_program_coordinator"]);',
    );
  });

  it("canDeleteForEveryone is true for a moderator regardless of ownership or the 15-minute window", () => {
    expect(src).toContain("const isModerator = MESSAGE_MODERATION_ROLES.has(myRole);");
    expect(src).toContain("const canDeleteForEveryone = isModerator || (isOwn && withinWindow);");
  });

  it("the menu item itself is rendered for a moderator too, not just the message owner", () => {
    expect(src).toContain("{(isOwn || isModerator) && (");
    expect(src).not.toMatch(/\{isOwn && \(\s*<DropdownMenuItem\s*\n\s*onClick=\{\(\) => \{ if \(canDeleteForEveryone\)/);
  });
});
