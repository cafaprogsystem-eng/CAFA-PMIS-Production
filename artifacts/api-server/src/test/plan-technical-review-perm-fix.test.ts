/**
 * PLAN-TR-PERM-FIX — Plan technical-review transitions (technical_review,
 * reject, request_revision) were gated on "projects.approve.technical" instead
 * of the dedicated "plans.approve.technical" permission that already exists for
 * exactly this purpose and that the Effective Access screen (effectiveAccess.ts)
 * displays as governing it. technical_coordinator now carries both permissions
 * so its real-world capability is unchanged; program_manager already had both.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { permissionsFor } from "../middlewares/currentUser";
import { PLAN_TRANSITION_PERMS } from "../routes/plans";

const plansSrc = readFileSync(resolve(__dirname, "../routes/plans.ts"), "utf8");
const planDetailSrc = readFileSync(
  resolve(__dirname, "../../../cafa-pmis/src/pages/plan-detail.tsx"),
  "utf8",
);

function makeUser(role: string) {
  return { id: 1, name: "U", email: "u@t.com", role, roleLabel: role, scope: "global", stateId: null, stateName: null, sector: null, sectors: [], avatarUrl: null } as unknown as Parameters<typeof permissionsFor>[0];
}

describe("PLAN-TR-PERM-FIX: plan technical-review actions use plans.approve.technical", () => {
  it("PLAN_TRANSITION_PERMS maps technical_review/reject/request_revision to plans.approve.technical", () => {
    expect(PLAN_TRANSITION_PERMS.technical_review).toBe("plans.approve.technical");
    expect(PLAN_TRANSITION_PERMS.reject).toBe("plans.approve.technical");
    expect(PLAN_TRANSITION_PERMS.request_revision).toBe("plans.approve.technical");
  });

  it("plans.ts no longer gates any plan transition on projects.approve.technical", () => {
    expect(plansSrc).not.toContain('"projects.approve.technical"');
  });

  it("plan-detail.tsx derives its TRANSITIONS perms from the shared table (no more two-place drift)", () => {
    // Since PLAN-TRANSITIONS-SHARED, plan-detail.tsx no longer hardcodes any
    // per-action perm literal at all — it reads PLAN_TRANSITION_PERMS[action]
    // from the same @workspace/plan-transitions table this route enforces,
    // which structurally rules out this class of two-place drift.
    expect(planDetailSrc).not.toContain('perm: "projects.approve.technical"');
    expect(planDetailSrc).not.toContain('perm: "plans.approve.technical"');
    expect(planDetailSrc).toContain('from "@workspace/plan-transitions"');
    expect(planDetailSrc).toContain("perm: PLAN_TRANSITION_PERMS[action]");
  });

  it("technical_coordinator has plans.approve.technical (matches what Effective Access already displayed)", () => {
    const perms = permissionsFor(makeUser("technical_coordinator"));
    expect(perms).toContain("plans.approve.technical");
    // Unchanged: TC keeps its project-side technical-review permission too.
    expect(perms).toContain("projects.approve.technical");
  });

  it("program_manager still has both technical-review permissions (Full Operational Access)", () => {
    const perms = permissionsFor(makeUser("program_manager"));
    expect(perms).toContain("plans.approve.technical");
    expect(perms).toContain("projects.approve.technical");
  });

  it("a role with only plans.approve.technical can now pass the actual runtime check", () => {
    // Simulates the exact defect scenario: a role the Effective Access screen says
    // is authorised (plans.approve.technical) must actually be authorised.
    const perms = ["plans.approve.technical"];
    expect(perms.includes(PLAN_TRANSITION_PERMS.technical_review)).toBe(true);
  });

  it("senior_program_coordinator and other non-technical roles still lack plans.approve.technical", () => {
    const perms = permissionsFor(makeUser("senior_program_coordinator"));
    expect(perms).not.toContain("plans.approve.technical");
  });
});
