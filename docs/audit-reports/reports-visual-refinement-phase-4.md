# Reports Module Visual Refinement — Phase 4 Audit
## SPR + HQSR Create / Edit / Revision Authoring Forms

Date: 18 August 2026
Scope: `program-state-report-form.tsx` (SPR) and `hq-sector-report-form.tsx` (HQSR) — **authoring/edit sections only**. Detail renderers (Phase 3) untouched.

---

## Phase 3 Verification (pre-edit)

All Phase 3 fixes confirmed intact before any Phase 4 edit:

| Item | Status |
|---|---|
| SPR revision banner `rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/40` | Intact |
| HQSR revision banner `rounded-md border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40` | Intact |
| HQSR rating reason display (`line-clamp-2` + Tooltip in detail renderer) | Intact |
| SPR detail renderer headings `text-sm font-medium text-foreground mb-2` | Intact |
| DialogFooter action hierarchy (Cancel → Save Draft secondary → Submit primary) | Intact |

---

## SPR Findings & Changes

| # | Issue | Classification | Fix |
|---|---|---|---|
| A | Risks 7A/7B subheadings used `uppercase tracking-wide` | Typography inconsistency | Dropped `uppercase tracking-wide`; now `text-xs font-medium text-muted-foreground` |
| F | Sections 5, 7, 8 headings appeared different from the other nine | Heading inconsistency | Verified: these sections' divider is owned by the wrapper row (`flex … border-b pb-1`, which also hosts the Add button); the nested `<h4>` deliberately carries no second `border-b`. Every section now has exactly **one** divider owner — either the wrapper (button-bearing headers: SPR 5, 7, 8) or the `<h4>` itself (all others). Guarded by test REP-SPRHQ-FORM-VIS-11 |
| G | Attachment filename `truncate` present but no `title` attr for full-name access | Long-content safety | Added `title={d.fileName}` to the truncated span |

Preserved: identity/period lock (`bg-muted cursor-not-allowed`), three heading variants (Create/Edit/Revise), revision banner + CommentsPanel, error summary region, DialogFooter order, `isReturnedForRevision` computation.

## HQSR Findings & Changes

| # | Issue | Classification | Fix |
|---|---|---|---|
| B | Five snapshot/performance subheadings used `uppercase tracking-wide` | Typography inconsistency | Dropped from all five; now `text-xs font-semibold mb-1 text-muted-foreground` |
| C | h3 stayed "Edit HQ Sector Report" during revision (SPR had a Revise variant) | Revision-mode parity | Added `isReturnedForRevision` variant via new i18n key `hqForm.titleRevise` — EN "Revise HQ Sector Report"; AR "مراجعة تقرير قطاع المقر" (glossary-aligned: HQ Sector Report = تقرير قطاع المقر, Revision = مراجعة) |
| D | Technical rating reason Textarea `rows={2}` too cramped for substantive assessment | Authoring density | `rows={3}` + explicit `resize-y` |
| — | Sections 8–12 headings appeared different from other HQSR sections | Heading inconsistency | Verified: divider is owned by the button-bearing wrapper row (`flex … border-b pb-1`); nested `<h4>` deliberately carries no second `border-b`. One divider owner per section, guarded by test REP-SPRHQ-FORM-VIS-11 |
| — | Revision banner had no `role="alert"` (SPR banner has it) | Accessibility parity | Added `role="alert"` to the banner container (no logic change) |
| G | Attachment filename `truncate` present but no `title` attr | Long-content safety | Added `title={d.fileName}` |

Preserved: identity/sector/period lock, rating Select options (Excellent/Good/Fair/Needs Improvement/Critical), Create New Risk Dialog, CommentsPanel, DialogFooter, `isReturnedForRevision` computation, Voice Note section.

## Issue E — Narrative Textarea resizability

The shared base `Textarea` component (`components/ui/textarea.tsx`) already includes `resize-y` in its default class list. Every narrative Textarea in both forms therefore inherits vertical resizability with no per-instance change needed. No Textarea overrides it with `resize-none`. **No change required**; explicit `resize-y` added only to the HQSR rating reason field per the Issue D instruction.

## Residual uppercase check

`grep "uppercase tracking-wide|uppercase tracking-wider"` over both files after edits: **0 occurrences**.

## Tests

New: `src/test/spr-hqsr-form-visual.test.tsx` — REP-SPRHQ-FORM-VIS-01…11, all passing. Covers heading variants, state/sector context, revision banner `role="alert"`, labelled narrative Textareas, Save Draft secondary vs Submit primary, aria-busy wiring, no mutation on mount, truncated filenames with `title`, and a source-level guard against parent+child `border-b` divider duplication.

Regression: the full frontend suite re-run green (74 files).

## TypeScript

`npx tsc --noEmit` reports 19 **pre-existing** errors, all in files untouched by this task (`consolidated-report-view.tsx`, `pmr-completeness-panel.tsx`, `plan-detail.tsx`, `plans.tsx`, `reports.tsx` locationType/override fields, `risks.tsx`). These predate Phase 4 and are tracked by the existing project task "Fix pre-existing type errors in reports, plans, and risks pages". Zero errors are attributable to Phase 4 changes.

## Functional Safety

No backend, API, workflow, validation-rule, permission, report-identity, or evidence-security changes. Only className/JSX-text/i18n-key edits plus one `rows` value and one `role="alert"` attribute.

## Residual Visual Findings

NONE.
