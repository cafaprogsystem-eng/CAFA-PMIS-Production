# Plans Business Decisions — PLAN-BD-1, PLAN-BD-2, PLAN-BD-4, PLAN-BD-5

> **Status:** CLOSED — all four decisions resolved.
> **Scope:** Decision document only. No production code changed.
> **Concurrent task:** Task #446 (Project BD) — Plans files untouched by that task.
> **Prerequisite merged:** Task #440 (type contract / date / responsible user).

---

## 1. Executive Decision Summary

| Decision | Topic | Outcome |
|---|---|---|
| PLAN-BD-1 | Workflow Types | **ONE shared workflow** for all 7 plan types. No emergency bypass. |
| PLAN-BD-2 | Duplicate Identity | **Hybrid model**: hard backend guard for structured types; soft warning for irregular types. |
| PLAN-BD-4 | Progress Model | **Hybrid manual + consistency**: cancelled activities excluded from plan-level average. |
| PLAN-BD-5 | Rejection Contract | **Rejected is terminal**. No routine recovery. Permanence warning UI required. |

---

## 2. Evidence Reviewed

Files read and verified against current codebase (post-Task-440 merge):

| File | Key artefacts confirmed |
|---|---|
| `artifacts/api-server/src/routes/plans.ts` | `PLAN_TRANSITIONS` (lines 112–125), `PLAN_TYPES` (line 127), `PLAN_FREQUENCIES` (line 128), `progressPct` SQL (line 201), `normalizeActivity` (lines 556–584), rejection guard (lines 2128–2129, 2175–2180), `REOPENABLE_STATUSES` (line 69) |
| `lib/db/src/schema/index.ts` | `plansTable` (lines 275–322), `planActivitiesTable` (lines 324–351) — full column definitions, constraints |
| `artifacts/api-server/src/test/plan-audit-sentinel.test.ts` | Existing sentinel IDs `PLAN-AUDIT-01` through `PLAN-AUDIT-10`; `PLAN-AUDIT-09` already asserts rejected is terminal |

---

## 3. Existing Plan Model

### Workflow statuses (single chain)

```
draft → submitted → technically_approved → coordination_approved → approved
→ active → in_progress → delayed → completed → cancelled → archived
                                                        ↘ rejected (terminal)
```

`request_revision` returns any pre-final-approve status to `draft`.
`reject` moves any pre-final-approve status to `rejected` (no outgoing transitions).
`cancel` is available from all non-terminal, non-archived statuses.

### Plan types (7 canonical values)

`monthly | quarterly | annual | action | operational | emergency | custom`

These are validated on creation but are **type-agnostic** across all route handlers and the full `PLAN_TRANSITIONS` map.

### Activity statuses

`planned | in_progress | completed | delayed | cancelled`

---

## 4. PLAN-BD-1 — Options

| Option | Description | Pros | Cons |
|---|---|---|---|
| A | One shared workflow for all types (current behaviour) | Uniform governance; simpler audit trail; no divergent code paths | Emergency plans cannot skip stages |
| B | Emergency plans bypass technical/coordination review | Faster emergency deployment | Governance gap; dual code path complexity; misuse risk |
| C | Plan-type-specific workflow branches with guards | Maximum flexibility | High implementation cost; complex permissions matrix; fragile state machine |

---

## 5. PLAN-BD-1 — Final Decision

**ONE workflow for all 7 plan types.**

Emergency plans follow the same approval chain — operational urgency may determine scheduling priority but does not and must not bypass governance stages. Expedited review timing is a human scheduling decision, not a system bypass.

Type-specific field validation (e.g. distinct required fields per type) is deferred until a documented business need is presented. Current codebase does not implement any type-specific branching, and this decision formally closes that gap.

**PLAN-BD-1 CLOSED** — no production code change required.

---

## 6. Plan Type / Workflow Matrix

| Plan Type | Workflow Stages | Special Handling | Notes |
|---|---|---|---|
| `monthly` | Full 12-step chain | None | Typically project-linked; period = calendar month |
| `quarterly` | Full 12-step chain | None | Typically project-linked; period = calendar quarter |
| `annual` | Full 12-step chain | None | Typical for budgetary/operational cycles |
| `action` | Full 12-step chain | None | Irregular; may lack clear period boundaries |
| `operational` | Full 12-step chain | None | Successive operational plans are legitimate; irregular |
| `emergency` | Full 12-step chain | **No bypass** | Urgency is a scheduling, not a governance, concern |
| `custom` | Full 12-step chain | None | Open-ended; irregular |

