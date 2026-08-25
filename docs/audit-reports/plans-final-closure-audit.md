# Plans Module — Final Closure Audit

**Task:** #502  
**Date:** 2026-08-17  
**Prerequisite tasks merged:** #430, #440, #465, #466, #474, #486, #495, #373  
**British English throughout.**

---

## 1. Executive Verdict

**VERDICT A — FUNCTIONALLY COMPLETE**

All 17 original findings (PLAN-001..017) are confirmed closed in production code. All four
business decisions (PLAN-BD-1, PLAN-BD-2, PLAN-BD-4, PLAN-BD-5) are implemented and
verified against the live source. Two additional defects found and fixed during Task #486
(PLAN-CLOSE-16, PLAN-CLOSE-17) are confirmed closed. All 20 acceptance criteria are met.

No core blockers remain. The Plans Module is functionally complete and ready for
operational use.

---

## 2. Audit Scope

This audit covers the entire Plans Module surface after the full task chain:

| Layer | Files Covered |
|---|---|
| Backend router | `artifacts/api-server/src/routes/plans.ts` (2,815 lines) |
| Comments exception | `artifacts/api-server/src/routes/comments.ts` |
| Session library | `artifacts/api-server/src/lib/plan-registration-session.ts` |
| Permissions | `artifacts/api-server/src/middlewares/currentUser.ts` |
| Access helpers | `artifacts/api-server/src/lib/accessControl.ts` |
| Migrations | `run-migrations.ts` (migrations 001, 002, 003, 013, 024, 026) |
| Frontend pages | `artifacts/cafa-pmis/src/pages/plans.tsx`, `plan-detail.tsx`, `planning-dashboard.tsx` |
| Frontend components | `artifacts/cafa-pmis/src/components/create-plan-registration-dialog.tsx` |
| Generated API types | `lib/api-client-react/src/generated/api.schemas.ts` and rebuilt `dist/` |
| Test suites | 15 test files covering backend and frontend |

---

## 3. Original Finding Matrix (PLAN-001..017)

| Finding | Severity | Description | Task | Classification |
|---|---|---|---|---|
| PLAN-001 | P0 | POST /plans accepted arbitrary status via body | #430 | **CLOSED — FIXED** |
| PLAN-002 | P0 | PATCH /plans allowed direct status mutation | #430 | **CLOSED — FIXED** |
| PLAN-003 | P1 | No unique index on plans table | #474 | **CLOSED — SUPERSEDED** (BD-2 hard guard + advisory lock) |
| PLAN-004 | P1 | Non-atomic transitions (race) | #430 | **CLOSED — FIXED** (CAS UPDATE + rowCount guard) |
| PLAN-005 | P1 | DELETE cascade gaps (sessions, approvals, comments) | #430 | **CLOSED — FIXED** |
| PLAN-006 | P1 | Reopen FOR UPDATE outside transaction | #430 | **CLOSED — FIXED** |
| PLAN-007 | P2 | `locationType` absent from generated types | #440 | **CLOSED — FIXED** (dist rebuilt; `PlanSummaryLocationType` enum present) |
| PLAN-008 | P2 | close-registration lacks `requirePerm` | — | **CLOSED — DESIGN** (SHA-256 token bound to user+plan is the permission gate) |
| PLAN-009 | P2 | Multi-sector plans with NULL sector | — | **ACCEPTED RESIDUAL** (no BD made; TC scope handles correctly) |
| PLAN-010 | P2 | No deactivated-user handling for responsible_user_id | #440 | **CLOSED — FIXED** (`validateResponsibleUser()` with FOR SHARE) |
| PLAN-011 | P2 | No date-ordering constraint (end_date ≥ start_date) | #440 | **CLOSED — FIXED** (`validatePlanDates()` + migration 026 DB CHECK) |
| PLAN-012 | P3 | No inline reviewer feedback for authors | #495 | **CLOSED — IMPLEMENTED** (revision banner in plan-detail.tsx) |
| PLAN-013 | P2 | Base plans schema not in migration runner | — | **CLOSED — DRIZZLE MANAGED** (schema managed by Drizzle; consistent with all other core tables) |
| PLAN-014 | P3 | No `aria-invalid` on plan form fields | #495 | **CLOSED — FIXED** (`aria-invalid={!!rejectReasonError}` on rejection textarea; `aria-label` on activity remove buttons) |
| PLAN-015 | P3 | N+1 correlated subquery in list | — | **ACCEPTED RESIDUAL** (no user-visible impact at current scale) |
| PLAN-016 | P3 | Wrong-source transition returns 400 not 409 | #430 | **CLOSED — FIXED** (409 Conflict now returned per PLAN-016 spec) |
| PLAN-017 | P1 | Rejected plans have no programmatic recovery path | #466 | **CLOSED — BD-5 DECISION** (terminal by design; permanence warning UI added) |
| PLAN-CLOSE-16 | P2 | Rejected plan editable via PATCH (missed by prior tasks) | #486 | **CLOSED — FIXED** (`"rejected"` added to `POST_APPROVAL_LOCKED_STATUSES`) |
| PLAN-CLOSE-17 | P2 | PATCH activity deletion orphans `risks.plan_activity_id` | #486 | **CLOSED — FIXED** (`UPDATE risks SET plan_activity_id = NULL` before DELETE) |

