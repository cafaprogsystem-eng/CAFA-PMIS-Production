# Reports Module Visual Refinement — Phase 1 Audit

**Date:** 2026-08-18  
**Scope:** Visual-only changes to the Reports landing page and report-list views.  
**Zero-residual status:** All backend routes, APIs, OpenAPI contracts, generated types, permissions, author governance, workflow, transitions, identity rules, duplicate rules, submit validation, revision lifecycle, attachment security, comments, voice notes, analytics calculations, notifications, and migrations are **unchanged**.

---

## 1. Visual Issues Found and Resolved

### 1.1 Landing Page Vertical Rhythm

- **Issue:** Root container `space-y-6` created loose gaps between the data-quality notice, KPI strip, type-navigation cards, and toolbar.
- **Fix:** Changed to `space-y-4` for more compact, professional vertical rhythm.

### 1.2 Report-Type Navigation Card Hover

- **Issue:** `hover:shadow-md hover:border-primary/40 hover:-translate-y-px` created a noticeable elevation jump that felt heavy.
- **Fix:** Replaced with `hover:shadow-sm hover:ring-1 hover:ring-border/60 hover:border-primary/30` — restrained, enterprise-appropriate treatment that still communicates interactivity.

### 1.3 Toolbar Filter Widths

- **Issue:** Ten filter selects with hardcoded widths (`w-36`, `w-44`, `w-28`, `w-24`, `w-40`) created an inflexible, crowded toolbar, especially with long project/state/sector names.
- **Fix:** All filter selects converted to flexible `min-w`/`w-auto`/`max-w` patterns:
  - Status: `min-w-[7rem] w-auto max-w-[10rem]`
  - Frequency: `min-w-[7rem] w-auto max-w-[10rem]`
  - State: `min-w-[7rem] w-auto max-w-[10rem]`
  - Sector: `min-w-[7rem] w-auto max-w-[10rem]`
  - Project: `min-w-[7rem] w-auto max-w-[11rem]`
  - Activity: `min-w-[8rem] w-auto max-w-[12rem]`
  - Quarter: `min-w-[6rem] w-auto max-w-[8rem]`
  - Month: `min-w-[6rem] w-auto max-w-[8rem]`
  - Year: `min-w-[5rem] w-auto max-w-[7rem]`
  - Author: `min-w-[7rem] w-auto max-w-[11rem]`
- Toolbar wrapper already uses `flex-wrap gap-2` — filters wrap cleanly on narrow screens.

### 1.4 Filter Placeholder Casing

- **Issue:** Placeholder and `SelectItem` "All" options used Title Case ("All Statuses", "All Frequencies", etc.) instead of Sentence case.
- **Fix:** Changed all "All X" placeholders and items to sentence case: "All statuses", "All frequencies", "All states", "All sectors", "All projects", "All activities", "All quarters", "All months", "All years", "All authors".

### 1.5 Table Compound Report Cell

- **Issue:** The table had 10 columns (including conditional Activity column), with Title and Period as separate columns. Period was small and separated from the report identity.
- **Fix:** Combined Title (primary, `line-clamp-1 leading-snug`) with Period as a secondary `text-[11px] text-muted-foreground tabular-nums` line below — in one "Report" cell. Removed the standalone Period column. Column count reduced from 10 to 9 (non-activity: 9 → 8; activity: 10 → 9). Data is preserved — period information is now more prominent.

### 1.6 Table Cell Overflow

- **Issue:** State and Sector cells had no `max-w` or `truncate` classes, risking rows becoming 3+ lines tall with long location/sector names.
- **Fix:**
  - State cell: `max-w-[120px] truncate` with `title` tooltip
  - Sector cell: `max-w-[130px] truncate` with `title` tooltip
  - Project and Prepared By cells already had truncation — no change needed.

---

## 2. Elements Already Working Well

- **KPI strip:** Five StatCards already have equal height (`h-28` skeleton), consistent padding, and aligned number baseline via `StatCard` component.
- **SummaryCards:** Per-type KPIs already visually consistent with landing KPI cards via the same `StatCard` component.
- **Empty states:** Already use `py-10`, already distinguish scope-empty (`list.noScopeEmpty`) from filter-empty (`list.noFilterMatch`) with a Clear Filters button.
- **Historical Data Quality Notice:** Already compact (`px-4 py-3`), informational-only — no change needed.
- **Card view:** `card-grid.tsx` already uses restrained hover (`hover:shadow-sm hover:ring-1 hover:ring-border/60`) — Reports cards benefit from this.
- **Status display:** `displayStatus()` already maps all statuses to human-readable British English labels. No raw enum values in visible text.
- **Error state:** Uses `ErrorState` component with `variant="server"`, professional message, and Retry action.
- **Toolbar wrapper:** Already `flex-wrap gap-2 rounded-xl border border-border/60 bg-muted/30` — coherent single control surface.
- **Table sticky header:** `shadow-[0_1px_0_0_hsl(var(--border))]` — subtle separator, not heavy.
- **View mode switcher:** `view-mode-switcher.tsx` already has `aria-pressed` and `aria-label` — correct.

