# Risk Register — Residual Integrity Closure Wave 2

Scope: RISK-003, RISK-009, RISK-010, RISK-012, RISK-014, RISK-015, RISK-016,
RISK-022, #576, #577, RISK-BD-06. Functional closure only; British English.

Tests: `artifacts/api-server/src/routes/__tests__/risk-residual-wave2.test.ts`
(RISK-RES-01…16, 37 tests) and
`artifacts/cafa-pmis/src/__tests__/risk-residual-wave2.test.ts` (frontend, 8 tests).

---

## RISK-003 — Stale write / dead optimistic-locking schema

- **Original issue**: `version`, `locked_by`, `locked_at` declared in the Drizzle
  schema but the Risk PATCH performs a plain `WHERE id = $N` update with no CAS
  predicate — apparently dead schema.
- **Current evidence**: verification (grep of the full codebase) found that
  `locked_by` / `locked_at` are **NOT dead**: the realtime record-lock routes
  (`artifacts/api-server/src/routes/realtime.ts`) read and write them on the
  `risks` table (`tableFor("risk")`), backing the collaborative edit-lock UI.
  Only `version` had no reader or writer anywhere.
- **Fix applied**: migration `028_risks_drop_dead_version_and_open_default`
  drops `risks.version` only; `locked_by`/`locked_at` retained and documented as
  live in `lib/db/src/schema/index.ts`. No client contract existed for
  versioning, so no OpenAPI change was needed (Risk schemas never exposed it).
- **Tests**: RISK-RES-01.
- **Status**: CLOSED (scope corrected: `version` dropped; lock columns are live
  realtime infrastructure, intentionally retained).

## RISK-009 — State actor project membership

