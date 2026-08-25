# Projects HQ Operational Review — Task #258

Generated: 2026-08-15

## Context

Migration 016 (`016_has_hq_operations`) originally contained an `UPDATE` statement
that incorrectly set `has_hq_operations = true` for all projects with
`management_level = 'hq_managed'`. This contradicts the approved Operational
Locations business rule: `management_level` and `has_hq_operations` are independent
concepts.

The backfill has been removed from Migration 016. Migration 017
(`017_correct_hq_backfill`) creates a persistent `hq_backfill_audit` table that
records any projects with `management_level = 'hq_managed' AND has_hq_operations = true`
at migration time — including their linked state names — for administrator review.

Provenance cannot be determined automatically because the `projects` table has no
`updated_at` column. Existing `has_hq_operations = true` values are therefore
**preserved unchanged** — they may represent either a legitimate explicit opt-in
or an artefact of the invalid backfill. Administrators must verify each project
listed here and use the project edit form to set `has_hq_operations = false` on
any project that should not have HQ Operational Location access.

## Dev Environment Audit (2026-08-15)

The following query was executed against the development database:

```sql
SELECT
  p.id            AS project_id,
  p.title         AS name,
  p.code,
  p.management_level,
  p.has_hq_operations,
  COALESCE(
    string_agg(DISTINCT st.name, ', ' ORDER BY st.name),
    '(none)'
  ) AS linked_states
FROM projects p
LEFT JOIN project_states ps ON ps.project_id = p.id
LEFT JOIN states st ON st.id = ps.state_id
WHERE p.management_level = 'hq_managed'
  AND p.has_hq_operations = true
GROUP BY p.id, p.title, p.code, p.management_level, p.has_hq_operations
ORDER BY p.id;
```

**Result: No projects found.** The development database contains no projects with
`management_level = 'hq_managed' AND has_hq_operations = true`.

This is expected for a fresh or recently-reset development environment where
Migration 016 either was not yet applied or ran after the backfill was removed.

## Projects Requiring Review

| Project ID | Name | Code | Management Level | HQ Operations | Linked States |
|------------|------|------|-----------------|---------------|---------------|
| *(none found in this environment)* | | | | | |

## Production Environment Action Required

For production deployments where Migration 016 ran **before** this fix was applied,
Migration 017 will have inserted affected rows into `hq_backfill_audit`. Use the
following query to retrieve the full review list including linked states:

```sql
SELECT
  a.project_id,
  a.project_title  AS name,
  a.project_code   AS code,
  a.management_level,
  a.has_hq_operations,
  a.linked_states,
  a.recorded_at
FROM hq_backfill_audit a
ORDER BY a.project_id;
```

For each listed project:

1. Determine whether HQ Operational Location was intentionally configured by an
   authorised user (Programme Manager or Executive Director) or was silently set
   by the invalid backfill.

2. For any project where HQ access was **not** intentional, navigate to the
   project edit form and set `has_hq_operations = false`.

3. Projects confirmed as legitimately HQ-operational require no action —
   their `has_hq_operations = true` value is correct.

## Final Data Rule

> A project may create HQ Project Monthly Reports if and only if
> `has_hq_operations = true`. The `management_level` field is orthogonal
> and does not affect HQ eligibility.
