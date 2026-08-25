---
name: Activity Reports Architecture
description: Architecture decisions for the /reports/activity module — TC scope, author gating, facet endpoint, CSV columns, test suite.
---

## Route
`/reports/activity` registered in `App.tsx` → `<Reports lockedType="activity" />`.
Same `ReportsPage` component used by all types; `isActivity = lockedType === "activity"`.

## Author Gating (canCreate)
Both `project` AND `activity` types are now gated to the same role set:
`state_program_officer | technical_coordinator | super_admin`.
`canCreate` condition: `(lockedType !== "project" && lockedType !== "activity") || VALID_PROJECT_REPORT_AUTHOR_ROLES.has(userRole)`.

## TC Sector Scope (CRITICAL)
In `applyReportScope` (`artifacts/api-server/src/routes/reports.ts`), the `reportType === "activity"` branch uses **`p.sector = ANY($idx::text[])`** — Project Primary Sector only. This is distinct from `hq_sector`/`program_state` which use the OR predicate `(r.sector OR p.sector)`. Fail-closed: rows where p.sector IS NULL are excluded.

**Why:** Spec §6 — no independent Activity sector model; TC security must derive exclusively from the linked project's primary sector; display sector must not widen access.

## reportSelect JOIN
`activities act` added to `reportSelect` base query. Columns: `act.title AS "activityTitle"`, `act.code AS "activityCode"`. These flow through to list, export, and detail views.

## Activity Facet Endpoint
`GET /reports/activity-facet` — returns `{ activities: [{id, title, code}] }`.
Scoped by RBAC (applyReportScope with reportType="activity") + applyOperationalPopulation + `act.id IS NOT NULL`.
Powers the Activity filter dropdown (only rendered when `isActivity`).

## activityFilter State
Frontend filter state `activityFilter` (string "all" or stringified ID) is wired into:
- `query.activityId` (main list params)
- `authorFacetParams` (authors facet)
- `exportParams.activityId` (CSV export — cast via `as Record<string, unknown>`)
- `hasActiveFilters` check
- `clearFilters` handler
- `useEffect` page-reset dep array

## Table Columns (activity type)
When `isActivity`: Title · Status · Activity · Project · State · Sector · Frequency · Period · Prepared By · Actions (10 cols, colSpan=10 for empty state).
Other types: 9 cols. Activity cell shows `CODE — Title` when code present.

## CSV Export
`exportReportsCsv` detects `rows[0].reportType === "activity"` and injects "Activity Code" + "Activity" columns after Frequency.

## Test Suite
`artifacts/cafa-pmis/src/test/activity-reports.test.ts` — 42 assertions across 32 test cases.
Covers: routing, author gating, filter state, display helpers, CSV export, duplicate-period logic, TC scope predicate, operational population predicate.
