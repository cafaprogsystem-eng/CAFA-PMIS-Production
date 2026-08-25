# Plans Module — Full Functional / Technical / Security / UX Audit

**Task:** #416  
**Date:** 2026-08-17  
**British English throughout.**

---

## 1. Executive Summary

**Audit Verdict: BUSINESS DECISIONS REQUIRED BEFORE TARGETED HARDENING**

The Plans Module has a coherent multi-step approval workflow, a well-structured
registration-session creation mechanism, and reasonably consistent role scoping. However,
two P0 security vulnerabilities (status injection via POST and direct status bypass via
PATCH) were found and fixed during this audit. Several P1 structural gaps remain —
most notably a lack of unique indexes (no duplicate-plan protection), non-atomic
post-approval transitions (race conditions), and a reopen row-lock that is issued
outside its enclosing transaction. Three business decisions are required before
implementation proceeds.

All 960 backend tests and 4,281 frontend tests pass. TypeScript reports 20 pre-existing
errors, of which two are plan-specific (`locationType` absent from generated types).

---

## 2. Current Architecture

| Layer | Files |
|---|---|
| Backend router | `artifacts/api-server/src/routes/plans.ts` (1,932 lines) |
| Session library | `artifacts/api-server/src/lib/plan-registration-session.ts` |
| Permissions | `artifacts/api-server/src/middlewares/currentUser.ts` |
| Access helpers | `artifacts/api-server/src/lib/accessControl.ts` |
| Migrations | `run-migrations.ts` (001–003, 013 affect plans) |
| Frontend pages | `artifacts/cafa-pmis/src/pages/plans.tsx`, `plan-detail.tsx`, `planning-dashboard.tsx` |
| Frontend components | `artifacts/cafa-pmis/src/components/create-plan-registration-dialog.tsx` |
| Frontend tests | `src/test/planning-workspace.test.ts` (~4,281 assertions), `plan-budget.test.ts` |
| Backend tests | No dedicated plans API test file exists |
| Audit sentinel | `src/test/plan-audit-sentinel.test.ts` (added by this audit) |

---

## 3. Plan Business Purpose

A Plan is a forward-looking operational document — it captures what a field office,
sector, or the whole programme intends to accomplish over a defined period. Plans are
structured into activities, given a budget estimate, linked to risks and geographical
coverage, and tracked through an approval workflow. Plans are independent of Reports
(which capture what was accomplished). There is no automatic integration between
Report submission and Plan progress.

---

## 4. Plan Types

| Type | Semantics | Notes |
|---|---|---|
| `monthly` | Month-period operational plan | Most common for state offices |
| `quarterly` | Quarter-period operational plan | Often sector-wide |
| `annual` | Full-year plan | Usually HQ or programme-level |
| `action` | Short-term response plan | Typically emergency-adjacent |
| `operational` | Ongoing operational framework | No distinct period rule |
| `emergency` | Crisis/acute-response plan | Fast-tracked review expected |
| `custom` | User-defined period/scope | Catch-all for irregular plans |

All 7 types share the same approval workflow and data model. No type-specific routing,
validation, or reviewer assignment exists. Whether type-specific treatment is intended
is a business decision (see PLAN-BD-1).

---

## 5. Canonical Identity

**Finding:** There is **no unique index** on the `plans` table. Any combination of
(title, planType, project_id, state_id, sector, period) can be duplicated freely.
No duplicate-check endpoint exists. A single user can submit two identical plans.

This is PLAN-003 (P1). See Business Decisions Required (PLAN-BD-2) for the resolution path.

Current identity dimensions in the schema:

| Field | Nullable | Notes |
|---|---|---|
| `title` | No (required on create) | Free text |
| `plan_type` | Yes (nullable in draft per migration 003) | One of 7 types |
| `project_id` | Yes | Null for standalone/HQ plans |
| `state_id` | Yes | Null for HQ plans |
| `sector` / `sectors` | Yes | Single-sector string + multi-sector JSONB |
| `start_date` / `end_date` | Yes (nullable in draft) | Period dates |
| `frequency` | Yes | One of 5 frequencies |
| `code` | No | Auto-generated (format inferred from context) |

---

## 6. Project Relationship

- `project_id` is nullable. When populated, the plan is linked to a specific project.
- Sector falls back to the linked project's sector via
  `COALESCE(NULLIF(pl.sector,''), p.sector)` in `getPlanMeta`.
- State follows the plan's own `state_id` (not the project's state).
- Plans tab in project detail correctly filters by `project_id`.
- Standalone plans (no project) appear in the global list but not in any project's Plans tab.
- Creating from the project Plans tab passes `project_id` automatically.

**No issue found.**

---

## 7. State Relationship

- Direct `state_id` on plan; not inherited from project.
- HQ plans have `state_id = NULL` and `location_type = 'hq'`.
- `assertStateAllowed` blocks state-scoped roles (SPO/SOM) from HQ plans.
- Null-stateId state users fail closed (return empty list or 403).
- Historical state records (created before migration 013) infer location type as `'state'`
  when `state_id IS NOT NULL`.

**No issue found in scoping logic.**

---

## 8. Sector Relationship

- Plans have a primary `sector` (TEXT) and a `sectors` (JSONB array) for multi-sector.
- `getPlanMeta` returns effective sector: `COALESCE(NULLIF(pl.sector,''), p.sector)`.
- TC restriction: list query checks overlap with `sectors` JSONB array OR primary sector.
- Multi-sector plans with ambiguous project links were flagged with `migration_review_notes`
  in migration 002, then their `sector` was set to NULL in migration 003.
- No bulk-remediation of these plans has occurred — they appear with blank sector in the UI.
  This is PLAN-009 (P2).

---

## 9. Planning Period

- `start_date` and `end_date` are the period boundaries.
- Nullable in draft (migration 003 dropped NOT NULL).
- Required for Save & Finish (`isCompleteSave = body.closeRegistration === true`).
- No date-ordering constraint in the database (`end_date >= start_date` not enforced by CHECK).
- Frontend validates ordering; a direct API call can insert start > end. See PLAN-011 (P2).

