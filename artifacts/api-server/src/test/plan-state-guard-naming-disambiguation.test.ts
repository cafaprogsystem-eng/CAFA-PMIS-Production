/**
 * PLAN-STATE-GUARD-NAMING — two unrelated functions were both named
 * assertStateAllowed: plans.ts's local synchronous equality check against a
 * Plan's already-known stateId/locationType, and middlewares/currentUser.ts's
 * async project_states/project_assignments DB lookup (used by projects.ts).
 * Same name, different signature, different semantics — a maintenance trap
 * where a future edit could easily call the wrong one. The Plans-local one is
 * now named assertPlanStateAllowed; currentUser.ts's assertStateAllowed is
 * untouched (still used by projects.ts and attachments.ts is now unambiguous
 * about which one it calls).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const plansSrc = readFileSync(resolve(__dirname, "../routes/plans.ts"), "utf8");
const attachmentsSrc = readFileSync(resolve(__dirname, "../routes/attachments.ts"), "utf8");
const currentUserSrc = readFileSync(resolve(__dirname, "../middlewares/currentUser.ts"), "utf8");
const projectsSrc = readFileSync(resolve(__dirname, "../routes/projects.ts"), "utf8");

describe("PLAN-STATE-GUARD-NAMING: the two assertStateAllowed functions no longer share a name", () => {
  it("plans.ts defines assertPlanStateAllowed, not assertStateAllowed", () => {
    expect(plansSrc).toContain("export function assertPlanStateAllowed(");
    expect(plansSrc).not.toContain("export function assertStateAllowed(");
  });

  it("attachments.ts imports and calls the renamed Plans-specific guard", () => {
    expect(attachmentsSrc).toContain('import { assertAnySectorAllowed, assertPlanStateAllowed, isPlanCurrentlyEditable } from "./plans"');
    expect(attachmentsSrc).toContain("assertPlanStateAllowed(req, parent.stateId, parent.locationType)");
  });

  it("currentUser.ts's assertStateAllowed (the Project-scoped, DB-backed guard) is untouched", () => {
    expect(currentUserSrc).toContain("export async function assertStateAllowed(");
  });

  it("projects.ts still calls the unrenamed, Project-scoped assertStateAllowed (its own contract unaffected)", () => {
    expect(projectsSrc).toMatch(/assertStateAllowed\(req, projectId\)/);
  });

  it("logic is unchanged: assertPlanStateAllowed still denies HQ plans and mismatched states for state-scoped roles", () => {
    // Renaming must not have altered the guard's actual rules.
    expect(plansSrc).toContain('if (planLocationType === "hq" || planStateId === null)');
    expect(plansSrc).toContain('body: { error: "hq_forbidden" }');
    expect(plansSrc).toContain('body: { error: "state_forbidden" }');
  });
});
