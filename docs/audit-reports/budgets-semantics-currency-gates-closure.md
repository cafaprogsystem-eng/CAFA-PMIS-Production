# Budgets Module — Semantics, Currency & Endpoint-Gate Closure

Task scope: BUD-006, BUD-007, BUD-013 remediation + BUD-005 safety check.
All findings re-verified against current merged code before changes were made.
No FX conversion added. No State Allocation schema change (BUD-BD-02 remains open).

## BUD-006 — Project Detail currency & zero-budget semantics — CLOSED

**Zero-budget utilisation** (`artifacts/cafa-pmis/src/pages/project-detail.tsx`):
- Budget tab "unspent" figure: `budgetTotal = 0` previously rendered **"100% unspent"**; now returns `null` → `formatPercent` renders `—`.
- Budget tab "% of total" and overview utilisation card: previously `0%` for zero budgets; now `null` → `—` (0/0 utilisation is undefined, not 0%). Progress-bar width falls back to 0 while the label shows `—`.
- Genuine 0% preserved: `budgetTotal > 0` with `budgetSpent = 0` still renders `0%`.

**Currency threading** — `projectCurrency` (the project's ISO code from the API response) is now passed to every `formatCurrency` call that previously fell back to USD:
- Overview budget card (total / spent / remaining), overview KPI strip (budget + burn-rate expenditure sub-label)
- Budget tab header description, KPI tiles, activities spend/planned column
- State Allocation single-state card, allocation table cell and totals strip

**State Allocation labelling** (BUD-BD-02 open): allocation amounts are displayed in Project currency (existing semantics — no allocation-level currency column added). The currency context is now explicit: allocation headings render as e.g. "Budget Allocation (EUR)".

**`budget.tsx` ProjectBudgetView**:
- KPI cards now use the null-aware `fmtMoney(value, projectInfo?.currency)` (no USD fallback).
- Chart Y-axis: hardcoded `$${v/1000}k` replaced with `"{CUR} {v}k"` using the project ISO code.
- Chart tooltip now formats via `fmtMoney` with the project currency.
- PDF export already used project currency — unchanged.

## BUD-007 — Sector-performance cross-currency ratio — CLOSED

`GET /dashboard/sector-performance` (`artifacts/api-server/src/routes/dashboard.ts`) previously computed
`budgetUtilizationPct = SUM(spent across all currencies) / SUM(budget across all currencies) × 100`.

Fix (Option B, aligned with the existing sector-budget mixed-currency pattern):
- Query now returns per-sector `currencyCount` (`COUNT(DISTINCT NULLIF(p.currency,''))`), raw `totalBudget` and `totalSpent`.
- Response mapping:
  - `currencyCount > 1` → `budgetUtilizationPct: null`, `mixedCurrencies: true`
  - single currency, `budget > 0` and spend recorded → `Math.round(spent/budget × 100)` (overspend >100% preserved)
  - zero/null budget or null spend → `null` (unavailable ≠ 0%)

**OpenAPI change** (`lib/api-spec/openapi.yaml` → clients regenerated via orval, dist rebuilt):
- `SectorPerformance.budgetUtilizationPct`: `integer` → `["integer","null"]`
- `SectorPerformance.mixedCurrencies`: new required `boolean`

Frontend consumers: no active component renders this field (the dashboard only pre-fetches the endpoint); `states.tsx` / `state-detail.tsx` utilisation figures come from the state endpoints and were already null-safe.

## BUD-013 — Endpoint-level role gates — CLOSED

`requireBudgetDonorsRole()` (existing helper over the existing `BUDGET_DONORS_ROLES` set — no duplicated role strings) is now applied upfront in:
- `GET /dashboard/summary`
- `GET /dashboard/sector-budget`
- `GET /dashboard/sector-performance`

Role matrix enforced:
- ALLOW: `super_admin`, `executive_director`, `program_manager`, `senior_program_coordinator`, `technical_coordinator` (sector-scoped), `state_program_officer` (scoped)
- DENY (403): `state_office_manager`, `project_officer`, `program_assistant`, `viewer`
- `BUDGET_DONORS_ROLES` verified to exclude SOM.
- TC fail-closed scope unchanged: the role gate runs *before* `userScope()`; a TC with no sectors passes the gate and receives the empty fail-closed payload.
- Unauthenticated requests still return 401 via `requireAuth` (verified by test).

**Frontend note**: the main dashboard previously called `/dashboard/summary` (and pre-fetched `/dashboard/sector-performance`) for all roles; those hooks are now gated with `enabled: canViewBudgetAndDonors(role)` so denied roles no longer issue requests that would 403. For those roles the summary-driven KPI figures on the dashboard are no longer populated — this is the consequence of the approved role matrix (summary carries organisation-wide financial analytics).

## BUD-005 — Legacy summary totals — CLOSED (compatibility-safe residual)

Verified in current merged code:
- `budget.tsx OverviewView` consumes top-level `totalBudget`/`totalSpent` **only** when `!currencyMixed` (single-currency portfolios), and even then prefers the per-currency row. Mixed portfolios render per-currency rows exclusively, with the mixed-currency notice.
- `dashboard.tsx` renders `fmtMoney(summary.totalSpent, summary.currency)`; `summary.currency` is `null` when mixed, and that `fmtMoney` returns `—` for a null currency — no cross-currency figure is displayed.

Legacy fields retained unchanged for single-currency consumers.

## Tests

- `artifacts/cafa-pmis/src/test/budget-detail-closure.test.ts` — BUD-DETAIL-01…05
- `artifacts/api-server/src/routes/__tests__/budget-sector-performance-closure.test.ts` — BUD-SECTOR-01…05 (supertest against the real router with a mocked pool)
- `artifacts/api-server/src/routes/__tests__/budget-role-gates-closure.test.ts` — BUD-GATE-01…08 (per-role 403s, TC scoping, TC fail-closed, PM/super_admin pass, 401 unauthenticated)

Regression: full api-server suite (73 files / 1904 tests) green, including BUD-AUD-01…20; full cafa-pmis suite green; frontend `tsc --noEmit` clean; `tsc --build` (libs) clean. The 7 pre-existing type errors in `plans-aggregate-integration.test.ts` exist on the clean tree and are not attributable.

## Remaining Budget findings

- BUD-BD-01 (open business decision)
- BUD-BD-02 (open — allocation-level currency; allocations displayed in Project currency until resolved)
- BUD-BD-03 (open business decision)
- BUD-BD-04 (open business decision)

Budgets module is **not** declared fully closed.
