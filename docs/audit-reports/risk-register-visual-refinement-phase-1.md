# Audit Report — Risk Register Visual Refinement Phase 1

**Task:** 616  
**Date:** 2026-08-19  
**Author:** Replit Agent  
**Scope:** Landing page, KPI strip, filter toolbar, register table, empty/loading states  
**Out of scope:** Risk Create form, Edit form, Detail view, Comments, Attachments, backend routes, scoring, pagination API contract

---

## Scope

Visual consistency pass for the Risk Register landing page (`artifacts/cafa-pmis/src/pages/risks.tsx`) and its English locale file (`artifacts/cafa-pmis/src/locales/en/risks.json`). Targets parity with the already-refined Projects, Plans, and Reports surfaces.

No backend, API, permission, or scoring logic was changed.

---

## Visual Issues Found and Resolved

| ID | Finding | Resolution |
|---|---|---|
| VF-01 | Page root `space-y-6` — should be `space-y-4` | Changed to `space-y-4` |
| VF-02 | Title `text-3xl font-bold tracking-tight` — oversized vs Plans pattern | Changed to `text-2xl font-semibold tracking-tight` |
| VF-03 | Filter controls use fixed widths `w-40`, `w-44`, `w-52`, `w-48` | Replaced with `min-w-[...] w-auto max-w-[...]` fluid pattern on all six filters |
| VF-04 | No `aria-label` on any SelectTrigger or Search input | Added `aria-label` to all six SelectTriggers and the Search input |
| VF-05 | Filter placeholder translations used title case ("All Levels", "All Statuses", etc.) | Fixed to sentence case in `locales/en/risks.json` |
| VF-06 | Truncated Risk title `<span className="truncate">` had no `title` attribute | Added `title={r.title}` to the truncated span |
| VF-07 | Risk level badge rendered raw lowercase enum (`lvl` — e.g. "high", "critical") | Added `displayRiskLevel()` helper; badge now shows "High", "Critical", etc. |
| VF-08 | Impact cell: `r.impact \|\| r.severity` rendered with CSS `capitalize` only | Added `displayImpact()` helper using the same mapping as `displayLikelihood` |
| VF-09 | Empty state used same text for both filtered and genuine-empty cases | Filtered empty: "No risks match the selected filters." + Clear button; genuine empty: "No risks found" |
| VF-10 | Empty state `py-16` — should be `py-10` | Changed to `py-10` |
| VF-11 | Date cells had no `whitespace-nowrap` | Added `whitespace-nowrap` to due-date and identified-date cells |
| VF-12 | Loading skeleton covered only table body | Extended skeleton to include KPI card shapes (four `h-[128px]` cards) and filter toolbar row when `isLoading && !risksRaw` |
| VF-13 | KPI strip showed zero-count fallback during initial load | Handled by the `isLoading && !risksRaw` guard — full-page skeleton replaces the KPI strip during initial load; cached data remains visible on re-fetch |

---

## Page Hierarchy

- `space-y-4` root matches Projects (`projects.tsx:270`) and Plans (`plans.tsx:680`)
- `text-2xl font-semibold tracking-tight` title matches Plans (`plans.tsx:685`)
- Warning icon and i18n key `t("title")` preserved

---

## KPI Cards

- Four `StatCard` components sourcing counts from `risksRaw?.summary` — not derived from `items.length`
- KPI click handlers toggle `riskLevel` filter via `updateRegisterState` — unchanged
- Loading: during initial load (`isLoading && !risksRaw`), four `h-[128px] rounded-xl bg-muted animate-pulse` skeleton cards shown above toolbar skeleton and table skeletons
- Re-fetch: when data is already cached, the full KPI strip remains visible

---

## Filters

- Six SelectTrigger controls now use `min-w/w-auto/max-w` fluid widths:
  - Risk level: `min-w-[8rem] w-auto max-w-[12rem]`
  - Status: `min-w-[8rem] w-auto max-w-[12rem]`
  - Category: `min-w-[8rem] w-auto max-w-[12rem]`
  - Project: `min-w-[9rem] w-auto max-w-[14rem]`
  - State: `min-w-[8rem] w-auto max-w-[12rem]`
  - Responsible person: `min-w-[9rem] w-auto max-w-[13rem]`
- Search input keeps `flex-1 min-w-[200px]` and gains `aria-label="Search risks"`
- All SelectTriggers have `aria-label` describing their filter purpose
- Placeholder strings updated to sentence case in `locales/en/risks.json`:
  - `allLevels`: "All levels"
  - `allStatuses`: "All statuses"
  - `allCategories`: "All categories"
  - `allProjects`: "All projects"
  - `allStates`: "All states"
  - `allPersons`: "All persons"
- Enum values sent to the API are unchanged

---

## Register Table

- `overflow-x-auto` wrapper already present — confirmed intact
- Risk title: `<span className="truncate" title={r.title}>` — full value accessible on hover/keyboard
- Likelihood column: already used `displayLikelihood()` — no change
- Impact column: was `r.impact || r.severity` with CSS `capitalize`; now uses `displayImpact()` helper that maps low/medium/high and extended likelihood values to proper labels
- Risk level badge: was raw `lvl` string; now `displayRiskLevel(lvl)` returns "Low", "Medium", "High", "Critical"
- Due date cell: `whitespace-nowrap` added
- Identified date cell: `whitespace-nowrap` added
- Row keyboard/tabIndex/role="button" contracts unchanged

