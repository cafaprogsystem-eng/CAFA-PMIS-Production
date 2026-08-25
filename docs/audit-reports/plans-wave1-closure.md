# Plans Module Zero-Residual Closure — Wave 1

**Date:** 17 August 2026
**Scope:** PLAN-009 multi-sector semantics, `progressPct` nullability type debt, completed-plan integrity gate.
All PLAN-001..PLAN-017 closed findings and business decisions preserved.

## Files changed

| File | Change |
|---|---|
| `artifacts/api-server/src/routes/plans.ts` | Authoritative effective-sectors helper; all TC scope paths unified; completion gate |
| `lib/api-spec/openapi.yaml` | `PlanSummary.progressPct` → `type: ["integer", "null"]` |
| `lib/api-client-react/src/generated/api.schemas.ts` | Regenerated (orval) — `progressPct: number \| null` |
| `lib/api-zod/src/generated/api.ts` | Regenerated — `zod.number().nullable()` on plan responses |
| `artifacts/cafa-pmis/src/pages/plan-detail.tsx` | Legacy sector fallbacks removed; `plan_activities_incomplete` error surfaced; upload meta uses `sectors[0]` |
| `artifacts/cafa-pmis/src/pages/plans.tsx` | `as number \| null` suppression casts removed (type is now correct at source) |
| `artifacts/api-server/src/test/plans-wave1.test.ts` | New — 23 closure tests |
| `artifacts/api-server/src/test/plan-duplicate-integrity.test.ts` | Stale `tcSectorRestriction` middleware-shaped stub removed; TC-POST mock made sector-aware |

## PLAN-009 — Final sector model

Canonical model: **`sectors` = full JSON membership; `sector` = first element (legacy compat only).**

- `EFFECTIVE_SECTORS_SQL` (exported) is the single SQL fragment resolving effective sectors: non-empty `pl.sectors` JSONB → `[pl.sector]` → `[p.sector]` → `[]`.
- `getPlanMeta(planId, client?)` now returns `sectors: string[]` (with a TS-side mirror of the same fallback chain); `getPlanEffectiveSectors(planId, client?)` is the authoritative helper, usable inside transactions via the optional client parameter.
- `assertAnySectorAllowed(req, sectors)` replaces single-sector TC guards: TC allowed when ANY effective sector overlaps their assignment.
- Deprecated `getPlanSector` wrapper removed.

Paths now unified on the helper:
- **List and dashboard** TC scope conditions (and the public `?sector=` filter) are exclusive membership predicates against `EFFECTIVE_SECTORS_SQL` — the precedence chain, never an OR with the legacy/project fallback, so a stale legacy `sector` column can never leak a plan to the wrong TC. `bySector` groups by the first effective sector; all dashboard sub-queries inherit the same WHERE.
- **Duplicate preflight** (GET /plans/duplicate-check) and the **CREATE 409 path** resolve the matched plan's full effective sectors via `getPlanEffectiveSectors` before deciding metadata visibility.
- **Transitions handler** guard and **notification path** use `meta.sectors`; `notifyNextApprover` receives the canonical primary sector (`sectors[0]`), never the raw legacy column. The submit path resolves the locked sectors array from the FOR UPDATE row (sectors JSONB → sector → FOR SHARE project sector).
- **CREATE** guard checks the full submitted sectors array.
- **PATCH consistency:** a sector-only PATCH re-syncs the canonical `sectors` array on single-sector plans and is rejected with 422 `sector_conflicts_with_sectors` on multi-sector plans. Paired `sector`/`sectors` payloads are canonicalised: the legacy field must equal the first entry of the list (422 on mismatch) and the UPDATE emits exactly one `sector` assignment — no duplicate-target SQL error, and the legacy column can never desynchronise from a non-empty canonical array.
- **PATCH sector-scope re-guard:** any PATCH changing `sector`, `sectors` or `projectId` is re-validated against the proposed effective sectors INSIDE the update transaction (via the client-aware helper) and rolled back with 403 on failure — a TC cannot move a plan into sectors outside their assignment, and an unauthorised change is never committed. The old post-COMMIT recheck was removed.
- **Frontend**: `plan-detail.tsx` no longer re-derives sectors ("sectors array else sector" fallbacks removed in load, cancel-reset, and display paths); the API `sectors` field — now computed by `EFFECTIVE_SECTORS_SQL` in `planSummarySelect` — is authoritative. The attachment upload meta derives its sector from `sectors[0]`, not the legacy field.

## progressPct contract

