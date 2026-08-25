# Risk Register — Reference, Linkage & Date Integrity Closure

**Scope**: RISK-006, RISK-007, RISK-008, RISK-011 (all P2) from the Risk Register Module Full Functional Audit.
**Date**: 19 August 2026.
**Out of scope (unchanged)**: risk scoring, lifecycle transitions, analytics, comments, attachments, and all open Business Decisions (RISK-BD-01/03/05).

All four findings were re-verified against the current merged code before any fix was written; all four were still present.

---

## RISK-006 — Assignee reference integrity — **CLOSED**

**Original defect**: `assignedToId` was inserted/updated raw with no existence or activity check; a nonexistent or inactive user was accepted silently, creating dangling assignments and ghost notifications.

**Canonical rule applied**: identical to the established `validateResponsibleUser` rule in the Plans module — the referenced user must **exist and be active** at the time of the write. Explicit `null` clears the assignment. Existing rows whose assignee later became inactive are grandfathered (validation runs only on write, never retroactively).

**Implementation**: `artifacts/api-server/src/routes/risks.ts` — new `validateAssignedUser()` helper; called in POST before INSERT and in PATCH before UPDATE. Errors: 422 `assigned_user_not_found` / 422 `assigned_user_not_active`.

**Notification safety**: assignment notifications are plain in-app notification rows keyed by user id; with nonexistent users now rejected at write time, no notification can be created for a missing recipient. No email path exists for risk assignment.

**Scope constraint**: no existing system rule restricts an assignee to the risk's State/Sector (the Plans responsible-user rule has no such restriction either), so none was invented — documented as part of RISK-BD-06 scope if governance later requires it.

**Actor-independence**: the check runs before any role-specific branch — PM and super_admin cannot bypass it.

**Tests**: RISK-REF-09a–d.

---

## RISK-007 — `plan_activities.risk_id` linkage integrity — **CLOSED**

**Original defect**: plan-activity create/update in `plans.ts` wrote `risk_id` unvalidated; any integer was accepted, creating dangling risk references.

**Canonical rule applied**: bare existence check — the referenced risk must exist. No scope check beyond what the plan route already enforces, because the actor operates in Plan context and the risk reference is an informational link.

**Implementation**: `artifacts/api-server/src/routes/plans.ts` — new `validateRiskReference()` helper (transaction-client aware, mirroring `validateResponsibleUser`); called in the POST `/plans` activity loop and the PATCH `/plans/:id` activity loop before any write. Error: 422 `risk_not_found` (field `activities.riskId`) via `PlanValidationError`, so the transaction rolls back cleanly.

