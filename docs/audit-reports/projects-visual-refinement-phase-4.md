# Projects Module Visual Refinement — Phase 4 Audit
## Project Detail — Operational Sub-Tabs

Date: 18 August 2026
Scope: `artifacts/cafa-pmis/src/pages/project-detail.tsx` (operational tabs only).
Zero-residual contract: visual presentation only — no backend, API, permission,
workflow, calculation, budget, document-lifecycle or activity-identity changes.

## Classification Framework (spec A–F)

- **A** — Already visually strong
- **B** — Needs density refinement
- **C** — Disabled-form in read mode
- **D** — Table overflow risk
- **E** — Empty / loading / error inconsistency
- **F** — Action hierarchy issue

## Tab-by-Tab Findings

| Tab | Class | Finding | Action |
|---|---|---|---|
| Overview (metadata dl) | B | `uppercase tracking-wider` on eight `<dt>` labels and the planned-outputs count label survived Phase 3 (confirmed by direct read before editing) | **Fixed** — tracking removed; `text-xs font-medium text-muted-foreground` retained |
| Activities | D | 8 columns, no `overflow-x-auto`; title cell `max-w-[260px]` without truncation | **Fixed** — overflow wrapper; title span `block max-w-[200px] truncate` with `title` attr (positive bound on the span — the spec's `max-w-0` cell pattern was rejected in review as it can collapse the column); code `w-20`, progress `w-32`, budget `text-right min-w-[130px]` |
| Indicators | A | Read-only table, right-aligned numerics, ProgressBar per row | No change |
| Budget | A | Read-only plain-text figures with `formatCurrency` (not disabled inputs); "Open Full Budget" link | No change |
| Risks | D | 7 columns, no overflow guard; long titles unbounded | **Fixed** — overflow wrapper; title truncation pattern with `title` attr. Compact header and overdue `text-destructive` informational colour preserved (correct) |
| Reports | A | Read-only table; `ProjectStatusBadge` human-readable status; `PmrCompletenessPanel` permission-gated | No change |
| Beneficiaries | A | Single `StatCard` handles value + target + link; no empty-state gap (zero renders "0 of N target", which is informative) | No change |
| State Allocations | D | HQ allocation table has 10 columns, no overflow guard | **Fixed** — overflow wrapper only; numeric `text-right text-xs` cells and state-lead `text-sm` preserved |
| History | E | Empty state a flat unpadded paragraph | **Fixed** — `text-center py-6` |
| Voice Notes | A | Delegates to `VoiceNotePanel`; trigger label from `t("detail.voiceNotes")` | No change |
| Documents | D/A | Filenames rendered raw in the download `<a>` — long names break layout. Lifecycle banners, badges (icon + text, not colour-only) and action hierarchy (download primary / ghost delete / amber override / no affordance frozen) already correct | **Fixed** — `max-w-[320px] truncate` + inner `truncate` span + `title` attr; icon `shrink-0`. No lifecycle logic touched |
| Comments | A | Delegates to `CommentsPanel`; trigger label from `t("detail.comments")` | No change |
| Loading skeleton | E | Skeleton simulated a 4-KPI strip (`grid-cols-2 lg:grid-cols-4`, `h-[120px]`); post-Phase-3 overview is two 2-column card grids | **Fixed** — skeleton now `grid gap-5 md:grid-cols-2` with four `h-[180px]` cards; tabs bar and content placeholders kept |

## Scout Verification

All scout "already good" items were confirmed by direct inspection and left
untouched: Activities/Indicators/Reports read-only tables, Budget plain-text
figures, Beneficiaries StatCard, History timeline, Voice Notes/Comments
delegation, Documents banners/badges/action hierarchy, Risks header density.

Issue A (Overview uppercase labels) was **genuine** — Phase 3 did not remove
them; fixed here per the phase-4 fallback instruction.

## Functional Safety

No mutations, queries, permissions, calculations, spend/progress fields,
allocation semantics or document-lifecycle logic changed. `budgetSpent` remains
display-only text (never in an `Input`). No `objectPath`/`driveFileId` exposed.

## Tests

PRJ-OPS-VIS-01 … PRJ-OPS-VIS-10 added to
`artifacts/cafa-pmis/src/test/projects-visual.test.tsx`.

## Residual Visual Findings

NONE.
