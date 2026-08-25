---
name: Budgets Overview data integrity rules
description: Canonical rules for the Budgets module Overview tab — scope, currency, null vs zero, export labels, and donor real data.
---

## SPO scope in Summary endpoint
`/dashboard/summary` uses `userScope(req)` (sync), NOT `await buildScope(req)`.
`buildScope` rewrites SPO to project_assignments; `userScope` preserves the raw stateId so the JOIN to `project_state_allocations` / `project_states` works correctly.

**Why:** SPO's authorised projects are defined by their assigned state (project_states), not by explicit assignment records.

**How to apply:** Any new summary-family route that needs to respect SPO state scoping must call `userScope()` before `applyFilterParams()`.

## Null ≠ Zero for spend
`budgetByCurrency[].totalSpent` is `number | null` — null when no activity records exist for that currency's projects.
SQL uses a bare subquery `(SELECT SUM(budget_spent)…)`, NOT `COALESCE(…, 0)`.
Frontend uses `val == null ? "—" : formatCurrency(val, curr)`.

**Why:** COALESCE-to-zero hides missing data; teams may confuse "£0 spent" with "no activities entered."

## budgetByCurrency always returned
Backend returns `budgetByCurrency[]` regardless of `currencyMixed` — the `currencyMixed ?` guard was removed.
Frontend can always rely on `summary.budgetByCurrency` being populated when `hasFinancialAccess`.

## Currency-aware formatters
- `formatCurrency(val, currency?)` — optional ISO 4217 code; when provided uses `currencyDisplay: "code"` (e.g. "USD 4,500,000"). No arg → `$` symbol (legacy backward compat).
- `formatPercent(val)` — `null → "—"`, `0 → "0%"`, adaptive 2dp, no clamping.
Both are in `artifacts/cafa-pmis/src/lib/format.ts`.

## Export function currency labels
`exportBudgetExcel` and `exportProjectCsv` use `opts.currency` for column headers (e.g. `Total Budget (USD)`). `printBudgetPdf` uses `data.currency` for the formatter. `printSectorPdf` uses a plain number formatter (no currency code) because sectors span multiple currencies.

## Donor portfolio real data
Flat query now includes `COALESCE(beneficiaries_male + … girls, 0)::int AS beneficiaries`.
Post-query: `SELECT project_id, SUM(budget_spent)::float AS spent FROM activities WHERE project_id = ANY($1::int[]) GROUP BY project_id` gets real spend per project.
TypeScript grouping accumulates `spentByCurrency: Map<string, number>` and `totalBeneficiaries: number` per donor group.
`budgetSpent: number | null` in `DonorPortfolioEntry` and `DonorPortfolioBudgetByCurrencyItem` — null = no activity records.

## OverviewView RBAC scope badge
Reads `me?.user?.role` via `useGetMe()`. Returns "Organisation-wide" / "Sectors: …" / "Assigned State" as a read-only Badge. Replaces the old inert "Organisation-wide" label string.

## Currency selector
Only rendered when `availableCurrencies.length > 1` (i.e. `currencyMixed = true`).
State: `selectedCurrency: string` default `"all"`.
Mixed + "all" → `showMultiCurrency = true` → per-currency breakdown mode in KPI cards and donor rows.
