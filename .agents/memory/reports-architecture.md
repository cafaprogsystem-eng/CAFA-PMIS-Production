---
name: Reports Architecture
description: Canonical report type model, frequency model, workflow definitions, KPI model, migration 005, and frontend constants as implemented.
---

## 4 Canonical Report Types
`project | activity | program_state | hq_sector`

Stored in `reports.report_type`. NULL = unresolved legacy (migration_review_notes set).

## 4 Canonical Frequencies (the `kind` column)
`monthly | quarterly | annual | on_demand`

Completely separate from `report_type`. Never mix these two concepts.

## Workflow per type
- **Full chain** (project + activity): draft → submitted → state_reviewed → technically_approved → coordination_approved → approved
- **Short chain** (program_state + hq_sector): draft → submitted → coordination_approved → approved
- **New permissions**: `reports.approve.state` (SOM), `reports.approve.technical` (TC)

## KPI model (breaking change from old model)
Old: `pending / delayed / completionRatePct`
New: `total / draft / awaitingApproval / approved / awaitingApprovalOver14Days / unresolvedLegacyCount`

`unresolvedLegacyCount` = reports with NULL report_type; shown to HQ roles only (0 for state/TC scope).

`awaitingApprovalOver14Days` uses `submitted_at` from the CURRENT review cycle, not original creation.

## submitted_at reset
The `submit` action always resets `submitted_at = NOW()` so the >14-day clock restarts after a return-for-revision cycle.

## SELECT FOR UPDATE
Transition endpoint uses `BEGIN … SELECT FOR UPDATE … COMMIT` to prevent concurrent approval races.

## Migration 005
Order: 001 → 002 → 003 → 004 → 005 (depends on 004's sector nullable changes).

Migration includes deduplication step (archives older duplicates, keeps MAX(id)) before creating 12 unique partial indexes.

Unique indexes: project (monthly/quarterly/annual), activity, program_state, hq_sector — all exclude rejected+archived rows.

## Duplicate prevention
DB: unique partial indexes (per type × entity × frequency × period).
Advisory: `GET /reports/duplicate-check` endpoint retained.

## Constants location (server-side)
`artifacts/api-server/src/lib/reportConstants.ts` — single source of truth for all type lists, status groups, SQL array literals, workflow definitions, getRevisionPerm.

## Dashboard.ts reports-summary
Now uses `requirePerm("reports.view")`, same scope logic as GET /reports, returns new KPI shape. Scopes by effective state + TC sectors + canonical type filter.

**Why:** Separated pending (ambiguous) into draft vs awaitingApproval; removed completionRatePct as a meaningless aggregation; added 14-day overdue.

## Test suite
133 regression tests in `artifacts/cafa-pmis/src/test/reports-module.test.ts` — self-contained with inlined constants, runs under cafa-pmis vitest.