---

## 10. Authoring / Access Matrix

Role | View | Create | Edit | Submit | Tech Review | Coord Review | Final Approve | Delete | Reopen
---|---|---|---|---|---|---|---|---|---
Programme Manager | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓
Super Admin | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓
Senior Programme Coordinator | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ | ✓ (programme-scoped)
Technical Coordinator | ✓ (sector) | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ (sector)
Executive Director | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓
State Programme Officer | ✓ (state) | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗
State Office Manager | ✓ (state) | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗
Viewer | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗

**Note on SOM:** The `plans.ts` workflow documentation (lines 57–60) correctly states
"State Office Manager is monitoring-only." Verified against real `permissionsFor()`:
SOM does NOT receive `plans.create` or `plans.update`. PLAN-BD-3 is resolved — SOM
is already enforced as monitoring-only. The earlier audit draft was mistaken on
this point. The only grant for SOM is `plans.view` (via the shared view block). The permission grant is implemented as-coded. This discrepancy must be
resolved — see PLAN-BD-3.

**Note on Submit permission:** Submit uses `plans.create` (not a dedicated `plans.submit`),
meaning any role that can create a plan can also submit it.

---

## 11. Full Operational Access (#373)

PM and super_admin use shared helpers:
- `hasFullOperationalAccess()` in `accessControl.ts` checks `role === 'program_manager' || role === 'super_admin'`.
- PM permission grants in `currentUser.ts` are explicit and auditable (lines 285–315).
- Full Access is **not** applied to structural workflow sequencing: transition guards check
  expected source status regardless of actor role (confirmed in tests PLAN-AUDIT-10).
- `isPlanCurrentlyEditable()` enforces the approval lock regardless of permissions.
- Override metadata (`used_override`, `override_reason`) is recorded in `approvals` table
  for reopen actions (mandatory reason parameter).

**No Full Operational Access bypass found.**

---

## 12. Create / Draft / Edit Lifecycle

### Create (POST /plans)

- Requires `plans.create`.
- Minimum Draft: title + location (stateId or locationType=hq).
- `plan_type`, `start_date`, `end_date` are nullable in draft (migration 003).
- **P0 FIX APPLIED:** `body.status` was accepted verbatim, allowing creation of plans
  in any status (including `approved`). Fixed to always insert `'draft'`.
- Save As Draft: single POST, registration session token returned (2-hour TTL, SHA-256 in DB).
- Save & Finish (`closeRegistration=true`): full validation within a transaction with
  `SELECT ... FOR UPDATE` on the plan row.

### Continue Editing (PATCH /plans/:planId)

- With `plans.update`: open gate, no session token needed.
- Without `plans.update`: requires valid session token (plan+user bound).
- `isPlanCurrentlyEditable()` checked on every PATCH.
- **P0 FIX APPLIED:** `body.status` in PATCH was forwarded directly to `SET status = $n`,
  allowing workflow bypass. Fixed: `status` is silently ignored in PATCH; all status
  changes must use `/transitions`.
- Identity fields (project_id, state_id, sector) can change in draft.
  After submission, the approval lock prevents all edits.

---

## 13. Submission Contract

Server-side submit validation (inside transaction with `SELECT ... FOR UPDATE`):

Required for submit:
- Non-blank title
- Valid plan type
- start_date and end_date present
- At least one sector from canonical list
- Non-blank responsible name
- At least one activity passing `validatePlanActivityReadiness`
- Valid currency (USD/SDG/EUR/AED)
- Non-negative, finite budget_planned
- Activity budget total ≤ plan budget

Malformed payloads (null arrays, invalid dates, negative values, junk nested rows)
return controlled 400/422 errors. No 500 observed in code review.

**No bypass found after P0 fix.**

---

## 14. Workflow

Full state machine from `plans.ts:111–124`:

```
draft ──submit──► submitted ──technical_review──► technically_approved
                |             ──coordination_review──► coordination_approved
                |               ──final_approve──► approved
                |                 ──activate──► active
                |                   ──start──► in_progress
                |                 ──mark_delayed──► delayed
                |                 ──complete──► completed
                |                 ──cancel──► cancelled
                |                   completed/cancelled ──archive──► archived
                |
                └── (reviewer uses request_revision) ──► draft (plan remains editable; author can revise and resubmit)
                └── (reviewer uses reject) ──► rejected  ← TERMINAL: no programmatic exit
```

**`rejected` is a terminal status.** No transition in `PLAN_TRANSITIONS` accepts `rejected`
as a source. `request_revision` is only available from `submitted`, `technically_approved`,
and `coordination_approved` — i.e. the reviewer must choose between returning for revision
(`request_revision → draft`) or permanently closing (`reject → rejected`) before the plan
leaves one of those three states. Once rejected, there is no programmatic recovery path.

This is documented as PLAN-BD-5 (see §37).

Reopen path (post-final-approval only, from approved/active/in_progress/delayed):
```
approved|active|in_progress|delayed ──reopen──► draft
```

---

## 15. Revision / Resubmit

- `request_revision` returns plan to `draft` with a mandatory comment. This is the
  reviewer's "send back for revision" action and is available from `submitted`,
  `technically_approved`, and `coordination_approved`.
- The plan ID is preserved throughout — no new Plan is created.
- After revision, author can PATCH and re-submit via the `submit` transition.
- `reject` transitions to `rejected`. **`rejected` is a terminal status** — no transition
  accepts it as a source. There is no programmatic way to recover a rejected plan.
  Reviewers must use `request_revision` if they intend to allow the author to revise.
- Registration sessions are revoked when leaving draft (on submit).

---

## 16. Plan Content Model

Plans contain:
- **Header fields**: title, type, frequency, period, sectors, localities, description, objectives (JSONB).
- **Responsible party**: `responsible_name` (free text) + optional `responsible_user_id` FK.
- **Budget**: plan-level `budget_planned`, `budget_actual`, `currency`, `funding_source`.
- **Activities**: rows in `plan_activities` table (see §17).
- **Linked risks**: via `r.plan_id` or `r.plan_activity_id`.

---

## 17. Actions / Activities

