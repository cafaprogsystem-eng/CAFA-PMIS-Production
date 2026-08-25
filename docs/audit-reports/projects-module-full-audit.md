# Projects Module — Full Functional / Technical / Security / UX Audit

**Task:** #415  
**Generated:** 2026-08-17  
**Auditor:** Replit Agent (evidence-based code review)  
**Governance reference:** Decision #373 — PM + Super Admin Full Operational Access

---

## 1. Executive Summary

The Projects Module is the operational backbone of the CAFA PMIS. This audit covers the full
backend routes file (`projects.ts`, 2,352 lines), the frontend pages and registration form, the
project-deletion library, permission middleware, schema / migration definitions, and associated
test files.

**Audit Verdict: MINOR HARDENING REQUIRED + BUSINESS DECISIONS REQUIRED BEFORE FULL CLOSURE**

The core project lifecycle (create → draft → submit → approve → active → closed) is correctly
implemented. Role-based access is substantially sound. The main gaps are:

- Four **P1 data-integrity / access** issues corrected during this audit (PATCH permission string,
  soft-delete filter on detail/merge/duplicate-check, state-allocation scope guards + over-
  allocation guard, plans orphaned on permanent delete).
- Three **P1 issues tracked separately** (download path exposure #199, state-reviewed dead
  state, SPO assignment-based scope gap).
- Several **P2 API-contract drift** issues (TypeScript errors from missing `reportingFrequency`
  and `hasHqOperations` in generated types).
- Two **Business Decisions required** before further hardening (reject/revision permission
  scope, PATCH destructive-replace semantics).

**Fixes applied during this audit:**

| Fix | Finding |
|-----|---------|
| `getProjectSector` now filters `deleted_at IS NULL` | PRJ-012 |
| PATCH route changed to `requirePerm("projects.update")` | PRJ-001 |
| Merge endpoint checks `deleted_at IS NULL` | PRJ-026 |
| Duplicate-check query filters `deleted_at IS NULL` | PRJ-031 |
| State allocations POST: scope guards added | PRJ-003 |
| State allocations POST: negative value + over-allocation guards | PRJ-004 |
| State allocations POST: permission changed to `projects.update` | PRJ-003 |
| State allocations POST: response scoped to requesting state role | PRJ-006 |
| Plans added to permanent delete cascade | PRJ-030 |

---

## 2. Current Architecture

| Component | Path |
|-----------|------|
| Backend routes | `artifacts/api-server/src/routes/projects.ts` (2,352 lines) |
| Deletion helper | `artifacts/api-server/src/lib/project-deletion.ts` |
| Permission middleware | `artifacts/api-server/src/middlewares/currentUser.ts` |
| Frontend list | `artifacts/cafa-pmis/src/pages/projects.tsx` |
| Frontend detail | `artifacts/cafa-pmis/src/pages/project-detail.tsx` |
| Frontend form | `artifacts/cafa-pmis/src/components/project-registration-form.tsx` |
| Frontend delete dialog | `artifacts/cafa-pmis/src/components/delete-project-dialog.tsx` |
| Schema | `lib/db/src/schema/index.ts` (Drizzle; incomplete — see §30) |
| Runtime migrations | `artifacts/api-server/src/lib/run-migrations.ts` |

---

## 3. Project Business Purpose

Projects are multi-sector, multi-state humanitarian programmes funded by donors. Each Project
has a Results Framework (Outputs → Indicators → Activities), a Budget, a Donor, Operational
Locations (States + HQ flag), a Team, and Documents. Projects generate Project Monthly Reports
(PMRs) at a configured Scheduled Reporting Frequency.

---

## 4. Canonical Project Identity

**What makes a Project unique?**

The system uses `agreement_number` + `donor` + `title` as the semantic identity triple, checked
by the duplicate-check endpoint. There is **no DB-level UNIQUE constraint on `projects.code`** —
the uniqueness is application-enforced by a MAX+1 sequence within a calendar year prefix
(`CAFA-PROJ-{YEAR}-{NNN}`).

| Field | Required | Mutable | Identity? | Notes |
|-------|----------|---------|-----------|-------|
| `code` | Generated | Draft only (via PATCH full-replace) | Partial | No DB UNIQUE constraint (PRJ-018) |
| `title` | Yes | Draft | Partial | Part of duplicate-check triple |
| `agreement_number` | Yes (Zod) | Draft | Yes | Checked case-insensitively |
| `donor` / `donor_id` | Yes | Draft | Partial | Free-text or FK; mismatch possible |
| `sector` / `sectors` | At least one | Draft | No | |
| `start_date` / `end_date` | Yes | Draft | No | end ≥ start enforced in app, not DB |
| `reporting_frequency` | Required on create | Draft | No | null allowed on PATCH for legacy |
| `has_hq_operations` | Required (implicit) | Draft | No | |
| `management_level` | Optional (default `hq_managed`) | Draft | No | |

**Finding PRJ-018 (P3):** No UNIQUE index on `projects.code`. Concurrent creates within the
same year could theoretically generate duplicate codes (the MAX+1 is inside the transaction
but there is no advisory lock). Practical risk low given user-driven creates.

---

## 5. Status & Workflow Model

### State Machine

```
draft
  └─ submit ──────────────────────── submitted
                                          │
                          technical_review│ (or from state_reviewed)
                                          ▼
                               technically_approved
                                          │
                        coordination_review│
                                          ▼
                              coordination_approved
                                          │
                             final_approve│  (requires: agreement doc + budget doc)
                                          ▼
                                       approved
                                          │
                                  activate│
                                          ▼
                                        active
                                          │
                                     close│
                                          ▼
                                        closed

  Any of submitted, state_reviewed, technically_approved, coordination_approved
    └─ reject / request_revision → draft (rejected / draft)
```

