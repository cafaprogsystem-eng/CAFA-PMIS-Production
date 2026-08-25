# HQ Sector Report — Final Closure Audit

**Audit Date:** 2026-08-17  
**Task:** #414 — HQSR Final Closure Audit  
**Auditor:** Replit Agent (Task #414)  
**Verification basis:** Direct production code inspection — not prior task summaries  

---

## Executive Verdict

**FUNCTIONALLY COMPLETE WITH NON-BLOCKING FOLLOW-UPS**

One CORE BLOCKER was identified and fixed during the audit:

> **HQSR-CLOSE-DUP** — No duplicate period enforcement for `report_type = 'hq_sector'`. The HQ project report guard and SPR guard were present; HQSR was silently skipped. A TC could create unlimited HQSR monthly/quarterly/annual reports for the same sector and period. Fixed by adding Migration 023 (three partial unique indexes) and a server-side transactional guard mirroring the SPR pattern.

All other closing criteria pass. The HQSR implementation is production-safe subject to the non-blocking follow-ups listed in the final section.

---

## Audit Scope

Modules verified from production code (`artifacts/api-server/src/routes/reports.ts`, `artifacts/api-server/src/lib/run-migrations.ts`, `artifacts/api-server/src/routes/dashboard.ts`, `artifacts/cafa-pmis/src/pages/reports.tsx`, `artifacts/cafa-pmis/src/components/hq-sector-report-form.tsx`, `artifacts/cafa-pmis/src/components/voice-note-panel.tsx`).

Contracts re-verified: HQSR-001 Author Governance, HQSR-002 Identity Immutability, HQSR-003 Submit Content Gate, HQSR-004 HQ Location Integrity, HQSR-005 Draft/Edit/Revision/Resubmit, HQSR-006 Notification Routing, SPC Fallback Workflow, Reviewer Detail Completeness, Secure Supporting Attachments, Read-Only Reviewer Voice Notes, Drive-Backed Attachment Canonicalisation, Generic Analytics Integration (#395).

Arabic/i18n: deferred — not a closure blocker.

---

## Original Finding Matrix

| Finding ID | Original Problem | Approved Resolution | Production Evidence | Test Evidence | Status | Residual Risk |
|---|---|---|---|---|---|---|
| HQSR-001 | Author gate: TC sector scope, SPC fallback, PM/SA access | TC exact-match gate + SPC vacancy check + PM Full Operational Access (#373) | `reports.ts:1010–1076` | `hqsr-author-role.test.ts` (13 tests + 6 SPC) | CLOSED | None |
| HQSR-002 | Identity immutability — PATCH must not change sector/kind/period/type | Identity guard in PATCH handler returning 409 `hq_sector_report_identity_immutable` | `reports.ts:2827–2857` | `hqsr-identity-hardening.test.ts` | CLOSED | None |
| HQSR-003 | Submit gate — 8 required narratives + support request enforced | `validateHqSectorReportForSubmission` at `reports.ts:3697–3827` | `reports.ts:3797–3820` | `hqsr-submit.test.ts` | CLOSED | None |
| HQSR-004 | HQ location integrity — state_id/project_id must be NULL | 422 guard at POST + NULL forced at INSERT + DB CHECK constraint (Migration 021) | `reports.ts:1074, 1742–1748` | `hqsr-location-integrity.test.ts` | CLOSED | None |
| HQSR-005 | Draft/edit/revision lifecycle — same reportId preserved | `existingReport` prop + PATCH path + hydration logic | `hq-sector-report-form.tsx:502–512,986` | `hqsr-draft-edit.test.tsx` | CLOSED | None |
| HQSR-006 | Notification routing — TC→SPC; SPC fallback→PM; ghost-free | `notifyNextApprover` with `hqsrPath` param, action-map keyed by `workflow_path` | `reports.ts:4417+` | `hqsr-tc-notification.test.ts` | CLOSED | None |
| HQSR-BD-1/BD-6 | SPC fallback workflow approval chain | PM as coordination reviewer for SPC-fallback; `workflow_path = 'spc_fallback'` frozen at creation | `reports.ts:1758–1770` | `hqsr-spc-fallback.test.ts` | CLOSED | None |
| HQSR-016 | Secure supporting attachments — no objectPath exposure | Secure download endpoint; object_path never returned to UI | `reports.ts` attachment route | `hqsr-evidence.test.tsx` | CLOSED | None |
| HQSR-DRIVEATT | Drive-backed evidence — canonicalisation, sync, streaming | `syncHqsrDriveAttachments` + Migration 021/022 + streaming download | `reports.ts:787–835` | `routes/hqsr-drive-attachments.test.ts` | CLOSED | None |
| HQSR-VOICENOTE | Reviewer voice notes genuinely read-only | `VoiceNoteItem readOnly={true}` → `{!readOnly}` guards Delete + Record + Upload | `voice-note-panel.tsx:316,376,439` | `hqsr-voice-notes.test.tsx` | CLOSED | None |
| HQSR-ANALYTICS | HQSR included in generic report analytics via LEFT JOIN | `dashboard.ts:1762` LEFT JOIN + `COALESCE(NULLIF(r.sector,'')` | `dashboard.ts:1762–1775` | Frontend closure test | CLOSED | None |
| **HQSR-CLOSE-DUP** | **Missing HQSR duplicate period enforcement (CORE BLOCKER)** | **Migration 023 + server-side guard** | **`reports.ts` (new guard), `run-migrations.ts` (Migration 023)** | **`hqsr-final-closure.test.ts` (HQSR-CLOSE-DUP suite)** | **CLOSED (fixed in this audit)** | None |

---

## Canonical HQSR Data Model

```
reports (report_type = 'hq_sector')
  sector          TEXT NOT NULL           — canonical Main Sector (VALID_SECTOR_SET)
  kind            TEXT NOT NULL           — monthly | quarterly | annual | on_demand
  reporting_year  INTEGER                 — for monthly/quarterly/annual
  reporting_month INTEGER                 — for monthly
  quarter         INTEGER                 — for quarterly
  period_start    DATE                    — for on_demand
  period_end      DATE                    — for on_demand
  state_id        INTEGER NULL            — ALWAYS NULL (DB CHECK enforced)
  project_id      INTEGER NULL            — ALWAYS NULL (DB CHECK enforced)
  workflow_path   TEXT NULL               — NULL (TC/PM/SA) or 'spc_fallback'
  author_id       INTEGER NOT NULL        — immutable after creation
  sections        JSONB                   — 8 narratives + supportRequired + attachments
```

DB-level enforcements: `chk_hq_sector_no_state_project` CHECK constraint (Migration 021); three partial unique indexes for monthly/quarterly/annual (Migration 023).

---

## Authoring Matrix

| Role | Can Create HQSR | Scope | workflow_path |
|---|---|---|---|
| TC | ✓ | Assigned Sector(s) only; no Sector → fail closed | NULL |
| SPC (vacancy fallback) | ✓ when no active TC | Server-verified vacancy per sector | `spc_fallback` (frozen) |
| PM | ✓ (Full Operational Access, #373) | Any canonical sector | NULL |
| Super Admin | ✓ | Any canonical sector | NULL |
| SPO | ✗ — 403 | — | — |
| SOM | ✗ — 403 | — | — |
| ED | ✗ — 403 | — | — |
| Viewer | ✗ — 403 | — | — |

---

## Sector Scope

TC sector scope enforced at `reports.ts:1030–1038` via `tcSectorRestriction(req)`. Exact-segment match from the TC's profile `sectors` array. Zero assigned sectors → fail closed. Non-canonical sector string → 400 before sector branching. Cross-sector → 403 `sector_scope_forbidden`. Verified: no frontend flag can bypass the server check. PM/SA bypass the sector restriction; canonical sector validation still applies (cannot create for a fake sector).

---

## SPC Fallback

Server-side vacancy check via `hasActiveTcForSector(requestedSector)` at `reports.ts:1040`. Queries active (`status = 'active'`) TCs whose `sector` CSV includes the exact requested sector. Result is never cached or trusted from the client. `workflow_path = 'spc_fallback'` is set at creation time and is immutable (Migration 019 CHECK constraint, `reports.ts:1768`). A later TC activation or sector reassignment does not retroactively change the frozen `workflow_path`.

---

## Identity Integrity

PATCH guard at `reports.ts:2827–2857`: for `report_type = 'hq_sector'`, any of `sector`, `kind`, `period`, `reportingMonth/reporting_month`, `reportingYear/reporting_year`, `quarter`, `periodStart/period_start`, `periodEnd/period_end`, `stateId/state_id`, `projectId/project_id`, `reportType/report_type` present in the PATCH body → 409 `hq_sector_report_identity_immutable`. Both camelCase and snake_case variants checked. Guard fires before any DB UPDATE. PM Full Operational Access does NOT bypass this guard (verified in `hqsr-final-closure.test.ts` HQSR-CLOSE-05 suite and source inspection).

---

## HQ Location Integrity

**422 guard at POST** (`reports.ts:1074–1083`): any `stateId` or `projectId` in the body → 422 `hq_sector_location_invalid`. Actor-independent: TC, SPC, PM, SA all equally bound. No overrideReason bypass.

**INSERT defence-in-depth** (`reports.ts:1919–1924`): `project_id` forced to NULL when `reportType === 'hq_sector'`; `effectiveStateId` forced to NULL at `reports.ts:1745`. These run even if the 422 guard were bypassed.

**DB CHECK** (Migration 021): `chk_hq_sector_no_state_project` — `report_type <> 'hq_sector' OR (state_id IS NULL AND project_id IS NULL)`. Final backstop at storage level.

**PM bypass test**: supply `stateId` with PM actor → 422 (confirmed via `hqsr-location-integrity.test.ts:HQSR-LOC-ROLE` and `hqsr-final-closure.test.ts:HQSR-CLOSE-04`).

---

## Draft/Edit Lifecycle

- **Create → Save Draft**: POST body goes through author gate + location gate; saved as `status = 'draft'`.
- **Continue Editing**: `HqSectorReportForm` receives `existingReport` prop; `isEditMode = existingReport !== undefined`. Edit mode triggers hydration from `existingReport` fields (`hq-sector-report-form.tsx:609–699`).
- **PATCH**: Edit-mode save uses `fetch(\`/api/reports/${existingReport.id}\`, { method: 'PATCH' })` — always the same `reportId`, never a POST replacement.
- **Content-only PATCH**: form only sends content fields (narratives, sections, title); identity fields (sector/kind/period/reportType) are never included in the PATCH payload.
- **Locked identity fields**: rendered as disabled/read-only in edit mode (verified in `hq-sector-report-form.tsx`).
- **HQSR-003 gate does NOT block Draft saving**: `validateHqSectorReportForSubmission` is called only on `action = submit` transitions, not on PATCH.

---

## Submission Validation

`validateHqSectorReportForSubmission` at `reports.ts:3697–3827`:

- §1 Top-level sector required and canonical.
- §2 Title required.
- §3 On-demand: valid `periodStart`/`periodEnd`, end ≥ start, non-blank `onDemandReason`. Impossible dates rejected. Fail-closed on-demand detection: if either stored `kind` OR `sections.frequency` indicates on_demand, stricter requirements apply — no conflicting-storage bypass.
- §4 Eight required narrative fields: `technicalAnalysis`, `keyFindings`, `qualityAssessment`, `technicalChallenges`, `recommendations`, `strategicPriorities`, `lessonsLearned`, `sectorOutlook`.
- §5 `supportRequired` array: ≥ 1 object with non-blank `supportType` and `description`.
- Malformed sections (null, array/object confusion, missing nested content) → controlled 422, never 500 (verified by `hqsr-submit.test.ts HQSR-SUBMIT-MAL` suite).

**Transaction safety**: submit action runs inside `pool.connect()` + `BEGIN/COMMIT/ROLLBACK`. A 422 from `validateHqSectorReportForSubmission` triggers `ROLLBACK` before any status mutation, approval row creation, or notification dispatch.

---

## Workflow

**TC-authored path** (`workflow_path = NULL`):  
TC → Submit → (coordination_review by SPC) → (final_approve by PM) → approved

**SPC fallback path** (`workflow_path = 'spc_fallback'`):  
SPC → Submit → (coordination_review by PM) → (final_approve by PM) → approved

Both paths use `REPORT_WORKFLOWS['hq_sector']`. Workflow selection: `getProjectActivityWorkflow(workflowPath)` is NOT used for hq_sector (only for project/activity reports); `REPORT_WORKFLOWS[reportType]` is used. TC/SPC/SA cannot self-review (universal self-review guard at transitions route). PM may coordination-review AND final-approve SPC-fallback HQSRs under Full Operational Access.

---

## Self-Review Override (Full Operational Access)

PM self-review requires `overrideReason` in the request body. On approval: `used_override = TRUE` and `override_reason = <reason>` written to `approvals` row (Migration 020). Audit log also stamped. `used_override` visible in approval history. Normal self-review prohibition remains for TC, SPC, SA without the explicit override mechanism.

---

## Notifications

Routing logic at `reports.ts:4417+`:

- TC-authored submit → `notifyNextApprover` routes to active SPC(s); never a TC.
- No active SPC → PM fallback with structured warning.
- SPC fallback submit → `notifyNextApprover` routes to PM; does not route back to SPC author.
- Resubmit after request_revision → same routing as initial submit for the respective path.
- Failed transitions (validation 422, permission 403, identity 409, location 422, self-review block, invalid status/action) → ROLLBACK fires BEFORE `notifyNextApprover` call → zero ghost notifications.

Deep-link security: notification links use the standard `/reports/:id` path, resolved through scope-enforced single-report access (TC sector clamp, SPC org-wide, state roles fail-closed for HQSR).

---

## Revision Lifecycle

`request_revision` transitions report to `draft` status. Author can then edit via `Continue Editing` (same `existingReport` path). The approval history at the time of revision is preserved. Author sees revision state via `isReturnedForRevision` flag in `hq-sector-report-form.tsx:725–727` (derived from `approvalHistory` containing a revision action). On resubmit: same `reportId` is transitioned; no replacement report created.

**Reviewer feedback visibility**: SPR comment section taxonomy is NOT introduced into HQSR (verified). HQSR comment sections use `null` (report-level) or a HQSR-specific key, never the SPR taxonomy keys (confirmed in `spr-comment-sections.md` memory note).

---

## Reviewer Content Completeness

`HqSectorSectionsView` (exported from `hq-sector-report-form.tsx:1665`) renders for reviewers when `selected.reportType === 'hq_sector'` (`reports.tsx:6703`). Contains:

- HQ identity: title, sector, kind/frequency, period, status, author, timestamps (confirmed by `hqsr-reviewer-detail.test.tsx`).
- All 8 required narratives: `technicalAnalysis`, `keyFindings`, `qualityAssessment`, `technicalChallenges`, `recommendations`, `strategicPriorities`, `lessonsLearned`, `sectorOutlook`.
- Support request cards: rendered as individual cards (not collapsed blob).
- Optional sections: observation, rating, commentary rendered when present.
- No State or Project identity shown (HQSR has no state/project linkage by design).
- `objectPath` / storage keys never exposed in the viewer (confirmed by `hqsr-evidence.test.tsx` and closure test HQSR-CLOSE-12).

---

## Supporting Attachments (Object-Backed)

Secure download via `/api/reports/:id/attachments/:attId/download`. Endpoint enforces report-level access control. Raw `object_path` (S3/GCS key) never returned to the UI in any response. Confirmed by source inspection in `hqsr-evidence.test.tsx`. Legacy duplicate attachment list absent. One canonical evidence section only.

---

## Drive-Backed Evidence

**Schema**: `report_attachments.drive_file_id INTEGER REFERENCES drive_files(id) ON DELETE SET NULL` (Migration 021). Object-backed rows: `drive_file_id IS NULL`. Drive-backed rows: `object_path = ''`.

**Partial unique indexes** (Migration 021):
- `idx_report_attachments_object_path_partial` — unique on `object_path` WHERE `drive_file_id IS NULL` (ATT-02 deduplication preserved).
- `idx_report_attachments_drive_file` — unique on `(report_id, drive_file_id)` WHERE `drive_file_id IS NOT NULL` (no duplicate Drive file per report).

**Sync**: `syncHqsrDriveAttachments` (`reports.ts:787–835`) runs on HQSR create (post-INSERT) and PATCH (post-UPDATE). Idempotent: `NOT EXISTS` guard. Ownership-gated: only Drive files where `uploaded_by_user_id = authorId` are synced. Deletes stale Drive-backed rows not in the incoming set.

**Historical backfill**: Migration 022 — idempotent INSERT using `NOT EXISTS` guard, validates positive `driveFileId`, requires active `drive_files` row with ownership matching report author. Prevents cross-user file disclosure.

**Download**: Drive-backed rows proxied via `downloadFileStream` through the Drive connector — no redirect through a secondary auth path. TC sector check applied before download for HQSR (report-level access control).

**Security**: wrong-sector TC → blocked; excluded role → blocked; unauthorised report actor → blocked. Both object-backed and Drive-backed paths tested in `hqsr-evidence.test.tsx`.

---

## Voice Notes

`VoiceNotePanel` accepts `readOnly?: boolean` prop. Reviewer `HqSectorSectionsView` mounts `VoiceNotePanel` with `readOnly={true}`.

Propagation chain: `VoiceNotePanel readOnly={true}` → passes `readOnly={readOnly}` to each `VoiceNoteItem` (`voice-note-panel.tsx:439`) → `VoiceNoteItem` renders Delete button inside `{!readOnly && (...)}` guard at line 376.

Playback available in readOnly mode ✓. Record/Upload absent in readOnly mode ✓. Delete absent per-item in readOnly mode ✓ — **the per-item Delete guard was the specific concern in the task spec and is confirmed correct**.

Voice-note endpoint independently enforces Report scope (not relying on readOnly UI). Confirmed in `hqsr-voice-notes.test.tsx`.

---

## Comments & Approval History

- Reviewer feedback comments: accessible to returned author via narrow author-gated read path.
- HQSR does NOT use SPR section taxonomy (different module, different comment section keys — `null` for report-level HQSR comments).
- Approval history: `approvals` table rows with `used_override` / `override_reason` columns (Migration 020) surfaced in the detail view.
- Normal role-based comment access control unchanged.

---

## Analytics Integration

Generic report metrics at `dashboard.ts:1762`:

```sql
FROM reports r LEFT JOIN projects p ON p.id = r.project_id
WHERE 1=1
  ...
```

LEFT JOIN preserves HQSR rows (`project_id IS NULL` — no project to join). Sector grouping: `COALESCE(NULLIF(r.sector,''), p.sector, 'Unspecified')` — HQSR rows carry `r.sector` (their authoritative sector) and do not fall back to `p.sector`.

TC sector filter: `COALESCE(NULLIF(r.sector,''), (SELECT p.sector FROM projects p WHERE p.id = r.project_id)) = ANY($1::text[])` — HQSR `r.sector` matches directly, no subquery needed. No cross-sector leakage: a TC querying WASH analytics sees only WASH HQSRs.

HQSR does NOT enter project-only financial/performance metrics (project_id IS NULL means it cannot JOIN to projects-only views). Confirmed HQSR is excluded from project reporting completeness calculations.

Migration-duplicate rows excluded from analytics via `migration_is_duplicate = FALSE` filters.

---

## Direct Endpoint Security Matrix

| Endpoint | TC wrong-sector | Non-author | Excluded role | PM Full Access |
|---|---|---|---|---|
| GET /reports/:id | Blocked | Blocked | Blocked | Permitted (#373) |
| PATCH /reports/:id (content) | Blocked | Blocked | Blocked | Permitted |
| PATCH /reports/:id (identity field) | Blocked (409) | Blocked (409) | Blocked (409) | Blocked (409) — no bypass |
| POST /reports (stateId/projectId) | Blocked (422) | N/A | N/A | Blocked (422) — no bypass |
| POST /transitions (submit) | Blocked | Blocked | Blocked | Permitted with overrideReason |
| GET /attachments | Blocked | Blocked | Blocked | Permitted |
| GET /attachments/:id/download | Blocked | Blocked | Blocked | Permitted |
| POST /voice-notes | Blocked | Blocked | Blocked | Permitted |
| Dashboard analytics | Sector-clamped | N/A | N/A | Org-wide |

---

## Full Operational Access (#373)

PM and Super Admin hold Full Operational Access as defined in Task #373. Confirmed permitted for HQSR:
- Authoring (create HQSR for any canonical sector, no vacancy check).
- Coordination review and final approval on any HQSR.
- Draft editing, resubmit, request_revision.

Confirmed **NOT** permitted even for PM/SA:
- Supplying stateId/projectId in POST (422, actor-independent).
- Mutating identity fields via PATCH (409, actor-independent).
- DB CHECK constraint `chk_hq_sector_no_state_project` — no role can bypass at the storage level.

---

## Migration Registry & Upgrade Audit

All HQSR-relevant migrations verified from production `run-migrations.ts`:

| Migration Name | Purpose | Notes |
|---|---|---|
| `013_hq_location_type` | `location_type` column on reports | Pre-HQSR infrastructure |
| `015_pmr_hq_unique_indexes` | Unique indexes for HQ project reports | Not HQSR-specific |
| `019_workflow_path_spc_fallback` | `workflow_path` CHECK + `spc_fallback` allowed | HQSR SPC fallback |
| `020_global_full_operational_access_override_audit` | `used_override`/`override_reason` on approvals + audit_log | PM Full Access audit trail |
| `021_hq_sector_location_integrity` | DB CHECK `chk_hq_sector_no_state_project` | HQSR-004 |
| `021_report_attachments_drive_file_id.sql` | `drive_file_id` FK on `report_attachments` + partial indexes | Drive evidence |
| `022_hqsr_attachments_backfill.sql` | Idempotent backfill of existing HQSR Drive attachments | Historical sync |
| **`023_hqsr_unique_period_indexes`** | **Three partial unique indexes for HQSR period uniqueness** | **Fixed CORE BLOCKER** |

**Migration ID collision — "021"**: Two migrations share the `021` numeric prefix: `021_hq_sector_location_integrity` and `021_report_attachments_drive_file_id.sql`. The runner tracks migrations by **full name** (stored in `schema_migrations.filename`). Since both have different full names, they receive separate `schema_migrations` rows and execute independently in array-definition order. This is a naming confusion but NOT an execution collision. Both run safely on fresh and existing databases.

**Array-definition order verified**: `023_hqsr_unique_period_indexes` appears before `022_hqsr_attachments_backfill.sql` in the MIGRATIONS array, establishing the uniqueness constraints before the backfill populates rows.

**Upgrade path**: Migration runner iterates MIGRATIONS array in definition order. Fresh databases apply all migrations from 001 onwards. Existing databases skip already-applied migrations (by full name). Both scenarios produce the same final schema state.

---

## UX & Accessibility

- **Mode distinction**: Create mode (`existingReport` undefined), Edit mode (`existingReport` set, `isEditMode = true`), Returned-for-revision mode (`isReturnedForRevision = true` via approval history scan) — all visually distinguishable.
- **Locked identity fields**: Sector, Frequency, Period rendered disabled/read-only in edit mode; not hidden, so context is preserved.
- **422 validation errors**: `validateHqSectorReportForSubmission` returns `fields[]` array; frontend maps to per-field error messages (not just "Submission failed").
- **Long narratives**: rendered with `prose` CSS classes; line breaks preserved; no horizontal overflow.
- **Support request cards**: each rendered individually (`supportRequired.map(...)` in `HqSectorSectionsView`).
- **Attachment states**: loading / error / empty / populated all handled in attachment list component.
- **Voice-note controls**: semantic button labels (`aria-label` present per VoiceNoteItem).
- **Keyboard navigation**: form controls follow natural tab order; Save Draft and Submit in sticky footer are keyboard-accessible.
- **Semantic headings**: `HqSectorSectionsView` uses `<h3>`/`<h4>` for section hierarchy within the detail Sheet.
- **Loading/busy states**: Save Draft and Submit trigger `isPending`/`isLoading` states (button disabled + spinner).

Non-blocking items: formal ARIA landmark audit, full WCAG 2.1 AA compliance audit — deferred as follow-ups.

---

## Cross-Report Regression

SPR, PMR, and Activity Report modules verified as unaffected by HQSR changes:

- **Mock updates** in `hqsr-author-role.test.ts` and `hqsr-location-integrity.test.ts`: added HQSR duplicate check guard to existing mocks. All 13 SPR-related tests continue to pass.
- **Duplicate guard code**: The new HQSR guard is conditioned on `reportType === "hq_sector"` — zero impact on SPR, PMR, or Activity Report creation paths.
- **Migration 023**: indexes are `WHERE report_type = 'hq_sector'` partial indexes — no impact on other report types' unique constraints.
- **`mockAllowCreate()` helper**: added to `hqsr-author-role.test.ts` — only changes mock behaviour for HQSR dup check SQL, not SPR/PMR/Activity SQL patterns.
- Backend test count: 960 (pre-audit) → 990 (post-audit); no pre-existing tests were removed or weakened.
- Frontend test count: 4281 (pre-audit) → 4318 (post-audit); no pre-existing tests were removed or weakened.

SPR is formally complete per Task #409 — this audit confirms no regression.

---

## Fixes Made During Closure Audit

| Fix | File(s) | Description |
|---|---|---|
| **HQSR-CLOSE-DUP: HQSR duplicate period enforcement** | `artifacts/api-server/src/lib/run-migrations.ts` | Added Migration 023 (`023_hqsr_unique_period_indexes`): three partial unique indexes on `reports(sector, reporting_year, reporting_month)` / `(sector, reporting_year, quarter)` / `(sector, reporting_year)` for HQSR monthly/quarterly/annual respectively. |
| **HQSR-CLOSE-DUP: Server-side transactional guard** | `artifacts/api-server/src/routes/reports.ts` | Added HQSR duplicate guard block (61 lines) between the SPR guard and the INSERT. Queries the new partial indexes; returns 409 `duplicate_report_period` with a descriptive message. `on_demand` kind correctly exempt. |
| **Mock compatibility** | `artifacts/api-server/src/test/hqsr-author-role.test.ts` | Updated `mockTcRoster()` and `beforeEach` calls to return empty rows for the new HQSR dup check SQL (prevents false 409 in create-success tests). Added `mockAllowCreate()` helper. |
| **Mock compatibility** | `artifacts/api-server/src/test/hqsr-location-integrity.test.ts` | Updated `mockVacantTcRoster()` and the "valid creates" `beforeEach` to return empty rows for the new HQSR dup check SQL. |

---

## Test Results

**Pre-audit baseline:**  
Backend: 960/960 | Frontend: 4281/4281 | Skipped: 0 | Failed: 0

**Post-audit:**  
Backend: 990/990 (42 test files) | Frontend: 4318/4318 (55 test files) | Skipped: 0 | Failed: 0

New tests added:
- `artifacts/api-server/src/test/hqsr-final-closure.test.ts` — 30 backend closure tests (HQSR-CLOSE-01…17 + DUP suite)
- `artifacts/cafa-pmis/src/test/hqsr-final-closure.test.ts` — 37 frontend closure tests (HQSR-CLOSE-01…16)

No `.skip`, `.todo`, weakened assertions, or conditional assertions that silently don't execute. No test suppression.

---

## TypeScript Results

**Frontend (`cd artifacts/cafa-pmis && npx tsc --noEmit`):**

22 pre-existing errors — none introduced by this audit:
- `consolidated-report-view.tsx` (3): missing `api-client-react` exports (`useGetConsolidatedProjectReport`, `GetConsolidatedProjectReportParams`, `ConsolidatedReportLocation`)
- `pmr-completeness-panel.tsx` (2): missing `api-client-react` exports
- `project-registration-form.tsx` (1): `hasHqOperations` not in generated `ProjectInput`
- `plan-detail.tsx` (2), `plans.tsx` (1), `reports.tsx` (4), `risks.tsx` (3): `locationType` not in generated types
- `project-detail.tsx` (4): `reportingFrequency` not in generated `Project` type
- `risks.tsx` (2): stateId type mismatch + `locationType` issues

**Backend (`cd artifacts/api-server && npx tsc --noEmit`):**

3 pre-existing errors — none introduced by this audit:
- `routes/reports.ts` (2): `overrideReason` not in `TransitionReportBody` Zod schema
- `routes/risks.ts` (1): `locationType` not in risk input type

All errors predate this audit. No new errors introduced.

---

## Non-Blocking Follow-Ups

| ID | Item | Why Non-Blocking |
|---|---|---|
| FU-HQSR-01 | Translate HQSR form and viewer labels into Arabic | i18n explicitly deferred per audit scope |
| FU-HQSR-02 | Full WCAG 2.1 AA accessibility audit for HQSR form and viewer | Core keyboard/ARIA functionality works; deep compliance audit is enhancement work |
| FU-HQSR-03 | End-to-end browser walkthrough of complete TC→SPC→PM and SPC-fallback→PM→PM approval chains | Core workflow paths verified via API tests; browser walkthrough is a verification enhancement |
| FU-HQSR-04 | Rename the second `021_*` migration to `021b_*` or similar to resolve the numeric prefix ambiguity | Not a blocker (full names tracked, no execution collision); purely cosmetic clarity fix |
| FU-HQSR-05 | Pre-existing TypeScript errors in `api-client-react` generated types (Task #146) | Type mismatches are in generated code; tracked under existing Task #146 |

---

## Audit File

`docs/audit-reports/hq-sector-final-closure-audit.md` (this document)  
`docs/audit-reports/hq-sector-reviewer-detail-evidence-audit.md` (existing, from Task #402)

---

## Final Closure Recommendation

The HQ Sector Report module is **FUNCTIONALLY COMPLETE WITH NON-BLOCKING FOLLOW-UPS**.

The sole CORE BLOCKER (missing HQSR duplicate period enforcement) has been fixed in this audit. All authoring governance, identity integrity, location integrity, draft/revision lifecycle, submission gate, workflow chains, notification routing, reviewer completeness, supporting attachments, Drive-backed evidence, voice notes, comments, analytics integration, and direct endpoint security requirements pass verification.

**HQ Sector Report may now be marked CLOSED.**
