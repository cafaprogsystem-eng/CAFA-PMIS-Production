# Plans Module Visual Refinement — Phase 1 Audit Report

**Date:** 18 August 2026  
**Scope:** Plans landing page — KPI strip, toolbar, Table/Card/Kanban/List/Compact/Calendar views, empty/loading/error states, pagination  
**Zero-Residual Status:** CLOSED — no backend, API, OpenAPI, scope, workflow, calculation, or migration files touched

---

## 1. Issues Found and Resolved

### 1.1 Card view — information hierarchy (card-grid.tsx)

**Issue:** Code displayed before title in RecordCard (`card-grid.tsx`). Code is a secondary reference; title is the primary identity.  
**Fix:** Swapped order — title (`<h3>`, `font-medium`, `line-clamp-2`) now leads; code (`font-mono`, `text-[11px]`, `text-muted-foreground`) appears below as a secondary reference. Full title accessible via Tooltip on truncation.  
**Affected views:** Card (all pages using CardGrid — Plans, any other module).

### 1.2 Card view — hover treatment (card-grid.tsx)

**Issue:** `hover:shadow-md hover:-translate-y-0.5` created aggressive elevation + movement on hover, inconsistent with calm enterprise identity.  
**Fix:** Replaced with `hover:shadow-sm hover:ring-1 hover:ring-border/60` — subtle ring + minimal shadow lift. No translate animation.

### 1.3 Card view — empty state padding (card-grid.tsx)

**Issue:** `py-16` created excessive dead space when no cards to show.  
**Fix:** Reduced to `py-10`.

### 1.4 Kanban view — code truncation (kanban-board.tsx)

**Issue:** Code `<p>` in KanbanCard lacked `truncate` class; long codes could break card layout.  
**Fix:** Added `truncate` to the code element.

### 1.5 Kanban view — empty state padding (kanban-board.tsx)

**Issue:** `py-16` excessive in Kanban empty state.  
**Fix:** Reduced to `py-10`.

### 1.6 Kanban view — board min-height (kanban-board.tsx)

**Issue:** `min-h-[400px]` created excessive dead space with few or no items in visible columns.  
**Fix:** Reduced to `min-h-[280px]`. Horizontal scroll behaviour and column layout unchanged.

### 1.7 Table view — empty state padding (plans.tsx)

**Issue:** `py-16` in `<TableCell>` empty state.  
**Fix:** Reduced to `py-10`.

### 1.8 Table view — cell overflow handling (plans.tsx)

**Issue:** Responsible, Type, and State cells lacked truncation; long values could cause rows to grow excessively tall.  
**Fix:**
- Type cell: `max-w-[120px]` + `truncate block` on inner span  
- State cell: `max-w-[140px]` + `truncate block` on inner span  
- Responsible cell: `max-w-[160px]` + `truncate block` on inner span

### 1.9 Toolbar — fixed filter widths (plans.tsx)

**Issue:** All filter controls used fixed widths (`w-52`, `w-40`, `w-44`) which either truncated selected values or wasted space.  
**Fix:** Switched to flexible widths with min/max caps:
- Search: `min-w-[8rem] w-full max-w-[13rem]`
- Type: `min-w-[7rem] w-auto max-w-[11rem]`
- Status: `min-w-[7rem] w-auto max-w-[11rem]`
- State: `min-w-[7rem] w-auto max-w-[11rem]`

Toolbar already uses `flex-wrap gap-2.5` so filters wrap on narrow widths — no additional change needed.

### 1.10 Toolbar — filter label casing (plans.tsx)

**Issue:** SelectItem placeholders used Title Case ("All Types", "All Statuses", "All States") where Sentence case is the spec standard.  
**Fix:** Changed to "All types", "All statuses", "All states".

### 1.11 KPI skeleton height (plans.tsx)

**Issue:** Skeleton used `h-[104px]` while StatCard has `min-h-[128px]` — mismatch causes layout shift on load.  
**Fix:** Updated skeleton to `h-32` (128px), matching StatCard's minimum height.

### 1.12 Page vertical rhythm (plans.tsx)

**Issue:** `space-y-6` (24px) between all sections felt loose — too much white space between KPI strip, follow-up cards, toolbar, and results.  
**Fix:** Reduced to `space-y-4` (16px) for a more compact, professional layout.

---

## 2. Elements Confirmed Working — No Change Made

### 2.1 KPI strip — five metrics (plans.tsx:709–730)

All five StatCards confirmed present and unchanged:
- **Total Plans** — `extTotals?.total`
- **Draft Plans** — `extTotals?.draft`
- **Awaiting Approval** — `extTotals?.awaitingApproval`
- **Active Plans** — `extTotals?.active`
- **Completed Plans** — `extTotals?.completed`

Grid: `grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3` — appropriate for all breakpoints. No KPIs added, removed, or recalculated.

### 2.2 Progress null contract (PLAN-ZR-02 / PLAN-ZR-15)

`progressPct == null ? "—"` rendering verified in:
- Table: em dash with tooltip "No Activities available for Progress calculation" ✓
- Card: `progress` prop undefined — no bar rendered, no "0%" shown ✓
- Kanban: no progress display in cards (by design) ✓

No changes made to this logic.

### 2.3 Status badges

All three views (Table, Card, Kanban) confirmed to call `PlanStatusBadge` → `formatStatusLabel` / `statusBadgeVariant`. No raw enum strings visible in any view.

### 2.4 Table compound Plan cell