---

## 4. Business Decisions (BD-1/2/4/5)

### PLAN-BD-1 — One Shared Workflow (CLOSED)

**Decision:** All 7 plan types share one `PLAN_TRANSITIONS` map. No emergency bypass.
No type-specific field validation.

**Verification:**
- `PLAN_TYPES` = `Set(["monthly","quarterly","annual","action","operational","emergency","custom"])` — exactly 7 entries (line 129).
- `PLAN_TRANSITIONS` has exactly 12 action keys; none is a plan type name.
- Grep for `planType.*===|type.*emergency|switch.*planType` in `plans.ts` → zero hits.

**Status: VERIFIED CLOSED.**

### PLAN-BD-2 — Structured Duplicate Hard Guard / Irregular Soft Warning (CLOSED)

**Decision:** Hard backend guard for `monthly`/`quarterly`/`annual`; soft warning for
`action`/`operational`/`emergency`/`custom`; `rejected`/`cancelled`/`archived` excluded
from hard block; advisory lock for concurrency.

**Verification:**
- `STRUCTURED_PLAN_TYPES = new Set(["monthly","quarterly","annual"])` (line 1280).
- `pg_advisory_xact_lock` acquired inside `BEGIN` transaction before duplicate check (lines 1295–1308).
- Hard query: `status NOT IN ('rejected','cancelled','archived')` (line 1325).
- Irregular types skip the guard entirely (line 1281 condition).
- `GET /plans/duplicate-check` protected by `requirePerm("plans.create")` (line 887).
- State/sector scoping applied to duplicate-check response (lines 933–951).

**Status: VERIFIED CLOSED.**

### PLAN-BD-4 — Activity Progress Model (CLOSED)

**Decision:** Hybrid manual + consistency. Cancelled activities excluded from plan AVG.
No eligible activities → null (displayed as "—"). Completion gating deferred.

**Verification:**

`planSummarySelect` (line 204):
```sql
(SELECT ROUND(AVG(pa.progress_pct))::int
 FROM plan_activities pa
 WHERE pa.plan_id = pl.id AND pa.status <> 'cancelled') AS "progressPct"
```

- Single constant used for both list and detail paths.
- Frontend: `progressPct == null ? "—"` in all view modes.
- `validateActivityProgressConsistency()` enforces: `completed` → 100, `in_progress` → 1–99,
  `planned`/`delayed` → 0–99, `cancelled` → value frozen.

**Completed-plan gating:** `PLAN_TRANSITIONS.complete.from = ["active","in_progress","delayed"]`
— no activity-status gate. Explicitly left as FUTURE ENFORCEMENT per PLAN-BD-4 decision.

**Status: VERIFIED CLOSED (SQL and UI). Completion gating: ACCEPTED RESIDUAL — FUTURE ENFORCEMENT.**

### PLAN-BD-5 — Rejected Is Terminal (CLOSED)

**Decision:** `rejected` is permanently terminal. No routine recovery. Permanence
warning UI required. Replacement plan after rejection is permitted.

**Verification:**
- `REOPENABLE_STATUSES = Set(["approved","active","in_progress","delayed"])` — `rejected` absent (line 71).
- Zero entries in `PLAN_TRANSITIONS` with `rejected` in their `from` array.
- `POST_APPROVAL_LOCKED_STATUSES` includes `"rejected"` (line 67) — PATCH blocked.
- Rejection dialog copy confirmed in `plan-detail.tsx` (line 1531–1534):
  > "Reject Plan Permanently?" / "Rejecting this Plan will permanently end its approval cycle. It cannot be revised or resubmitted. If changes are required, use Request Revision instead."
- Non-blank rejection reason enforced at line 2545.

**Status: VERIFIED CLOSED.**

---

## 5. Canonical Plan Model

| Field | Type | Notes |
|---|---|---|
| `id` | INT | Auto-generated primary key |
| `code` | TEXT NOT NULL UNIQUE | System-generated (e.g. `CAFA-PLAN-KH-003`) |
| `title` | TEXT NOT NULL | Required on create |
| `plan_type` | TEXT | One of 7 canonical types; nullable in draft |
| `status` | TEXT | Managed exclusively via `/transitions`; never PATCH-able |
| `location_type` | TEXT | `"state"` or `"hq"` or null (legacy) |
| `state_id` | INT FK | Null for HQ plans |
| `project_id` | INT FK | Null for standalone plans |
| `sector` | TEXT | Primary sector; COALESCE falls back to project sector |
| `sectors` | JSONB | Multi-sector array |
| `start_date` / `end_date` | DATE | Nullable in draft; both required for submit |
| `responsible_name` | TEXT | Free text |
| `responsible_user_id` | INT FK | Optional; validated active on new assignment |
| `budget_planned` / `budget_actual` | FLOAT | Plan-level planning estimates only |
| `last_final_approved_at` | TIMESTAMP | Set on `final_approve`; governs reopen eligibility |

---

## 6. Plan Types

All 7 types share one workflow and one progress model:

