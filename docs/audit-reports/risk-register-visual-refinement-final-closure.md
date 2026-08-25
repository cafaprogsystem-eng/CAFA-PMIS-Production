# Risk Register — Final Visual Closure Audit

**Date:** 19 August 2026  
**Scope:** Final cross-phase reconciliation of the Risk Register module only  
**Verdict:** **VISUAL CLOSURE COMPLETE — RISK REGISTER MODULE**

---

## 1. Scope and protection boundary

This is a final reconciliation audit after the Register, Create/Edit, Detail,
Comments, Evidence, History, status-parity, and functional zero-residual
work. It is not a new visual-design phase.

No backend route, database schema, migration, OpenAPI document, generated
client, permission, role gate, scope rule, scoring rule, lifecycle rule,
validation rule, notification rule, attachment-storage boundary, or
permanent-delete behaviour was changed.

The only product presentation correction in this closure was a confirmed
Register Category-filter residual: it now uses the established semantic
category formatter rather than rendering the raw enum through CSS
capitalisation.

---

## 2. Current-HEAD reconciliation

| Prior closure artefact | Claim reconciled against current HEAD | Current result |
|---|---|---|
| Phase 1 visual refinement | Compact Register rhythm, server summaries, fluid filters, accessible pagination/rows, contextual empty and loading states | **CLOSED** — retained and covered by RISK-VIS and final sentinels |
| Phase 2 form refinement | Responsive Create/Edit forms, labelled controls, compact headings, loading skeleton, null-clear behaviour | **CLOSED** — retained and covered by RISK-FORM-VIS, RISK-FORM-SAFE and final sentinels |
| Status option-set closure | Create remains server-owned `open`; Edit exposes all nine direct values with no transition filtering | **CLOSED** — retained and covered by RISK-STATUS and final sentinels |
| Phase 3 visual refinement | Semantic Detail, readable values, long-content protection, usable Comments/Evidence/History states, secure attachment presentation | **CLOSED** — retained and covered by RISK-DETAIL-VIS and final sentinels |
| Functional zero-residual closure | URL state, limit-50 paging, keyboard rows, scoring, reference/date, comment/attachment/IDOR and delete safety | **CLOSED** — unchanged and covered by existing frontend and backend Risk regression suites |

The merged current tree contains the shared nine-status formatter and status
options, semantic Detail view, secured evidence download route, comments
authorisation wiring, server-envelope Register summaries, URL-state pagination,
and the current final test suite simultaneously. No historical closure claim
was relied upon without current-source and regression evidence.

---

## 3. Surface audit

### Register

- The Register maintains the compact page rhythm, hierarchy, four server-backed
  KPI summaries, fluid filter controls, bounded risk-title display, horizontal
  table containment, and compact contextual loading and empty states.
- The server remains the source of totals and summary counts. Page state remains
  URL-shareable, filters reset the page atomically, stale pages recover to page
  one, and the list limit remains 50.
- Rows remain discoverable and operable by keyboard using explicit interactive
  semantics and localised accessible names.
- **Closed residual:** the Category filter had been the last raw-enum
  presentation path, using CSS `capitalize`. It now uses `displayCategory()`,
  consistent with the table and Create/Edit controls.

### Create and Edit

- Create remains a responsive, labelled three-section dialog with no editable
  status field; the server-owned create status remains `open`.
- Edit retains all nine supported direct statuses, including reopening from
  `closed` and `mitigated`. No status-display label is mapped back into the
  PATCH payload and no transition filtering has been introduced.
- The populated Edit skeleton, ordered secondary/primary actions, inline
  reference feedback, date-only input, and explicit `null` semantics for
  clearing assignee and due date remain intact.

### Detail

- Detail remains semantic read-only content using a definition list rather than
  disabled inputs. It retains safe location and soft-deleted-project context
  fallbacks.
- Category, likelihood, impact, risk level, and status are displayed through
  readable formatters or badges rather than raw storage enums.
- Narrative values, names, and values in the history timeline wrap safely;
  tabs and evidence tables use horizontal containment on narrow viewports.

### Comments, Evidence, and History

- Comments retain their compact hierarchy, long-body wrapping, British-English
  timestamps, distinct loading/error/empty treatments, and accessible compact
  controls. RISK-001 authorisation remains unchanged.
- Evidence retains distinct error and empty states, accessible filenames and
  action controls, responsive table containment, and secured download/open
  behaviour. The UI does not display object paths, Drive identifiers, S3 keys,
  or raw storage URLs. RISK-004 storage and parent-record authorisation remain
  unchanged.
- History retains formatted timestamps, readable status changes, safe handling
  of JSON-shaped values, compact error/retry content, and word wrapping.

---

## 4. Typography, enum, state, responsiveness, and accessibility sweep

