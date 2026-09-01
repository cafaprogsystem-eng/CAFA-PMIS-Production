/**
 * PRJ-CLEANUP — routes/projects.ts no longer imports assertSectorAllowed (it
 * was imported but never called anywhere in the file), and the document
 * override-actor check now uses the shared hasFullOperationalAccess governance
 * helper instead of its own inline `role === "program_manager" || role ===
 * "super_admin"` check.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(__dirname, "projects.ts"), "utf8");

describe("PRJ-CLEANUP — unused import and inline role-check removed", () => {
  it("does not import assertSectorAllowed", () => {
    expect(src).not.toContain("assertSectorAllowed");
  });

  it("imports and uses the shared hasFullOperationalAccess helper", () => {
    expect(src).toContain('import { hasFullOperationalAccess } from "../lib/accessControl";');
    expect(src).toContain("const isOverrideActor = hasFullOperationalAccess(req.currentUser);");
  });

  it("no longer has the inline program_manager/super_admin override check", () => {
    expect(src).not.toContain('const isOverrideActor = role === "program_manager" || role === "super_admin";');
  });
});
