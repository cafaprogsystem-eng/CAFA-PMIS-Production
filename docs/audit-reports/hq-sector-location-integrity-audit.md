# HQ Sector Report — Location Integrity Audit (HQSR-004)

## Canonical Invariant

`report_type = 'hq_sector'` requires `state_id IS NULL AND project_id IS NULL`.

No actor — including Programme Manager (Full Operational Access, Task #373) or
Super Admin — may create or mutate an HQ Sector Report with a State or Project
linkage. There is no `overrideReason` bypass for location integrity.

## Audit Query

```sql
-- HQSR-004 Historical Audit
SELECT
  CASE
    WHEN state_id IS NOT NULL AND project_id IS NOT NULL THEN 'both_state_and_project'
    WHEN state_id IS NOT NULL AND project_id IS NULL     THEN 'state_only'
    WHEN state_id IS NULL     AND project_id IS NOT NULL THEN 'project_only'
  END AS malformed_category,
  status,
  workflow_path,
  COUNT(*) AS count
FROM reports
WHERE report_type = 'hq_sector'
  AND (state_id IS NOT NULL OR project_id IS NOT NULL)
GROUP BY 1, 2, 3
ORDER BY 1, 2;

SELECT COUNT(*) AS canonical_count
FROM reports
WHERE report_type = 'hq_sector'
  AND state_id IS NULL
  AND project_id IS NULL;
```

## Results (executed 2026-08-16, development database)

| malformed_category      | status | workflow_path | count |
|-------------------------|--------|---------------|-------|
| both_state_and_project  | draft  | NULL          | 1     |

Canonical (valid) HQ Sector Reports: **3** (`state_id` and `project_id` both NULL).

Detail of the single malformed row:

| id | title                     | sector | kind    | status | workflow_path | state_id | project_id | author role |
|----|---------------------------|--------|---------|--------|---------------|----------|------------|-------------|
| 10 | Health sector — June 2026 | Health | monthly | draft  | NULL          | 1        | 1          | super_admin |

## Classification

**Class A** (genuine HQSR with accidental linkage — auto-remediable):
- Row id 10 qualifies: canonical sector (`Health`), valid frequency (`monthly`),
  draft status, super_admin-authored via the generic create flow before server
  enforcement existed. The `state_id`/`project_id` values are residue from a
  generic create payload, not evidence of SPR/project classification (title and
  content are sector-level).

**Class B** (possibly misclassified — manual review required): **none found**.

## Remediation Decision

- Class A: Migration `021_hq_sector_location_integrity` sets
  `state_id = NULL, project_id = NULL` for `hq_sector` rows with residual
  linkage whose `sector` is one of the 7 canonical Main Sectors and whose
  `kind` is a valid frequency (`monthly/quarterly/annual/on_demand`). Rows
  with a null OR non-canonical/legacy sector are treated as Class B and left
  untouched (in that case the constraint addition fails loudly for manual
  review). This matched exactly the one audited row; 1 row updated.
- Class B: none — no rows flagged, no manual review outstanding.
- No rows were deleted; remediation is non-destructive (NULLing linkage only).

## Database Constraint

`chk_hq_sector_no_state_project` was **added** by Migration 021 (no Class B
blocker existed):

```sql
ALTER TABLE reports
  ADD CONSTRAINT chk_hq_sector_no_state_project
  CHECK (
    report_type <> 'hq_sector'
    OR (state_id IS NULL AND project_id IS NULL)
  );
```

Other report types (project, activity, program_state) keep their legitimate
`state_id`/`project_id` linkage via the `report_type <> 'hq_sector'` branch.

## Server / Client Enforcement (same change set)

- CREATE route rejects supplied `stateId`/`projectId` for `hq_sector` with
  `422 hq_sector_location_invalid` (after HQSR-001 sector/author gate), and the
  INSERT forces NULL for both columns regardless (defence in depth).
- HQSR-002 identity-immutability PATCH guard already blocks post-creation
  mutation (409) — unchanged.
- Frontend HQSR form never sends top-level `stateId`/`projectId`; the submitted
  detail view never renders State/Project metadata for `hq_sector`.

## Ambiguous Records

None.

## Date

Completed 2026-08-16.
