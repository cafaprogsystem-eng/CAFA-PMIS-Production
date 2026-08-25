---
name: Project Deletion Architecture
description: Status-aware permanent vs. soft delete policy for projects — schema, permissions, pure helper, cascade order.
---

## The Rule

- `projects.delete` permission: ED + PM only (super_admin via `*`). SC/TC/state roles cannot delete.
- Deletion mode is determined by `getProjectDeletionMode()` in `artifacts/api-server/src/lib/project-deletion.ts` — pure function, no DB.
- If project ever reached `approved`, `active`, or `closed` (current status OR approvals history) → **soft delete** (UPDATE, records preserved).
- Otherwise → **permanent delete** (hard cascade DELETE, records removed).

**Why:** Projects that reached Final Approval represent financed, reported-on real-world work. Their records must survive for audit/donor reporting. Pre-approval drafts never reached that threshold so permanent delete is safe.

## Schema (added via startup ALTER TABLE IF NOT EXISTS)

Four new nullable columns on `projects`:
- `deleted_at TIMESTAMPTZ`
- `deleted_by INTEGER`
- `deletion_reason TEXT`
- `deletion_mode TEXT`

All project list and detail queries filter `p.deleted_at IS NULL`.

## Protected Records (block permanent delete)

1. Activities with `budget_spent > 0`
2. Reports with `status != 'draft'`

## Permanent Delete Cascade Order (within transaction)

comments → notifications → project_localities → project_free_localities → project_assignments → project_documents → project_state_allocations → project_states → indicators (before outputs!) → activities → outputs → beneficiaries → risks → reports → approvals → projects

**NOTE:** `audit_log` rows are NEVER deleted — they survive permanent delete.

## Frontend

- `DeleteProjectDialog` component in `artifacts/cafa-pmis/src/components/delete-project-dialog.tsx`
- Fetches `/api/projects/:id/deletion-info` (canDelete + mode) when opened.
- Requires: reason (≥5 chars) + exact project code confirmation before submit is enabled.
- Shows mode-specific banner (permanent = red, soft = amber).
- Projects list: all projects show delete option in MoreHorizontal dropdown when `canDelete`.
- Project detail: "Delete" button always visible to authorised users (not gated by status).

## How to Apply

- Changing `FINAL_APPROVAL_STATUSES` requires updating `getProjectDeletionMode()` in both the server lib and the mirrored copy in `project-deletion.test.ts`.
- Any new relation on `project_id` must be added to the permanent delete cascade sequence.
