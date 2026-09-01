/**
 * PLANS-REG-IMPORT-CLEANUP — plans.ts imported revokeRegistrationSessionsByPlan
 * from plan-registration-session.ts but never called it: the submit transition
 * inlines the equivalent UPDATE via its own transaction client instead (that
 * helper only accepts the shared pool, so it can't join the transition's own
 * transaction). The unused import is removed; the exported helper itself is
 * left in place as a general-purpose utility.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const plansSrc = readFileSync(resolve(__dirname, "../routes/plans.ts"), "utf8");
const sessionLibSrc = readFileSync(resolve(__dirname, "../lib/plan-registration-session.ts"), "utf8");

describe("PLANS-REG-IMPORT-CLEANUP: unused revokeRegistrationSessionsByPlan import removed", () => {
  it("plans.ts no longer imports revokeRegistrationSessionsByPlan", () => {
    expect(plansSrc).not.toContain("revokeRegistrationSessionsByPlan");
  });

  it("the submit transition still revokes sessions — inlined via its own transaction client", () => {
    expect(plansSrc).toMatch(/UPDATE plan_registration_sessions\s*\n\s*SET closed_at = NOW\(\)\s*\n\s*WHERE plan_id\s*=\s*\$1\s*\n\s*AND closed_at IS NULL/);
  });

  it("the helper function itself still exists in plan-registration-session.ts (kept as a general-purpose utility, not dead code)", () => {
    expect(sessionLibSrc).toContain("export async function revokeRegistrationSessionsByPlan(planId: number)");
  });

  it("plan-registration-session.ts's own doc comment no longer claims the exported helper is what submit calls", () => {
    expect(sessionLibSrc).not.toContain("revokeRegistrationSessionsByPlan() called in transitions.");
  });
});
