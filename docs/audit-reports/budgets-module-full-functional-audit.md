# Budgets Module — Full Functional, Data-Integrity, Access & Calculation Audit

Date: 18 August 2026 · Wave: Functional Closure 1 · Verdict: **B** (sound architecture; one P0 fabrication and several P1 integrity gaps found and fixed; residual items tracked as findings/BDs)

## 1. Executive Summary

The Budgets module is architecturally sound: canonical sources are consistent (`projects.budget_total` for budget, `SUM(activities.budget_spent)` per project for expenditure), multi-currency handling is deliberate and correct on the primary Budget page, and role/scope enforcement is server-side. The audit found **one P0 defect** — the States pages displayed a *fabricated* budget utilisation figure (hard-coded 40 % share of project budgets, violating baseline rules A, C, D and E simultaneously) — plus P1 gaps in DB-level allocation integrity (no UNIQUE/FK/CHECK), missing audit logging on allocation mutations, and soft-deleted projects leaking into budget analytics. All were fixed in this wave. Remaining items are documented as findings and business decisions.

## 2. Module Architecture

**Frontend (artifacts/cafa-pmis):**
- `pages/budget.tsx` (~1.5 k lines): `BudgetPage` → `OverviewView` (dashboard summary + donor portfolio), `SectorBudgetView/Card/Detail` (sector budgets), `ProjectBudgetView` (per-project budget); exports (PDF/Excel/CSV) at top of file; `fmtMoney` null-aware formatter.
- Secondary surfaces: `project-detail.tsx` (Budget tab + state allocations tab), `dashboard.tsx` (`useGetProjectBudgetPerformance`), `states.tsx` / `state-detail.tsx` (utilisation card), `project-registration-form.tsx` (budget entry), plans/reports pages (formatting only).

**Backend (artifacts/api-server):**
- `routes/projects.ts`: `GET /projects/:id/budget`; `GET`/`POST /projects/:id/state-allocations` (POST is a full-set replace; **no PATCH/DELETE routes exist** — the task inventory assumed them).
- `routes/dashboard.ts`: `/dashboard/summary`, `/sector-budget`, `/sector-performance`, `/donor-portfolio`, `/project-budget-performance`, `/beneficiaries`.
- `routes/states.ts`: state list/detail summary incl. budget figures.
- Contract: `lib/api-spec/openapi.yaml` → orval-generated client in `lib/api-client-react`.

## 3. Role Matrix

| Role | Budget access |
|---|---|
| super_admin, ED, PM | Full (Full Operational Access preserved; PM/SA pass `budget.view` and `BUDGET_DONORS_ROLES`) |
| SPC | Full programme-level |
| TC | Sector-scoped (`projectScopeWhere` intersects sectors; empty sector list → deny-all `FALSE`) |
| SPO | State clamp + `project_assignments` membership; fail-closed when unassigned |
| SOM | View allocations for own state only; **excluded** from Budget & Donors endpoints |
| state_manager, viewer, project_officer, program_assistant | No budget-analytics access |

## 4. Canonical Financial Data Model

| Metric | Source | Aggregation | Null semantics |
|---|---|---|---|
| Project Budget | `projects.budget_total NUMERIC(14,2) NOT NULL DEFAULT 0` | none | 0 default (see BUD-010) |
| Project Currency | `projects.currency NOT NULL DEFAULT 'USD'` | — | silent USD fallback (BUD-009) |
| Project Expenditure | `activities.budget_spent` | `SUM(...) WHERE project_id = p.id` (standalone `project_id IS NULL` rows correctly excluded by equality join) | per-currency `totalSpent` may be null (no activities) — preserved |
| State Allocation | `project_state_allocations.budget_allocation` | one row per (project, state) — now DB-enforced | 0 default (BUD-011) |
| State Expenditure | **none exists** (activities have `state_id` but spend is project-scoped by design) | — | must render `—` (now enforced) |
| Remaining | `total − spent`, same currency, both non-null | — | null propagates |
| Utilisation % | `spent / applicableBudget × 100`, guard `budget > 0 && spent != null`, else null; >100 % preserved | — | null on zero/null denominator |
| Donor totals | grouped by `donor_id` (canonical) else normalised free-text; per-currency Maps | project IDs deduplicated before accumulation | no cross-currency sums |

## 5–6. Project Budget & Expenditure

- `budget_total` is sole canonical budget source everywhere audited. `direct_cost`/`indirect_cost`/`cafa_contribution` are informational components entered on the registration form; they are **not** summed into or validated against `budget_total` (BUD-012, P3).
- `GET /projects/:id/budget` reduces activity rows in TS grouped under outputs; totals equal SQL SUM semantics; `deleted_at IS NULL` enforced; no double-counting source (no JSONB spend store exists).
- `budget_spent` updates occur through activity routes; the project deletion guard blocks permanent deletion where `budget_spent > 0`.

## 7. State Allocations

