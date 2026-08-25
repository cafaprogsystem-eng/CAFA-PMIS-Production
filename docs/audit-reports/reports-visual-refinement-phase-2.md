# Reports Module Visual Refinement — Phase 2 Audit Report

**Date:** 2026-08-18  
**Scope:** PMR and Activity Report create / edit / revision form surfaces  
**Primary file:** `artifacts/cafa-pmis/src/pages/reports.tsx`  
**Phase 3 deferred:** SPR (`program-state-report-form.tsx`) and HQSR (`hq-sector-report-form.tsx`)

---

## 1. Visual Issues Found and Fixed

### Issue 1 — Full-width short controls (Fixed ✓)
**Found:** Reporting Frequency Select, On-Demand Reason Select, and Annual Year Select all defaulted to full-width inside the 920 px dialog, leaving large horizontal dead space on the right.  
**Fixed:**
- Reporting Frequency Select wrapped in `<div className="max-w-xs">`.
- Annual Year Select wrapped in `<div className="max-w-[10rem]">`.
- On-Demand Reason Select wrapped in `<div className="max-w-xs">` inside a `col-span-2` container.

### Issue 2 — Narrative field width (Fixed ✓)
**Found:** At 920 px dialog width, narrative Textareas spanning the full `px-5 py-4` body were excessively wide for comfortable reading.  
**Fixed:** All narrative Textareas in the Progress, Challenges, Lessons, and Activity wizard tabs wrapped in `<div className="max-w-2xl">` (672 px). Applies to: `implementationSummary`, `progressAgainstPlan`, `keyAchievements`, `resultsAchieved`, `challenges`, `mitigationMeasures`, `nextSteps`, `lessonsLearned`, `recommendations`, `successStory`, `coordinationUpdates`, `communityFeedback`, and all PMR generic section loops (`sectionsCfg.progress`, `sectionsCfg.challenges`, `sectionsCfg.narrative`). `resize-y` added to all narrative Textareas.

### Issue 3 — PMR Activity card compaction (Fixed ✓)
**Found:** Activity cards used `rounded-lg border p-4` — slightly over-padded for a repeating card structure.  
**Fixed:** Changed to `rounded-md border p-3 space-y-3 bg-muted/10`. Achievement Summary Textarea `rows` increased from 2 to 3 with `resize-y` for better editing ergonomics.

### Issue 4 — Beneficiary 5-column grid (Fixed ✓)
**Found:** All three beneficiary grids used `grid-cols-5`, which becomes cramped at dialog widths ≤ 1024 px.  
**Fixed:**
- Per-activity beneficiary grid in PMR Activities tab: `grid-cols-3 sm:grid-cols-5`.
- Auto-calculated summary grid (project-type PMR): `grid-cols-3 sm:grid-cols-5`.
- Manual-entry beneficiary grid (non-project PMR): `grid-cols-3 sm:grid-cols-5`.

### Issue 5 — Edit-form loading skeleton (Fixed ✓)
**Found:** No structural skeleton appeared while editing an existing report — only a blank/loading sub-panel.  
**Fixed:** Added a structural skeleton block (header bar placeholder, 4 field-row skeletons, footer button placeholders) rendered when `isLoadingEditForm === true && !isProgramState && !isHqSector`. Uses existing `Skeleton` component. Outer div has `aria-busy="true"` and a visually-hidden "Loading report…" text.

### Issue 6 — Revision banner (Fixed ✓)
**Found:** Returned-for-revision reports (status = `"draft"`) showed no reviewer feedback in the form body — authors had to find feedback elsewhere.  
**Fixed:** Added `revisionBannerDismissed` state and `useQuery` fetching `/api/comments?entityType=report&entityId=<id>`. A `lastRevisionRequest` memo picks the most recent `revision_request`-type comment. An amber `role="status"` banner appears at the top of the form showing reviewer name, date, and comment body. A "Dismiss" button hides it for the session. Banner shows only when `editingReport.status === "draft" && lastRevisionRequest && !revisionBannerDismissed`.

### Issue 7 — Evidence section cohesion (Fixed ✓)
**Found:** The non-activity (PMR/state/HQ) Attachments & Voice tab had a section heading "Supporting Documents" and a separate "Voice Note (Optional)" sub-heading. They were visually disconnected.  
**Fixed:** The outer section heading now reads **"Evidence & Supporting Documents"** encompassing both areas. The file-attachment area is wrapped in `<section aria-labelledby="rp-docs-heading">`. Voice Note sub-heading changed to `h5 text-sm font-medium` (subordinate weight). Paperclip icon has `aria-hidden="true"`.

