# Plans Module Visual Refinement — Phase 2 Audit Report

**Date:** 2026-08-18  
**Task:** Plans Module Visual Refinement — Phase 2 (Create & Edit Form)  
**Scope:** Visual-only refinement of `create-plan-registration-dialog.tsx` and `plan-detail.tsx`

---

## Summary of Visual Issues Found and Fixed

### ✅ Fixed

| # | Issue | Component | Fix |
|---|-------|-----------|-----|
| 1 | Dialog too wide (`max-w-5xl`) | Create Dialog | Reduced to `max-w-4xl` |
| 2 | Sector checkbox gap too tight (`gap-0.5`) | Create Dialog | Increased to `gap-1.5` |
| 3 | Responsible person Input full-width | Create Dialog | Wrapped in `max-w-sm` |
| 4 | Description textarea rows=2, not resizable | Create Dialog | `rows={3}`, `resize-y` |
| 5 | Activity card `text-xs` label hierarchy | Create Dialog + Edit Page | Standardised to `text-sm` |
| 6 | Activity card `p-4 space-y-3` outer padding | Create Dialog + Edit Page | Structured header (`px-4 py-2.5 border-b`) + body (`px-4 py-3 space-y-2.5`) |
| 7 | Activity card: Responsible person full-width | Create Dialog + Edit Page | `max-w-sm` wrapper |
| 8 | Budget tab fields spanning full width | Create Dialog | `flex flex-wrap gap-3` with `max-w-xs`/`max-w-sm` constraints |
| 9 | Related project panel `max-w-[700px]` | Create Dialog | Tightened to `max-w-[640px]` |
| 10 | Edit mode: header-only Save/Cancel scrolls away | Plan Detail | Added sticky footer (`sticky bottom-0 border-t … z-10`) |
| 11 | Edit mode: toast-only validation | Plan Detail | Added per-field inline errors with auto-clear on field change |
| 12 | Read-only view `gap-x-8` (generous) | Plan Detail | Tightened to `gap-x-6` |

### Intentionally Left

- Activity card group layout (State+Locality, PlannedDate+Priority, Beneficiaries+Budget) already uses `grid md:grid-cols-2 gap-2` — kept and improved to `gap-3`
- Duplicate banners: already `role="alert"` / `role="status"`, compact `px-4 py-3` — preserved exactly
- "Sections Need Attention" summary banner: already `p-3`-equivalent — preserved exactly
- Revision banner in plan detail: already compact amber informational `Alert` — no change needed
- Loading skeleton: already structurally complete — no change needed
- Locked plan state guards: already in place via `canEdit`/`isApprovalLocked` — confirmed correct

---

## Form Shell and Hierarchy (Create Dialog)

- **Dialog width**: `max-w-5xl` → `max-w-4xl`. At 1280px viewport, dialog now has comfortable margin (~192px) rather than nearly touching the edges.
- **Tab strip**: Already `overflow-x-auto [scrollbar-width:none]` — remains scrollable for narrow viewports.
- **Sticky header**: Preserved exactly — Dialog title + description above tab strip.
- **Sticky footer**: Preserved exactly — Cancel/Previous left; Save As Draft + Next/Save & Finish right.
- **Scrollable body**: `px-6 py-4` — unchanged.

---

## Plan Type / Context Presentation

- `PLAN_TYPE_OPTIONS` constant (7 entries: Monthly, Quarterly, Annual, Action, Operational, Emergency Response, Custom) unchanged.
- `PLAN_TYPE_LABELS` map in plan-detail unchanged.
- Both surfaces render human-readable labels — no raw enum strings exposed.

---

## Dates and Responsible-User Layout

- **Responsible person**: Now `max-w-sm` in both create dialog and edit mode activity cards.
- **Date inputs**: Remain in `grid-cols-2 gap-3` — no change.
- **Validation**: Create dialog has full inline errors; edit mode now also has per-field inline errors (title, planType, stateId, sectors, responsibleName, startDate, endDate) that surface on failed save and auto-clear when the field is corrected.

