---
name: Global Full Operational Access
description: PM and super_admin have system-wide operational access; override audit trail; privacy/accounting boundaries
---

## Rule
`program_manager` and `super_admin` may perform any operationally valid action — create, view, edit, submit, review, approve, return, reject, archive, delete — across all CAFA PMIS modules.

**Why:** Governance decision. All other roles remain scoped (state/sector/project).

## Backend helper
`hasFullOperationalAccess(user)` in `src/lib/accessControl.ts` — returns true for PM and super_admin. Use this everywhere instead of `role === "super_admin"` in ownership guards.

## PM permissions granted
In addition to pre-existing permissions, PM has:
- `plans.update`, `plans.approve.coordination`, `plans.approve.technical`, `plans.approve.final`
- `projects.approve.coordination`, `projects.approve.technical`
- `reports.create/update/delete`, `reports.approve.coordination/technical/final`
- `plans.create`, `projects.create/update`, `documents.upload/view`
- `risks.create/update`, `comments.create`, `messages.create/send/manage_members`
- `manual.edit/edit.content`, `program_resources.upload/edit/delete`

## Ownership bypasses
Use `hasFullOperationalAccess` (not role === super_admin) in route guards for: draft edit, draft delete, comment delete/resolve, attachment mutation, conversation member checks. `author_id`/`created_by_id` fields are never mutated.

## Conversation access pattern
Non-DM conversations (group/project/state/sector/announcement): PM/super_admin bypass via `assertMemberOrFullAccess()`. GET /conversations list uses LEFT JOIN + WHERE for full-access users. GET /conversations/unread-count stays membership-only (notification badge). DM privacy always enforced.

## Override / self-review
PM/super_admin may self-review reports they authored but MUST supply `overrideReason` in the request body. Without it → 400 `override_reason_required`. Stored in `approvals.used_override` + `approvals.override_reason` (migration 020). Displayed as amber "Override" badge in report approval history and audit log UIs.

## Frontend gate
`VALID_PROJECT_REPORT_AUTHOR_ROLES` in reports.tsx includes `program_manager`. `canAuthorHqSectorReport` and `canAuthorProgramStateReport` in permissions.ts also include PM.

## Documented exceptions (NOT bypassed)
- Data integrity: required fields, identity immutability, duplicate constraints, workflow step order
- User mutations (create, edit, status, delete, invites, password reset): super_admin only — privilege-escalation boundary
- Private DMs: membership always required regardless of role
- Budget/accounting segregation unchanged

**How to apply:** Any new route with owner-only or super-admin-only guard must call `hasFullOperationalAccess(req.currentUser)` for the bypass unless it is a listed exception. Full spec in `docs/audit-reports/global-full-operational-access-governance.md`.
