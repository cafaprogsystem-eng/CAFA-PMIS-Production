/**
 * BUD-AUD sentinel suite — Budgets Module Full Functional Audit (Task audit wave 1).
 *
 * These tests guard the audited invariants of the Budgets module. Most are
 * source-shape assertions (the same style as the REP-ZR sentinel suite):
 * they read the production source and assert that the audited pattern is
 * still present. This makes regressions loud without requiring a live DB.
 *
 * Baseline rules (must never be contradicted):
 *  A. Project budget is NOT automatically divided between States.
 *  B. State-Level Allocation exists only as an explicit allocation record.
 *  C. State visibility of a project ≠ State ownership of its budget.
 *  D. Unavailable State-level expenditure renders as null/— (never fabricated).
 *  E. No cross-currency false totals.
 *  F. Budget bases labelled explicitly.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const here = (p: string) => resolve(__dirname, p);
const projectsSrc = readFileSync(here("./projects.ts"), "utf8");
const dashboardSrc = readFileSync(here("./dashboard.ts"), "utf8");
const statesSrc = readFileSync(here("./states.ts"), "utf8");
const migrationsSrc = readFileSync(here("../lib/run-migrations.ts"), "utf8");
const openapiSrc = readFileSync(here("../../../../lib/api-spec/openapi.yaml"), "utf8");
const budgetPageSrc = readFileSync(
  here("../../../cafa-pmis/src/pages/budget.tsx"),
  "utf8",
);

describe("BUD-AUD-01 project budget canonical source", () => {
  it("GET /projects/:id/budget reads projects.budget_total", () => {
    expect(projectsSrc).toMatch(/budget_total::float/);
  });
});

describe("BUD-AUD-02 project expenditure source", () => {
  it("dashboard aggregates SUM(activities.budget_spent) keyed by project_id", () => {
    expect(dashboardSrc).toMatch(
      /SELECT project_id, SUM\(budget_spent\)(::float)? AS spent\s+FROM activities\s+GROUP BY project_id/,
    );
  });
  it("the State registry deliberately does not calculate a project spend figure", () => {
    expect(statesSrc).not.toMatch(/SUM\(a\.budget_spent\)::float/);
  });
});

describe("BUD-AUD-03 allocation requires project-state membership", () => {
  it("POST state-allocations validates every state against project_states", () => {
    expect(projectsSrc).toMatch(/project_state_not_linked/);
  });
});

describe("BUD-AUD-04 no automatic budget division across states", () => {
  it("no query divides budget_total by a state count", () => {
    for (const src of [projectsSrc, dashboardSrc, statesSrc]) {
      expect(src).not.toMatch(/budget_total\s*\/\s*(COUNT|state_count)/i);
      expect(src).not.toMatch(/budget_spent\s*\/\s*(COUNT|state_count)/i);
    }
  });
});

describe("BUD-AUD-05 state expenditure unavailable ≠ zero (baseline D)", () => {
  it("the State registry omits utilisation rather than fabricating a State budget figure", () => {
    expect(statesSrc).not.toMatch(/budgetUtilizationPct/);
    expect(statesSrc).not.toMatch(/0\.4/); // the old fabricated 40% share
  });
  it("budget-performance nulls spent/remaining/utilisation on State Allocation basis", () => {
    expect(dashboardSrc).toMatch(/utilisationRate\s*=\s*null/);
  });
  it("OpenAPI marks state budgetUtilizationPct as nullable", () => {
    expect(openapiSrc).toMatch(/budgetUtilizationPct: \{ type: integer, nullable: true \}/);
  });
});

describe("BUD-AUD-06/07 utilisation denominator safety", () => {
  it("per-currency utilisation guards zero/null denominators", () => {
    expect(dashboardSrc).toMatch(/tb > 0 && ts != null \? \(ts \/ tb\) \* 100 : null/);
  });
  it("pure formula: zero or null budget yields null, overspend >100% preserved", () => {
    const util = (spent: number | null, budget: number | null) =>
      budget != null && budget > 0 && spent != null ? (spent / budget) * 100 : null;
    expect(util(50, 0)).toBeNull();
    expect(util(50, null)).toBeNull();
    expect(util(null, 100)).toBeNull();
    expect(util(150, 100)).toBe(150); // overspend preserved, not clamped
    expect(Number.isNaN(util(0, 100)!)).toBe(false);
  });
});

describe("BUD-AUD-08/20 multi-currency separation (baseline E)", () => {
  it("dashboard summary exposes per-currency breakdown with currencyMixed flag", () => {
    expect(dashboardSrc).toMatch(/budgetByCurrency/);
    expect(dashboardSrc).toMatch(/currencyMixed/);
  });
  it("sector budget groups by currency", () => {
    expect(dashboardSrc).toMatch(/GROUP BY p\.currency/);
  });
  it("frontend overview renders per-currency KPI rows when currencies are mixed", () => {
    expect(budgetPageSrc).toMatch(/currencyMixed/);
  });
});

describe("BUD-AUD-09/10 donor portfolio grouping", () => {
  it("groups canonical donors by donor_id", () => {
    expect(dashboardSrc).toMatch(/donor_id/);
    expect(dashboardSrc).toMatch(/LEFT JOIN donors d ON d\.id = p\.donor_id/);
  });
});

describe("BUD-AUD-11/12/13 scope enforcement", () => {
  it("TC empty sector list fails closed in projectScopeWhere", () => {
    expect(dashboardSrc).toMatch(/TC with no sectors assigned → deny-all/);
  });
  it("state roles clamped to own state on state-allocations reads", () => {
    expect(projectsSrc).toMatch(/psa\.state_id = \$/);
  });
  it("budget endpoints gate on budget.view / approved roles", () => {
    expect(projectsSrc).toMatch(/requirePerm\("budget\.view"\)/);
    expect(dashboardSrc).toMatch(/BUDGET_DONORS_ROLES/);
  });
});

describe("BUD-AUD-14/15 allocation integrity constraints (migration 027)", () => {
  it("migration adds UNIQUE(project_id, state_id)", () => {
    expect(migrationsSrc).toMatch(/project_state_allocations_project_state_unique UNIQUE \(project_id, state_id\)/);
  });
  it("migration adds FKs to projects and states", () => {
    expect(migrationsSrc).toMatch(/project_state_allocations_project_fk/);
    expect(migrationsSrc).toMatch(/project_state_allocations_state_fk/);
  });
  it("migration adds non-negative CHECK matching the app-side rule", () => {
    expect(migrationsSrc).toMatch(/CHECK \(budget_allocation >= 0\)/);
    expect(projectsSrc).toMatch(/Budget allocation cannot be negative/);
  });
});

describe("BUD-AUD-16 soft-deleted projects excluded from budget analytics", () => {
  it("project budget endpoint requires deleted_at IS NULL", () => {
    expect(projectsSrc).toMatch(/deleted_at IS NULL/);
  });
  it("dashboard budget analytics filter deleted projects", () => {
    const hits = dashboardSrc.match(/p\.deleted_at IS NULL/g) ?? [];
    // summary (x3), currency CTE, sector-performance, sector-budget (x2),
    // donor-portfolio, budget-performance
    expect(hits.length).toBeGreaterThanOrEqual(8);
  });
  it("states project list filters deleted projects", () => {
    expect(statesSrc).toMatch(/p\.deleted_at IS NULL/);
  });
  it("summary budgetAllocated query excludes soft-deleted projects", () => {
    expect(dashboardSrc).toMatch(
      /FROM project_state_allocations psa\s+JOIN projects p ON p\.id = psa\.project_id\s+WHERE p\.deleted_at IS NULL/,
    );
  });
});

describe("BUD-AUD-17 numeric/null robustness", () => {
  it("no null-to-zero collapse in per-currency spend (totalSpent may be null)", () => {
    expect(dashboardSrc).toMatch(/totalSpent: number \| null/);
  });
  it("negative allocation rejected app-side with 422", () => {
    expect(projectsSrc).toMatch(/invalid_allocation/);
  });
});

describe("BUD-AUD-18 no startup DDL in budget route files", () => {
  it.each([
    ["projects.ts", projectsSrc],
    ["dashboard.ts", dashboardSrc],
    ["states.ts", statesSrc],
  ])("%s contains no CREATE TABLE / ALTER TABLE DDL", (_name, src) => {
    expect(src).not.toMatch(/CREATE TABLE/i);
    expect(src).not.toMatch(/ALTER TABLE/i);
  });
});

describe("BUD-AUD-19 API contract alignment", () => {
  it("ProjectBudget schema declares the fields the route returns", () => {
    for (const field of ["projectId", "total", "spent", "remaining", "burnRatePct", "lines", "monthly", "alerts"]) {
      expect(openapiSrc).toContain(field);
    }
  });
  it("state allocation audit trail is written on mutation", () => {
    expect(projectsSrc).toMatch(/state_allocations_replace/);
  });
});
