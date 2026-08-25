---
name: Activity Reports Security Architecture
description: Security rules and invariants for the Activity Reports module — TC scope, identity immutability, uniqueness keys, and validation chain.
---

# Activity Reports — Security Architecture

## Rule 1: TC scope always uses Project Primary Sector (`p.sector`)
- `getReportSector()` must return `projectSector` for BOTH `project` and `activity` types.
- `r.sector` is a display/historical snapshot; it must **never** be used for access control.
- The `applyReportScope` mixed-query branch (no `reportType`, used by `/reports/stats`) must apply the project-primary-sector predicate to BOTH `project` AND `activity` rows:
  - Correct: `r.report_type IN ('project', 'activity') AND p.sector = ANY(...)`
  - Wrong: `r.report_type != 'project'` (admits activity rows with stale r.sector)

**Why:** A stale `r.sector` snapshot can diverge from `p.sector` after a project sector change. Allowing it in the TC predicate creates a bypass where a TC outside the project's sector can access the report.

## Rule 2: Activity CREATE validation chain (order matters)
Must run in this order:
1. `activityId` belongs to `projectId` (activity→project)
2. Project exists; load `p.sector` as authoritative primary sector
3. TC sector check via `p.sector` (fail-closed if null)
4. `stateId` is required (405 if missing, even for non-SPO users)
5. `project_states` link check: selected state must be linked to the project
6. `activities.state_id` match: if the activity's authoritative state_id is not null, the report stateId must match; null activity state_id = project-wide, no restriction

## Rule 3: Activity Report identity fields are immutable after creation
`activityId`, `projectId`, `stateId` cannot be updated in PATCH, even while in draft.
- Prevents period-duplicate bypass (change identity → same unique index slot but different key)
- Protects `workflow_path` / author traceability
- `super_admin` may bypass for administrative corrections

## Rule 4: Uniqueness key includes `state_id` (after Migration 010)
DB indexes: `(report_type, activity_id, state_id, kind, reporting_year, reporting_month/quarter)`  
With `AND state_id IS NOT NULL` in the partial condition (historical null-state records unconstrained).  
The same activity may have reports in different states without collision.

**Why:** Spec requires Activity + State + Period uniqueness. Without state_id, a project-wide activity could not have separate monthly reports per state, which blocks legitimate multi-state reporting.

## Rule 5: `effectiveSector` stored on Activity Reports = `p.sector`
For CREATE, the `effectiveSector` written to the DB for activity type should use `projectPrimarySector` (same as project type), not `body.sector`. This ensures display ≡ security — the sector snapshot always matches the access-control authority.

## Rule 6: duplicate-check endpoint — activity type
`/reports/duplicate-check?activityId=N&stateId=M&frequency=X&period=Y&reportType=activity`  
Uses `r.activity_id = $activityId AND ($stateId::integer IS NULL OR r.state_id = $stateId)` — not the old project-based key. On-Demand (`kind='on_demand'`) is always exempt.
