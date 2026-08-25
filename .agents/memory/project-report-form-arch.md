---
name: Project Report Form Architecture
description: Key architectural decisions for the New/Edit Project Report form in reports.tsx — from the P1 audit fix implementation.
---

## Core rules

**Currency**: `projectCurrency` state (string | null) derived from `(proj as unknown as Record<string, unknown>).currency` cast; reset on close; passed to every `formatCurrency()` call in the form and detail sheet. Never fallback to USD; show "—" when null. `loadDraftForEdit` restores it from the projects list using the stored projectId.

**Null vs Zero planned budget**: `plannedBudget: null` on `emptyProjectActivity()` and on activity auto-load (`?? null` not `?? 0`). Null means "no authoritative figure". Null displayed as "—". Factual 0 shows formatted zero. `varianceReasonRequired(null, x)` returns false.

**Split validation**: `validateDraft(values)` — title + project/state/frequency/period only. `validateSubmit(values)` — full matrix with `tabErrors: Partial<Record<ReportSectionId, number>>` populated and `setActiveSection` called to first error tab. `buildPayloadData(values)` is pure — no toasts, no side effects.

**True tab architecture**: IntersectionObserver removed. Nav uses `role="tablist"`, buttons use `role="tab" + aria-selected + aria-controls`. Sections use `role="tabpanel" + aria-labelledby`. Active/inactive sections toggle via `className={activeSection === id ? "space-y-3" : "hidden"}` (all sections stay mounted; hidden class = display:none). Tab 4 Challenges absorbs Project Risks. Tab 6 Attachments & Voice absorbs Voice Note.

**Sticky footer**: `<DialogFooter>` removed from inside the `<form>`. New `<div className="border-t shrink-0 px-6 py-4 flex justify-end gap-2">` sits outside the scrollable div (inside `<DialogContent>`).

**Dirty-form protection**: `isFormDirty` boolean state; `setIsFormDirty(true)` in `updateActivity()`, sectionValues onChange, file input onChange, voice note onChange, checkbox changes, plus a `form.watch()` subscription effect for RHF field changes. `isFormDirty(false)` reset in `resetForm()` and after successful save/submit. Dialog `onOpenChange` and Cancel button check dirty state → show `AlertDialog` confirm.

**Financial Summary split**: `linkedActivities` (not isUnplanned) vs `unplannedActivities` (isUnplanned). `projectTotalPlanned = null` when no linked activity has a real plannedBudget. `projectUtilizationPct: number | null` (null when planned is null/0). `projectVariance: number | null`. Unplanned total tracked separately as `unplannedTotalActual`.

**Unplanned Activities**: `isUnplanned: true` on emptyProjectActivity. Button label "Add Unplanned Activity (Report Only)". Badge shows "Unplanned Activity (Report Only)". `unplannedReason` field required for submit (validateSubmit checks it). Excluded from linked-activity planned totals.

**Supporting docs bypass**: `docsNoSupport: boolean` + `docsNoSupportReason: string` state. Submit validation: passes when `hasDocs || (docsNoSupport && docsNoSupportReason.trim())`.

**On-demand period start**: Never inferred from today. Required in validateDraft when kind==="on_demand". `buildPayloadData` uses `values.periodStart || String(values.reportingYear)` (explicit year fallback only).

**Why**: P1 audit found 7 blocking bugs; Phase 2 replaced scroll-anchor tabs with true ARIA tab panels for accessibility and correct keyboard navigation.

**How to apply**: Any change to the form's financial display must go through `projectCurrency ?? undefined` passed to `formatCurrency(value, currency)`. Any new section must register in `REPORT_NAV_ITEMS`, get a `role="tabpanel"` wrapper with `hidden` toggle, and have its errors attributed to the correct `ReportSectionId` in `validateSubmit`.