`plan_activities` table fields per activity:

| Field | Type | Required | Notes |
|---|---|---|---|
| `title` | TEXT | Yes (on create; blank rows skipped) | |
| `description` | TEXT | No | |
| `objective_index` | INT | No | Which plan objective this supports |
| `responsible_name` | TEXT | No | Free text |
| `responsible_user_id` | INT FK | No | Optional user link |
| `locality_name` | TEXT | No | |
| `state_id` / `state_name` | INT/TEXT | No | |
| `planned_date` | DATE | No | |
| `start_date` / `end_date` | DATE | No | |
| `target_beneficiaries` | INT | No | Must be ≥ 0 if present |
| `priority` | TEXT | No | high/medium/low; defaults to medium |
| `expected_result` | TEXT | No | |
| `status` | TEXT | Yes (defaults to `planned`) | planned/in_progress/completed/delayed/cancelled |
| `progress_pct` | INT | No | 0–100, manually entered |
| `budget_planned` / `budget_actual` | FLOAT | No | |
| `risk_id` | INT FK | No | Linked risk |
| `mitigation_action` | TEXT | No | |
| `expected_output` | TEXT | No | |
| `performance_indicator` | TEXT | No | |

Activities are ordered by `id` (insertion order). No explicit user-controlled ordering field.

**No activity-level comments or attachments found.**

---

## 18. Responsibilities

- `responsible_name` is free text on both plan and activity level.
- `responsible_user_id` is an optional FK to the `users` table.
- No deactivated-user handling: if a user is deactivated, their name still appears.
- No validation that `responsible_user_id` belongs to an active/enabled user.
- This is PLAN-010 (P2).

---

## 19. Progress / Completion

**Finding:** `progressPct` at the plan level is computed as `AVG(pa.progress_pct)::int`
where `progress_pct` is a **manually entered integer (0–100) per activity**, not derived
from activity `status`. A completed activity with `progress_pct = 0` contributes 0 to
the average. This is potentially misleading.

Plan-level `progressPct`:
- Returns `NULL` (not 0) when the plan has no activities.
- Returns the integer average of all activities' manual `progress_pct` values.
- Frontend must display `null` as "—" not "0%".

This is PLAN-BD-4 — requires a business decision on whether progress should be
auto-derived from activity completion status or remain manually entered.

---

## 20. Indicators

No indicator targets or actuals were found on the plan record or `plan_activities` table.
The `performance_indicator` field on activities is a free-text string (not a linked
indicator entity). There is no integration with the indicators/results framework used
in project reports.

**Confirmed: no indicator entity linkage.**

---

## 21. Budget / Cost Boundary

- Plans have `budget_planned`, `budget_actual`, `currency`, `funding_source`.
- These are **plan-level planning estimates only**.
- No code path in `plans.ts` touches `projects.budget_total` or state budget allocations.
- Budget isolation confirmed by code review: grep for `budget_total` in `plans.ts` → 0 results.

**Budget boundary confirmed. No cross-contamination.**

---

## 22. Project Integration

- Plans tab in project detail shows plans filtered by `project_id`.
- Draft plans are included in the list.
- Create from project tab passes `project_id` automatically.
- Deep links (`/plans/:id`) work correctly.
- No plans from other projects are visible via the project Plans tab.

**No issue found.**

---

## 23. Reports Integration

**Finding:** There is **no automatic integration** between Report submission and Plan
progress or status. `plan_id` does not appear as a field in `reports.ts` query results.
No trigger, event, or post-commit hook updates any plan field when a report is submitted.

The Plans list and dashboard show factual plan activity progress (manually entered).
Any UI copy implying that reports drive plan progress would be misleading. No such copy
was found in the current implementation.

---

## 24. Risks Integration

- Risks can be linked to plans via `r.plan_id` or to plan activities via `r.plan_activity_id`.
- Plan detail fetches linked risks via a LEFT JOIN / subquery combination.
- Dashboard risk count aggregates across plan-linked and activity-linked risks.
- No risk-gating on plan transitions found.

---

## 25. Attachments / Comments

**Attachments:** Plans do **not** support file attachments. No upload endpoint or storage
reference for plans was found. This is documented explicitly — the UX does not imply
attachment support.

**Comments:** Comments are stored in the `comments` table with `entity_type='plan'`.
Used for revision requests and rejection reasons. Returned-revision feedback is recorded
but no explicit UI for authors to view inline reviewer feedback in edit mode was found.
This is PLAN-012 (P3).

**Notifications:**
- Structured notifications via `notifyEntityActorsDeduped` and `notifyNextApprover`.
- Called after COMMIT for non-submit transitions (non-transactional — a notification
  failure does not roll back a committed transition, by design).
- For submit, notifications fire post-COMMIT.
- Responsible-user notified on plan creation.
- `notifyNextApprover` uses sector to route to the correct TC/SPC/PM.
- Deep-link notification URLs point to `/plans/:planId` — stale notifications are
  safe to follow (plan detail handles all states).

---

## 26. Notifications

Notification triggers and recipients:

| Event | Actors Notified | Method |
|---|---|---|
| Create (with responsible user) | responsible user | `createNotification` |
| Submit / re-submit | all plan actors except submitter | `notifyEntityActorsDeduped` + `notifyNextApprover` |
| Technical review | all plan actors | `notifyEntityActorsDeduped` + `notifyNextApprover` |
| Coordination review | all plan actors | `notifyEntityActorsDeduped` + `notifyNextApprover` |
| Final approve | all plan actors | `notifyEntityActorsDeduped` |
| Request revision | all plan actors (mandatory) | `notifyEntityActorsDeduped` |
| Reject | all plan actors (mandatory) | `notifyEntityActorsDeduped` |
| Operational transitions (activate/start/delay/complete/cancel/archive) | all plan actors | `notifyEntityActorsDeduped` |
| Reopen | all plan actors (mandatory) | `notifyEntityActorsDeduped` |

Ghost notification risk: post-COMMIT notification failures are logged but do not affect
plan state. Stale deep links are safe — plan detail handles all states correctly.

---

## 27. Plan Dashboard / Analytics

