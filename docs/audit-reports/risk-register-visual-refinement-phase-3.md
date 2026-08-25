# Risk Register — Visual Refinement Phase 3 Audit Report

**Date:** 2026-08-19  
**Scope:** Risk Detail read view, Comments, Attachments/Evidence, and History  
**Task:** Phase 3 visual refinement  
**Auditor:** Replit Agent

---

## Scope and boundaries

This audit covers the read-only Risk Detail sheet and the presentation of its operational tabs. It does not alter risk lifecycle rules, scoring, API contracts, database schema, access scope, comment authority, attachment authority, storage configuration, or download/deletion behaviour.

The Phase 1 register landing-page work and Phase 2 Create/Edit form work remain outside this change. The merged status-option work was reconciled before implementation; no Create/Edit form field, status option array, validation, or mutation payload was changed here.

---

## Confirmed findings and resolutions

| ID | Finding | Resolution |
|---|---|---|
| VIS-01 | Detail metadata used a permanently two-column grid | Replaced with a semantic `dl`; it is one column on narrow screens and two columns from the small breakpoint. |
| VIS-02 | Read labels used uppercase/tracking treatment | Replaced with sentence-case compact labels using `text-xs font-medium text-muted-foreground`. |
| VIS-03 | Header and detail field showed raw risk-level values | Both now use the existing readable risk-level formatter and badge variants. |
| VIS-04 | Impact depended on CSS capitalisation | Detail uses the existing semantic impact formatter. |
| VIS-05 | Long narrative values could overflow | Description and mitigation values use preserved whitespace and word wrapping. |
| VIS-06 | Tabs could be cramped on narrow screens | The tab list is enclosed in a safe horizontal overflow region. |
| VIS-07 | Comments lacked a visible query failure state and some controls were unlabelled | Added compact error/retry UI, fluid filter controls, labelled delete/type controls, British-English dates, and long-body wrapping. |
| VIS-08 | Attachment failures appeared as an empty set and filenames lacked full-value access | Failures are now distinct, rows scroll safely when needed, filenames retain their full title, and compact actions/input are labelled. |
| VIS-09 | Risk attachment “open” action could use a storage link | It now follows the existing secured download route, which retains parent-risk authorisation and does not render storage data. |
| VIS-10 | History failures appeared empty and values could be overly raw | Added error/retry UI, compact readable metadata, formatted timestamps, wrapping, and a guard against raw JSON detail output. |

---

## Detail view

- The risk title remains the primary sheet title.
- Location and linked project context appears only when available. The existing safe `[Project removed]` fallback is retained for a soft-deleted linked project.
- Status and level remain badges; category, likelihood, impact, ownership, and dates use semantic text rather than disabled controls.
- `displayRiskLevel`, `displayLikelihood`, `displayImpact`, `displayCategory`, `formatLocation`, and existing status badge behaviour are reused. No score is recalculated and no threshold changes.
- Assignee names and narrative text wrap safely; the assignee retains a full-value title where necessary.

---

## Comments

- The existing entity type, read/write permissions, role-to-comment-type allow-list, mutation endpoints, and query keys are unchanged.
- Threaded spacing, author/timestamp/body hierarchy, compact empty/loading states, and composer resizing remain functional.
- Fetch errors now display a compact retry state rather than looking like “No comments yet”.
- Icon-only delete controls and previously unlabelled type selection controls have accessible names.

---

## Attachments and evidence

- List, upload, download/open, delete, and record-level authority remain on the existing routes and parent-risk guard.
- The UI presents filename, size, uploader, date, version, and allowed actions without rendering object keys, Drive IDs, storage paths, or direct URLs.
- Long names are truncated only visually and retain the full name through `title`.
- Attachment query failures are distinct from a valid empty attachment set.
- The evidence table uses horizontal overflow rather than clipping its content.

---

## History

- Timeline actions remain driven by existing stored action values and do not change audit semantics.
- Status changes use the existing readable status display formatter.
- Actor and timestamp are compact and use the established British-English date/time formatter.
- JSON-shaped history values are not rendered as raw content; long simple values are shortened only for presentation.
- Loading, empty, and retry states are visibly distinct.

---

## Accessibility and responsive behaviour

- Detail metadata uses native `dl` / `dt` / `dd` semantics.
- The Detail, Comments, History, and Attachments tabs remain usable within a horizontally scrollable tab strip on small screens.
- Content areas use wrapping or scroll containment instead of destructive clipping.
- Attachment input and compact action controls have accessible labels.
- The Comments retry and History retry controls are visible text buttons.

---

## Task #621 reconciliation

The separate risk-status task is now merged. This Phase 3 work intentionally leaves the Create/Edit status control and the status option definition untouched. It reuses `displayStatus()` only for read-only badges and history presentation. No status transition, enum, or PATCH behaviour changed.

No `RISK-STATUS-*` implementation test file was present in the current tree at audit time, so there was no focused status suite to run. The existing Phase 2 form visual/safety suites were run as the non-overlap regression check.

---

## Functional and security safety

- No backend route, OpenAPI schema, generated API client, database migration, permission map, state/sector scope, lifecycle transition, or scoring code changed.
- Comments still use their existing risk read/write authority.
- Risk attachment download/open remains routed through `/api/drive/files/:id/download`; parent-risk checks remain server-side.
- The attachment UI does not render `driveFileId`, `driveLink`, object paths, S3 keys, or direct storage URLs in file rows.
- Existing soft-deleted project display handling is retained.

---

## Validation

| Validation | Result |
|---|---|
| `risk-detail-visual`, Phase 1 visual, Phase 2 form visual/safety, zero-residual, residual-wave-2, and contract-alignment frontend suites | **Pass — 111 assertions** |
| Risk audit, comments closure, attachment closure, and risk IDOR backend suites | **Pass — 2,304 assertions** |
| Targeted ESLint for changed frontend files | **No errors**; one existing `risks.tsx` hook dependency warning outside the changed detail sections |
| Frontend TypeScript check | **Blocked by pre-existing generated-client drift** across reports, plans, consolidated report, PMR, and existing risk list typing; no reported diagnostic points to the Phase 3 changes |
| Runtime workflow logs | Web and API workflows running; no new frontend console error |

---

## Files changed

| File | Purpose |
|---|---|
| `artifacts/cafa-pmis/src/pages/risks.tsx` | Semantic, responsive read-only detail and readable/retry history presentation |
| `artifacts/cafa-pmis/src/components/comments-panel.tsx` | Presentation, responsive controls, error/retry, and accessible comment actions |
| `artifacts/cafa-pmis/src/components/drive-attachment-panel.tsx` | Evidence row hierarchy, safe filename access, query error state, and secured file-open presentation |
| `artifacts/cafa-pmis/src/locales/en/{risks,common,reports}.json` | British-English visible labels for new UI states |
| `artifacts/cafa-pmis/src/test/risk-detail-visual.test.tsx` | RISK-DETAIL-VIS-01 through RISK-DETAIL-VIS-10 contracts |

---

RISK REGISTER VISUAL REFINEMENT — PHASE 3 COMPLETE