| | Before | After |
|---|---|---|
| OpenAPI | `progressPct: { type: integer }` (required) | `progressPct: { type: ["integer", "null"] }` |
| `api.schemas.ts` | `progressPct: number` | `progressPct: number \| null` (`@nullable`, line ~2078) |
| `api-zod` | `zod.number()` | `zod.number().nullable()` |
| Frontend | `(p.progressPct as number \| null)` casts | casts removed; native `?? -1` sort and "—" display unchanged |

Regeneration evidence: `pnpm --filter @workspace/api-spec run codegen` (orval 8.9.1) ran clean, followed by `tsc --build` for `lib/api-client-react` dist. No Plans-specific nullability suppression remains.

## Completed-plan integrity gate

Inside the PLAN-004 CAS transaction of `POST /plans/:planId/transitions`, before the CAS UPDATE, the `complete` action now:

1. `SELECT status FROM plans WHERE id = $1 FOR UPDATE` — 404 if missing; 409 `plan_status_conflict` if the locked status differs from the expected source.
2. `SELECT status, progress_pct FROM plan_activities WHERE plan_id = $1 AND status <> 'cancelled' FOR UPDATE`.
3. Rejects with **409 `{ error: "plan_activities_incomplete", message: "This plan cannot be marked as completed. Every non-cancelled activity must be completed with 100% progress, and at least one non-cancelled activity must exist." }`** when: zero eligible activities (including all-cancelled), or any eligible activity has `status != 'completed'` or `progress_pct != 100`.
4. The existing CAS `UPDATE … WHERE status = $expected` then commits the transition atomically with approval and audit rows.

**Concurrency protection:** the completion transaction locks the plan row FOR UPDATE and all eligible activity rows FOR UPDATE (plan-before-activities lock order). The activity-mutation PATCH path takes the same parent-plan FOR UPDATE lock before any activity read/write and re-checks editability (status + reopen-after-approval, via the transaction client) under the lock — so an activity PATCH that snapshotted an editable plan pre-transaction cannot resume after a concurrent completion commits and write an incomplete or new activity into a completed plan; it is rejected 409 `plan_approval_locked` and rolled back. PM/Super Admin Full Access does **not** bypass the gate. The frontend surfaces the error via the existing toast pattern and replicates no business rule.

## Migrations

None. No schema change; `sectors`/`sector` columns unchanged.

## Tests

New `plans-wave1.test.ts` (30 tests, all passing):
- **Sector regression (8):** single-sector TC visibility; multi-sector primary; multi-sector **secondary** access (core PLAN-009 fix); non-matching TC denied; PM/super_admin full access; project-sector inheritance + SQL fallback-order assertion; standalone state plan (in-state allowed / cross-state denied); HQ plan (state role denied / sector-matched TC allowed). Plus 3 stale-legacy-sector regressions: list predicate is exclusive precedence (no OR-leak), dashboard predicates + bySector grouping likewise, and sector-only PATCH on a multi-sector plan → 422; in-scope TC PATCHing to only out-of-scope sectors → 403 with in-transaction ROLLBACK (no COMMIT); consistent paired sector/sectors PATCH → 200 with exactly one sector assignment; conflicting paired payload → 422 before any mutation.
- **Completion gate (10):** all-completed succeeds; planned/in_progress/delayed blocked; completed+cancelled mix succeeds (SQL filter asserted); cancelled-only blocked; zero activities blocked; completed-but-<100% blocked; race-safety (plan FOR UPDATE ordered before activities FOR UPDATE, CAS predicate retained, stale locked status → 409); PM and super_admin cannot bypass (British-English message asserted); plus the completion-vs-activity-PATCH interleaving regression: locked status 'completed' → 409 `plan_approval_locked`, no activity write, ROLLBACK, no COMMIT.
- **progressPct contract (5):** no activities → null; all-cancelled → null + AVG excludes cancelled; single activity → number; mixed average passthrough; generated zod schema accepts `progressPct: null` and a number.

## Results

- **API server tests:** 57 files, **1568 passed, 0 failed**.
- **Frontend tests:** 64 files, **4626 passed, 0 failed**.
- **TypeScript:** full workspace `pnpm typecheck` passes with **zero errors**. The previously failing `overrideReason` contract was restored at the OpenAPI source (`WorkflowTransitionInput.overrideReason`) and clients regenerated; the two plan sentinel test mock typings were fixed for the client-aware helper signature.

## Remaining Plans residuals

- Other `progressPct: number` occurrences in the OpenAPI spec belong to States/Projects/Activities schemas — out of scope for the Plans module.