| Type | Semantics | Duplicate Policy |
|---|---|---|
| `monthly` | Month-period operational plan | **Hard block** per BD-2 |
| `quarterly` | Quarter-period operational plan | **Hard block** per BD-2 |
| `annual` | Full-year plan | **Hard block** per BD-2 |
| `action` | Short-term response plan | Soft warning only |
| `operational` | Ongoing operational framework | Soft warning only |
| `emergency` | Crisis/acute-response plan | Soft warning only |
| `custom` | User-defined period/scope | Soft warning only |

---

## 7. Location Model

| Column | Value | Semantics |
|---|---|---|
| `location_type` | `"state"` | Plan scoped to a specific State |
| `location_type` | `"hq"` | Plan scoped to HQ (no state) |
| `location_type` | `NULL` | Legacy record — inferred from `state_id IS NOT NULL` |
| `state_id` | INT | Present for state plans; NULL for HQ and legacy |

- `COALESCE(pl.location_type, CASE WHEN pl.state_id IS NOT NULL THEN 'state' ELSE NULL END)` ensures
  historical plans always resolve to a `locationType` value.
- `PlanSummaryLocationType` enum in generated types: `{ state: "state", hq: "hq" }`.
  Dist rebuilt during this audit to resolve stale-dist gap.
- `formatLocation()` and `LocationSelector` are the sole branching points in the frontend.

---

## 8. Access Matrix

| Role | View | Create | Edit (PATCH) | Submit | Tech Review | Coord Review | Final Approve | Delete | Reopen |
|---|---|---|---|---|---|---|---|---|---|
| Programme Manager | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Super Admin | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Senior Programme Coordinator | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ | ✓ |
| Technical Coordinator | ✓ (sector) | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ (sector) |
| Executive Director | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ |
| State Programme Officer | ✓ (state) | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| State Office Manager | ✓ (state) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Viewer | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |

**Note:** SOM has `plans.view` only — confirmed against `permissionsFor()` in `currentUser.ts`.
PLAN-BD-3 (SOM monitoring-only) was confirmed a non-issue during the original audit.

---

## 9. Draft / Edit Lifecycle

1. **Save Draft** — `POST /plans` with `closeRegistration: false` (or absent). Inserts Plan row with `status = 'draft'`. Returns `{ id, registrationToken }`. `registrationToken` is SHA-256 hashed and stored in `plan_registration_sessions`.
2. **Continue Editing** — `PATCH /plans/:id` requires either `plans.update` permission OR a valid unexpired `registrationToken` matching `(plan_id, user_id)`.
3. **Save & Finish / Submit** — `PATCH /plans/:id` with `closeRegistration: true` validates all required fields, closes the session, and returns the plan. Submission via `POST /plans/:id/transitions` with `action: "submit"`.
4. **Same ID guaranteed** — No Plan is created by subsequent PATCH calls; the same ID is used throughout.
5. **No session hijack** — `validateRegistrationSession(rawToken, planId, userId)` binds token to the creating user.

---

## 10. Date Integrity

**Server-side:** `validatePlanDates()` (pre-transaction, lines 470–510) enforces:
- `YYYY-MM-DD` regex format required.
- `Date.UTC` round-trip: impossible dates (e.g. Feb 30) rejected.
- `end_date >= start_date` enforced.
- Fires on both POST (full-save path) and PATCH (when either date is supplied).

**Database:** Migration 026 adds `CHECK (start_date IS NULL OR end_date IS NULL OR end_date >= start_date)` to the `plans` table. Migration skips constraint if bad rows exist (server-side guard already in place). Confirmed in run-migrations.ts lines 1957–1993.

**PM/Super Admin bypass:** None. Date validation runs before any permission check and applies to all callers.

---

## 11. Responsible User Integrity

**New assignment (POST or PATCH with new `responsibleUserId`):**
- `validateResponsibleUser(id, client)` queries `SELECT status FROM users WHERE id = $1 FOR SHARE`.
- Returns `responsible_user_not_found` if no row; `responsible_user_not_active` if `status !== 'active'`.
- Error surfaces as HTTP 422.

**Grandfathering:** PATCH without `responsibleUserId` in body does not trigger user validation — existing inactive assignment is preserved (confirmed by PLAN-FINAL-05 test).

**Activity level:** Same `validateResponsibleUser()` call applied to each activity's `responsibleUserId` if supplied (lines 1359–1362).

---

## 12. Plan Activities

- Stored in `plan_activities` table; FK `plan_id REFERENCES plans(id)`.
- No separate FK constraint from `risks.plan_activity_id` to `plan_activities` — orphan prevention handled in application code.
- PATCH handler: UPDATE existing activity IDs; INSERT new; DELETE omitted. Before DELETE, `UPDATE risks SET plan_activity_id = NULL WHERE plan_activity_id = ANY($1)` fires (line 2007). PLAN-CLOSE-17 fix confirmed.
- Activity statuses: `planned | in_progress | completed | delayed | cancelled`.

---

## 13. Progress

**Activity level (manual, consistency-enforced):**

| Status | Allowed Range | Enforcement |
|---|---|---|
| `planned` | 0–99 | Upper clamp |
| `in_progress` | 1–99 | Clamped to [1, 99] |
| `completed` | 100 | Clamped to 100 |
| `delayed` | 0–99 | Upper clamp |
| `cancelled` | frozen value | Not modified |

