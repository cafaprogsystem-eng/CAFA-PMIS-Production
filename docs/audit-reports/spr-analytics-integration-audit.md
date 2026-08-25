# SPR-012 Analytics Integration Audit

## Canonical SPR Location

`report_type = program_state`, `state_id` = canonical State, `project_id = NULL`.
HQ Sector Reports (`hq_sector`) share `project_id = NULL` with `r.sector` set, and
benefit from the same fixes.

## Audit Matrix

| Metric / Endpoint | Current Query Pattern | Should Include SPR? | Previous Behaviour | Defect? | Fix / No Change | Reason |
|---|---|---|---|---|---|---|
| /dashboard/summary — pending approvals (reports) | TC scope was `r.project_id IN (SELECT … FROM projects WHERE sector = ANY(...))` | Yes | Dropped for TC | Yes | Predicate changed to `COALESCE(NULLIF(r.sector,''), (SELECT pf.sector FROM projects pf WHERE pf.id = r.project_id)) = ANY(...)` | Project subquery excluded project_id=NULL rows |
| /dashboard/summary — submitted/pending report counts | TC scope was `JOIN projects p … WHERE p.sector = ANY(...)` | Yes | Dropped for TC | Yes | `LEFT JOIN projects p` + `COALESCE(NULLIF(r.sector,''), p.sector) = ANY(...)` | INNER JOIN excluded project_id=NULL rows |
| /dashboard/reports-summary — main KPI (total/draft/awaiting/approved/>14d) | TC scope `joinProject` was `JOIN projects p2` | Yes | Dropped for TC | Yes | `LEFT JOIN projects p2`; predicate already `COALESCE(NULLIF(r.sector,''), p2.sector)` | INNER JOIN excluded project_id=NULL rows |
| /dashboard/reports-summary — by-type | Same `joinProject` as main KPI | Yes | Dropped for TC | Yes | Same LEFT JOIN fix (shared fragment) | Same defect |
| /dashboard/reports-summary — by-sector | Unconditional `JOIN projects p` | Yes | Always dropped | Yes | `LEFT JOIN projects p`; grouping already `COALESCE(NULLIF(r.sector,''), p.sector, 'Unspecified')` | Unconditional INNER JOIN |
| /dashboard/pending-approvals — actionable reports list | Was `JOIN projects` + `JOIN states` + `JOIN users` | Yes | SPR absent from SPC/PM/super_admin approval queue; HQSR also dropped (state_id NULL) | Yes | All three joins changed to LEFT JOIN; operational-population filter added | INNER JOINs excluded project_id=NULL (SPR/HQSR) and state_id=NULL (HQSR) rows |
| /dashboard/recent-activity — TC report-activity scope | Was `reports r2 JOIN projects p2 … WHERE p2.sector = ANY(...)` subquery | Yes | SPR/HQSR audit events absent from TC feed | Yes | `LEFT JOIN` + `COALESCE(NULLIF(r2.sector,''), p2.sector)` | INNER JOIN excluded project_id=NULL rows |
| /dashboard/reports-summary — by-state | `states LEFT JOIN reports ON r.state_id = s.id` | Yes | Included SPR, but had **no TC sector scope** (cross-sector leak to TCs) | Yes (security) | TC sector predicate added in the LEFT JOIN ON clause: `COALESCE(NULLIF(r.sector,''), (SELECT p.sector FROM projects p WHERE p.id = r.project_id)) = ANY(...)`; zero-sector TC fails closed (`AND FALSE`) | SPR retained via `r.sector`; state rows survive with count 0 |
| /dashboard/late-reports | `LEFT JOIN projects` + `COALESCE(r.sector, p.sector)` | Yes | Correct | No | No change | COALESCE already used |
| /reports/stats | `GROUP BY r.report_type` | Yes | Correct | No | No change | No project join |
| /dashboard/attention-projects | INNER JOIN by project_id | No | Excluded | No | No change | Project-specific metric |
| /dashboard/pmr-reporting-completeness | `report_type='project'` | No | Excluded | No | No change | PMR only by design |
| /dashboard/beneficiaries | Project master columns | No | Excluded | No | No change | Double-count risk with PMR/Activity |
| /dashboard/sector-budget | Budget analytics | No | Excluded | No | No change | Not a report-count metric |
| /dashboard/donor-portfolio | Donor/project oriented | No | Excluded | No | No change | Project-specific |
| /dashboard/project-budget-performance | Project-only | No | Excluded | No | No change | Project-only by design |

## Access Scope Audit

- **State roles (SPO/SOM):** `r.state_id = <stateId>` predicates unchanged on every
  fixed query; null-state users remain fail-closed via existing scope resolution.
- **TC:** sector scope now `COALESCE(NULLIF(r.sector,''), p.sector)` — SPR counted
  when `r.sector` matches the TC's assigned sectors; zero-sector TC still gets
  `AND FALSE` (fail-closed).
- **PM / super_admin:** `hasFullOperationalAccess` path unchanged — no sector or
  project filter applied; full scope.
- No scope predicate was removed to fix the undercount.
- Operational-population filters (`migration_is_duplicate=FALSE`,
  `migration_status_unverified=FALSE`) preserved on `/dashboard/reports-summary`
  and **newly applied** to `/dashboard/summary` report counts (pending-approvals
  subquery and all submitted/pending branches) and to the
  `/dashboard/pending-approvals` queue via `operationalPopulationSQL()`, so
  migration-duplicate/unverified rows never distort operational counts or appear
  as actionable items.

## Label Accuracy

Frontend checked (`dashboard.tsx`, `reports.tsx`): generic report counts are labelled
generically ("Total", by-type breakdown uses canonical type labels including
"State Programme Report"); project-only metrics are already explicitly labelled
("Draft Project Reports"). No label change required.

## Completeness Model

No expected-SPR-submission or scheduled completeness model exists. SPR analytics
report actual counts only. None was invented (sentinel test enforces this).

## Beneficiary Aggregation

SPR beneficiary fields intentionally excluded from cross-report aggregation —
double-counting risk with PMR/Activity Report data. Dashboard beneficiary metrics
continue to read project master columns only.

## Sentinel Tests

`artifacts/api-server/src/test/spr-analytics-integration.test.ts` encodes these
invariants as static source assertions (same approach as the PMR-015 sentinels).

## Date

2026-08-17
