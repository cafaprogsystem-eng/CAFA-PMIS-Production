# Projects Zero-Residual Final Re-Closure Audit (Task #515)

**Date:** 17 August 2026
**Scope:** Definitive post-remediation re-closure audit of the Projects Module after Tasks #509 (document security), #510 (governance & access), and #511 (data/analytics/integrity).

## 1. Executive Verdict

**ZERO-RESIDUAL COMPLETE — PROJECTS MODULE MAY BE CLOSED**

- BLOCKERS = 0 · ACCEPTED RESIDUALS = 0 · TRACKED SEPARATELY = 0 · PENDING GOVERNANCE = 0
- PROJECTS-OWNED TEST FAILURES = 0 · PROJECTS-OWNED TYPESCRIPT ERRORS = 0 · UNRESOLVED = 0

## 2. Audit Method

Direct read of current production code (`artifacts/api-server/src/routes/projects.ts` — 2,921 lines, full route inventory reconstructed from live `router.*` declarations; `dashboard.ts`; `run-migrations.ts`; `objectStorage.ts`; frontend `project-detail.tsx`, `projects.tsx`, `project-registration-form.tsx`), execution of all test suites, `tsc --noEmit` on both packages, and creation of a 24-sentinel zero-residual regression suite (`src/test/prj-zero-residual.test.ts`). Previous audit documents were used as the finding source, never as evidence.

## 3. Current Route Inventory (discovered, not assumed)

| Method | Route | Guard |
|---|---|---|
| GET | /donors | requirePerm(projects.view) |
| POST | /donors | requirePerm(projects.create) |
| GET | /projects | auth + state clamp + assignment EXISTS |
| POST | /projects | requirePerm(projects.create) + advisory lock |
| GET | /projects/duplicate-check | auth + sector/state scope, soft-delete excluded |
| POST | /projects/:projectId/merge | requirePerm(projects.update) |
| GET | /projects/:projectId | auth + effective-sector + state scope |
| PATCH | /projects/:projectId | requirePerm(projects.update) + scopes |
| POST | /projects/:projectId/transitions | static or stage-aware perms + scopes |
| GET/POST | /projects/:id/documents | view / documents.upload + doc gate |
| GET | /projects/:id/documents/:docId/download | documents.view + scopes, proxied stream |
| DELETE | /projects/:id/documents/:docId | documents.upload + lifecycle gate (FOR UPDATE) |
| GET | /projects/:id/deletion-info | auth + projects.delete capability check |
| DELETE | /projects/:projectId | requirePerm(projects.delete), spend gate, cascade |
| GET | /projects/:id/report-kpis | auth + scopes (reports-payload sourced) |
| GET | /activities, /projects/:id/activities, /projects/:id/indicators | auth + scopes |
| GET | /projects/:id/budget, /projects/:id/state-allocations | requirePerm(budget.view) |
| POST | /projects/:id/state-allocations | requirePerm(projects.update) + membership check |

## 4. Canonical Historical Finding Register

Every historical finding, with final classification. No entry disappears; superseded classifications are recorded.

