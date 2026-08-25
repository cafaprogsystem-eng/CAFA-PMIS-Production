# Budgets Module — Business Decisions Closure (BUD-BD-01–04)

Decision/scout artifact for Task 578. No production code, database, or OpenAPI changes were made.
All evidence re-verified against the current merged codebase on 19 August 2026. British English throughout.

---

## BUD-BD-01 — State Allocation Cap

### Question
Is `SUM(project_state_allocations.budget_allocation) ≤ projects.budget_total` a hard governance rule, and how does it behave when the project budget is zero?

### Evidence
- `artifacts/api-server/src/routes/projects.ts` (`POST /projects/:projectId/state-allocations`, ~lines 2828–2850): validates every allocation is non-negative, then enforces the cap **application-side, unconditionally for positive budgets**:
  `if (projectBudget > 0 && allocTotal > projectBudget) → 422 over_allocation`.
- **Zero-budget behaviour (verified)**: the guard is explicitly conditioned on `projectBudget > 0`. When `budget_total = 0` (or NULL, coalesced to 0), the cap check is **skipped entirely** — any non-negative allocation totals are accepted. This is neither Option A (forbidden until positive budget) nor "allowed up to 0"; it is **uncapped when budget is zero**.
- Replacement semantics: the endpoint is a full-replace (`DELETE` all rows for the project, then `INSERT` the submitted set) inside one transaction; the cap is evaluated against the submitted set only, so no stale-sum drift is possible.
- Migration `027_project_state_allocations_integrity` (in `run-migrations.ts`): dedupe, `UNIQUE (project_id, state_id)`, FKs, negative amounts zeroed. **No DB-level aggregate cap** — enforcement is application-only.
- PRJ-033 comment at the same endpoint: Full Operational Access (PM/Super Admin) does **not** bypass the state-linkage constraint; the cap guard sits on the same unconditional path, so it is equally actor-independent.
- The cap is **not** re-checked when `budget_total` is reduced via project PATCH — an existing allocation sum can exceed a subsequently lowered budget (accepted gap, see Edge Cases).
- Every allocation replacement is audit-logged (`state_allocations_replace`).
- UI: `project-registration-form.tsx` / `project-detail.tsx` submit allocations and surface the server's 422 `over_allocation` message; the server remains the sole authority.

### Alternatives Considered
1. Advisory-only cap (warn, allow save) — contradicted by the unconditional 422.
2. DB-level aggregate cap (trigger) — not present; app-level is the sole mechanism.
3. Forbid all allocations while budget is zero — contradicted by the explicit `projectBudget > 0` condition.

### Final Rule
The state allocation cap is a **hard, actor-independent governance rule enforced at application level**: for any project with a positive `budget_total`, the sum of submitted state allocations must not exceed it (422 otherwise). For projects with `budget_total = 0` or NULL, the cap is intentionally not applied (draft/unbudgeted projects may pre-stage allocations); this is documented behaviour, not a bug, but see Implementation Implications.

### Edge Cases
- **Budget later reduced below existing allocations**: permitted today; allocations are only re-validated on the next allocation replacement. Documented as an accepted gap; optional future hardening is a cap re-check on `budget_total` PATCH.
- **Zero-budget projects**: allocations uncapped until a positive budget is set; the next allocation save after budget entry re-imposes the cap.
- **Negative allocations**: rejected (422) app-side and zeroed historically by migration 027.