Dashboard (`GET /plans/dashboard`) aggregates:
- **Totals**: total plans, active (active+in_progress), delayed, completed, draft.
- **Awaiting approval**: submitted + technically_approved + coordination_approved.
- **Budget**: sum of budget_planned/budget_actual, burn rate %.
- **Activity totals**: total, completed, overdue/delayed.
- **Upcoming deadlines**: activities ending within 30 days, limit 50.
- **By state / sector / type**: breakdown rows.
- **Risk count**: distinct risks linked to plans in scope.

Scoping:
- TC: restricted to assigned sectors (fails-closed on empty assignment).
- State roles: clamped to own state; null-stateId fails-closed.
- PM/super_admin: full scope.

**No invented performance scores found.** No traffic-light composites. All metrics are
factual counts or averages.

N+1 risk: The dashboard executes ~7 parallel queries (`Promise.all`), which is acceptable.
No per-row N+1 found.

---

## 28. Delete / Archive

`DELETE /plans/:planId`:
- Requires `plans.delete` (ED + PM only).
- Sector and state guards applied.
- Within a transaction: deletes `plan_activities` then `plans`.
- **No status restriction** — can delete plans in any status including `approved`.
- **Does not cascade**: `plan_registration_sessions`, `approvals` (entity_type='plan'),
  `comments` (entity_type='plan'), and `audit_log` rows are not explicitly deleted.
- FK behaviour for these tables is not specified in known migration files.
- Orphan risk depends on whether FK `ON DELETE CASCADE` exists.
- This is PLAN-005 (P1).
- Audit trail: one `audit_log` entry written, then the plan row is deleted. The audit
  log entry survives (as in project deletion architecture).

Archive (`archive` transition) is a status transition, not a delete. It is safe and reversible.

---

## 29. Direct Endpoint Security

| Endpoint | Auth | Permission | Sector Guard | State Guard | Notes |
|---|---|---|---|---|---|
| GET /plans | ✓ | none explicit (router auth) | ✓ (TC) | ✓ (SPO/SOM clamped) | |
| GET /plans/dashboard | ✓ | none explicit | ✓ (TC) | ✓ (SPO/SOM clamped) | |
| GET /plans/:id | ✓ | none explicit | ✓ | ✓ | |
| POST /plans | ✓ | `plans.create` | ✓ | ✓ | P0 fix applied |
| PATCH /plans/:id | ✓ | `plans.update` OR session token | ✓ | ✓ | P0 fix applied |
| POST /plans/:id/transitions | ✓ | per-action perm | ✓ | ✓ | P1 race (see PLAN-004) |
| POST /plans/:id/close-registration | ✓ | token-only (no requirePerm) | ✗ | ✗ | PLAN-008 |
| DELETE /plans/:id | ✓ | `plans.delete` | ✓ | ✓ | |
| POST /plans/:id/reopen | ✓ | `plans.reopen` | ✓ | ✓ | P1 lock race (PLAN-006) |

**IDOR:** Sector and state guards prevent cross-scoped access to individual plan records.
A TC cannot read another sector's plan via `GET /plans/:id` — `assertSectorAllowed` is
called on detail fetch.

**close-registration note:** The token is plan+user bound (SHA-256). An unauthenticated
actor cannot call this endpoint (authentication required). However, any authenticated user
who obtains a valid token for any plan/user combination can call this endpoint. In practice
the token is only returned to the creating user in the POST response. Risk is low but
documented as PLAN-008 (P2).

---

## 30. Audit History

- Every status transition writes to `audit_log`.
- `audit_log` entries include: user_id, action, module='plans', entity_id, old_value, new_value.
- Reopen writes a structured audit entry including reason, previous approval date, and role.
- Registration open/close audited.
- `audit_log` rows survive plan deletion (the plan record is deleted but audit entries
  remain by design, consistent with project deletion architecture).

---

## 31. API Contract

- `locationType` added by migration 013 but **absent from generated types** (`PlanSummary`,
  `PlanDetail` in `lib/api-client-react`). Frontend uses `plan.locationType` at lines
  801, 804 (plan-detail.tsx) and 956 (plans.tsx), causing TS2339 errors. PLAN-007 (P2).
- `progressPct` is present in generated types (type `number | undefined`). Correct.
- `planType` / `plan_type` mapping is consistent (camelCase in API response, snake_case in DB).
- Nullable fields (plan_type, start_date, end_date) correctly typed as optional.
- `sectors` JSONB field returned as `string[]` in summary. Correct.

---

## 32. Database / Migrations

Migrations affecting plans (in execution order):

| Migration | Effect |
|---|---|
| `001_plan_registration_sessions` | Creates `plan_registration_sessions` table with SHA-256 token hash |
| `002_sector_unification` | Resolves unambiguous Multi-Sector plans; flags ambiguous with `migration_review_notes`; renames sectors |
| `003_nullable_plan_fields` | Drops NOT NULL on `plan_type`, `start_date`, `end_date`; NULLifies remaining Multi-Sector values |
| `013_hq_location_type` | Adds `location_type TEXT` to plans; drops NOT NULL on `state_id` |

**Schema gaps:**
- No `CREATE TABLE plans` found in the migration runner — the base `plans` table schema
  must exist in the initial DB schema or was applied outside the migration runner. This
  is a documentation gap (PLAN-013, P2).
- No unique index on `plans` for duplicate prevention (PLAN-003, P1).
- No `CHECK` constraint enforcing `end_date >= start_date` (PLAN-011, P2).
- No `CHECK` constraint on `plan_type` valid values (values validated in application code).
- FKs: `project_id` references projects, `state_id` references states, `created_by_id`
  references users. `ON DELETE` behaviour not confirmed — assumed RESTRICT/NO ACTION.

---

## 33. UX / Accessibility

- **Status badges**: present in plans list and plan detail. Colour not the sole indicator
  (status labels shown). No issue found.
- **Progressive disclosure**: create dialog has five tabs with free navigation. Validation
  separated between Save As Draft (minimal) and Save & Finish (full).
