# PMR Module Final Closure
**Date:** 16 August 2026
**Auditing:** Tasks #321, #322, #325/#327, #326/#314 plus baseline PMR implementation
**Auditor:** Task agent (automated code audit)

## 1. Executive Verdict

**FUNCTIONALLY COMPLETE WITH NON-BLOCKING FOLLOW-UPS**

All approved contracts (BD-2, BD-3, BD-5, PMR-015 Option C, Frequency Model D) are implemented and verified by passing tests. Zero PMR core blockers remain. Follow-ups are B/C class only.

### Step 1 finding — audit document inventory

| Expected document | Present? |
|---|---|
| `pmr-final-e2e-regression-and-test-closure.md` | ❌ Missing (equivalent content exists at `.local/tasks/pmr-024-e2e-regression-test-closure.md`) |
| `pmr-analytics-integration-decision.md` | ❌ Missing (equivalent: `.local/tasks/pmr-015-analytics-integration-decision.md`) |
| `pmr-frequency-overlap-business-rule.md` | ❌ Missing (equivalent: `.local/tasks/pmr-319-frequency-overlap-decision.md`) |
| `pmr-bd5-consolidated-reporting-decision.md` | ❌ Missing (no direct equivalent found; BD-5 semantics are documented inline in `reports.ts` and covered by `pmr-bd5-consolidation-sentinel.test.ts`) |
| `project-monthly-reports-closure-matrix.md` | ✅ Present in `.local/audit-reports/` |

Finding: decision documents were written under `.local/tasks/` rather than `.local/audit-reports/`. Non-blocking; the decisions themselves are encoded in code comments and sentinel tests.

## 2. Current Architecture

- **Backend** (`artifacts/api-server/src/routes/`):
  - `reports.ts` — PMR CRUD, submit gate, workflow transitions, `GET /reports/consolidated` (BD-5 read model, line ~505)
  - `dashboard.ts` — `GET /dashboard/pmr-reporting-completeness` (line 2258, PMR-015 Phase 1)
  - `projects.ts` — `reportingFrequency` on POST (required) / PATCH (optional, presence-flag pattern)
  - `lib/pmrLocationHelper.ts` — shared single-source-of-truth for expected locations + status ranking, used by BOTH analytics endpoints
  - `lib/reportConstants.ts` — `CANONICAL_FREQUENCIES` (incl. on_demand) vs `SCHEDULED_FREQUENCIES` (excl. on_demand)
  - `lib/run-migrations.ts` — Migration 018 (project frequency), per-frequency unique indexes
- **Frontend** (`artifacts/cafa-pmis/src/`):
  - `pages/reports.tsx` — PMR form, kind default from project frequency, soft mismatch warning, `?open=<id>` deep link
  - `components/pmr-completeness-panel.tsx` — completeness panel + "View Consolidated Report" toggle
  - `components/consolidated-report-view.tsx` — BD-5 read-model renderer
  - `pages/project-detail.tsx` — frequency display ("Not Configured" for null), embeds completeness panel
  - `components/project-registration-form.tsx` — required frequency field for new projects

## 3. PMR Identity

✅ Project + Reporting Location + Frequency + Reporting Period.
- Per-frequency unique indexes in `run-migrations.ts`: `idx_reports_unique_project_monthly` (project_id, state_id, reporting_year, reporting_month, kind semantics), `_quarterly` (quarter), `_annual` (year) — lines 683–704. On-Demand PMRs sit outside the scheduled unique indexes (own identity).
- Identity immutability on PATCH: PR-SEC-PATCH-01..06 (projectId/stateId/locationType/period → 409 `project_report_identity_immutable`). Quarter immutability covered by `pmr-quarter-immutability.test.ts` (closes the PMR-002 residual from the prior closure matrix).
- Monthly + quarterly PMRs for the same period are distinct rows (kind in the identity; PMR-CONS-04 proves no mixing).

## 4. Project Scheduled Frequency

✅ All verified:
- Migration `018_project_reporting_frequency`: `ADD COLUMN IF NOT EXISTS reporting_frequency TEXT` — **no DEFAULT, no backfill** (comment states this explicitly; grep for DEFAULT matched only the "Deliberately NO DEFAULT" comment).
- CHECK constraint: `reporting_frequency IS NULL OR reporting_frequency IN ('monthly','quarterly','annual')` — **no on_demand** (grep confirms zero on_demand matches near reporting_frequency).
- POST /projects requires `reportingFrequency` ∈ SCHEDULED_FREQUENCIES → 400 `invalid_reporting_frequency` otherwise (projects.ts:339–353).
- PATCH: presence-flag pattern; absent → unchanged; null → cleared; on_demand → 400 (projects.ts:1107+). SQL uses `CASE WHEN $32::boolean THEN $33 ELSE reporting_frequency END`.
- PATCH comment + code confirm: **changing frequency never touches the reports table** (prospective only).
- GET /projects/:id returns `reportingFrequency` (null for historical projects).
- Tests: `project-reporting-frequency.test.ts` (backend) and `project-reporting-frequency.test.tsx` (frontend).