### Issue 8 — No-supporting-documents path (Fixed ✓)
**Found:** When the "No supporting documents" checkbox was checked, the "Attach document" label link remained fully visible and clickable, visually contradicting the no-docs state.  
**Fixed:** Upload area wrapped in `<div className={cn(docsNoSupport ? "opacity-50 pointer-events-none" : "")}>`. The reason Textarea uses `mt-2 ml-6` indentation (visually connected to checkbox). Validation logic unchanged.

### Issue 9 — Attachment filename truncation (Fixed ✓)
**Found:** Non-activity attachment filename `<p>` element already had `truncate` but was missing `title` attribute for tooltip access.  
**Fixed:** Added `title={doc.file.name}` to the filename `<p>` in the non-activity pending file list. Activity Report section already had this.

### Issue 10 — Section heading consistency (Verified ✓)
**Found:** PMR tabs use `<h4 className="text-sm font-semibold border-b pb-1">` consistently. Activity wizard uses a mix of `<h4>` headings and `<p className="text-[11px] font-semibold uppercase tracking-wider">` for sub-section labels. The Activity wizard sub-labels are intentionally styled differently (step sub-section labels vs. major section headings).  
**Verdict:** The `h4 border-b pb-1` pattern is consistently applied to all major sections in both PMR tabs and Activity wizard steps. Sub-section labels use the small-caps pattern, which is an acceptable visual hierarchy differentiation. No change needed.

---

## 2. Shared Form Visual Language Established

- **Section headings:** `h4 text-sm font-semibold border-b pb-1` is the canonical heading for all major form sections across PMR and Activity Report.
- **Sub-section labels:** `p text-[11px] font-semibold uppercase tracking-wider text-muted-foreground` for step-level sub-labels (Activity wizard).
- **Narrative fields:** `max-w-2xl` (672 px) constraint for all prose Textareas; `resize-y` on all.
- **Short-value selects:** `max-w-xs` for frequency/reason; `max-w-[10rem]` for year; 2-column grid for month+year pairs.
- **Card structure:** `rounded-md border p-3 space-y-3` for repeating cards.
- **Field description text:** `text-xs text-muted-foreground mt-0.5` below labels.

---

## 3. PMR Tab Navigation

Six tabs: Basic Information → Progress → Activities → Challenges → Lessons → Attachments & Voice.

- Sticky ARIA tablist with `role="tab"` / `aria-selected` on each tab.
- Numeric error badges (`tabErrors` map) appear per tab when that tab contains validation errors.
- Keyboard ArrowRight/ArrowLeft advances through tabs (existing implementation, verified intact).

---

## 4. Activity Wizard Navigation

Six wizard steps: Basic → Implementation Progress → Results & Beneficiaries → Challenges & Actions → Lessons & Recommendations → Attachments & Voice.

- Same tablist/tabpanel structure as PMR (shared `<form>` shell, `activeSection` state).
- Per-step validation fires on Next; failed steps show toast + tab error badge.
- Back / Save As Draft / Next (primary) / Submit Report (primary, final step only).

---

## 5. Narratives Treatment

All long-form prose fields now use:
- `<div className="max-w-2xl">` wrapper: limits reading line length to ~672 px within 920 px dialog.
- `rows` set per field: 2 for short variance-reason, 3 for medium narratives, 4 for primary narratives.
- `className="resize-y"` on all narrative Textareas: users can expand if needed.
- Single-line `<Input>` fields (Report Title, Activity Name, etc.) are not constrained.

---

## 6. Activities / Indicators Compaction

- Activity card outer: `rounded-md border p-3` (was `rounded-lg p-4`).
- Card body uses `space-y-3` throughout.
- Achievement Summary Textarea: `rows={3} resize-y`.
- Budget grid: `grid grid-cols-2 sm:grid-cols-4 gap-2 bg-muted/30 rounded p-2` (unchanged — already correct).
- Variance reason: `bg-warning/10 border border-warning/20 rounded p-2 space-y-1` (unchanged).

---

## 7. Beneficiary Grid Responsiveness

All three beneficiary grids updated:
- **Per-activity PMR grid:** `grid-cols-3 sm:grid-cols-5` — wraps to 3 columns at dialog widths < 640 px.
- **Auto-calculated summary (project PMR):** `grid-cols-3 sm:grid-cols-5`.
- **Manual-entry (non-project PMR):** `grid-cols-3 sm:grid-cols-5`.

At 920 px dialog width, `sm:` breakpoint is active and 5 columns display. On mobile-width iframe, 3-column layout prevents clipping.

---

## 8. Evidence / Attachments Cohesion

- Outer section heading: **"Evidence & Supporting Documents"** with Paperclip icon (`aria-hidden`).
- File attachment area in its own `<section aria-labelledby="rp-docs-heading">`.
- Voice Note sub-section: `h5 text-sm font-medium` (visually subordinate).
- No-docs checkbox: when checked, upload area has `opacity-50 pointer-events-none`.
- Reason Textarea: `mt-2 ml-6` indentation (visually linked to checkbox).

