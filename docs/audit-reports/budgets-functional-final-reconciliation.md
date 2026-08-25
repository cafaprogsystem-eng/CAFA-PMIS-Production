# Budgets Functional Final Reconciliation — Current-Head Closure

**Date:** 19 August 2026  
**Scope:** Budgets, Budget/Dashboard financial contracts, Project budget and
State-allocation write paths, and their owned API and frontend evidence.  
**Method:** Current source and current tests take precedence over historical
audit snapshots. No historical financial data was changed.

## Closure decision

**ZERO-RESIDUAL COMPLETE — BUDGETS FUNCTIONAL MODULE**

The Software Residual Register is **NONE**. The eight pre-enforcement
over-allocation records are separately classified as **DATA REMEDIATION —
AWAITING FINANCE**; they are not a current software defect and do not block
functional-module closure. Their only approved future financial-mutation path
is Task #609 through the normal audited Project PATCH or allocation-replacement
API paths. No automatic correction, uplift reversal, scaling, allocation
reduction, or budget increase was performed.

This decision is based on 14 targeted current-head suites: **14 files,
530 passed, 0 failed**. Budget/Dashboard-owned TypeScript errors are **0**.
Repository-wide TypeScript failures are documented below as **EXTERNAL
BASELINE** and are not Budget/Dashboard-owned.

---

## 1. BUD finding register

| ID | Original issue | Current implementation and sentinel evidence | Final classification | Residual state |
|---|---|---|---|---|
| BUD-001 | Fabricated State utilisation | State and performance outputs return unavailable; no State spend is inferred. BUD-STATE-01…10 and BUD-REG-11 prove null metric, absent proxy SQL, and score renormalisation. | **CLOSED** | None |
| BUD-002 | Soft-deleted projects in financial analytics | Budget/Dashboard portfolio queries use `deleted_at IS NULL`; BUD-AUD and BUD-DONOR-11 cover the boundary. | **CLOSED** | None |
| BUD-003 | Allocation uniqueness, referential integrity and non-negative values missing | Migration 027 provides unique `(project_id, state_id)`, project/state FKs and a non-negative check. | **CLOSED** | None |
| BUD-004 | State-performance project-budget proxy | The proxy is permanently removed: State budget utilisation and the component are null, with available components reweighted. | **CLOSED** | None |
| BUD-005 | Legacy summary fields can be cross-currency raw totals | Per-currency values and `currencyMixed` are authoritative; UI only consumes legacy headline values in a compatible single-currency context. | **ACCEPTED DESIGN CONSTRAINT** | None |
| BUD-006 | Project Detail invented 100% unspent and omitted Project currency | Zero-budget utilisation is unavailable (`—`), genuine 0% is preserved, and Project currency threads through the detail and budget views. BUD-DETAIL-01…05. | **CLOSED** | None |
| BUD-007 | Sector utilisation could mix currencies | Mixed currency, zero budget, or unavailable spend returns null; overspend remains above 100%. BUD-SECTOR-01…05 and BUD-REG-09/10. | **CLOSED** | None |
| BUD-008 | Donor identity, FK, grouping, deduplication and nullable spend drift | Migration 030 adds `projects.donor_id` FK with `ON DELETE SET NULL`; Create/PATCH invalid donor validation is transactional and actor-independent; grouping is canonical-ID-first, per-currency and project-ID deduplicated. BUD-DONOR-01…18. | **CLOSED** | None |
| BUD-009 | Project currency has a documented USD schema default | The project form sends currency explicitly; currency remains authoritative at Project level and no allocation/FX fallback is introduced. | **NOT A DEFECT** | None |
| BUD-010 | `budget_total = 0` cannot mean “not entered” | Zero is the established write-model value; calculations distinguish zero from unavailable expenditure rather than inventing utilisation. | **NOT A DEFECT** | None |
| BUD-011 | Allocation/default nullish values needed semantic review | Financial presentation preserves unavailable spend as null where required; stored allocation zero is not represented as State spend or utilisation. | **NOT A DEFECT** | None |
| BUD-012 | Direct and indirect costs are not reconciled to total budget | They are informational components, not an alternative total budget source. `projects.budget_total` remains canonical. | **NOT A DEFECT** | None |
| BUD-013 | Dashboard access originally assumed all endpoints required a 403 role gate | Mixed endpoints preserve scoped operational data while structurally omitting protected finance; financial-only endpoints remain hard-gated. BUD-GATE, DASH-ACCESS and BUD-REG-01…08. | **CLOSED** | None |
| BUD-014 | Allocation audit history did not snapshot every prior row | Allocation replacement records its canonical submitted set; Project budget changes include old and new budgets. Rejected writes do not create success audit entries. | **NOT A DEFECT** | None |
| BUD-015 | Catch path could issue a redundant rollback after a completed transaction | Current rejected writes roll back before mutation; the added BUD-ZR-01 confirms malformed allocation requests perform no transaction/audit action. No false-success record exists. | **NOT A DEFECT** | None |