---

## 3. Accessibility Improvements

- Added `aria-label` to all ten filter `SelectTrigger` elements ("Filter by status", "Filter by frequency", etc.).
- Added `aria-label="More actions"` and `aria-hidden` to the `MoreHorizontal` icon in the icon-only table actions dropdown trigger.
- Added `aria-hidden` to `AlertCircle` in the `SummaryCards` error state (decorative icon).
- Existing `aria-hidden` already present on all decorative icons in landing (FileText, ChevronRight, meta.icon, Info, AlertCircle in landing KPI error).

---

## 4. Report Type Presentation

- Four type-navigation cards show human-readable labels from `TYPE_META`: "Project Reports", "Activity Reports", "State Programme Reports", "HQ Sector Reports".
- Individual report cards in type-specific list views correctly omit report-family badge (context established by page heading and URL).
- Page heading clearly communicates which family the user is viewing.

---

## 5. KPI Area

- Landing: five StatCards (Total, Draft, Awaiting Approval, Approved, Awaiting Approval Over 14 Days) via `kpiCards` array.
- Sub-type pages: same five metrics via `SummaryCards` component, scoped to the current report family.
- "Awaiting Approval Over 14 Days" uses `bg-red-500` icon background for emphasis — appropriate; no destructive layout treatment.
- Skeleton height (`h-28` landing, `h-[120px]` sub-type) matches rendered StatCard height — minimal layout shift.

---

## 6. Status and Workflow Presentation

- `displayStatus()` maps all statuses to human-readable strings: Draft, Submitted, Technically Approved, Coordination Approved, Rejected, Returned For Revision, Final Approved, Awaiting Coordinator Review, etc.
- Status badges use `statusBadgeVariant()` from `lib/format.ts` — unchanged.
- Draft actions (Continue Editing, Submit, Duplicate, Delete) gated on `r.status === "draft"` and `hasPerm`.
- Rejected rows show only "Duplicate as Draft" — correct terminal state treatment.

---

## 7. Cards and Table

- Table: compound Report cell reduces visual clutter while preserving all data.
- Table: State and Sector cells now truncate safely with tooltip on hover.
- Card view: `CardGrid` with `RecordCard` already puts title first — hierarchy correct.
- All five view modes (Table, Card, List, Compact, Kanban) use the same `viewRecords` mapping with title as primary field.

---

## 8. Empty/Loading/Error States

- **Empty:** Two distinct i18n keys (`list.noScopeEmpty`, `list.noFilterMatch`) used consistently in table, card, list, compact, and kanban views.
- **Loading:** Table skeleton uses `flex-[3]` first column to approximate table proportions. The loading path for non-table views uses the same list skeleton (rows with flex columns) — this is a known approximation but consistent.
- **Error:** `ErrorState` component with `variant="server"` — professional, no raw server messages.

---

## 9. Responsive Verification

- **1440px+:** KPI strip in one row (5 cols), type-navigation 4-col grid, toolbar not dispersed — filter `flex-wrap` only kicks in when needed.
- **1280px:** All sections fit cleanly within standard enterprise sidebar layout.
- **1024px:** Filters wrap via `flex-wrap gap-2` — no overflow. Card grid adapts via responsive `grid-cols` classes.
- **768px:** Flexible filter widths collapse safely. Table scrolls within `overflow-x-auto` container. Card grid uses responsive column classes.
- **No horizontal page overflow:** Table horizontal scrolling confined to `overflow-x-auto` wrapper (`<div className="overflow-x-auto" role="region">`).

---

## 10. Backwards Compatibility

- `card-grid.tsx`: Not modified — already had restrained hover treatment. Reports benefits automatically.
- `view-mode-switcher.tsx`: Not modified — already had correct `aria-pressed` and `aria-label`.
- `lib/format.ts`: Not modified — `statusBadgeVariant` unchanged.
- All backend routes, APIs, migrations, permissions: **Not touched.**

---

## 11. Test Results

- **REP-VIS-01 through REP-VIS-10:** New visual contract test suite added at `artifacts/cafa-pmis/src/test/reports-visual.test.tsx`.
- **Existing Reports tests:** All REP-ZR, REP-UX, REP-A11Y closure tests pass unchanged.

---

## 12. Remaining Visual Opportunities for Phase 2

Phase 2 focuses on the **PMR/Activity Report Create & Edit experience** (out of scope for this task):

- **PMR form wizard:** Tab navigation visual refinement — progress indicator, active/complete state clarity.
- **Activity Report form:** Step-by-step wizard density, field group spacing, period selector presentation.
- **Report detail panel (drawer/sheet):** Section heading hierarchy, attachment list density.
- **Kanban view:** Column header spacing, card density per column.
- **Print/PDF export layout:** Per task #417 (HQ Sector Report PDF) and #220 (Activity Report PDF) — separate tracked tasks.

---

*This audit covers visual changes only. No backend routes, APIs, OpenAPI contracts, generated types, permissions, author governance, workflow, transitions, analytics calculations, or migrations were modified.*
