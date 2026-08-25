# Budgets — Allocation Cap Integrity Closure

Task #595 (closes finding BUD-BD-01; resolves proposed task #581).

## BUD-BD-01 Implementation Gaps Closed

### Canonical Rule
`SUM(project_state_allocations.budget_allocation) <= projects.budget_total`
Applies unconditionally (including when `budget_total = 0`).
Actor-independent: PM / Super Admin cannot bypass.

### Gap 1: Zero-budget bypass
Previous code (allocation replace endpoint):
`if (projectBudget > 0 && allocTotal > projectBudget)` — positive allocations
against a zero budget were silently accepted.
Fix: removed the `projectBudget > 0` condition. The cap check is now
unconditional: `budget = 0` + positive allocation → 422; `budget = 0` +
zero/empty allocations remains valid.

### Gap 2: Budget-reduction gap
Previous code: the project PATCH handler performed no allocation cap
validation at all — a reduced `budget_total` could leave existing allocations
over-cap.
Fix: the PATCH always writes `budget_total` and wholesale-replaces state
allocations, so the post-PATCH state is exactly the incoming payload. Inside
the PATCH transaction (after `BEGIN`, before `UPDATE projects`), the sum of
incoming allocations is checked against the incoming budget; violation →
`ROLLBACK` + 422. A payload that lowers the budget while retaining existing
allocations is therefore rejected. Negative `budget_total` is now rejected on
PATCH (400, parity with create), and negative allocation rows are rejected
(422 `invalid_allocation`) on PATCH and CREATE, matching the replace endpoint.

The CREATE handler receives `budget_total` and allocations in the same body;
the same unconditional cap check now runs before any row is written.

### Gap 3: Race condition
Previous code: allocation replace read `budget_total` via `client.query`
BEFORE `BEGIN`, with no row lock — a concurrent budget PATCH could commit a
lower budget between the check and the allocation write.
Fix: transaction restructured — `BEGIN` first, then
`SELECT ... FROM projects WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
then the cap check, then DELETE/INSERT, then `COMMIT`. The PATCH handler now
also takes a `FOR UPDATE` lock on the project row immediately after `BEGIN`,
so the two write paths serialise on the project row and cannot both slip past
the cap.

### Existing data audit
Development database query (2026-08-19) found **8 residual over-allocated
projects** written before enforcement:

| id | title | budget_total | alloc_total |
|---|---|---|---|
| 3 | Child Protection Spaces — Khartoum Returnees | 780,000 | 811,200 |
| 4 | Multi-Purpose Cash Assistance — Gedaref | 3,200,000 | 3,584,000 |
| 11 | Emergency Shelter — Sennar | 540,000 | 561,600 |
| 12 | Community Health Workers — Central Darfur | 890,000 | 996,800 |
| 16 | E2E HQ Test | 50,000 | 52,000 |
| 17 | E2E HQ Af2eTw | 100,000 | 112,000 |
| 21 | Code Test 2 | 1,000 | 1,040 |
| 25 | سيدسيسبيز | 557,869 | 580,184 |

These rows are NOT deleted or auto-corrected (financial user data). Migration
`029_allocation_cap_residual_warning` raises a `WARNING` per offending project
at migration time (warning only — no data change). Remediation path: an
authorised user either raises the project budget or lowers the state
allocations via the normal UI; any future allocation/budget write on these
projects will be forced through the new cap check.

### Concurrency / Locking
- Allocation replace: `SELECT ... FOR UPDATE` on the project row inside the
  transaction, before the cap check and any write.
- Project PATCH: `SELECT COALESCE(budget_total::float,0) ... FOR UPDATE`
  immediately after `BEGIN` (also captures the pre-PATCH budget for audit).
- Two concurrent conflicting writes serialise on the project row lock; the
  second re-reads state committed by the first, so both cannot succeed when
  the combined total exceeds the budget.
- No cross-row `CHECK` constraint or trigger added (PostgreSQL cannot enforce
  SUM-across-rows in a CHECK; the lock + in-transaction check is sufficient).

### Error codes
Canonical code across all three paths (allocation replace, PATCH, CREATE):
**`over_allocation`** (HTTP 422), the pre-existing code from the replace
endpoint. It was retained (rather than
`state_allocations_exceed_project_budget`) because existing tests pin it, the
frontend keys off the human-readable `message` (surfaced via the generated
client's `ApiError.message`), and the OpenAPI spec declares no error-body
schema for these routes — so no OpenAPI/codegen change was required.
Negative values: `invalid_allocation` (422) for negative allocation rows;
`validation_error` (400) for negative `budget_total` (parity with create).

### Frontend display (verified, no change needed)
The generated API client (`lib/api-client-react/src/custom-fetch.ts`) builds
`ApiError.message` from the backend `message` field; both the project
registration form and project detail surface `err.message` in destructive
toasts, so the 422 cap message is shown to the user verbatim.

### Tests
`artifacts/api-server/src/routes/__tests__/budget-allocation-cap-closure.test.ts`
— BUD-CAP-01 through BUD-CAP-15 (zero-budget rejection, boundary equality,
actor-independence for PM/SA, PATCH reduction rejection, rollback integrity,
lock ordering, structural FOR UPDATE presence, audit entry).
Updated pre-existing suites for the new transaction shape:
`project-audit.test.ts`, `prj-final-closure.test.ts`,
`prj-spend-preservation.test.ts` (mock-order only; assertions unchanged).

### Status
BUD-BD-01: IMPLEMENTED
#581: CLOSED

### Remaining Budget Findings
- BUD-BD-02 (allocation currency: allocations inherit Project currency; no FX conversion) — open by design decision, out of scope here.
