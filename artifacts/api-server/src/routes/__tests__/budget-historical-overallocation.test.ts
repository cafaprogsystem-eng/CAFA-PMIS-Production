/**
 * BUD-HIST — Budgets Module: Historical Over-Allocation Reconciliation (Task #608)
 *
 * Sentinels pinning the reconciliation outcome recorded in
 * docs/audit-reports/budgets-historical-overallocation-reconciliation.md.
 *
 * Reconciliation verdict (2026-08-19): 8 non-deleted projects violate the cap.
 * All 8 allocation rows share one bulk-backfill created_at timestamp and carry
 * uniform ×1.04 / ×1.12 multipliers over budget_total; the audit_log contains
 * ZERO state_allocations_replace entries, so no canonical prior value is
 * recoverable from system evidence. All 8 are classified category D
 * (pre-enforcement import/backfill artefact, no recoverable canonical value)
 * and are recorded in the human-decision register. NO automatic remediation
 * migration was created — deliberately.
 *
 * BUD-HIST-01  Detection logic flags an over-allocated project
 * BUD-HIST-02  Exact-cap project (alloc == budget) is NOT flagged
 * BUD-HIST-03  Under-cap project is NOT flagged
 * BUD-HIST-04  Zero-budget project with positive allocation IS flagged
 * BUD-HIST-05  Closed project is included (portfolio rule: status-independent)
 * BUD-HIST-06  Soft-deleted project is excluded (behaviour pinned)
 * BUD-HIST-07  No automatic scaling/correction logic exists in routes or migrations
 * BUD-HIST-08  No automatic remediation migration exists (deliberate — category D only)
 * BUD-HIST-09  Migration 029 remains warning-only (precondition: no destructive SQL)
 * BUD-HIST-10  Post-reconciliation invariant: register count equals detection count
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import {
  detectOverAllocations,
  type ProjectBudgetRow,
  type AllocationRow,
} from "../../lib/budgetReconciliation.js";

const migrationsSrc = readFileSync(
  resolve(import.meta.dirname, "../../lib/run-migrations.ts"),
  "utf8",
);
const projectsSrc = readFileSync(resolve(import.meta.dirname, "../projects.ts"), "utf8");

const P = (over: Partial<ProjectBudgetRow>): ProjectBudgetRow => ({
  id: 1,
  budgetTotal: 1000,
  status: "active",
  deletedAt: null,
  ...over,
});
const A = (projectId: number, budgetAllocation: number): AllocationRow => ({
  projectId,
  budgetAllocation,
});

describe("BUD-HIST-01: detection flags an over-allocated project", () => {
  it("alloc 1100 > budget 1000 → flagged with over_amount 100", () => {
    const out = detectOverAllocations([P({})], [A(1, 600), A(1, 500)]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ projectId: 1, allocTotal: 1100, overAmount: 100, allocRows: 2 });
  });
});

describe("BUD-HIST-02: exact-cap project is not flagged", () => {
  it("alloc == budget → no finding", () => {
    expect(detectOverAllocations([P({})], [A(1, 400), A(1, 600)])).toHaveLength(0);
  });
});

describe("BUD-HIST-03: under-cap project is not flagged", () => {
  it("alloc < budget → no finding", () => {
    expect(detectOverAllocations([P({})], [A(1, 999)])).toHaveLength(0);
  });
});

describe("BUD-HIST-04: zero-budget project with positive allocation is flagged", () => {
  it("budget 0, alloc 1 → flagged", () => {
    const out = detectOverAllocations([P({ budgetTotal: 0 })], [A(1, 1)]);
    expect(out).toHaveLength(1);
    expect(out[0].overAmount).toBe(1);
  });
});

describe("BUD-HIST-05: closed projects are included (status-independent invariant)", () => {
  it("closed project over cap → flagged", () => {
    const out = detectOverAllocations([P({ status: "closed" })], [A(1, 2000)]);
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe("closed");
  });
});

describe("BUD-HIST-06: soft-deleted projects are excluded (pinned behaviour)", () => {
  it("deletedAt set → not flagged even when over cap", () => {
    const out = detectOverAllocations(
      [P({ deletedAt: "2026-01-01T00:00:00Z" })],
      [A(1, 99999)],
    );
    expect(out).toHaveLength(0);
  });
});

describe("BUD-HIST-07: no automatic scaling/correction logic anywhere", () => {
  it("migrations contain no auto-correction of allocation amounts to fit budget", () => {
    // Forbidden auto-remediation shapes (BUD out-of-scope list).
    expect(migrationsSrc).not.toMatch(/LEAST\s*\(\s*(psa\.)?budget_allocation/i);
    expect(migrationsSrc).not.toMatch(/budget_allocation\s*\*\s*/);
    expect(migrationsSrc).not.toMatch(/SET\s+budget_total\s*=\s*.*alloc/i);
  });
  it("routes contain no scaling of allocations to fit budget", () => {
    expect(projectsSrc).not.toMatch(/LEAST\s*\(\s*allocation/i);
    expect(projectsSrc).not.toMatch(/proportional/i);
  });
});