- **Locked fields in edit mode**: SectorPicker, LocalityInput, etc. pass `disabled` prop
  based on `canEdit` flag. Correct.
- **TypeScript errors** on `locationType`: `plans.tsx:956`, `plan-detail.tsx:801/804` use
  `p.locationType` / `existing.locationType` which are absent from generated types.
  UI degrades silently (undefined → falsy path). PLAN-007 (P2).
- **Heading hierarchy**: not audited in code review; requires browser/Playwright check.
- **ARIA**: `disabled` props set on form controls when `!canEdit`. No explicit `aria-invalid`
  wiring found on plan form fields. PLAN-014 (P3).
- **Keyboard navigation**: activity row controls (Select, Input) are standard Radix/HTML
  elements and inherit keyboard accessibility. No custom focus trap audit performed.
- **Responsive**: multiple view modes (grid/list/compact/kanban/calendar) in plans.tsx.
  Responsive classes used. Not deep-audited.
- **`planning-dashboard.tsx`**: deprecated redirect — routes `/planning-dashboard` to
  canonical `/plans`. No accessibility burden.

---

## 34. Performance

- List query: single `planSummarySelect` with LEFT JOINs and a correlated subquery for
  activity AVG/COUNT per plan. For large datasets this is an N+1 in disguise.
  PLAN-015 (P3).
- Dashboard: 7 parallel `pool.query` calls via `Promise.all`. Acceptable.
- No missing indexes found on filter columns (plan_type, state_id, status, project_id)
  — however these were not confirmed present; assumed from query plan, not EXPLAIN output.
- Registration-session table has index on `(plan_id, user_id)`. Token lookup uses
  `token_hash` which is UNIQUE. Efficient.

---

## 35. Test Coverage

| Area | Existing Test File | Coverage Quality | Missing Cases | Priority |
|---|---|---|---|---|
| Plan types / statuses / frequencies | planning-workspace.test.ts | Good | None found | — |
| Budget logic | plan-budget.test.ts | Good (35 acceptance criteria) | None found | — |
| Status dashboard aggregations | planning-workspace.test.ts | Good | — | — |
| Activity completion % | planning-workspace.test.ts | Good | — | — |
| Role matrix (backend) | pm-full-operational-access.test.ts (partial) | Partial | SPO/SOM/ED/TC/SPC not covered | P1 |
| Workflow transitions (backend API) | None | **None** | All transitions | P0 |
| IDOR / cross-scope security (backend API) | None | **None** | Cross-state, cross-sector | P0 |
| Registration session security | planning-workspace.test.ts (client-side) | Partial | Server-side token validation | P1 |
| isPlanCurrentlyEditable (backend) | planning-workspace.test.ts (frontend mirror) | Good | Backend direct test | P1 |
| DELETE cascade | None | None | Orphan cleanup | P1 |
| Unique index / duplicate prevention | None | None | DB-level | P1 |
| Date ordering constraint | None | None | API bypass | P2 |
| Deactivated responsible user | None | None | API bypass | P2 |
| locationType TS errors | None | None | Type generation | P2 |

**Sentinel tests added by this audit:** `src/test/plan-audit-sentinel.test.ts`
(PLAN-AUDIT-01 through PLAN-AUDIT-10).

---

## 36. Findings Register

### PLAN-001 (P0 — FIXED) — POST /plans accepted arbitrary status via body

| Field | Value |
|---|---|
| **Severity** | P0 — Security / Data Corruption |
| **Evidence** | `plans.ts:868` — `String(body.status ?? "draft")` inserted directly |
| **Current (before fix)** | Any caller with `plans.create` could create a plan with `status='approved'`, bypassing the entire workflow |
| **Expected** | `POST /plans` always inserts `'draft'`; transitions use `/plans/:id/transitions` |
| **Risk** | Workflow bypass, data corruption, approval history gaps |
| **Fix** | Line 868: replaced `String(body.status ?? "draft")` with hardcoded `"draft"` |
| **Tests** | PLAN-AUDIT-05: test 05-02 |
| **BD?** | No |

---

### PLAN-002 (P0 — FIXED) — PATCH /plans allowed direct status mutation

| Field | Value |
|---|---|
| **Severity** | P0 — Security / Data Corruption |
| **Evidence** | `plans.ts:1146` — `if (body.status !== undefined) set("status", String(body.status))` |
| **Current (before fix)** | Any caller with `plans.update` or a valid registration session could PATCH the plan status to any value, bypassing transition guards and approval history |
| **Expected** | `PATCH /plans/:id` never mutates `status`; all status changes use `/transitions` |
| **Risk** | Workflow bypass, approval history gaps, data corruption |
| **Fix** | Line 1146: removed status mutation; replaced with comment |
| **Tests** | PLAN-AUDIT-05: test 05-01 |
| **BD?** | No |

---

### PLAN-003 (P1) — No unique index on plans table

| Field | Value |
|---|---|
| **Severity** | P1 — Data Integrity |
| **Evidence** | No `CREATE UNIQUE INDEX` on plans found in any migration. No duplicate-check endpoint. |
| **Current** | Identical plans (same title, project, period, sector) can be created freely |
| **Expected** | At minimum a soft duplicate-check endpoint; optionally a DB unique index |
| **Risk** | Duplicate approval workflows, confused reviewers, wasted effort |
| **Dependency** | Requires PLAN-BD-2: business decision on canonical identity dimensions |
| **Fix** | After BD-2 resolution: add unique index and duplicate-check endpoint |
| **Tests** | None yet — requires backend API test |
| **BD?** | Yes — PLAN-BD-2 |

---

### PLAN-004 (P1) — Non-submit transitions non-atomic; UPDATE lacks status predicate

