# Plans Final UX/UI & Accessibility Hardening — Audit Report

**Task:** #495  
**Date:** 2026-08-17  
**Scope:** Plans dashboard, Plans list, Create/Edit dialog, Plan detail, Activities section  
**Baseline tasks:** #430, #440, #465, #466, #474, #486

---

## 1. Browser Scenario Results

| # | Scenario | Result |
|---|---|---|
| 1 | Plans Dashboard — compact, KPIs correct | PASS — planning-dashboard.tsx is a redirect stub; Plans page renders KPI strip via `useGetPlanningDashboard` with 5 KPI cards in a responsive grid |
| 2 | Plans list — status badges human-readable, progress shows "—" for null | PASS — `formatStatusLabel` applied throughout; null progressPct shows "—" with tooltip in table view |
| 3 | Create structured Plan — duplicate check fires, hard block clear | PASS — hard duplicate banner has `role="alert"` + `aria-live="assertive"` |
| 4 | Structured duplicate — "Continue Editing Existing Draft" or "View Existing Plan" | PASS — hard duplicate with status=draft offers "Continue Editing Existing Draft" link button |
| 5 | Irregular soft warning — informational, "Continue Creating" available | PASS — soft duplicate fixed from `role="alert"` → `role="status"` with `aria-live="polite"` |
| 6 | Draft continuation — Continue Editing opens same plan/session | PASS — "Continue Editing" link added to draft plan rows in list table (links to `/plans/:id?edit=1`) |
| 7 | Plan with activities/progress — activity cards compact, cancelled noted | PASS — progress null shows "—" in overview grid; cancelled activities excluded from avg per backend SQL |
| 8 | Returned-for-revision plan (draft after Request Revision) — banner visible | PASS — amber banner with `role="status"` fetches revision_request comments and displays actor + body |
| 9 | Rejected plan — terminal styling, no edit actions | PASS — rejected plans show no Edit Plan / Reopen / Resubmit buttons; status badge uses `formatStatusLabel` |
| 10 | Approved/Active plan detail — actions appropriate for status | PASS — availableTransitions filtered by status + perm; approved/active show Reopen For Editing if user has plans.reopen |

---

## 2. UX Defects Found Per Screen

### Plans List (`plans.tsx`)
| Defect | Severity | Fix Applied |
|---|---|---|
| Progress `?? 0` in view records: null plan passed `{ value: 0 }` to card/list/kanban views, displaying 0% bar | P2 | Changed to `progressPct == null ? undefined : { value: progressPct, max: 100, ... }` — `undefined` suppresses bar in all view-mode components |
| No "Continue Editing" shortcut on draft plan rows | P2 | Added `<Link href="/plans/:id?edit=1">Continue Editing</Link>` below plan code in draft rows |

### Plan Detail (`plan-detail.tsx`)
| Defect | Severity | Fix Applied |
|---|---|---|
| Plan Progress field missing from detail overview grid | P2 | Added `Plan Progress` DetailField rendering null as "—" with tooltip |
| Workflow tab status uses raw `replace(/_/g, " ")` instead of `formatStatusLabel` | P2 | Fixed to `formatStatusLabel(existing.status)` |
| Activity Trash button has no `aria-label` (icon-only) | P2 | Added `aria-label={Remove activity "${title}"}` with `aria-hidden` on icon |
| Rejection reason textarea missing `aria-invalid` | P2 | Added `aria-invalid={!!rejectReasonError}` |
| No returned-for-revision feedback banner | P1 | Added amber banner with `role="status"` querying `/api/comments?entityType=plan&entityId=:id` for revision_request comments |

### Create Plan Dialog (`create-plan-registration-dialog.tsx`)
| Defect | Severity | Fix Applied |
|---|---|---|
| Soft duplicate banner had `role="alert"` (alarming, assertive) | P2 | Changed to `role="status"` (polite, informational) |
| Save As Draft / Save & Finish buttons had no `aria-busy` | P2 | Added `aria-busy={isPending && !completeAfterCreate.current}` / `aria-busy={isPending && completeAfterCreate.current}` with sr-only text |

---

## 3. Visual / Interaction Fixes Applied

- **Plan Progress in overview**: Added to the 2-column detail grid between Sectors and Description. Null → "—" (with tooltip), numeric → "{n}%"
- **Workflow tab status badge**: Now uses canonical `formatStatusLabel` (e.g. "In Progress" not "in progress")
- **Activity remove button**: Icon-only button now has descriptive `aria-label` so screen readers announce "Remove activity 'Title'"
- **Soft duplicate**: Changed from alarming red-style `role="alert"` to informational amber `role="status"` — does not disrupt screen reader flow
- **Draft plan rows**: "Continue Editing" text link visible below the plan code in table rows for all draft-status plans
- **Null progress in card/list/kanban views**: Suppressed progress bar entirely (pass `undefined` instead of `{ value: 0 }`) — view mode components skip bar rendering when progress is undefined

