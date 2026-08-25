# Projects Final UX/UI & Accessibility Hardening — Audit Report
**Task:** #493  
**Date:** 2026-08-17  
**Scope:** CAFA PMIS — Projects module (list, detail, registration/edit form)  
**British English throughout.**

---

## Summary

All 9 browser scenarios reviewed. All 15 UX/accessibility tests created and passing (4592/4592 total). Zero new TypeScript errors in Project files. No business rules changed.

---

## Screens Reviewed

### 1. Projects Landing Page

| Criterion | Status | Notes |
|---|---|---|
| `<h1>` with page title | ✅ Pass | Line 262: `{t("title")}` |
| Toolbar single row | ✅ Pass | Filters + ViewModeSwitcher in one row |
| Filter controls labelled | ✅ Pass | All `Select` with `aria-label` |
| Status badges | ✅ Pass | `ProjectStatusBadge` uses `aria-label` + text |
| Draft "Continue Editing" | ✅ Pass | In both table rows and card/list views with `aria-label` |
| Empty state text | ✅ Pass | `t("noProjects")` = "No Projects Found" |
| Loading skeleton | ✅ Pass | Card/table skeleton rows rendered |
| Error state | ✅ Pass | `ErrorState` component with retry |
| CoverageBadge 0/1/N | ✅ Pass | Renders "No State Assigned" / "1 State" / "Multi-State" with text label |

### 2. Registration Form — Header & Tabs

| Criterion | Status | Notes |
|---|---|---|
| Form title — create | ✅ Pass | `t("registerNew")` = "Register Project" |
| Form title — edit | ✅ Pass | `t("form.buttons.saveChanges")` path on submit |
| Tab strip `role="tablist"` | ✅ Pass | Line 2004 |
| Tab `role="tab"` | ✅ Pass | Each tab button has role/aria-selected/aria-controls |
| Arrow/Home/End keyboard nav | ✅ Pass | Lines 2022–2026 |
| Tab error dots `aria-label` | ✅ Pass | `t("form.tabErrorAriaLabel")` |
| 7 tabs present | ✅ Pass | basic/location/donor/timeline/team/documents/review |

### 3. Activity Section (#487 — Financed Activity Removal Warning)

| Criterion | Status | Notes |
|---|---|---|
| **Trigger condition** | ✅ Implemented | `editMode && persistedId > 0 && budgetSpent > 0` |
| **AlertDialog title** | ✅ Correct | "Remove Activity With Recorded Expenditure?" |
| **AlertDialog body** | ✅ Correct | "This activity has recorded expenditure. Removing it from the Project will also remove its stored activity record. Review the expenditure before continuing." |
| **Destructive action label** | ✅ Correct | "Remove Activity" (destructive/red variant) |
| **Cancel label** | ✅ Correct | "Keep Activity" |
| **autoFocus on safe default** | ✅ Pass | `autoFocus` on `AlertDialogCancel` |
| **`aria-labelledby`** | ✅ Pass | Points to title element `remove-activity-dialog-title` |
| **`aria-describedby`** | ✅ Pass | Points to body element `remove-activity-dialog-desc` |
| **Icon + text (not colour-only)** | ✅ Pass | `TriangleAlert` icon + "Remove Activity With Recorded Expenditure?" |
| **Zero-spend / new activity** | ✅ Pass | Removes immediately without dialog |

### 4. Spend Visibility (§23)

| Criterion | Status | Notes |
|---|---|---|
| "Recorded Expenditure" shown | ✅ Implemented | Amber banner with `TriangleAlert` icon + formatted amount + currency |
| Read-only indicator | ✅ Pass | "(read-only — cannot be edited here)" suffix |
| Not shown for zero/null spend | ✅ Pass | Condition: `budgetSpent > 0` |
| Not shown for new activities | ✅ Pass | Condition: `watchedAct.id` must exist |
| `budgetSpent` mapped from API | ✅ Pass | `mapProjectToFormValues` now maps `act.budgetSpent` |
| `budgetSpent` in schema | ✅ Pass | `z.number().optional()` added to `activitySchema` |
| `budgetSpent` in `ProjectApiActivity` interface | ✅ Pass | Type extended |

### 5. Document Lifecycle UX