All types share a single `PLAN_TRANSITIONS` object. No conditional branching exists or is planned.

---

## 7. PLAN-BD-2 — Existing Duplicate Gap

The current schema has:
- `code TEXT NOT NULL UNIQUE` — system-generated (e.g. `CAFA-PLAN-KY-003`), not a business identity key.
- **No UNIQUE constraint** on any business-identity combination.
- **No duplicate-check endpoint** for plans.
- `sectors JSONB DEFAULT []` — a JSON array column; a raw `UNIQUE` index on it would be ordering-fragile.
- No `period` field distinct from `start_date`/`end_date`.
- `plan_type` is nullable (drafts may lack a type).

There is no current backend guard preventing two plans with identical `(project_id, plan_type, start_date, end_date)` from being created. This is a confirmed gap.

---

## 8. PLAN-BD-2 — Identity Options

| Option | Description | Pros | Cons |
|---|---|---|---|
| A | DB UNIQUE index on business identity tuple | Enforced at DB level | `sectors[]` ordering fragility; nullable columns complicate partial indexes |
| B | Backend guard only (application-level check) | Handles nullable fields and JSON arrays safely; avoids fragile index | Theoretically bypassable by concurrent inserts (low risk in practice) |
| C | No duplicate prevention (status quo) | Zero effort | Business integrity gap; user confusion; duplicate data |
| D | Hybrid: hard guard for structured types + soft warning for irregular types | Matches business reality (irregular plans may intentionally overlap) | Requires two code paths |

---

## 9. PLAN-BD-2 — Final Identity Model

**Hybrid backend guard (Option D):**

**Structured plan types** (`monthly`, `quarterly`, `annual`) use a **hard duplicate prevention** backend guard (not a DB UNIQUE index). The canonical identity key is:

```
(project_id OR state_id, location_type, plan_type, start_date, end_date)
```

- `start_date` and `end_date` must both be present for the hard check to fire; partially-dated drafts are exempt.
- `title` is explicitly excluded from the identity key — titles change; identity does not.
- `sectors[]` is excluded from the hard identity key; a plan with the same period in the same project/state is a duplicate regardless of sector configuration.
- Backend guard uses a sorted canonical comparison for `sectors[]` — no raw JSON array UNIQUE index.

**Irregular plan types** (`action`, `operational`, `emergency`, `custom`) use a **soft duplicate warning** only — the create endpoint returns a `duplicate_warning` field alongside a successful 201, and the frontend may display a non-blocking advisory. Successive operational or emergency plans covering the same nominal period are a legitimate business pattern.

**Status scoping rule:**
- `draft`, `submitted`, `technically_approved`, `coordination_approved` statuses **participate in the hard check** — an existing draft blocks a second identical plan (continue the existing draft instead of creating a new one).
- `approved`, `active`, `in_progress`, `completed` statuses **hard-block** a duplicate.
- `rejected` and `cancelled` statuses are **excluded** from the hard block — a replacement plan after rejection or cancellation starts a fresh approval cycle.
- `archived` statuses are **excluded** from the hard block.

**DB enforcement:** Backend guard only. No fragile JSON-array UNIQUE index.

---

## 10. Duplicate Rules by Plan Type

| Plan Type | Identity Dimensions | Check Type | Statuses That Block | Notes |
|---|---|---|---|---|
| `monthly` | project_id/state_id, location_type, plan_type, start_date, end_date | **Hard** | draft→coordination_approved, approved→completed | Sector excluded from key |
| `quarterly` | project_id/state_id, location_type, plan_type, start_date, end_date | **Hard** | draft→coordination_approved, approved→completed | Sector excluded from key |
| `annual` | project_id/state_id, location_type, plan_type, start_date, end_date | **Hard** | draft→coordination_approved, approved→completed | Sector excluded from key |
| `action` | — | **Soft warning only** | N/A | Irregular periods; non-blocking advisory |
| `operational` | — | **Soft warning only** | N/A | Successive ops plans legitimate |
| `emergency` | — | **Soft warning only** | N/A | Urgency context makes strict block wrong |
| `custom` | — | **Soft warning only** | N/A | Open-ended by definition |

---

## 11. Draft / Rejected / Cancelled Treatment

