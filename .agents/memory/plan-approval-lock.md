---
name: Plan approval lock + reopen architecture
description: How the Final Approval lock works end-to-end: PATCH gate, last_final_approved_at, reopen endpoint, RBAC, and frontend behaviour.
---

## Rule
Once a plan reaches Final Approval, it is locked from direct editing until explicitly reopened via `POST /plans/:planId/reopen`.

## Key architecture

### DB
- `plans.last_final_approved_at TIMESTAMPTZ` — set when `final_approve` transition fires; **never cleared** (preserved through reopen so history stays intact).

### Authoritative editability helper: `isPlanCurrentlyEditable(planId, status, lastFinalApprovedAt)`
- If `last_final_approved_at` is null → status-based check (not in POST_APPROVAL_LOCKED_STATUSES).
- If `last_final_approved_at` is set → query `approvals` table for `action='reopen' AND created_at > last_final_approved_at`. No valid reopen → **locked regardless of current status**. Valid reopen → check status gate.
- When Plan is finally approved again `last_final_approved_at` advances; old reopen events predate it and no longer authorise editing.
- **The `approvals` table is the single source of truth** for reopen events. Audit Log is NOT used for this logic.
- PATCH endpoint reads both `status` and `last_final_approved_at` from DB before calling this helper.
- **Reopen endpoint uses the same helper** — the idempotency decision (alreadyEditable) is now governed by `isPlanCurrentlyEditable`, not by a naive `!POST_APPROVAL_LOCKED_STATUSES.has(status)` check. This prevents Case C (historically-locked pre-approval status) from incorrectly returning `alreadyEditable`.

### Three idempotency cases (Reopen endpoint)
- **Case A**: `last_final_approved_at` null + pre-approval status → `alreadyEditable: true`
- **Case B**: `last_final_approved_at` set + valid reopen event after it + pre-approval status → `alreadyEditable: true` (no duplicate approvals row or audit entry)
- **Case C**: `last_final_approved_at` set + pre-approval status + NO valid reopen event → NOT alreadyEditable; falls through to REOPENABLE_STATUSES gate

### `reopenGateG22` test mirror
Takes two optional extra params (`lastFinalApprovedAt`, `reopenEvents`) defaulting to the never-approved case. Existing 6-arg call-sites remain valid. Uses `isPlanCurrentlyEditableMirror` internally.

### Backend constants (plans.ts)
```
POST_APPROVAL_LOCKED_STATUSES = ["approved","active","in_progress","delayed","completed","cancelled","archived"]
REOPENABLE_STATUSES           = ["approved","active","in_progress","delayed"]  // excludes terminal
```

### PATCH gate
- Reads current status from DB **before** processing any field updates.
- If status ∈ POST_APPROVAL_LOCKED → 409 `plan_approval_locked` "This Plan is Approved and must be reopened before it can be edited."

### final_approve transition
- Special-cases `action === "final_approve"` to also `SET last_final_approved_at = NOW()`.
- All other transitions use the simpler UPDATE.

### POST /plans/:planId/reopen
- `requirePerm("plans.reopen")` — separate from `plans.update`, `plans.create`, `plans.delete`.
- Scope checks (sector + state) applied.
- Uses `SELECT ... FOR UPDATE` to prevent concurrent duplicate reopens.
- Idempotent: if status is already NOT in POST_APPROVAL_LOCKED → returns current plan with `alreadyEditable: true`.
- Terminal statuses (completed/cancelled/archived) → 409 `cannot_reopen_terminal`.
- Requires `reason` (non-empty string) in body.
- Sets `status = 'draft'`, writes `approvals` row with `action = 'reopen'`, writes audit log.
- Audit newValue = JSON with planCode, planTitle, reason, previousFinalApprovalDate, reopenedByRole.

### RBAC
- `plans.reopen` granted to: `super_admin` (via `*`), `executive_director`, `program_manager`.
- NOT granted to: senior_coordinator, technical_coordinator, state_program_officer, state_office_manager.
- Three fully separate capabilities: **Edit** (`plans.create`/`projects.create`), **Reopen** (`plans.reopen`), **Delete** (`plans.delete`).

### Frontend (plan-detail.tsx)
- `isApprovalLocked` = status ∈ POST_APPROVAL_LOCKED_STATUSES (declared AFTER useGetPlan — avoids TDZ).
- `isReopenable` = status ∈ REOPENABLE_STATUSES.
- Edit Plan button: shown only when `canEdit && !isApprovalLocked`.
- Reopen For Editing button: shown only when `canReopen && isReopenable`.
- Reopen dialog: title, copy, plan info card (code/title/status/lastFinalApprovedAt), required reason textarea, "Reopening…" pending state.
- Success toast: "Plan Reopened" + "{code} is now available for editing and will require approval again."
- "Previously Approved" / "Final Approval: date" hint in Section 1 view mode when `lastFinalApprovedAt` is set.

### API client
- `useReopenPlan` hook added to `lib/api-client-react/src/generated/api.ts` (manually, not orval-generated).
- Endpoint: `POST /api/plans/:planId/reopen`, body `{ reason: string }`, returns `PlanDetail`.

**Why:** Spec requirement — approved plans were silently editable because PATCH only checked `plans.update` with no status gate. Direct edit of an approved plan bypasses the governance record.
