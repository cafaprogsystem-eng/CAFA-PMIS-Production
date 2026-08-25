# Budget Dashboard Regression Closure

**Date:** 19 August 2026 (updated same day — BUD-REG sentinel closure, Task #607)  
**Tasks:** #605 (12-failure reconciliation) · #607 (BUD-REG-01..12 sentinel suite + BUD-* register reconciliation)  
**Prior regression task:** #603 — **CLOSED**  
**Final owned status:** **CLOSED — zero Budget/Dashboard-owned failures; regression gate GREEN**

> Scope note: this document closes the Budget/Dashboard **regression gate** only.
> It does **not** declare the Budgets module zero-residual closed.

## 1. Executive summary

The 12-failure baseline was reproduced before any changes. The failures were not one uniform role-gate regression:

- **8 stale expectations** still required `403` from mixed operational/financial dashboard endpoints after the authorised non-financial access contract was established.
- **3 production response-boundary defects** exposed financial property names with `null`, `false`, or empty values to excluded roles.
- **1 authentication fixture mismatch** omitted production's `requireAuth` middleware and therefore produced `200` instead of the asserted `401`.

The closure preserves both required access modes:

1. Authenticated operational users retain scoped non-financial data from `/dashboard/summary` and `/dashboard/sector-performance`.
2. Financial data remains available only to the canonical Budget & Donors role set.

Summary financial properties are now structurally absent for excluded roles. Sector performance retains its established stable-row redaction contract: `budgetUtilizationPct` is present but `null` for excluded roles. Fully financial endpoints still return the exact `403` denial response before querying data.

No State-level budget or expenditure proxy was restored.

## 2. Authoritative access contract

### 2.1 Canonical financial roles

The canonical `BUDGET_DONORS_ROLES` set is unchanged:

- Super Admin
- Executive Director
- Programme Manager
- Senior Programme Coordinator
- Technical Coordinator
- State Programme Officer

The excluded roles exercised by this closure are:

- State Office Manager
- Project Officer
- Programme Assistant
- Viewer

### 2.2 Endpoint and field matrix

| Endpoint | Approved Budget role | Authenticated excluded role | Unauthenticated |
|---|---|---|---|
| `/dashboard/summary` | `200`; operational and financial properties | `200`; scoped operational properties; all nine financial properties absent | `401` |
| `/dashboard/sector-performance` | `200`; scoped operational metrics and authorised financial utilisation | `200`; scoped operational metrics; `budgetUtilizationPct: null` | `401` |
| `/dashboard/sector-budget` | `200`; scoped financial payload | Exact `403` role denial | `401` |
| `/dashboard/donor-portfolio` | `200`; scoped donor budget and spend payload | Exact `403` role denial | `401` |
| `/dashboard/project-budget-performance` | `200`; scoped project financial basis | Exact `403` role denial | `401` |

The nine structurally redacted summary properties are:

`totalBudget`, `totalSpent`, `budgetRemaining`, `budgetAllocated`, `budgetUtilization`, `burnRatePct`, `currency`, `currencyMixed`, and `budgetByCurrency`.

OpenAPI now declares those summary properties optional and documents the role-dependent omission contract. Generated React and Zod clients were refreshed from that specification. The Budget page normalises an unavailable optional financial value to `null`; it does not invent zero.

## 3. Original 12-failure catalogue

| # | Suite / role | Route | Expected | Actual baseline | Classification | Root cause and closure |
|---:|---|---|---|---|---|---|
| 1 | Budget role gate / State Office Manager | `/dashboard/summary` | `403` | `200` | Stale expectation | Summary is a mixed endpoint after the non-financial parity decision. Replaced with exact operational-access and full financial-key absence assertions. |
| 2 | Budget role gate / Project Officer | `/dashboard/summary` | `403` | `200` | Stale expectation | Same contract mismatch in the test; corrected without widening any financial endpoint. |
| 3 | Budget role gate / Programme Assistant | `/dashboard/summary` | `403` | `200` | Stale expectation | Same contract mismatch in the test; corrected with exact redaction checks. |
| 4 | Budget role gate / Viewer | `/dashboard/summary` | `403` | `200` | Stale expectation | Same contract mismatch in the test; corrected with exact redaction checks. |
| 5 | Budget role gate / State Office Manager | `/dashboard/sector-performance` | `403` | `200` | Stale expectation | Operational sector metrics are authorised. Test now requires `200` and `budgetUtilizationPct: null`. |
| 6 | Budget role gate / Project Officer | `/dashboard/sector-performance` | `403` | `200` | Stale expectation | Same; operational fields remain available while the financial value is null-redacted. |
| 7 | Budget role gate / Programme Assistant | `/dashboard/sector-performance` | `403` | `200` | Stale expectation | Same; exact operational and financial-redaction assertions replace the broad gate assertion. |
| 8 | Budget role gate / Viewer | `/dashboard/sector-performance` | `403` | `200` | Stale expectation | Same; endpoint denial was not part of the established contract. |
| 9 | Access parity / State Office Manager | `/dashboard/summary` | Financial keys absent | Keys present with redacted values | Production defect | The route emitted one fixed object. It now builds an operational object and conditionally spreads finance only for approved roles. |
| 10 | Access parity / Project Officer | `/dashboard/summary` | Financial keys absent | Keys present with redacted values | Production defect | Fixed by the same structural response boundary; all nine keys are asserted absent. |
| 11 | Access parity / Programme Assistant | `/dashboard/summary` | Financial keys absent | Keys present with redacted values | Production defect | Fixed by the same structural response boundary; all nine keys are asserted absent. |
| 12 | Access parity / unauthenticated | `/dashboard/summary` | `401` | `200` | Fixture mismatch | The test app did not mount production's `requireAuth`. The fixture now mounts it before the dashboard router. |

The Budget role-gate fixture is `buildApp()` in `budget-role-gates-closure.test.ts`. The parity suite's shared Express app now mirrors production authentication middleware and mocks the same `@workspace/db` module imported by the route. Previously it mocked a different local module, allowing development-database queries to escape the fixture.

## 4. Role and scope evidence

| Role | Evidence retained or added |
|---|---|
| Super Admin | Receives exact summary finance, sector utilisation, sector budget, donor budget/spend, and project financial-basis payloads. |
| Executive Director | Same complete approved-role contract. |
| Programme Manager | Same complete approved-role contract; parity test also requires every summary finance key. |
| Senior Programme Coordinator | Same complete approved-role contract. |
| Technical Coordinator | Project predicates bind only the assigned sector. Donor portfolio and project financial-performance queries are asserted with `p.sector = ANY($1::text[])` and `[["WASH"]]`. Empty-sector scope produces a deny-all `FALSE` predicate. |
| State Programme Officer | Finance remains authorised only within the assigned State. Sector-budget parameters contain State `7`; donor portfolio binds `[7]`; project financial performance binds `[7, 7]` for project and allocation scope. |
| State Office Manager | Operational access only. A conflicting `stateId` query cannot widen the assigned State; finance keys are absent and financial-only endpoints return exact `403`. |
| Project Officer | Operational access only; finance keys are absent and financial-only endpoints return exact `403`. |
| Programme Assistant | Operational access only; finance keys are absent and financial-only endpoints return exact `403`. |
| Viewer | Operational access only; finance keys are absent, sector utilisation is null, and financial-only endpoints return exact `403`. |

Scope assertions inspect concrete SQL predicates and bound parameters rather than status-only responses, wildcard mocks, or role-agnostic truthy checks.

## 5. Financial edge cases and State proxy removal

The existing sector-performance closure remains green for:

- one-currency utilisation calculated as `SUM(spent) / SUM(budget) × 100`;
- mixed currencies returning `null` utilisation;
- zero budget returning `null`;
- null spend remaining unavailable rather than becoming zero; and
- overspend remaining above 100%.

The State performance engine closure remains green and continues to require:

- no project-budget or project-spend proxy in the State query;
- `budgetUtilizationPct: null`;
- a null budget score component; and
- score renormalisation across available non-financial components.

This closure does not create a State expenditure source and does not derive State spend from project-level activity expenditure.

## 6. Production, specification, fixture, and client changes

| File | Change |
|---|---|
| `artifacts/api-server/src/routes/dashboard.ts` | Structurally omits summary financial properties for excluded roles; preserves the sector-performance null-redaction convention and all financial endpoint gates. |
| `artifacts/api-server/src/routes/__tests__/budget-role-gates-closure.test.ts` | Reconciles stale expectations, adds exact approved/excluded role payloads, all financial endpoints, TC empty-sector and assigned-sector evidence, State clamping, and unauthenticated coverage. |
| `artifacts/api-server/src/routes/__tests__/dashboard-access-parity.test.ts` | Corrects the database mock target, mirrors production authentication, adds deterministic fixtures, and replaces weak assertions with exact response and scope checks. |
| `lib/api-spec/openapi.yaml` | Documents mixed summary access and makes role-dependent financial properties optional. |
| `lib/api-client-react/src/generated/api.schemas.ts` | Regenerated client contract. |
| `lib/api-zod/src/generated/api.ts` | Regenerated response schema. |
| `artifacts/cafa-pmis/src/pages/budget.tsx` | Handles optional financial summary values as unavailable (`null`) without manufacturing zero. |

The plan mentioned `dashboard-analytics-authz.test.ts` and `dashboard-nonfinancial-access-parity.test.ts`, but neither file exists in the current checkout. Their required role, authentication, redaction, and scope behaviours are covered by the expanded targeted suites above; no pass is claimed for nonexistent files.

## 6a. BUD-REG-01..12 named sentinel suite (Task #607)

The fragmented BUD-GATE-*, DASH-ACCESS-*, BUD-SECTOR-* and BUD-STATE-* coverage is now
capped by a coherent named sentinel layer:
`artifacts/api-server/src/routes/__tests__/budget-regression-sentinels.test.ts` (55 tests).
Each sentinel proves an exact boundary; none can be weakened to a truthy or status-only check.

| Sentinel | Boundary proven | Exact assertion |
|---|---|---|
| BUD-REG-01 | Financial access boundary: `/sector-budget`, `/donor-portfolio`, `/project-budget-performance` deny all four excluded roles | Status `403` **and** exact body `{"error":"Access to Budget & Donors requires an approved role."}` **and** zero request-driven financial SQL executed |
| BUD-REG-02 | Summary structural redaction | All nine financial keys asserted **absent by key** (`hasOwnProperty` filter must equal `[]`) — null-filled values would fail |
| BUD-REG-03 | Non-financial dashboard access | Every operational key present for each excluded role, with exact fixture values |
| BUD-REG-04 | Approved-role financial contract | All six canonical roles receive all nine financial keys with exact values |
| BUD-REG-05 | Sector-performance stable-row redaction | `budgetUtilizationPct` present and strictly `null` for excluded roles; exact `50` for every approved role |
| BUD-REG-06 | Authentication boundary | Exact `401` (never 200/403) on all five dashboard endpoints |
| BUD-REG-07 | TC sector clamp | Query binds `p.sector = ANY($1::text[])` with exactly `[["WASH"]]`; empty-sector TC gets exact fail-closed payload and an explicit `AND FALSE` deny-all predicate |
| BUD-REG-08 | State clamp | SOM/SPO bind only the assigned state `7`; the attacker-supplied `999` is asserted absent from every bound parameter |
| BUD-REG-09 | Multi-currency portfolio | Cross-reference: BUD-SECTOR-01..05 asserted present in the authoritative suite + direct exact mixed-currency → `null` + `mixedCurrencies: true` |
| BUD-REG-10 | Zero-budget / null-spend / overspend | Direct exact assertions: zero budget → `null`; null spend → `null`; overspend → `150` (governed by BUD-SECTOR-03/04/05, not duplicated) |
| BUD-REG-11 | State budget-utilisation proxy (BUD-004 / BUD-BD-04) | `computeStateScores` returns strict `null` for `budgetUtilizationPct` and the budget component; proxy SQL asserted absent; cross-reference to BUD-STATE-01..10 asserted |
| BUD-REG-12 | Allocation currency (BUD-BD-02) | `project_state_allocations` schema asserted to contain **no** currency column; cap comparisons asserted same-unit with no FX machinery in `projects.ts` |

## 6b. Consolidated BUD-* finding register (Task #607 reconciliation)

Every finding from `budgets-module-full-functional-audit.md` and every business decision
from `budgets-business-decisions.md`, classified against current merged code:

| ID | Sev | Finding | Classification | Evidence |
|---|---|---|---|---|
| BUD-001 | P0 | Fabricated 40 % State utilisation in `states.ts` | **Closed** | `NULL::int` returned; UI renders `—`; BUD-STATE suite + BUD-REG-11 |
| BUD-002 | P1 | Soft-deleted projects in budget analytics | **Closed** | `deleted_at IS NULL` on all budget analytics queries (verified in merged `dashboard.ts`) |
| BUD-003 | P1 | Missing UNIQUE/FK/CHECK on allocations | **Closed** | Migration 027 with remediation |
| BUD-004 | P1 | State utilisation proxy in `computeStateScores` | **Closed** | Proxy SQL removed (`NULL::int AS "budgetUtilizationPct"`, null component, renormalised score); BUD-STATE-01..10 + BUD-REG-11. Permanently removed — not to be re-opened |
| BUD-005 | P2 | Legacy cross-currency headline totals in `/dashboard/summary` | **Not a Defect** (compatibility-safe residual) | Frontend consumes top-level totals only when `!currencyMixed`; per-currency rows authoritative (semantics-currency closure §BUD-005) |
| BUD-006 | P2 | Project-detail zero-budget/currency display | **Closed** | Zero-budget → `—`; project currency threaded everywhere; BUD-DETAIL-01..05 |
| BUD-007 | P2 | Sector-performance cross-currency ratio | **Closed** | Mixed → `null` + flag; zero/null → `null`; overspend preserved; BUD-SECTOR-01..05 + BUD-REG-09/10 |
| BUD-008 | P2 | No FK on `projects.donor_id`, no UNIQUE donor name | **Open (out of scope)** — needs donor data remediation decision first; not a regression-gate item |
| BUD-009 | P2 | Silent USD default currency | **Not a Defect** (accepted) | Form always sends currency; schema default documented |
| BUD-010 | P3 | `budget_total DEFAULT 0` ambiguity | **Not a Requirement** | Documented DB semantic; no behaviour defect |
| BUD-011 | P3 | Inconsistent null-vs-zero defaults on allocations | **Not a Requirement** | Documented; null≠zero enforced at analytics layer |
| BUD-012 | P3 | Direct/indirect costs not reconciled to budget_total | **Not a Requirement** | Informational fields by design |
| BUD-013 | P3 | No endpoint-level role rejection | **Superseded → Closed** | Original "upfront gate on all three endpoints" remedy superseded by the mixed-access contract: upfront 403 retained on `/sector-budget` (+ donor-portfolio, project-budget-performance); `/summary` and `/sector-performance` use structural/null redaction per the authorised non-financial access decision. BUD-GATE-01..08, DASH-ACCESS-01..13, BUD-REG-01..05 |
| BUD-014 | P3 | Allocation audit log lacks old values | **Not a Requirement** | Prior state recoverable from earlier log entries; documented |
| BUD-015 | P3 | Redundant ROLLBACK after COMMIT in catch | **Not a Defect** | Harmless warning; documented |
| BUD-BD-01 | BD | Allocation cap governance | **Closed (implemented)** | Unconditional, actor-independent, in-transaction under `FOR UPDATE`; BUD-CAP-01..15 |
| BUD-BD-02 | BD | Allocation currency | **Closed — accepted design constraint, no code change required** | Allocations inherit `projects.currency`; no allocation currency column, no FX conversion anywhere in the module (schema + cap-path verified from merged code); UI labels allocation headings with the project ISO code. Sentinel: BUD-REG-12 |
| BUD-BD-03 | BD | Closed/completed projects in portfolio | **Closed (accepted behaviour)** | Historical-portfolio rule; only soft-delete excludes |
| BUD-BD-04 | BD | State performance budget proxy | **Closed (Option B implemented, permanent)** | Proxy nulled and weight renormalised; confirmed in both BUD-STATE-* and BUD-REG-11. Permanently removed — re-opening is explicitly out of scope |

## 7. Final regression results

| Validation | Result |
|---|---|
| Reproduced original two-suite baseline (#605) | 2 files, 45 tests: **33 passed, 12 failed** |
| Final original targeted suites (re-verified for #607, pre-sentinel) | 2 files, **84/84 passed** |
| New BUD-REG-01..12 sentinel suite (#607) | 1 file, **55/55 passed** |
| Budget audit and closure set | 6 files, **146/146 passed** |
| Full API-server test suite (#605) | 84 files, **2,212/2,212 passed** |
| Full API-server test suite (#607, incl. BUD-REG sentinels) | 85 files, **2,267/2,267 passed** |
| Relevant frontend Budget/State tests (re-verified for #607) | 6 files, **383/383 passed** |
| OpenAPI client generation and library TypeScript build | **Passed** |
| API-server production build | **Passed** |
| API-server TypeScript | Budget/Dashboard-owned files: **0 errors**. Global baseline (unrelated, not attributable to Budget/Dashboard): 7 pre-existing errors in `plans-aggregate-integration.test.ts`, plus pre-existing errors in `reports.ts` (4), `risks.ts` (1) and `risk-audit.test.ts` (1) |
| Frontend TypeScript | **Clean (0 errors)** — codegen regeneration initially dropped the undocumented `RiskListResponse.summary` used by `risks.tsx`; fixed by documenting `summary` in `openapi.yaml` and regenerating |
| Independent security review | **Passed**; no security or functional contract defect found |
| Diff whitespace validation | **Passed** |

The global TypeScript blockers are outside Budget/Dashboard scope and are not caused by this closure. They are reported explicitly rather than represented as a green repository-wide typecheck.

## 8. Closure decision

All 12 original failures have an explicit classification and resolution. Every BUD-* finding and BUD-BD-* business decision is explicitly classified in the consolidated register (§6b). The canonical financial role set, financial endpoint denials, operational access, structural redaction, TC and State scoping, financial edge cases, and BUD-004 State-proxy removal are covered by exact, named assertions in the BUD-REG-01..12 sentinel suite, cross-referenced to the governing BUD-GATE-*, DASH-ACCESS-*, BUD-SECTOR-*, BUD-STATE-* and BUD-CAP-* suites.

**The Budgets module regression gate is GREEN (closed): zero Budget/Dashboard-owned test or TypeScript failures.** This statement closes the regression gate only; the Budgets module itself is **not** declared zero-residual closed here (BUD-008 remains open, pending a donor data-model decision).

**Task #605: CLOSED. Task #607: CLOSED. Prior task #603: CLOSED.**