---

## Activity Card Compaction (Create + Edit)

### New card structure (both surfaces):
```
<div className="rounded-lg border bg-muted/10">
  {/* Header — compact title row + remove icon */}
  <div className="flex items-center justify-between px-4 py-2.5 border-b">
    <span className="text-sm font-medium truncate flex-1">Activity N: Title…</span>
    <Button aria-label="Remove activity N" size="icon" variant="ghost" />
  </div>
  {/* Body */}
  <div className="px-4 py-3 space-y-2.5">
    {/* All labels: text-sm (was text-xs) */}
    {/* Grids: gap-3 (was gap-2) */}
    {/* Responsible person: max-w-sm */}
    {/* Expected result: rows=2 resize-y */}
    <ActivityOptionalFields /> {/* collapsible — unchanged */}
  </div>
</div>
```

### Field groupings:
- **State + Locality**: `grid md:grid-cols-2 gap-3`
- **Planned date + Priority**: `grid md:grid-cols-2 gap-3` (create) / same (edit)
- **Target beneficiaries + Planned budget**: `grid md:grid-cols-2 gap-3`
- **Responsible person**: `max-w-sm` full row
- **Expected result**: full width `rows=2 resize-y`

### Edit mode specifics:
- State field is editable Select (not read-only) in edit mode — kept as is, placed in same grid position
- `ActivityOptionalFields` trigger text unchanged ("Show additional fields")

---

## Sector Control Visual Alignment

- **Create dialog**: checkbox grid (`grid-cols-2 sm:grid-cols-3`) with checked = `bg-primary/10 text-primary font-medium`, unchecked = hover style. Gap: `gap-1.5` (was `gap-0.5`).
- **Edit page**: `SectorPicker` chip/toggle buttons with same primary-selected styling.
- Both use `text-sm` labels. Both show destructive error below. Controls intentionally differ (checkbox vs chip button) — no functional replacement made.

---

## Duplicate Banner Density

- **Hard-block**: `role="alert"` `aria-live="assertive"` — preserved. Compact `px-4 py-3`. "Continue Editing Existing Draft" CTA present as underline link.
- **Soft-duplicate**: `role="status"` `aria-live="polite"` — preserved. "Review Existing Plan" + "Continue Creating" both present.
- **"Sections Need Attention"**: `px-4 py-3` — preserved. Clickable tab links intact.

---

## Edit Mode Sticky Footer

Added `data-testid="edit-sticky-footer"` sticky footer at the bottom of the plan detail page:

```tsx
{isEditing && (
  <div className="sticky bottom-0 border-t border-border bg-background z-10 px-6 py-3 flex items-center justify-between gap-3">
    <Button variant="outline" onClick={...} disabled={isPending}>
      <X aria-hidden /> Cancel
    </Button>
    <Button onClick={onSave} disabled={isPending} aria-busy={isPending}>
      <Save aria-hidden /> Save Changes
    </Button>
  </div>
)}
```

- Rendered only when `isEditing === true`.
- Uses the same handlers as header buttons — no logic change.
- Header buttons retained as a convenience shortcut at the top.
- Does not trap keyboard focus — positioned after all form content in the DOM.

---

## Edit Mode Inline Validation

Added `getEditFieldErrors()` function that returns a `Record<string, string>` of per-field errors. Called inside `onSave()` before the existing `validate()` check.

- Errors populate `editFieldErrors` state on failed save.
- Each field clears its own error on change via `setEditFieldErrors((p) => ({ ...p, fieldKey: "" }))`.
- Errors cleared completely on cancel (`onCancel`) and on save success (`updateMutation.onSuccess`).
- Core field coverage: `title`, `planType`, `stateId`, `sectors`, `responsibleName`, `startDate`, `endDate`.
- `validate()` function itself unchanged — no validation rule changes.

