---
name: Activity Report Link Modes
description: Architecture of the three-mode Activity Report creation flow (standalone / activity / project).
---

## Rule
Activity Reports are standalone by default. Neither Activity nor Project is mandatory. A required "Report Subject / Activity Name" (`activityName`) text field is the primary identity in all three modes.

**Three link modes (frontend `linkMode` state):**
- `"standalone"` — no linked activity or project record (default)
- `"activity"` — linked to an existing activity record; `activityId` is set; `projectId` is auto-derived from the activity
- `"project"` — linked to a project but no specific activity; `projectId` is user-selected; `activityId` is null

**Why:** Activities in the field often have no system record. Requiring `activityId` blocked legitimate standalone reporting. The `activityName` field provides the mandatory human-readable identity across all three modes.

**How to apply:**
- `FormShape` includes `activityName: string`; `activityId` remains separate React state
- `handleLinkModeChange(mode)` clears stale identity fields on every mode switch
- `inferLinkMode(stored)` restores the correct mode on draft edit: activityId → "activity"; only projectId → "project"; else → "standalone"
- Auto-title uses `v.activityName` (not `act.title`); returns early if subject is empty
- `validateBasicInfo` / `validateDraft` / `validateSubmit`: `activityName` always required; `activityId` only required for "activity" mode; `projectId` only required for "project" mode

## Backend changes
- Removed `activity_report_requires_activity_id` gate (lines 552–554 in the original, now gone)
- New validation block: project-linked activity report mode (activityId=null, projectId provided) — validates project, TC sector, state-project link
- New validation block: standalone mode (both null) — resolves stateId from body or SPO/SOM role
- `activity_name TEXT` column added to `reports` table via migration 012 (nullable — historical reports unaffected)
- `activity_name` included in `reportSelect`, `INSERT`, and PATCH `maybeSet`
- Duplicate-check: if `qReportType === "activity"` and `activityId` is absent → returns `{matchType:"none"}` immediately (no false collision for standalone reports)

## Identity immutability (PATCH)
`activityId`, `projectId`, `stateId` remain immutable after creation. `activityName` is updatable (not an identity field).