| Status | Participates in Hard Block? | Rationale |
|---|---|---|
| `draft` | ✅ Yes | An existing draft should be continued; creating a second draft is confusing |
| `submitted` | ✅ Yes | Under review; duplicate submission is not permitted |
| `technically_approved` | ✅ Yes | Active in approval chain |
| `coordination_approved` | ✅ Yes | Active in approval chain |
| `approved` | ✅ Yes | Approved plan is live; duplicate would conflict |
| `active` | ✅ Yes | Running plan; duplicate conflicts with operations |
| `in_progress` | ✅ Yes | Running plan |
| `completed` | ✅ Yes | Historical record; duplicate would create ambiguity |
| `rejected` | ❌ No | Terminal — replacement plan is explicitly permitted (BD-5 consistent) |
| `cancelled` | ❌ No | Cancelled scope; replacement is legitimate |
| `archived` | ❌ No | Archived for historical record; replacement is legitimate |

---

## 12. PLAN-BD-4 — Existing Progress Model

**Activity level:**
- `progressPct` INTEGER 0–100 stored in `plan_activities.progress_pct`.
- Manually entered by the plan author/coordinator.
- `normalizeActivity` clamps to `Math.max(0, Math.min(100, ...))` but enforces **no status/progress consistency** — `status = 'completed', progressPct = 0` is currently valid.
- No DB CHECK constraint on the status/progress relationship.

**Plan level:**
- Computed at query time: `AVG(pa.progress_pct)::int FROM plan_activities pa WHERE pa.plan_id = pl.id`
- Returns `NULL` when a plan has no activities (explicitly documented: genuine 0% vs no-denominator distinction).
- **Currently includes cancelled activities** in the average — cancelling an incomplete activity deflates the plan's apparent progress.
- No completion-gating: a plan can transition to `completed` with all activities at 0%.

**Confirmed inconsistency risks:**
1. `status = 'completed', progressPct = 0` — valid in current model (misleading).
2. `status = 'planned', progressPct = 100` — valid in current model (misleading).
3. Cancelling two out of four activities at 0% pulls the plan average down even though cancelled scope is not expected to complete.

---

## 13. PLAN-BD-4 — Options

| Option | Description | Pros | Cons |
|---|---|---|---|
| A | Fully manual (status quo) | Zero friction; authors fully control display | Inconsistency risks confirmed above |
| B | Fully automatic (derive progressPct from status) | Always consistent | Over-constraining; authors lose nuance (e.g. 80% completed) |
| C | Hybrid: manual progressPct + status/progress consistency rules + cancelled exclusion | Consistency enforced on meaningful transitions; cancelled scope excluded | Requires normalizeActivity update + SQL change |
| D | Hybrid as C, plus completion gating (plan cannot reach `completed` until all activities are at 100%) | Maximum integrity | Too disruptive for current UX; completion may be administrative, not activity-driven |

---

## 14. PLAN-BD-4 — Final Progress Contract

**Hybrid manual + consistency model (Option C):**

**Activity-level rules (to be enforced in `normalizeActivity`):**

| Activity Status | Allowed `progressPct` Range | Enforcement |
|---|---|---|
| `completed` | **Exactly 100** | Clamp to 100 if lower; reject if server receives out-of-range |
| `in_progress` | **1–99** (inclusive) | Clamp to [1, 99] |
| `planned` | 0–99 (0 is default and valid) | No upper clamp beyond 99 |
| `delayed` | 0–99 | No upper clamp beyond 99; progress preserved |
| `cancelled` | 0–100 (frozen at whatever value it had) | Not enforced — cancellation freezes the value |

**Plan-level progress:**
- `AVG(progressPct)` of **non-cancelled** activities only.
- Returns `NULL` when there are no eligible (non-cancelled) activities — displayed as "—" in the UI, not "0%".
- Cancelled activities remain in the database with their frozen `progressPct`; they are simply excluded from the plan-level denominator.

**Completion gating:** NOT implemented at this time. The `complete` transition remains unrestricted. This is explicitly classified as a **residual follow-up** (see §22, Task B notes). The risk of misleading completion is acknowledged and accepted as a deferred tradeoff.

**Progress model consistency:** Applies identically to all 7 plan types (consistent with PLAN-BD-1 one-workflow decision).

---

## 15. Status / Progress Consistency Matrix

| Activity Status | Min progressPct | Max progressPct | Notes |
|---|---|---|---|
| `planned` | 0 | 99 | Default is 0; 100 would imply completion |
| `in_progress` | 1 | 99 | At least some progress must exist to be in-progress |
| `completed` | 100 | 100 | Must be exactly 100 — status and completion are synonymous |
| `delayed` | 0 | 99 | Delayed implies not yet complete; 100 should transition to completed |
| `cancelled` | 0 | 100 | Frozen value; not included in plan average |