| Field | Value |
|---|---|
| **Severity** | P1 — Data Integrity / Race Condition |
| **Evidence** | `plans.ts:1780` — `pool.query("UPDATE plans SET status=$1...WHERE id=$2")` — no `WHERE status=$3` predicate; not wrapped in a transaction |
| **Current** | Two concurrent non-submit transition requests can both read the expected from-status, both pass the guard, and both update to the to-status. Duplicate approval/audit rows written. |
| **Expected** | Either: `UPDATE plans SET status=$1 WHERE id=$2 AND status=$3` with `RETURNING` to detect concurrent update; or wrap in BEGIN/COMMIT with FOR UPDATE |
| **Risk** | Duplicate approvals rows, duplicate audit entries, stale state reads |
| **Fix** | Add `AND status = $3` predicate to transition UPDATEs; check RETURNING rowcount = 1 |
| **Tests** | Requires backend API test with concurrent requests |
| **BD?** | No |

---

### PLAN-005 (P1) — DELETE does not cascade registration sessions, approvals, or comments

| Field | Value |
|---|---|
| **Severity** | P1 — Data Integrity |
| **Evidence** | `plans.ts:1444–1455` — DELETE transaction only removes `plan_activities` then `plans`. No explicit DELETE for `plan_registration_sessions`, `approvals`, or `comments`. |
| **Current** | Deleting a plan may leave orphaned rows in those tables (depends on FK ON DELETE behaviour, not confirmed) |
| **Expected** | Cascade DELETE or explicit DELETE in the transaction; OR confirm FK CASCADE is in place |
| **Risk** | Orphaned sessions, approval audit records referencing non-existent plans |
| **Fix** | Add explicit DELETEs for plan_registration_sessions, approvals (entity_type='plan'), and comments (entity_type='plan') inside the DELETE transaction; OR add `ON DELETE CASCADE` FK |
| **Tests** | Requires backend API test |
| **BD?** | No |

---

### PLAN-006 (P1) — Reopen FOR UPDATE issued outside transaction

| Field | Value |
|---|---|
| **Severity** | P1 — Race Condition |
| **Evidence** | `plans.ts:1855` — `pool.query("SELECT...FOR UPDATE")` using the pool directly; the enclosing transaction is opened separately via `pool.connect()` afterwards |
| **Current** | The FOR UPDATE row lock is statement-scoped and released before the UPDATE transaction begins. Two concurrent reopen requests can both acquire the lock in sequence and both proceed. |
| **Expected** | `FOR UPDATE` must be inside the same `client.query("BEGIN")` transaction |
| **Risk** | Duplicate reopen approvals rows; plan left with two active reopen sessions |
| **Fix** | Acquire a client, `BEGIN`, then `SELECT ... FOR UPDATE`, then UPDATE, then COMMIT — all on the same client |
| **Tests** | Requires backend API test with concurrent reopen calls |
| **BD?** | No |

---

### PLAN-007 (P2) — `locationType` absent from generated PlanSummary / PlanDetail types

| Field | Value |
|---|---|
| **Severity** | P2 — TypeScript / Build Confidence |
| **Evidence** | `plan-detail.tsx:801,804` TS2339 `Property 'locationType' does not exist on type 'PlanDetail'`. `plans.tsx:956` same on `PlanSummary`. Migration 013 added the column; API returns it; generated types are stale. |
| **Current** | TypeScript errors in build; runtime works because JS ignores type errors; `formatLocation()` called with undefined `locationType` falls back gracefully |
| **Expected** | `locationType` added to generated types or handwritten overrides |
| **Fix** | Regenerate api-client-react types OR add type extension until regeneration is configured |
| **Tests** | PLAN-AUDIT-03: test 03-08 (documents the field contract) |
| **BD?** | No |

---

### PLAN-008 (P2) — close-registration endpoint has no requirePerm middleware

| Field | Value |
|---|---|
| **Severity** | P2 — Security (low exploitability) |
| **Evidence** | `plans.ts:1407` — endpoint checks authentication and token validity but has no `requirePerm()` call. Token is plan+user bound (SHA-256). |
| **Current** | Any authenticated user who obtains a valid token can close any registration session. Token is only issued to the creating user, so practical risk is low. |
| **Expected** | The endpoint is intentionally token-gated only; this is a documented design choice. However, explicit note in code or requirePerm("plans.update") || tokenValid guard would be cleaner. |
| **Risk** | Token leak (e.g. via network interception) allows session close by third party |
| **Fix** | Low priority: add inline comment confirming the token-only design is intentional; optionally add requirePerm("plans.create") |
| **Tests** | PLAN-AUDIT-04: test 04-02 (token scope) |
| **BD?** | No |

---

### PLAN-009 (P2) — Multi-Sector plans with NULL sector not surfaced to staff

| Field | Value |
|---|---|
| **Severity** | P2 — Data Integrity |
| **Evidence** | Migration 002 sets `migration_review_notes` on ambiguous Multi-Sector plans. Migration 003 sets `sector = NULL`. No UI indicator for plans with non-null `migration_review_notes`. |
| **Current** | Ambiguous plans appear with blank sector in the UI. Staff cannot identify them without a DB query. |
| **Expected** | Plans with `migration_review_notes IS NOT NULL` shown with a "Needs sector review" badge in admin view |
| **Risk** | TC scoping misses these plans; analytics excludes them from sector breakdowns |
| **Fix** | Add `migration_review_notes` to plan summary response; show badge in plan list for ED/PM |
| **Tests** | None yet |
| **BD?** | No |

---

### PLAN-010 (P2) — No deactivated-user handling for responsible_user_id

| Field | Value |
|---|---|
| **Severity** | P2 — Data Quality |
| **Evidence** | No validation in PATCH or create that `responsible_user_id` references an active/enabled user |
| **Current** | Plans can be assigned to disabled users; notifications to disabled users may silently fail |
| **Expected** | Validate `responsible_user_id` is an active user on write; or display "(Deactivated)" in UI |
| **Risk** | Notifications lost; reviewer cannot contact responsible person |
| **Fix** | Add `AND u.status = 'active'` to responsible-user lookup validation on write |
| **Tests** | None yet |
| **BD?** | No |

---

### PLAN-011 (P2) — No date-ordering constraint (end_date ≥ start_date)