---

## Status/Severity Presentation

- `displayRiskLevel()` helper maps `critical → Critical`, `high → High`, `medium → Medium`, `low → Low`; falls back to `charAt(0).toUpperCase() + slice(1)` for unknown values
- `displayImpact()` helper uses same mapping as `displayLikelihood()` extended with low/medium/high
- `displayLikelihood()` function unchanged
- `StatusBadge` component unchanged

---

## Pagination

- `aria-live="polite"` on the page summary paragraph — unchanged
- `aria-label` on Previous/Next buttons — unchanged
- Pagination logic (limit=50, page reset on filter change, totalPages) — unchanged

---

## Empty / Loading / Error States

**Empty — genuine:** `Shield` icon + "No risks found" text (no clear-filters button)  
**Empty — filtered:** `Shield` icon + "No risks match the selected filters." text + Clear Filters ghost button  
**Both cases:** `py-10` compact padding  
**Loading — initial (`isLoading && !risksRaw`):** Full-page skeleton: 4 KPI card shapes + toolbar row + 6 table row skeletons  
**Loading — re-fetch (data cached):** Existing 6-row table skeleton only, KPI/filter UI stays visible  
**Error:** `ErrorState` variant="server" component — unchanged

---

## Responsive Behaviour

- Filter toolbar `flex-wrap` ensures controls wrap naturally at narrower viewports
- Fluid `min-w/w-auto/max-w` widths allow each filter to take only the space it needs
- KPI card grid uses `sm:grid-cols-2 md:grid-cols-4` — unchanged

---

## Accessibility

- All six filter SelectTriggers have descriptive `aria-label`
- Search input has `aria-label="Search risks"`
- Risk title span has `title` attribute for native browser tooltip on truncated text
- Pagination Previous/Next buttons have `aria-label` — unchanged
- Pagination summary has `aria-live="polite"` — unchanged
- Row `role="button"` / `tabIndex={0}` / `onKeyDown` — unchanged
- Empty states use semantic `<p>` and `<button>` — unchanged

---

## Functional Safety

The following functional contracts from prior tasks (#604 and #596) were verified intact:

- Filter `onChange` handlers call `updateRegisterState` — unchanged
- URL state sync via `parseRiskRegisterState` / `buildRiskRegisterLocation` — unchanged
- Pagination: `limit=50`, page reset on filter change, `totalPages` from envelope — unchanged
- `role="button"` / `tabIndex={0}` / keyboard handlers on table rows — unchanged
- KPI StatCard `onClick` toggles `riskLevel` filter — unchanged
- `aria-live` / `aria-current` on pagination summary — unchanged
- `risksRaw?.summary` as the sole source for KPI counts — verified

---

## Files Changed

| File | Change |
|---|---|
| `artifacts/cafa-pmis/src/pages/risks.tsx` | VF-01–13 visual corrections; `displayRiskLevel()` and `displayImpact()` helpers added |
| `artifacts/cafa-pmis/src/locales/en/risks.json` | Filter placeholder strings lowercased to sentence case; `noRisksFiltered` key added |
| `artifacts/cafa-pmis/src/test/risk-visual.test.tsx` | RISK-VIS-01..10 sentinel tests created |
| `docs/audit-reports/risk-register-visual-refinement-phase-1.md` | This file |

---

## Tests

| Sentinel | Description | Status |
|---|---|---|
| RISK-VIS-01 | Page container has `space-y-4` class | ✅ |
| RISK-VIS-02 | KPI counts sourced from `summary` object, not `items.length` | ✅ |
| RISK-VIS-03 | Filter Select triggers do not have fixed `w-40` style pattern | ✅ |
| RISK-VIS-04 | Filter placeholder text is lower-case after the first word | ✅ |
| RISK-VIS-05 | Risk title truncated span has `title` attribute | ✅ |
| RISK-VIS-06 | Risk level badge does not render raw lowercase enum | ✅ |
| RISK-VIS-07 | Table has an `overflow-x-auto` wrapper | ✅ |
| RISK-VIS-08 | Filtered-empty and genuine-empty render different message text | ✅ |
| RISK-VIS-09 | Pagination Previous/Next buttons have aria-label; summary has aria-live | ✅ |
| RISK-VIS-10 | Zero-Residual functional test file imports compile without error | ✅ |

---

## Residual Visual Findings (Phase 2+ candidates)

The following issues were observed during the audit but are **out of scope** for Phase 1. They are recorded here for prioritisation in Phase 2.

| ID | Location | Finding |
|---|---|---|
| RES-01 | `risks.tsx:276–298` (detail sheet) | Field labels in the detail/edit sheet use `text-xs font-semibold uppercase tracking-wide` — inconsistent with the refined designs that use `font-medium` without uppercase. Phase 2 scope. |
| RES-02 | `risks.tsx` (create form) | Create form labels use plain `<Label>` with no spacing/size system. Phase 2 scope. |
| RES-03 | `risks.tsx` (category column) | Category cell uses CSS `capitalize` on raw enum; a `displayCategory()` formatter would be more robust if enum values ever contain underscores. Phase 2 scope. |
| RES-04 | Arabic locale | `locales/ar/risks.json` filter placeholder keys were not updated for sentence-case equivalency since Arabic casing is conceptually different. Review needed in i18n Phase 4+. |