- **Original issue**: CREATE gained a `project_states` membership gate (#570);
  LIST parity needed verification.
- **Current evidence**: LIST clamps SPO/SOM to `r.state_id = own state` and
  fails closed (`1=0`) when the actor has no state
  (`artifacts/api-server/src/routes/risks.ts`, GET /risks scope block); CREATE
  retains the membership check.
- **Fix applied**: none needed — closed by #570; regression tests added.
- **Tests**: RISK-RES-02 (own-state pass, cross-state 403, PM bypasses scope
  not existence, null-state fail-closed).
- **Status**: CLOSED (verified, regression-pinned).

## RISK-010 — Soft-deleted project contamination

- **Original issue**: `LEFT JOIN projects` in the list/count/row queries had no
  `deleted_at IS NULL` predicate — a soft-deleted project's title leaked into
  list/detail and its sector could grant TC scope.
- **Fix applied**: `AND p.deleted_at IS NULL` added to `riskSelect`, the new
  `riskCountSelect`, and `getRiskRow` in `routes/risks.ts`. Risks whose project
  is soft-deleted remain listed (history preserved) with `projectTitle = NULL`;
  `p.sector` is NULL for deleted projects so the TC `p.sector = ANY(...)`
  predicate cannot match. Frontend (`risks.tsx`) renders `[Project removed]`
  when `projectId` is set but the title is null (list cell + detail sheet).
- **Tests**: RISK-RES-03, RISK-RES-04 (+ frontend fallback tests).
- **Status**: CLOSED.

## RISK-012 — Due-date checker timezone

- **Original issue**: `todayStr()`/`dateInDays()` used
  `setHours(0,0,0,0)` + `toISOString()`, which shifts the calendar date on any
  non-UTC server (e.g. UTC+3 after 21:00 local).
- **Fix applied**: `artifacts/api-server/src/lib/due-date-checker.ts` now
  derives all reference dates from a single
  `SELECT CURRENT_DATE::text, (CURRENT_DATE+1/3/7)::text` query — the same
  calendar source `dashboard.ts` analytics already use — eliminating the JS
  conversion entirely (Option A from the plan).
- **Tests**: RISK-RES-05 (structural: CURRENT_DATE present, shift-prone pattern
  absent).
- **Status**: CLOSED.

## RISK-014 — Notification sequencing

- **Evidence**: notifications fire strictly post-UPDATE, outside the
  transaction; an INSERT failure loses the notification but never the Risk
  write, and no ghost-notification-before-write path exists. This matches the
  system-wide best-effort notification pattern (reports, plans, comments).
- **Tests**: RISK-RES-06 (failed UPDATE → 500, zero notification INSERTs;
  source-order assertion).
- **Status**: NOT A DEFECT — intentional best-effort post-write notification.
  A future cross-module task could introduce a notification outbox table if
  guaranteed delivery is ever required.

## RISK-015 — Drizzle schema drift

- **Original issue**: schema-as-code declared `state_id NOT NULL` and omitted
  `location_type`, but migration 013 made `state_id` nullable and added
  `location_type TEXT`.
- **Fix applied**: `lib/db/src/schema/index.ts` — `stateId` now nullable,
  `locationType: text("location_type")` added. No migration (DB already
  correct); `pnpm typecheck:libs` clean.
- **Tests**: RISK-RES-07.
- **Status**: CLOSED.

## RISK-016 — List pagination and deterministic ordering

- **Original issue**: GET /risks was unbounded with a non-deterministic
  tiebreak (`ORDER BY identified_at DESC` only).
- **Fix applied**: `page` (default 1) / `limit` (default 50, max 200) params;
  `ORDER BY r.identified_at DESC, r.id DESC`; response envelope
  `{ items, total, page, limit, totalPages }`. OpenAPI updated
  (`RiskListResponse`); `lib/api-client-react` + `lib/api-zod` regenerated.
  All four frontend consumers updated to the envelope (`risks.tsx`,
  `plan-detail.tsx`, `create-plan-registration-dialog.tsx`, and the raw fetch
  in `reports.tsx`), requesting `limit=200`. Dashboard analytics use their own
  SQL and are unaffected.
- **Tests**: RISK-RES-08, RISK-RES-09 (+ frontend envelope tests).
- **Status**: CLOSED.

## RISK-022 — Default status mismatch

- **Original issue**: DB default `'identified'` contradicted the canonical
  create status `'open'` (#578 / RISK-BD-03) for direct DB inserts.
- **Fix applied**: migration 028 `ALTER COLUMN status SET DEFAULT 'open'`;
  Drizzle default updated to `"open"`. Existing `identified` rows deliberately
  NOT mass-updated: `identified` remains a valid status in the 9-value model
  and default-derived rows cannot be distinguished from user intent
  retroactively — documented as a data note, not auto-corrected.
- **Tests**: RISK-RES-10.
- **Status**: CLOSED.

## #576 — Clear assignee / due date

- **Root cause**: the edit form deleted falsy values from the PATCH payload;
  PATCH only updates present keys, so "clearing" was silently ignored.
- **Fix applied** (`artifacts/cafa-pmis/src/pages/risks.tsx` edit form):
  the Unassigned option now sets `null` (not `undefined`); the save handler
  always sends `assignedToId: <value|null>` and `dueDate: <value|null>`.
  Backend already honours explicit null (`assigned_to_id = $N` with a null
  param). The CREATE forms (risks page + project-detail) still omit unset
  optional fields — correct, as no clearing semantics exist at create time.
- **Tests**: RISK-RES-11, RISK-RES-12 (null clears; omit preserves), plus
  frontend source invariants.
- **Status**: CLOSED.

## #577 — Bogus stateId validation

- **Original issue**: no existence check for arbitrary `stateId` values on
  create — a non-project-linked risk could reference a made-up state.
- **Fix applied**: POST /risks now runs `SELECT 1 FROM states WHERE id = $1`
  for every non-HQ risk (after the location-combination checks, before the
  state-role scope check) and returns `422 state_not_found`. The check is
  actor-independent — PM/Super Admin cannot bypass it. PATCH needs no
  equivalent: `stateId` is not a patchable field (location identity is
  create-time only, RISK-BD-01), verified by test.
- **Tests**: RISK-RES-13, RISK-RES-14, RISK-RES-15.
- **Status**: CLOSED.

## RISK-BD-06 — Date ordering / assignee state-sector scope

- **Evidence**: #570 recorded no canonical business basis for a
  dueDate/identifiedAt ordering rule or an assignee state/sector scope rule;
  the Business Decisions closure (#578) confirmed no canonical rule exists.
- **Fix applied**: none — no enforcement added.
- **Tests**: RISK-RES-16 (assignee validation = existence + active only;
  ordering non-enforcement documented in source).
- **Status**: NOT A REQUIREMENT / NOT A DEFECT.

---

## Remaining Risk findings

- RISK-005 (Project permanent-delete interaction) — explicitly out of scope
  for this wave; owned by a later task.
- RISK-013 / RISK-019 follow-on (scoring documentation & API enum contract
  alignment) — owned by task #584.