### Transition Permissions

| Action | Permission | Who has it |
|--------|-----------|------------|
| submit | `projects.create` | PM, SPC, TC, SPO |
| technical_review | `projects.approve.technical` | PM, TC |
| coordination_review | `projects.approve.coordination` | PM, SPC |
| final_approve | `projects.approve.final` | PM |
| activate | `projects.activate` | PM |
| close | `projects.close` | PM |
| reject | `projects.approve.technical` | PM, TC |
| request_revision | `projects.approve.technical` | PM, TC |

**Finding PRJ-022 (P1):** `state_reviewed` appears in `from` arrays for `technical_review`,
`reject`, and `request_revision`, but **no transition sets the status TO `state_reviewed`**.
This is a dead/legacy state. Existing DB rows with `status = 'state_reviewed'` will stall
unless TC manually does `technical_review`. Requires BD-01.

**Finding PRJ-021 (P2):** `reject` and `request_revision` are limited to
`projects.approve.technical` holders. SPC (who has `projects.approve.coordination`) cannot
reject a `technically_approved` project. Business decision needed: should SPC and PM
(`projects.approve.final`) also be able to reject/return at stages above their entry point?
Requires BD-02.

### `final_approve` Gate

Requires:
1. No unresolved required corrections (via `comments` table).
2. ≥ 1 document with `category = 'agreement'`.
3. ≥ 1 document with `category = 'budget'`.

Documents can currently be deleted after approval (no lifecycle lock). See PRJ-013.

---

## 6. Authoring / Access Matrix

| Role | Create | View | PATCH | Approve* | Delete | Notes |
|------|--------|------|-------|---------|--------|-------|
| Programme Manager | ✓ | ✓ (all) | ✓ | All stages | ✓ | #373 Full Operational Access |
| Senior Programme Coordinator | ✓ | ✓ (all) | ✓ | Coordination | ✗ | |
| Technical Coordinator | ✓ | ✓ (sector-scoped) | ✓ | Technical | ✗ | See §12 for sector scope |
| State Programme Officer | ✓ | ✓ (state-scoped) | ✓ | — | ✗ | Scope = state_id join + assignment |
| State Office Manager | ✗ | ✓ (state-scoped) | ✗ | — | ✗ | `projects.view.state` only |
| Executive Director | ✗ | ✓ (all) | ✗ | — | ✓ | Only `projects.delete` |
| Super Admin | ✓ | ✓ (all) | ✓ | All stages | ✓ | Wildcard `*` |
| Viewer | ✗ | ✓ (all) | ✗ | — | ✗ | `projects.view` only |

*Approve = which workflow stages they can advance.

---

## 7. Full Operational Access (#373)

Programme Manager and Super Admin have Full Operational Access to all project lifecycle
operations. This is correctly implemented via the permission grants in `currentUser.ts`.

Full Access does NOT bypass:
- Required field validation (reporting_frequency, operational location, date range).
- Document gate on `final_approve`.
- Duplicate-check warnings.
- Data integrity constraints.

Evidence: PATCH and create routes validate all business rules before DB write regardless of role.

---

## 8. Create / Draft / Edit

