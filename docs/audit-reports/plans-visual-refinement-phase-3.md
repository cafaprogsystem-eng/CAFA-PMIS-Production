# Plans Module Visual Refinement — Phase 3 Audit
## Plan Detail Page: Overview / Activities Read View / Workflow

**Scope:** `artifacts/cafa-pmis/src/pages/plan-detail.tsx` (visual only).
**Contract:** Zero-residual — no backend, API, permission, workflow, or calculation changes.
**Baseline chain:** Phase 1 (landing/table/card/kanban) and Phase 2 (create/edit/draft continuation) merged.

---

## Strong Existing Elements (preserved unchanged)

- **Action hierarchy** — Edit Plan button → primary workflow transition → overflow `DropdownMenu` with secondary transitions + Delete. Correct and untouched.
- **Edit mode header Cancel/Save** — `disabled`/`aria-busy` tied to `createMutation.isPending || updateMutation.isPending`; header and sticky footer share this state.
- **Revision banner** — amber `border-amber-300/60 bg-amber-50` with `role="status"`, author, date, comment and resubmit guidance. Preserved verbatim.
- **`PlanStatusBadge`** — semantic, human-readable, shared with the Plans table and cards.
- **Plan code** — compact `font-mono text-xs bg-muted/60` reference chip in the header metadata row alongside `formatPlanType`.
- **Tab architecture** — Overview / Comments (permission-gated) / Workflow / Attachments.
- **Null progress → em dash** — PLAN-465 contract intact in the Plan Progress `DetailField`.

## Genuine Issues Found and Fixed

### A. `DetailField` labels used `uppercase tracking-wide`
The shared label/value helper shouted its labels in uppercase, breaking the Phase 2 label standard. Removed `uppercase tracking-wide`; cascades to all read-only grid fields.

### B. Start/End dates were separate grid rows
Dates were split across two `DetailField` entries, forcing a visual hop to read the plan window. Combined into a single **Implementation Period** row (`start – end`, en dash), matching the Projects Phase 3 fix and freeing a grid cell.

### C. Activities section rendered disabled form controls in read view
The priority issue. Each activity card rendered `<Input disabled>`, `<Select disabled>`, `<Textarea disabled>` when the page was not in edit mode — heavy form chrome with no read value. Replaced with a compact `<dl>` two-column grid (State, Locality, Planned date, Priority, Target beneficiaries, Planned budget, plus Responsible person / Expected result when set). The card header keeps "Activity N: Title", so no redundant title field. Numeric values use `tabular-nums`; budget uses `formatCurrency`.

Activity **Status** (semantic badge via `statusBadgeVariant`/`formatStatusLabel`) and **Progress %** (exact value, including `Planned`/`0%`) always render in the main read-only grid — they are operationally important and never hidden. `ActivityOptionalFields` handled via a new `ActivityOptionalFieldsReadOnly` view: renders Actual budget, Linked risk, Expected output, Performance indicator and Activity description **only when set**; renders nothing at all when no optional field differs from its default.

### D. Project Linkage showed a disabled `<Select>` in read view
Replaced with plain text: linked project `code — title`, or a muted "Standalone plan" label.

### E. Localities showed `LocalityTagInput` (disabled) in read view
Replaced with compact outline `Badge` chips (with map-pin glyph) or an em dash when empty.

### F. Sections 2 and 3 `CardHeader` missing `pb-3`
Added `pb-3` to both, matching the Phase 2 standard used by Section 1.

## Implementation Note

The read/edit branch keys on `isEditing` (the page's view/edit mode state), consistent with Section 1's existing branch, rather than the `canEdit` permission flag alone. Branching on the permission flag would have left live form controls visible to permitted users in view mode. Likewise, the Add Activity and Remove Activity affordances are now gated on `isEditing && canEdit`, so a permitted user cannot mutate local form state from the read view before explicitly entering Edit Plan. Edit-mode controls are unchanged verbatim; no `updateActivity`/`removeActivity`/mutation logic touched.

## Out of Scope (observed, not changed)

- Section 5 (Budget & Totals) still uses `disabled` inputs in view mode — candidate for the Phase 4 polish pass.
- Two pre-existing TypeScript errors in this file (`locationType` not on the generated `PlanDetail` type) are covered by the existing pre-existing-type-errors task; no new errors introduced.

## Tests

- New suite: `src/test/plan-detail-visual.test.tsx` — PLAN-DETAIL-VIS-01 … PLAN-DETAIL-VIS-10, all passing.
- Full frontend suite: 73 files / 4,848 tests passing (all existing Plans suites green).
