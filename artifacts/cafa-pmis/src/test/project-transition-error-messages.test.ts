/**
 * PROJ-TRANSITION-ERR — TransitionDialog must read the ApiError shape it's
 * actually thrown with.
 *
 * custom-fetch.ts's ApiError carries the parsed response body on `.data`,
 * never on `.response.data` (`.response` is the raw fetch Response object).
 * Reading the wrong path meant "Cannot approve — N unresolved Required
 * Correction(s)" and the revision/rejection comment-required message never
 * actually rendered — every rejection fell through to a generic String(e),
 * hiding exactly the actionable detail (how many corrections, by how much
 * the budget/beneficiary breakdown is over) the backend was already sending.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(__dirname, "../pages/project-detail.tsx"), "utf8");

describe("PROJ-TRANSITION-ERR — reads err.data, not err.response.data", () => {
  it("no longer reads the never-populated err.response.data path", () => {
    expect(src).not.toContain("err.response?.data");
  });

  it("reads err.data for the error code and count", () => {
    expect(src).toContain("const code = err.data?.error;");
    expect(src).toContain("err.data?.count ?? 0");
  });

  it("surfaces the new budget/beneficiary breakdown and status-conflict gate messages", () => {
    expect(src).toContain("budget_breakdown_exceeds_total");
    expect(src).toContain("beneficiaries_breakdown_exceeds_target");
    expect(src).toContain("project_status_conflict");
  });
});
