# Risk Register — Visual Refinement Phase 2 Audit Report

**Date:** 2026-08-19  
**Scope:** Create dialog and Edit sheet forms (`artifacts/cafa-pmis/src/pages/risks.tsx`)  
**Task:** Phase 2 visual refinement — form layout, section headings, responsive grids, accessibility, and loading states  
**Auditor:** Agent (automated audit as part of implementation)

---

## Scope

This audit covers the Risk Register Create dialog (`DialogContent`) and the Edit sheet form inside `RiskDetailSheet`. It does **not** cover:

- Phase 1 surfaces (landing page, KPI strip, filter bar, table, pagination) — already refined and gated by RISK-VIS-01..10
- Risk Detail read-only view (Phase 3 candidate)
- Comments, Attachments/Evidence, History tabs (Phase 3)
- Backend, API, OpenAPI, generated clients, permissions, scoring, or validation rules

---

## Visual Issues Found

| ID | Finding | Status |
|---|---|---|
| VF-01 | Create dialog `max-w-xl` (576 px) — narrow for 10-field form | **Fixed** — changed to `max-w-2xl` |
| VF-02 | No section headings in Create or Edit forms | **Fixed** — three sections added to both forms |
| VF-03 | `grid grid-cols-2` with no responsive breakpoint | **Fixed** — `grid gap-3 sm:grid-cols-2` throughout |
| VF-04 | Edit footer order: Save first, Cancel second | **Fixed** — Cancel (outline) left, Save (primary) right |
| VF-05 | Textareas have no `resize-y` class | **Fixed** — `resize-y` added to all 4 narrative textareas |
| VF-06 | Narrative textarea fields have no width constraint | **Fixed** — `max-w-2xl` wrapper on description & mitigation |
| VF-07 | Short structured fields (Likelihood, Impact, Status, Due Date) have no width constraint | **Fixed** — `max-w-xs` wrapper on Likelihood, Impact, Status (Edit), and Due Date |
| VF-08 | Category Select renders raw lowercase via CSS `capitalize` | **Fixed** — `displayCategory()` helper; `className="capitalize"` removed |
| VF-09 | No `id` on form controls — Label association via implicit nesting only | **Fixed** — `id`/`htmlFor` pairs added to all controls in both forms |
| VF-10 | No edit loading state — sheet shows empty form during populate phase | **Fixed** — `isResetting` flag + skeleton with `aria-busy="true"` |
| VF-11 | Edit sheet header shows risk title only; no "Editing" indicator | **Fixed** — `SheetDescription` switches to "Editing risk" in edit mode |
| VF-12 | Validation toast-only for most fields; only title/location had inline errors | **Partially addressed** — `aria-invalid` + `role="alert"` on create title & stateId errors |

---

## Form Architecture

### Create Mode

The Create dialog now follows a three-section layout inside a `max-w-2xl` `DialogContent`:

1. **Risk identification** — Title, Description, Category, Location/State
2. **Risk assessment** — Likelihood (Probability), Impact
3. **Ownership & follow-up** — Linked Project, Responsible Person, Due Date, Mitigation Action

DialogFooter order: Cancel (outline) → Register Risk (primary). No editable Status field exists in Create mode; the server defaults new risks to `open`.

### Edit Mode

The Edit sheet uses the same three-section structure inside `<form onSubmit={onSave}>`:

1. **Risk identification** — Title, Description, Category, Status
2. **Risk assessment** — Likelihood, Impact
3. **Ownership & follow-up** — Responsible Person, Due Date, Mitigation Action

Footer order corrected: Cancel (outline) → Save Changes (primary flex-1).

---

## Create Mode

- **Width:** `max-w-2xl max-h-[90vh] overflow-y-auto` ✓
- **Section headings:** `text-sm font-semibold text-foreground border-b border-border/40 pb-1 mb-3` ✓
- **Responsive grid:** `grid gap-3 sm:grid-cols-2` on both assessment and ownership grids ✓
- **id/htmlFor pairs:** `create-title`, `create-description`, `create-category`, `create-location`, `create-likelihood`, `create-impact`, `create-project`, `create-assigned`, `create-due-date`, `create-mitigation` ✓
- **Textarea resize:** `resize-y` on description and mitigationPlan ✓
- **Narrative width:** `max-w-2xl` wrapper on description and mitigation textareas ✓
- **Short-field constraints:** `max-w-xs` wrapper on Likelihood, Impact, Due Date ✓
- **Category labels:** `displayCategory(c)` — maps to "Security", "Operational", "Financial", "Programmatic", "Environmental" ✓
- **No Status field:** Status is not exposed in Create mode ✓
- **`aria-required="true"`** on required Select triggers ✓
- **`aria-invalid` + `role="alert"`** on title error and stateId error ✓

---

## Edit Mode

- **Loading skeleton:** `isResetting` flag guards form display; `aria-busy="true"` during skeleton phase ✓
- **Mode indicator:** `SheetDescription` shows "Editing risk" when `editMode` is true ✓
- **Section headings:** Same three sections as Create (Risk identification / Risk assessment / Ownership & follow-up) ✓
- **Responsive grid:** `grid gap-3 sm:grid-cols-2` on assessment row and ownership row ✓
- **id/htmlFor pairs:** `edit-title`, `edit-description`, `edit-category`, `edit-status`, `edit-likelihood`, `edit-impact`, `edit-assigned`, `edit-due-date`, `edit-mitigation` ✓
- **Textarea resize:** `resize-y` on description and mitigationPlan ✓
- **Short-field constraints:** `max-w-xs` wrapper on Likelihood, Impact, Status, Due Date ✓
- **Category labels:** `displayCategory(c)` ✓
- **Footer order:** Cancel (outline) → Save Changes (primary) ✓
- **`aria-invalid`** on title input ✓