## 2. Business-decision register

| ID | Current rule and proof | Final classification | Residual state |
|---|---|---|---|
| BUD-BD-01 | `SUM(state allocations) ≤ project budget` is unconditional, including zero budget; exact sums and zero-plus-zero are valid; positive allocation at zero budget and all excess values return `422 over_allocation`. Create, Project PATCH and replacement are covered by BUD-CAP-01…15. | **CLOSED** | None |
| BUD-BD-02 | An allocation inherits `projects.currency`. There is no allocation-currency column, FX conversion, manual conversion or cross-currency allocation sum. BUD-REG-12 verifies the schema and cap path. | **ACCEPTED DESIGN CONSTRAINT** | None |
| BUD-BD-03 | The portfolio is historical: non-deleted draft, active, completed and closed Projects remain included. Only soft deletion excludes a Project. | **ACCEPTED DESIGN CONSTRAINT** | None |
| BUD-BD-04 | There is no canonical State expenditure ledger. State performance budget utilisation and its score component are null; the score renormalises over available non-financial components. | **CLOSED** | None |

---

## 3. Write integrity, concurrency and rejected-write audit behaviour

### Allocation cap

The hard cap is actor-independent. Programme Manager and Super Admin access
does not bypass linked-State membership, negative-value checks, donor checks or
the allocation cap.

| Write path | Current guarantee |
|---|---|
| Project Create | Validates non-negative budget and allocation rows; computes submitted allocation sum before any row is written. |
| Project PATCH | Is a full Project replacement for nested State/allocation data. Within one transaction it locks the Project, validates the effective incoming budget and replacement allocations, then replaces the stored set. A lower budget with over-cap submitted allocations returns `422 over_allocation`. |
| State Allocation replacement | Validates the required OpenAPI `allocations` array before acquiring a client; validates every submitted State is linked; begins a transaction; locks the parent Project `FOR UPDATE`; checks the cap; then deletes/inserts and commits. |

The lock order is `BEGIN` → parent Project `FOR UPDATE` → cap check →
replacement/update → `COMMIT`. Project PATCH and allocation replacement
therefore serialise on the same parent row; a concurrent budget change and
allocation replacement cannot both commit an invalid sum.

The current rules are:

- zero budget plus positive allocation: rejected with `422 over_allocation`;
- zero budget plus zero allocation: allowed;
- exact allocation sum: allowed;
- allocation sum above budget: rejected with `422 over_allocation`;
- negative budget: rejected with `400 validation_error`;
- negative allocation: rejected with `422 invalid_allocation`;
- malformed replacement body or omitted `allocations`: rejected with
  `400 validation_error`, with no transaction or audit event (**BUD-ZR-01**).

Successful allocation replacement logs `state_allocations_replace` with the
canonical submitted State/budget detail. A Project budget change logs old and
new budget values. Rejected cap, negative-allocation and invalid-body writes
run before the successful-write audit path, so they cannot create a false
success audit event.

## 4. Currency and financial truth

- Project currency is the monetary authority. State allocations inherit it.
- No allocation currency, FX conversion, manual conversion or cross-currency
  allocation arithmetic exists.
- Donor and portfolio mixed-currency views expose per-currency figures; the
  compatible legacy raw total is never presented as a fabricated single
  currency in a mixed portfolio.
- Sector utilisation is unavailable for mixed currencies, zero/missing budget
  and unavailable spend. It is not coerced to zero.
