# Projects Module Visual Refinement — Phase 1 Audit Report

**Date:** 2026-08-18  
**Scope:** Frontend/style/test/doc files only — no backend, API, permission, workflow, or migration files were changed.  
**Status:** Complete

---

## 1. Current UI Issues Found

### Card Grid (`card-grid.tsx`)

| Issue | Severity | Finding |
|---|---|---|
| Code rendered above title | High | Code was the first element in the card header area, making it visually dominant over the title, reversing the expected information hierarchy. |
| Hover elevation jump | Medium | `hover:shadow-md` + `-translate-y-0.5` created a distracting visual pop on every card hover. |
| Empty state padding | Low | `py-16` (64 px top+bottom) produced an outsized gap in the empty-state container. |
| Footer border opacity | Low | `border-border/50` was slightly harsh against card background. |

### Projects Page (`projects.tsx`)

| Issue | Severity | Finding |
|---|---|---|
| Fixed-width filter selects | Medium | `w-36`/`w-40` hard widths caused long selected values (e.g., a state name) to overflow the control or push toolbar items. |
| Separate Code column | Medium | 10-column table was unnecessarily wide; Code and Title are related and benefit from being co-located. |
| No filtered empty state differentiation | Medium | Both "no projects at all" and "no projects match filter" showed identical text with no "Clear filters" affordance. |
| Missing `aria-label` on draft MoreHorizontal button | Medium | Icon-only button in the draft row actions had no accessible name. |
| Page `space-y-6` | Low | 24 px gap between page header, toolbar, and results was slightly loose on dense enterprise displays. |
| End Date cell — no `whitespace-nowrap` | Low | Date values could wrap at narrow column widths. |
| Donor/Sector cell — no truncation | Low | Long donor or sector strings could widen columns unpredictably. |
| `FolderKanban` icon in empty state — no `aria-hidden` | Low | Decorative icon in the empty state was not hidden from screen readers. |

### Already Working Well (not changed)

- ViewModeSwitcher `aria-pressed` / `aria-label` semantics — correct.  
- `ProjectStatusBadge` tooltip wrapping — correct.  
- Card metadata grid layout — correct.  
- Budget progress bar — correct.  
- State `+N` overflow in table — correct (≤3 shown, remainder as `+N` badge).  
- Card footer state/date footer — correct structure (only hover and border softened).  
- Loading skeleton structure — acceptable (card-shaped skeletons for all view modes).  
- Error state — clean message, retry button present, no raw server strings exposed.

---

## 2. Screens / Components Refined

| File | Type of change |
|---|---|
| `artifacts/cafa-pmis/src/components/view-modes/card-grid.tsx` | Card information hierarchy, hover treatment, footer border, empty padding |
| `artifacts/cafa-pmis/src/pages/projects.tsx` | Space, filter widths, empty-state differentiation, table column consolidation, cell overflow, accessibility |
| `artifacts/cafa-pmis/src/locales/en/projects.json` | Added `table.project`, `noProjectsFiltered` keys |

---

## 3. Card Refinements

### 3.1 Information Hierarchy Fix
**Before:** `code → title` (code was the first visual element, title was secondary below it).  
**After:** `title → code` (title rendered first with `font-medium line-clamp-2` as primary identifier; code rendered below as smaller mono secondary reference).

The title now uses `font-medium` (not `font-semibold`) consistent with the established design system rule (no `font-semibold`/`bold` in card titles). A full-title tooltip is preserved.

### 3.2 Multi-Sector Overflow — NOT APPLICABLE
The current API returns a single `sector` string per project. `ViewRecord.tag` maps to this string. No multi-sector overflow pattern is required.

**Status:** NOT APPLICABLE. The `+N` overflow pattern (already used for `stateNames`) is architecturally ready and can be applied when the API exposes a `sectors[]` array. No changes needed for single-sector data.

### 3.3 Hover Treatment
**Before:** `hover:shadow-md hover:border-primary/20 hover:-translate-y-0.5` — large elevation + translate animation.  
**After:** `hover:shadow-sm hover:ring-1 hover:ring-border/60` — subtle ring treatment without displacement or large shadow jump.

### 3.4 Card Footer Border
**Before:** `border-border/50`  
**After:** `border-border/40` — imperceptibly softer, reduces visual noise without removing the scan-separation value the separator provides.

