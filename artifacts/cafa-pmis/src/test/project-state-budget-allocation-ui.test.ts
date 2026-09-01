/**
 * PRJ-STATE-ALLOC-UI — the create/edit project form already had a
 * stateAllocations schema and payload plumbing (budget/beneficiary per
 * state), but no fields ever existed to enter it, so state-level budget
 * distribution could never be set at project creation.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(__dirname, "../components/project-registration-form.tsx"), "utf8");

describe("PRJ-STATE-ALLOC-UI — per-state budget/beneficiary allocation fields", () => {
  it("toggling a state keeps stateAllocations rows in sync", () => {
    expect(src).toContain('form.setValue("stateAllocations", currentAllocations.filter(a => a.stateId !== id));');
    expect(src).toContain('form.setValue("stateAllocations", [...currentAllocations, { stateId: id }]);');
  });

  it("renders a budget allocation and beneficiary target input per selected state", () => {
    expect(src).toContain("t(\"form.location.stateAllocationSection\")");
    expect(src).toMatch(/name=\{`stateAllocations\.\$\{rowIndex\}\.budgetAllocation`\}/);
    expect(src).toMatch(/name=\{`stateAllocations\.\$\{rowIndex\}\.beneficiaryTarget`\}/);
  });

  it("warns when the sum of per-state allocations exceeds the total project budget", () => {
    expect(src).toContain("stateAllocationExceeds");
    expect(src).toContain("allocatedBudget > watchedBudgetTotal");
  });
});
