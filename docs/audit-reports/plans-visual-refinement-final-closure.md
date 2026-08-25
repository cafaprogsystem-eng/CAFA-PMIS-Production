# Plans Module Visual Refinement — Phase 4 / Final Closure Audit

Date: 18 August 2026
Scope: Plans visual presentation only. No backend, API, workflow, progress calculation, duplicate-rule, or permission changes.

Classification framework: A = disabled controls in read mode · B = uppercase metadata labels · C = null/zero semantics · D = layout/whitespace/truncation · E = action hierarchy/state · F = banner/status treatment.

## Issue A (Class A, MANDATORY — closes #552): Budget & Totals disabled controls in view mode

**Finding:** `plan-detail.tsx` Section 5 (Budget & Totals) rendered the Currency `<Select>`, Planned/Actual budget `<Input type="number">`, and Funding source `<Input>` with `disabled={!canEdit}` in view mode — greyed-out form chrome instead of financial figures.

**Fix (CLOSED):** Added `{!isEditing}` read presentation: a `<dl>` grid (`grid-cols-2 sm:grid-cols-4`) showing Currency, Planned budget, Actual budget and Funding source as clean read-only figures. Currency formatting via `formatCurrency(value, form.currency)` — no hardcoded `$`. Null → `—`, genuine zero → formatted `0`. Edit mode keeps the existing controls entirely unchanged. The totals summary cards below (Total Activities / Beneficiaries / Activity Budget / Burn Rate) were already read presentation and are untouched.

## Issue B (Class B): `uppercase tracking-wide` labels

**Finding & fix (CLOSED):**
- `plans.tsx` — "Upcoming Deadlines" and "Delayed or Overdue Activities" card labels: dropped `uppercase tracking-wide` (and now-redundant `normal-case`).
- `create-plan-registration-dialog.tsx` — "Activity Summary" label in Budget tab: same fix.
- Ripgrep confirms zero remaining `uppercase tracking-wide|wider` in plans.tsx, plan-detail.tsx, planning-dashboard.tsx, create-plan-registration-dialog.tsx. Guarded by PLAN-FINAL-VIS-10.

## Cross-Module Final Audit Checklist

| Check | Verdict | Evidence |
|---|---|---|
| Uppercase metadata labels | CLOSED | Issue B above; 3 instances fixed, none remain |
| Raw enum labels | NOT A DEFECT | `PlanStatusBadge`, `formatPlanType`, `formatStatusLabel` in use throughout |
| Disabled controls in view mode | CLOSED | Issue A (Budget section). Basics/Linkage/Localities/Activities already had Phase-3 read views |
| Inconsistent card radius/padding | NOT A DEFECT | Standard `Card`/`CardContent` components used consistently |
| Excessive whitespace / py-16 empty states | CLOSED | Plan-not-found error card `py-16` → `py-10`; all other states already `py-10` or compact strips |
| Inconsistent button hierarchy | NOT A DEFECT | Create/Save primary; Cancel outline; destructive actions in overflow/dialogs |
| Duplicate information | NOT A DEFECT | Header shows code/type/location; Overview shows dates/sectors/progress/description — no repetition |
| Oversized banners | NOT A DEFECT | Revision banner is the compact amber `border border-amber-300/60 bg-amber-50 … px-4 py-3` treatment |
| Bad truncation | NOT A DEFECT | Breadcrumb `truncate max-w-[180px]`, list `line-clamp-2`, activity header `truncate` |
| Inconsistent section headings | NOT A DEFECT | All Overview sections use `CardTitle text-base`; no uppercase tracking |
| Null rendered as 0 | NOT A DEFECT | See V1 |
| Inconsistent sticky actions | NOT A DEFECT | See V4 |
| Laptop overflow (1280 px) | NOT A DEFECT | Responsive grids (`md:grid-cols-*`), `flex-wrap` header, table containers unchanged since Phase 1–3 |
| Narrow layout failure | NOT A DEFECT | Read `dl` uses `grid-cols-2 sm:grid-cols-4`; filters/cards handled in Phase 1+2 |

## Verifications

- **V1 — Progress null/zero:** plans.tsx list renders null progress as `—` (`text-muted-foreground/60`), genuine 0 as `0%`. plan-detail.tsx Plan Progress DetailField: `progressPct == null → —` with explanatory title; activities read view renders `0%` for genuine zero. Intact; guarded by PLAN-FINAL-VIS-04/05.
- **V2 — Rejection terminality:** `rejected` is in `POST_APPROVAL_LOCKED_STATUSES`; no Edit/Resubmit/Revise affordance rendered. Guarded by PLAN-FINAL-VIS-07 (and existing plan-rejection-ux tests).
- **V3 — Duplicate UX:** hard match (`matchType === "hard"`) blocks submission with `duplicate-hard-warning`; soft match advisory only; "Review Existing Plan" affordance when planId exists. No logic changed. Guarded by PLAN-FINAL-VIS-06 and plan-duplicate-ux.test.tsx.
- **V4 — Dual edit-action state:** header and sticky footer Save/Cancel all use `disabled={createMutation.isPending || updateMutation.isPending}` + matching `aria-busy`. In sync. Guarded by PLAN-FINAL-VIS-09.

## Residual Register

NONE.

## Tests

- New: `src/test/plan-final-visual.test.tsx` — PLAN-FINAL-VIS-01…10, all passing.
- All existing Plans suites green (planning-workspace, plan-budget, plan-audit-sentinel, plan-rejection-ux, plan-duplicate-ux, plans-ux-accessibility, plans-wave2-ui, plans-visual, plan-form-visual, plan-detail-visual, plans-form-visual).
- TypeScript: 0 errors.

## Verdict

VISUAL CLOSURE COMPLETE — PLANS MODULE
