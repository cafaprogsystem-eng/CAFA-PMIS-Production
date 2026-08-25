/**
 * BUD-HIST — historical over-allocation detection (Task #608, follow-up #598).
 *
 * Pure mirror of the migration 029 detection query (run-migrations.ts,
 * 029_allocation_cap_residual_warning): a non-deleted project with at least
 * one state allocation row violates the cap when
 *   SUM(project_state_allocations.budget_allocation) > projects.budget_total.
 *
 * This module makes NO data changes. Remediation of historical violations is
 * a human financial decision recorded in
 * docs/audit-reports/budgets-historical-overallocation-reconciliation.md.
 * No automatic scaling (LEAST, proportional, equal split, budget increase)
 * may ever be added here — see BUD-HIST-07.
 */

export interface ProjectBudgetRow {
  id: number;
  budgetTotal: number;
  status: string;
  deletedAt: string | null;
}

export interface AllocationRow {
  projectId: number;
  budgetAllocation: number;
}

export interface OverAllocationFinding {
  projectId: number;
  status: string;
  budgetTotal: number;
  allocTotal: number;
  overAmount: number;
  allocRows: number;
}

export function detectOverAllocations(
  projects: ProjectBudgetRow[],
  allocations: AllocationRow[],
): OverAllocationFinding[] {
  const findings: OverAllocationFinding[] = [];
  for (const p of projects) {
    // Mirrors `WHERE p.deleted_at IS NULL` — soft-deleted projects are
    // intentionally excluded from the portfolio invariant.
    if (p.deletedAt !== null) continue;
    const rows = allocations.filter((a) => a.projectId === p.id);
    // Mirrors the inner JOIN: projects without allocation rows never appear.
    if (rows.length === 0) continue;
    const allocTotal = rows.reduce((s, a) => s + a.budgetAllocation, 0);
    const budgetTotal = p.budgetTotal ?? 0;
    if (allocTotal > budgetTotal) {
      findings.push({
        projectId: p.id,
        status: p.status,
        budgetTotal,
        allocTotal,
        overAmount: allocTotal - budgetTotal,
        allocRows: rows.length,
      });
    }
  }
  return findings;
}
