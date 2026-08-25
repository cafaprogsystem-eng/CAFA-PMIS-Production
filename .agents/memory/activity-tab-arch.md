---
name: Tab 4 Activities architecture
description: How Plan Registration Tab 4 (Activities) works — completeness gating, locality scoping, reconciliation, validation model.
---

## `isActivityComplete()` — module-level pure function

Checks: title.trim() non-empty, localityName non-empty AND in `planLocalities[]`, plannedDate non-empty and within plan start/end, priority non-empty, targetBeneficiaries finite integer ≥0, budgetPlanned finite ≥0, expectedResult.trim() non-empty.  
Responsible person is **intentionally optional** — omitting it still passes.  
Must stay at module scope (no hooks). Same pattern as `validateDraftFields`/`validateFinishFields`.

**Why:** Save As Draft must never block on activities; Save & Finish requires ≥1 complete activity; these are separate validation paths.

## Locality scoping (ActivityLocalitySelect)

Activity locality is a `<Select>` restricted to the Plan's Tab 3 `localities[]` array — not free text.  
When `localities.length === 0`, shows a dependency message + "Go To Geographical Coverage" shortcut button (calls `setActiveTabIndex(2)`).  
Old `ActivityLocalityInput` (Levenshtein free-text) has been removed.

## State inheritance

Activity State is read-only — a display row showing `currentStateName` from Plan Details (Tab 1). No per-activity State selector exists. The `ActivityForm.stateId/stateName` fields remain in the payload for server consumption but are not user-editable.

## Locality removal reconciliation (`handleAttemptRemoveLocality`)

When the user clicks X on a Tab 3 locality chip, the parent counts how many activities reference it. If count > 0, opens an `AlertDialog` (with exact count and locality name). On confirm: removes locality from `localities[]` AND clears `localityName` on affected activities. Cancel → no mutation.

## State change reconciliation (`confirmStateChange`)

After confirming a state change: `setLocalities([])` AND `setActivities(prev => prev.map(a => ({...a, localityName: ""})))`. The AlertDialog description dynamically mentions activities when any have a locality assigned.

## Save & Finish (`checkBeforeDispatch(true)`) activity gate

After the locality check:  
1. `activities.length === 0` → return false  
2. `!activities.some(a => isActivityComplete(...))` → return false  
Save As Draft (`checkBeforeDispatch(false)`) skips both checks entirely.

## Error surfacing

- `hasActivityError = saveFinishAttempted && (activities.length === 0 || !activities.some(isActivityComplete))`
- `hasAnyFinishError = hasDetailErrors || hasGeographyError || hasActivityError`
- Tab indicator: `i === 3 && hasActivityError`
- Sections Need Attention summary: Activities entry with conditional message ("add at least one Activity" vs "complete the required fields")

## Empty state

Neutral style (muted/dashed border, no warning orange). CTA: "Add First Activity" button. Header "Add Activity" button only visible when `activities.length > 0`.

## Delete confirmation

`handleRemoveActivity(idx)`: checks if the activity has any non-empty data field; if so, calls `window.confirm()` (lightweight, consistent with existing pattern). If the user cancels, no mutation occurs.

## Backend validation

POST + PATCH when `closeRegistration=true`:  
1. `activities.length === 0` → 400 `at_least_one_activity_required`  
2. No activity with title+localityName+plannedDate+expectedResult → 400 `at_least_one_complete_activity_required`

Submit transition also adds a DB-level completeness check (queries `plan_activities` for rows with all four fields non-empty).

## Delete confirmation (AlertDialog — no window.confirm)

`handleRemoveActivity(idx)` checks `hasData` on the Activity. If data present → `setActivityDeleteConfirmIdx(idx)` → AlertDialog opens ("Remove Activity?" / destructive button). Empty activities delete immediately. `confirmRemoveActivity()` calls `removeActivity()` then clears state. `handleReset` also clears `activityDeleteConfirmIdx`. NO `window.confirm()` anywhere in Activity deletion.

## Backend shared validator: `validatePlanActivityReadiness(raw, ctx)`

Located in `artifacts/api-server/src/routes/plans.ts`, before `normalizeActivity`. Used by POST closeRegistration, PATCH closeRegistration, and Submit — three sites, one definition. Operates on raw `ActivityInput` before `normalizeActivity` coercion so invalid values (negatives, decimals, bad enums) are caught pre-write. Returns `null` (ready) or an error-code string. `ACTIVITY_PRIORITIES = new Set(["high","medium","low"])` is the single source of truth; `normalizeActivity` also uses it.

`pgDateToIso(val)` helper converts pg Date-or-string columns to YYYY-MM-DD for the validator.

**Submit**: reads Plan + all Activities from DB via `Promise.all` — locality membership and date range checked against persisted DB state, not frontend assertions.

**PATCH closeRegistration**: reads Plan dates/localities from DB then merges any body overrides.

## Locality normalisation in validator

Comparison: `trim().replace(/\s+/g," ").toLowerCase()` — handles surrounding spaces, inner double-spaces, and case differences. Plan localities array is the authoritative set; any Activity locality not in it returns `"locality_not_in_plan"`.

## Test files

- `src/test/activity-tab.test.ts` — 35 frontend pure logic tests (draft permissiveness, finish gates, completeness rules, locality scoping, reconciliation)
- `src/test/backend-activity-validator.test.ts` — 55 backend-validator tests (all 7 rules, direct-API bypass cases, Priority enum, beneficiary/budget edge cases, locality normalisation, date boundary, Strict Mode)
