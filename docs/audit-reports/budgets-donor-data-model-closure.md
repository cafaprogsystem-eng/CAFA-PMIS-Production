# Budgets — Donor Data Model Integrity Closure

**Audit reference:** BUD-008  
**Date:** 2026-08-19  
**Auditor:** Replit Agent  

---

## 1. Executive Finding

All four defects identified during reconnaissance have been remediated. The donor data model
now enforces referential integrity at both the application layer (CREATE and PATCH validation)
and the database layer (FK constraint added via migration 030). The portfolio grouping logic
no longer carries a latent double-count bug. The OpenAPI contract now correctly reflects that
`budgetSpent` may be `null` when no activity records exist.

The current dataset contains **32 active projects**, all carrying legacy free-text donor
attribution with no canonical `donor_id` links. No bogus `donor_id` references were found.
No duplicate canonical donor names exist. The dataset is internally consistent; no automatic
data remediation was required.

**BUD-008: CLOSED**

---

## 2. Current Donor Data Model

| Layer | Detail |
|---|---|
| `donors` table | `id` serial PK, `name` text NOT NULL, nullable `abbreviation`, `country`, `contactName`, `contactEmail`, `createdAt`. No UNIQUE constraint on `name` (duplicate names flagged in AUDIT-2). |
| `projects.donor` | Required free-text field — always present; retains historical attribution even when `donor_id` is null. |
| `projects.donor_id` | Nullable integer; FK constraint `fk_projects_donor_id` added by migration 030 with `ON DELETE SET NULL`. |
| Portfolio grouping | TypeScript grouping in `routes/dashboard.ts`: `canonical:<d_id>` / `free:<lc-trim>` / `missing:<projectId>`. |
| Per-currency | Budget and spend accumulated separately per ISO 4217 currency code. |
| Data-quality states | `linked` / `unlinked` / `name_mismatch` / `missing` — most-severe-wins merge across projects in the same canonical group. |

---

## 3. Canonical Identity

Canonical donors are rows in the `donors` table referenced by `projects.donor_id`. When a
project carries a `donor_id`, its portfolio group key is `canonical:<donor_id>`, ensuring all
projects linked to the same canonical entity appear together regardless of how the free-text
`donor` field is spelled or cased.

Name comparisons use `LOWER(TRIM(...))` equivalence: a project whose free-text donor does not
match the canonical name (after case-folding) is flagged `name_mismatch` rather than treated
as a separate donor.

---

## 4. Legacy Compatibility

Projects without a `donor_id` retain their free-text `donor` value. These are grouped by
normalised free-text (`free:<lc-trim>`) and surfaced with `dataStatus: "unlinked"`. Projects
with neither a `donor_id` nor a meaningful `donor` string are surfaced individually with
`dataStatus: "missing"`.

The `donor` free-text column is preserved as-is; migration 030 does not alter it. If a donor
row is deleted, `ON DELETE SET NULL` nulls out `donor_id` and the free-text field continues
to hold the historical attribution.

---

## 5. Project Create / PATCH

### DEFECT-1 (CREATE) — Fixed

**File:** `artifacts/api-server/src/routes/projects.ts`

Before the fix, providing a nonexistent `donorId` on `POST /projects` silently persisted the
bogus integer. The fix adds an existence check immediately after `BEGIN`: if the `donors` row
is not found, the transaction is rolled back and `422 { error: "invalid_donor_id" }` is
returned. This applies to all roles — Full Operational Access does not bypass the check.

### DEFECT-2 (PATCH) — Fixed

**File:** `artifacts/api-server/src/routes/projects.ts`

Before the fix, the donor lookup ran before `BEGIN`, leaving a brief race window. The fix
moves the lookup to after `BEGIN` and after the `FOR UPDATE` row lock on the project. A
nonexistent `donorId` now triggers the same `422 { error: "invalid_donor_id" }` with
`ROLLBACK`, closing the spec §27 race window.