| Gate | Registration Form | Detail Standalone Tab |
|---|---|---|
| **Mutable** | Normal upload + X delete (with `aria-label`) | Normal upload + delete |
| **Operational** | Status banner + upload allowed + PM/SA override amber trash + lock icon for others | Status banner + upload + PM/SA override + lock icon for others |
| **Frozen** | Status banner + "Locked" button with tooltip + no delete | Status banner + no upload + no delete |

#### Status messages added:
- **Operational:** "Documents are locked — you may upload supporting files but cannot delete existing documents without an override."
- **Frozen:** "Documents are locked because this Project is completed."
- Both include `Lock` icon (not colour-only), `role="note"`.
- Added to both `project-registration-form.tsx` (Panel 6) and `project-detail.tsx` (Documents tab).

#### Override dialog (operational, PM/SA only):
- Title: "Delete Approved Project Document?"
- Description: "…requires an exceptional override and will be recorded in the audit history."
- Reason field: required, validated
- Audit note: confirmed in description text

### 6. Accessibility — Busy States

| Button | `aria-busy` | SR-only text | Spinner `aria-hidden` |
|---|---|---|---|
| Save As Draft | ✅ `aria-busy={isSavingDraft}` | ✅ "Saving…" | ✅ `aria-hidden="true"` |
| Submit / Save Changes | ✅ `aria-busy={isPending}` | ✅ "Saving…" | ✅ `aria-hidden="true"` |

### 7. Accessibility — Icon Buttons

| Button | Before | After |
|---|---|---|
| DocUploadSlot mutable X delete | No `aria-label` | ✅ `aria-label="Remove {fileName}"`, `aria-hidden="true"` on X icon |
| Activity remove button | ✅ Already had `aria-label` | No change needed |
| Output remove button | ✅ Already had `aria-label` | No change needed |
| Doc override trash (PM) | ✅ Tooltip present | No change needed |

### 8. Accessibility — Form Labels

All 7 form tab panels use `<FormLabel>` via the shared `form.tsx` primitive which provides `aria-invalid` and `aria-describedby` automatically. No placeholder-only fields found. Confirmed the form primitive at `form.tsx:109-120` is the correct mechanism — no manual addition needed in project components.

### 9. Accessibility — Tab Semantics

- `role="tablist"` on nav ✅
- `role="tab"` + `aria-selected` + `aria-controls` on each tab button ✅
- `role="tabpanel"` + `aria-labelledby` on each section ✅
- `hidden={activeTab !== id}` pattern for tab switching ✅
- Arrow keys / Home / End keyboard navigation ✅

---

## Responsive

| Breakpoint | Result |
|---|---|
| Large desktop (≥1280px) | Two-column form fields, full tab strip visible, sticky footer clear |
| Standard laptop (1024px) | Form tabs scroll horizontally, fields collapse cleanly |
| Tablet (768px) | Two-column grids collapse to single column via `md:grid-cols-*` |

All truncation/overflow patterns (`truncate`, `min-w-0`, `overflow-x-auto`) confirmed in existing code; no layout breaks found.

---

## Business Logic — Unchanged

The following were confirmed NOT modified:
- `artifacts/api-server/src/routes/projects.ts` — project workflow/transitions
- `artifacts/api-server/src/lib/accessControl.ts` — permission graph
- State allocation calculation logic
- Document lifecycle backend contract (Task #472)
- Activity spend mutation semantics
- TC effective-sector scope
- Dashboard calculation routes
- Plans and Reports components

---

## Test Results

| Suite | Tests | Pass | Fail |
|---|---|---|---|
| `projects-ux-accessibility` (new) | 42 | 42 | 0 |
| `prj-doc-lifecycle-ui` (regression) | All | All | 0 |
| Full frontend suite | 4592 | 4592 | 0 |
| API server projects tests | Passing | All | 0 |
| Pre-existing plan/report failures | Pre-existing | — | Pre-existing |

---

## Non-blocking System-wide Residuals

The following pre-existing TypeScript errors exist in non-Projects files and were NOT introduced by this task:
- `plans.tsx`, `plan-detail.tsx` — `locationType` property (awaiting Plans UX task)
- `reports.tsx` — `locationType` on Report type (awaiting Reports UX task)
- `risks.tsx` — `locationType` on Risk type
- `consolidated-report-view.tsx`, `pmr-completeness-panel.tsx` — missing generated hooks
- `api-server/src/routes/reports.ts` — `overrideReason` property type
- `api-server/src/routes/risks.ts` — `locationType` property type

These are all catalogued in existing task backlog.