- POST validates: linked-state membership for **every** submitted state (incl. PM/SA), non-negative allocation, cap `Σ allocations ≤ budget_total` (only when budget > 0 — BUD-BD-01). Replace-all inside a transaction.
- **Fixed:** migration `027_project_state_allocations_integrity` adds `UNIQUE(project_id, state_id)`, FKs → `projects`/`states` (CASCADE), `CHECK (budget_allocation >= 0)`, with duplicate/orphan/negative remediation first.
- **Fixed:** POST now writes `audit_log` (`state_allocations_replace`, actor, project, per-state amounts).
- No PATCH/DELETE routes exist (full-set replace is the only mutation path) — documented, not a defect.

## 8. State Expenditure

No canonical state-level expenditure column exists. `/dashboard/project-budget-performance` already correctly nulls spent/remaining/utilisation on the State-Allocation basis. **Fixed (P0, BUD-001):** `routes/states.ts` fabricated utilisation as `SUM(budget_total × 0.4)/SUM(budget_total)` → constant 40 %, summing whole multi-state, multi-currency project budgets per state. Now returns `NULL`; OpenAPI field made nullable; `states.tsx`/`state-detail.tsx` render `—`.

## 9. Budget Basis

`/dashboard/project-budget-performance` labels bases explicitly ("State Allocation" vs "Project-Level Budget"). Budget page uses "Remaining" (not "Available"). Residual (BUD-006, P2): `project-detail.tsx` Budget tab shows 100 % unspent for zero-budget projects and its HQ allocations total assumes single project currency.

## 10. Utilisation / Remaining

Formula and guards verified (`tb > 0 && ts != null` → else null); >100 % preserved in displayed values (visual bar clamped only). `computeStateScores` (dashboard state performance) uses whole-project budget/spend for projects operating in a state as a *proxy* score — flagged BUD-004/BUD-BD-04, not changed (dashboard scoring semantics).

## 11. Currency

- `fmtMoney` is null-aware, no USD fallback; Overview/Sector views group per currency with `currencyMixed` notices; exports carry currency per row.
- Residual: `/dashboard/summary` still exposes legacy headline `budgetTotal/budgetSpent` summed across currencies (BUD-005, P2 — frontend only uses them in single-currency mode); `/dashboard/sector-performance` `budgetUtilizationPct` mixes currencies in ratio (BUD-007, P2); registration form defaults currency to USD (BUD-009, P2 + schema default).

## 12. Donor Portfolio

Grouping by `donor_id` when present, normalised free text otherwise; project IDs deduplicated before spend/beneficiary accumulation; per-currency Maps prevent false totals; share denominators per-currency. No FK `projects.donor_id → donors.id` and no UNIQUE on `donors.name` (BUD-008, P2 — needs donor data remediation decision before constraining).

## 13. Beneficiary Integration

Counts derive from beneficiary/project tables, not financial data; state breakdown divides by `state_count` only for *beneficiary target* allocation (documented intent), never for budgets.

## 14–16. Security / Scope / Endpoint Audit

| Endpoint | Gate | Scope | Notes |
|---|---|---|---|
| GET /projects/:id/budget | `budget.view` | TC effective sectors; SPO/SOM state + membership; deleted excluded | OK |
| GET/POST state-allocations | `budget.view` / `projects.update` | state clamp on rows; membership on writes | audit log added |
| /dashboard/summary | auth + scope | financial fields response-gated to `BUDGET_DONORS_ROLES` | BUD-013 (P3): not endpoint-rejected |
| /dashboard/sector-budget, sector-performance | auth + `userScope` (TC fail-closed) | no explicit role gate | BUD-013 |
| /dashboard/donor-portfolio, project-budget-performance, beneficiaries | explicit approved-role gate | TC/SPO fail closed | OK |

Full Operational Access (PM/SA) preserved throughout; integrity rules (membership, cap, negative check) apply to PM/SA too.

## 17–18. Concurrency & DB Constraints

Fixed via migration 027 (above). The app-side over-allocation cap remains race-prone in theory (two concurrent replaces) but the replace-all-in-transaction pattern plus UNIQUE constraint bounds the damage; a DB-level cap would require a trigger — not added (BUD-BD-01 pending).

## 19. Soft Delete / Lifecycle

**Fixed (P1, BUD-002):** `deleted_at IS NULL` added to all budget analytics queries in `/dashboard/summary` (counts, budget total, spend, per-currency CTE), `/sector-performance`, `/sector-budget` (both branches), `/donor-portfolio`, `/project-budget-performance`, and the states project list. Completed/closed projects **remain** in portfolio totals (BUD-BD-03 — documented as current intended behaviour).

## 20. Numeric / Null / Precision

PG NUMERIC cast to float in SQL (`::float`) — values arrive as JS numbers; no `parseFloat` on money strings found. Null spend preserved as null in per-currency paths; zero not collapsed to `—` in budget page. 14,2 NUMERIC with float casts is acceptable at current magnitudes (< 2^53 cents); no NaN paths found (guards precede division).

## 21. API / Generated Types

Contract regenerated after making `budgetUtilizationPct` nullable. No stale local casts found in budget surfaces; generated `DonorPortfolioEntry` includes per-currency fields. No internal-only fields exposed.

