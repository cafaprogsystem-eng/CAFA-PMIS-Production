# Projects Module — Residual Governance & Access Closure

**Scope:** PRJ-BD-02 / PRJ-021 (stage-aware reject/request_revision), PRJ-028 (SPO list/detail scope asymmetry), PRJ-036 (Donors GET permission)
**Status:** ✅ ALL THREE RESIDUALS CLOSED — nothing remains as "accepted residual" or awaiting a governance decision.
**Date:** 17 August 2026

---

## 1. PRJ-BD-02 / PRJ-021 — Stage-aware reject / request_revision — CLOSED

Governance decision (final): the permission required for the negative transitions
`reject` and `request_revision` is evaluated from the project's **current source
status**, so the reviewer who owns a stage can also close it negatively. The
former static mapping (both actions → `projects.approve.technical` only) is
removed.

### Final stage / action matrix

| Source status | Stage owner | approve (forward) | request_revision | reject |
|---|---|---|---|---|
| `submitted`, `state_reviewed` | Technical Coordinator | `technical_review` → `technically_approved` (`projects.approve.technical`) | `projects.approve.technical` | `projects.approve.technical` |
| `technically_approved` | Senior Programme Coordinator | `coordination_review` → `coordination_approved` (`projects.approve.coordination`) | `projects.approve.coordination` | `projects.approve.coordination` |
| `coordination_approved` | Programme Manager | `final_approve` → `approved` (`projects.approve.final`) | `projects.approve.final` | `projects.approve.final` |

### request_revision

- **Actors:** TC (technical stage), SPC (coordination stage), PM (final stage), plus PM/Super Admin via Full Operational Access.
- **Source states:** `submitted`, `state_reviewed`, `technically_approved`, `coordination_approved` (unchanged).
- **Target:** `draft` (same project ID; no new record is created).

### reject

- **Actors:** TC (technical stage), SPC (coordination stage), PM (final stage), plus PM/Super Admin via Full Operational Access.
- **Source states:** `submitted`, `state_reviewed`, `technically_approved`, `coordination_approved` (unchanged).
- **Target:** `rejected`.

### Full Operational Access result

PM and Super Admin (wildcard `*` / Full Operational Access per the global
governance rule) can perform `reject`/`request_revision` at **any** stage, but
the source-status validation is **never** bypassed: an invalid source status
(e.g. `final_approve` from `submitted`, or `reject` from `draft`) returns 400
with no workflow side effects (no status update, no approvals row, no audit
entry). Verified by PRJ-GOV-FULL-01..03 and PRJ-GOV-10.

Frontend parity: the Project detail action bar now renders approve, Request
Revision, and Reject per stage using the same stage-specific permission the
backend enforces, so each reviewer sees exactly the actions they hold at the
stage they own.

---

## 2. PRJ-028 — SPO list/detail scope asymmetry — CLOSED

**State list scope (final):** for state roles (SPO/SOM), `GET /projects` now
filters with:

```sql
( EXISTS (SELECT 1 FROM project_states ps
          WHERE ps.project_id = p.id AND ps.state_id = $stateId)
  OR EXISTS (SELECT 1 FROM project_assignments pa
             WHERE pa.project_id = p.id AND pa.user_id = $currentUserId) )
```

This matches `assertStateAllowed` (detail/mutation access), which already
accepted either path — eliminating the invisible-but-accessible project.

**Assignment security confirmation:** `project_assignments` is user-specific
(`user_id` column, no `state_id`). The added clause binds **only the current
caller's user id**, so a same-State peer cannot inherit visibility through
another user's assignment (verified by PRJ-STATE-LIST-03). SOM semantics are
unchanged; state roles with a NULL state fail closed with an empty list and no
query (PRJ-STATE-LIST-05); a `?stateId` query parameter cannot widen a state
role's clamp (PRJ-STATE-LIST-04). List/detail parity verified by
PRJ-STATE-LIST-06.

---

## 3. PRJ-036 — Donors GET explicit permission — CLOSED

**Final state:** `GET /projects/donors` is guarded by
`requirePerm("projects.view")` — the narrowest project-domain read permission.
`projects.view` is granted to every role that legitimately references donors
when creating, editing, or reviewing projects (Executive Director, Programme
Manager, Senior Programme Coordinator, Technical Coordinator, State Office
Manager, State Programme Officer, Viewer; Super Admin via `*`). Unauthenticated
callers receive 401; authenticated roles without any project-domain access
(e.g. an unrecognised role) receive 403. The response remains clean reference
data only: `id, name, abbreviation, country, contactName, contactEmail,
createdAt` (verified byte-for-byte by PRJ-DONOR-05).

---

## 4. Files changed

- `artifacts/api-server/src/routes/projects.ts` — stage-aware permission function + deferred permission check for `reject`/`request_revision`; user-scoped `project_assignments` OR-clause and NULL-state fail-closed guard in the list handler; `requirePerm("projects.view")` on `GET /donors`.
- `artifacts/api-server/src/middlewares/currentUser.ts` — `projects.view` granted to all project-domain roles (PRJ-036).
- `artifacts/cafa-pmis/src/pages/project-detail.tsx` — stage-specific Request Revision / Reject action entries mirroring backend permissions.
- `artifacts/api-server/src/test/prj-governance-access.test.ts` — new (24 tests).
- `docs/audit-reports/projects-governance-access-closure.md` — this document.
- `docs/audit-reports/projects-final-closure-audit.md`, `projects-residual-functional-gap-reconciliation.md` — residual entries updated to CLOSED.

## 5. Test totals

- `prj-governance-access.test.ts`: **24/24 pass** — PRJ-GOV-01..10 (10 workflow), PRJ-GOV-FULL-01..03 (3 Full Access), PRJ-STATE-LIST-01..06 (6 state list), PRJ-DONOR-01..05 (5 donor).
- Full api-server suite: **61 files, 1,588 tests pass** (no regressions).

## 6. TypeScript result

`tsc --noEmit` introduces **no new errors** from this change. The only
remaining diagnostics are pre-existing and unrelated (reports/risks/plans —
tracked separately by the pre-existing type-errors task).

## 7. Closure confirmation

| Item | Status |
|---|---|
| PRJ-BD-02 / PRJ-021 — stage-aware reject/request_revision | ✅ CLOSED (governance decision implemented; no longer pending) |
| PRJ-028 — SPO list/detail scope asymmetry | ✅ CLOSED |
| PRJ-036 — Donors GET explicit permission | ✅ CLOSED |