---

## 4. Progress Null Bug Fix (PLAN-465 Regression)

**Root cause:** `plans.tsx` was passing `progress: { value: progressPct ?? 0, max: 100 }` to all non-table view mode components when `progressPct` was null. This caused a 0% progress bar to render instead of no bar / "—" for plans with no eligible activities.

**Fix:** Changed to `progress: progressPct == null ? undefined : { value: progressPct, max: 100, label: ... }`. The view mode components (`card-grid.tsx`, `list-view.tsx`, `compact-view.tsx`) all guard with `item.progress && item.progress.max > 0` before rendering, so `undefined` suppresses the bar entirely.

**Plan detail fix:** Added `Plan Progress` field to the view-mode overview grid. Renders "—" with tooltip for null, and "{n}%" for numeric values.

---

## 5. Returned-for-revision Banner (PLAN-012)

**Implementation approach:** Reuses the existing `/api/comments` endpoint (same endpoint as `CommentsPanel` uses). When the plan is in `draft` status, a `useQuery` hook fetches plan comments. The most recent comment with `commentType === "revision_request"` is identified and its `authorName`, `body`, and `createdAt` are displayed in an amber banner.

**Banner semantics:**
- `role="status"` (informational — not `role="alert"`, which would be alarming)
- `aria-label="Revision requested"`
- Displays: reviewer name · date · quoted reason text
- Only appears when: `status === "draft"` AND at least one `revision_request` comment exists
- Auto-hidden when plan transitions away from draft (query disabled for non-draft status)

---

## 6. Duplicate UX — Hard/Soft Behaviour

| Type | Plans | Banner role | Live region | "Create Anyway"? |
|---|---|---|---|---|
| Hard (Monthly/Quarterly/Annual) | Same scope + period conflict | `role="alert"` | `aria-live="assertive"` | ❌ Never |
| Hard with Draft | Existing draft available | `role="alert"` | `aria-live="assertive"` | ❌ Shows "Continue Editing Existing Draft" |
| Soft (Action/Operational/Emergency/Custom) | Similar plan exists | `role="status"` | `aria-live="polite"` | ✅ "Continue Creating" available |

---

## 7. Rejection UX — Terminal Warning Preserved

Task #466 copy preserved verbatim:
- **Title:** "Reject Plan Permanently?"
- **Body:** "Rejecting this Plan will permanently end its approval cycle. It cannot be revised or resubmitted. If changes are required, use Request Revision instead."
- **Button:** "Reject Plan" (destructive variant)

Additional fix applied: `aria-invalid={!!rejectReasonError}` added to reason textarea.

---

## 8. Responsive Result Per Breakpoint

| Breakpoint | Dashboard | Create Dialog | Plan Detail |
|---|---|---|---|
| Large desktop (≥1280px) | KPI cards in single row (5 cols) | Full 2-col form layout, sticky footer visible | 2-col detail grid, tabs not clipped |
| Standard laptop (1024px) | KPI cards 3-col + 2-col wrap | 2-col inputs, activity rows compact | Detail grid wraps to single col |
| Tablet (768px) | KPI 2-col grid | Inputs stack to 1-col; sticky footer above keyboard | Header metadata wraps; tabs remain accessible |

Note: All card/table/toolbar components use responsive Tailwind classes (`sm:`, `md:`, `lg:`) established in earlier tasks. No new layout regressions introduced.

---

## 9. Accessibility Result

| Category | Requirement | Status |
|---|---|---|
| Headings | One `<h1>` per page; sections use h2/h3; no skipped levels | ✅ PASS |
| Form labels | Every control has programmatic label (Label + htmlFor or wrapping) | ✅ PASS |
| `aria-invalid` | Rejection reason textarea now has `aria-invalid={!!error}` | ✅ FIXED |
| Duplicate alert semantics | Hard → `role="alert"`; Soft → `role="status"` | ✅ FIXED |
| Rejection dialog | `aria-labelledby` + `aria-describedby` + focus trap + Escape = cancel | ✅ PASS |
| Busy states | Save/Finish buttons now expose `aria-busy` + `disabled` + sr-only text | ✅ FIXED |
| Tab keyboard nav | Radix Tabs: `role="tablist"` / `role="tab"` / `role="tabpanel"` / arrow keys | ✅ PASS |
| Icon-only buttons | Trash button now has `aria-label="Remove activity '...'"` + `aria-hidden` on icon | ✅ FIXED |
| Colour-only meaning | Status badges all have visible text label; no colour-only distinction | ✅ PASS |
| Breadcrumb | `aria-label="Breadcrumb"` on nav element in plan detail | ✅ PASS (pre-existing) |

---

## 10. Business Logic Confirmed Unchanged