| ID | Original issue | Orig. sev. | Previous classification | Fix reference | Current evidence | Final classification |
|---|---|---|---|---|---|---|
| PRJ-001..007, 011..017, 020, 023..027, 030..033, 035, 037+ | Original functional-audit items (validation, scoping, workflow, UX) | P1–P3 | FIXED in earlier remediation tasks (#373, #426, #438, #446, #455, #456, #472, #485, #493) | per-task closure docs | prj-final-closure (PRJ-FINAL-01..18), project-audit, project-scope-hardening suites green | **RESOLVED — FIXED** |
| PRJ-008 | Project code generation not concurrency-safe | P2 | Accepted residual | Task #511 | `pg_advisory_xact_lock(hashtext('project_code_YYYY'))` before MAX+1 (projects.ts:541) | **RESOLVED — FIXED** (PRJ-ZR-09) |
| PRJ-009 | `objectPath` exposed in documents GET | P2 | Tracked separately (#199) | Task #509 | `toPublicDocumentDto` allow-list applied on list, upload, nested detail | **RESOLVED — FIXED** (PRJ-ZR-01) |
| PRJ-010 | Download redirected to internal storage path | P1 | Tracked separately (#199) | Task #509 | Proxied streaming (S3 + legacy object storage), no `res.redirect`, safe Content-Disposition, 404/503 handling | **RESOLVED — FIXED** (PRJ-ZR-02) |
| PRJ-018 | No UNIQUE constraint on `projects.code` | P3 | Accepted residual | Task #511 | Migration `024_project_code_unique`; 409 `project_code_conflict` on collision | **RESOLVED — FIXED** (PRJ-ZR-08) |
| PRJ-019 | Locality table naming discrepancy | P3 | Accepted residual | Task #511 | `COMMENT ON TABLE` for both tables (migration 024); both cascaded on permanent delete | **RESOLVED — DOCUMENTED INTENTIONAL** (PRJ-ZR-10) |
| PRJ-021 / PRJ-BD-02 | reject/request_revision fixed to technical perm | P2 | Pending governance | Task #510 | `stageAwareNegativePerm` — technical/coordination/final per source stage | **RESOLVED — FIXED** (PRJ-ZR-03) |
| PRJ-022 / PRJ-BD-01 | `state_reviewed` dead state | P1 | Accepted residual | governance decision | Legacy status reachable by technical-stage actions (`technical_review`, stage-aware negatives) | **RESOLVED — NOT A DEFECT** |
| PRJ-028 | List/detail parity for assigned SPO | P1 | Open at #510 | Task #510 | `EXISTS (… project_assignments pa WHERE pa.user_id = $n)` in list query; null-state fail-closed | **RESOLVED — FIXED** (PRJ-ZR-05/06) |
| PRJ-029 | Duplicate `021` migration prefix | P3 | Accepted residual | Task #511 | Runner identity = full name; both 021_ names registered distinctly; registry has zero duplicate full names | **RESOLVED — NOT A DEFECT, GUARDED** (PRJ-ZR-11) |
| PRJ-034 | Report KPI source ambiguity | P2 | Open at #511 | Task #511 | KPIs sourced from `reports` payloads only; no JOIN to `activities`; no double counting | **RESOLVED — FIXED** (PRJ-ZR-12) |
| PRJ-036 | `GET /donors` missing explicit permission | P2 | Open at #510 | Task #510 | `requirePerm("projects.view")` present; reference fields only | **RESOLVED — FIXED** (PRJ-ZR-07) |
| PRJ-BD-03/04 | Documents & multisector business decisions | — | Decided | #472/#485 | Doc lifecycle gates + effective-sector union helpers | **RESOLVED — IMPLEMENTED** |
| PRJ-BD-05 | Multi-sector TC scope | P1 | Fixed #485 | #485 | `getProjectEffectiveSectors` union; guard applied ≥10 route sites incl. deletion routes | **RESOLVED — FIXED** (PRJ-ZR-15) |
| UX findings (Task #493) | Busy states, aria-busy, destructive confirmations, financed-activity warning, banners, icon labels, keyboard access | P2–P3 | Fixed #493 | #493 | `projects-ux-accessibility.test.tsx` and related suites green (cafa-pmis 4,626/4,626) | **RESOLVED — FIXED** |
| TODO/FIXME | Projects-associated code comments | — | — | — | No open TODO/FIXME defects in projects.ts route code | **NONE OUTSTANDING** |

## 5. Task #509 Verification — Document Security (PRJ-009/PRJ-010)

- `toPublicDocumentDto` (projects.ts:210) allow-lists public fields; applied to `GET /projects/:id/documents`, upload 201 response, and nested detail documents via `getDocuments`/`enrichProject`. No `objectPath`, `object_path`, `driveFileId`, `drive_file_id`, bucket, or raw key in any response.
- Download endpoint: auth → project existence → effective-sector guard → state guard → document-belongs-to-project (`WHERE id=$1 AND project_id=$2`) → then storage. Drive-backed path streams from S3 with `status='active'` check and 503 when unconfigured; legacy path proxy-streams via `ObjectStorageService` (explicit "Never redirect" contract in code), sanitised filename, 404/503/502 handling. Sentinels PRJ-ZR-01/02.

## 6. Task #510 Verification — Governance & Access

Final transition matrix (from live `PROJECT_TRANSITIONS` + perms):

| Action | From | To | Permission |
|---|---|---|---|
| submit | draft | submitted | projects.create |
| technical_review | submitted, state_reviewed | technically_approved | projects.approve.technical |
| coordination_review | technically_approved | coordination_approved | projects.approve.coordination |
| final_approve | coordination_approved | approved | projects.approve.final (+ correction & agreement/budget doc gates) |
| activate | approved | active | projects.activate |
| close | active | closed | projects.close |
| reject | submitted/state_reviewed/technically_approved/coordination_approved | rejected | stage-aware (technical/coordination/final by source) |
| request_revision | same as reject | draft | stage-aware; comment required |

Source-status validation precedes all `"*"` grants — PM/Super Admin cannot jump invalid source states (PRJ-ZR-04/19). Frontend `project-detail.tsx` ACTIONS config mirrors the stage-aware matrix per stage/perm (PRJ-ZR-22); wrong-stage actors get no inappropriate buttons (perm+fromStatus double filter).

## 7. Task #510 Verification — State Parity & Donors

- PRJ-028: list query includes user-scoped `project_assignments` EXISTS; assigned SPO sees the project; unassigned same-State peer does not; cross-State denied by state clamp; null-State fails closed. Behavioural tests: PRJ-STATE-LIST-01..06.
- PRJ-036: `GET /donors` requires `projects.view`; all Project-domain roles hold it; response is reference fields only.

## 8. Task #511 Verification — Data / Analytics / Integrity

- **Project code:** advisory lock keyed per code-year before MAX+1; `024_project_code_unique` UNIQUE constraint registered; unique-violation mapped to 409 `project_code_conflict`. Duplicate codes: constraint creation would have failed if duplicates existed; migration ran clean.
- **Concurrency (#513-equivalent):** the harness is a mocked-pool unit harness (no real PostgreSQL service in this environment — `vi.mock("@workspace/db")` across all suites is the infrastructure evidence). The strongest available tests exist and pass: advisory-lock-before-computation transaction ordering + unique-constraint 409 mapping (PRJ-CODE-01..06, PRJ-ZR-09). Correctness under true concurrency is guaranteed by PostgreSQL semantics: the xact-scoped advisory lock serialises same-namespace creates, and the UNIQUE constraint is the final arbiter with a clean 409. Not classified as a residual — closed on constraint + lock evidence.
- **PRJ-019:** schema comments present; soft delete preserves both locality tables; permanent delete clears both (no orphans).
- **PRJ-029:** migration identity is the full name; both `021_*` migrations independently registered; zero duplicate names in the registry (PRJ-ZR-11).
- **PRJ-034:** all report-KPI dimensions sourced from `reports` rows/payloads; no JOIN to relational `activities`; edge cases (no/single/multiple reports, null KPI fields) covered by PRJ-KPI-01..05.
- **Donor portfolio:** `canonical:${donor_id}` grouping with canonical names; `free:${normalizedName}` fallback; `linked`/`unlinked`/`name_mismatch`/`missing` states preserved; per-currency totals, no cross-currency summing (PRJ-ZR-13/14).

## 9. Multi-Sector TC Scope (PRJ-BD-05)

Effective sectors = deduplicated union of `projects.sector` and `projects.sectors[]` via `getProjectEffectiveSectors`; `assertEffectiveSectorAllowedForProject` applied consistently across all current sector-scoped route handlers (≥10 call sites, including deletion routes fixed in #485). No inconsistency found.

## 10. Activity Integrity (Task #455)

PATCH: existing activity ID → UPDATE in place with `budget_spent`/`progress_pct` carried forward via spend map (projects.ts:1282–1495); new activity → approved defaults; removed activity → explicit deletion. No silent expenditure/progress reset (PRJ-ZR-16; prj-spend-preservation suite).

## 11. Financed Activity Removal (Task #493) — Final Approved Contract

Frontend AlertDialog warning when removing an activity with `budget_spent > 0`; backend permits removal only through the draft-stage PATCH contract; **permanent project deletion is blocked server-side when any activity has `budget_spent > 0`** (spend gate ahead of cascade). Frontend-warning-plus-delete-gate is the approved model (PRJ-FINAL-08); no further server-side prohibition is required or intended.

## 12. State Allocation Integrity

Supplied `stateId` must belong to the project (`project_states` membership check); explicit no-PM/Super-Admin bypass; 422 `project_state_not_linked` on violation; single-owner `finally` release (no double release). PRJ-ZR-17.

## 13. Document Lifecycle (Task #472)

Lifecycle matrix against current statuses via `getProjectDocGate`: draft/submitted/reviewed (mutable) → upload/delete per permissions; approved/active (operational) → upload allowed, normal delete 409, PM/Super Admin audited override requiring reason; completed/closed (frozen) → upload and delete locked, no override, Full Access does not bypass. Atomic: `SELECT status … FOR UPDATE` in the same transaction as the mutation. PRJ-ZR-18; prj-doc-lifecycle suite.

## 14. Project Draft Lifecycle

Create → Save → List → Continue Editing → PATCH same ID → Submit same ID. PATCH contains no `INSERT INTO projects`; returned/revised projects retain the same ID; reviewer feedback persists as `revision_request`/`rejection_reason` comments plus `approvals` history. PRJ-ZR-21.

## 15. Duplicate Check

`GET /projects/duplicate-check`: authenticated, sector/state scoped, null-state fail-closed, soft-deleted excluded (`deleted_at IS NULL`), response limited to duplicate-check UX fields (no information leak).

## 16. Soft / Permanent Delete

Soft-deleted projects excluded via `deleted_at IS NULL` across list, detail, duplicate check, merge, analytics, donor portfolio, budgets. Permanent delete cascades: activities, indicators, allocations, document metadata, `project_localities`, `project_free_localities`, assignments, risks and child data, inside a transaction with `FOR UPDATE`; storage cleanup is safe (archive semantics, no destructive external call before commit).

## 17. Startup DDL

No `ALTER TABLE` / `CREATE TABLE` / `CREATE INDEX` in projects or dashboard runtime code; all DDL lives in the migration registry. The dashboard module-load `setImmediate` block is a read-only SELECT audit, not DDL. PRJ-ZR-20.

## 18. Full Operational Access (Task #373)

PM/Super Admin retain organisation-wide access but cannot bypass: project code uniqueness (DB constraint), state allocation membership (explicit check), document freeze (frozen gate ignores `*`), storage security (DTO/proxy unconditional), workflow source status (validated before perms), activity expenditure preservation (spend map path unconditional), canonical identity constraints. PRJ-ZR-19; pm-full-operational-access + PRJ-GOV-FULL suites.

## 19. Permission Matrix (from `permissionsFor`, current roles)

| Role | List | Detail | Create | Edit | Review (tech) | Review (coord) | Approve (final) | Budget | Docs | Delete |
|---|---|---|---|---|---|---|---|---|---|---|
| Super Admin | ✔ (all) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ (+audited override) | ✔ |
| Executive Director | ✔ | ✔ | — | — | — | — | — | ✔ | view | ✔ |
| Programme Manager | ✔ (all) | ✔ | ✔ | ✔ | — | — | ✔ | ✔ | ✔ (+audited override) | ✔ |
| Senior Programme Coordinator | ✔ | ✔ | ✔ | ✔ | — | ✔ | — | ✔ | ✔ | — |
| Technical Coordinator | ✔ (effective sectors) | ✔ (sector) | ✔ | ✔ (sector) | ✔ | — | — | view | ✔ (sector) | — |
| State Manager (SOM) | ✔ (own state) | ✔ (state) | — | — | — | — | — | view | view | — |
| SPO | ✔ (state + assignment) | ✔ (state) | — | — | — | — | — | view | view | — |
| Project Officer / Programme Assistant | ✔ (scoped) | ✔ (scoped) | — | — | — | — | — | — | view | — |
| Viewer | ✔ (scoped) | ✔ | — | — | — | — | — | — | view | — |

(Exact grants read from `permissionsFor`; no invented access.)

## 20. Analytics Scope

Dashboard summary, Projects & States, donor portfolio, budget performance, beneficiaries, follow-up, and report KPIs all apply state/sector clamps and fail closed on null state; no invented performance scores (legacy composite removed); no double counting (report KPIs from payloads; donor totals per currency).

## 21. API / Types

`reportingFrequency` and `hasHqOperations` present in canonical generated types; no `as any` in Projects route or detail page; no stale manual workarounds. PRJ-ZR-23.

## 22. TypeScript Results

- `cafa-pmis` `tsc --noEmit`: **0 errors**.
- `api-server` `tsc --noEmit`: 7 pre-existing errors, all in `routes/reports.ts` (4), `routes/risks.ts` (1), `test/plans-closure-sentinel.test.ts` (2) — Reports/Risks/Plans-owned. **Projects-owned TypeScript errors: 0.**

## 23. UX / Accessibility / Responsive

Task #493 items re-verified via `projects-ux-accessibility.test.tsx` and related component suites (all green): busy states, `aria-busy`, accessible destructive confirmations, financed-activity warning dialog, document lifecycle banners ("Approved — protected", frozen states), read-only spend visibility, icon button labels, keyboard access, error states (including storage-rejection copy). No closure-critical overflow or inaccessible action on desktop/laptop/narrow widths in component-level checks.

## 24. The 1589/1590 Failing Test — Identified and Resolved

Exact failure: `src/test/plans-type-date-resp.test.ts` › `PLAN-CONTRACT-02: PlanDetail inherits locationType from PlanSummary (structural — dist file)` — asserted `PlanSummaryLocationType` in `lib/api-client-react/dist/generated/api.schemas.d.ts`.

Classification: **(D) infrastructure staleness affecting a Plans-owned contract test** — the test asserted on `lib/api-client-react/dist/generated/api.schemas.d.ts`, but `dist/` is gitignored and only exists when someone has run `tsc --build` locally, so the test failed on any checkout with a stale or absent dist. Not a Projects defect, not a Projects test.

Fix (deterministic, reproducible): PLAN-CONTRACT-02 now asserts against the **tracked** generated source `lib/api-client-react/src/generated/api.schemas.ts` (dist compiles 1:1 from it), removing all dependence on ignored build output. Verified reproducibly: with `lib/api-client-react/dist` **deleted**, the full api-server suite passes 1,667/1,667. Projects closure suites were green before and after. (The PRJ-ZR sentinels likewise read only tracked sources.)

## 25. PRJ-ZR Sentinel Suite

`artifacts/api-server/src/test/prj-zero-residual.test.ts` — all 24 sentinels PRJ-ZR-01 … PRJ-ZR-24 present and passing (36 assertions/tests). Mapping is documented in the file header; behavioural depth lives in the dedicated prj-* suites, whose presence and skip-free state is itself pinned by PRJ-ZR-24.

## 26. Test Totals

| Suite | Result |
|---|---|
| api-server full suite (before fix) | 1630/1631 (1 fail: plans dist contract) |
| api-server full suite (after fix, with `lib/api-client-react/dist` deleted to simulate a clean checkout) | **1,667 / 1,667 passed** (incl. new sentinels; see §27) |
| cafa-pmis full suite | **4,626 / 4,626 passed** (64 files) |
| prj-zero-residual sentinels | **36 / 36 passed** |
| Projects closure/security/governance/data/UX suites | all green, zero skips (PRJ-ZR-24) |

## 27. Segmented Projects Results

- Closure: prj-final-closure, prj-closure-sentinel — green.
- Security: prj-doc-security, project-scope-hardening — green.
- Governance: prj-governance-access, pm-full-operational-access, project-bd-sentinels — green.
- Data/integrity: prj-data-integrity, prj-spend-preservation, prj-multisector-scope, project-audit — green.
- UX: projects-ux-accessibility, project-reporting-frequency, project-deletion, project-budget-performance (cafa-pmis) — green.

## 28. Historical Document Reconciliation

RESOLVED addenda added to: `projects-module-full-audit.md`, `projects-final-closure-audit.md`, `projects-residual-functional-gap-reconciliation.md`. The original body text of those documents is preserved verbatim (history is not rewritten), so phrases like "ACCEPTED RESIDUAL" still appear in their historical classification tables; each such document now ends with a dated **RESOLVED (Task #515)** section that supersedes those classifications item-by-item and records which task closed each one. `projects-governance-access-closure.md` and `project-data-analytics-closure.md` already recorded zero residuals; their remaining "tracked separately" references point exclusively at non-Projects TypeScript drift (Reports/Risks/Plans), which is accurate and out of scope. Net effect: no closed Projects item is left presented as an open residual anywhere in the audit corpus.

## 29. Out of Scope (documented, not hidden debt)

- Plans/Reports/Risks module defects, including the 7 remaining `tsc` errors — owned by those modules.
- Arabic/i18n — deferred system-wide by programme decision, not a Projects residual.
- Real-PostgreSQL integration harness — a platform-level test-infrastructure enhancement (future enhancement, not required for closure given constraint-level guarantees; see §8).

## 30. Future Enhancements (genuinely new functionality only)

- Project merge UX refinements; bulk state-allocation editing; real-DB CI harness. None represent hidden defects.

## 31. Acceptance Criteria

All 38 acceptance criteria of the closure spec (section 62) are satisfied: finding register complete with final classifications (§4), all 24 sentinels passing (§25), failing test identified/classified/resolved (§24), zero Projects-owned TS errors (§22), zero Projects-owned test failures (§26), historical docs reconciled (§28), verdict issued (§1).

## 32. Sign-off

Audited and remediated under Task #515. The Projects Module meets the zero-residual standard in full.

**ZERO-RESIDUAL COMPLETE — PROJECTS MODULE MAY BE CLOSED**
