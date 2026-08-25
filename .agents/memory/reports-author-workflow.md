---
name: Reports author-based workflow
description: Two-path workflow for project/activity reports; SOM removal; migration 008 backfill guard.
---

## Core rule
Project and activity reports have two immutable authoring paths set at CREATE time:

- **state_authored** — SPO created. Mandatory TC review before SPC.
  `submitted → technically_approved → coordination_approved → approved`
- **technical_authored** — TC created. Self-review prevention; SPC receives directly.
  `submitted → coordination_approved → approved`

`program_state` and `hq_sector` use a fixed simple chain (author-independent).

## workflow_path column
- Added by migration 008 to the `reports` table.
- Set in INSERT based on author's role: `state_program_officer` → `state_authored`; everyone else → `technical_authored`.
- **Immutable after creation** — transitions never update workflow_path.
- `getProjectActivityWorkflow(workflowPath)` in `reportConstants.ts` returns the correct WorkflowActions.

## SOM removal
- `reports.approve.state` permission removed from SOM in `currentUser.ts`.
- `state_review` action and `state_reviewed` status removed from all active workflow definitions.
- `state_reviewed` removed from `AWAITING_APPROVAL_STATUSES` and `TOTAL_STATUSES` (now 3 and 6 items respectively).
- `state_reviewed` still visible in the frontend status badge map for legacy records (backward compat display only).

## Migration 008 backfill guard (critical)
The backfill of `author_id` from `submitted_by_id` **must use a JOIN** against `users`:
```sql
UPDATE reports r
   SET author_id = r.submitted_by_id
  FROM users u
 WHERE r.author_id IS NULL
   AND r.submitted_by_id IS NOT NULL
   AND u.id = r.submitted_by_id;
```
**Why:** Some historical reports have `submitted_by_id` pointing to deleted users. A plain `SET author_id = submitted_by_id` violates the FK constraint `reports_author_id_fkey` and crashes the migration.

## getRevisionPerm signature change
Now takes 3 args: `(reportType, fromStatus, workflowPath?)`.
- `state_authored` + `submitted` → `reports.approve.technical` (TC rejects back)
- `technical_authored` + any → `reports.approve.coordination`
- null/undefined defaults to `state_authored` (conservative)

## Test coverage
26 author-workflow regression tests added (AW-01 through AW-10 suites) in `reports-module.test.ts`. Total: 2303 passing.

## Historical integrity (Migration 009)
Migration 009 corrects two errors made by Migration 008:
1. **Restores state_reviewed** — uses approvals table evidence (`to_status='state_reviewed'`, no subsequent `submit`) to identify legitimate records and restores their status.
2. **Removes fabricated workflow_path** — resets `workflow_path = NULL` for project/activity records where `author_id IS NULL` (author unresolvable). The migration 008 catch-all that set `state_authored` for unknowns was incorrect.

## ACTIVE vs SUPPORTED status distinction
- `REPORT_ACTIVE_AWAITING_APPROVAL_STATUSES` — 3 items (no state_reviewed) — new workflow guards
- `REPORT_AWAITING_APPROVAL_STATUSES` — 4 items (includes state_reviewed) — dashboard KPI counting
- `REPORT_TOTAL_STATUSES` — 7 items (includes state_reviewed) — historical records must not be silently excluded
- `ACTIVE_AWAITING_APPROVAL_STATUSES_SQL` — active-only guard SQL
- `AWAITING_APPROVAL_STATUSES_SQL` — supported SQL for KPI queries

## Historical compatibility in STATE_AUTHORED_TRANSITIONS
`technical_review.from` includes `["submitted", "state_reviewed"]` — historical records in state_reviewed can be progressed by TC. No new report ever enters state_reviewed (no transition has it as a `to` target).

**How to apply:** Any future change to project/activity report approval logic must check `workflow_path`; never derive it from the current reviewer's role at transition time. Do not remove state_reviewed from TOTAL_STATUSES or AWAITING_APPROVAL_STATUSES — historical records may still exist there.
