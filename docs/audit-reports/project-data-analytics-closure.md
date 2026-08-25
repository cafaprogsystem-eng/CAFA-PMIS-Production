# Projects Module — Data, Analytics & Integrity Residual Closure

**Date:** 2026-08-17
**Scope:** Final disposition of the six residual items from the Projects Module data/integrity/analytics audit. No item remains as "accepted residual".

| Item | Title | Disposition |
|------|-------|-------------|
| PRJ-008 | Project code generation race (MAX+1 without lock) | **CLOSED** (fixed) |
| PRJ-018 | No DB UNIQUE constraint on `projects.code` | **CLOSED** (fixed) |
| PRJ-019 | `project_localities` vs `project_free_localities` | **NOT A DEFECT** (documented + tested) |
| PRJ-029 | Duplicate `021_` migration prefix | **NOT A DEFECT** (documented + tested) |
| PRJ-034 | Report-KPI dual source | **CLOSED** (contract documented + tested) |
| — | Donor portfolio deduplication verification | **CLOSED** (verified + tested) |

---

## PRJ-008 / PRJ-018 — Project code concurrency & uniqueness (CLOSED)

**Problem.** `POST /projects` generated codes as `CAFA-PROJ-{YEAR}-{NNN}` via `SELECT MAX(...)+1` inside a transaction, but with no serialisation: two concurrent creates in the same year could compute the same sequence, and no DB constraint would catch it.

**Fix — application layer.** Immediately after `BEGIN` and before the MAX+1 query, the create handler now takes a transaction-scoped advisory lock keyed to the year namespace:

```sql
SELECT pg_advisory_xact_lock(hashtext('project_code_' || <year>))
```

This serialises code allocation per year; the lock is released automatically on COMMIT/ROLLBACK. Concurrent creates in different years do not contend.

**Fix — DB layer (defence-in-depth).** Migration `024_project_code_unique` adds:

```sql
ALTER TABLE projects ADD CONSTRAINT projects_code_unique UNIQUE (code);
```

**Error mapping.** A `23505` unique violation on `projects_code_unique` is caught at the create route's catch site and mapped to a clean `409 { "error": "project_code_conflict" }` — it never escapes as a raw SQL error. Unrelated 23505 violations are not masked.

**Existing data audit.** `SELECT code, COUNT(*) FROM projects GROUP BY code HAVING COUNT(*) > 1` run against the development database on 2026-08-17 returned **0 rows** (32 projects total) — zero duplicates. The migration still carries a defensive remediation block (lowest id keeps the original code; later duplicates get a `-DUPn` suffix) for databases restored from older backups, executed before the constraint is added.

**Tests.** PRJ-CODE-01 … PRJ-CODE-06 in `src/test/prj-data-integrity.test.ts` — lock ordering (after BEGIN, before MAX+1), year-namespaced lock key, correct sequence usage, 409 mapping, non-masking of unrelated violations, and migration content.

---

## PRJ-019 — project_localities vs project_free_localities (NOT A DEFECT)

The two tables intentionally serve different purposes:

- **`project_free_localities(project_id, name, display_order)`** — user-entered free-text locality names captured in the Project registration form; display/ordering only.
- **`project_localities(project_id, locality_id)`** — structured FK links to the canonical `localities` table, used for dashboard analytics.

This is not a naming defect or duplication. Migration 024 adds `COMMENT ON TABLE` documentation to both tables recording their distinct roles.

**Deletion coverage.** Permanent project deletion deletes from **both** tables (children before the project row, inside one transaction), so no orphans are possible; soft deletion preserves both. Tests PRJ-LOC-01 … PRJ-LOC-05 prove: schema comments exist; permanent deletion removes both tables' rows before the project row; commit follows all child deletions; soft deletion issues no locality deletes; registration writes free text only to `project_free_localities`.

---

## PRJ-029 — Duplicate `021_` migration prefix (NOT A DEFECT)

Two migrations share the `021_` numeric prefix: `021_hq_sector_location_integrity` and `021_report_attachments_drive_file_id.sql`. The migration runner records the **full migration name** in `schema_migrations.filename` — the numeric prefix is a human-readability aid, not the identity key. Both migrations execute independently exactly once, with no conflict. Renaming deployed migrations would risk re-execution and is prohibited.