Table column 1 correctly renders title (primary link) + code (monospace, muted) + attachment count badge + Continue Editing (draft only). No consolidation needed; already correct.

### 2.5 View mode switcher

ViewModeSwitcher confirmed: `role="group"` with `aria-label`, `aria-pressed` on each button, Tooltip per mode. No changes required.

### 2.6 Pagination

Client-side pagination with page sizes 10/20/50, first/prev/next/last controls, result count string. Visual presentation already compact and aligned. No changes required.

### 2.7 Follow-up sections (Upcoming Deadlines, Delayed Activities)

Compact strip design for empty/error states (≈76px), full Card for loaded data. Collapsible "Show All" for delayed activities. Visually appropriate relative to KPI strip. No changes required.

### 2.8 Empty state differentiation (plans.tsx:647–675)

Two distinct messages already implemented:
- **Filtered empty:** "No Plans Match The Current Filters" + Clear Filters button
- **Global empty:** "No Plans Available" + Create Plan prompt for authorised users

Both use British English. Visual distinction is maintained.

### 2.9 Error state (plans.tsx:847–859)

Section-isolated Card with `CalendarClock` icon, "Unable to load Plans. Please try again.", and Retry button. No raw server errors exposed. Professional and correct.

---

## 3. Responsive Verification

| Breakpoint | KPI grid | Toolbar | Table | Cards | Kanban |
|---|---|---|---|---|---|
| 1440px+ | 5 cols (lg:grid-cols-5) | Single row, no wrap | Full columns visible | 3-col grid | Columns sized `clamp(260px,30vw,340px)` |
| 1280px | 5 cols | Single row | Usable | 3-col | Side-scroll within container |
| 1024px | 3 cols (sm:grid-cols-3) | Wraps as needed | Horizontal scroll in container | 2-col | Side-scroll in container |
| 768px | 2 cols (grid-cols-2) | Filter wrap | Horizontal scroll in container | 1–2 col | Side-scroll in container |

Horizontal overflow confined to `overflow-x-auto` containers for Table and Kanban. Application page does not overflow horizontally.

---

## 4. Accessibility Verification

- **Decorative icons:** `aria-hidden="true"` on `CalendarClock`, `Filter`, `Search`, `X`, `CheckCircle2`, `MapPin`, `Calendar`, sort indicator icons — confirmed in source.
- **Progress bars:** `budgetPct` rendered in CardGrid includes visible percentage label; aria attributes handled by the shared progress component.
- **Icon-only actions:** ViewModeSwitcher buttons have `aria-label` per mode. Pagination buttons have `aria-label` ("First page", "Previous page", etc.).
- **Focus rings:** No focus ring removal applied. Design-system focus treatment preserved.
- **Sort headers:** `aria-sort="ascending"|"descending"|"none"` on `SortableHead` component.

---

## 5. Visual Contract Tests

New test file: `artifacts/cafa-pmis/src/test/plans-visual.test.tsx`

| ID | Description |
|---|---|
| PLAN-VIS-01 | Status label consistency across Table, Card, Kanban (7 statuses) |
| PLAN-VIS-02 | null progressPct renders "—" never "0%" in all views |
| PLAN-VIS-03 | Draft plan renders Continue Editing in Table, Card, Kanban |
| PLAN-VIS-04 | Non-draft plans (approved/completed/rejected/active/cancelled) have no Continue Editing |
| PLAN-VIS-05 | Long title renders with line-clamp; action buttons remain accessible |
| PLAN-VIS-06 | ViewModeSwitcher has `aria-label` on group, `aria-pressed` on each button |
| PLAN-VIS-07 | Search and filter controls fire handlers; filter placeholder uses sentence case |
| PLAN-VIS-08 | Filtered empty state text differs from global empty state text |
| PLAN-VIS-09 | Loading skeleton renders 6 stable rows without crash |
| PLAN-VIS-10 | CardGrid/KanbanBoard render full ViewRecord cleanly; title leads, code is secondary |

---

## 6. Files Changed

| File | Nature of change |
|---|---|
| `artifacts/cafa-pmis/src/pages/plans.tsx` | Toolbar widths, filter labels, KPI skeleton, table empty state, table cell overflow, page spacing |
| `artifacts/cafa-pmis/src/components/view-modes/card-grid.tsx` | Card hierarchy (title first), hover treatment, empty state padding |
| `artifacts/cafa-pmis/src/components/view-modes/kanban-board.tsx` | Code truncation, empty state padding, min-height |
| `artifacts/cafa-pmis/src/test/plans-visual.test.tsx` | New — PLAN-VIS-01 through PLAN-VIS-10 |

**No backend, API, OpenAPI, generated-type, scope, workflow, calculation, or migration files were touched.**

---

## 7. Remaining Visual Opportunities for Phase 2

Phase 2 targets the Create/Edit Plan experience (starts after user approval of Phase 1):

1. **Create Plan modal refinement** — field grouping, validation feedback density, responsive layout within the 7-field form.
2. **Plan detail / edit page** — tab structure visual polish, activity tab density, section header consistency.
3. **Loading skeleton per view mode** — currently a table-shaped skeleton renders for all view modes; Phase 2 can render a card-grid skeleton when `viewMode === "card"` and a column skeleton when `viewMode === "kanban"`.
4. **Kanban drag-and-drop visual feedback** — drag overlay, drop target highlight (if drag-drop is introduced in future).
5. **Print / PDF export layout** — consistent page margins, header, pagination for print.