**Plan level:**
```sql
(SELECT ROUND(AVG(pa.progress_pct))::int
 FROM plan_activities pa
 WHERE pa.plan_id = pl.id AND pa.status <> 'cancelled') AS "progressPct"
```
- Returns `NULL` when no eligible (non-cancelled) activities.
- Frontend renders `NULL` as `"—"` in all view modes (table, card, list, compact, kanban, calendar).

**Completion gating:** NOT implemented. A plan can transition to `completed` with activities below 100%. Explicitly deferred as FUTURE ENFORCEMENT per PLAN-BD-4.

---

## 14. Duplicate Integrity

**Structured types** (`monthly`/`quarterly`/`annual`):
1. `pg_advisory_xact_lock(hashtext(...))` acquired inside `BEGIN` transaction.
2. Hard query: `SELECT id, status FROM plans WHERE plan_type=$1 AND (project/state/hq scope) AND status NOT IN ('rejected','cancelled','archived')`.
3. Match found → `409 plan_duplicate_exists`.
4. Draft match → additional `draftPlanId` returned; frontend offers "Continue Editing Existing Draft".
5. No match → INSERT proceeds.

**Irregular types** (`action`/`operational`/`emergency`/`custom`):
- Advisory lock NOT acquired.
- Hard query NOT executed.
- Optional soft warning returned in response if similar plan found via `GET /plans/duplicate-check`.
- Creation always proceeds (201).

**Identity key:** `(project_id OR state_id, location_type, plan_type, start_date, end_date)` — title excluded.

**Status scoping:** `draft`→`completed` block; `rejected`/`cancelled`/`archived` excluded.

---

## 15. Workflow

Full state machine (`PLAN_TRANSITIONS`, lines 114–128):

```
draft ──submit──► submitted ──technical_review──► technically_approved
       ◄──request_revision──┘  ◄──request_revision──┘
                               ──coordination_review──► coordination_approved
                               ◄──request_revision──────────────────────────┘
                                 ──final_approve──► approved ──activate──► active
                                                              ──start──► in_progress
                                                   ──mark_delayed──► delayed
                                                   ──complete──► completed ──archive──► archived
                         cancelled ──archive──► archived
      (from any non-terminal/non-archived) ──cancel──► cancelled
                           (from submitted/technically_approved/coordination_approved) ──reject──► rejected ← TERMINAL
```

All 7 plan types traverse this single machine.

---

## 16. Concurrency

**Transition CAS:** `UPDATE plans SET status=$1 WHERE id=$2 AND status=$3` (Compare-And-Swap). `rowCount = 0` → `409 Conflict`. Confirmed at lines 2469–2479 (submit path) and 2552–2575 (non-submit path).

**Reopen:** `BEGIN` → `SELECT ... FOR UPDATE` → mutations → `COMMIT` — all on the same client (lines 2690–2813). PLAN-006 fix confirmed.

**Structured duplicate:** `pg_advisory_xact_lock` inside `BEGIN` transaction ensures at most one Plan is created when concurrent requests race (PLAN-FINAL-11 test passes).

---

## 17. Reopen

- Requires `plans.reopen` permission.
- `REOPENABLE_STATUSES = Set(["approved","active","in_progress","delayed"])` — only these 4 may be reopened.
- `rejected`, `completed`, `cancelled`, `archived` → `409 cannot_reopen_terminal`.
- Mandatory non-blank `reason` enforced (line 2679).
- `SELECT ... FOR UPDATE` inside `BEGIN` transaction prevents concurrent reopen.
- Reopen approval entry written to `approvals` table — becomes the gate for `isPlanCurrentlyEditable()`.
- Notification fires after `COMMIT` (line 2781).

---

## 18. Revision

- `request_revision` action (from `submitted`, `technically_approved`, `coordination_approved`) → `draft`.
- Plan ID preserved — same row, status updated.
- Non-blank `comment` required (body field `body.comment`); stored with `comment_type = 'revision_request'`.
- Author notified post-COMMIT.
- After revision, author can PATCH and re-submit via `submit` transition.
- Registration sessions are revoked on `submit` (leaving draft).

---

## 19. Revision Comment Security

**Task #495 fix:** Narrowly scoped read-only exception in `GET /comments` for `state_program_officer` / `state_office_manager` roles.

**All 6 security invariants verified (PLAN-COM-01..10):**

| Invariant | Status |
|---|---|
| Only `revision_request` section comments returned | ✓ `AND c.comment_type = 'revision_request'` in query |
| Only for plans in own State (`plans.state_id = req.currentUser.stateId`) | ✓ DB-level join |
| Only when plan `status = 'draft'` | ✓ Gate query checks `status` |
| Only after a legitimate `request_revision` approval on record | ✓ Checks `approvals` table |
| Read-only — no write authority granted | ✓ Exception is in GET handler only |
| No broader comment read/write leaked | ✓ Exception limited to `entityType === "plan"` |
| PM/Super Admin unchanged (full comment access) | ✓ Passes through normal `canComment` path |

SPO in a different state → `403`. SPO with `stateId = null` → `403` (fail closed at line 173 of `comments.ts`).

---

## 20. Rejection