A comment above the second `021_` entry in `run-migrations.ts` now documents the forward-looking convention: future migrations should use a unique numeric prefix for readability, but full-name uniqueness is what matters. (Note: prefixes 022–026 already contain other non-sequential entries; identity by full name holds throughout.)

**Tests.** PRJ-MIG-01 … PRJ-MIG-04 — all full names unique; exactly two `021_` entries with distinct full names; runner identity is the full name; convention note present.

---

## PRJ-034 — Report-KPI canonical source (CLOSED)

`GET /projects/:projectId/report-kpis` draws each KPI dimension from exactly one canonical source (now documented in a comment block on the handler):

- **Beneficiary/budget aggregates** (`beneficiariesReached`, `totalPlannedBudget`, `totalActualExpenditure`, `burnRatePct`) — relational `reports` columns (`beneficiaries_*`, `planned_budget`, `actual_expenditure`).
- **Activity KPIs** (`totalActivities`, `completedActivities`, `activityCompletionPct`, `avgActivityProgressPct`, budget-status counts) — JSONB `reports.activities` snapshots via `jsonb_array_elements`. There is **no fallback** to the relational `activities` table.

**Double-count protection.** The relational `activities` table holds planned Results-Framework activities, not reported progress; the endpoint deliberately never JOINs it. Test PRJ-KPI-05 asserts that no query executed by the endpoint contains `FROM activities` or `JOIN activities`, and that aggregation is `SUM`/`COUNT`-additive over all report periods (not a last-record override).

**Tests.** PRJ-KPI-01 … PRJ-KPI-05 cover: JSONB-only data; no data (deterministic zeros/null, no error); both sources present consistently; beneficiaries without activities; multi-period additivity + no relational-activities access.

---

## Donor portfolio deduplication (CLOSED — verified)

`GET /dashboard/donor-portfolio` grouping verified correct:

- **Canonical grouping:** projects with `donor_id` group under `canonical:${donor_id}`; the display name is the canonical `donors.name`, never the free-text `p.donor`.
- **Unlinked grouping:** free-text-only donors group under `free:${lowercased-trimmed-name}`.
- **Missing:** projects with no donor information surface individually (`missing:${project.id}`), never merged into a single bucket.
- **Currency semantics:** budget and spend are accumulated per currency (`currencyBudget` / `spentByCurrency` maps). Mixed-currency groups report `currencyMixed: true`, `currency: null`, and a per-currency `budgetByCurrency` breakdown — no cross-currency summing is presented as a single-currency figure. Spend is `null` (not 0) when no activity data exists.
- **Data-quality states:** `name_mismatch`, `unlinked`, `missing`, `missing_currency` remain visible in `dataStatus`/`dataIssues`.

No code changes were required; the architecture was already correct. **Tests.** PRJ-DONOR-KPI-01 … PRJ-DONOR-KPI-06.

---

## Files changed

- `artifacts/api-server/src/routes/projects.ts` — advisory lock in create handler; 23505→409 mapping; PRJ-034 canonical-source comment block on report-kpis.
- `artifacts/api-server/src/lib/run-migrations.ts` — migration `024_project_code_unique` (dedup remediation, UNIQUE constraint, locality table comments); PRJ-029 convention note above the second `021_` entry.
- `artifacts/api-server/src/test/prj-data-integrity.test.ts` — new; 26 tests.
- `docs/audit-reports/project-data-analytics-closure.md` — this report.

## Migrations

- `024_project_code_unique` — applied to development on 2026-08-17 (0 duplicate codes found; constraint added cleanly).

## Test totals

- New suite `prj-data-integrity.test.ts`: **26/26 pass** (6 code + 4 migration + 5 locality + 5 KPI + 6 donor).
- Full api-server suite: 1589/1590 pass; the single failure (`plans-type-date-resp` PLAN-CONTRACT-02, a generated-dist structural check) is pre-existing and unrelated — it fails identically with this task's changes stashed.

## TypeScript

`tsc --noEmit`: no errors in any file touched by this task. Pre-existing errors remain in `reports.ts`, `risks.ts`, and `plans-closure-sentinel.test.ts` (tracked separately by the existing "pre-existing type errors" task).

## Closure confirmation

All six residual items are **CLOSED** or formally reclassified **NOT A DEFECT** with documentation and regression tests. No item remains as an accepted residual. The Projects Module data/integrity/analytics audit is closed.