**Plan-level null rule:** Plan progressPct is `NULL` (displayed as "—") when all activities are cancelled or when no activities exist. A plan with one cancelled activity and zero other activities is treated the same as a plan with no activities.

---

## 16. PLAN-BD-5 — Existing Rejection Model

**Verified current behaviour:**

- `reject` transition: `submitted | technically_approved | coordination_approved` → `rejected`
- `rejected` has **no outgoing transitions** in `PLAN_TRANSITIONS` — permanently terminal.
- `REOPENABLE_STATUSES = Set(["approved", "active", "in_progress", "delayed"])` — `rejected` is explicitly absent.
- `/plans/:planId/reopen` checks `REOPENABLE_STATUSES`; a plan in `rejected` status hits the `cannot_reopen_terminal` error.
- Rejection reason is **enforced** — `comment_required_for_revision_or_reject` is returned (HTTP 400) when no comment text is provided (lines 2128–2129).
- Comment is stored with `comment_type = 'rejection_reason'`.

**`request_revision` vs `reject` distinction (confirmed):**

| Attribute | `request_revision` | `reject` |
|---|---|---|
| Target status | `draft` (editable again) | `rejected` (terminal) |
| Comment type | `revision_request` | `rejection_reason` |
| Notification kind | `returned` | `rejected` |
| Recovery | Author continues editing | No routine recovery |
| Intent | Improvements needed | Plan is definitively refused |

**Current gap:** No rejection-specific permanence warning in the frontend. The shared transition dialog requires a non-blank comment, but does not communicate the irreversible nature of rejection to the reviewer.

---

## 17. PLAN-BD-5 — Options

| Option | Description | Pros | Cons |
|---|---|---|---|
| A | Rejected remains terminal; permanence warning added in UI | Preserves auditability; clear governance boundary; aligns with BD-2 rejected exclusion | Minor frontend-only work |
| B | Rejected can be restored via reopen (exceptional path) | Flexibility | Weakens governance; reviewer may reject carelessly knowing it can be undone |
| C | PM/Super Admin can override terminal rejected | Last-resort escape hatch | Full Operational Access scope creep; creates a bypass that contradicts BD-5 intent |
| D | Rejected terminates the plan permanently — no replacement allowed | Maximum finality | Too strong; projects may legitimately need new plans after rejection |

---

## 18. PLAN-BD-5 — Final Rejection Contract

**Rejected is TERMINAL — no routine recovery path.**

- `request_revision` is the correct mechanism when changes are desired before full rejection.
- The distinction between "needs revision" and "definitively rejected" is a reviewer responsibility — the system must make this boundary clear.
- PM/Super Admin (`Full Operational Access`) **cannot** bypass terminal rejected status through ordinary workflow. An exceptional administrative restore — if ever required — demands an explicit audited override separate from the current implementation, subject to future governance approval.
- Rejection reason is **already required** and is confirmed enforced by the current backend. No backend change needed.
- A replacement plan (new plan of the same structural identity) **is permitted** after rejection — consistent with PLAN-BD-2 (rejected excluded from hard duplicate block). The rejected plan remains in the database as a permanent audit record.

**New UI requirement (Task C):** The frontend transition dialog MUST display a rejection-specific permanence warning before the reviewer can confirm. See §19 for the required message.

---

## 19. Rejection UX Requirement

The plan rejection confirmation dialog MUST display the following message in British English before the reviewer can click Confirm:

> **This action is permanent.**
> Rejecting this plan cannot be undone. The plan will be closed and no further changes will be possible. If amendments are needed instead, use **Request Revision** to return the plan to the author.

The Confirm button must remain disabled until:
1. A non-blank rejection reason has been entered (already enforced).
2. The reviewer has seen (scrolled past or dismissed) the permanence warning.

`request_revision` does **not** require this warning — it is a recoverable action and should retain the current shared transition dialog behaviour.

---

## 20. Cross-Decision Consistency

### BD-2 + BD-5 Rejected Exclusion

Both decisions treat `rejected` consistently:
- **BD-5** makes rejected permanently terminal — no recovery through the workflow.
- **BD-2** excludes rejected plans from the hard duplicate block — a replacement plan is permitted.

These are not contradictory: the rejected plan remains an immutable audit record, and a fresh plan of the same structural identity starts a new approval cycle independent of the rejected record.

