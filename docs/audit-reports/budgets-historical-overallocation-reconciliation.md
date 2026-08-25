# Budgets Module — Historical Over-Allocation Reconciliation (Task #608, follow-up #598)

Date: 2026-08-19
Scope: reconcile the historical projects flagged by migration 029
(`029_allocation_cap_residual_warning`) where
`SUM(project_state_allocations.budget_allocation) > projects.budget_total`.
No financial data was altered by this task.

## 1. Discovery query (extended detection)

```sql
SELECT p.id, p.code, p.title, p.status, p.currency,
       p.budget_total::float AS budget_total,
       SUM(COALESCE(psa.budget_allocation::float,0)) AS alloc_total,
       SUM(COALESCE(psa.budget_allocation::float,0)) - COALESCE(p.budget_total::float,0) AS over_amount,
       COUNT(psa.id) AS alloc_rows,
       STRING_AGG(s.name || '=' || psa.budget_allocation::text, ', ' ORDER BY s.name) AS state_breakdown
FROM projects p
JOIN project_state_allocations psa ON psa.project_id = p.id
LEFT JOIN states s ON s.id = psa.state_id
WHERE p.deleted_at IS NULL
GROUP BY p.id, p.code, p.title, p.status, p.currency, p.budget_total
HAVING SUM(COALESCE(psa.budget_allocation::float,0)) > COALESCE(p.budget_total::float,0)
ORDER BY p.id;
```

**Current violating count: 8** non-deleted projects (run 2026-08-19).

## 2. Full result set and classification

| ID | Code | Title | Status | Cur | budget_total | alloc_total | over_amount | Rows | States | Evidence | Classification | Remediation applied |
|---:|---|---|---|---|---:|---:|---:|---:|---|---|---|---|
| 3 | CAFA-2024-003 | Child Protection Spaces — Khartoum Returnees | approved | USD | 780,000 | 811,200 | 31,200 | 1 | Khartoum State=811200.00 | Bulk backfill; alloc = budget ×1.04 exactly; no audit history | D | None — human decision |
| 4 | CAFA-2024-004 | Multi-Purpose Cash Assistance — Gedaref | approved | USD | 3,200,000 | 3,584,000 | 384,000 | 1 | Algadarif=3584000.00 | Bulk backfill; ×1.12 exactly; no audit history | D | None — human decision |
| 11 | CAFA-2025-011 | Emergency Shelter — Sennar | draft | USD | 540,000 | 561,600 | 21,600 | 1 | Sennar=561600.00 | Bulk backfill; ×1.04 exactly; only `create` in audit | D | None — human decision |
| 12 | CAFA-2025-012 | Community Health Workers — Central Darfur | draft | USD | 890,000 | 996,800 | 106,800 | 1 | North Darfur=996800.00 | Bulk backfill; ×1.12 exactly; only `create` in audit | D | None — human decision |
| 16 | CAFA-MPLOQ09S | E2E HQ Test | technically_approved | USD | 50,000 | 52,000 | 2,000 | 1 | Khartoum State=52000.00 | Bulk backfill; ×1.04 exactly; no allocation audit | D | None — human decision |
| 17 | CAFA-MPLP9SW5 | E2E HQ Af2eTw | closed | USD | 100,000 | 112,000 | 12,000 | 1 | Khartoum State=112000.00 | Bulk backfill; ×1.12 exactly; no allocation audit | D | None — human decision |
| 21 | CAFA-KRT-002 | Code Test 2 | submitted | USD | 1,000 | 1,040 | 40 | 1 | Khartoum State=1040.00 | Bulk backfill; ×1.04 exactly; no allocation audit | D | None — human decision |
| 25 | CAFA-JZR-002 | سيدسيسبيز | closed | USD | 557,869 | 580,184 | 22,315 | 1 | Al Jazeera=580184.00 | Bulk backfill; ≈×1.0400004 (rounded); no allocation audit | D | None — human decision |

Categories: (A) deterministic duplicate, (B) zero-budget legacy, (C) budget
reduced with prior value recoverable from audit log, (D) imported/backfilled
before cap enforcement with no recoverable canonical value, (E) currency /
semantic artefact, (F) other evidenced cause, (G) indeterminate.

## 3. Evidence detail

1. **Duplicate rows (step 2):** `SELECT project_id, state_id, COUNT(*) ...
   HAVING COUNT(*) > 1` returns **0 rows**. The migration 027 UNIQUE
   constraint `project_state_allocations_project_state_unique` is present in
   `pg_constraint`. → No category A cases exist.