| Field | Value |
|---|---|
| **Severity** | P2 — Data Integrity |
| **Evidence** | No `CHECK (end_date >= start_date)` in any migration. Frontend validates ordering; a direct API call can insert start > end. |
| **Current** | A crafted PATCH or POST can create a plan with `start_date = '2026-12-31', end_date = '2026-01-01'` |
| **Expected** | Server-side date ordering validation in both POST and PATCH, plus optional DB CHECK |
| **Risk** | Misleading analytics; dashboard "upcoming deadlines" may misfire |
| **Fix** | Add server-side validation in POST complete-save and PATCH; add DB CHECK constraint |
| **Tests** | Requires backend API test |
| **BD?** | No |

---

### PLAN-012 (P3) — No inline reviewer feedback view for authors in revision mode

| Field | Value |
|---|---|
| **Severity** | P3 — UX |
| **Evidence** | Comments (revision requests) are stored in `comments` table. No component in `plan-detail.tsx` fetches or displays revision comments to the plan author when the plan is in `draft` after `request_revision`. |
| **Current** | Authors cannot see reviewer feedback inline when editing a returned plan |
| **Expected** | Returned-draft authors see revision-request comments inline (as in SPR revision flow) |
| **Risk** | Authors miss reviewer guidance; quality of revisions reduced |
| **Fix** | Add a comments panel to plan-detail.tsx for `draft` plans that have prior `revision_request` comments |
| **Tests** | None yet |
| **BD?** | No |

---

### PLAN-013 (P2) — Base plans table schema not in migration runner

| Field | Value |
|---|---|
| **Severity** | P2 — Documentation / Ops |
| **Evidence** | No `CREATE TABLE plans` found in `run-migrations.ts`. The table is altered by migrations 002, 003, 013 but never created there. |
| **Current** | Fresh DB setup requires the base schema to exist before migrations run. Source of base schema is unknown. |
| **Expected** | Either a migration 000 or a schema.sql file that is documented and referenced |
| **Risk** | Fresh environment setup fails silently; staging/DR environments may diverge |
| **Fix** | Document or add the base plans table CREATE TABLE as migration 000 or initial schema |
| **Tests** | None yet |
| **BD?** | No |

---

### PLAN-014 (P3) — No aria-invalid on plan form fields

| Field | Value |
|---|---|
| **Severity** | P3 — Accessibility |
| **Evidence** | `create-plan-registration-dialog.tsx` and `plan-detail.tsx` do not wire `aria-invalid` on form inputs when validation errors are present |
| **Current** | Screen readers cannot announce which field failed validation |
| **Expected** | `aria-invalid="true"` set on each field with an active error |
| **Fix** | Add `aria-invalid={!!errors.fieldName}` to each form control |
| **Tests** | None yet |
| **BD?** | No |

---

### PLAN-016 (P3) — Wrong-source-status transition returns 400 instead of 409

**Title:** Wrong-source-status transition returns 400 (Bad Request) instead of 409 (Conflict)

**Severity:** P3 — UX / API contract

**Evidence:** `plans.ts:1502–1504`
```javascript
if (!transition.from.includes(fromStatus)) {
  res.status(400).json({ error: `cannot_${action}_from_${fromStatus}` });
}
```

**Current:** HTTP 400 returned when a transition is attempted from a wrong source status.

**Expected:** HTTP 409 Conflict is the semantically correct status for a workflow
state-machine conflict. The client has made a well-formed request; the rejection is
not due to bad syntax but a state conflict.

**Risk:** API consumers checking for 409 to detect state conflicts will miss the error.
Frontend can special-case the `cannot_*` prefix, but the HTTP contract is misleading.

**Dependency:** None.

**Fix:** Change `res.status(400)` to `res.status(409)` at `plans.ts:1503`.
Update frontend error handler if it relies on the 400 status.

**Tests:** Backend sentinel 06-01 through 06-04 document the current 400 behaviour.
Update to 409 after fix.

**BD?** No — purely a semantic HTTP status correction.

---

### PLAN-017 (P1) — rejected plans have no programmatic recovery path

**Title:** Rejected plans are permanently terminal — no coded path back to Draft

**Severity:** P1 — Core Workflow / Lifecycle

**Evidence:** `PLAN_TRANSITIONS` (`plans.ts:111–124`): no transition lists `rejected`
as a source status. `REOPENABLE_STATUSES` excludes `rejected`.

**Current:** Once a reviewer uses `reject`, the plan cannot be returned to `draft`.
There is no `undo_reject`, no `request_revision`-from-rejected, no reopen path.

**Expected:** Intent unclear — see PLAN-BD-5. If `reject` is intended as permanent
closure, the UI must make this unmistakably clear to reviewers before they act.
If recovery should be possible, a transition must be added.

**Risk:** Reviewers who intend `reject` as "send back with strong feedback" will
inadvertently permanently close a plan, requiring the author to start over.

**Dependency:** PLAN-BD-5 (business decision).

**Fix (pending BD-5):** Either: (a) add clear UI warning that `reject` is permanent,
or (b) add a `undo_reject` transition and update `PLAN_TRANSITIONS`.

**Tests:** Backend sentinel 09-01 through 09-05 confirm the terminal invariant.

**BD?** Yes — see PLAN-BD-5.

---

### PLAN-015 (P3) — Correlated activity subquery per plan in list (potential N+1)

| Field | Value |
|---|---|
| **Severity** | P3 — Performance |
| **Evidence** | `planSummarySelect` contains `(SELECT AVG(pa.progress_pct)::int FROM plan_activities pa WHERE pa.plan_id = pl.id)` and `(SELECT COUNT(*)::int FROM plan_activities pa WHERE pa.plan_id = pl.id)` — correlated subqueries per plan row |
| **Current** | For large plan lists (100+ plans), these subqueries execute once per plan row |
| **Expected** | Replace with a single LEFT JOIN to a pre-aggregated subquery |
| **Fix** | Replace correlated subqueries with `LEFT JOIN (SELECT plan_id, AVG(progress_pct)::int AS avg_pct, COUNT(*) AS cnt FROM plan_activities GROUP BY plan_id) pa ON pa.plan_id = pl.id` |
| **Tests** | None yet (performance test) |
| **BD?** | No |

---

## 37. Business Decisions Required

### PLAN-BD-5: Recovery path for rejected plans