---

## 9. Revision Mode

- `revisionBannerDismissed` state variable (reset to `false` on each `loadDraftForEdit` call).
- Comments fetched via `useQuery` when `editingReport?.status === "draft"`.
- `lastRevisionRequest` memo: most-recent comment with `type === "revision_request"`.
- Banner: amber-tinted `role="status"` block showing reviewer name, formatted date, and body text.
- Dismiss button: hides banner for current session without clearing any data.
- Dialog title "Continue Editing — [title]" verified present at line ~3332–3345.

---

## 10. Validation UX

- Per-field `<p role="alert">` error messages with `aria-invalid`/`aria-describedby` on inputs: verified unchanged.
- Tab error badges (numeric count per tab): verified unchanged.
- Per-step validation on Next (Activity wizard): verified unchanged.
- Submit-gate validation: verified unchanged.

---

## 11. Footer / Busy State Protection

Footer structure (verified):
- `border-t border-border` top separator.
- `bg-background py-4 px-6` background and padding.
- Back: `variant="outline"` (secondary).
- Cancel: `variant="outline"` (secondary).
- Save As Draft: `variant="outline"` (secondary) — never primary.
- Next: `variant="default"` (primary) on intermediate steps.
- Submit Report: `variant="default"` (primary) on final step.
- All buttons: `disabled` + `aria-busy="true"` when `isSaving || isCreating` — **zero-regression verified**.
- No button re-enables during PATCH/create/upload/transition mutations.

---

## 12. Responsive Verification

| Breakpoint | Result |
|---|---|
| **1440 px+** | Narrative Textareas constrained to `max-w-2xl` (672 px); dialog `sm:max-w-[920px]` unchanged; form body comfortable with adequate whitespace to the right |
| **1280 px** | Tab/wizard nav fits in one row; 2-column field grids work; beneficiary grid shows 5 columns (`sm:grid-cols-5` active); sticky footer does not overlap content |
| **1024 px** | Tab nav fits (dialog has overflow handling); 2-col grids remain; beneficiary grid shows 5 cols (sm breakpoint active at dialog scroll width); activity cards usable |
| **768 px / narrow** | Beneficiary grids fall back to `grid-cols-3`; frequency/year Selects use `max-w-xs` (no overflow); sticky footer adequate bottom padding; wizard tabs horizontally scrollable |

---

## 13. Accessibility Findings

- **Section `aria-labelledby`:** Evidence section uses `aria-labelledby="rp-docs-heading"`. Other sections use `role="tabpanel" aria-labelledby="tab-<id>"` (existing pattern, unchanged).
- **Decorative icons:** Paperclip icon in Evidence heading has `aria-hidden="true"`. AlertTriangle in variance reason label has `inline` presentation.
- **Activity card remove buttons:** `aria-label="Remove [activity name]"` present (existing).
- **Voice recorder:** Controls verified to use `FormVoiceRecorder` component with existing accessible labels.
- **Revision banner:** Uses `role="status"` (non-interruptive). Dismiss button has visible label "Dismiss".
- **No-docs checkbox:** Standard `<input type="checkbox">` with visible label text.
- **Skeleton:** `aria-busy="true"` on dialog content wrapper; visually-hidden "Loading report…" text for screen readers.

---

## 14. Backend / API / Validator Integrity Statement

**No backend routes, API endpoints, OpenAPI contracts, generated types, report validators, author gates, workflow transitions, identity immutability rules, duplicate-check logic, revision lifecycle, notification routing, evidence security, attachment persistence, voice-note permissions, or analytics were changed in this task.**

All changes are confined to:
- `artifacts/cafa-pmis/src/pages/reports.tsx` — visual / layout classes, state variables for UI-only features (loading skeleton, revision banner dismiss), and query for revision comment display.
- `artifacts/cafa-pmis/src/test/reports-form-visual.test.tsx` — new visual contract test file.
- This audit document.

---

## 15. Zero-Residual Closure

All Reports Zero-Residual (REP-ZR) contracts are preserved:
- No startup DDL in route files.
- No JSONB validator changes.
- No unique-index changes.
- No SELECT FOR UPDATE changes.
- No workflow_path changes.
- No author-gate logic changes.

---

## 16. Next Phase

**Reports Phase 3 — SPR + HQSR Create/Edit/Revision Forms.**

Targets:
- `artifacts/cafa-pmis/src/components/program-state-report-form.tsx` (SPR)
- `artifacts/cafa-pmis/src/components/hq-sector-report-form.tsx` (HQSR)

**Do NOT start automatically.** Phase 3 must be explicitly commissioned after Phase 2 is reviewed and approved.