Frontend:
- Registration form: required in create mode (Zod superRefine + server 400), options Monthly/Quarterly/Annual only, helper text "On-Demand reports may still be created separately when required." — no On-Demand option.
- Project detail: renders "Not Configured" for null (project-detail.tsx:968–970) — never falsely "Monthly".

## 5. Reporting Locations

✅ `pmrLocationHelper.ts` is the single source: `project_states` rows + `projects.has_hq_operations` flag. HQ first, then states alphabetically.
- `management_level` grants nothing: COMP-05 / PMR-CONS-10 ("has_hq_operations=false → HQ NOT expected regardless of hq management"). `pmr-analytics-boundary.test.ts` guards the analytics endpoints from touching prohibited sources.

## 6. Authoring Flow

✅ Traced through reports.ts:
1. POST /reports — PMR author role gate (SPO/TC/super_admin only, PERM-02); kind required + canonical; period fields per frequency; projectId required; state-link validation (PR-LOC-SEC-01..07); HQ gate (PR-HQ-SEC-01..07); duplicate 409.
2. PATCH — identity fields immutable (409), non-identity accepted.
3. Submit — `validateProjectReportForSubmission` content gate, ROLLBACK + 422 before status change.
4. request_revision → returns to author; resubmit updates `submitted_by_id`, retains `author_id` (`pmr-submitted-by-id.test.ts`).
5. GET /reports/:id — `assertCanViewReport` (fail-closed for null-state SPO/SOM).

## 7. Draft Lifecycle

✅ Draft save/restore preserves identity (PR-SEC-PATCH suite); drafts do NOT count as submitted in completeness (COMP-10) or consolidated view (PMR-CONS-12: draft → `isMissing=true`, status returned as draft — distinguished from Not Submitted).

## 8. Submission Validation

✅ Period validation per frequency (monthly needs year+month, quarterly year+quarter, annual year); duplicate check via per-frequency unique indexes + 409 `duplicate_report_period`; kind validated against CANONICAL_FREQUENCIES; backend submit content gate active (PB-1 closed).

## 9. Review / Approval Workflow

✅ Technical → Coordination → Final chain with author-based `workflow_path` (immutable at CREATE). Self-review block: universal guard for technical_review / coordination_review / final_approve using `author_id`, **no super-admin bypass** (reports.ts:3069–3087). SOM is view-only (no transitions). SELECT FOR UPDATE in transitions.

## 10. Beneficiary Semantics

✅ BD-2 preserved. Zero valid (PMR-CONS-25: zero-beneficiary HQ PMR returns explicit zeros, location present). Consolidated view: per-location figures only, no cross-location sum (PMR-CONS-23), no `uniqueBeneficiaries`/`totalBeneficiaries` field (PMR-CONS-24). UI labels "Period Reach — {location}" (consolidated-report-view.tsx:183); grep for "Unique Beneficiaries" matches only negative-assertion tests (`pmr-beneficiary-labels.test.tsx`).

## 11. Activities / Indicators / Financials

✅ BD-3 held: no Implementation Status field in PMR or consolidated response. Activities rendered under their source location. `indicatorProgress` is per-location JSONB snapshot (`pmr-analytics-boundary.test.ts` confirms JSONB-only); project targets not multiplied by location count. Financials: `plannedBudget`/`actualExpenditure`/`currency` per-PMR; mixed currencies returned separately, never numerically combined (PMR-CONS-26).

## 12. Evidence