**Question:** A plan in `rejected` status has no programmatic exit. Is this intentional?

Two interpretations:
- (a) `rejected` is intentionally terminal — a rejected plan is closed and cannot be
  revised. The author must create a new plan if they wish to proceed.
- (b) `rejected` should allow recovery — either via a new `undo_reject` transition
  (→ coordination_approved/submitted) or by accepting `rejected` in `request_revision.from`.

**Current state:** `rejected` is terminal. No UI, permission, or transition allows recovery.

**Risk of ambiguity:** If reviewers intend `reject` as a "strong return for revision" rather
than permanent closure, the current model silently discards the plan.

**Decision required:** Confirm terminal intent or specify the recovery path.

---

### PLAN-BD-1: Type-specific routing or validation

**Question:** Do different plan types (monthly/quarterly/emergency/etc.) have distinct:
- Approval workflows (e.g. emergency bypasses coordination review)?
- Required fields (e.g. emergency must have a response date)?
- Reviewer assignments (e.g. emergency routed to ED)?

**Current state:** All 7 types share the identical workflow and validation.

**Decision required:** Confirm type-specific treatment or confirm one-workflow-for-all is correct.

**Risk of deferral:** If emergency plans truly need faster review, the current workflow does not support it.

---

### PLAN-BD-2: Canonical Plan identity dimensions for duplicate prevention

**Question:** What combination of fields makes two Plans duplicates?

Candidate dimensions:
- (a) `title + project_id + period` — same plan for the same project in the same period
- (b) `plan_type + project_id + state_id + frequency + start_date` — structural uniqueness
- (c) `code` alone — if codes are truly unique
- (d) Soft warning only (no hard unique constraint) — operators choose

**Current state:** No uniqueness protection. Any combination can be duplicated.

**Decision required:** Define the identity rule before adding a unique index or check endpoint.

---

### PLAN-BD-3: ~~SOM plans.create/plans.update~~ — RESOLVED

**Resolution (confirmed by sentinel test 02-08 against real `permissionsFor()`):**
SOM does NOT have `plans.create` or `plans.update`. The monitoring-only comment in
`plans.ts` is accurate and the implementation is correct. No action required.

---

### PLAN-BD-4: progressPct — manual entry vs auto-derived from activity status

**Question:** Should `progressPct` at the plan and activity level be:
- (a) Manually entered by the responsible person (current behaviour) — explicit control,
  may diverge from activity completion status.
- (b) Auto-computed from activity `status` (completed activities / total activities × 100) —
  consistent with what reviewers expect.
- (c) Hybrid: manually entered per-activity, but plan-level derived from completion count.

**Current state:** Manually entered per activity; plan level = AVG(pa.progress_pct).

**Risk of status quo:** A plan with all activities in `completed` status may show 0%
progress if `progress_pct` was never updated.

---

## 38. Implementation Roadmap

### P0 — Completed in this audit

| Task | Files | Status |
|---|---|---|
| Fix POST /plans status injection | plans.ts | **Done** |
| Fix PATCH /plans status bypass | plans.ts | **Done** |

---

### P1 — Core Workflow / Structural Hardening

| Task | Files | Priority |
|---|---|---|
| Add status predicate to non-submit transition UPDATEs (race fix) | plans.ts | P1 |
| Move reopen FOR UPDATE inside BEGIN transaction (race fix) | plans.ts | P1 |
| Add unique index on plans after PLAN-BD-2 resolution | migration | P1 (blocked by BD-2) |
| Add cascade DELETE for sessions/approvals/comments on plan delete | plans.ts, migration | P1 |
| Add backend API test suite for plans (roles, scoping, transitions) | api-server/src/test/ | P1 |

---

### P2 — Data Integrity / Analytics Correctness

| Task | Files | Priority |
|---|---|---|
| Add `locationType` to generated PlanSummary/PlanDetail types | api-client-react | P2 |
| Add server-side date-ordering validation (start ≤ end) | plans.ts | P2 |
| Surface migration_review_notes in plan list for admin roles | plans.ts, plans.tsx | P2 |
| Validate responsible_user_id is an active user | plans.ts | P2 |
| Document base plans table schema (migration 000 or schema.sql) | run-migrations.ts | P2 |

---

### P3 — UX / Accessibility / Performance

| Task | Files | Priority |
|---|---|---|
| Show reviewer revision comments inline for returned-draft authors | plan-detail.tsx | P3 |
| Add aria-invalid to plan form fields | create-plan-registration-dialog.tsx, plan-detail.tsx | P3 |
| Replace correlated activity subqueries in planSummarySelect | plans.ts | P3 |

---

### Deferred (awaiting business decisions)

| Task | Blocked By |
|---|---|
| Type-specific workflow/validation | PLAN-BD-1 |
| Duplicate plan check endpoint + unique index | PLAN-BD-2 |
| SOM permission correction | PLAN-BD-3 |
| progressPct auto-derivation from status | PLAN-BD-4 |

---

## 39. Safe Parallelisation Plan

**First Wave — two tasks safe to run in parallel:**

**Task A: Transition race hardening**
- Add `AND status = $N` CAS predicate to non-submit transition UPDATE.
- Move reopen FOR UPDATE inside BEGIN transaction.
- Primary files: `artifacts/api-server/src/routes/plans.ts` (lines 1780, 1855).
- No overlap with Projects audit (#415) — plans.ts is plans-only.

**Task B: Type contract + date validation**
- Add `locationType` to generated types (lib/api-client-react dist rebuild).
- Add server-side `start_date ≤ end_date` validation in POST and PATCH.
- Primary files: `lib/api-client-react/src/`, `artifacts/api-server/src/routes/plans.ts` (POST create + PATCH).
- The plans.ts changes (date validation) touch different lines from Task A (transition UPDATE + reopen).
- The api-client-react dist rebuild is an isolated library change.

**File-overlap note with #415 (Projects audit):**
- Task #415 operates on `projects.ts`, `project-detail.tsx`, project migrations.
- Tasks A and B operate on `plans.ts` and `api-client-react` only.
- No shared file overlap. Both waves are safe to run in parallel with #415.
