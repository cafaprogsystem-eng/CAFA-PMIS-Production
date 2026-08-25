# Budgets — State Performance Budget Proxy Closure

## BUD-004 / BUD-BD-04

### Question

Should State performance include a budget utilisation score derived from
Project-level budget/spend for projects operating in that State?

### Business Decision

FINAL (BUD-BD-04 CLOSED): No CAFA surface may score a State using
fabricated State budget utilisation. There is no canonical State-level
expenditure source. The component must return null/unavailable.

### Previous Proxy

`computeStateScores` in `artifacts/api-server/src/services/performanceEngine.ts`
included the following SQL sub-query for each state row:

```sql
COALESCE((SELECT
  CASE WHEN SUM(p.budget_total) > 0
    THEN (COALESCE(SUM(pa.spent), 0) / SUM(p.budget_total) * 100)::int
    ELSE 0 END
  FROM project_states ps
  JOIN projects p ON p.id = ps.project_id
  LEFT JOIN (SELECT project_id, SUM(budget_spent) AS spent
             FROM activities GROUP BY project_id) pa ON pa.project_id = p.id
  WHERE ps.state_id = s.id), 0) AS "budgetUtilizationPct"
```

- This aggregated whole-Project `budget_total` and Activity-level `budget_spent`
  for all Projects operating in a State.
- The result was assigned a 15 % weight via `budgetUtilScore(utilPct)` in the
  `components.budgetUtilization` field.
- **Problem 1 — Fabricated proxy**: CAFA has no State-level expenditure ledger.
  Using Project budgets as a proxy is architecturally incorrect.
- **Problem 2 — Multi-currency arithmetic**: Projects may be budgeted in
  different currencies; `SUM(p.budget_total)` added values across currencies
  without conversion, producing a meaningless figure.
- **Problem 3 — Non-null zero**: `COALESCE(…, 0)` returned 0 when no
  budget data existed, treating "no data" the same as "0 % utilised", which
  depressed the performance score for States with no budget data.

### Fix Applied

1. **SQL removed**: The `budget_total` / `budget_spent` sub-query is replaced
   with `NULL::int AS "budgetUtilizationPct"` in `computeStateScores`.

2. **Component nulled**: `components.budgetUtilization` is assigned `null`
   unconditionally (instead of `budgetUtilScore(utilPct)`).

3. **Raw field nulled**: `StateScoreRow.budgetUtilizationPct` is returned as
   `null` and the TypeScript interface updated to `number | null`.

4. **OpenAPI updated**: `StatePerformance.budgetUtilizationPct` changed to
   `{ type: integer, nullable: true }` and removed from the `required` array.

### Renormalisation

`computeWeightedScore` iterates `Object.keys(W)` and skips any component where
`val === null || val === undefined`. With `budgetUtilization: null`:

```
totalWeight = 0.25 + 0.20 + 0.20 + 0.10 + 0.10 = 0.85
performanceScore = Math.round(weightedSum / 0.85)
```

No manual weight redistribution is needed. The function returns `null` only
when fewer than 2 components have data.

### Multi-Currency Safety

Removing the proxy SQL eliminates the cross-currency `SUM(budget_total)` from
the State performance query. State scores are now currency-agnostic.

### Project-Level Budget Performance Unchanged

The `computePerformance` function (single-project analytics) retains its own
budget query using `project.budget_total` and activity spend. The
`budgetUtilScore` helper function is preserved for that path.

### Tests

`artifacts/api-server/src/services/__tests__/performance-engine-state-budget.test.ts`

| ID | Description |
|---|---|
| BUD-STATE-01 | `computeStateScores` returns `components.budgetUtilization = null` |
| BUD-STATE-02 | `computeStateScores` returns `budgetUtilizationPct = null` |
| BUD-STATE-03 | No `budget_total` or `budget_spent` in the SQL query |
| BUD-STATE-04 | `performanceScore` with null budget is not the same as treating budget = 0% |
| BUD-STATE-05 | `computeWeightedScore` with 5 non-null components renormalises correctly |
| BUD-STATE-06 | `performanceScore` is a valid integer (no NaN) when 5 components available |
| BUD-STATE-07 | Project-level `budgetUtilScore` helper is unchanged |
| BUD-STATE-08 | PM role receives null budget component (actor-independent) |
| BUD-STATE-09 | Super Admin receives null budget component (actor-independent) |
| BUD-STATE-10 | No invented substitute financial metric in state components |

### Status

- **BUD-004**: CLOSED
- **BUD-BD-04**: IMPLEMENTED

### Remaining Budget Findings

The following BUD findings remain open at the time of this closure:

- **BUD-001** (CLOSED): `GET /states` standalone endpoints already return
  `NULL::int AS budgetUtilizationPct` — UI correctly shows `—`.
- **BUD-002 / BUD-003**: Per the module audit in `budgets-module-audit.md`,
  allocation uniqueness, FK and CHECK constraints are addressed in migration 027.