describe("BUD-HIST-08: no automatic remediation migration exists (deliberate)", () => {
  it("no migration after 029 mutates project_state_allocations amounts", () => {
    // Reconciliation classified all historical violations as category D
    // (no recoverable canonical value) — remediation is a human decision,
    // so no correction migration may exist.
    const after029 = migrationsSrc.slice(
      migrationsSrc.indexOf("029_allocation_cap_residual_warning"),
    );
    expect(after029).not.toMatch(/UPDATE\s+project_state_allocations/i);
    expect(after029).not.toMatch(/UPDATE\s+projects\s+SET\s+budget_total/i);
  });
  it("the human-decision register exists in the audit artefact", () => {
    const doc = resolve(
      import.meta.dirname,
      "../../../../../docs/audit-reports/budgets-historical-overallocation-reconciliation.md",
    );
    expect(existsSync(doc)).toBe(true);
    const text = readFileSync(doc, "utf8");
    expect(text).toContain("Human-Decision Remediation Register");
  });
});

describe("BUD-HIST-09: migration 029 remains warning-only", () => {
  it("029 block contains RAISE WARNING and no data mutation", () => {
    const start = migrationsSrc.indexOf("029_allocation_cap_residual_warning");
    expect(start).toBeGreaterThan(-1);
    // Slice up to the end of the migrations array to bound the 029 body.
    const body = migrationsSrc.slice(start, start + 2500);
    expect(body).toContain("RAISE WARNING");
    expect(body).not.toMatch(/\bUPDATE\b/);
    expect(body).not.toMatch(/\bDELETE\s+FROM\b/);
  });
});

describe("BUD-HIST-10: register count equals detection count over the recorded dataset", () => {
  // The exact violating dataset recorded on 2026-08-19 (see audit artefact).
  const recorded: Array<{ id: number; budget: number; alloc: number; status: string }> = [
    { id: 3, budget: 780000, alloc: 811200, status: "approved" },
    { id: 4, budget: 3200000, alloc: 3584000, status: "approved" },
    { id: 11, budget: 540000, alloc: 561600, status: "draft" },
    { id: 12, budget: 890000, alloc: 996800, status: "draft" },
    { id: 16, budget: 50000, alloc: 52000, status: "technically_approved" },
    { id: 17, budget: 100000, alloc: 112000, status: "closed" },
    { id: 21, budget: 1000, alloc: 1040, status: "submitted" },
    { id: 25, budget: 557869, alloc: 580184, status: "closed" },
  ];

  it("detection over the recorded dataset returns exactly the 8 register entries", () => {
    const projects = recorded.map((r) =>
      P({ id: r.id, budgetTotal: r.budget, status: r.status }),
    );
    const allocs = recorded.map((r) => A(r.id, r.alloc));
    const out = detectOverAllocations(projects, allocs);
    expect(out.map((f) => f.projectId)).toEqual([3, 4, 11, 12, 16, 17, 21, 25]);
    expect(out).toHaveLength(8);
  });

  it("the audit artefact records all 8 projects and the blocked verdict", () => {
    const doc = resolve(
      import.meta.dirname,
      "../../../../../docs/audit-reports/budgets-historical-overallocation-reconciliation.md",
    );
    const text = readFileSync(doc, "utf8");
    for (const r of recorded) expect(text).toContain(`| ${r.id} |`);
    expect(text).toMatch(/8 projects? blocked by outstanding human decisions/i);
  });
});