2. **Single bulk write:** all 8 allocation rows share the identical
   `created_at = updated_at = 2026-06-04 21:52:43.315296+00`, months to a year
   after their projects were created — a one-shot backfill/seed script, not
   user edits through the API.
3. **Uniform multipliers:** `budget_allocation / budget_total` is exactly
   1.04 (projects 3, 11, 16, 21), exactly 1.12 (projects 4, 12, 17), and
   ≈1.0400004 for project 25 (rounded to whole units). The backfill evidently
   applied a percentage uplift (4% / 12%) to `budget_total`.
4. **Audit log (step 3):** `audit_log` contains **zero**
   `state_allocations_replace`, `budget_updated`, or `budget_reduced` entries
   for any project system-wide. Projects 3 and 4 have no audit rows at all;
   the others show only lifecycle actions (`create`, `submit`, approvals).
   → No prior budget or allocation value is recoverable (rules out C).
5. **Zero-budget cases (B):** none — every violator has a positive budget.

**Why category D and not automatic remediation:** the system evidence proves
*how* the values got there (uplifted backfill) but not *which* figure is
canonical — the intended allocation could be the budget figure (strip the
uplift) or the budget could be understated (the uplift could represent real
overhead that belongs in `budget_total`). Choosing either is a financial
decision, which the task explicitly forbids automating (no LEAST, no scaling,
no budget increase). Therefore **no remediation migration was written**, and
that absence is pinned by sentinel BUD-HIST-08.

## 4. Human-Decision Remediation Register

Every entry below blocks zero-residual closure until answered by finance/PM.

| Project ID | Code | Over-allocation (USD) | Classification | Decision required |
|---:|---|---:|---|---|
| 3 | CAFA-2024-003 | 31,200 | D | Confirm the correct `budget_total` (780,000 or 811,200) **or** the correct Khartoum State allocation. The 4% uplift must be attributed either to budget or removed from the allocation. |
| 4 | CAFA-2024-004 | 384,000 | D | Confirm correct `budget_total` (3,200,000 or 3,584,000) **or** correct Algadarif allocation (12% uplift). |
| 11 | CAFA-2025-011 | 21,600 | D | Confirm correct `budget_total` (540,000 or 561,600) **or** correct Sennar allocation (4% uplift). |
| 12 | CAFA-2025-012 | 106,800 | D | Confirm correct `budget_total` (890,000 or 996,800) **or** correct North Darfur allocation (12% uplift). |
| 16 | CAFA-MPLOQ09S | 2,000 | D | Test-origin project. Confirm whether to align allocation to 50,000, raise budget to 52,000, or soft-delete the test record. |
| 17 | CAFA-MPLP9SW5 | 12,000 | D | Test-origin project (closed). Same decision as #16 for the 100,000 / 112,000 pair. |
| 21 | CAFA-KRT-002 | 40 | D | Test-origin project. Same decision for the 1,000 / 1,040 pair. |
| 25 | CAFA-JZR-002 | 22,315 | D | Confirm correct `budget_total` (557,869 or 580,184) **or** correct Al Jazeera allocation (≈4% uplift, rounded). |

## 5. Post-reconciliation invariant (step 7)

Re-running the detection query after reconciliation returns the same 8
projects — expected, because no entry qualified for deterministic
remediation. **Residual: 8 projects blocked by outstanding human decisions**
(IDs 3, 4, 11, 12, 16, 17, 21, 25). Zero residual is NOT claimed.

## 6. Write-path enforcement re-confirmation (step 8)

`budget-allocation-cap-closure.test.ts` (BUD-CAP-01..15) re-run unchanged:
**all pass** — CREATE/PATCH/replace reject over-allocation, zero-budget blocks
positive allocation, PM and Super Admin cannot bypass, FOR UPDATE row locks
guard both write paths. New violations cannot be created; the 8 register
entries are the complete and final historical set.

## 7. Durable sentinels (step 9)

`budget-historical-overallocation.test.ts` adds BUD-HIST-01..10:
detection semantics (over/exact/under cap, zero-budget, closed included,
soft-deleted excluded), absence of any automatic scaling logic, the pinned
absence of a remediation migration (deliberate, category-D-only outcome),
migration 029 remaining warning-only, and register-count/detection-count
equality over the recorded dataset.

## 8. Verdict

**Verdict: NOT zero-residual — 8 projects blocked by outstanding human
decisions.** Write-path enforcement (#595) is confirmed intact, so the
violating set cannot grow. Once finance answers the register questions, the
corrections should be applied through the normal audited API write paths
(project PATCH / state-allocation replace), which will enforce the cap and
write `state_allocations_replace` / audit entries — no ad-hoc SQL required.
This document does **not** declare Budgets module closure.