## 22. Audit Logging

Allocation mutations now logged (`state_allocations_replace` with per-state amounts). Old values are not captured (replace-all path) — acceptable; previous state recoverable from prior log entries (noted BUD-014, P3).

## 23. Error Contracts

422 for negative allocation, unlinked state, over-allocation; 404 for unknown project; state-role scope violations → 403/404 via guards. Migration 027 means DB-duplicate insert now surfaces as constraint error — unreachable through the replace-all route.

## 24. Performance

Donor portfolio and budget-performance pre-aggregate activity spend per project (no multiplicative joins). `/dashboard/summary` runs ~10 parallel queries — acceptable. No N+1 found.

## 25. Migrations

No startup DDL in budget route files (offenders exist in `training-videos.ts`/`manual.ts` — out of scope, noted). All budget constraints now tracked in `run-migrations.ts` (migration 027). Duplicate `021`/`024` prefixes are a known, documented non-defect (separate task #418 exists).

## 26. Business Decisions

- **BUD-BD-01** — Is `Σ allocations ≤ budget_total` a hard governance rule? Cap currently skipped when `budget_total = 0`. Needs confirmation before a DB-level cap.
- **BUD-BD-02** — Allocation currency is implicitly the project currency (no currency column on allocations). Confirm this is intended; if so, label in UI.
- **BUD-BD-03** — Completed/closed projects remain in portfolio totals (current behaviour). Confirm.
- **BUD-BD-04** — No canonical State-level expenditure source. Dashboard state-performance uses a proxy (project-level spend of projects in state). Decide: keep proxy with explicit labelling, or null it.

## 27. Finding Register

| ID | Sev | Layer | Location | Issue | Resolution |
|---|---|---|---|---|---|
| BUD-001 | **P0** | API+UI | `states.ts` summary; `states.tsx`, `state-detail.tsx` | Fabricated 40 % budget utilisation (× 0.4 constant), cross-currency, cross-state sums | **Fixed:** NULL + `—`; spec nullable |
| BUD-002 | P1 | API | `dashboard.ts` budget analytics, `states.ts` project list | Soft-deleted projects included in budget totals | **Fixed:** `deleted_at IS NULL` filters |
| BUD-003 | P1 | DB | `project_state_allocations` | No UNIQUE(project,state), no FKs, no non-negative CHECK | **Fixed:** migration 027 with remediation |
| BUD-004 | P1 | API | `performanceEngine.ts` `computeStateScores` | State utilisation proxy sums whole project budgets across currencies per state | Finding + BUD-BD-04 (dashboard scoring; not changed) |
| BUD-005 | P2 | API | `/dashboard/summary` | Legacy headline `budgetTotal/budgetSpent` summed across currencies | Documented; frontend uses only in single-currency mode |
| BUD-006 | P2 | UI | `project-detail.tsx` Budget tab | Zero-budget → "100 % unspent"; `formatCurrency` without project ISO code; HQ allocation total not currency-labelled | Remediation task proposed |
| BUD-007 | P2 | API | `/dashboard/sector-performance` | `budgetUtilizationPct` ratio mixes currencies | Remediation task proposed |
| BUD-008 | P2 | DB | `donors`, `projects.donor_id` | No FK, no UNIQUE(name); dual donor fields | Needs donor data remediation first |
| BUD-009 | P2 | DB+UI | `projects.currency DEFAULT 'USD'`; registration form USD fallbacks | Silent USD on projects created without explicit currency | BD-adjacent; form always sends currency today |
| BUD-010 | P3 | DB | `budget_total NOT NULL DEFAULT 0` | Cannot distinguish "no budget entered" from explicit 0 | Documented |
| BUD-011 | P3 | DB | `budget_allocation DEFAULT 0`, `budget_planned` nullable DEFAULT 0 | Inconsistent null-vs-zero semantics | Documented |
| BUD-012 | P3 | UI | registration form | direct+indirect costs not reconciled against budget_total | Documented |
| BUD-013 | P3 | API | `/dashboard/summary`, `/sector-budget`, `/sector-performance` | No endpoint-level role rejection (response-gating/scoping only) | Remediation task proposed |
| BUD-014 | P3 | API | allocation audit log | Old values not captured on replace | Documented |
| BUD-015 | P3 | API | allocation POST catch | `ROLLBACK` issued even after COMMIT if post-commit SELECT fails (harmless warning) | Documented |

## 28. Tests

`artifacts/api-server/src/routes/budget-audit.test.ts` — 30 tests covering BUD-AUD-01 → BUD-AUD-20 (sentinel source-shape assertions + pure utilisation-formula tests). All pass; full api-server suite green.

## 29. Recommended Closure Tasks

Parallelisable: (a) BUD-006 project-detail budget tab currency/zero-budget polish; (b) BUD-007 per-currency sector-performance utilisation; (c) BUD-013 explicit role gates on summary/sector endpoints; (d) donor data model consolidation (BUD-008, after BD).

## 30. Final Verdict

**B** — functional and safe after this wave's fixes; residual P2/P3 items and four business decisions tracked above.
