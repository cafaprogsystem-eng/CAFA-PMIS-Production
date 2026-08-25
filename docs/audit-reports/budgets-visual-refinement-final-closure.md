# Budgets Visual Refinement — Final Closure

**Date:** 19 August 2026  
**Scope:** Current-head visual reconciliation of the complete Budgets journey:
Budget landing and Overview, Donor Portfolio, Sector Budgets, Project Budget
Performance, Project Detail Budget, and State Allocations.

## Verdict

**VISUAL CLOSURE COMPLETE — BUDGETS MODULE**

The final Visual Residual Register is **NONE**. Current source, not historical
reports, was used as the authority. The two confirmed current-head presentation
residuals found during the audit were corrected without changing an API,
calculation, permission, scope, data value, allocation rule, backend route, or
database object:

1. Project drill-down money could become unqualified when the Project currency
   was absent or unsupported. The screen, chart axis, PDF, CSV, and Excel
   export now show `—` or explicitly state that the currency is unavailable;
   a genuine numeric zero with a recognised Project currency remains visible.
2. The drill-down could present `0%` where its Project or line-item
   denominator was zero. Screen rows, KPI, PDF, CSV, and Excel output now use
   `—` for unavailable utilisation while retaining a genuine `0%` where a
   positive budget has no spend.
3. The Project drill-down showed `output` and `activity` as raw line-level
   enum text. It now presents the readable labels **Output** and **Activity**.

These are presentation corrections only. No budget amount, State allocation,
State expenditure, cap, donor record, historical record, or access rule changed.

## Current-head reconciliation

| Phase | Surfaces | Reconciliation result |
| --- | --- | --- |
| Functional closure | Budget routes, dashboard financial contracts, Project budget and State allocation integrity | Remains **ZERO-RESIDUAL COMPLETE — BUDGETS FUNCTIONAL MODULE**. |
| Visual Phase 1 | Landing, Overview, Donor Portfolio, Sector Budgets, Project Budget Performance | Current visual contracts remain intact: compact hierarchy, named flexible filters, currency-safe portfolio values, bounded identities, local table overflow, and distinct loading/error/empty states. |
| Visual Phase 2 | Project Detail Budget and State Allocations | Current visual contracts remain intact: read-only Project Budget, Project currency context, stored State Allocation distinction, local allocation-table overflow, and separate allocation loading/error/empty states. |
| Final audit | Entire Budget journey | Three narrow current-head presentation residuals above were closed. No additional visual phase is required. |

## Surface and financial-presentation audit

### Landing and Overview

- Heading hierarchy, scope cue, compact KPI layout, currency selection and
  labelled filter controls remain coherent with the established application
  design.
- Mixed portfolios retain per-currency rows and an explicit notice; no
  fabricated consolidated total is displayed.
- Null financial data is `—`, known zero remains `0`, and overspend is not
  capped in its textual value.
- Overview and Donor Portfolio retain their separate loading, error, filtered
  empty, and empty states, with retries where a query may fail.

### Donor Portfolio and Project Budget Performance

- Donor identity remains leading, long names are bounded with full-text access,
  and linked, unlinked, missing, and name-mismatch data states use readable
  labels rather than raw data values.
- Selected-currency donor amounts and shares remain explicitly constrained to
  that currency.
- Project Budget Performance continues to label **Project-Level Budget** and
  **State Allocation** separately. State allocation rows suppress unavailable
  State expenditure, remaining balance, and utilisation.
- Both analytical tables retain local horizontal overflow, sortable native
  buttons, labelled filters, tabular numeric alignment, and icon-action labels.

### Sector Budgets

- Each Sector card and detail surface keeps its currency context, explicit
  mixed-currency breakdown, unavailable utilisation marker, truthful
  overspend/negative values, and no automatic allocation to additional
  Sectors.
- Intentional compact micro-labels are limited to card metric labels and table
  headings; they do not expose financial-domain raw enums.

### Project Detail Budget and State Allocations

- **Project Budget**, recorded spend, remaining balance, utilisation, and
  Project currency are explicit and read-only.
- Negative Remaining and utilisation above 100% retain explanatory text in
  addition to colour.
- **Recorded State Allocations** remain explicit stored records in the Project
  currency, not an equal division, State budget, State expenditure ledger, or
  State performance measure.
- State allocation tables retain bounded State/lead names, local overflow,
  `aria-busy` loading, an accessible table label, a Retry path, and an empty
  state that does not imply equal allocation.
- The Project Budget drill-down, its chart, PDF, CSV, and Excel export now
  have the same truthful unavailable-currency and zero-denominator treatment
  as the other Budget surfaces, and convert their two known line levels into
  readable display labels.

## Responsive and accessibility audit

Static and component-level review confirmed the established responsive
boundaries at laptop, tablet, and narrow layouts: grids collapse before content
is constrained, filter controls use flexible widths, long labels wrap or are
bounded, and wide financial tables scroll inside their own regions rather than
creating page-level overflow.

The final sentinels cover visible headings, table regions, labelled selectors,
sortable controls, currency controls, `aria-busy` allocation loading, Retry,
State-expenditure unavailability, tooltip-capable long identities, and
icon-only action labels. Authenticated browser testing was not claimed because
no safe authorised test session was available; no credentials, test data, or
production access were requested or used.

## Regression evidence

### Visual and frontend checks

| Check | Result |
| --- | --- |
| BUD-VIS-01…12 (Phase 1) | Passed |
| BUD-DETAIL-VIS-01…12 (Phase 2) | Passed |
| BUD-FINAL-VIS-01…12 | Passed |
| Relevant Budget frontend suite | **11 files, 548 passed, 0 failed** — includes Phase 1, Phase 2, final visual sentinels, Project Detail closure, Overview, Budget dashboard metrics, donor portfolio, Project Budget Performance, State performance, Project visual consistency, and Project accessibility coverage. |

### Functional regression checks

The closure reruns the Budget-owned functional gates for allocation caps,
semantics/currency, role gates, dashboard parity, State proxy removal, donor
closure, Project Detail, State Allocation, historical over-allocation, and
functional reconciliation: **9 API/service files, 239 passed, 0 failed**.

The production web build passed (`vite build`, 3,156 modules transformed). Its
only output was existing source-map-resolution notices for shared UI wrappers
and the non-blocking large-chunk advisory. Frontend TypeScript reported
**31 errors**: all are the existing external baseline in consolidated-report,
PMR, Plans, Reports, and Risks/generated-client type drift. There are **0
Budget-owned TypeScript errors**.

## Residual registers

### Visual Residual Register

**NONE.**

### Functional Blocker Register

**NONE.**

### External Baseline Register

The frontend-wide TypeScript run reports **31 existing unrelated errors** in
Reports, Plans, Risks, consolidated-report, PMR, and their generated-client
types. Budget-owned TypeScript errors are **0**; unrelated errors are not a
Budgets visual residual and were not repaired in this closure.

### Data Remediation Register

**DATA REMEDIATION — AWAITING FINANCE:** the eight historically
over-allocated Projects documented by the functional reconciliation remain
unchanged. They are finance decisions, not visual residuals, and were neither
hidden, normalised, clamped, nor otherwise altered by this work.

## Closure decision

All Budget surfaces now meet the existing cross-phase visual, responsive,
accessibility, currency-truth, Project-versus-State, null/zero, and
loading/error/empty contracts. With Visual Residual Register = **NONE**,
Budget-owned TypeScript errors = **0**, the production web build passing, and
Budget functional regression green, this audit declares:

**VISUAL CLOSURE COMPLETE — BUDGETS MODULE**