# Reports Module Visual Refinement — Phase 3 Audit

**Scope:** Report Detail / Review Experience across all four report types (PMR, Activity, SPR, HQSR).
**Constraint:** Zero-residual — no backend, API, permission, workflow, author-rule, or validation changes.

## Architecture Overview

- **PMR + non-activity types:** right-side `Sheet sm:max-w-2xl` inline in `reports.tsx`.
- **Activity:** independent wide dialog (`activity-report-viewer.tsx`) with content in `activity-report-detail.tsx`.
- **SPR:** `ProgramStateSectionsView` (exported from `program-state-report-form.tsx`) rendered inside the shared Sheet.
- **HQSR:** `HqSectorSectionsView` (exported from `hq-sector-report-form.tsx`) rendered inside the shared Sheet.

## Already Strong (preserved)

- Sheet `sm:max-w-2xl` — readable narrative column; not widened.
- Activities as `<details>` collapsible cards — compact and functional.
- Indicator Progress `<table>` with `overflow-x-auto` — good dense data presentation.
- Attachment rows: compact `border-b` rows with Download links and `aria-label`.
- `VoiceNotePanel readOnly` correctly hides author-only controls.
- HQSR revision banner (`rounded-md border border-amber-300 bg-amber-50` + `CommentsPanel`) — retained as the reference treatment.
- SPR activity `<details>` cards in the detail view with sector/status badges.
- `WorkflowBlock` already encapsulated — untouched.
- `displayStatus` + `statusBadgeVariant` produce human-readable status text.
- Activity detail sticky compact header (Phase 2) — architecture untouched.

## Issues Found and Fixed

### A. Metadata grid labels used `uppercase tracking-wide` (`reports.tsx`)
All six labels in the shared metadata grid, plus the "Current Project Reference Data" divider label, shouted in uppercase. Same issue fixed in Projects/Plans Phase 3.
**Fix:** dropped `uppercase tracking-wide`; labels are now `text-xs text-muted-foreground mb-0.5` (sentence-case rendering).

### B. SPR revision banner used `border-2 border-amber-400` and `rounded` (`program-state-report-form.tsx`)
Heavier than the HQSR banner and inconsistent with the design system.
**Fix:** normalised to `rounded-md border border-amber-300 bg-amber-50 text-amber-800` with matching dark-mode classes (`dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300`). `role="alert"`, icon, and text unchanged.

### C. HQSR technical rating reason hard-truncated at `max-w-48` (`hq-sector-report-form.tsx`)
Reviewer feedback was cut off at 192 px.
**Fix:** replaced `truncate max-w-48` with `line-clamp-2 min-w-0 flex-1` and wrapped in a `Tooltip` showing the full reason. `Tooltip` imports added (global `TooltipProvider` already exists in `App.tsx`).

### D. SPR detail meta row was `text-xs` throughout (`program-state-report-form.tsx`)
Labels and values were both `text-xs`.
**Fix:** wrapper no longer forces `text-xs`; values are `text-sm`, labels are `text-xs font-medium text-muted-foreground`. i18n keys and conditional rendering preserved.

### E. Section heading inconsistency in SPR/HQSR detail renderers
SPR detail headings varied (`mb-2`, `mb-1`, none); HQSR mixed `mb-1`/`mb-2` and used `font-semibold`.
**Fix:** all `<h4>` headings inside the **detail renderers only** unified to `text-sm font-medium text-foreground mb-2`. Edit-mode form section headings (`border-b pb-1`) untouched.

### F. PMR narrative section `<h4>` elements missing `mb-2` (`reports.tsx`)
Narrative, Challenges & Mitigation, and Lessons & Recommendations headings lacked `mb-2`.
**Fix:** `mb-2` added. Parent `space-y-3` retained — spacing reads well at `sm:max-w-2xl`; increasing to `space-y-4` was judged unnecessary.

### G. Activity detail — audit result
`activity-report-viewer.tsx`: no uppercase label issues found; sticky-header architecture untouched.
`activity-report-detail.tsx`: one uppercase label found — the "Supporting Insights" `<h3>` used `text-xs font-semibold uppercase tracking-wide`; normalised to `text-xs font-medium text-muted-foreground`. `readOnly` VoiceNotePanel behaviour untouched.

## Additional Observations (no change made)

- The metadata-grid uppercase pattern also exists in **edit-mode** form contexts (SPR section 7a/7b labels, HQSR reference-data panels, PMR wizard step labels at `text-[10px]`/`text-[11px]`). These belong to authoring forms (Phase 2 scope / Phase 4) and were deliberately left unchanged.
- SPR/HQSR meta rows use `<strong>` for labels — retained (semantic emphasis) with adjusted classes.

## Tests

`reports-visual.test.tsx` extended with REP-DETAIL-VIS-01 through REP-DETAIL-VIS-10 (source-analysis contract tests). All existing Reports/SPR/HQSR suites remain green.
