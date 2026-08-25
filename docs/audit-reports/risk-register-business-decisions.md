# Risk Register — Business Decisions Closure (RISK-BD-01–05)

Decision/scout artifact for Task 578. No production code, database, or OpenAPI changes were made.
All evidence re-verified against the current merged codebase on 19 August 2026 (including the Task 570 linkage-integrity merge). British English throughout.

---

## RISK-BD-01 — Canonical Linkage Hierarchy

### Question
What is the canonical model for linking a Risk to Projects, States/HQ, Plans, and Plan Activities?

### Evidence
- **Correction to the pre-gathered evidence**: the `risks` table **does** carry `plan_id` and `plan_activity_id` columns (`lib/db/src/schema/index.ts`, `risksTable`), and the risk API `SELECT` exposes them read-only (`risks.ts` riskSelect: `r.plan_id AS "planId", r.plan_activity_id AS "planActivityId"`).
- However, **the risk API cannot write them**: `CreateRiskBody` and `UpdateRiskBody` (generated `lib/api-zod/src/generated/api.ts`) contain no `planId`/`planActivityId`; the INSERT and PATCH in `risks.ts` never touch these columns.
- Plan linkage is **owned by the Plans module**: `plan_activities.risk_id` is set/cleared via `plans.ts` activity create/update/delete; plan deletion nulls both `risks.plan_id` and `risks.plan_activity_id` (with an explicit comment that operational risks must not be silently destroyed — SET NULL preserves them); plan-activity deletion nulls `risks.plan_activity_id` before the activity rows are deleted.
- Risk location model (`risks.ts` POST): HQ risk = `locationType='hq'`, `state_id` forced NULL, state roles denied; state risk = `stateId` required, state roles clamped to own state. `projectId` optional; TC sector guard applied via the project's sector when a project is linked.
- Note: the drizzle schema declares `stateId` as `notNull`, but HQ inserts write NULL — the live DB column is nullable; the drizzle declaration is drifted documentation, not behaviour (candidate cosmetic fix, no decision impact).

### Alternatives Considered
1. Forward-only linkage from the risk (risk chooses its plan/activity) — contradicted by the API surface; rejected.
2. Pure reverse-only model with no columns on risks — contradicted by the schema; the columns exist but are plans-module-owned.

### Final Rule
Canonical linkage model:
- A Risk may be **standalone** (HQ/organisational: `locationType='hq'`, no state, optionally no project), **State-linked** (`stateId` set), and/or **Project-linked** (`projectId` set; sector scope derives from the project).
- **Plan/plan-activity linkage is owned exclusively by the Plans module.** `risks.plan_id` / `risks.plan_activity_id` and `plan_activities.risk_id` are written only through `plans.ts`; the Risk API exposes them read-only. "Activity linked" means the plan activity references the risk — the risk never chooses its plan through the Risk API.
- On plan or plan-activity deletion, linkage fields are nulled and the risk is **retained** in the register.

