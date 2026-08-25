# Budgets Visual Refinement — Phase 2 Audit

## Scope

This phase refines the Project Detail Budget and State Allocations presentation only. It does not change routes, OpenAPI, generated clients, database data, calculations, allocation caps, locking, expenditure aggregation, permissions, scopes, currency behaviour, or historical records.

The work is intentionally separate from the functional reconciliation work owned by Task #628. No functional findings were repaired here.

## Findings and presentation changes

### Project Budget Detail

- The Budget tab now names the project-level surface **Project Budget**, identifies the Project currency, and uses compact read-only definition-list metrics for Project Budget, Spent, Remaining, and Utilisation.
- The allocation relationship is stated in the Budget tab: State Allocations are separate stored records, not an automatic subdivision of the Project Budget.
- Read-only values remain text rather than disabled form controls. The existing Project Registration/Edit form remains the only existing data-entry path; no allocation-management dialog, action, or backend capability was introduced.

### Currency, spend, remaining, and utilisation

- Every Budget-tab amount continues to use the existing Project currency formatter.
- Allocation headings and allocation amounts continue to inherit the Project currency. No allocation-level currency field, selector, conversion, or FX affordance was added.
- The new Project Budget and allocation copy has matching Arabic translations; the existing i18n fallback behaviour for untouched legacy strings is unchanged.
- A genuine monetary `0` and `0%` remain visible. An undefined utilisation denominator remains `—`.
- Negative Remaining values are shown with their signed amount and text explaining that the remaining balance is below zero.
- Utilisation above 100% remains shown as its real percentage with text explaining the condition. Its visual bar is limited to the available track only; the displayed figure is never capped.

### State Allocations

- The State Allocations section is now titled **Recorded State Allocations** and explains that rows are explicit stored records rather than equal shares, State performance measures, or State expenditure.
- State actor copy now distinguishes the State Allocation from the Project-Level Budget and states that State expenditure is not available in this view.
- No State expenditure, State utilisation, State remaining, equal division, “your share”, or per-State budget calculation was added.
- The HQ table retains local horizontal overflow, adds minimum column widths, right-aligned tabular numeric cells, and bounded/wrapping State and State Lead text with full text available through `title` attributes.
- Stored zero allocation and target values now display as `0`; an em dash remains reserved for an unavailable field.

### Loading, empty, and error states

- State allocation query loading now shows a structural skeleton with `aria-busy`, without temporary totals or fabricated values.
- Allocation query failure is separate from Project Detail failure, keeps the loaded project available, and offers Retry.
- Empty states say that no State allocations have been recorded and explicitly avoid implying an equal allocation.

## Registration/Edit allocation controls

The registration form currently serialises existing `stateAllocations` values but has no rendered State Allocation management section or standalone allocation dialog. The existing payload path, validation association, pending behaviour, and backend 422 authority were therefore left unchanged. No client cap re-calculation, auto-reduction, redistribution, budget increase, or historical adjustment was added.

## Responsive and accessibility review

- Budget metrics stack from one column to two and four columns without turning read-only values into controls.
- The allocation table scrolls inside its own `overflow-x-auto` wrapper; it does not require page-level horizontal scrolling.
- Numeric columns use `tabular-nums`, `text-right`, and `whitespace-nowrap`; descriptive columns remain left-aligned and have bounded full-text access.
- Loading uses `aria-busy`; allocation errors use the existing alert-based ErrorState; the table has an accessible label; overspend and negative-remaining states include text rather than relying on colour.

## Financial and contract safety

- Project Budget, Project currency, Spent, Remaining, and Utilisation remain derived from the same existing project fields and formatter.
- State Allocations continue to come from the existing dedicated query and tab.
- Existing Project permissions and all allocation mutation/cap authority remain unchanged.
- No backend, API, permission, security, database, historical-data, or allocation-cap change was made.

## Changed files

- `artifacts/cafa-pmis/src/pages/project-detail.tsx`
- `artifacts/cafa-pmis/src/locales/en/projects.json`
- `artifacts/cafa-pmis/src/locales/ar/projects.json`
- `artifacts/cafa-pmis/src/test/budget-detail-closure.test.ts`
- `artifacts/cafa-pmis/src/test/projects-visual.test.tsx`
- `artifacts/cafa-pmis/src/test/projects-ux-accessibility.test.tsx`
- `artifacts/cafa-pmis/src/test/budgets-visual-refinement-phase-2.test.ts`

## Verification

- BUD-DETAIL-VIS-01 through BUD-DETAIL-VIS-12 added and passed.
- Rendered Project Detail coverage verifies HQ table, State actor allocation, zero values, allocation loading, allocation error/retry, and no-allocation states.
- Final combined Project Budget and State Allocation visual/regression suite passed: 9 files, 465 tests.
- Production frontend build passed.
- Full frontend TypeScript was attempted. It remains blocked by existing generated-client drift in unrelated consolidated-report, plans, reports, and risks files; no error is reported for the changed Project Detail or locale/test files.
- Repository-wide lint was attempted. It remains blocked by existing lint errors in unrelated PMR test files; no new lint issue was reported in the changed files.
- The restarted frontend workflow served the public landing page successfully. Authenticated browser validation was unavailable because no safe authenticated session existed; the API workflow was also not running, producing 502 responses for API requests. No login, test data, or record change was attempted. This audit does not claim final visual closure.

## Residual visual findings

- The existing registration/edit experience has no rendered allocation-management surface to refine without inventing a new workflow. Any future allocation-management UX should remain in that existing authorised flow and preserve backend validation authority.
- This is Phase 2 only. It does not declare a final Budgets visual closure.