---

## Location/Project Context

- Create: `LocationSelector` renders inside `sm:grid-cols-2` grid alongside Category ✓
- Inline stateId error displays with `role="alert"` ✓
- `isStateLocked` / `lockedStateId` / `lockedStateName` props preserved unchanged ✓
- Project selector uses `useListProjects()` (user-scoped) ✓

---

## Risk Assessment

- Likelihood (Probability) and Impact each have exactly 3 options: Low / Medium / High ✓
- Options rendered via `displayImpact()` for semantic labels ✓
- `max-w-xs` wrapper applied to Select triggers ✓

---

## Status

**Create mode:** No Status field — server defaults to `open`. Status is read-only until Edit. ✓

**Edit mode:** Status Select renders with 3 options: Open / Under Mitigation / Closed.

> **Functional residual (FR-01):** The canonical risk status set supports up to 9 values (open, under_mitigation, closed, identified, assigned, mitigation_plan, follow_up, escalation, and potentially others). The Edit Status Select currently shows only 3. This is a pre-existing functional gap; the `STATUS_OPTIONS` constant in the file already enumerates the full 9-value set for display purposes. Expanding the edit selector is deferred to a dedicated functional task to avoid unintentional scope change here.

---

## Assignee / Due Date

- Assignee query uses the existing authenticated `/users/for-messaging` directory, which returns active users only for every signed-in role; the current user is retained so authors may assign a risk to themselves ✓
- Assignee: `__none__` sentinel correctly maps to `null` in PATCH payload (`cleaned.assignedToId = values.assignedToId ?? null`) ✓
- Due Date: empty string correctly maps to `null` in PATCH payload (`cleaned.dueDate = values.dueDate ? values.dueDate : null`) ✓
- Due Date input is `type="date"` (no time component) ✓
- `dueDate` value sliced to `YYYY-MM-DD` on `onEdit()` (`String(risk.dueDate).slice(0, 10)`) ✓

---

## Narrative Fields

| Field | Form | resize-y | max-w wrapper |
|---|---|---|---|
| Description | Create | ✓ | `max-w-2xl` |
| Mitigation Action | Create | ✓ | `max-w-2xl` |
| Description | Edit | ✓ | `max-w-2xl` |
| Mitigation Action | Edit | ✓ | `max-w-2xl` |

---

## Validation / Error Presentation

- `aria-invalid="true"` added to the title input in both forms ✓
- `role="alert"` on error paragraphs for title and stateId ✓
- `aria-required="true"` on required Select triggers in Create ✓
- Recognised API reference errors (`state_not_found`, `project_not_found`, `assigned_user_not_found`, `assigned_user_not_active`) now map to their corresponding field-level errors. Other failures continue to use the existing toast behaviour. No new validation rules invented.

---

## Footer / Pending State

| Form | Before | After |
|---|---|---|
| Create | Cancel (outline), Register Risk (primary) | Unchanged — already correct |
| Edit | Save Changes (primary), Cancel (outline) | Fixed — Cancel (outline), Save Changes (primary) |

Pending state is indicated by disabled button + "Saving…" text during `updateMutation.isPending`. ✓

---

## Responsive Behaviour

All form grids changed from `grid grid-cols-2` (always 2 columns) to `grid gap-3 sm:grid-cols-2` (single column below `sm`, two columns at `sm` and above). This ensures correct touch/mobile behaviour and logical reading order collapse.

---

## Accessibility

- All form controls have `id` attributes matching `htmlFor` on their `Label` ✓
- `aria-busy="true"` on skeleton wrapper during edit populate phase ✓
- `aria-invalid="true"` on inputs in error state ✓
- `aria-required="true"` on required Select triggers ✓
- `role="alert"` on inline error messages ✓
- `aria-hidden="true"` on decorative `*` asterisks ✓
- `DialogTitle` and `SheetTitle` remain correctly wired for screen reader announcement ✓
- No icon-only clear controls without labels in the form sections ✓
- Focus order follows section reading order (identification → assessment → ownership) ✓

---

## Functional Safety

- `CreateRiskBody.parse(cleaned)` and `UpdateRiskBody.parse(cleaned)` unchanged ✓
- No changes to API routes, OpenAPI specs, or generated client code ✓
- No backend permissions, scoring, or workflow contracts modified ✓
- `parseRiskRegisterState` and `buildRiskRegisterLocation` exports preserved ✓
- `PROBABILITIES` and `IMPACTS` constants unchanged (3 values each) ✓

---

## Files Changed

| File | Change |
|---|---|
| `artifacts/cafa-pmis/src/pages/risks.tsx` | Added `displayCategory()`, `isResetting` state, section headings, responsive grids, id/htmlFor pairs, resize-y, max-w constraints, edit skeleton, mode indicator, footer reorder |
| `artifacts/cafa-pmis/src/locales/en/risks.json` | Added `editingRisk: "Editing risk"` |

---

## Tests

| Suite | File |
|---|---|
| RISK-FORM-SAFE-01..10 | `artifacts/cafa-pmis/src/test/risk-form-safe.test.tsx` |
| RISK-FORM-VIS-01..10 | `artifacts/cafa-pmis/src/test/risk-form-visual.test.tsx` |

Both suites verify functional safety contracts and visual requirements respectively via source-file assertions and rendered-component checks.

---

## Residual Visual Findings (Phase 3 Candidates)

| ID | Finding | Location |
|---|---|---|
| RES-01 | `uppercase tracking-wide` label style in the detail read-only view | `risks.tsx` lines 293–346 (detail grid) |
| RES-02 | Status Edit selector has only 3 of the 9 supported canonical values | `risks.tsx` edit form Status Select |

---

RISK REGISTER VISUAL REFINEMENT — PHASE 2 COMPLETE
