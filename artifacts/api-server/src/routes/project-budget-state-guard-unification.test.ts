/**
 * PRJ-BUDGET-STATE-GUARD — GET /projects/:projectId/budget used to run its own
 * hand-rolled "project_states OR project_assignments" UNION query for state-role
 * access instead of the centralized assertStateAllowed guard every other project
 * route uses (state_office_manager scoped to project_states, state_program_officer
 * scoped to their explicit project_assignments). That independent check was
 * broader than the shared guard, so the two endpoints could disagree on access
 * for the same project/user.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(__dirname, "projects.ts"), "utf8");

describe("PRJ-BUDGET-STATE-GUARD — budget endpoint uses the shared assertStateAllowed guard", () => {
  it("no longer runs its own project_states/project_assignments UNION query", () => {
    expect(src).not.toMatch(/SELECT 1 FROM project_states ps WHERE ps\.project_id = \$1 AND ps\.state_id = \$2\s*\n\s*UNION ALL/);
  });

  it("calls the centralized assertStateAllowed guard inside the /budget handler", () => {
    const budgetHandlerStart = src.indexOf('router.get("/projects/:projectId/budget"');
    expect(budgetHandlerStart).toBeGreaterThan(-1);
    const nextHandlerStart = src.indexOf("router.", budgetHandlerStart + 1);
    const handlerBody = src.slice(budgetHandlerStart, nextHandlerStart === -1 ? undefined : nextHandlerStart);
    expect(handlerBody).toContain("await assertStateAllowed(req, projectId)");
  });
});