- Positive budget plus genuine zero spend remains **0%**.
- Zero budget is not labelled **100% unspent**.
- Overspend is not capped at 100%; remaining balance may be negative.
- State expenditure is never fabricated from Project expenditure. An actual
  stored allocation establishes **State Allocation** budget basis; otherwise
  the basis is **Project-Level Budget**. Project-Level Budget is never named
  State Budget.

Project Detail has no editable `budget_spent` control. It consistently uses
the Project ISO currency and displays unavailable values rather than a
hard-coded currency fallback.

## 5. Donor and historical portfolio integrity

Donor identity is the canonical donor ID, not free-text spelling. The donor
FK is nullable with `ON DELETE SET NULL`, preserving the historical free-text
attribution. Project Create and PATCH reject a nonexistent `donorId` with
actor-independent `422 invalid_donor_id`; PATCH performs that validation under
the Project lock and donor key-share lock.

Portfolio grouping:

- groups linked records by canonical donor ID;
- retains legacy free-text-only records as `unlinked`;
- surfaces blank/unlinked records as `missing`;
- flags a linked/free-text mismatch rather than splitting canonical identity;
- deduplicates by Project ID before budget, spend, beneficiaries and count;
- keeps mixed currencies separate and exposes null top-level currency for a
  mixed group; and
- retains non-deleted draft, active, completed and closed Projects.

`budgetSpent` is nullable in runtime, OpenAPI, generated React types and
generated Zod types when no activity spend exists. No Budget-owned contract
regeneration remains required.

## 6. Access, scope and proxy contracts

The current financial role set is derived from the implementation:

| Role group | Contract |
|---|---|
| Super Admin, Executive Director, Programme Manager, Senior Programme Coordinator | Financial and operational access within their authorised scope. |
| Technical Coordinator | Financial access limited to assigned sectors; empty sector assignment is deny-all. |
| State Programme Officer | Financial access limited to assigned State; null State assignment fails closed. |
| State Office Manager, Project Officer, Programme Assistant, Viewer | Scoped operational dashboard fields only. Summary financial keys are structurally absent; sector-performance financial value is null; financial-only endpoints return exact 403. |

`/dashboard/sector-budget`, donor portfolio and Project budget performance are
financial-only. `/dashboard/summary` and `/dashboard/sector-performance` are
mixed contracts: authorised operational fields remain available, while finance
is redacted without leaking zero, null placeholder values or property names.
Attacker-supplied State filters cannot widen State scope.

No State-facing surface uses Project expenditure as a State ledger. State
performance retains `budgetUtilizationPct: null` and a null budget component;
the score renormalises rather than treating unavailable data as 0%.

## 7. Migration and runtime integrity

| Tracked migration | Purpose |
|---|---|
| `027_project_state_allocations_integrity` | Allocation uniqueness, foreign keys and non-negative database constraint. |
| `029_allocation_cap_residual_warning` | Warning-only discovery of pre-enforcement over-allocation; no data mutation. |
| `030_donor_id_fk_constraint` | `projects.donor_id` FK to donors with `ON DELETE SET NULL`. |

Budget runtime routes contain no startup DDL. The aggregate allocation cap is
enforced by the locked application transactions because a PostgreSQL `CHECK`
cannot safely express a sum across child rows; it is not weakened by role.

## 8. Test inventory

All results below were run against current head on 19 August 2026.

### API and service evidence — 9 files, 239 passed, 0 failed

| File | Evidence | Result |
|---|---|---:|
| `artifacts/api-server/src/routes/budget-audit.test.ts` | BUD-AUD functional and formula sentinels | 31/31 |
| `artifacts/api-server/src/routes/__tests__/budget-allocation-cap-closure.test.ts` | BUD-CAP-01…15 and BUD-ZR-01 | 16/16 |
| `artifacts/api-server/src/routes/__tests__/budget-historical-overallocation.test.ts` | BUD-HIST historical-register safeguards | 13/13 |
| `artifacts/api-server/src/routes/__tests__/budget-regression-sentinels.test.ts` | BUD-REG-01…12 access/currency/proxy sentinels | 55/55 |
| `artifacts/api-server/src/routes/__tests__/budget-role-gates-closure.test.ts` | BUD-GATE role and scope checks | 62/62 |
| `artifacts/api-server/src/routes/__tests__/budget-sector-performance-closure.test.ts` | BUD-SECTOR mixed currency/null/overspend | 5/5 |
| `artifacts/api-server/src/routes/__tests__/bud-donor-closure.test.ts` | BUD-DONOR-01…18 | 24/24 |
| `artifacts/api-server/src/routes/__tests__/dashboard-access-parity.test.ts` | DASH-ACCESS redaction and operational parity | 22/22 |
| `artifacts/api-server/src/services/__tests__/performance-engine-state-budget.test.ts` | BUD-STATE-01…10 | 11/11 |