---

## Read-Only Layout Adjustments

- Two-column detail grid: `gap-x-8` → `gap-x-6`. Labels and values feel more related.
- Card `space-y-6 mt-6` on the overview TabsContent: unchanged (already appropriate density).

---

## Revision / Loading States

- **Loading skeleton**: Present and structurally complete (breadcrumb + header + tabs + card skeletons) — no change needed.
- **Revision banner**: Compact amber `Alert` already present when `status === "draft"` and `lastRevisionRequest` exists — no change needed.
- **Locked states**: `isApprovalLocked` / `!canEdit` guards confirmed in place — locked read-only fields intentionally styled without edit controls.

---

## Responsive Verification

| Breakpoint | Status |
|-----------|--------|
| 1440px+ | `max-w-4xl` dialog centres with ~272px margin. Read-only page content constrained by card layout. ✅ |
| 1280px (priority) | Dialog fits with ~192px margin. Tab strip in one row. 2-column grids work. Sticky footer visible. Activity cards readable. ✅ |
| 1024px | Dialog still displayed as dialog (not full-screen). 2-column grids collapse gracefully via `md:` prefix. Tab strip scrolls horizontally. ✅ |
| 768px/narrow | Single-column fields via `md:grid-cols-2`. Activity cards usable. Footer buttons reachable. Budget fields wrap via `flex flex-wrap`. Sector grid wraps to 2 columns. ✅ |

---

## Accessibility

| Item | Status |
|------|--------|
| Decorative icons in card headers | `aria-hidden="true"` applied to Trash2, Save, X icons |
| Activity remove buttons | `aria-label="Remove activity N"` on all instances |
| Hard-block duplicate banner | `role="alert"` — confirmed present |
| Soft-duplicate banner | `role="status"` — confirmed present |
| Sticky edit footer | Not focus-trapping; positioned after form fields in DOM |
| Dialog focus | Radix Dialog traps focus natively; `autoFocus` on Plan title Input confirmed |

---

## Visual Contract Test Results

**File:** `artifacts/cafa-pmis/src/test/plans-form-visual.test.tsx`

| Test ID | Description | Result |
|---------|-------------|--------|
| PLAN-FORM-VIS-01 | Create dialog / edit page title differentiation | ✅ PASS |
| PLAN-FORM-VIS-02 | Plan type Select — 7 options, no raw enum strings | ✅ PASS |
| PLAN-FORM-VIS-03 | Context fields (State, Sector) in create + edit | ✅ PASS |
| PLAN-FORM-VIS-04 | Activity card fields; progress/status preservation | ✅ PASS |
| PLAN-FORM-VIS-05 | Hard-block duplicate `role="alert"` | ✅ PASS |
| PLAN-FORM-VIS-06 | Soft-duplicate `role="status"` | ✅ PASS |
| PLAN-FORM-VIS-07 | Save As Draft = outline/secondary | ✅ PASS |
| PLAN-FORM-VIS-08 | Save & Finish / Save Changes = primary + aria-busy | ✅ PASS |
| PLAN-FORM-VIS-09 | Sticky footer: absent in view mode, present in edit | ✅ PASS |
| PLAN-FORM-VIS-10 | Zero-Residual closure: all structural contracts pass | ✅ PASS |

**Full suite result:** 4769 passed, 0 failed.

---

## Zero-Residual Confirmation

No changes were made to:
- Backend routes, API contracts, OpenAPI specs, or generated types
- Effective-sector model or scope logic
- Duplicate-check queries or uniqueness indexes
- Progress / completion integrity rules
- Workflow transitions or notification routing
- Approval lock logic
- Date validation rules or the `validate()` function
- Migration files
- Global design-system components

All pre-existing Plans Zero-Residual contracts pass unchanged.

---

## Next Phase

**Plans Phase 3 — Plan Detail Header + Overview / Workflow.**  
Do NOT start automatically.