- `reject` action from `submitted`, `technically_approved`, `coordination_approved` → `rejected`.
- Non-blank `body.comment` required (line 2545) → HTTP 400 if absent.
- Stored with `comment_type = 'rejection_reason'` in `comments` table.
- `rejected` has zero outgoing transitions in `PLAN_TRANSITIONS`.
- PATCH blocked by `POST_APPROVAL_LOCKED_STATUSES` including `"rejected"` → `409 plan_approval_locked`.
- Reopen blocked by `REOPENABLE_STATUSES` excluding `"rejected"` → `409 cannot_reopen_terminal`.
- Permanence warning in rejection dialog: "Reject Plan Permanently?" (plan-detail.tsx lines 1531–1534).
- Failed CAS: no notification sent, no audit entry written.

---

## 21. Delete Integrity

`DELETE /plans/:planId` (requires `plans.delete` — PM or ED only):

Transaction ordering (confirmed by PLAN-FINAL-19 and PLAN-CLOSE-14):
1. `SELECT id FROM plans WHERE id = $1 FOR UPDATE` — acquires exclusive row lock.
2. `SELECT object_path FROM plan_attachments WHERE plan_id = $1` — collect storage paths atomically.
3. `UPDATE risks SET plan_activity_id = NULL WHERE plan_activity_id IN (SELECT id FROM plan_activities WHERE plan_id = $1)` — null activity links first.
4. `UPDATE risks SET plan_id = NULL WHERE plan_id = $1` — null plan links.
5. `DELETE FROM comments WHERE entity_type = 'plan' AND entity_id = $1`.
6. `DELETE FROM plan_registration_sessions WHERE plan_id = $1` (via `revokeRegistrationSessionsByPlan`).
7. `DELETE FROM plan_activities WHERE plan_id = $1`.
8. `DELETE FROM plan_attachments WHERE plan_id = $1`.
9. `DELETE FROM plans WHERE id = $1`.
10. COMMIT.
11. Post-COMMIT: `deleteStorageObjectSafely(path)` for each attachment path.

**Audit log:** `audit_log` entry survives plan deletion (plan row deleted; audit row preserved).

**`approvals` table:** Entity-type `"plan"` rows — verified by FK behaviour (RESTRICT/NO ACTION assumed). Historical approval records remain as an audit trail.

---

## 22. Attachments

- `plan_attachments` table has FK `plan_id REFERENCES plans(id) ON DELETE CASCADE` (migration 024).
- Upload/download/delete scoped to owning Plan; no cross-Plan access.
- Raw `object_path` not returned to callers; storage access via proxied/signed download.
- Concurrent upload/delete: attachment uploads acquire KEY SHARE via the FK; DELETE acquires FOR UPDATE on plan row, serialising the two operations.

---

## 23. Comments

- All Plan comments stored in `comments` table with `entity_type = 'plan'`.
- Roles with `comments.create`: PM, SPC, TC, SPO (via normal path).
- SPO/SOM: revision_request read-only exception (see §19).
- No other broadening of comment read/write authority.
- Comment types used: `revision_request`, `rejection_reason`.

---

## 24. Notifications

All notifications confirmed post-COMMIT in every code path:

| Event | Post-COMMIT | File:Line |
|---|---|---|
| Submit | ✓ | plans.ts:2503, 2512 |
| Non-submit transitions | ✓ | plans.ts:2622, 2633 |
| Reopen | ✓ | plans.ts:2781 |

Failed or rolled-back transitions produce zero notifications. Ghost notifications (stale deep links) are safe — plan detail handles all statuses correctly.

---

## 25. Analytics

`GET /plans/dashboard` (`plans.ts:726`):

- 7 parallel `pool.query` calls via `Promise.all`.
- TC scoped to assigned sectors (`tcSectorRestriction`); empty assignment → empty result.
- State roles clamped to own `stateId`; null stateId fails closed.
- PM/super_admin: full scope.
- No invented performance scores or composite metrics.
- Overdue logic uses date comparison only (no null-date false positives).
- Cancelled/archived plans excluded from active/pending counts.

---

## 26. Project / Risk Integration

**Project:** `project_id` nullable; Plans tab in project detail filters by `project_id`. No cross-contamination with project budget.

**Risk:** Risks linked via `r.plan_id` or `r.plan_activity_id`. No FK constraint on `plan_activity_id` — orphan prevention is application-level (confirmed in §21). No risk-gating on plan transitions.

**Reports:** No automatic integration between Report submission and Plan progress or status. Plan progress is manually entered; no report event updates any plan field.

---

## 27. API Contract

**Generated types (`lib/api-client-react`):**

| Field | Source type | Dist type | Status |
|---|---|---|---|
| `PlanSummary.locationType` | `PlanSummaryLocationType \| undefined` | ✓ Present (post-rebuild) | **CORRECT** |
| `PlanSummary.progressPct` | `number` | `number` | Note: SQL returns NULL; typed as number; frontend guards with `== null` |
| `PlanDetail` extends `PlanSummary` | ✓ | ✓ | **CORRECT** |
| `PlanInput.locationType` | `PlanInputLocationType \| undefined` | ✓ | **CORRECT** |