| Area | Result |
|---|---|
| Large vertical rhythm | **NOT A DEFECT** — the Register uses the established compact `space-y-4` rhythm; related Detail and form spacing is contextual rather than excessive. |
| Uppercase/tracking metadata labels | **CLOSED** — Detail metadata uses sentence-case, compact `font-medium` labels; no remaining Risk-owned uppercase/tracking-wide detail labels were found. |
| Raw enum rendering | **CLOSED** — all risk-level, status, likelihood, impact, and category presentation paths use readable formatters. The final Category-filter residual was fixed. |
| Long content | **CLOSED** — risk narratives, comment bodies, timeline values, assignee names, tabs, evidence tables, and attachment names wrap or contain overflow safely. |
| Icon-only controls | **CLOSED** — Risk-owned comment and evidence actions retain accessible names. |
| Loading, empty, and error states | **CLOSED** — Register, Edit, Comments, Evidence, and History distinguish loading, valid empty, filtered empty, and query-failure states. |
| Responsive behaviour | **CLOSED** — form grids collapse at the small breakpoint; tabs and evidence tables contain horizontal overflow; compact controls wrap. |
| Browser verification availability | **EXTERNAL BASELINE** — `/risks` correctly redirected to sign-in because no authorised browser session was available. The sign-in boundary rendered cleanly; browser console output contained only expected 401 authentication requests and no crash. |

---

## 5. Final sentinels

`artifacts/cafa-pmis/src/test/risk-final-visual-closure.test.ts` adds
RISK-FINAL-VIS-01 through RISK-FINAL-VIS-12:

| Sentinel | Coverage | Result |
|---|---|---|
| RISK-FINAL-VIS-01 | Register semantic baseline | Pass |
| RISK-FINAL-VIS-02 | Pagination, limit, URL state, and stale-page recovery | Pass |
| RISK-FINAL-VIS-03 | Keyboard-operable Register rows | Pass |
| RISK-FINAL-VIS-04 | Responsive Create baseline and create-as-open | Pass |
| RISK-FINAL-VIS-05 | Nine-status Edit parity without filtering | Pass |
| RISK-FINAL-VIS-06 | Explicit null-clear semantics | Pass |
| RISK-FINAL-VIS-07 | Semantic Detail and safe context/content handling | Pass |
| RISK-FINAL-VIS-08 | Module-wide enum safety | Pass |
| RISK-FINAL-VIS-09 | Comments presentation and authorisation protection | Pass |
| RISK-FINAL-VIS-10 | Evidence presentation and secured-storage boundary | Pass |
| RISK-FINAL-VIS-11 | History, long-content, and responsive protection | Pass |
| RISK-FINAL-VIS-12 | Functional, API, and security boundary preservation | Pass |

---

## 6. Regression matrix

| Validation | Result |
|---|---|
| Final sentinels, Phase 1/2/3 visual suites, form-safety, status, pagination, zero-residual, residual-integrity, and frontend contract suites | **Pass — 10 files, 167 assertions** |
| Risk audit, comments, attachments, IDOR, pagination API, project-delete, reference/date, residual-integrity, and backend contract suites | **Pass — 9 files, 261 assertions** |
| Frontend production build | **Pass** — Vite build completed successfully |
| Runtime workflows | **Pass** — web and API workflows running cleanly after web restart |
| Browser console / sign-in boundary | **NOT A DEFECT** — clean sign-in rendering; expected protected-route 401 calls only |
| Targeted lint | **EXTERNAL BASELINE** — one existing `react-hooks/exhaustive-deps` warning in the pre-existing Register pagination effect; no errors and no warning introduced by this closure |

---

## 7. TypeScript baseline classification

Frontend and API TypeScript checks remain blocked by existing generated-client
and API-schema drift. These failures pre-date this visual closure, are outside
the changed lines and files, and overlap the separately tracked project work to
restore type-check confidence.

| Check | Result | Classification |
|---|---|---|
| `@workspace/cafa-pmis` typecheck | Fails with existing generated-client shape drift (`Risk[]` versus paginated envelope), nullable PATCH-contract mismatch, and unrelated consolidated-report, plan, PMR, and reports diagnostics | **EXTERNAL BASELINE** |
| `@workspace/api-server` typecheck | Fails with existing `locationType` omission from `CreateRiskBody`, report override-reason drift, and plans test mock inference diagnostics | **EXTERNAL BASELINE** |
| Risk visual closure changes | No TypeScript diagnostics arise from the final Category formatter correction, stale translation fixture update, or final sentinel suite | **CLOSED** |

No generated client, OpenAPI, schema, route, or functional workaround was
changed to make these unrelated baselines appear green.

---

## 8. Finding and residual register

| Finding | Classification | Resolution / evidence |
|---|---|---|
| Register Category filter rendered its enum through CSS capitalisation | **CLOSED** | Uses the established `displayCategory()` formatter; protected by RISK-FINAL-VIS-08. |
| Phase 3 status-display test mock lacked labels added by nine-status localisation | **NOT A DEFECT** | Product localisation was already correct; the stale test fixture now represents the canonical status set. |
| Existing pagination hook dependency lint warning | **EXTERNAL BASELINE** | Pre-existing warning in unchanged pagination logic; outside this visual-only audit. |
| Generated-client/API TypeScript drift, including existing Risk diagnostics | **EXTERNAL BASELINE** | Documented above; no causal relationship to this closure and no visual fix applied. |
| Functional follow-up required | **FUNCTIONAL FOLLOW-UP** | None discovered. |

**Residual Register: NONE.**

---

## 9. Closure verdict

All confirmed Risk-owned visual findings are closed. The Register, Create,
Detail, Edit, Comments, Evidence, and History surfaces form a coherent visual
journey while preserving status parity and all functional, permission, scope,
scoring, comment-authorisation, and attachment-security contracts.

**VISUAL CLOSURE COMPLETE — RISK REGISTER MODULE**

No Phase 4 or further cosmetic Risk task has been started.