### Frontend evidence — 5 files, 291 passed, 0 failed

| File | Evidence | Result |
|---|---|---:|
| `artifacts/cafa-pmis/src/test/budget-detail-closure.test.ts` | BUD-DETAIL Project Detail financial truth | 11/11 |
| `artifacts/cafa-pmis/src/test/budgets-overview.test.ts` | Overview calculations and presentation | 74/74 |
| `artifacts/cafa-pmis/src/test/budgets-visual-refinement-phase-1.test.ts` | Phase 1 visual regression coverage | 12/12 |
| `artifacts/cafa-pmis/src/test/budget-tab-metrics.test.tsx` | Budget tab metric semantics | 41/41 |
| `artifacts/cafa-pmis/src/test/project-budget-performance.test.ts` | Project budget-basis/performance contracts | 153/153 |

### TypeScript ownership

- **Budget/Dashboard-owned errors:** 0.
- **API external baseline:** 13 errors in Risks, Reports and
  `plans-aggregate-integration.test.ts`; none originates in Budget/Dashboard
  files.
- **Frontend external baseline:** 31 errors in Reports, Risks, Plans and
  consolidated-report/PMR components; none originates in Budget pages,
  Project Detail budget surfaces or Dashboard Budget contracts.

These unrelated errors are **EXTERNAL BASELINE**. They are not repaired or
counted as Budget module software residuals.

## 9. Residual registers

### Software Residual Register

**NONE.**

### Data Remediation Register

All records below are **DATA REMEDIATION — AWAITING FINANCE**. Current guarded
writes prevent recurrence; the canonical value cannot be recovered safely from
the evidence, so no automatic remediation is authorised.

| Project ID | Code | Reason for Finance decision |
|---:|---|---|
| 3 | CAFA-2024-003 | Historic 4% uplift; confirm budget or Khartoum allocation. |
| 4 | CAFA-2024-004 | Historic 12% uplift; confirm budget or Algadarif allocation. |
| 11 | CAFA-2025-011 | Historic 4% uplift; confirm budget or Sennar allocation. |
| 12 | CAFA-2025-012 | Historic 12% uplift; confirm budget or North Darfur allocation. |
| 16 | CAFA-MPLOQ09S | Test-origin record; confirm budget, allocation or soft deletion. |
| 17 | CAFA-MPLP9SW5 | Test-origin record; confirm budget, allocation or soft deletion. |
| 21 | CAFA-KRT-002 | Test-origin record; confirm budget or allocation. |
| 25 | CAFA-JZR-002 | Historic rounded 4% uplift; confirm budget or Al Jazeera allocation. |

## 10. Historical wording supersession addendum

The following older reports are historical snapshots. Their narrative and
evidence remain intact; only their current-head status wording is superseded
by this reconciliation:

- `budgets-module-full-functional-audit.md` predates migration 030 and the
  final unconditional cap/locking work; its BUD-008 and BUD-BD-01 pending
  language is superseded.
- `budgets-semantics-currency-gates-closure.md` uses pre-decision wording that
  lists BUD-BD-02 through BUD-BD-04 as open; this is superseded by the final
  classifications in section 2.
- `budgets-allocation-cap-integrity-closure.md` predates the accepted
  BUD-BD-02 closure classification; its “open by design” language is
  superseded.
- `budgets-state-performance-proxy-closure.md` preserves an interim
  “remaining findings” list; State proxy removal is final and BUD-004 is
  closed.
- `budget-dashboard-regression-closure.md` correctly closed its regression
  gate but still says BUD-008 was open. The later donor-model closure and this
  current-head reconciliation supersede that statement.

This addendum does not rewrite prior audits. It records the verified sequence:
BUD-008 is now closed, all BUD-BD decisions have their final classifications,
the Software Residual Register is none, and the eight Finance-held records
remain data remediation only.