### Actor Independence
Confirmed. PM/Super Admin pass through the same guard; no role bypass exists (consistent with Task #373 Full Operational Access: broad access, no structural-integrity bypass).

### Implementation Implications
- Document app-level enforcement as canonical; a DB aggregate-cap trigger is optional future hardening, not required.
- Optional future task: enforce or warn on `budget_total` PATCH when reduction breaches the existing allocation sum, and decide whether zero-budget projects should block non-zero allocations.

### Required Tests
- Sentinel: 422 when `allocTotal > budget_total > 0`; success when equal; success (uncapped) when `budget_total = 0`; negative allocation rejected.

### Status: CLOSED

---

## BUD-BD-02 — Allocation Currency

### Question
Do state allocations carry their own currency, or do they inherit the project's currency?

### Evidence
- `lib/db/src/schema/index.ts` (`projectStateAllocationsTable`): **no currency column** (re-verified post-migration-027; migration 027 added constraints only, no columns).
- Allocation and project budget are compared directly in the cap guard with no conversion — they are necessarily the same unit.
- No currency parameter exists on any allocation endpoint; no FX conversion exists anywhere in the Budget module.
- `project-detail.tsx` displays allocations with the project's currency context (BUD-006 direction).
- System manual: no independent allocation-currency documentation found.

### Alternatives Considered
1. Per-allocation currency — no schema, API, or UI support; rejected.
2. FX-normalised comparison — no FX machinery exists; rejected.

### Final Rule
**A state allocation always inherits the owning project's currency** (`projects.currency`). There is no independent allocation currency and no FX conversion. All allocation displays must show the project currency.

### Edge Cases
- **Project currency changed after allocations exist**: stored numeric amounts are implicitly re-denominated in the new currency; no conversion is performed. Explicitly accepted — currency change is a re-labelling, not a revaluation.
- **Historical ambiguity**: any allocation created under a prior project currency is accepted as historical ambiguity; the current project currency is authoritative.

### Actor Independence
Not applicable — semantic rule, no actor variance.

### Implementation Implications
- BUD-006 fix (pass `project.currency` to `formatCurrency` in allocation displays) is the only UI implication; no schema or API change.

### Required Tests
- Sentinel: allocation responses carry no currency field; UI formats allocations with `project.currency`.

### Status: CLOSED

---

## BUD-BD-03 — Completed/Closed Projects in Portfolio

### Question
Should `closed` (and `completed`) projects be excluded from budget portfolio analytics?

### Evidence
- Budget analytics queries in `dashboard.ts` (~264–273, 443–452, 827–841, 1380–1389 region) filter `p.deleted_at IS NULL` only — **no status exclusion** (re-verified).
- `budget.tsx` (~555): `PROJECT_STATUSES` includes `closed`; the status filter lets users narrow to any status, including closed. No separate completed/closed toggle.
- `projects.ts:66`: `if (["completed", "closed"].includes(status)) return "frozen"` — `completed` is treated server-side as equivalent to `closed` (frozen) wherever status gates exist (also lines ~1795, ~2170).
- Soft delete (`deleted_at`) is the canonical exclusion mechanism module-wide (consistent with budgets-module-audit invariants).

### Alternatives Considered
1. Exclude closed/completed from portfolio totals — would silently understate historical spend and contradict the UI's status filter design; rejected.
2. Add a dedicated "active only" toggle — a UX enhancement, not a governance need; not required.

### Final Rule
**The budget portfolio is a historical portfolio**: closed and completed projects remain in all portfolio totals and analytics. Only soft-deleted projects (`deleted_at IS NOT NULL`) are excluded. Users who want an active-only view use the existing status filter. For all budget purposes, `completed` is equivalent to `closed` (both map to the frozen lifecycle class).

### Edge Cases
- `completed` may be legacy/rare in production data; regardless, it is treated identically to `closed` for budget analytics — no separate handling required.

### Actor Independence
Confirmed — the same portfolio population is computed for all roles (state/sector clamping still applies per dashboard-analytics-authz rules; this decision changes nothing there).

### Implementation Implications
None. Current behaviour is the rule. Optionally document the historical-portfolio semantic in the system manual.

### Required Tests
- Sentinel: budget totals include a `closed` project and exclude a soft-deleted one.

### Status: CLOSED

---

## BUD-BD-04 — State Performance Budget Proxy

### Question
Should `GET /dashboard/performance/states` continue to feed a project-level budget proxy (`budgetUtilizationPct`) into the State performance score, when the standalone States endpoints already refuse to fabricate this metric?

### Evidence
- `services/performanceEngine.ts` (`computeStateScores`, ~394–401 region): computes per-state `budgetUtilizationPct = SUM(activity budget_spent) / SUM(projects.budget_total) × 100` over projects **linked to** the state — a project-portfolio proxy, not canonical State expenditure (whole-project budgets are counted for every linked state; multi-state projects are double-counted).
- Weighting (~83, ~480): `budgetUtilization: 0.15` — the proxy contributes **15%** of the state performance score used by `GET /dashboard/performance/states` (`dashboard.ts:1994–2012`, also line 547).
- `states.ts:20–23`: deliberately returns `NULL::int AS "budgetUtilizationPct"` with the BUD-001 comment: "no canonical State-level expenditure source exists … must therefore be NULL, never a fabricated share of Project budgets (baseline rule D)". `states.tsx`/`state-detail.tsx` therefore show "—".
- `dashboard.tsx` project budget table labels values "Project-Level Budget" with an explicit caveat — the caveat pattern acknowledges the proxy is not State data.
- Budgets audit invariant (established): "no state-level expenditure source (show — never a share)".
- CAFA precedent: invented State scoring was previously removed from Projects & States surfaces.

### Alternatives Considered
- **Option A** — keep the proxy, rename the field and flag it `isBudgetProxyOnly`. Rejected: a 15% score contribution ranks States against each other on data that is not State data; labelling does not cure a ranking distortion (multi-state projects still double-count).
- **Option B** — return `budgetUtilizationPct = null` in `computeStateScores` and remove the budget component from the state score (redistribute the 15% weight across remaining components). **Adopted** — it is the rule already applied in `states.ts` (BUD-001, baseline rule D); the two endpoints must not contradict each other.
- **Option C** — executive confirmation. Not needed: the evidence is one-sided; the organisation has already ruled on this exact metric in `states.ts`.

### Final Rule
**Option B.** No CAFA surface may present or score a fabricated State budget utilisation. `computeStateScores` must return `budgetUtilizationPct = null` and exclude the budget component from the weighted state score (the existing weighting engine already renormalises over non-null components — see `weightedSum / totalWeight` in `performanceEngine.ts` ~98–110, so redistribution is structural, not manual). Project-level budget figures may still be shown where explicitly labelled as project-level with the existing caveat.

### Edge Cases
- States with no linked projects already receive `budgetUtilization: null`; the rule generalises this to all states.
- Any other consumer of `computeStateScores` output inherits the change automatically.

### Actor Independence
Confirmed — the decision changes what is computed, not who may access the endpoint.

### Implementation Implications
- Backend-only remediation task: null the proxy in `computeStateScores`, drop/neutralise the `budgetUtilization` weight, update any frontend renderer of the dashboard state score that displays the budget component to show "—".
- No schema, OpenAPI shape may keep the field as nullable (matches `states.ts` contract).

### Required Tests
- Sentinel: `computeStateScores` output has `budgetUtilizationPct: null` and score unchanged by activity spend; dashboard states endpoint parity with `states.ts` semantics.

### Status: CLOSED