✅ Attachments per-report with secure download endpoint; `objectPath` stripped from listing DTO (PATH-01); voice notes scoped via `assertCanViewReport`. (Known open follow-up outside PMR closure scope: Task #199 storage-path exposure hardening remains PROPOSED.)

## 13. Reporting Completeness

✅ `GET /dashboard/pmr-reporting-completeness`:
- kind ∈ {monthly, quarterly, annual} only → **on_demand rejected 400** (COMP-22)
- Exact kind+period match, no cross-frequency satisfaction (COMP-07, COMP-19/20/21)
- Drafts excluded from submitted (COMP-10)
- Expected = project_states + has_hq_operations (COMP-01..05); HQ hidden from state-clamped users
- State role with stateId=null fails closed with empty response, no queries (COMP-14e)
- SPO: buildScope project-assignment clamp + state clamp (COMP-14, 14b, 14d); TC sector clamp, fail-closed on no sector (COMP-15, 16)
- `completenessPercent = null` when expectedLocations = 0 ✅ (both per-project and summary)
- Panel: accepts `projectReportingFrequency` prop, defaults kind to it (panel:32–40); "View Consolidated Report" toggle present (testid `pmr-comp-view-consolidated`); View links use real `reportId` (`/reports/project?open=${loc.reportId}`).

## 14. Consolidated Project View

✅ `GET /reports/consolidated`:
- Grouping key Project × Frequency × Period; `kind` required; cross-kind params → 400 (PMR-CONS-30); monthly excludes quarterly/annual/on_demand (PMR-CONS-04/05); on_demand view returns only on_demand.
- Expected locations via shared `resolveExpectedLocations` — same helper as completeness. management_level irrelevant (PMR-CONS-10).
- Per-PMR `reportId` in every location row (PMR-CONS reportId match test); **no synthetic record, no consolidated_reports table** (grep: zero matches), no consolidatedStatus (zero matches), guarded by `pmr-bd5-consolidation-sentinel.test.ts`.
- Permission: `requirePerm("reports.view")` — no new permission.
- Scope: state clamp on reports query AND expected-location resolution; stateId=null → 403 (PMR-CONS-18); SPO project-assignment → 404 no-leakage (403/404 tests at lines 278–306); TC sector via project primary sector, fail-closed (PMR-CONS-19/20); out-of-scope location existence does not leak (PMR-CONS-22, PMR-CONS-17).
- Frontend `consolidated-report-view.tsx`: HQ first then states (server ordering preserved); status badges with text labels via `locationStatusBadge` — missing = **"Not Submitted"** (not "Overdue"), draft = "Draft"; narratives under location headings (`h3` location, `h4` sections); collapsible sections with `aria-expanded` (line 127); "Period Reach" labelling.

## 15. Frequency Isolation

✅ Model D confirmed: four independent observation series. No cross-kind arithmetic anywhere (COMP-07, PMR-CONS-04/05); per-frequency unique indexes keep identities separate; project frequency change is prospective metadata only.

## 16. RBAC / Security

| Boundary | Status | Evidence |
|---|---|---|
| SPO state clamp | ✅ | COMP-14d, PMR-CONS-17, PR-LOC-SEC-07 |
| SPO project-assignment | ✅ | COMP-14/14b, consolidated 403 test line 286 |
| TC sector clamp | ✅ | COMP-15/16, PMR-CONS-19/20/21 |
| Unassigned-state fail-closed | ✅ | COMP-14e (empty), PMR-CONS-18 (403), `assertCanViewReport` fail-closed (reportAuth tests) |
| SOM view-only (no transitions) | ✅ | transition handler blocks state roles other than SPO-own-state; SOM excluded from author roles |
| Self-review block | ✅ | reports.ts:3069–3087, universal, no super-admin bypass |
| Superadmin unrestricted reads | ✅ | COMP-17 org-wide role no scope conditions |
| Consolidated location leakage | ✅ | PMR-CONS-22 |

## 17. Deep-Link Security

✅ `?open=<reportId>` (reports.tsx:1392–1420) resolves via `GET /api/reports/:id` — server-side `assertCanViewReport`; 403/404 → nothing opens. No frontend-only trust. Covered by `reports-open-param.test.tsx`.

## 18. Accessibility

✅ New UI holds Task #305 standards: consolidated view uses semantic headings (h3/h4), `aria-expanded` collapsibles, text status badges (not colour-only); frequency mismatch warning uses `role="alert"` + `aria-live="polite"`; form controls carry `aria-required`/`aria-invalid`/`aria-describedby`.

## 19. API / Type Safety

- lib/api-spec: `tsc --noEmit` → **0 errors**
- lib/api-zod: **0 errors**
- lib/api-client-react: `tsc --build` → **0 errors**; `git diff --name-only HEAD` in lib/api-client-react → **empty (no generation drift)**
- artifacts/api-server: **1 error** — `src/routes/risks.ts(154,27) TS2339 'locationType'` — **pre-existing, Task #146 scope, NOT PMR-related, NOT introduced by #321/#322/#325/#326**
- artifacts/cafa-pmis: **0 errors**

## 20. Regression Test Results

Backend: **478 passing / 0 failing / 0 skipped (total 478, 23 files)** — matches baseline.
Frontend: **3915 passing / 0 failing / 0 skipped (total 3915, 40 files)** — matches baseline.

No PMR-related failures. Zero failures anywhere.

## 21. Closure Matrix

| Area | Status | Evidence | Blocker? | Follow-Up |
|---|---|---|---|---|
| Project linkage | ✅ | PR-LOC-SEC-01..07 | N | — |
| Operational Locations | ✅ | pmrLocationHelper.ts; COMP-01..05 | N | — |
| HQ location | ✅ | PR-HQ-SEC-01..07; COMP-03/04 | N | — |
| Scheduled Frequency | ✅ | Migration 018; projects.ts:339/1107 | N | — |
| Historical Projects (null freq) | ✅ | no backfill; "Not Configured" display | N | — |
| PMR creation | ✅ | PERM-02 gate; period validation | N | — |
| Draft save/restore | ✅ | PR-SEC-PATCH-01..06 | N | — |
| Submission | ✅ | submit content gate; 422 rollback | N | — |
| Beneficiaries (Period Reach) | ✅ | PMR-CONS-23/24/25; label tests | N | — |
| Activities | ✅ | per-location; no Impl. Status | N | — |
| Indicators | ✅ | JSONB snapshot; boundary test | N | — |
| Financials | ✅ | PMR-CONS-26; per-PMR currency | N | — |
| Evidence/attachments | ✅ | PATH-01; secure endpoint | N | #199 (general) |
| Voice Notes | ✅ | assertCanViewReport scoped | N | — |
| Workflow transitions | ✅ | SELECT FOR UPDATE; status chain | N | — |
| Self-review block | ✅ | reports.ts:3069–3087 | N | — |
| Delete permission | ✅ | report-delete-permission.test.ts | N | #187/#276 (SOM live-flow) |
| Reporting Completeness | ✅ | COMP-01..22 (37 tests) | N | — |
| Consolidated View | ✅ | PMR-CONS-01..31 (52 tests) | N | — |
| Frequency isolation | ✅ | COMP-07; PMR-CONS-04/05 | N | — |
| SPO scope | ✅ | COMP-14x; PMR-CONS-17 | N | — |
| TC scope | ✅ | COMP-15/16; PMR-CONS-19/20/21 | N | — |
| Unassigned-state fail-closed | ✅ | COMP-14e; PMR-CONS-18 | N | — |
| Deep-link security | ✅ | reports.tsx:1392+; open-param tests | N | — |
| Accessibility | ✅ | aria-expanded; role=alert; headings | N | — |
| Export (row limit) | ✅ | export-row-limit.test.ts | N | — |
| API types | ✅ | 0 client errors; no drift | N | — |
| Backend tests | ✅ | 478/478 | N | — |
| Frontend tests | ✅ | 3915/3915 | N | — |
| TypeScript | ⚠️ | 1 pre-existing risks.ts error (#146) | N | #146 |

## 22. Remaining Follow-Ups

| Task | Title | Classification | Rationale |
|---|---|---|---|
| #315 | Packaged Donor Export (PDF) | **E — CANCELLED** | Task record state = CANCELLED; would otherwise be D (deferred). |
| #320 | Report wording drift guard | **E — CANCELLED** | Task record state = CANCELLED. |
| #323 | Org-wide completeness overview | **B — Recommended** | Endpoint already supports no-projectId org-wide queries; this is a UI surface, non-blocking. |
| #324 | Jump from completeness row to exact report | **E — Superseded (verify & close)** | Deep links already use `?open=<reportId>` from the panel; task likely satisfied by #326 work — verify then close. |
| #328 | Open consolidated view from project detail page | **E — Superseded (verify & close)** | Project detail already embeds `PmrCompletenessPanel` with the "View Consolidated Report" toggle. |
| #329 | Browser-render verification of consolidated view (mixed/missing/draft) | **B — Recommended** | 52 backend tests cover the contract; no frontend component render test for `consolidated-report-view.tsx` exists — a real-browser/e2e pass is worthwhile, non-blocking. |
| #330 | Historical project schedule configuration | **E — CANCELLED** | Explicitly cancelled; null frequency is a supported state. |
| #331 | Hard frequency enforcement | **E — CANCELLED** | Explicitly cancelled; soft warning is the approved behaviour (Model D). |

## 23. Core Blockers

**0 — No PMR core closure blockers remain.**

## 24. Final Recommendation

The PMR module is functionally complete: identity, frequency model, analytics (completeness + consolidated read model), RBAC boundaries, and all closed business decisions are implemented, cross-checked by the shared location helper, and protected by 478 backend + 3915 frontend passing tests including the critical PMR-CONS-16 cross-endpoint consistency invariant. Recommend closing the PMR core and moving attention to the Activity Reports verification backlog (#179, #180, #186, #194) or the org-wide completeness surface (#323) as the next module of work.
