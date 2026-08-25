---
name: Plan comment read-only exception
description: SPO/SOM (no comments.create) may read revision_request comments on their own state's returned-for-revision draft plan via a narrowly scoped GET /comments exception.
---

# Plan comment read-only exception (PLAN-012)

## Rule
In GET /comments, SPO and SOM lack comments.create. A narrowly scoped exception in the !canComment block grants them read-only access to revision_request comments on a plan when ALL hold:
1. entityType === "plan"
2. caller is state_program_officer or state_office_manager
3. req.currentUser.stateId != null (fail-closed if null, no DB query)
4. plans.state_id = req.currentUser.stateId
5. plans.status = 'draft'
6. EXISTS approval with action='request_revision' for the plan

Only comment_type = 'revision_request' rows are returned (least-privilege SELECT).

**Why:** All non-state roles have comments.create (permissionsFor pushes it for every role except SPO/SOM). SPO/SOM are plan authors in state operations but lack comment perms. Without this exception, the returned-for-revision banner in plan-detail.tsx is silently empty for state authors.

**How to apply:** The exception sits BEFORE the report exception (SPR-010/HQSR-005) in the !canComment block. If adding new entity types to comments, check whether any authors of that entity also lack comments.create and need a similar exception.

## Location
- Backend gate: artifacts/api-server/src/routes/comments.ts — GET /comments, !canComment block
- Frontend consumer: artifacts/cafa-pmis/src/pages/plan-detail.tsx — useQuery for revision banner
- Tests: artifacts/api-server/src/test/plan-comment-read-exception.test.ts (PLAN-COM-01..10)