### BD-4 + BD-1 Same Progress Model

The single progress model (BD-4) applies uniformly to all 7 plan types because BD-1 established that all types share one workflow. There are no type-specific progress exceptions. Emergency plans are not given weaker (or stronger) progress rules — the same status/consistency matrix applies.

### BD-4 Cancelled Exclusion + BD-5 Terminal Consistency

Cancelled activities are excluded from the plan progress denominator (BD-4). This is a different concept from plan-level cancellation or rejection (BD-5). A plan that has some cancelled activities remains active and its progress is computed only from non-cancelled activities. Plan-level rejection (BD-5) is a workflow event, not an activity status.

---

## 21. Full Operational Access Impact

Full Operational Access (PM + super_admin; see `global-full-operational-access.md`) has the following boundaries under these decisions:

| Area | PM / Super Admin access | Restriction |
|---|---|---|
| Plan workflow transitions | May perform all transitions their role normally permits | **Cannot** bypass rejection terminality (no route accepts `rejected` as `from:`) |
| Duplicate identity | May create plans; backend guard enforced for all callers | Hard guard applies regardless of role |
| Progress editing | May edit activity progressPct like any author | Status/consistency rules enforced for all callers when implemented |
| Rejection reason | May reject plans; comment still required | No bypass of `comment_required_for_revision_or_reject` |
| Permanence warning | Will see the new rejection permanence dialog | Cannot skip the warning (client-enforced) |

`#373` (`Full Operational Access`) is intact and unaffected.

---

## 22. Implementation Follow-Ups

### Task A — Plan Duplicate Integrity (PLAN-BD-2 implementation)

**Scope:**
- Add backend duplicate guard for structured plan types (`monthly`, `quarterly`, `annual`) in the POST `/plans` create route.
- Add soft-warning response field for irregular types.
- Exclude `rejected` and `cancelled` rows from the hard check.
- Status scoping: `draft` through `completed` hard-block; `rejected`/`cancelled`/`archived` excluded.
- Backend only; no schema migration needed (application-level guard).
- Possibly a DB partial unique index as belt-and-suspenders — must be evaluated during implementation (sectors[] complexity may preclude it).

**Files:**
- `artifacts/api-server/src/routes/plans.ts` — POST `/plans` handler (create route section)
- Possibly one new migration for a partial unique index (evaluate during implementation)

**Does NOT touch:** Frontend plan components, Plans workflow transitions, OpenAPI spec, generated types.

---

### Task B — Plan Progress Consistency (PLAN-BD-4 implementation)

**Scope:**
- Enforce status/progress consistency in `normalizeActivity` (`completed` → 100, `in_progress` → 1–99, `planned`/`delayed` → 0–99, `cancelled` → frozen).
- Update the plan-level progress SQL query to exclude cancelled activities from the `AVG` denominator.
- Handle `NULL` display ("—" instead of "0%") in `plan-detail.tsx`.
- Completion gating (all activities at 100% before `complete` transition) is **explicitly deferred** as a future enforcement decision.

**Files:**
- `artifacts/api-server/src/routes/plans.ts` — `normalizeActivity` function + `progressPct` SQL subquery
- `artifacts/cafa-pmis/src/pages/plan-detail.tsx` — null-progress display

**⚠️ Note on parallel file overlap with Task A:** Both Task A and Task B touch `plans.ts`. They touch different functions (A: POST create handler; B: `normalizeActivity` and `progressPct` SQL), but care must be taken to sequence or scope-separate them to avoid merge conflicts.

**Does NOT touch:** Migrations (no schema change needed), Plans workflow transitions, OpenAPI spec.

---

### Task C — Plan Rejection UX / Contract (PLAN-BD-5 implementation)

**Scope:**
- Add rejection-specific permanence warning dialog in `plan-detail.tsx`.
- Warning must be distinct from the current shared transition dialog for `request_revision`.
- Backend: rejection reason already enforced — verify it survives unchanged.
- No backend code change expected.

**Files:**
- `artifacts/cafa-pmis/src/pages/plan-detail.tsx` only

**Does NOT touch:** Migrations, workflow transitions, Plans API, OpenAPI spec.

---

## 23. Required Tests

### Sentinel tests to be added (current-state evidence only)