**Deletion path preserved** (Task #486 regression): the plan-activity deletion path still nulls `risks.plan_activity_id` **before** deleting activity rows; the new validation applies only on write. Guarded by test RISK-REF-11.

**Actor-independence**: validation runs inside the transaction for every actor, before the write.

**Tests**: RISK-REF-05a–c, RISK-REF-11.

---

## RISK-008 — Project reference integrity on POST — **CLOSED**

**Original defect**: `projectId` was inserted unvalidated; only TCs incidentally triggered a sector lookup. Nonexistent or soft-deleted projects were linkable, and non-TC roles had no access check.

**Canonical rule applied**:
1. **Existence for all roles**: the project must exist and not be soft-deleted (`deleted_at IS NULL`) — 422 `project_not_found`. Full Operational Access (PM/super_admin) bypasses **scope, never existence**.
2. **State roles**: the project must operate in the actor's state — canonical `project_states` membership check, as used in `reports.ts` — 403 `project_forbidden`.
3. **TC**: the pre-existing sector guard is retained, now fed from the single shared project lookup (no duplicate query).
4. **HQ risks with a project link**: permitted — nothing in the schema or existing semantics forbids an HQ-scoped risk referencing a project; the location-combination rules (`locationType`/`stateId`) are unchanged.

**Implementation**: `artifacts/api-server/src/routes/risks.ts` POST handler — single project lookup replaces the TC-only lookup; existence + state-access checks precede the TC sector guard.

**Note**: `stateId` existence is still not validated (current behaviour preserved and documented — state-role scoping already clamps state roles to their own state; org-wide roles supplying a bogus stateId produce a risk visible under no state filter but harmless; adding a lookup would not depend on any BD and can be a future cleanup).

**Tests**: RISK-REF-01, RISK-REF-02a/b, RISK-REF-03/04 (N/A documented — no plan fields in POST schema), RISK-REF-08 (documented), RISK-REF-10.

---

## RISK-011 — Date format and ordering integrity — **CLOSED**

**Original defect**: `dueDate` was a bare optional string passed raw to PG — malformed input produced a PG 500; no ordering validation.

**Canonical rule applied**: strict `YYYY-MM-DD` round-trip validation (regex + UTC round-trip, so `2026-02-30` is rejected — matching the established submit-gate pattern elsewhere in the codebase). Errors: 422 `dueDate_invalid_format` / 422 `dueDate_invalid_date`. `null` remains valid (nullable column; on PATCH it clears the value).

**Fields in scope**: `dueDate` on POST and PATCH. `followUpDate` is **not writable** by any route (confirmed — never read from a request body), so no validation point exists for it. `identifiedAt`/`updatedAt` are server-controlled.

**Ordering**: no canonical ordering rule (dueDate vs identifiedAt, followUpDate vs dueDate) exists anywhere in current code or documentation — **documented as RISK-BD-06 and not enforced**, per the instruction not to invent rules.

**Overdue semantics**: unchanged; the due-date checker already filters `r.due_date IS NOT NULL`, so a null dueDate cannot produce a false overdue (guarded by test RISK-DATE-04).

**API contract**: `RiskUpdate` in `lib/api-spec/openapi.yaml` now declares `assignedToId` and `dueDate` as nullable (previously explicit `null` was rejected by the generated Zod schema, making clearing impossible); zod + react clients regenerated.

**Tests**: RISK-DATE-01/01b/01c, RISK-DATE-02 (documented), RISK-DATE-03a–c, RISK-DATE-04.

---

## PATCH semantics audit (Step 5)

Verified with tests: field **omitted** → column untouched; **explicit null** → cleared (assignedToId, dueDate); **new value** → validated then written. The `(body as Record<string, unknown>)` cast in the PATCH write block was removed — the parsed Zod type is used directly (casts elsewhere in the file untouched, per limited-scope instruction). `plan_id`, `plan_activity_id`, `project_id` and `state_id` are intentionally absent from the PATCH schema (plan links are plans-module-owned — RISK-BD-01), which is why no cross-entity consistency check exists in PATCH; if RISK-BD-01 later makes `plan_id` patchable, cross-entity validation must be added then.

## Error message accuracy (Step 6)

`validateRiskEnums` messages now list the full accepted value sets (7 likelihood aliases, 9 statuses) instead of the misleading 3-value subsets.

## Business-Decision dependencies

- **RISK-BD-01** (project/plan cross-check): not resolved; N/A today — plan fields not in create/update schemas.
- **RISK-BD-03**, **RISK-BD-05**: untouched.
- **RISK-BD-06** (new, documented here): date-ordering rules and assignee State/Sector scoping — no canonical rule exists; enforcement skipped.

## Files changed

- `artifacts/api-server/src/routes/risks.ts` — RISK-006/008/011 validation, enum messages, PATCH cast cleanup
- `artifacts/api-server/src/routes/plans.ts` — RISK-007 `validateRiskReference` + call sites
- `lib/api-spec/openapi.yaml` — `RiskUpdate.assignedToId`/`dueDate` nullable
- `lib/api-zod/src/generated/api.ts`, `lib/api-client-react/src/generated/api.schemas.ts` — regenerated
- `artifacts/api-server/src/routes/__tests__/risk-reference-date-integrity-closure.test.ts` — 29 tests

## Verification

- New suite: 29/29 pass.
- Full api-server suite: 72 files, 1905 tests, all pass (includes all Risk, Plans linkage and Project scope suites).
- Frontend `tsc --noEmit`: clean. api-server `tsc --noEmit`: only the 7 pre-existing errors in `plans-aggregate-integration.test.ts` (present on clean HEAD; unrelated).