### 3.5 Empty State Padding
**Before:** `py-16` (64 px top+bottom in the card grid empty wrapper)  
**After:** `py-10` (40 px) — adequate breathing room, more compact.

---

## 4. Table Refinements

### 4.1 Code + Title Column Consolidation
**Before:** 10 columns — `Code | Title | Status | Sector | Donor | States | Budget | Beneficiaries | End Date | Actions`  
**After:** 9 columns — `Project | Status | Sector | Donor | States | Budget | Beneficiaries | End Date | Actions`

The "Project" compound cell renders:
```
Project Title (font-medium, truncate)     ← primary row
CAFA-PRJ-001 (font-mono, xs, muted)       ← secondary reference
```

Column header translation key `table.project` = "Project" added to `en/projects.json`.

### 4.2 Cell Overflow Handling
| Cell | Change |
|---|---|
| Project (title+code) | `min-w-[200px] max-w-[280px]`; both lines use `truncate` |
| Sector | Added `max-w-[140px] truncate text-sm` |
| Donor | Added `max-w-[140px] truncate` (retained `text-sm text-muted-foreground`) |
| End Date | Added `whitespace-nowrap` to prevent date wrap at narrow columns |
| States | Already had `max-w-[200px]`; unchanged |
| Budget | Progress bar naturally constrains width; unchanged |
| Beneficiaries | Progress bar naturally constrains width; unchanged |

---

## 5. Toolbar Refinements

### 5.1 Filter Select Widths
**Before:** `w-36` (Status, State) and `w-40` (Sector) — fixed widths  
**After:** `min-w-[7rem] w-auto max-w-[12rem]` on all three selects

This allows the control to size to its content (helpful when a short value like "Draft" is selected) while capping at 12 rem to prevent very long state names from stretching the toolbar.

### 5.2 Filter Label Casing
Verified: all placeholders use Sentence case — "All statuses", "All sectors", "All states". No ALL CAPS. No change needed.

### 5.3 Toolbar Container
The `rounded-xl border bg-card px-3 py-2.5` toolbar container was retained. It provides a clean grouping boundary that reads well as a unit on the page without being visually heavy.

---

## 6. Spacing & Page Container

**Before:** `space-y-6` (24 px gaps between all top-level page sections)  
**After:** `space-y-4` (16 px gaps) — tighter vertical rhythm appropriate for an information-dense enterprise page.

The page count pill (project count badge next to `h1`) is already compact and muted — no change needed. It reads as "N" in a small muted pill, not as a KPI.

---

## 7. Loading / Empty / Error States

### 7.1 Loading State
The loading skeleton renders six card-shaped rows regardless of active view mode. This is acceptable — skeleton maintains the same card-like structure the table uses. No change.

### 7.2 Empty State — Filtered vs Global
**Before:** Identical text for both "no projects exist" and "no projects match filter".  
**After:**
- **No filters active:** "No projects found" + "Adjust the filters or create a new project."
- **Filters active:** "No projects found" + "No projects match the selected filters." + **Clear Filters** button (triggers `setStatusFilter("")`, `setSectorFilter("")`, `setStateFilter("")`)

Translation key `noProjectsFiltered` = "No projects match the selected filters." added to `en/projects.json`.

The `FolderKanban` decorative icon in the empty state now has `aria-hidden="true"`.

### 7.3 Error State
Already clean — uses `t("loadError")` and `t("loadErrorDesc")` with a retry button. No raw server strings. No change needed.

---

## 8. View Mode Switcher & Accessibility

### 8.1 View Mode Switcher
Already correct: `aria-pressed` and `aria-label` on every button, `role="group"` with `aria-label` on the container. Active styling uses `bg-background shadow-sm text-foreground` vs muted for inactive — distinguishable without colour alone. No change.

### 8.2 Icon-only Actions — Accessibility Fix
- **Draft row MoreHorizontal button:** Added `aria-label="More actions"` and `aria-hidden="true"` on the icon. Previously had no accessible name.
- **Non-draft row MoreHorizontal button:** Already had `aria-label="Project actions"`. Unchanged.
- **Continue Editing button:** Has `aria-label={`Continue Editing ${p.title}`}` on the card variant. The table variant has visible text "Continue Editing" — accessible.

