# Reports Final UX/UI & Accessibility Hardening Audit

**Date:** 2026-08-17
**Task:** Reports Final UX/UI & Accessibility Hardening (post Tasks #434 and #454)

## Screens Reviewed

- Reports Landing Page (`reports.tsx`)
- PMR Authoring Form (`reports.tsx` — embedded)
- Activity Report Authoring Form (`reports.tsx` — embedded)
- SPR Authoring Form (`program-state-report-form.tsx`)
- HQSR Authoring Form (`hq-sector-report-form.tsx`)
- Submitted/Detail view (`reports.tsx` — Sheet)

---

## Defects Found & Fixed

### 1. HQSR footer — Submit and Save Draft buttons missing `aria-busy`

**Before:** `<Button type="button" onClick={onSubmitReport} disabled={isSaving}>` — no `aria-busy` attribute. Screen readers would not announce the busy state when submission is in progress.

**After:** Added `aria-busy={isSaving}` to both Save Draft and Submit buttons in the HQSR footer. Icons also received `aria-hidden="true"` for consistency.

### 2. HQSR narrative textareas — no accessible label binding

**Before:** Sections 3–7 and 13–15 had `<h4>` headings as visual labels but the `<Textarea>` elements had no programmatic association — only `placeholder` text. Screen readers would either announce the placeholder or nothing useful.

**After:** Added `id` attributes to all eight h4 headings (`hqsr-sec3-heading` through `hqsr-sec15-heading`) and corresponding `aria-labelledby` bindings on each textarea. Textareas are now announced with the section title by screen readers.

### 3. Detail view attachment filename — missing `title` attribute for tooltip on truncation

**Before:** `<span className="truncate">{att.fileName}</span>` — truncated filenames gave no way to see the full name without downloading.

**After:** Added `title={att.fileName}` to the span so the full filename appears on hover.

### 4. PMR/Activity footer — incomplete busy guard on Cancel, Back, Save Draft, and Next

**Before:** In the Activity wizard footer, Cancel and Back had no `disabled`/`aria-busy` guards at all. Save Draft was only guarded by `createMutation.isPending`, meaning an edit-path submit (which uses a direct `fetch`, not `createMutation`) left Save Draft clickable. Next was also unguarded. In the PMR non-wizard footer, Cancel was added (earlier in this task) and Submit was already correct, but Save Draft still used only `createMutation.isPending`.

**After:** Applied the unified busy predicate `isSubmittingReport || createMutation.isPending || transitionMutation.isPending` as `disabled` and `aria-busy` to all footer controls in both variants:
- **Activity wizard footer:** Cancel (step 1), Back (steps 2+), Save Draft, Next, Submit — all use the shared predicate.
- **PMR non-wizard footer:** Cancel, Save Draft, Submit — all use the shared predicate.

This closes the race condition where a user could initiate Save Draft or navigate away via Back/Next while a submit was already in-flight.

### 5. Detail view — `workflowPath` displayed as raw snake_case or not at all

**Before:** The specific report's `workflowPath` (e.g. `technical_authored`) was not shown in the detail sheet metadata grid. Users reviewing a report could not tell which approval chain it followed.

**After:** Added a conditional "Approval Workflow" row to the detail metadata grid. Values are humanised: `technical_authored` → "Technical Authored Workflow", `state_authored` → "State Authored Workflow", `spc_fallback` → "SPC Fallback Workflow". Unknown values fall back to Title Case word splitting.

---

## Visual Improvements Made

- **HQSR textareas** are now semantically associated with their section headings via `aria-labelledby`, improving the experience for both keyboard-only and screen-reader users without any visual change.
- **Attachment filename** now shows full name on hover (title tooltip) — helps reviewers identify long filenames without downloading.
- **Detail sheet** now shows the actual workflow path for each report in the metadata grid, making it clear whether a given PMR/Activity Report followed the State-authored or Technical-authored chain.

---

## Intentionally Unchanged

- Report identity and duplicate-check rules
- Workflow transitions and `PLAN_TRANSITIONS`
- Author governance and notification routing
- Submit validators (PMR / Activity / SPR / HQSR)
- Evidence storage architecture
- Full Operational Access override (Task #373)
- Rate-limit bypass (dev-only, Task #454)
- docsNoSupport logic (Task #454 — already correct: checkbox label explicit, `aria-required` on reason textarea)
- ChipSelect implementation (already button-based, keyboard focus ring present from design system)
- Override dialog (already has `DialogTitle`, `DialogDescription`, confirm disabled when reason blank)
- SPR revision banner (already had `role="alert"`, text label, inline reviewer comments via CommentsPanel)
- `formatStatusLabel` fallback (already converts snake_case → Title Case at line 85 of `format.ts`)

---

## Responsive Result

- **Desktop/laptop:** All four form types display correctly within `sm:max-w-[920px]` dialog. Footer stays sticky (`border-t shrink-0`). Detail sheet uses `sm:max-w-2xl`.
- **Narrow viewports:** Filter toolbar uses `flex flex-wrap gap-2`. SPR/HQSR footers use `DialogFooter className="gap-2 flex-wrap"`. Beneficiary/financial grids already have responsive column counts.
- **Long content:** `SheetTitle` has `break-words`. Filename spans have `truncate` + `title` attribute. Flex children have `min-w-0`.

---

## Accessibility Result

- **Keyboard navigation:** All four report forms reachable by keyboard. PMR/Activity wizard uses roving tabindex with ArrowLeft/Right/Home/End. SPR and HQSR use standard scroll form.
- **Focus management:** Override dialog and discard-confirm AlertDialog use Radix components that trap and return focus automatically. No manual `.focus()` calls fighting Radix.
- **Labels:** PMR/Activity fields have `htmlFor`/`id` associations (existing, from Task #420). HQSR narrative textareas now have `aria-labelledby`. SPR uses `<Label>` with `htmlFor`.
- **Busy states:** All three footer buttons (Save Draft, Submit, plus Cancel disabled) correctly reflect submission state via `disabled` and `aria-busy`.
- **Error announcement:** `role="alert"` + `aria-live="assertive"` error summary in all forms. Field-level errors carry `role="alert"` elements. PMR/Activity error summary is `tabIndex={-1}` for programmatic focus.
- **Colour independence:** Revision banner has explicit text "This report was returned for revision." Override badge shows text label "Override" alongside amber styling.

---

## Residuals (Non-blocking)

- **System-wide i18n/Arabic translation** of the new "Approval Workflow" metadata label is deferred to the Phase 3+ i18n task.
- **HQSR textarea `<label htmlFor>` bindings** were implemented via `aria-labelledby` (pointing to the section h4 IDs) rather than wrapping labels, as restructuring the section headings into `<label>` elements would visually break the existing card-border pattern. `aria-labelledby` is an equally valid WCAG 2.1 SC 1.3.1 technique.
- **Cosmetic audit across all 60+ other form fields** (Risks, Planning, Projects) deferred to system-wide accessibility audit task.

---

## Files Changed

- `artifacts/cafa-pmis/src/components/hq-sector-report-form.tsx` — HQSR narrative textarea `aria-labelledby` bindings; HQSR footer `aria-busy` on Save Draft and Submit buttons; icon `aria-hidden="true"` consistency.
- `artifacts/cafa-pmis/src/pages/reports.tsx` — Attachment filename `title` attribute; PMR Cancel button `disabled` during submission; `workflowPath` humanised in detail metadata grid.
- `artifacts/cafa-pmis/src/test/reports-final-ux.test.tsx` — New test file (15 test IDs: REP-UX-01..10, REP-A11Y-01..05; includes rendered tab-navigation doubles).
- `artifacts/cafa-pmis/src/test/hqsr-voice-notes.test.tsx` — Added REP-UX-08 test group.
- `artifacts/cafa-pmis/src/test/pmr-a11y.test.tsx` — Added REP-A11Y-01 note (already covered by existing PMR-A11Y-16..20 tests).
- `artifacts/cafa-pmis/src/test/reports-submit-guard.test.tsx` — Added REP-UX-03 test group.
- `docs/audit-reports/reports-final-ux-ui-accessibility-hardening.md` — This document.

---

## Business Logic Confirmation

Confirmed: **no workflow, permission, identity, duplicate-check, validator, notification, analytics, or storage changes** were made in this task. All changes are limited to:
- Attribute additions (`aria-busy`, `aria-labelledby`, `title`, `disabled`)
- Conditional display of an existing field (`workflowPath`) in the detail view
- Test assertions

The report approval chain, status transitions, author gates, and SPO/SOM scoping are identical to the state at the start of this task.