| Test ID | Description | What it proves | File |
|---|---|---|---|
| `PLAN-BD-SENT-01` | All 7 plan types use the same `PLAN_TRANSITIONS` object — no type branching in workflow routes | BD-1: one workflow, no type-specific branch | `plan-bd-sentinel.test.ts` |
| `PLAN-BD-SENT-02` | No UNIQUE constraint exists on plans table beyond auto-generated `code`; two plans with identical `project_id`, `plan_type`, `start_date`, `end_date` can be created | BD-2: gap confirmed, hard guard is pending implementation | `plan-bd-sentinel.test.ts` |
| `PLAN-BD-SENT-03` | Plan `progressPct` = `AVG(activity.progressPct)` currently **includes** cancelled activities | BD-4: current behaviour confirmed; exclusion is pending implementation | `plan-bd-sentinel.test.ts` |
| `PLAN-BD-SENT-04` | `rejected` status has no outgoing transition — `PLAN_TRANSITIONS` has no entry with `from` containing `rejected` | BD-5: terminal confirmed at the transition-map level | `plan-bd-sentinel.test.ts` (may overlap with existing `PLAN-AUDIT-09`) |

**Note:** `PLAN-AUDIT-09` in `plan-audit-sentinel.test.ts` already asserts that `rejected` is a terminal status (no transition accepts it as source). `PLAN-BD-SENT-04` may be implemented as a structural refinement of that existing test rather than a duplicate.

### Existing tests to cross-reference

- `PLAN-AUDIT-01` — confirms `PLAN_TYPES` enumeration (7 types).
- `PLAN-AUDIT-03` — confirms `PLAN_TRANSITIONS` map integrity.
- `PLAN-AUDIT-09` — confirms `rejected` is terminal.
- `PLAN-AUDIT-10` — confirms reopen only from `REOPENABLE_STATUSES`.

---

## 24. Safe Parallelisation Plan

### Why B + C is the safe first parallel pair

| Task | Primary files touched | Overlap risk |
|---|---|---|
| **Task A** | `plans.ts` (POST create handler) | Overlaps with Task B in the same file |
| **Task B** | `plans.ts` (`normalizeActivity` + `progressPct` SQL) + `plan-detail.tsx` (display) | Overlaps with Task A in `plans.ts` |
| **Task C** | `plan-detail.tsx` only | Overlaps with Task B in `plan-detail.tsx` |

**Safe parallel pair: Task B + Task C.**
- Task B's `plans.ts` changes (`normalizeActivity`, `progressPct` SQL) are in entirely different functions from Task A's POST create handler — they do not conflict at the function level.
- However, editing the same file in parallel risks merge conflicts even in different functions.
- Task C is frontend-only (`plan-detail.tsx`). Task B also touches `plan-detail.tsx` (null-progress display), so Tasks B and C do share this file.
- **Most conservative safe pair: B (backend changes only in `plans.ts`) + C (frontend changes in `plan-detail.tsx`)**, treating them as complementary: B finishes the backend, C finishes the frontend UI in the same detail page.
- If B's `plan-detail.tsx` changes (null display) and C's `plan-detail.tsx` changes (permanence warning dialog) are small and scoped to different components/sections of the file, they can run in parallel with careful scope boundaries.

**Task A should follow after B and C are merged**, because:
1. Task A touches the same `plans.ts` file as Task B. Sequencing A after B avoids rebasing the create handler over `normalizeActivity` changes.
2. Task A may introduce a migration (partial unique index) — migrations should be sequenced, not parallelised.

**Recommended sequencing:**

```
Phase 1 (parallel):  Task B  ‖  Task C
Phase 2 (after merge): Task A
```

If the implementing agent is confident that B's `plan-detail.tsx` touch and C's `plan-detail.tsx` touch are in non-overlapping regions, B and C can run fully in parallel with a combined PR. Otherwise, run B first, then C.

---

## Final Decision Registry

| ID | Decision | Status | Implementation |
|---|---|---|---|
| PLAN-BD-1 | One shared workflow for all 7 plan types; no emergency bypass; type-specific validation deferred | **CLOSED** | No code change needed |
| PLAN-BD-2 | Hybrid: hard backend guard for monthly/quarterly/annual; soft warning for action/operational/emergency/custom; rejected/cancelled excluded from hard block | **CLOSED** | Task A |
| PLAN-BD-4 | Hybrid manual + consistency; cancelled excluded from plan AVG; NULL displayed as "—"; completion gating deferred | **CLOSED** | Task B |
| PLAN-BD-5 | Rejected is terminal; no routine recovery; permanence warning UI required; replacement plan permitted after rejection | **CLOSED** | Task C |