**Create (POST `/projects`):**
- Requires `projects.create`.
- `reporting_frequency` is mandatory (model D, Task #325). `on_demand` excluded.
- Must have HQ (`hasHqOperations=true`) or ≥ 1 state.
- Code generated as `CAFA-PROJ-{YEAR}-{NNN}`.
- Audit log written. Creator notified. Assigned users notified.

**PATCH (PATCH `/projects/:id`):**
- **Fixed during audit:** now requires `projects.update` (was `projects.create` — PRJ-001).
- Blocked unless `status = 'draft'`.
- Performs **full replace** of all nested records (outputs, activities, indicators, states,
  allocations, localities, assignments, documents) in a single transaction.
- **Finding PRJ-023 (P2):** Full replace means if the client omits existing documents or
  activities they are permanently deleted. Activities with posted `budget_spent > 0` in the
  `activities` table will be deleted by the PATCH, losing the spent record. See BD-03.

**Save As Draft vs Submit:** The frontend form sends PATCH to save drafts and calls the
`/transitions` endpoint with action `submit` separately. The backend PATCH guard enforces
draft-only.

---

## 9. Submission & Validation

**Required for submit (`status: draft → submitted`):**
- Actor must have `projects.create` permission.
- Project must be in `draft` state.
- No server-side field completeness check at submission beyond status guard.

**Required for `final_approve`:**
- Actor must have `projects.approve.final`.
- No unresolved required corrections.
- ≥ 1 `agreement` category document.
- ≥ 1 `budget` category document.

**Finding PRJ-029 (P3/BD-04):** There is no server-side field-completeness check on `submit`.
The frontend Tab 7 Review acts as a soft gate, but a direct API caller can submit a
minimally-seeded project. Whether to add a server-side completeness check is a business decision.

---

## 10. State Model

State assignment is via `project_states` table. State roles (SPO, SOM) are scoped to their
`stateId` via:
1. `assertStateAllowed` — denies access to project detail/documents/budget/kpis if the project
   is not in the user's state AND the user is not in `project_assignments`.
2. List query — filters via `EXISTS (SELECT 1 FROM project_states ps WHERE ps.state_id = $n)`.

**Fail-closed:** A state role with `stateId = null` is always denied (returns 403). Correct.

**Finding PRJ-028 (P2):** SPO scope for the LIST endpoint uses `project_states` JOIN (correct).
The SPO assignment-based scope (via `project_assignments`) is correctly included in the
`assertStateAllowed` guard, but the LIST query only uses `project_states`, not
`project_assignments`. An SPO directly assigned to a project (but not via `project_states`)
cannot see it in the list. This is partially mitigated by the create flow always inserting
`project_states`.

---

## 11. Multi-State Projects

A multi-state project has multiple rows in `project_states`. State users see the project once
(the list query deduplicates via `EXISTS`). State allocations (`project_state_allocations`) are
separate per-state records and are not summed or distributed automatically.

**Confirmed correct:** The list query does not fan-out multi-state projects; the project appears
once per role-scoped query.

---

## 12. Sector Model

Projects have:
- `sector` (primary, single text) — used by `assertSectorAllowed`.
- `sectors` (JSONB array) — used in TC list restriction.

**TC scope for LIST:** `tcSectorRestriction` returns the TC's `sectors` array. The list query
uses `p.sector = ANY($n::text[]) OR EXISTS (jsonb_array_elements … = ANY($n::text[]))`. This
is exact-match against the sectors array, **not** a substring match. Correct.

**Finding PRJ-015 (P2):** `assertSectorAllowed` (used on detail/document/delete/budget routes)
checks only `p.sector` (primary sector), not the full `sectors` array. If a TC's sector appears
only in the `sectors` array (not as the primary `sector`), they are denied access to that
project on detail routes despite appearing in the list. This is an asymmetry in access control.

---

## 13. Multi-Sector Projects

Sub-sectors are validated on create and PATCH against `validateSubSectorsMulti`. Duplicate
sector values are rejected (422). Unrecognised sector values are rejected (422). The sectors
array is stored as JSONB.

---

## 14. Reporting Frequency

- Valid values for new creates: `monthly`, `quarterly`, `annual` (from `SCHEDULED_FREQUENCIES`).
- `on_demand` explicitly excluded.
- DB CHECK constraint enforced by migration `018_project_reporting_frequency`.
- Historical projects may have `null` (no backfill). PATCH accepts `null` to clear.
- Frequency changes do NOT rewrite existing PMRs (prospective only). Confirmed correct.
- `PMRCompletenessPanel` reads `project.reportingFrequency` to calculate expected PMRs.

**TypeScript gap:** `reportingFrequency` missing from generated `Project` type → TS errors in
`project-detail.tsx:968-969, 1187`. Tracked as PRJ-016.

---

## 15. Donor Model

Dual representation:
- `donor` (free-text name, always stored) — required; falls back to "Unknown".
- `donor_id` (FK to `donors` table) — optional canonical reference.

If `donorId` is provided, the canonical name is looked up and stored in `donor`. If not,
the free-text value is used.

**Finding PRJ-027-Donor (P2):** The Donor Portfolio analytics in the dashboard joins on `donor`
(free text). Projects with the same donor FK but slightly different free-text names will appear
as separate donors in the portfolio. No deduplication by `donor_id` in the dashboard.

---

## 16. Currency & Budget

- `budget_total` stored as numeric; `currency` stored as text (default `"USD"`).
- No FX conversion anywhere. Budget performance analytics work in the project's native currency.
- Budget alert fires after every project transition (24h dedupe window).
- The budget endpoint (`/projects/:projectId/budget`) computes burn rate from `activities.budget_spent`.
- **Confirmed:** No hardcoded USD assumptions in calculations.

**Finding PRJ-014 (P2):** Budget endpoint (`GET /projects/:projectId/budget`) applies the state
role guard correctly (SPO/SOM restricted to their state), but non-state roles (TC, SPC, ED) have
no explicit `requirePerm` gate. Any authenticated non-state user who guesses a project ID can
read its full budget breakdown. The sector scope is NOT applied on this endpoint.

---

## 17. State-Level Allocations

**Confirmed fixed during this audit:**

| Issue | Status |
|-------|--------|
| POST used `projects.create` permission | Fixed → `projects.update` |
| POST had no sector scope guard | Fixed — `assertSectorAllowed` added |
| POST had no state scope guard | Fixed — `assertStateAllowed` added |
| POST had no negative-value guard | Fixed — 422 on budgetAllocation < 0 |
| POST had no over-allocation guard | Fixed — 422 when sum > budget_total |
| POST response returned all allocations to state roles | Fixed — scoped to requesting stateId |
| Soft-deleted project accessible via state-allocations | Fixed — `deleted_at IS NULL` in `getProjectSector` |

**Remaining:** No check that `stateId` in an allocation belongs to the project's linked states
(`project_states`). A malicious actor with `projects.update` could allocate to an unlinked
state. Tracked as PRJ-033.

---

## 18. Beneficiary Model

Beneficiaries are tracked at both the project level (`projects.beneficiaries_target`,
`beneficiaries_male`, etc.) and in a `beneficiaries` table (per-report breakdowns).
The summary SELECT aggregates the count from the `beneficiaries` table for `beneficiariesReached`.

---

## 19. Delete / Archive / Completion

### Mode determination (`project-deletion.ts`)

```
If canDelete = false                          → not_allowed
If current status ∈ {approved, active, closed} → soft
If any approval history entry is approved/active/closed → soft
Otherwise                                     → permanent
```

### Permanent delete protection

Blocked if:
- Any `activities.budget_spent > 0`.
- Any non-draft `reports` exist.

**Fixed during this audit:** Plans (`plans` table with `project_id` FK) now deleted in the
permanent cascade. Previously they were orphaned.

### Cascade order (permanent)

comments → notifications → project_localities → project_free_localities →
project_assignments → project_documents → project_state_allocations →
project_states → indicators → activities → outputs → beneficiaries →
risks → reports → plans → approvals → project

audit_log intentionally preserved.

**Finding PRJ-019 (P3):** `DELETE FROM project_localities` references a table name different
from the application's primary locality table (`project_free_localities`). If `project_localities`
does not exist in the DB schema, this DELETE silently fails (no error because of how pg handles
missing tables in some configs) or throws and rolls back the entire deletion. Requires investigation
in production DB.

### Soft delete

Sets `deleted_at`, `deleted_by`, `deletion_reason`, `deletion_mode = 'soft'`. All child records
preserved. Soft-deleted projects are excluded from all list queries and most detail endpoints
(fixed during this audit).

---

## 20. Project Detail

The `GET /projects/:projectId` endpoint returns full project data including outputs, activities,
indicators, risks, reports (with empty approvalHistory), beneficiaries, states, and approval
history. Internal `objectPath` is included in `documents` — this is tracked as PRJ-009 (P2)
and in a separate task #199.

---

## 21. PMR / Reports Integration

- PMRs reference `project_id` on the `reports` table.
- `GET /projects/:projectId/report-kpis` aggregates non-draft project-type reports.
- `PMRCompletenessPanel` uses `project.reportingFrequency` + `project_states` to calculate
  expected vs. submitted PMRs per location per period.
- On-demand reports excluded from scheduled completeness. Correct.

**Finding PRJ-034 (P2):** `report-kpis` aggregates from `reports.activities` (JSONB) for budget
and activity status. This is correct per the reporting architecture but is separate from the
structured `activities` table. The two data sources could diverge.

---

## 22. Plans Integration

Plans reference projects via `project_id`. Plans are displayed in the Project Detail Plans tab.
Tab count accuracy requires further investigation (tracked in Task #416 — Plans Module Audit).

**Fixed during this audit:** Plans now included in permanent project delete cascade.

---

## 23. Risks Integration

Risks reference `project_id`. Project detail returns all risks for the project. On permanent
project delete, risks are correctly deleted in the cascade.

---

## 24. Notifications

| Event | Recipients |
|-------|------------|
| `project_created` | Creator |
| `project_assigned` | Each assigned user (except creator) |
| Transition | All entity actors (deduped) + next approver in chain |
| Budget alert | PM + SPC users + assigned users (24h dedup) |
| Document uploaded | All entity actors |

`notifyEntityActorsDeduped` uses the `approvals` + `project_assignments` tables to find actors.
`notifyNextApprover` routes to the correct next reviewer based on action and sector.

---

## 25. Dashboard & Analytics

The dashboard (`routes/dashboard.ts`) builds project KPIs with scope applied at query time.
Projects Requiring Follow-Up deduplicates by project. No composite score system (correctly removed).

State role scoping is applied via a `projectScopeWhere` helper. SPO scope is assignment-based
(from `project_assignments`) in the dashboard, which differs from the list-based `project_states`
scope in the project list — see PRJ-028.

---

## 26. Donor Portfolio

Donor Portfolio groups by free-text `projects.donor` field. If the same donor is stored with
slightly different free-text values (case differences, abbreviations), they appear as separate
entities. Grouping by canonical `donor_id` would be more accurate but is a separate enhancement.

---

## 27. Project Budget Performance

Budget performance in the budget endpoint (`/projects/:projectId/budget`) operates in the
project's native currency. No FX conversion. Monthly burn chart is deterministic (derived
from activity date ranges). Alerts fire at ≥80% burn.

---

## 28. Direct Endpoint Security

| Endpoint | Auth | Permission | Sector Scope | State Scope | Deleted Filter |
|----------|------|-----------|--------------|-------------|----------------|
| GET /projects | Session | None explicit | ✓ (TC) | ✓ | ✓ |
| GET /projects/:id | Session | None explicit | ✓ | ✓ | ✓ (fixed) |
| POST /projects | Session | `projects.create` | ✓ (via assertSectorAllowed skips for create) | N/A | N/A |
| PATCH /projects/:id | Session | `projects.update` (fixed) | ✓ | ✗ (draft projects may not have state yet) | ✓ (via sector check) |
| DELETE /projects/:id | Session | `projects.delete` | ✓ | ✓ | ✓ |
| POST /transitions | Session | Per-action | ✓ | ✓ | N/A |
| GET /documents | Session | None explicit | ✓ | ✓ | ✓ (fixed) |
| POST /documents | Session | `documents.upload` | ✓ | ✓ | ✓ (fixed) |
| GET /download | Session | `documents.view` | ✓ | ✓ | ✓ (fixed) |
| DELETE /documents/:id | Session | `documents.upload` | ✓ | ✓ | ✓ (fixed) |
| GET /budget | Session | None explicit | ✗ (PRJ-014) | ✓ (state roles) | N/A |
| GET /state-allocations | Session | None explicit | ✗ (PRJ-005) | ✓ (partial) | ✓ (fixed) |
| POST /state-allocations | Session | `projects.update` (fixed) | ✓ (fixed) | ✓ (fixed) | ✓ (fixed) |
| POST /merge | Session | `projects.update` | ✗ (PRJ-007) | ✗ (PRJ-007) | ✓ (fixed) |
| GET /duplicate-check | Session | None explicit | ✗ (PRJ-002) | ✗ | ✓ (fixed) |

**SQL injection:** All user-supplied parameters use parameterised queries (`$n`). No string
concatenation of untrusted input detected.

**Malformed IDs:** `Number(req.params.projectId)` without `isNaN` check on some routes
(e.g., detail route). `NaN` in a parameterised query causes a pg type error → 500. Low risk.

---

## 29. API Contract

**TypeScript errors confirmed in `cd artifacts/cafa-pmis && npx tsc --noEmit`:**

| Error | Finding |
|-------|---------|
| `reportingFrequency` not in `Project` type (project-detail.tsx:968,969,1187) | PRJ-016 |
| `hasHqOperations` not in `ProjectInput` type (project-registration-form.tsx:1618) | PRJ-016 |
| `useGetConsolidatedProjectReport` missing from api-client-react | Pre-existing, unrelated |
| `useGetPmrReportingCompleteness` missing | Pre-existing, unrelated |
| `locationType` on Plan/Report/Risk types | Pre-existing, tracked in Task #146 |

**PRJ-016 (P2):** The generated API client types (`@workspace/api-client-react`) do not include
`reportingFrequency` or `hasHqOperations` because these fields were added via runtime startup
`ALTER TABLE` rather than tracked schema migration with corresponding Orval/OpenAPI codegen.
The `lib/api-client-react` dist needs regeneration after adding these fields to the OpenAPI spec.

---

## 30. Database & Migrations

### Schema management issues

**Finding PRJ-017 (P2):** Two critical columns are added via **untracked startup `ALTER TABLE`**
in `routes/projects.ts` lines 17-27 instead of through the tracked migration runner:
- `project_documents.drive_file_id`
- `projects.deleted_at`, `deleted_by`, `deletion_reason`, `deletion_mode`

If these startup statements fail silently (they use `.catch(() => {})`), the columns are absent
and subsequent code fails with cryptic errors. These must be migrated to tracked migrations.

**Finding PRJ-029 (P2):** There are **two distinct `021_*` entries** in `run-migrations.ts`.
The migration runner likely marks the first `021` as complete and skips the second, meaning the
second migration's SQL never runs. Requires deduplication with a new ID.

**Finding PRJ-018 (P3):** No `UNIQUE` constraint on `projects.code` in the schema or any
tracked migration. Race-condition risk: two concurrent creates in the same year could generate
identical codes.

### CHECK constraints present

- `reporting_frequency`: CHECK (NULL or monthly|quarterly|annual) via migration `018`.
- No date range CHECK (end ≥ start enforced only in application code).

### Soft-delete column query coverage

With the fixes applied in this audit, `deleted_at IS NULL` is now present in:
- `getProjectSector` (covering detail, documents, download, state-allocations, merge, kpis, indicators)
- Project list (`p.deleted_at IS NULL` already present at line 249)
- Duplicate-check query (fixed)
- Merge initial check (fixed)

---

## 31. UX / Accessibility

### Project list (`projects.tsx`)
- Search/filter by status, sector, state — functional.
- Status badges use both colour and text label. Correct (not colour-only).
- Pagination not implemented — full result set returned. No concern at current scale.
- Draft projects visible to creators/PM (status filter includes draft).

### Registration form (`project-registration-form.tsx`)
- 7-tab structure: Basic, Location, Donor, Timeline, Team, Documents, Review.
- Save As Draft: submits full form data via PATCH (same ID preserved).
- Tab 7 (Review) acts as soft completeness gate before submission — not enforced server-side.
- `hasHqOperations` TypeScript error (PRJ-016) would prevent form from compiling cleanly.
- Dropdown hydration uses `value` not `defaultValue` — correct for controlled components.

### Project detail (`project-detail.tsx`)
- `reportingFrequency` accessed via `project.reportingFrequency` — TypeScript error (PRJ-016).
- Tabs: Overview, Results Framework, Budget, States/Allocations, Plans, Risks, Reports, Documents.
- ARIA: `role="tablist"` / `role="tab"` / `aria-selected` — from Radix UI, correct.
- No colour-only status meaning found.

### Accessibility findings
- **PRJ-035 (P3):** Form error surfacing in the 7-tab form — errors scroll to the first
  errored tab but `aria-invalid` is not confirmed on individual fields.
- **PRJ-036 (P3):** The deletion confirmation dialog requires typing the project code —
  keyboard accessible (standard input).

---

## 32. Performance

- Project list uses `COALESCE(AVG(...))` subqueries per row — O(n) subqueries for n projects.
  At scale this will degrade. Consider materialised aggregates.
- `enrichProject` fires 3 parallel queries per project-detail page. Acceptable.
- Budget alert fires fire-and-forget after every transition. Non-blocking. Correct.

---

## 33. Test Coverage

| Area | Existing Test File(s) | Coverage Quality | Missing Cases | Priority |
|------|----------------------|-----------------|---------------|---------|
| Deletion policy | `project-deletion.test.ts` (39 tests) | Good (pure helper) | Cascade order, plan orphan | P2 |
| Budget performance | `project-budget-performance.test.ts` (153 tests) | Good | Currency edge, zero-budget | P3 |
| Report form | `project-report-form.test.ts` (178 tests) | Good | — | — |
| Reporting frequency | `project-reporting-frequency.test.ts` (26 backend + 16 frontend) | Good | — | — |
| **Access matrix** | None | None | Role × action all paths | P1 |
| **State allocation guards** | None | None | Over-alloc, scope, negative | P1 |
| **Soft-delete filter** | None | None | Detail/merge/dup-check 404 | P1 |
| **Multi-State dedup** | None | None | SPO sees project once | P2 |
| **TC exact-sector scope** | None | None | Cross-sector denial | P2 |
| **Merge scope bypass** | None | None | TC sector bypass | P1 |
| **Audit sentinel tests** | `project-audit.test.ts` (new, 15 groups) | Added in this task | — | — |

---

## 34. Findings Register

### PRJ-001 — PATCH route used `projects.create` instead of `projects.update`
- **Severity:** P3 (Semantic / Maintenance)
- **Evidence:** `projects.ts:1016` — `requirePerm("projects.create")`.
- **Current:** PATCH gated on create permission.
- **Expected:** PATCH gated on update permission.
- **Risk:** Functionally equivalent today (same roles have both), but misleading and fragile if
  permission grants diverge.
- **Status:** ✅ Fixed — changed to `projects.update`.

### PRJ-002 — Duplicate-check endpoint has no explicit permission guard
- **Severity:** P1 (Access Control)
- **Evidence:** `projects.ts:735` — no `requirePerm`.
- **Current:** Any authenticated user (and potentially unauthenticated, depending on session
  middleware config) can query project metadata (title, code, donor, states, sectors) by
  agreement number.
- **Expected:** At minimum, `requirePerm("projects.view")` or equivalent.
- **Risk:** Project metadata enumeration. Low severity if session middleware enforces auth globally.
- **Recommended fix:** Add `requirePerm("projects.view")` to the route.
- **Status:** 🟡 Not fixed in this audit (small but requires auth-middleware analysis).

### PRJ-003 — State allocations POST had no sector/state scope guard and wrong permission
- **Severity:** P1 (Access Control / Data Integrity)
- **Evidence:** `projects.ts:2274` (original) — `requirePerm("projects.create")`, no
  `assertSectorAllowed`, no `assertStateAllowed`.
- **Current before fix:** Any user with `projects.create` (SPO, TC, SPC, PM) could write
  allocations to any project regardless of sector or state scope.
- **Status:** ✅ Fixed — permission changed to `projects.update`; sector and state scope guards added.

### PRJ-004 — State allocations POST had no negative-value or over-allocation guard
- **Severity:** P1 (Data Integrity)
- **Evidence:** `projects.ts:2293-2328` — no numeric validation on budgetAllocation.
- **Risk:** Negative allocations and over-allocation could corrupt budget analytics.
- **Status:** ✅ Fixed — 422 on negative; 422 when sum > project budget_total.

### PRJ-005 — State allocations GET has no explicit permission guard
- **Severity:** P2 (Access Control)
- **Evidence:** `projects.ts:2235` — no `requirePerm`.
- **Risk:** Any authenticated user can read state allocation details without permission check.
  State scope partially applied for state roles.
- **Recommended fix:** Add `requirePerm("projects.view.state")` or equivalent.
- **Status:** 🟡 Not fixed in this audit.

### PRJ-006 — State allocations POST response was unscoped for state roles
- **Severity:** P2 (Data Exposure)
- **Evidence:** The POST response returned all state allocations for the project.
- **Risk:** A state role that successfully writes (before scope fix) would see other states' data.
- **Status:** ✅ Fixed — response now scoped to requesting user's stateId.

### PRJ-007 — Merge endpoint bypasses sector and state scope
- **Severity:** P1 (Access Control)
- **Evidence:** `projects.ts:786` — `requirePerm("projects.update")` only; no
  `assertSectorAllowed`, no `assertStateAllowed`.
- **Risk:** A TC can add states or localities to a project in another sector. An SPO can add
  states to a project not in their assigned state.
- **Recommended fix:** Add `assertSectorAllowed` + `assertStateAllowed` guards to the merge route.
- **Status:** 🟡 Not fixed in this audit (small fix — flagged for follow-up task).

### PRJ-008 — Project code generation is not concurrency-safe
- **Severity:** P2 (Data Integrity)
- **Evidence:** `projects.ts:446-452` — MAX+1 sequence inside transaction, no DB advisory lock,
  no UNIQUE constraint.
- **Risk:** Low in practice (user-driven sequential creates); non-zero under concurrent load.
- **Recommended fix:** Add `UNIQUE` constraint on `projects.code`; use `INSERT ... ON CONFLICT`.
- **Status:** 🟡 Tracked as BD-related (needs migration).

### PRJ-009 — `object_path` (internal storage path) exposed in documents GET
- **Severity:** P2 (Information Disclosure)
- **Evidence:** `getDocuments()` returns `objectPath` in the JSON response.
- **Risk:** Internal storage paths leaked to all users who can view project documents.
- **Status:** 🟡 Tracked in separate task #199.

### PRJ-010 — Download endpoint legacy fallback exposes internal storage path
- **Severity:** P1 (Information Disclosure)
- **Evidence:** `projects.ts:1559` — `res.redirect('/storage/objects/${doc.objectPath}')`.
- **Status:** 🟡 Tracked in separate task #199.

### PRJ-011 — PATCH fully replaces all documents on every save
- **Severity:** P2 (Data Integrity)
- **Evidence:** `projects.ts:1169` — `DELETE FROM project_documents WHERE project_id=$1`.
- **Risk:** If a client omits existing documents when patching, they are permanently deleted.
- **Status:** 🟡 Tracked as PRJ-BD-03.

### PRJ-012 — Soft-deleted project accessible via detail and other endpoints
- **Severity:** P1 (Data Integrity)
- **Evidence:** `getProjectSector()` at line 33 had no `deleted_at IS NULL` filter.
- **Status:** ✅ Fixed — `AND deleted_at IS NULL` added to `getProjectSector`.

### PRJ-013 — Documents can be deleted after project approval
- **Severity:** P2 (Audit Trail)
- **Evidence:** `DELETE /projects/:projectId/documents/:documentId` has no lifecycle lock.
- **Risk:** Required agreement/budget documents deleted post-`final_approve`, undermining audit.
- **Recommended fix:** Block document deletion once project is `approved`, `active`, or `closed`
  (unless actor has a special override permission).
- **Status:** 🟡 Not fixed — requires BD-04.

### PRJ-014 — Budget endpoint missing permission guard for non-state roles
- **Severity:** P2 (Access Control)
- **Evidence:** `projects.ts:2115` — no `requirePerm`; sector scope not applied.
- **Risk:** Authenticated non-state users (TC, SPC) can read project budget details for any
  project, bypassing TC sector scope.
- **Status:** 🟡 Not fixed.

### PRJ-015 — `assertSectorAllowed` checks only primary sector
- **Severity:** P2 (Access Control)
- **Evidence:** `projects.ts:878` and similar — `assertSectorAllowed(req, cur.rows[0].sector)`.
  `sector` is the primary (first) sector; a project with `sectors = ["Health", "Education"]` and
  `sector = "Health"` would deny an Education TC on the detail endpoint.
- **Risk:** TC access asymmetry between list (allows multi-sector) and detail (denies non-primary).
- **Status:** 🟡 Requires BD-05.

### PRJ-016 — API contract drift: `reportingFrequency` and `hasHqOperations` missing from generated types
- **Severity:** P2 (TypeScript / DX)
- **Evidence:** TS errors at `project-detail.tsx:968,969,1187` and
  `project-registration-form.tsx:1618`.
- **Root cause:** Fields added via startup ALTER TABLE, not tracked migration + OpenAPI codegen.
- **Status:** 🟡 Tracked with PRJ-017.

### PRJ-017 — Schema drift: soft-delete columns and `drive_file_id` via untracked startup ALTER TABLE
- **Severity:** P2 (Operational Risk)
- **Evidence:** `projects.ts:17-27` — `pool.query("ALTER TABLE ...")`.
- **Risk:** Errors swallowed; columns absent if startup fails; not in tracked migration system;
  not in Drizzle schema; not in OpenAPI spec.
- **Recommended fix:** Move to tracked migration; add to Drizzle schema; regenerate API client.
- **Status:** 🟡 Not fixed in this audit (requires migration and codegen work).

### PRJ-018 — No UNIQUE DB constraint on `projects.code`
- **Severity:** P3
- **Evidence:** Schema search — no unique index on `projects.code`.
- **Status:** 🟡 Requires tracked migration.

### PRJ-019 — `project_localities` table referenced in delete cascade (possibly wrong table name)
- **Severity:** P3
- **Evidence:** `projects.ts:1719` — `DELETE FROM project_localities` vs the main
  `project_free_localities` table used everywhere else.
- **Risk:** If `project_localities` does not exist, permanent delete fails or silently skips.
- **Status:** 🟡 Requires DB schema investigation.

### PRJ-021 — `reject` / `request_revision` limited to `projects.approve.technical` only
- **Severity:** P2 (Workflow)
- **Evidence:** `projects.ts:1289-1290`.
- **Risk:** SPC and PM (non-TC) cannot reject a `technically_approved` project without TC permission.
- **Status:** 🟡 Requires BD-02.

### PRJ-022 — `state_reviewed` is an unreachable dead state
- **Severity:** P1 (Workflow)
- **Evidence:** No transition in `PROJECT_TRANSITIONS` produces `state_reviewed`.
- **Risk:** Any project stuck in `state_reviewed` cannot advance without a DB update.
- **Status:** 🟡 Requires BD-01.

### PRJ-023 — PATCH full-replace destroys spent activity data
- **Severity:** P2 (Data Integrity)
- **Evidence:** `projects.ts:1162-1169` — all activities, outputs, indicators deleted then re-inserted.
- **Risk:** `activities.budget_spent` values lost on every PATCH.
- **Status:** 🟡 Requires BD-03.

### PRJ-026 — Merge endpoint did not filter soft-deleted projects
- **Severity:** P1 (Data Integrity)
- **Evidence:** `projects.ts:794` — `SELECT id, sectors FROM projects WHERE id = $1` (no deleted_at).
- **Status:** ✅ Fixed — `AND deleted_at IS NULL` added.

### PRJ-028 — SPO list scope uses `project_states` but detail uses `project_assignments` too
- **Severity:** P2 (Access Asymmetry)
- **Evidence:** List query at line 257 only filters by `project_states`; `assertStateAllowed`
  also checks `project_assignments`.
- **Risk:** SPO assigned to a project but not via `project_states` cannot see it in the list.
- **Status:** 🟡 Minor; list could be extended to include assignment-based projects.

### PRJ-029 — Duplicate `021` migration ID in run-migrations.ts
- **Severity:** P2 (Operational Risk)
- **Evidence:** `run-migrations.ts:1616` and subsequent — two `021_*` entries.
- **Risk:** Second migration may never run.
- **Status:** 🟡 Requires renumbering.

### PRJ-030 — Plans orphaned on permanent project delete
- **Severity:** P1 (Data Integrity)
- **Evidence:** Plans were absent from the delete cascade.
- **Status:** ✅ Fixed — `DELETE FROM plans WHERE project_id = $1` added to cascade.

### PRJ-031 — Duplicate-check did not filter soft-deleted projects
- **Severity:** P1 (Data Integrity)
- **Evidence:** `projects.ts:756` — no `deleted_at IS NULL` in query.
- **Risk:** Duplicate check would match against already-deleted projects.
- **Status:** ✅ Fixed.

### PRJ-033 — State allocation `stateId` not validated against project's linked states
- **Severity:** P2 (Data Integrity)
- **Evidence:** `projects.ts:2306` — allocations accept any stateId.
- **Risk:** Allocation created for a state not linked to the project.
- **Status:** 🟡 Recommended fix: validate `stateId IN (SELECT state_id FROM project_states WHERE project_id = $1)`.

### PRJ-034 — report-kpis aggregates from JSONB `reports.activities` (dual source)
- **Severity:** P2 (Data Correctness)
- **Evidence:** `projects.ts:1840-1880` — queries JSONB column, not `activities` table.
- **Risk:** Divergence between structured activities and JSONB report activities.
- **Status:** 🟡 Architecture trade-off; documented for awareness.

### PRJ-035 — `aria-invalid` not confirmed on individual form fields
- **Severity:** P3 (Accessibility)
- **Status:** 🟡 Requires focused accessibility audit.

### PRJ-036 — Donors GET endpoint has no explicit permission guard
- **Severity:** P2 (Access Control)
- **Evidence:** `projects.ts:46` — no `requirePerm` on `GET /donors`.
- **Risk:** Donor directory enumerable by any authenticated user without explicit permission.
- **Status:** 🟡 Low priority; donors are reference data.

---

## 35. Business Decisions Required

### PRJ-BD-01 — `state_reviewed` status
Should `state_reviewed` be:
- (A) Removed from transition `from` arrays (it will never occur in new projects)?
- (B) Retained as a legacy state that TC can unblock via `technical_review`?
- (C) Re-enabled by adding a `state_review` transition with an appropriate permission?

**Recommendation:** (B) — retain and document. Adding a new transition requires workflow design.

### PRJ-BD-02 — Who can reject / request_revision?
Currently only `projects.approve.technical` holders (TC + PM) can reject at any stage.
Options:
- (A) Status quo: only TC/PM can reject.
- (B) Expand: SPC can also reject `technically_approved` → `draft`.
- (C) Full symmetry: whoever can advance can also reject the stage they operate on.

### PRJ-BD-03 — PATCH full-replace vs partial update
PATCH currently deletes and re-inserts all child records (outputs, activities, indicators,
documents, states, assignments, localities). This destroys `budget_spent` on activities.
Options:
- (A) Status quo: full replace (simplest implementation; only safe for draft projects with 0 spent).
- (B) Partial update: keep existing child records and merge; requires client to send diffs.
- (C) Lock financial fields (budget_spent) from PATCH and restore from DB before re-insert.

**Recommendation:** (C) — preserve `budget_spent` on activities during PATCH by restoring from DB.

### PRJ-BD-04 — Document deletion after approval
Should documents be locked once a project reaches `approved` / `active` / `closed`?
Options:
- (A) Lock — no deletions after approval (protects audit trail and `final_approve` gate).
- (B) Allow deletion with a higher-permission override (ED/PM only).
- (C) Status quo — any user with `documents.upload` can delete at any stage.

**Recommendation:** (A) — lock documents after final approval.

### PRJ-BD-05 — TC sector scope on detail endpoints (primary vs full sectors array)
`assertSectorAllowed` checks only `projects.sector` (primary). For multi-sector projects,
a TC in a non-primary sector is blocked on detail routes but can see the project in the list.
Options:
- (A) Check all sectors in `assertSectorAllowed` (use JSONB array check).
- (B) Status quo — primary sector is authoritative for TC access.

**Recommendation:** (A) — extend `assertSectorAllowed` to accept the full sectors array.

---

## 36. Recommended Implementation Roadmap

### Wave 1 — Hardening (parallel safe)

**Task A — Merge endpoint scope guards** (`projects.ts:786-866`)
- Add `assertSectorAllowed` + `assertStateAllowed` to merge route.
- Add regression tests to `project-audit.test.ts`.
- Files: `artifacts/api-server/src/routes/projects.ts`.

**Task B — Schema migration for soft-delete columns and drive_file_id** (independent)
- Create tracked migration for `projects.deleted_at/by/reason/mode` and
  `project_documents.drive_file_id`.
- Update Drizzle schema.
- Regenerate API client (`lib/api-client-react`).
- Files: `artifacts/api-server/src/lib/run-migrations.ts`, `lib/db/src/schema/index.ts`,
  `lib/api-client-react`.

### Wave 2 — Business Decision Dependent

**Task C — Reject/revision permission expansion** (after BD-02)
- Update `PROJECT_TRANSITION_PERMS` for reject/request_revision.
- Tests: transition permission matrix.

**Task D — Document lifecycle lock** (after BD-04)
- Add status check before document DELETE.
- Tests: delete blocked after approval.

**Task E — `assertSectorAllowed` multi-sector extension** (after BD-05)
- Refactor to accept `sectors[]`.

### Wave 3 — Data Quality

**Task F — Code uniqueness constraint** (migration)
- Add `UNIQUE` index on `projects.code`.
- Deconflict any existing duplicates.

**Task G — Duplicate migration 021 renumbering**
- Renumber second `021` to `022`.

---

## 37. Safe Parallelisation Plan

**Safe to run in parallel:**

- **Task A** (merge scope guards) + **Task B** (schema migration / codegen): touch completely
  different files. No conflict risk.
  - Task A: `artifacts/api-server/src/routes/projects.ts` (lines 786-866)
  - Task B: `run-migrations.ts`, `lib/db/src/schema/index.ts`, `lib/api-client-react/**`

- **Task C** (reject/revision perms) + **Task D** (document lifecycle lock): both in
  `projects.ts` but in different line ranges (transitions ~1282-1290 vs documents ~1759-1806).
  Merge risk low; run sequentially if a single agent is working.

**Conflicts to avoid:**
- Tasks C and D should not be run by two agents simultaneously modifying `projects.ts`.
- Task B (schema) and any task touching `api-client-react` types must not run in parallel with
  any task that also imports from `@workspace/api-client-react`.

---

## RESOLVED (Task #515 — Zero-Residual Final Re-Closure)

Historical note: the "P1 issues tracked separately" above are now closed. Final classifications:

- Download path exposure (PRJ-009 / PRJ-010, formerly #199): **RESOLVED — FIXED** by Task #509. Documents API uses `toPublicDocumentDto` (no storage internals) and the download endpoint proxy-streams through the storage abstraction (no redirect). Sentinels PRJ-ZR-01/02.
- `state_reviewed` dead state (PRJ-022): **RESOLVED — NOT A DEFECT (legacy status)**; transitions from `state_reviewed` remain reachable by the technical stage (`technical_review`, stage-aware `reject`/`request_revision`). Sentinels PRJ-ZR-03/04.
- All remaining findings in this document are closed; see `projects-zero-residual-final-reclosure-audit.md` for the canonical finding register and final verdict.