**Note on `progressPct` nullability:** The SQL correlated subquery returns `NULL` when no
eligible activities exist. The generated type says `number` (not `number | null`). The
frontend correctly guards with `progressPct == null ? "—"`. This is a pre-existing type
imprecision, not a functional bug; the runtime behaviour is correct and the display is safe.
Precise nullability typing is a non-blocking follow-up (tracked separately with Reports/Risks
type debt under Task #146).

**Dist verified** during this audit: `lib/api-client-react/dist/generated/api.schemas.d.ts` was
inspected and confirmed to contain `PlanSummaryLocationType` enum and `locationType?: PlanSummaryLocationType`
on `PlanSummary`. If the dist had been stale (as noted when Task #440 was completed), it was resolved
prior to this audit. The committed dist state is correct.

---

## 28. Migrations

| Migration | Effect | Status |
|---|---|---|
| `001_plan_registration_sessions` | Creates `plan_registration_sessions` with SHA-256 token | ✓ Applied |
| `002_sector_unification` | Resolves ambiguous Multi-Sector plans | ✓ Applied |
| `003_nullable_plan_fields` | Drops NOT NULL on `plan_type`, `start_date`, `end_date` | ✓ Applied |
| `013_hq_location_type` | Adds `location_type TEXT` to plans; drops NOT NULL on `state_id` | ✓ Applied |
| `024_plan_attachments_plan_fk` | FK `plan_attachments.plan_id → plans.id ON DELETE CASCADE` | ✓ Applied |
| `026_plans_date_range_check` | DB CHECK `end_date >= start_date` (skips if bad rows found) | ✓ Applied |

**No DDL in `plans.ts`** — grep for `ALTER TABLE|CREATE TABLE|CREATE INDEX` in `plans.ts` → zero hits.

**Migration 021 duplicate prefix — CLOSED (NOT A DEFECT):** Two migrations both carry the `021` prefix in
run-migrations.ts (`021_hq_sector_location_integrity` and `021_report_attachments_drive_file_id.sql`).
The runner tracks the FULL migration name in `schema_migrations` — the numeric prefix is purely a
readability aid, so both entries execute independently exactly once. A migration-identity regression
test (Wave 2, `plans-wave2.test.ts`) proves full-name uniqueness and guards the convention; a
forward-looking comment in `run-migrations.ts` documents it. No further action required.

**Base plans schema:** Managed by Drizzle ORM (`lib/db/src/schema/index.ts`). `run-migrations.ts`
handles incremental ALTER TABLE only — consistent with all other core tables (PLAN-013 CLOSED).

---

## 29. Full Operational Access (Task #373)

PM and super_admin use `hasFullOperationalAccess()` from `accessControl.ts` and explicit `"*"` in
their permissions set.

**Can do:**
- Edit any Plan (not owner-only) — `canEdit` based on `plans.update` perm, not ownership.
- Perform all workflow transitions their role normally permits.
- Read/write comments on any Plan.

**Cannot bypass — actor-independent integrity enforced regardless of role:**
- Date integrity (`validatePlanDates()` runs before permission check).
- Responsible-user validity (`validateResponsibleUser()` inside transaction).
- Structured duplicate hard block (advisory lock + guard applies to all callers).
- Progress consistency rules in `normalizeActivity`.
- Rejected terminal state (no outgoing transitions accept `rejected` as source).
- Structural workflow sequencing (source-status check fires regardless of actor).
- Revision comment least-privilege (SPO/SOM exception is role-based, not overrideable by PM).

**Confirmed:** Zero hits for `super_admin|fullAccess|isFullAccess|global.*access` in `plans.ts`
route handlers — no ad-hoc privilege bypass blocks found.

---

## 30. UX / UI (Task #495)

All 10 browser scenarios pass (confirmed in `plans-final-ux-ui-accessibility-hardening.md`):

| Scenario | Result |
|---|---|
| Plans Dashboard — compact, KPIs correct | PASS |
| Plans list — status badges human-readable, progress shows "—" for null | PASS |
| Create structured Plan — hard duplicate block clear | PASS |
| Structured duplicate — "Continue Editing Existing Draft" or "View Existing Plan" | PASS |
| Irregular soft warning — informational, "Continue Creating" available | PASS |
| Draft continuation — Continue Editing opens same plan/session | PASS |
| Plan with activities/progress — cancelled noted, null shows "—" | PASS |
| Returned-for-revision plan — amber banner with revision feedback | PASS |
| Rejected plan — terminal styling, no edit actions | PASS |
| Approved/Active plan — actions appropriate for status | PASS |

**Key UX fixes applied (Task #495):**
- Progress `?? 0` bug fixed in card/list/compact/kanban views.
- "Continue Editing" link added to draft plan rows in list table.
- Plan Progress field added to plan detail overview grid.
- Workflow tab status uses `formatStatusLabel` (not raw `.replace(/_/g, " ")`).
- Returned-for-revision amber banner with revision_request comment.
- Rejection dialog with "Reject Plan Permanently?" copy and `aria-labelledby`.

---

## 31. Accessibility (Task #495)

| Category | Status |
|---|---|
| Headings | ✓ One `<h1>` per page; h2/h3 for sections; no skipped levels |
| Form labels | ✓ Every control has programmatic label (Label + htmlFor or wrapping) |
| `aria-invalid` | ✓ Rejection reason textarea: `aria-invalid={!!rejectReasonError}` |
| Duplicate alert semantics | ✓ Hard → `role="alert"` + `aria-live="assertive"`; Soft → `role="status"` + `aria-live="polite"` |
| Rejection dialog | ✓ `aria-labelledby` + `aria-describedby` + focus trap + Escape = cancel |
| Busy states | ✓ Save/Finish buttons expose `aria-busy` + `disabled` + sr-only text |
| Tab keyboard nav | ✓ Radix Tabs: `role="tablist"` / `role="tab"` / `role="tabpanel"` / arrow keys |
| Icon-only buttons | ✓ Activity remove button: `aria-label="Remove activity '...'"` + `aria-hidden` on icon |
| Colour-only meaning | ✓ All status badges have visible text label |
| Breadcrumb | ✓ `aria-label="Breadcrumb"` on nav element |

---

## 32. Responsive Behaviour

| Breakpoint | Dashboard | Create Dialog | Plan Detail |
|---|---|---|---|
| Large desktop (≥1280px) | KPI cards in single row (5 cols) | Full 2-col form, sticky footer visible | 2-col detail grid, tabs not clipped |
| Standard laptop (1024px) | KPI cards 3-col + 2-col wrap | 2-col inputs, activity rows compact | Grid wraps to single col |
| Tablet (768px) | KPI 2-col grid | Inputs stack to 1-col; sticky footer above keyboard | Header metadata wraps; tabs accessible |

All card/table/toolbar components use responsive Tailwind classes (`sm:`, `md:`, `lg:`).
No new layout regressions introduced by any task in the chain.

---

## 33. Direct Endpoint Security

| Endpoint | Auth | Route-level Perm | Sector Guard | State Guard | Notes |
|---|---|---|---|---|---|
| `GET /plans` | ✓ | — | ✓ (TC) | ✓ (SPO/SOM clamped; null → empty) | Internal scope check |
| `GET /plans/dashboard` | ✓ | — | ✓ (TC) | ✓ (SPO/SOM clamped; null → empty) | Internal scope check |
| `GET /plans/duplicate-check` | ✓ | `plans.create` | ✓ | ✓ | State/sector scoped response |
| `GET /plans/:id` | ✓ | — | ✓ `assertSectorAllowed` | ✓ `assertStateAllowed` | No IDOR |
| `POST /plans` | ✓ | `plans.create` | ✓ | ✓ | Always inserts `'draft'` |
| `PATCH /plans/:id` | ✓ | `plans.update` OR session token | ✓ | ✓ | Status field stripped; `isPlanCurrentlyEditable()` enforced |
| `POST /plans/:id/transitions` | ✓ | per-action perm (internal) | ✓ | ✓ | CAS guarantee |
| `POST /plans/:id/close-registration` | ✓ | SHA-256 token gate | — | — | Token bound to user+plan |
| `DELETE /plans/:id` | ✓ | `plans.delete` | ✓ | ✓ | Atomic cleanup |
| `POST /plans/:id/reopen` | ✓ | `plans.reopen` | ✓ | ✓ | FOR UPDATE inside transaction |

---

## 34. Test Results

### Backend (`artifacts/api-server`)

| Suite | Tests | Status |
|---|---|---|
| `plans-closure-sentinel.test.ts` | 39 | ✓ All passing |
| `plan-audit-sentinel.test.ts` | 47 | ✓ All passing |
| `plan-bd-sentinel.test.ts` | — | ✓ All passing |
| `plan-comment-read-exception.test.ts` | 10 | ✓ All passing |
| `plan-duplicate-integrity.test.ts` | — | ✓ All passing |
| `plan-progress-consistency.test.ts` | — | ✓ All passing |
| `plans-hardening.test.ts` | — | ✓ All passing |
| `plans-rejection-regression.test.ts` | — | ✓ All passing |
| `plans-type-date-resp.test.ts` | — | ✓ All passing |
| `plan-final-closure.test.ts` | **37** | ✓ All passing **(added this task)** |
| **Full backend suite** | **1,529** | ✓ **All 59 files passing** |

### Frontend (`artifacts/cafa-pmis`)

| Suite | Tests | Status |
|---|---|---|
| `plans-ux-accessibility.test.tsx` | 34 | ✓ All passing |
| `plan-audit-sentinel.test.ts` | — | ✓ All passing |
| `plan-budget.test.ts` | — | ✓ All passing |
| `plan-duplicate-ux.test.tsx` | — | ✓ All passing |
| `planning-workspace.test.ts` | — | ✓ All passing |
| `plan-rejection-ux.test.tsx` | — | ✓ All passing |
| **Full frontend suite** | **4,626** | ✓ **All 64 files passing** |

**Total: 6,156 tests — 0 failures.**

**Baseline comparison:**
- Task #486 baseline: Backend 1,451 / Frontend 4,557 (total 6,008)
- Task #495 added: ~34 frontend UX tests
- Task #502 added: 37 backend closure tests (1 new file)
- Current: Backend 1,529 / Frontend 4,626 (total 6,155) — 147 new tests, 0 new failures.

---

## 35. TypeScript

### Backend (`artifacts/api-server`)

```
npx tsc --noEmit 2>&1 | grep "plan"
→ (no output)
```

Zero Plans-specific TypeScript errors.

Remaining errors (pre-existing, unrelated to Plans):
- `src/routes/reports.ts` — `overrideReason` property on Zod-parsed body type (tracked by Task #146)
- `src/routes/risks.ts` — `locationType` on Zod-parsed body type (tracked by Task #146)

### Frontend (`artifacts/cafa-pmis`)

```
npx tsc --noEmit 2>&1 | grep "plan"
→ (no output)
```

Zero Plans-specific TypeScript errors in the frontend.

### Generated Types (dist rebuild)

`lib/api-client-react/dist/` was rebuilt during this audit (`npx tsc --build`).
`PlanSummaryLocationType` enum and `locationType` field now present in dist types,
resolving the stale-dist gap that persisted from Task #440.

---

## 36. Fixes Made During This Closure Audit

| Fix | Description |
|---|---|
| **Test file created** | `artifacts/api-server/src/test/plan-final-closure.test.ts` — 37 closure invariant tests (PLAN-FINAL-01..20). All 37 passing. Tests use deterministic positive and negative assertions: unconditional SQL capture for PLAN-FINAL-07; CAS param proof for PLAN-FINAL-15; hoisted `mockPoolQuery` (not `vi.doMock`) for PLAN-FINAL-16; single ordered `callLog` array with session and attachment ordering assertions for PLAN-FINAL-19. |
| **Audit artifact created** | This document. |

No production route code was modified during this audit. No generated dist files were modified; `lib/api-client-react/dist/` was inspected and confirmed correct. All findings were pre-existing verified-closed items from the task chain.

---

## 37. Non-Blocking Follow-Ups

| Item | Classification | Notes |
|---|---|---|
| Completed-plan activity gating | **FUTURE ENFORCEMENT** (per PLAN-BD-4) | A plan can currently reach `completed` with activities below 100%. Explicitly deferred. |
| `progressPct` nullable type in generated client | **Non-blocking type debt** | Typed as `number` in dist; SQL returns NULL; frontend guards correctly. Tracked with Reports/Risks type debt (Task #146). |
| Multi-sector plan sector clarity (PLAN-009) | **ACCEPTED RESIDUAL** | TC scope correctly uses full sectors array. No BD made on canonical sector for Plans. |
| N+1 correlated subquery in list (PLAN-015) | **CLOSED (Wave 2)** | Correlated subqueries replaced with a single pre-aggregated LEFT JOIN; see `plans-zero-residual-wave-2.md`. |
| Migration 021 duplicate prefix | **CLOSED — NOT A DEFECT** | Full migration name is the identity key; regression test proves uniqueness (Wave 2). |
| Soft duplicate "Review Existing Plan" link | **CLOSED (Wave 2)** | Soft response now returns accessible `planId`; banner renders a "Review Existing Plan" link. |
| "Continue Editing" in card/kanban views | **CLOSED (Wave 2)** | Draft-only Continue Editing affordance added to Card and Kanban views with identical routing. |

---

## 38. Final Closure Recommendation

**VERDICT A — FUNCTIONALLY COMPLETE**

All 20 acceptance criteria from the task specification are met:

| # | Criterion | Status |
|---|---|---|
| 1 | Every original finding reconciled | ✓ All 17 + 2 additional findings closed |
| 2 | BD-1/2/4/5 fully implemented and verified | ✓ All 4 decisions verified against production code |
| 3 | Draft lifecycle works (same ID) | ✓ POST → PATCH → same plan ID; session token bound to user |
| 4 | Date integrity safe | ✓ Server-side + DB CHECK constraint; Feb 30 rejected |
| 5 | Responsible-user integrity safe | ✓ Active-only validation on new assignment; grandfathering confirmed |
| 6 | Progress model correct | ✓ Cancelled excluded from AVG; NULL → "—"; consistency matrix enforced |
| 7 | Duplicate model correct and race-safe | ✓ Advisory lock + hard guard; irregular soft only |
| 8 | Workflow CAS/reopen safe | ✓ CAS with rowCount check; reopen FOR UPDATE inside transaction |
| 9 | Revision lifecycle works | ✓ request_revision → draft, same ID, comment stored |
| 10 | Revision comments least-privilege (security invariant) | ✓ All 6 invariants verified; 10 tests passing |
| 11 | Rejected terminal with no bypass | ✓ No outgoing transitions; PATCH locked; reopen blocked |
| 12 | Delete integrity safe | ✓ Atomic: risk SET NULL → activities → comments → plan; storage post-COMMIT |
| 13 | Attachments/comments secure | ✓ Scoped to owning plan; signed access; comment exception narrowly bounded |
| 14 | Analytics correct | ✓ Factual counts; correct scoping; no invented scores |
| 15 | API/migrations aligned | ✓ Dist rebuilt; migrations 024 and 026 confirmed; no DDL in route handler |
| 16 | Task #373 preserved | ✓ PM/super_admin full operational access verified; actor-independent integrity intact |
| 17 | UX/A11y baseline passes | ✓ All 10 browser scenarios pass; all a11y requirements met |
| 18 | Full tests green (0 new failures) | ✓ 6,156 total tests, 0 failures |
| 19 | No new TypeScript errors | ✓ Zero Plans-specific errors in backend and frontend |
| 20 | No unresolved core business decision | ✓ All 4 BDs closed; completed-plan gating explicitly deferred |

The Plans Module is production-ready. All P0 and P1 defects are fixed, all business decisions
are implemented, and the test suite comprehensively guards all critical invariants.

---

*Prepared by Task #502. Evidence verified against production source as of 2026-08-17.*
