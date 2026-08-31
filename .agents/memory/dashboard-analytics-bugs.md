---
name: Dashboard analytics data integrity
description: Recurring pitfalls and fixed bugs in artifacts/api-server/src/routes/dashboard.ts
---

## Rules

**Never use `Math.random()` in API responses.**
Monthly/time-series chart data was computed with a random multiplier (`0.85 + Math.random() * 0.2`) causing the chart to re-render with different values on every page load.
Fix: use deterministic linear ramp `ben.reached * (6-i)/6` or a real DB time-series query.

**`budgetUtilizationPct` must join `activities.budget_spent`, not multiply `budget_total * 0.45`.**
The formula `SUM(p.budget_total * 0.45) / SUM(p.budget_total) * 100` always equals 45 regardless of actual spend.
Affected: `GET /dashboard/state-performance`, `GET /dashboard/sector-performance`, and the sector drill-down per-project subquery.
Fix: `LEFT JOIN (SELECT project_id, SUM(budget_spent) AS spent FROM activities GROUP BY project_id) a_agg ON a_agg.project_id = p.id` then use `SUM(a_agg.spent)`.

**`sector-performance` beneficiary counts must use `projects.beneficiaries_*` columns, not the legacy `beneficiaries` table.**
The legacy subquery `SELECT COUNT(*) FROM beneficiaries b WHERE b.project_id IN (...)` returned identical counts for every sector (35) because the 280 legacy rows all link to just 8 projects whose sector cross-match made every group match all rows.
Fix: `SUM(p.beneficiaries_male + p.beneficiaries_female + p.beneficiaries_boys + p.beneficiaries_girls)`.

**TC sector restriction must be applied to the `reports` sub-count inside `pendingApprovalsCount`.**
The `/dashboard/summary` query 4 (pending approvals) applied stateId filter to the `rep` subquery but not the sector restriction for TC users.
TC users (no stateId, has sectors) were seeing all pending reports globally instead of only those in their assigned sectors.
Fix: add `repScopeFilter` that uses `r.project_id IN (SELECT id FROM projects pf WHERE pf.sector = ANY($N::text[]))` for TC, mirroring the pattern used in `/dashboard/pending-approvals`.

**Joined Dashboard SQL must qualify collision-prone columns and represent optional predicates as arrays.**
**Why:** PostgreSQL rejects an unqualified column when joined relations expose the same name, and joining an empty SQL fragment can produce a malformed `AND`.
**How to apply:** Name the owning alias for status/identity predicates; build conditions and parameters together, omit absent conditions, then join the populated array once.

## Data note
Project sector field should always use canonical-cased values from `VALID_SECTORS` (e.g. `"Health"` not `"health"`). One seed project (CAFA-MPLOLNFX "Smoke Test Project") had `sector='health'` (lowercase) which surfaced as a phantom extra sector in sector-performance. Fixed via `UPDATE projects SET sector='Health' WHERE sector='health'`.
