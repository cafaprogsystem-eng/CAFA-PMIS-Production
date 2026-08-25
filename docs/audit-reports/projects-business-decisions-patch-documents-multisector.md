# Project Business Decisions: PATCH Preservation, Document Lifecycle, Multi-Sector TC Scope
## Decisions: PRJ-BD-03, PRJ-BD-04, PRJ-BD-05
## Date: 2026-08-17

---

## 1. Executive Decision Summary

Three Project module gaps were confirmed and deferred from earlier audits (Task #415, Task #426)
pending explicit business decisions. This document closes all three with authoritative, binding
decisions and specifies the exact implementation contract each decision imposes.

| Ref | Topic | Status |
|---|---|---|
| PRJ-BD-03 | PATCH full delete+reinsert silently zeros `budget_spent` on every content edit | **CLOSED — ID-based carry-forward required** |
| PRJ-BD-04 | Document lifecycle has no post-approval immutability or upload/delete gates | **CLOSED — status-gated rules defined** |
| PRJ-BD-05 | TC list scope uses union (primary+secondary), detail uses primary only → 403 mismatch | **CLOSED — union scope required for both** |

All three decisions are **actor-independent data-integrity rules**. Full Operational Access
(Task #373 / migration 020) does not exempt PM or Super Admin from these rules — the rules
prevent silent financial data loss, governance record loss, and access contradictions, not
merely permission enforcement.

---

## 2. Evidence Reviewed

Code read and verified at `artifacts/api-server/src/routes/projects.ts` and
`artifacts/api-server/src/middlewares/currentUser.ts`. Specific findings below.
All line references were verified against the current codebase; they may drift as code evolves.

### Verified items
- PATCH handler at `router.patch("/projects/:projectId")` (line ~1070) performs full
  delete+reinsert of all nested data including `activities` (line ~1216).
- Activity INSERT (line ~1296–1306) omits `budget_spent`; DB default is `0`.
- PATCH is already gated to `status = 'draft'` only (line ~1079).
- `assertSectorAllowed` (currentUser.ts line 36–41) checks only the primary `sector` field.
- `tcSectorRestriction` returns `u.sectors ?? []` — the user's sector assignments.
- List scope (projects.ts line ~283–284) uses union of primary + `sectors[]` jsonb array.
- Document delete endpoint (line ~1834) has **no project status check** but IS logged to
  `audit_log` via `logAudit` (lines ~1850–1856, action `"document_delete"`).
- Document upload endpoint (line ~1518) has no project status check; IS logged via
  `logAudit` (line ~1554, action `"document_upload"`).

### Correction from scouted evidence
The scouted brief stated "Document deletion is NOT logged to audit_log". This is **incorrect**
in current code — both upload and delete are already logged. The gap is therefore limited to:
the absence of **project-status gates** on delete and upload, and the absence of a **full-freeze**
rule for completed/archived projects.

---

## 3. PRJ-BD-03: Current Behaviour

The PATCH handler for `/projects/:projectId` (restricted to `status = 'draft'`) executes a
full delete+reinsert cycle for all nested data every time a project is saved:

```sql
DELETE FROM activities           WHERE project_id = $1;
DELETE FROM indicators           WHERE project_id = $1;
DELETE FROM outputs              WHERE project_id = $1;
DELETE FROM project_states       WHERE project_id = $1;
DELETE FROM project_state_allocations WHERE project_id = $1;
DELETE FROM project_free_localities   WHERE project_id = $1;
DELETE FROM project_assignments  WHERE project_id = $1;
DELETE FROM project_documents    WHERE project_id = $1;
```

The subsequent `INSERT INTO activities` does not include `budget_spent`:

```sql
INSERT INTO activities
  (project_id, output_id, indicator_id, state_id, locality_name,
   code, title, description, target, status, planned_start, planned_end, budget_planned)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
```

Result: every PATCH silently resets `budget_spent` to `0` for every activity, regardless of
what was previously recorded.

---

## 4. PRJ-BD-03: Options

**Option A — Omit budget_spent from PATCH entirely (client never touches it)**
Activities carry a stable `id SERIAL PRIMARY KEY`. The PATCH body could exclude
`budget_spent`; before deletion, load a map `{ activityId → budget_spent }` from the DB
and restore each value after reinsert where the client supplied a matching ID.
*Pros:* preserves financial data without changing the client contract.
*Cons:* requires ID-round-tripping from the client.

**Option B — Add a dedicated `/activities/:id/budget_spent` mutation endpoint**
Separate financial tracking from content editing. PATCH never touches `budget_spent`;
a separate endpoint controls it with its own permission checks.
*Pros:* cleanest separation of concerns.
*Cons:* larger implementation surface; does not fix the current erasure problem.

**Option C — Include `budget_spent` in the PATCH body and persist it**
Extend the activity body schema to accept `budgetSpent`, default `0` for new records.
*Pros:* simplest implementation.
*Cons:* exposes financial data to routine content editors; violates maker/checker principle
if budget tracking requires a separate authorisation.

**Option D — Accept the current behaviour (no change)**
*Rejected:* `budget_spent` is a stored expenditure field with no other source; erasure is
not recoverable from any other table or log.

---

## 5. PRJ-BD-03: Final Decision

**Option A — ID-based carry-forward.**

Before deleting activities, the PATCH handler MUST:
1. Load all current `{ id, budget_spent }` pairs for the project:
   `SELECT id, budget_spent FROM activities WHERE project_id = $1`
2. Build an in-memory map `existingSpent: Map<number, number>`.
3. Delete and reinsert activities as today.
4. For each reinserted activity whose client-supplied body included an `id` that exists
   in `existingSpent`, issue:
   `UPDATE activities SET budget_spent = $1 WHERE id = $2`
   using the preserved value.
5. Newly created activities (no prior ID or ID not in map) default to `budget_spent = 0`.

The client MUST round-trip the existing activity `id` in each activity object in the PATCH
body for carry-forward to apply. Activities without an `id` in the body are treated as new.

This rule is actor-independent: PM and Super Admin saving a project edit cannot bypass
carry-forward.

---

## 6. budget_spent Source-of-Truth

- Table: `activities` (column `budget_spent NUMERIC(14,2) NOT NULL DEFAULT 0`).
- This field is **stored expenditure data**, not derived or computed from any other table.
- No other endpoint currently mutates `budget_spent` directly (verified in routes/projects.ts).
- The audit log does not contain per-activity spend history; if erased, the value is **gone**.
- `budget_spent` appears in the Budget tab aggregation:
  `COALESCE(SUM(budget_spent), 0)::float AS spent` (line ~188)
  and in the project finance summary KPI (line ~1044).
- A dedicated spend-mutation endpoint (Option B) remains a recommended future enhancement
  but does not replace the carry-forward requirement.

---

## 7. Activity Matching / Preservation Contract

| Scenario | Carry-forward applied? | Starting budget_spent |
|---|---|---|
| Client sends activity with `id` that exists in DB | YES | Previous stored value |
| Client sends activity with `id` not in DB (stale) | NO | `0` |
| Client sends activity without `id` (new) | NO | `0` |
| Client sends no activities | n/a — all deleted | n/a |

The carry-forward applies exclusively to the `budget_spent` column. All other activity fields
(title, description, targets, dates, status) are replaced by the PATCH body as today.

---

## 8. PRJ-BD-04: Current Document Lifecycle

- Documents are inserted via `POST /projects/:projectId/documents` (requirePerm `documents.upload`).
- Documents are deleted via `DELETE /projects/:projectId/documents/:documentId`.
- Both endpoints check sector and state scope (`assertSectorAllowed`, `assertStateAllowed`).
- Neither endpoint checks the project's current `status`.
- Both endpoints log to `audit_log` (actions `document_upload`, `document_delete`).
- Document categories: `agreement | budget | optional`.
- Categories `agreement` and `budget` are required for `final_approve` (project workflow gate).
- No immutability rules or status gates exist today.

---

## 9. PRJ-BD-04: Options

**Option A — No lifecycle gates (status quo)**
*Rejected:* governance documents (agreement, budget) can be deleted from approved or active
projects without restriction, undermining maker/checker audit integrity.

**Option B — Soft warning only**
Display a warning when deleting a document from a non-draft project; allow deletion.
*Rejected:* warnings are suppressible and leave the data gap unresolved.

**Option C — Status-gated rules with PM/Super Admin emergency path**
After approval: block ordinary delete of existing documents; permit additional uploads.
At completion/archive: full freeze — block new uploads AND deletes.
PM/Super Admin emergency deletion: permitted but must use an explicit override endpoint
that writes a mandatory reason to the audit log.
*Accepted.*

---

## 10. PRJ-BD-04: Final Decision

**Option C — Status-gated document mutation rules.**

The document delete endpoint (`DELETE /projects/:projectId/documents/:documentId`) MUST:
1. Fetch the project's current `status` alongside the sector check.
2. Return **409 Conflict** if `status` is not `draft` and the requesting user does NOT
   hold PM/Super Admin full-operational-access.
3. If PM/Super Admin: permit deletion but require the request body to contain `overrideReason`
   (non-empty string); log it to `audit_log` with action `document_delete_override`.

The document upload endpoint (`POST /projects/:projectId/documents`) MUST:
1. Return **409 Conflict** if `status` is `completed` or `archived` (full-freeze statuses).
2. For all other non-draft statuses (`submitted`, `technically_approved`,
   `coordination_approved`, `approved`, `active`): permit the upload and log normally
   (already done today).

These rules are actor-independent data-integrity rules. The override path for PM/Super Admin
is explicit and audited — not a silent bypass.

---

## 11. Post-Approval Document Rules

Post-approval statuses for this rule: `approved`, `active` (and earlier non-draft statuses
`submitted`, `technically_approved`, `coordination_approved`).

| Operation | Standard user | PM / Super Admin |
|---|---|---|
| Upload new document | ✅ Permitted (logged) | ✅ Permitted (logged) |
| Delete existing document | ❌ Blocked (409) | ✅ With `overrideReason`, logged as `document_delete_override` |
| Replace existing document | ❌ Blocked (delete step → 409) | ✅ With `overrideReason` |

---

## 12. Completed/Archived Document Rules

Full-freeze statuses: `completed`, `archived`.

| Operation | All users including PM / Super Admin |
|---|---|
| Upload new document | ❌ Blocked (409) |
| Delete existing document | ❌ Blocked (409) |

Emergency access for genuinely frozen projects must go through an explicit reactivation
workflow (returning the project to an earlier status), not through a document override path.

---

## 13. PRJ-BD-05: Current Scope Mismatch

**List endpoint** (`GET /projects`, line ~283–284) applies TC scope as:

```sql
(p.sector = ANY($N::text[]) OR EXISTS (
  SELECT 1 FROM jsonb_array_elements_text(COALESCE(p.sectors,'[]'::jsonb)) s
  WHERE s = ANY($N::text[])
))
```

This is a **union** of the primary sector column and the `sectors[]` jsonb array — correct.

**Detail endpoint** (`GET /projects/:id`, and all mutation endpoints) calls:

```typescript
assertSectorAllowed(req, sector)
// where sector = SELECT sector FROM projects WHERE id = $1  (primary only)
```

`assertSectorAllowed` implementation (currentUser.ts line 36–41):

```typescript
export function assertSectorAllowed(
  req: Request, sector: string | null
): { ok: true } | { ok: false; status: number; body: object } {
  const restriction = tcSectorRestriction(req);
  if (!restriction) return { ok: true };
  if (sector && restriction.includes(sector)) return { ok: true };
  return { ok: false, status: 403, body: { error: "sector_forbidden" } };
}
```

`restriction` is `u.sectors` (the TC's assigned sectors). Only the project's **primary**
`sector` column is checked against `restriction`. The secondary `sectors[]` jsonb array is
not consulted.

**Confirmed mismatch:** A TC assigned to a secondary sector (present in `sectors[]` but not
in `sector`) will see the project in GET /projects but receive 403 on GET /projects/:id.

---

## 14. PRJ-BD-05: Options

**Option A — Check only primary sector for both list and detail**
Remove the union from the list query; detail is already primary-only.
*Rejected:* discards intentional secondary-sector assignment data; makes TC scope narrower
than the data model implies.

**Option B — Check union for both list and detail (symmetric)**
Update `assertSectorAllowed` (or a project-specific variant) to receive both `sector` and
`sectors[]` and check `restriction` against the union.
*Accepted.*

**Option C — Separate `assertSectorAllowed` for projects vs other entities**
Add `assertSectorAllowedForProject(req, primarySector, sectorsArray)` that applies union
logic only to projects. Other entities (reports, risks) continue using primary-only.
*Variant of Option B — recommended implementation form.*

**Option D — Accept the mismatch (no change)**
*Rejected:* the bug actively prevents TCs from performing their assigned function on
multi-sector projects; it is a genuine access defect.

---

## 15. PRJ-BD-05: Final Decision

**Option B/C — Union scope for all Project read and write endpoints.**

The effective Project Sector of a project is defined as the **union** of its `sector` column
and all elements of its `sectors[]` jsonb array, using canonical exact-match strings.

The implementation MUST:
1. Add `assertSectorAllowedForProject(req, primarySector, sectorsArray: string[])` in
   `currentUser.ts` (or extend `assertSectorAllowed` to accept an optional array argument).
2. The function checks: `restriction.some(r => r === primarySector || sectorsArray.includes(r))`.
3. Update every `GET /projects/:id`-family endpoint that currently calls
   `assertSectorAllowed(req, sector)` using a single primary-sector value to call the new
   function, passing both `sector` and `sectors`.
4. The projects detail query must `SELECT sector, sectors` (currently selects `sector` only).
5. List scope in `GET /projects` already uses union — no change required there.
6. All mutation endpoints that guard with `assertSectorAllowed` similarly must adopt the union.

This is actor-independent: the union check applies to all TC-scoped reads and writes uniformly.

---

## 16. Effective Project Sector Definition

The **Effective Project Sector** for TC scope decisions is:

```
effectiveSectors(project) = { project.sector } ∪ { s | s ∈ project.sectors[] }
```

Using canonical exact-match (case-sensitive, no wildcards, no ILIKE).

A TC is permitted to read or mutate a project if and only if:

```
tcSectorRestriction(req) ∩ effectiveSectors(project) ≠ ∅
```

Blank or null values in either field are not treated as matches:
- `project.sector = null` → not in the effective set.
- `project.sectors = []` → contributes no elements.
- A TC with `sectors = []` → `restriction = []` → no intersection → **fail-closed**.

---

## 17. TC Read/Write Boundary

After the PRJ-BD-05 fix, TC access to a project is governed by:

| Condition | Access result |
|---|---|
| TC's assigned sectors ∩ effectiveSectors(project) ≠ ∅ | Permitted (read + write per existing perms) |
| TC's assigned sectors ∩ effectiveSectors(project) = ∅ | 403 sector_forbidden |
| TC has `sectors = []` (empty assignment) | 403 fail-closed |
| Project has `sector = null` AND `sectors = []` | 403 fail-closed |

TC permissions granted (`projects.create`, `projects.update`, `projects.approve.technical`,
`budget.*`, `reports.*`) remain unchanged. The fix affects only the sector scope gate,
not the permission set.

---

## 18. Full Operational Access Impact

Full Operational Access (Task #373, migration 020) grants PM and Super Admin system-wide
access via `accessControl.ts` — overriding sector and state restrictions.

All three decisions are **actor-independent data-integrity rules**, not permission gates:

- **PRJ-BD-03:** PM/Super Admin saving a project still triggers the carry-forward. The rule
  prevents silent financial erasure regardless of actor.
- **PRJ-BD-04:** PM/Super Admin have an explicit **override path** for document deletion on
  non-draft projects (with `overrideReason`). The full-freeze rule for completed/archived
  projects applies to all actors including PM/Super Admin.
- **PRJ-BD-05:** Full Operational Access bypasses `assertSectorAllowed` entirely (TC check
  only applies when `role === 'technical_coordinator'`). PM/Super Admin are unaffected.

The Full Operational Access override audit trail (migration 020, `self_review_overrides` table)
is NOT affected by these decisions. The `document_delete_override` log entry for PRJ-BD-04
goes to `audit_log` (not `self_review_overrides`) because it is a data-protection log, not
a maker/checker bypass.

---

## 19. Required Implementation Follow-Ups

These are the mandatory implementation tasks arising from this decision document.

### Task A — Project Activity Financial Preservation (PRJ-BD-03)
**Scope:** `artifacts/api-server/src/routes/projects.ts` — PATCH handler only.
1. Before `DELETE FROM activities WHERE project_id = $1`, run:
   `SELECT id, budget_spent FROM activities WHERE project_id = $1`
2. Build `existingSpent: Map<number, number>`.
3. After reinsert loop completes, for each activity whose body included an `id` present in
   `existingSpent`, run:
   `UPDATE activities SET budget_spent = $1 WHERE id = $2 AND project_id = $3`
4. Update the activity body schema (Zod) to accept an optional `id` field (passthrough, not
   stored on create).
5. Tests: PATCH with activities that have IDs preserves `budget_spent`; PATCH with new
   activities (no ID) starts at 0; PM/Super Admin cannot erase spend by omitting IDs.

### Task B — Multi-Sector TC Scope Unification (PRJ-BD-05)
**Scope:** `artifacts/api-server/src/middlewares/currentUser.ts` and project detail queries.
1. Add `assertSectorAllowedForProject(req, primarySector, sectorsArray)` using union logic.
2. Update the project detail SELECT to include `sectors` column.
3. Replace all `assertSectorAllowed(req, sector)` calls in project-family endpoints with the
   new function.
4. Tests: TC with secondary-sector-only assignment can access both list and detail; empty TC
   sector → fail-closed; primary-only TC → unchanged behaviour.

### Task C — Project Document Post-Approval Lifecycle (PRJ-BD-04)
**Scope:** `artifacts/api-server/src/routes/projects.ts` — document upload and delete endpoints.
1. Document delete: fetch project status alongside sector. Return 409 if non-draft and not
   PM/Super Admin. PM/Super Admin: require `overrideReason` in body; log as
   `document_delete_override`.
2. Document upload: return 409 if status is `completed` or `archived`.
3. Tests: delete blocked on approved project for standard user; delete permitted for PM
   with override; upload blocked on completed project.

**Parallelisation:** Tasks A and B are fully independent and may run in parallel. Task C is
independent of A and B and may also run in parallel with either or both.

---

## 20. Test Contract

### PRJ-BD-SENT-01 — PATCH full-replace resets budget_spent (current defect evidence)

**Purpose:** Demonstrates that a PATCH to a draft project currently zeros `budget_spent`
for all activities, even those with previously recorded spend.

**Setup:**
1. Create a project with one activity; manually set `budget_spent = 150` on that activity.
2. Issue `PATCH /projects/:id` with the same activity content (no `budget_spent` field).
3. Fetch `SELECT budget_spent FROM activities WHERE project_id = :id`.

**Expected (current buggy behaviour):** `budget_spent = 0`.
**Expected (post-fix):** `budget_spent = 150` (when activity `id` is round-tripped).

This test MUST pass against the current codebase (asserting the defect). It will be updated
or removed when Task A implements the fix.

### PRJ-BD-SENT-02 — Multi-sector list/detail mismatch (current defect evidence)

**Purpose:** Demonstrates that a TC assigned only to a secondary sector sees the project in
`GET /projects` but receives 403 on `GET /projects/:id`.

**Setup:**
1. Create a project with `sector = 'SectorA'` and `sectors = ["SectorB"]`.
2. Authenticate as a TC with `sectors = ["SectorB"]` (no primary sector match).
3. Issue `GET /projects` — project appears in results.
4. Issue `GET /projects/:id` — returns 403.

**Expected (current buggy behaviour):** list includes project; detail returns 403.
**Expected (post-fix):** both list and detail return the project.

This test MUST pass against the current codebase (asserting the mismatch). It will be
updated when Task B implements the fix.

### PRJ-BD-SENT-03 — Document delete succeeds on approved project (current defect evidence)

**Purpose:** Demonstrates that document deletion is not blocked by project status.

**Setup:**
1. Create a project and advance to `status = 'approved'`.
2. Upload a document.
3. Issue `DELETE /projects/:id/documents/:docId` as a standard user with `documents.upload`.

**Expected (current buggy behaviour):** 204 No Content (delete succeeds).
**Expected (post-fix):** 409 Conflict (blocked by status gate).

This test MUST pass against the current codebase. It will be updated when Task C implements
the fix.

---

*Document prepared: 2026-08-17. All three decisions are final and binding for implementation.*
*Implementation tasks to be proposed as follow-up tasks after this document is accepted.*
