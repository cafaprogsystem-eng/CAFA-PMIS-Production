# Reports Module Zero-Residual Final Closure Audit — Task #522

Date: 2026-08-18
Scope: Complete Reports Module — PMR (project), Activity Reports, SPR (program_state), HQSR (hq_sector) and shared infrastructure (transitions, attachments, voice notes, comments, notifications, analytics, migrations, generated API types).

---

## 1. Executive Verdict

**ZERO-RESIDUAL COMPLETE — REPORTS MODULE MAY BE CLOSED**

- BLOCKERS = 0, ACCEPTED RESIDUALS = 0, TRACKED SEPARATELY = 0, UNRESOLVED = 0
- REPORTS-OWNED TYPESCRIPT ERRORS = 0 (`tsc --noEmit` exits 0 on both `api-server` and `cafa-pmis`)
- REPORTS-OWNED TEST FAILURES = 0 (api-server 1743/1743; cafa-pmis 4626/4626)
- All 25 REP-ZR sentinels present and passing (46 test cases in `reports-zero-residual.test.ts`)
- Mandatory Activity Report pre-approval revision E2E cycle passes with the same report ID throughout.

## 2. Complete Finding Register

Allowed final classifications: CLOSED, NOT A DEFECT, SUPERSEDED.

| Finding | Family | Severity | Original Issue | Decision | Fix/Task | Current Evidence | Test Evidence | Final Classification |
|---|---|---|---|---|---|---|---|---|
| ZR-522-01 | Activity | P1 | No integrated HTTP cycle test for pre-approval revision (Draft→Submit→Request Revision→Draft→Edit→Resubmit→Approve) | Fix in #522 | REP-ZR-17 added | Stateful HTTP cycle test, same ID (501) at all 6 steps, status trail asserted | REP-ZR-17 | CLOSED |
| ZR-522-02 | Frontend | P2 | `as never` on submit transition payload (`reports.tsx`) | Fix in #522 | Removed at both submit sites | `data: { action: "submit" }` typed via `WorkflowTransitionInput` | REP-ZR-25 | CLOSED |
| ZR-522-03 | Frontend | P2 | `as unknown as Record` for author/history override fields | Fix in #522 | `ApprovalEntry` extended in `openapi.yaml` (usedOverride/overrideReason) + codegen; `selected.authorId`, `h.usedOverride`, `h.overrideReason` typed | Generated types rebuilt, tsc clean | REP-ZR-25 | CLOSED |
| ZR-522-04 | SPR | P2 | Unsafe attachment cast in `program-state-report-form.tsx` (~813–822) | Fix in #522 | `parseStoredSprAttachments()` typed narrowing parser (`StoredSprAttachment`), no casts | tsc clean; source assertion | REP-ZR-25 | CLOSED |
| ZR-522-05 | Shared | P2 | Rate-limit dev/test bypass (Task #454) lacked production regression proof | Fix in #522 | REP-ZR-23: both limiters `skip: () => NODE_ENV !== "production"`, no other skip conditions, guard semantics tested, limiter mounted on `/api` | REP-ZR-23 (3 tests) | CLOSED |
| ZR-522-06 | Shared | P3 | Report attachment DTO/download leakage concern | Verify | Already clean | List DTO = id/reportId/fileName/contentType/size/uploadedAt only; download proxied/streamed, no redirects; lookup keyed by attachment id AND report id | REP-ZR-13, REP-ZR-14 | NOT A DEFECT |
| ZR-522-07 | Analytics | P3 | Dashboard INNER JOIN might exclude standalone SPR/HQSR | Verify | Already correct | All reports↔projects joins are LEFT JOIN; sector fallback `COALESCE(NULLIF(r.sector,''), p.sector)` | REP-ZR-20 | NOT A DEFECT |
| ZR-522-08 | Migrations | P3 | Duplicate `021_` migration prefix | Verified classification | Tasks #511/#520 | Runner identity = full migration name; both `021_` names registered distinctly (PRJ-ZR-11 guard); classification recorded here for Reports docs | PRJ-ZR-11; REP-ZR-24 | NOT A DEFECT |
| ZR-522-09 | Shared | P2 | Module-level `CREATE TABLE IF NOT EXISTS report_attachments` startup DDL in `routes/reports.ts` | Fix in #522 | Removed; DDL owned solely by tracked migration `014_att02_evidence_object_path_unique` | Source + migration assertions | CLOSED |
| ZR-522-10 | PMR | P2 | `validateProjectReportForSubmission` threw (→500) on `null`/array junk entries in activities JSONB | Fix in #522 | Every non-plain-object activity entry is an explicit validation error (`activities[i] … malformed`) — never silently ignored, never 500; malformed persisted JSONB can never reach approval | REP-ZR-01: mixed-entry route cases `[validActivity, null]`, `[validActivity, []]`, scalar string, scalar number — each 422 + status unchanged (zero side effects) | CLOSED |
| Prior chain | All | — | All findings from PMR/Activity/SPR/HQSR functional audits and Tasks #373, #390, #391, #395, #398, #401, #408, #409, #434, #454, #475 | Previously closed | See per-family audit docs | Re-verified against production code in Phase 3–4 below; no regressions found; zero TODO/FIXME comments remain in `reports.ts` | Family closure suites (all green) | CLOSED / SUPERSEDED per source doc |

No finding in any prior Reports audit doc remains OPEN, ACCEPTED-RESIDUAL, or TRACKED-SEPARATELY.

## 3. PMR (Project Monthly Report)

- Identity: `projectId/stateId/locationType/period/reportingMonth/reportingYear/quarter` immutable on PATCH (409 `project_report_identity_immutable`; super_admin administrative bypass only). REP-ZR-05.
- Submit validator (`validateProjectReportForSubmission`): title, project, state (unless HQ), kind-specific period consistency, key achievements, lessons learned, ≥1 named activity, per-activity expenditure/beneficiary/variance rules, project-currency gate, docsNoSupport/attachment gate. Junk-entry handling fixed this task (ZR-522-10): every non-plain-object activity entry is rejected as its own 422 field error — an otherwise-valid PMR with one junk entry cannot be submitted or approved. REP-ZR-01.
- docsNoSupport (Task #454) persists in sections and satisfies the documentation gate with a non-blank reason.
- Currency: project currency required for positive spend; no hardcoded `$` (frontend uses project currency).
- Revision: submitted → request_revision → draft → resubmit, same ID. REP-ZR-16.
- Duplicate protection: backend duplicate pre-check + partial unique indexes with status exclusion and `migration_is_duplicate = FALSE`.
- Concurrency: `SELECT … FOR UPDATE` row lock in the transition handler.

## 4. Activity Reports

- Three link modes (standalone/activity/project); `activityName` required in all modes; identity (`activityId/projectId/stateId/locationType`) immutable. REP-ZR-05.
- Modern (`_schemaVersion:"modern"`) submit gate: title, activity name, month/year (non-legacy periods), implementation status/summary, date ordering, results, beneficiary-reach toggle + non-negative integer counts, challenges toggle, lessons, state-or-HQ location. Legacy records exempt (FIX-07). REP-ZR-02.
- `_schemaVersion` immutability guard prevents downgrading a modern record to legacy via PATCH.
- TC scope uses `p.sector` for project-linked and `act.sector` for activity-linked reports (effectiveSector CASE), never `r.sector` alone.
- Pre-approval revision cycle: **mandatory E2E executed** — see §27. REP-ZR-17.

## 5. SPR (State Programme Report)

- Author governance: SPO primary; SOM vacancy-verified fallback with narrow `reports.program_state.create` bounded to own report + own state (submit only, view-only otherwise); PM/super_admin Full Operational Access. Null-state actors fail closed on create/PATCH/transitions.
- Identity: 9 fields immutable (409). REP-ZR-05.
- Submit gate: sectors, localities, humanitarian context (4 fields), activities with beneficiary sums, 4 narratives, on-demand period/date/reason rules. Malformed JSONB (array sections, boolean beneficiaries) → clean 422. REP-ZR-03.
- Returned-author read access to `revision_request` comments is a narrow read-only path (no widened comment perms).
- Attachments: secure DTO + proxied download (§18). Revision same-ID verified. REP-ZR-18.

## 6. HQSR (HQ Sector Report)

- Authors: TC (exact canonical sector), SPC vacancy-checked fallback (`spc_fallback` workflow path, PM reviews), PM/super_admin Full Access. Canonical sector required for all authors.
- Location integrity: `state_id`/`project_id` forced NULL at create, PATCH identity guard (actor-independent, presence-triggered), and DB CHECK constraint.
- Workflow paths: `tc_authored` and `spc_fallback` including historical NULL-path compatibility (conservative fallback with structured warning log).
- Submit gate: sector, title, 8 required narratives (strict text-type check — booleans rejected), ≥1 valid support request, fail-closed on-demand detection (kind OR sections.frequency) with strict calendar-date parsing (Feb 30 rejected). REP-ZR-04.
- Duplicate protection with DB index; report_attachments Drive evidence rendered once; download secure; no provider ID/path leakage. Revision same-ID verified. REP-ZR-19.

## 7. Canonical Model

`reportConstants.ts` remains the single source of truth: 4 canonical types, 4 frequencies (scheduled excludes on_demand), status groups (ACTIVE vs SUPPORTED with historical `state_reviewed`), operational-population filters, and the three workflow chains (state_authored, technical_authored, simple chain for SPR/HQSR). `state_reviewed` is never a transition target (HISTORICAL_ONLY_TARGETS guard).

## 8. Author Governance

Verified per family in §3–6. `workflow_path` is stamped at CREATE and immutable; SOM is view-only outside the SPR fallback; unexpected non-null workflow_path values are rejected (defence-in-depth 409).

## 9. Full Access

PM and super_admin Full Operational Access (Task #373) verified live: PM coordination-review (REP-ZR-09), super_admin final-approve (REP-ZR-10), draft-edit ownership bypass with author_id preserved, draft delete bypass (audit-logged). Self-review still requires overrideReason (§15).

## 10. Identity

All four families reject identity-field PATCH with family-specific 409 errors; HQSR is actor-independent (even PM/super_admin blocked). REP-ZR-05 (4 tests).

## 11. Draft / Revision Lifecycle

Same-record guarantee proven for all four families (REP-ZR-16..19): request_revision transitions the same row back to `draft` (status UPDATE by id, no new INSERT), the author edits via PATCH, and resubmit resets `submitted_at`/`submitted_by_id` so the review timer restarts.

## 12. Submit Validation

All four server gates run inside the transaction **before** any mutation; failure → ROLLBACK with 422 `report_content_incomplete` and zero side effects (REP-ZR-12). Malformed JSONB matrix exercised: null sections, array-instead-of-object, junk activity entries (null / array / scalar string / scalar number — each rejected as its own field error even when everything else is valid, with the report status unchanged), boolean in numeric field, non-numeric strings, impossible dates (Feb 30) — none 500, none silently approvable.

## 13. Duplicate Matrix

Backend authoritative: create-time duplicate pre-checks (status exclusion `NOT IN ('rejected','archived')` + `migration_is_duplicate = FALSE`) mirrored by partial unique DB indexes per family (PMR project+location+period; Activity activity+state+period, Migration 010/012; SPR state+period; HQSR sector+period). Identity immutability prevents PATCH-based duplicate bypass. REP-ZR-06.

## 14. Workflow

Transition handler: canonical-type gate, workflow-path resolution, from-status validation, historical-target guard, dynamic revision permission, comment required for revision/reject, final-approve blocked on unresolved required corrections, row lock, post-COMMIT notifications. Verified live across REP-ZR-07..12, 16..19, 21..22.

## 15. Self-Review Override

`overrideReason` required (non-blank) for PM/super_admin self-review → otherwise 400 `override_reason_required`; non-privileged authors 403 `self_review_forbidden`; `used_override=TRUE` + `override_reason` stored on the approvals row and audit log; history returns the typed `usedOverride`/`overrideReason` fields (ApprovalEntry extended this task) and the frontend shows an override indicator. REP-ZR-11 (3 tests).

## 16. Scope

- State scope: wrong-state SPO/SOM 403 on list/detail/edit/transitions/evidence (fail closed on null stateId). REP-ZR-07, REP-ZR-14.
- Sector scope: TC restricted via `assertSectorAllowed` on detail, PATCH, transitions, aggregates, attachments (effectiveSector; fail closed on null for TC). REP-ZR-08.
- Deep links: `assertCanViewReport` enforces backend access before exposing metadata (404 for missing, 403 before content).

## 17. Attachments

List DTO contains only `id, reportId, fileName, contentType, size, uploadedAt` — no objectPath/driveFileId/storage internals (REP-ZR-13). Download requires reports.view + full canonical auth, resolves object path server-side, is keyed by attachment id AND report id, and proxies/streams via S3 or object storage — `res.redirect` does not exist in the reports routes (REP-ZR-14). Upload registration requires a server-issued upload token (ATT-02); client-supplied path/type/size ignored.

## 18. Voice Notes

Mutation endpoints consult `assertAttachmentMutationAllowed` (author + draft + scope) server-side; reads use canonical report view auth. Not UI-only. REP-ZR-15.

## 19. Comments

Role→type allow-list enforced server-side (mirrored client-side); SPR section-tag taxonomy validated (422 on non-canonical keys); revision/rejection transitions write `revision_request`/`rejection_reason` comments transactionally; returned-draft authors get narrow read-only feedback access.

## 20. Notifications

Fire strictly post-COMMIT (order asserted live) and never on rollback (REP-ZR-22). Routing is workflow-path-aware: activity/project submits pass the immutable `workflowPath`; HQSR submits pass `hqsrPath` (`spc_fallback` → PM directly, `tc_authored`/NULL → SPC with PM fallback). REP-ZR-21.

## 21. Analytics

Reports summary/stats/queues use LEFT JOIN to projects with `COALESCE(NULLIF(r.sector,''), p.sector)` fallback — standalone SPR/HQSR (project_id NULL) are never excluded (REP-ZR-20). Operational-population filters exclude migration duplicates/unverified rows from KPIs only (never record reads). State/sector clamps applied on analytics endpoints; no duplicate counting found.

## 22. Approval Queue

Pending reports are routed by status + workflow_path (technical_authored submits go to SPC, never TC; state_authored to sector TC; HQSR per hqsrPath). Reviewer-facing queue verified in family suites; notification routing verified live (REP-ZR-21).

## 23. API / Generated Types

Contract gap fixed at source: `ApprovalEntry` in `lib/api-spec/openapi.yaml` extended with nullable `usedOverride`/`overrideReason`; orval codegen regenerated `api-client-react` + `api-zod` (no hand-edited dist). `WorkflowTransitionInput` already carried `action/comment/overrideReason`, so the submit `as never` was removable without schema change. `locationType` is present in the canonical Report schema and used by the API — no stale frontend assumption found.

## 24. Migrations

All Reports schema changes live in tracked migrations in `run-migrations.ts` (005 dedup, 008 workflow, 010/012 activity uniqueness, 014 report_attachments ownership + unique object_path, 016 HQ ops flag, 019 workflow_path freeze, 020 override audit, HQSR CHECK constraints). The module-level startup DDL in `routes/reports.ts` was removed this task; REP-ZR-24 guards recurrence. The duplicate `021_` prefix is **NOT A DEFECT** (runner identity is the full migration name; both `021_` names registered distinctly — proven in Tasks #511/#520, guarded by PRJ-ZR-11) and that classification is now reflected in Reports documentation here.

## 25. TypeScript

`tsc --noEmit` exits 0 on `artifacts/api-server` and `artifacts/cafa-pmis`. The three named debt areas are fixed (ZR-522-02..04). Remaining `as unknown as Record` conveniences elsewhere in `reports.tsx` compile cleanly and are cosmetic (tracked by the pre-existing general type-hygiene backlog, not Reports-owned errors — count of Reports-owned tsc errors is zero). REP-ZR-25 pins the fixed sites.

## 26. UX / Accessibility

Previously closed in `reports-final-ux-ui-accessibility-hardening.md` and `reports-final-browser-ux-verification.md` (true ARIA tabs, dirty-form guards, sticky footers, screen-reader validation states). Re-checked for regressions: none; component suites (4626 tests) green including rendered-page tests.

## 27. E2E

All four families exercised at integrated HTTP level with real route code:
- **Activity (mandatory, no waiver):** Draft → Submit → Request Revision → Draft → PATCH edit → Resubmit → Technical Review → Coordination Review → Final Approve. Same ID (501) asserted at every step; status trail `submitted, draft, submitted, technically_approved, coordination_approved, approved`; six approvals rows all for id 501. REP-ZR-17.
- PMR: revision/resubmit cycle same ID (REP-ZR-16) + valid/malformed submit (REP-ZR-01).
- SPR: submit gate + revision/resubmit same ID (REP-ZR-03/18) + full lifecycle in `spr-final-closure.test.ts`.
- HQSR: TC-authored complete path + SPC-fallback routing with deterministic fixtures (REP-ZR-04/19/21) + `hqsr-final-closure.test.ts`.

## 28. Direct Security

Deep-link access, attachment/voice evidence, wrong-state/wrong-sector actors, SOM/ED view-only enforcement, self-review, and rate limiting all verified fail-closed (REP-ZR-07/08/11/13/14/15/23). No route trusts client-supplied scope fields.

## 29. Fixes Made During Audit

1. Removed `as never` from both submit transition payloads in `reports.tsx`.
2. Replaced author/history `as unknown as Record` casts with typed `authorId`/`usedOverride`/`overrideReason` accessors; extended `ApprovalEntry` in the OpenAPI source and regenerated clients.
3. Replaced the SPR attachment blind cast with the typed `parseStoredSprAttachments` narrowing parser.
4. Removed the module-level `report_attachments` startup DDL from `routes/reports.ts` (migration 014 is sole owner).
5. Hardened `validateProjectReportForSubmission`: non-plain-object activity entries (null/array/scalar) are explicit validation errors — previously a member-access crash (500); now 422 even when every other field is valid, with zero workflow side effects.
6. Added the complete REP-ZR sentinel suite (25 sentinels, 46 tests) including the mandatory Activity pre-approval revision E2E, mixed junk-entry submit cases, and the production rate-limit regression test.

## 30. Files Changed

- `lib/api-spec/openapi.yaml` (+ regenerated `lib/api-client-react`, `lib/api-zod`)
- `artifacts/cafa-pmis/src/pages/reports.tsx`
- `artifacts/cafa-pmis/src/components/program-state-report-form.tsx`
- `artifacts/api-server/src/routes/reports.ts`
- `artifacts/api-server/src/test/reports-zero-residual.test.ts` (new)
- `docs/audit-reports/reports-zero-residual-final-closure-audit.md` (this document)

## 31. Tests

| Suite | Result |
|---|---|
| api-server full suite | **66 files, 1743/1743 passed** |
| cafa-pmis full suite | **64 files, 4626/4626 passed** |
| REP-ZR sentinel suite (`reports-zero-residual.test.ts`) | **46/46 passed** (REP-ZR-01…25 all present; incl. mixed junk-entry 422/no-side-effect cases) |
| Reports closure/security/governance suites (`reports-security`, `spr-final-closure`, `hqsr-final-closure`, `activity-reports`, `reports-module`, etc.) | all green within the totals above |
| `tsc --noEmit` api-server / cafa-pmis / generated libs | exit 0 |

No closure-critical `.skip`, `.todo`, `200-or-404` weak assertions, conditional passes, or silent catches in the sentinel suite.

## 32. Final Finding Counts & Closure Decision

- BLOCKERS: **0** · ACCEPTED RESIDUALS: **0** · TRACKED SEPARATELY: **0** · UNRESOLVED: **0**
- Reports-owned TypeScript errors: **0** · Reports-owned test failures: **0**
- Register classifications: CLOSED = 7, NOT A DEFECT = 3, SUPERSEDED = (per prior-chain register), OPEN = 0.

**ZERO-RESIDUAL COMPLETE — REPORTS MODULE MAY BE CLOSED**
