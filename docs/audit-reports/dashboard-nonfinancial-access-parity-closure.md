# Dashboard Non-Financial Access Parity Closure

**Date**: 2026-08-19
**Issue**: #582 — Non-financial KPI access accidentally locked out for SOM and other roles when Budget financial gates were added.
**Resolution**: Per-field financial access control replaces upfront 403 gates on `/dashboard/summary` and `/dashboard/sector-performance`.

---

## Regression Analysis

### Root Cause
Task #575 (Budget endpoint gates — BUD-013) added `requireBudgetDonorsRole()` as an **upfront 403 gate** at the top of three dashboard handlers. This was correct for `/dashboard/sector-budget` (all fields financial) but over-broad for `/dashboard/summary` and `/dashboard/sector-performance`, which contain a mix of financial and non-financial fields.

### Roles Affected
| Role | Incorrectly blocked |
|---|---|
| `state_office_manager` | Yes — their entire state dashboard (project counts, risks, reports) was inaccessible |
| `project_officer` | Yes — any dashboard data was inaccessible |
| `program_assistant` | Yes — any dashboard data was inaccessible |
| `viewer` | Yes — any dashboard data was inaccessible |

### Widgets Affected (dashboard.tsx)
- **Active Projects KPI card** — uses `summary.activeProjects`, `summary.totalProjects` (non-financial)
- **Beneficiaries Reached card** — uses `summary.totalBeneficiaries`, `summary.beneficiariesTarget` (non-financial)
- **Activities Requiring Attention card** — uses `summary.delayedActivities` (non-financial)
- **Project Implementation Status pie** — uses `summary.byStatus` (non-financial)
- **Monthly Achievement Trend** — uses `summary.monthlyAchievement` (non-financial)
- **Operational Follow-Up criticalRisks** — uses `summary.criticalRisks` (non-financial)
- **Overview sector chart** — uses sector-performance prefetch (beneficiaries, achievement — non-financial)

---

## Financial Access (Unchanged Gates)

The following financial fields are returned **only** to `BUDGET_DONORS_ROLES` via per-field gating (spread conditional `...(hasBudgetAccess ? {...} : {})`):

| Field | Endpoint | Gate |
|---|---|---|
| `totalBudget` | `/dashboard/summary` | `BUDGET_DONORS_ROLES` only |
| `totalSpent` | `/dashboard/summary` | `BUDGET_DONORS_ROLES` only |
| `budgetRemaining` | `/dashboard/summary` | `BUDGET_DONORS_ROLES` only |
| `budgetAllocated` | `/dashboard/summary` | `BUDGET_DONORS_ROLES` only |
| `budgetUtilization` | `/dashboard/summary` | `BUDGET_DONORS_ROLES` only |
| `burnRatePct` | `/dashboard/summary` | `BUDGET_DONORS_ROLES` only |
| `currency` | `/dashboard/summary` | `BUDGET_DONORS_ROLES` only |
| `currencyMixed` | `/dashboard/summary` | `BUDGET_DONORS_ROLES` only |
| `budgetByCurrency` | `/dashboard/summary` | `BUDGET_DONORS_ROLES` only |
| `budgetUtilizationPct` | `/dashboard/sector-performance` | `BUDGET_DONORS_ROLES` only (null for others) |
| All fields | `/dashboard/sector-budget` | `requireBudgetDonorsRole()` upfront gate (unchanged) |

**Implementation**: Financial fields are structurally absent from the JSON response for non-Budget roles (not zeroed, not CSS-hidden — not present in the response body). Confirmed by DASH-ACCESS-10.

---

## Non-Financial Access (Restored)

The following fields are now returned to **all authenticated roles**, scoped by `userScope()`:

| Field | Scoping |
|---|---|
| `activeProjects` | TC: sector; SPO/SOM: state; others: org-wide |
| `totalProjects` | TC: sector; SPO/SOM: state |
| `completedProjects` | TC: sector; SPO/SOM: state |
| `statesCount` | org-wide count |
| `totalBeneficiaries` | TC: sector; SPO/SOM: state |
| `beneficiariesTarget` | TC: sector; SPO/SOM: state |
| `highRiskStates` | scoped |
| `openRisks` | scoped |
| `criticalRisks` | scoped |
| `reportsSubmitted` | scoped |
| `reportsPending` | scoped |
| `activitiesPlanned` | scoped |
| `activitiesCompleted` | scoped |
| `pendingApprovalsCount` | scoped |
| `delayedActivities` | scoped |
| `byStatus` | scoped |
| `monthlyAchievement` | scoped |
| `sector`, `projects`, `beneficiaries`, `indicatorAchievementPct`, `mixedCurrencies` | `/dashboard/sector-performance` — TC sector-scoped |

---

## Role Matrix

| Role | Non-financial dashboard | Financial dashboard | `/dashboard/sector-budget` |
|---|---|---|---|
| `super_admin` | ✓ (full scope) | ✓ | ✓ |
| `executive_director` | ✓ (full scope) | ✓ | ✓ |
| `program_manager` | ✓ (full scope) | ✓ | ✓ |
| `senior_program_coordinator` | ✓ (full scope) | ✓ | ✓ |
| `technical_coordinator` | ✓ (sector-scoped) | ✓ (sector-scoped) | ✓ |
| `state_program_officer` | ✓ (state-scoped) | ✓ (state-scoped) | ✓ |
| `state_office_manager` | ✓ (state-scoped) | ✗ (fields absent) | 403 |
| `project_officer` | ✓ (scoped) | ✗ (fields absent) | 403 |
| `program_assistant` | ✓ (scoped) | ✗ (fields absent) | 403 |
| `viewer` | ✓ (if authenticated) | ✗ (fields absent) | 403 |