### Edge Cases
- Cross-entity consistency (`plan_activities.risk_id` referencing a risk whose `project_id` is compatible with the plan's project) is not currently validated — documented as future validation owned by the Plans module, not the Risk API.

### Actor Independence
Confirmed — linkage ownership is structural; PM/SA cannot set plan linkage through the Risk API either.

### Implementation Implications
- No code change required. Optional: OpenAPI descriptions should mark `planId`/`planActivityId` as read-only on risk responses; system manual should describe the ownership model. Cosmetic: align drizzle `stateId` nullability with the live column.

### Required Tests
- Sentinel: risk PATCH with `planId`/`planActivityId` in the body leaves those columns unchanged; plan deletion preserves linked risks with nulled linkage.

### Status: CLOSED

---

## RISK-BD-02 — Scoring Model

### Question
Is the canonical risk scoring model 3×3 (max 9) or the manual FAQ's 5×5 (max 25)?

### Evidence
- `risks.ts:11–25` (`computeRiskLevel`): likelihood `low/unlikely→1, medium/possible→2, high/likely/almost_certain→3`; impact `low→1, medium→2, high/critical→3` (COALESCE(impact, severity)); score = product, range 1–9; bands ≥9→critical, ≥6→high, ≥2→medium, 1→low. The SQL mirror `riskLevelSQL` (lines 28–44) implements the identical model for filters.
- `validateRiskEnums` (`risks.ts:86–92`): accepts exactly the 3-level (plus legacy alias) enumerations — no 1–5 numeric inputs exist anywhere.
- System manual doc (`docs/system-manual-final-review.md` risk heatmap section, per prior audit): documents **3×3** with the same thresholds — matches production.
- `manual.ts` FAQ (~2317–2319): claims 1–5 × 1–5 with 20–25 critical bands — **contradicts both production code and the system manual** (RISK-013).
- `CreateProjectRiskDialog` maps `severity = impact` on one-dimensional entry — correct given COALESCE semantics.
- Memory/audit precedent: "3×3 scoring, severity mirrors impact".

### Alternatives Considered
1. 5×5 as canonical (upgrade code) — nothing in schema, API, UI, or the authoritative manual supports it; the FAQ text is isolated and wrong; rejected.

### Final Rule
The canonical model is the **3×3 matrix** (score 1–9; bands ≥9 critical, ≥6 high, ≥2 medium, 1 low), with `impact` preferred and `severity` as fallback. The `manual.ts` FAQ 1–25 text is erroneous/aspirational documentation and must be corrected to the 3×3 model.

### Edge Cases
- Unknown/legacy enum values default to 2 in both TS and SQL — deliberate and consistent; retain.

### Actor Independence
Not applicable — computation rule.

### Implementation Implications
- Correct `manual.ts` FAQ text to 3×3 (RISK-013). RISK-019 (validation error message accuracy — messages list only a subset of accepted values) aligns with this closure.
- Frontend `computeRiskLevelFE` thresholds already match (Part C check).

### Required Tests
- Sentinel: `computeRiskLevel` band boundaries (1, 2, 4, 6, 9); TS/SQL parity.

### Status: CLOSED

---

## RISK-BD-03 — Status Lifecycle

### Question
Is risk status a governed workflow or a directly editable field, and is `closed` terminal?

### Evidence
- `VALID_STATUSES` (`risks.ts:84`): 9 values — `open, under_mitigation, closed, identified, assigned, mitigation_plan, follow_up, escalation, mitigated`.
- PATCH handler: sets `status` from the body with **no transition guard** of any kind; any `risks.update` holder within their state/sector scope can set any valid status, including reopening a `closed` risk.
- INSERT forces `'open'` regardless of supplied value (the drizzle schema default `'identified'` is superseded by the explicit literal in the INSERT).
- `activeOnly` list filter treats `closed` and `mitigated` as terminal for counting purposes; `states.ts` and `performanceEngine` risk counts also exclude `closed/mitigated/resolved/cancelled` (the latter two are defensive, not creatable).
- System manual: "open the risk detail page → click Change Status → select new status → save" — describes free selection, no workflow.
- Status changes trigger notifications (`risk_status_changed`) and are audit-logged, but nothing gates them.

### Alternatives Considered
1. Enforced lifecycle ordering — no code, UI, or manual evidence of intended transitions; rejected.

### Final Rule
Risk status is a **directly editable field**: any of the 9 valid statuses may be set via PATCH by an actor holding `risks.update` within scope. Default on create is always `open`. `closed` and `mitigated` are *reporting-terminal* (excluded from active counts) but **not locked** — a closed risk may be reopened by direct edit. No approval workflow exists or is required.

### Edge Cases
- Legacy statuses (`identified`, etc.) remain accepted so historical rows round-trip on PATCH — retain.
- The 422 error message lists only "open, under_mitigation, closed" while 9 values are accepted — message accuracy is RISK-019.

### Actor Independence
Confirmed — permission-gated only (`risks.update` + state/sector scope); no role-specific transitions.

### Implementation Implications
- RISK-019: correct the status (and likelihood) error messages to enumerate the actual accepted sets.
- System manual may optionally document `closed`/`mitigated` as reporting-terminal-but-reopenable.

### Required Tests
- Sentinel: closed→open PATCH succeeds; create with `status:'closed'` still lands as `open`; activeOnly excludes closed/mitigated.

### Status: CLOSED

---

## RISK-BD-04 — Residual Risk

### Question
Is residual risk (post-mitigation likelihood/impact/score) part of the current system?

### Evidence
- Schema (`risksTable`): no `residual_*` columns of any kind (re-verified).
- Repository-wide search for "residual" in frontend, backend, schema, and docs returns only "zero-residual" audit terminology — no residual-risk feature anywhere.
- No API fields, no UI, and no system-manual documentation of residual risk.

### Alternatives Considered
1. Treat mitigation-driven severity downgrades (the G-05 downgrade notification) as an implicit residual model — rejected: that is an edit of the inherent score, not a separate residual assessment.

### Final Rule
**Residual risk is not supported in the current system** and is out of scope for remediation. The inherent (current) likelihood × impact score is the only scoring dimension. If required in future, it is a new feature: schema columns + migration, OpenAPI + regeneration, API extension, and UI form fields.

### Edge Cases
None — feature absent.

### Actor Independence
Not applicable.

### Implementation Implications
None now. A future feature task would follow the full schema→OpenAPI→codegen→UI chain.

### Required Tests
None (nothing to guard).

### Status: CLOSED

---

## RISK-BD-05 — Delete / Archive / Close

### Question
How do risks end their life: can they be deleted, and what happens under project/plan deletion?

### Evidence
- `risks.ts` exposes **no DELETE route and no delete permission path** — risks cannot be deleted through the Risk API (re-verified post-Task-570).
- `closed` status via PATCH is the canonical terminal state available to users (see RISK-BD-03).
- **Project permanent delete** (`projects.ts`, permanent mode block ~2085–2107): `DELETE FROM risks WHERE project_id = $1` — associated risks are hard-destroyed as part of the application-level cascade (no DB FK); audit_log rows survive. Permanent delete itself is blocked when expenditure or non-draft reports exist and requires elevated permission.
- **Plan deletion** (`plans.ts` ~2366–2395): nulls `risks.plan_activity_id` (for the plan's activities) and `risks.plan_id`, then deletes activities and the plan — risks are **retained** by explicit design comment ("Operational risks must NOT be silently destroyed").
- **Plan-activity deletion** (`plans.ts` ~2172–2181): nulls `risks.plan_activity_id` before deleting the activity rows.
- Drive files attached to risks are not cleaned up on project permanent delete — RISK-005, already in the remediation queue.

### Alternatives Considered
1. Add a risk DELETE route — rejected: closure-not-deletion preserves the register's audit value and matches the module's design.
2. Soft-delete risks — no `deleted_at` on risks; closure fulfils the same reporting purpose; not required.

### Final Rule
- **Closure (`status='closed'`) is the canonical terminal state**; there is no risk deletion via the Risk API, by design.
- **Project permanent delete hard-destroys the project's risks** (application-level cascade); this is the sole destruction path and is governed by the project-deletion permission and blockers.
- **Plan and plan-activity deletion never destroy risks** — linkage fields are nulled and risks remain in the register.
- Drive-file cleanup on project permanent delete is owned by the pending RISK-005 remediation and must align with this rule (risk files destroyed only when the risk itself is destroyed).

### Edge Cases
- Soft project delete: risks untouched (project rows preserved); risk list continues to show them joined to the soft-deleted project — acceptable; portfolio analytics exclusion is a projects-module concern.

### Actor Independence
Confirmed — `closed` requires `risks.update` within scope; destruction happens only as a side-effect of the elevated project permanent delete; no actor can delete a risk independently.

### Implementation Implications
- RISK-005 (Drive-file cleanup on permanent delete) proceeds as queued; no other change required.
- Optional: system manual note that risks are closed, never deleted.

### Required Tests
- Sentinel: no DELETE /risks route registered; plan deletion retains risks with nulled linkage; project permanent delete removes them.

### Status: CLOSED

---

## Part C — Cross-Module Consistency (all BDs)

- **Task #373 Full Operational Access**: BUD-BD-01 cap and RISK linkage/destruction rules are actor-independent; PM/SA gain no structural bypass. ✓
- **Effective-sector semantics**: risk create/PATCH sector guards derive from the linked project's sector (`assertSectorAllowed`); allocation endpoint uses `getProjectEffectiveSectors` (PRJ-BD-05). ✓
- **State scope (SPO/SOM)**: risk list/create/PATCH clamp to own state and fail closed on null state; allocation endpoints clamp returned rows. ✓
- **Soft-deletion pattern**: budget analytics exclude only `deleted_at IS NOT NULL` (BUD-BD-03); risks have no soft delete — closure model instead (RISK-BD-05). ✓
- **Audit logging**: allocation replacement (`state_allocations_replace`), risk create/update, and project deletion are audit-logged; audit_log survives permanent delete. ✓
- **Frontend parity**: `computeRiskLevelFE` thresholds match the 3×3 backend model (RISK-BD-02). ✓

## Executive Confirmations Required
**NONE.** All nine business decisions closed on code-and-precedent evidence.
