/**
 * DASH-PENDING-01 — Summary "pending approvals" project count uses the same
 * awaiting-approval status set as the real Pending Approvals endpoint.
 *
 * The summary KPI used to count any project whose status was NOT IN
 * ('approved','rejected','draft') — which also matched 'active' and
 * 'closed' projects that have already completed the entire approval
 * workflow. A portfolio with many active/closed projects and only a
 * handful actually awaiting approval showed a wildly inflated "Pending
 * Approvals" count on the summary card versus the real detail view
 * (GET /dashboard/pending-approvals, whose roleSteps union is exactly
 * ['submitted', 'technically_approved', 'coordination_approved']).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(resolve(__dirname, "dashboard.ts"), "utf8");

describe("DASH-PENDING-01 — pending-approvals project count status set", () => {
  it("no longer uses the overly-broad NOT IN exclusion", () => {
    expect(SRC).not.toContain("p.status NOT IN ('approved','rejected','draft')");
  });

  it("uses the shared AWAITING_PROJECT_APPROVAL_STATUSES_SQL constant (submitted, technically_approved, coordination_approved)", () => {
    expect(SRC).toContain("AWAITING_PROJECT_APPROVAL_STATUSES_SQL");
    expect(SRC).toContain("p.status = ANY(${AWAITING_PROJECT_APPROVAL_STATUSES_SQL})${scopeSql}) AS proj,");
  });
});