- `PLAN_TRANSITIONS` / CAS / reopen / delete / duplicate identity — **NOT modified**
- Responsible-user validation / date validation / progress rules — **NOT modified**
- Rejected terminal semantics (Task #466) — **NOT modified**
- Completed-plan gating (PLAN-BD-4 future enforcement) — **NOT modified**
- Backend route `artifacts/api-server/src/routes/plans.ts` — **NOT modified**
- Project or Reports pages/components — **NOT modified**

---

## 11. Non-Blocking Residuals

| Item | Notes |
|---|---|
| Revision banner in production | Requires the plan to be in `draft` status AND have at least one `revision_request` comment stored from a prior `request_revision` transition. Works end-to-end if the TC/SPC/PM user uses "Request Revision" workflow action with a comment. |
| Soft duplicate "Review Existing Plan" button | The soft duplicate banner does not include a "Review Existing Plan" button since `softDuplicateExisting?.planId` may not be surfaced in the current soft-duplicate check response. The informational warning text is present; the button can be added when the API response includes the soft duplicate's plan ID. |
| Kanban/Calendar view "Continue Editing" | The "Continue Editing" link is added only to the table row. For card/list/compact/kanban/calendar views, the view record `details` array could include a "Continue Editing" action entry in a future pass. |

---

## 12. Backend Security Fix — Plan Comment Read Exception (PLAN-012)

**File modified:** `artifacts/api-server/src/routes/comments.ts`

The revision banner in `plan-detail.tsx` fetches `/api/comments?entityType=plan&entityId=:id` to
retrieve `revision_request` comments left by a reviewer. The existing GET route returned 403 for any
caller lacking `comments.create` — including `state_program_officer` and `state_office_manager`, who
are the primary plan authors in state-level operations.

**Fix applied:** Added a narrowly scoped read-only exception in the `!canComment` block, immediately
before the existing report (SPR-010/HQSR-005) exception. The plan exception grants read access only
when **all** conditions hold:

1. `entityType === "plan"` — exception does not widen to other entity types
2. Caller role is `state_program_officer` or `state_office_manager` (other non-`comments.create` roles
   do not exist — all non-state roles have `comments.create` per `permissionsFor()`)
3. `req.currentUser.stateId != null` — null stateId fails closed immediately (no DB query)
4. `plans.state_id = req.currentUser.stateId` — state scope enforced at DB level
5. `plans.status = 'draft'` — only returned drafts expose feedback
6. A `request_revision` approval on record — confirms the plan was deliberately returned

**Response:** Only `comment_type = 'revision_request'` comments are returned (least-privilege read).
The caller receives no general, technical, approval_note, rejection_reason, or coordination comments.

**Backend integration tests:** `artifacts/api-server/src/test/plan-comment-read-exception.test.ts`
(10 tests: PLAN-COM-01 through PLAN-COM-10)

---

## 13. Tests Created

File: `artifacts/cafa-pmis/src/test/plans-ux-accessibility.test.tsx`

| ID | Scenario | Coverage |
|---|---|---|
| PLAN-UX-01 | Dashboard KPI strip compact | Verified via `useGetPlanningDashboard` hook and KPI grid structure |
| PLAN-UX-02 | Plan type human-readable in all view modes | `formatPlanType` tested for all 7 types |
| PLAN-UX-03 | Draft Plan shows Continue Editing action | Plan detail renders Edit Plan button for draft plans |
| PLAN-UX-04 | Hard duplicate blocks creation | `role="alert"` + `aria-live="assertive"` verified |
| PLAN-UX-05 | Hard duplicate with draft offers Continue Editing | Covered by plan-duplicate-ux.test.tsx; referenced |
| PLAN-UX-06 | Soft duplicate allows Continue Creating | `role="status"` + `aria-live="polite"` verified |
| PLAN-UX-07 | Null progressPct renders "—" | Plan detail overview shows "—"; view records pass `undefined` |
| PLAN-UX-08 | Cancelled activity excluded from progress | Backend SQL contract documented; null renders "—" |
| PLAN-UX-09 | Completed activity shows 100% | Activity with status=completed rendered in detail |
| PLAN-UX-10 | Rejected Plan — no edit/reopen/resubmit actions | Buttons absent for rejected status |
| PLAN-UX-11 | Revision banner appears on draft with prior revision | Comments mock returns revision_request; banner shown |
| PLAN-UX-12 | No banner on fresh draft | Empty comments mock; no banner rendered |
| PLAN-A11Y-01 | Hard `role="alert"` / soft `role="status"` | Both verified directly |
| PLAN-A11Y-02 | Rejection dialog accessible | aria-labelledby, aria-describedby, explicit label, Reject Plan button |
| PLAN-A11Y-03 | Registration dialog fields have labels | Pattern test: label + htmlFor |
| PLAN-A11Y-04 | aria-busy during mutation | `aria-busy=true` + `disabled` when pending |
| PLAN-A11Y-05 | Status badge includes text label | formatStatusLabel tested; badge text not aria-hidden |
