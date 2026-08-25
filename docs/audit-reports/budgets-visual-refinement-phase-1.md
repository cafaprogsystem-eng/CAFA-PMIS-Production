# Budgets Visual Refinement — Phase 1 Audit

**Date:** 19 August 2026  
**Scope:** Frontend visual presentation only  
**Areas reviewed:** Budgets landing and Overview, Sector Budgets, Donor Portfolio, Project Budget Performance, and shared sortable table controls.

## Confirmed findings

- The Budgets landing used a looser page rhythm than comparable operational modules.
- Budget filter controls used fixed widths and did not retain meaningful accessible names after a value was selected.
- A sector-budget request failure could be presented as no data.
- Overview financial values could render an unqualified number when a currency code was unavailable.
- The Overview donor table did not bound long donor names.
- Dashboard Donor Portfolio had data-quality status values available and visible, but its display-currency basis and full donor identity relied too heavily on surrounding context and hover.
- Budget performance controls needed more flexible widths and clearer inline distinction between Project-Level Budget and State Allocation.

## Phase 1 refinements delivered

- Tightened the Budgets page hierarchy to the compact `space-y-4` rhythm and retained the existing Overview/Sector Budget tab model.
- Added flexible, named filter controls, responsive date-range layout, labelled project selector and currency selectors, and keyboard-reachable clear actions.
- Added separate sector, overview-summary, and donor-portfolio error treatment with retries; loading, empty, and filtered-empty states remain distinct.
- Kept financial display factual: known zero stays a currency-labelled zero; null or an unavailable currency basis displays `—`; mixed-currency figures remain separate and are never combined.
- Localised confirmed Budget-owned visible copy through the existing `budget` namespace.
- Bounded donor identity in both Budget Overview and Dashboard Donor Portfolio tables, retaining the complete value through title/accessible text while protecting table width.
- Clarified that Donor Portfolio amounts and shares use the selected display currency only.
- Preserved Project-Level Budget versus State Allocation semantics and added a concise inline explanation for scoped technical and state users.
- Kept wide tables inside local overflow regions, retained tabular numeric formatting, and made sortable table headers keyboard-native buttons with visible focus treatment.

## Financial and access invariants preserved

- No backend route, SQL, migration, OpenAPI, client generation, permission, scope, donor-grouping, allocation-cap, or financial-calculation change was made.
- The selected-currency Donor Portfolio path continues to source mixed-donor amounts from `budgetByCurrency`.
- State Allocation continues to suppress unavailable State-level expenditure, remaining balance, and utilisation rather than using a project-level proxy.
- No State Budget Utilisation Score, Budget Component, or 15% Budget Weight presentation exists.

## Validation

| Check | Result |
| --- | --- |
| BUD-VIS-01 through BUD-VIS-12 | Passed |
| Budget overview, metric, donor portfolio, project budget performance, budget detail, and state performance tests | Passed — 417 tests across 7 files |
| Production web build | Passed |
| Locale JSON and whitespace diff validation | Passed |
| Full frontend TypeScript check | Blocked by 31 pre-existing generated-client mismatches in unrelated Reports, Plans, Risks, and shared report components; no Budget file appears in the error list |
| Authorised browser walkthrough | Blocked because the available browser session has no safe test credentials; the protected `/budget` route correctly redirects to sign-in |

## Conclusion

**BUDGETS VISUAL REFINEMENT — PHASE 1 COMPLETE**