/**
 * PLAN-TRANSITIONS-SHARED — PLAN_TRANSITIONS/PLAN_TRANSITION_PERMS previously
 * lived only in routes/plans.ts, and plan-detail.tsx (frontend) hand-maintained
 * a parallel copy — the exact two-place duplication that let the technical-
 * review permission key drift out of sync in the first place. Both tables now
 * live in the framework-agnostic @workspace/plan-transitions package; plans.ts
 * imports and re-exports them (so every existing backend consumer keeps
 * working unchanged), and plan-detail.tsx derives its TRANSITIONS array from
 * them instead of hardcoding its own from/perm values.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PLAN_TRANSITIONS, PLAN_TRANSITION_PERMS } from "@workspace/plan-transitions";
import { PLAN_TRANSITIONS as routePlanTransitions, PLAN_TRANSITION_PERMS as routePlanTransitionPerms } from "../routes/plans";

const plansSrc = readFileSync(resolve(__dirname, "../routes/plans.ts"), "utf8");
const planDetailSrc = readFileSync(
  resolve(__dirname, "../../../cafa-pmis/src/pages/plan-detail.tsx"),
  "utf8",
);

describe("PLAN-TRANSITIONS-SHARED: one source of truth for the Plan transition table", () => {
  it("routes/plans.ts re-exports the shared package's tables (identity, not a copy)", () => {
    expect(routePlanTransitions).toBe(PLAN_TRANSITIONS);
    expect(routePlanTransitionPerms).toBe(PLAN_TRANSITION_PERMS);
  });

  it("plans.ts no longer defines its own PLAN_TRANSITIONS/PLAN_TRANSITION_PERMS object literals", () => {
    expect(plansSrc).toContain('from "@workspace/plan-transitions"');
    expect(plansSrc).not.toMatch(/PLAN_TRANSITIONS: Record<string, \{ from: string\[\]; to: string \}> = \{/);
    expect(plansSrc).not.toMatch(/PLAN_TRANSITION_PERMS: Record<string, string> = \{/);
  });

  it("plan-detail.tsx derives TRANSITIONS from the shared package instead of hardcoding from/perm", () => {
    expect(planDetailSrc).toContain('from "@workspace/plan-transitions"');
    expect(planDetailSrc).toContain("from: PLAN_TRANSITIONS[action].from");
    expect(planDetailSrc).toContain("perm: PLAN_TRANSITION_PERMS[action]");
    // No more hardcoded literal `perm: "plans...."` pairs duplicating the backend's table.
    expect(planDetailSrc).not.toMatch(/\{ action: "submit", from: \["draft"\], perm: "plans\.create" \}/);
  });

  it("the shared table's every action is covered by plan-detail.tsx's TRANSITION_ORDER (no silently-dropped action)", () => {
    const orderMatch = planDetailSrc.match(/const TRANSITION_ORDER = \[([\s\S]*?)\] as const;/);
    expect(orderMatch).not.toBeNull();
    const orderedActions = orderMatch![1].match(/"([a-z_]+)"/g)!.map((s) => s.replace(/"/g, ""));
    expect(new Set(orderedActions)).toEqual(new Set(Object.keys(PLAN_TRANSITIONS)));
  });

  it("sanity: the shared table's actual rules match the known canonical workflow", () => {
    expect(PLAN_TRANSITIONS.submit).toEqual({ from: ["draft"], to: "submitted" });
    expect(PLAN_TRANSITIONS.final_approve).toEqual({ from: ["coordination_approved"], to: "approved" });
    expect(PLAN_TRANSITION_PERMS.technical_review).toBe("plans.approve.technical");
    expect(PLAN_TRANSITION_PERMS.reject).toBe("plans.approve.technical");
  });
});