---

## Scope Verification

- **TC sector scoping**: `userScope()` returns `{ sectors: [tc.sector] }` for `technical_coordinator`. The `projectScopeWhere()` helper applies this as a `WHERE p.sector = $N` clause. Both `/dashboard/summary` and `/dashboard/sector-performance` pass scope through `projectScopeWhere()` — TC sees only their sector's data.
- **SOM/SPO state scoping**: `userScope()` returns `{ stateId: user.stateId }` for both `state_program_officer` and `state_office_manager`. The `projectScopeWhere()` helper applies `WHERE EXISTS (SELECT 1 FROM project_states ps WHERE ps.project_id = p.id AND ps.state_id = $N)`. SOM sees only their state's projects, risks, reports, and activities.

---

## API / Frontend Changes

### Backend (`artifacts/api-server/src/routes/dashboard.ts`)

1. **`/dashboard/summary`** — Removed `if (!requireBudgetDonorsRole(req, res)) return;` upfront gate. The existing `hasFinancialAccess` per-field conditional spread (already in place at the response block) now controls financial field inclusion. All non-financial fields always returned to authenticated roles.

2. **`/dashboard/sector-performance`** — Removed `if (!requireBudgetDonorsRole(req, res)) return;` upfront gate. Added `const hasBudgetAccess = BUDGET_DONORS_ROLES.has(req.currentUser?.role ?? "");` and applied it to null out `budgetUtilizationPct` for non-Budget roles.

3. **`/dashboard/sector-budget`** — **No change**. `requireBudgetDonorsRole()` gate remains intact.

### Frontend (`artifacts/cafa-pmis/src/pages/dashboard.tsx`)

- Removed `enabled: canViewBudgetAndDonors(role)` guard from `useGetDashboardSummary` hook call (line ~2993).
- Removed `enabled: canViewBudgetAndDonors(role)` guard from `useGetSectorPerformance` prefetch call (line ~2995).
- All authenticated users now fetch the summary. The server returns only what their role permits.
- Financial card render guards (`canViewBudgetAndDonors(role)` checks in JSX) remain unchanged — financial cards still conditionally render based on role, and server-nulled financial fields reinforce this.

---

## Files Changed

- `artifacts/api-server/src/routes/dashboard.ts` — Backend gate changes
- `artifacts/cafa-pmis/src/pages/dashboard.tsx` — Frontend hook guard removal
- `artifacts/api-server/src/routes/__tests__/dashboard-access-parity.test.ts` — 13 access-parity tests (new)
- `docs/audit-reports/dashboard-nonfinancial-access-parity-closure.md` — This file

---

## Tests

| ID | Description | Expected |
|---|---|---|
| DASH-ACCESS-01 | PM on `/dashboard/summary` → 200 + financial keys present | ✓ |
| DASH-ACCESS-02 | SOM on `/dashboard/summary` → 200 (not 403) | ✓ |
| DASH-ACCESS-03 | SOM response includes `activeProjects`, `criticalRisks`, `reportsSubmitted` | ✓ |
| DASH-ACCESS-04 | `project_officer` on `/dashboard/summary` → 200 | ✓ |
| DASH-ACCESS-05 | `project_officer` response includes non-financial counts | ✓ |
| DASH-ACCESS-06 | `program_assistant` → 200 with non-financial fields | ✓ |
| DASH-ACCESS-07 | Unauthenticated → 401 | ✓ |
| DASH-ACCESS-08 | TC on `/dashboard/sector-performance` → 200 with sector fields | ✓ |
| DASH-ACCESS-09 | SOM with stateId state-scoped (200, scoping via userScope) | ✓ |
| DASH-ACCESS-10 | SOM response body contains no `totalBudget` or `budgetByCurrency` keys | ✓ |
| DASH-ACCESS-11 | `/dashboard/sector-budget` → SOM/PO/PA still get 403 | ✓ |
| DASH-ACCESS-12 | TC sector-performance response has `sector`, `projects`, `beneficiaries`, `indicatorAchievementPct` | ✓ |
| DASH-ACCESS-13 | Non-Budget roles sector-performance `budgetUtilizationPct` is null | ✓ |

---

## Budget Security Regression Confirmation

**Financial gates remain fully intact** after this change:

1. **`/dashboard/sector-budget`**: `requireBudgetDonorsRole()` upfront gate unchanged. SOM, PO, PA receive 403. Confirmed by DASH-ACCESS-11.

2. **`/dashboard/summary`** financial fields for SOM/PO/PA:
   - `totalBudget` — **absent** from response body (not null, not zeroed — key not present)
   - `totalSpent` — **absent**
   - `budgetByCurrency` — **absent**
   - `burnRatePct` — **absent**
   - Confirmed structurally by the spread conditional: `...(hasBudgetAccess ? {...} : {})` — when `hasBudgetAccess` is false, the spread is empty, so none of the financial keys appear in the JSON response. Confirmed by DASH-ACCESS-10.

3. **`/dashboard/sector-performance`** `budgetUtilizationPct` for SOM/PO/PA: value is `null`. This field is already planned to become null for all roles after #586 (budget proxy removal). Confirmed by DASH-ACCESS-13.

4. **Frontend financial card rendering**: `canViewBudgetAndDonors(role)` role checks in JSX (`dashboard.tsx:4490`, `4637`, `4659`) remain unchanged. Budget Utilisation card and budget totals are never rendered for non-Budget roles regardless of server response.
