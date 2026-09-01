/**
 * AUTH-PASSWORD-CHANGED-LINK — the "password_changed" self-notification
 * pointed its link at /users (the Users management list) instead of the
 * user's own profile/security page — a copy-paste artifact from a different
 * notification kind, not a scope issue (the notification is always
 * self-addressed).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(__dirname, "../auth.ts"), "utf8");

describe("AUTH-PASSWORD-CHANGED-LINK", () => {
  it("password_changed notification links to /profile, not /users", () => {
    const block = src.slice(src.indexOf('kind: "password_changed"'), src.indexOf('kind: "password_changed"') + 400);
    expect(block).toContain('link: "/profile",');
    expect(block).not.toContain('link: "/users",');
  });
});