Both fixes are actor-independent: `program_manager` (Full Operational Access) and
`super_admin` receive the same `422` response.

---

## 6. Donor Portfolio Grouping

### DEFECT-3 (Budget double-count) — Fixed

**File:** `artifacts/api-server/src/routes/dashboard.ts`

The `currencyBudget` accumulation block was outside the `if (!g.projectIds.has(row.id))`
deduplication guard, meaning a project appearing multiple times in the result set (e.g., due
to a scope-scoped JOIN with `project_states`) would have its budget counted once per row
rather than once per project.

The fix moves the `currencyBudget.set(...)` call inside the dedup guard, alongside
beneficiaries and activity spend accumulation. All four accumulators now share a single
deduplication gate, eliminating the latent double-count.

---

## 7. Multi-Currency Semantics

When a canonical donor group contains projects in more than one currency:

- `currencyMixed: true` is set on the group.
- `currency` (top-level) is `null` — no fabricated cross-currency total is presented as
  a single currency value.
- `budgetByCurrency` contains one entry per ISO 4217 code with the deduplicated budget
  and (where available) activity spend for that currency.

Budget and spend are accumulated inside the project-ID dedup guard, so a project in USD and
a project in SDG for the same donor are never summed into a single USD or SDG figure.

### Frontend Multi-Currency Safety — Fixed (`budget.tsx`)

**File:** `artifacts/cafa-pmis/src/pages/budget.tsx`

A UI defect was present in the Donor Portfolio table: when the user selected a specific
currency from the filter and a donor had `currencyMixed: true`, the Budget Total and Budget
Spent columns fell through to render `d.budgetTotal` (a raw cross-currency sum) and
`d.budgetSpent` with `donorCurr = null`. This displayed a meaningless combined figure with
no currency label.

The fix introduces `mixedFilteredEntry` — the `budgetByCurrency` entry for the selected
currency for each mixed donor. When a matching entry exists, its `budgetTotal`, `budgetSpent`,
and derived utilisation are displayed; when no entry exists for the selected currency, `—` is
shown. The raw cross-currency `d.budgetTotal` is only ever used for non-mixed donors (those
with a single currency), ensuring no fabricated cross-currency value reaches the user.

---

## 8. Historical Portfolio

The portfolio endpoint returns all non-deleted projects regardless of status (`draft`,
`active`, `completed`, etc.). The only exclusion clause is `WHERE p.deleted_at IS NULL`.
Closed and completed projects remain visible in historical portfolio reporting.

---

## 9. Data Quality States

| State | Condition |
|---|---|
| `linked` | `donor_id` is not null and `LOWER(TRIM(donor)) == LOWER(TRIM(d.name))` |
| `name_mismatch` | `donor_id` is not null but free-text `donor` differs from `d.name` after normalisation |
| `unlinked` | `donor_id` is null but `donor` free-text is non-blank |
| `missing` | `donor_id` is null and `donor` is blank or null |

The most severe state wins for any group that mixes states across its projects.
`dataIssues` lists all active issue codes for the group.

---

## 10. Current Dataset Reconciliation (AUDIT-3)

Query executed against the live database (2026-08-19):

```
total_active        : 32
canonical_linked    : 0
legacy_unlinked     : 32
bogus_references    : 0
missing_donor       : 0
name_mismatches     : 0
```

All 32 active projects carry free-text donor attribution with no canonical `donor_id` links.
This is consistent with a system in early adoption: canonical donors have been configured in
the `donors` table but no project has yet been formally linked via `donor_id`.

No bogus references were found. No automatic data remediation was required.

---

## 11. Referential Integrity (AUDIT-1)

**Finding:** No FK constraint existed on `projects.donor_id` prior to this closure.

**Action:** Migration 030 (`030_donor_id_fk_constraint`) was added to the migration runner.
It performs a pre-flight bogus-reference scan (none found), then adds:

```sql
ALTER TABLE projects
  ADD CONSTRAINT fk_projects_donor_id
  FOREIGN KEY (donor_id) REFERENCES donors(id) ON DELETE SET NULL;
```

`ON DELETE SET NULL` ensures that removing a canonical donor record nulls out the project's
`donor_id` without destroying the historical free-text `donor` attribution.

---

## 12. API / Generated Types

### DEFECT-4 (OpenAPI contract drift) — Fixed

**File:** `lib/api-spec/openapi.yaml`

Two mismatches between OpenAPI and runtime behaviour were corrected:

1. `DonorPortfolioEntry.budgetSpent` changed from `{type: number}` (required) to
   `{type: ["number", "null"]}` (optional). The runtime returns `null` when no activity
   records exist for the donor's projects.

2. `DonorPortfolioBudgetByCurrencyItem.budgetSpent` changed from `{type: number}`
   (required) to `{type: ["number", "null"]}` (optional). Same rationale.

**File:** `lib/api-client-react/src/generated/api.schemas.ts`

The generated TypeScript types were updated in lockstep:

- `DonorPortfolioBudgetByCurrencyItem.budgetSpent` → `budgetSpent?: number | null`
- `DonorPortfolioEntry.budgetSpent` → `budgetSpent?: number | null`

The frontend `budget.tsx` already guards all uses of `budgetSpent` with null checks
(`d.budgetSpent != null`, `b.budgetSpent == null ? "—" : ...`) so no frontend code
changes were required.

---

## 13. Access Control

No changes to access control. The `requireBudgetDonorsRole` gate and all TC/SPO
fail-closed scope checks at `dashboard.ts:1069–1090` are unchanged.

The donor existence check on CREATE and PATCH (DEFECT-1/2) is explicitly actor-independent:
Full Operational Access granted to `program_manager` and `super_admin` does not bypass the
`invalid_donor_id` validation.

---

## 14. Tests

**New sentinel suite:** `artifacts/api-server/src/routes/__tests__/bud-donor-closure.test.ts`

| Sentinel | Coverage |
|---|---|
| BUD-DONOR-01 | Canonical grouping by donor_id |
| BUD-DONOR-02 | Casing mismatch does not split group |
| BUD-DONOR-03 | name_mismatch status surfaced |
| BUD-DONOR-04 | Unlinked group retained |
| BUD-DONOR-05 | Missing group surfaced |
| BUD-DONOR-06 | projectCount equals unique IDs |
| BUD-DONOR-07 | Multi-state dedup in count |
| BUD-DONOR-08 | Per-currency separation |
| BUD-DONOR-09 | currencyMixed=true → currency null |
| BUD-DONOR-10 | Closed projects retained |
| BUD-DONOR-11 | deleted_at IS NULL filter present |
| BUD-DONOR-12 | POST 422 for nonexistent donorId |
| BUD-DONOR-13 | PM cannot bypass (same 422) |
| BUD-DONOR-14 | Super Admin cannot bypass (same 422) |
| BUD-DONOR-15 | Frontend uses canonical donorName |
| BUD-DONOR-16 | Budget inside dedup guard (no double-count) |
| BUD-DONOR-17 | Generated type allows null budgetSpent |
| BUD-DONOR-18 | Audit report declares CLOSED |

---

## 15. Residual Register

### Human-Decision Items

**None.** No duplicate canonical donor names were found (AUDIT-2 returned zero rows).
The dataset reconciliation (AUDIT-3) found no bogus references requiring human review.

### Software Residual

**Zero.** All four defects (DEFECT-1 through DEFECT-4) have been remediated and verified
by the sentinel suite.

---

## 16. BUD-008 Verdict

All software-integrity defects identified during reconnaissance are closed. The donor data
model is now enforced at both the application layer (CREATE/PATCH validation) and the
database layer (FK constraint). The grouping logic is double-count–free. The API contract
matches the runtime. The sentinel suite provides permanent regression coverage.

**BUD-008: CLOSED**
