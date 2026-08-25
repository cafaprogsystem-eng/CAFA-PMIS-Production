---
name: HQ Operational Location flag
description: has_hq_operations column on projects — how PMR HQ eligibility works and how to mock project rows in tests.
---

# HQ Operational Location flag

## Rule
PMR HQ eligibility is determined by `projects.has_hq_operations BOOLEAN NOT NULL DEFAULT false`, NOT by `management_level`.

**Why:** `management_level` answers who manages the project; `has_hq_operations` answers where it operates. A state-managed project can legitimately have HQ operations, and an hq_managed project may not.

## How to apply
- Any new PMR creation check for `locationType = "hq"` must read `has_hq_operations AS "hasHqOperations"` from the project row and gate on `!projectRow.hasHqOperations` (→ 400).
- State-role check (SPO/SOM → 403) fires BEFORE the `hasHqOperations` check in the code.
- Client side: `pmrHqAvailable` uses `selectedProjectObj?.hasHqOperations === true` (not `managementLevel`).
- Form: `hasHqOperations` is a boolean field in the project form Zod schema, default false, in the location tab.
- DB: Migration 016 adds the column. All existing projects default to false for NEW deployments, but a backfill in migration 016 sets `has_hq_operations = true` for any project where `management_level = 'hq_managed'` at migration time, preserving prior HQ reporting access. New projects must opt in explicitly.

## Test mocks
Any test that mocks the project SELECT query for a PMR route and expects a **success** response must include `hasHqOperations: true` in the mocked row. Without it, the field is falsy and the request is denied with `hq_not_permitted_for_project`.

Example:
```ts
mockQuery.mockResolvedValueOnce({
  rows: [{ id: 1, sector: "WASH", managementLevel: "hq_managed", hasHqOperations: true }],
});
```