### 8.3 Status Badge Consistency
Both card view (`statusBadge: <ProjectStatusBadge status={p.status} />`) and table view (`<ProjectStatusBadge status={p.status} />`) use the shared `ProjectStatusBadge` component which calls `formatStatusLabel` and `statusBadgeVariant`. No raw enum values displayed. No change needed.

### 8.4 Decorative Icons
`FolderKanban` in the empty state: added `aria-hidden="true"`. `Filter` icon in toolbar already had `aria-hidden="true"`. `Plus` in New Project button already had `aria-hidden="true"`. `Pencil`/`Trash2`/`Send`/`Copy` inside dropdown items: inside labelled button contexts, acceptable. No further changes needed.

---

## 9. KPI Strip — NOT APPLICABLE

**Finding:** No KPI strip exists on the Projects landing page. The spec's KPI refinement section does not apply.

The only summary metric is the count pill (`projects.length`) rendered as a small muted badge next to the `h1`. This is intentional and appropriate — the page is a list view, not a dashboard.

**Optional future addition:** A KPI strip (e.g., total budget, total beneficiaries, active projects count) could be added above the toolbar. This is out of scope for Phase 1.

---

## 10. Responsive Verification

All changes use responsive-aware Tailwind classes:
- Filter selects: `min-w`/`w-auto`/`max-w` — wrap cleanly on narrower viewports.
- Card grid: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` — unchanged, responsive at all breakpoints.
- Table: wrapped in `overflow-x-auto` — horizontal scroll confined to table container, not full page. Confirmed: no `overflow-x` on the page wrapper.
- Toolbar filter region: `flex flex-wrap` — filters stack on narrow screens.
- Page header: `flex flex-col gap-3 md:flex-row md:items-start md:justify-between` — stacks on mobile.

At 768 px, table horizontal scroll is confined to its container. At 1024 px+, all sections fit without forced wrapping.

---

## 11. Visual Contract Tests

Tests added: **PRJ-VIS-01 through PRJ-VIS-10** in `artifacts/cafa-pmis/src/test/projects-visual.test.tsx`.

| Test ID | Description | Outcome |
|---|---|---|
| PRJ-VIS-01 | Primary action (New Project button) present in header | ✅ |
| PRJ-VIS-02 | KPI strip absent (count pill present, no KPI strip) | ✅ NOT APPLICABLE documented |
| PRJ-VIS-03 | View mode switch functional + accessible (aria-pressed) | ✅ |
| PRJ-VIS-04 | Draft project renders Continue Editing action | ✅ |
| PRJ-VIS-05 | Long title clamped; code secondary below | ✅ |
| PRJ-VIS-06 | Multi-sector overflow (NOT APPLICABLE — single sector) | ✅ documented |
| PRJ-VIS-07 | Multi-state `+N` overflow present when states > 2 | ✅ |
| PRJ-VIS-08 | Filtered empty state text differs from global empty state | ✅ |
| PRJ-VIS-09 | Loading state renders skeletons maintaining page structure | ✅ |
| PRJ-VIS-10 | View mode controls have `aria-label` + `aria-pressed` | ✅ |

---

## 12. Files Changed

### Frontend (visual only)
- `artifacts/cafa-pmis/src/components/view-modes/card-grid.tsx`
- `artifacts/cafa-pmis/src/pages/projects.tsx`
- `artifacts/cafa-pmis/src/locales/en/projects.json`

### Tests
- `artifacts/cafa-pmis/src/test/projects-visual.test.tsx` ← new

### Documentation
- `docs/audit-reports/projects-visual-refinement-phase-1.md` ← this file

### Explicitly unchanged
- All backend routes (`artifacts/api-server/src/routes/`)
- All permissions / RBAC (`accessControl.ts`, `permissionsFor`)
- All database migrations
- All API contracts (`lib/api-client-react/`)
- All business logic (report workflow, plan workflow, etc.)
- All other frontend pages

---

## 13. Remaining Visual Opportunities (Phase 2)

Phase 2 target: **Project Registration / Edit Form**

- Tab strip visual treatment (currently custom buttons with `role="tab"`)
- Step progress indicator density
- Field label and helper text alignment
- Document upload slot hover / drag-over states
- Review tab summary card styling
- Duplicate-detection dialog styling

No Phase 2 work was performed in this task.
