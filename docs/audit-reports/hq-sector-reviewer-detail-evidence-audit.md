# HQSR Reviewer Detail & Evidence Audit

**Task:** #402 — HQSR Reviewer Detail & Evidence Completeness  
**Date:** 2026-08-17  
**Status:** COMPLETE

---

## Form → Detail Field Coverage Matrix

| Persisted Field / Section | Rendered in `HqSectorSectionsView`? | Disposition |
|---|---|---|
| `title` | No (rendered in Sheet `<SheetTitle>`) | Shown in detail header — covered |
| `sector` | No (rendered as sector `<Badge>` in Sheet header) | Shown in detail header — covered |
| `reportingMonth` / `reportingYear` | No (composed into `period` shown in metadata grid) | Covered via period metadata |
| `sections.frequency` | ✅ Yes — meta row | `freqLabel` display |
| `sections.quarter` | ✅ Yes — frequency label (e.g. "Quarterly — Q3") | Embedded in freqLabel |
| `sections.periodStart` / `periodEnd` | No (rendered in metadata grid `detail.dateRange`) | Covered via metadata grid |
| `sections.onDemandReason` | ✅ Yes — meta row | On-Demand Reason label |
| `sections.officerName` | ✅ Yes — meta row | Technical Coordinator label |
| `sections.technicalAnalysis` | ✅ Yes — analysisFields[0] | Required narrative — covered |
| `sections.keyFindings` | ✅ Yes — analysisFields[1] | Required narrative — covered |
| `sections.qualityAssessment` | ✅ Yes — analysisFields[2] | Required narrative — covered |
| `sections.technicalChallenges` | ✅ Yes — analysisFields[3] | Required narrative — covered |
| `sections.recommendations` | ✅ Yes — analysisFields[4] | Required narrative — covered |
| `sections.strategicPriorities` | ✅ Yes — analysisFields[5] | Required narrative — covered |
| `sections.lessonsLearned` | ✅ Yes — analysisFields[6] | Required narrative — covered |
| `sections.sectorOutlook` | ✅ Yes — analysisFields[7] | Required narrative — covered |
| `sections.achievementsSummary` | ✅ Yes — backward-compat alias | Legacy field display |
| `sections.sectorChallenges` | ✅ Yes — backward-compat alias | Legacy field display |
| `sections.mitigationActions` | ✅ Yes — backward-compat alias | Legacy field display |
| `sections.supportRequired` (legacy string) | ✅ Yes — backward-compat alias | Legacy single-string display |
| `sections.supportRequired` (array) | ✅ Yes — individual cards | Required; each card shows type/priority/description |
| `sections.stateObservations` | ✅ Yes — observation cards | State name, technical obs, quality concern, good practice, action required |
| `sections.technicalRatings` | ✅ Yes — rating rows with badge variants | entityType, entityLabel, rating, reason |
| `sections.risks` | ✅ Yes — risk rows with linked-risk icon | title, category, severity |
| `sections.indicatorCommentary` | ✅ Yes — commentary cards | indicatorName, commentary |
| `sections.attachments` | ❌ Removed from `HqSectorSectionsView` | Now handled exclusively by the secure download block in `reports.tsx` |

---

## HQSR-003 Required Narrative Coverage

Eight narratives required by `validateHqSectorReportForSubmission` (backend):

| Field | Required? | Visible to Reviewer? |
|---|---|---|
| `technicalAnalysis` | ✅ | ✅ Yes |
| `keyFindings` | ✅ | ✅ Yes |
| `qualityAssessment` | ✅ | ✅ Yes |
| `technicalChallenges` | ✅ | ✅ Yes |
| `recommendations` | ✅ | ✅ Yes |
| `strategicPriorities` | ✅ | ✅ Yes |
| `lessonsLearned` | ✅ | ✅ Yes |
| `sectorOutlook` | ✅ | ✅ Yes |
| `supportRequired` (≥1 item) | ✅ | ✅ Yes — individual cards |

All 8 required narratives and the support request requirement are fully visible to reviewers. **Coverage: 9/9 (100%).**

---

## Evidence Architecture

### Secure Attachment Download Block

- **Location:** `artifacts/cafa-pmis/src/pages/reports.tsx` — single `{/* Supporting Attachments */}` block
- **Guard removed:** `selected.reportType !== "hq_sector"` exclusion deleted; block now renders for all non-activity report types (project, program_state, hq_sector)
- **Attachment loading:** `useEffect` at line ~2065 already loaded for `hq_sector` (only `activity` was excluded) — no change needed
- **Download URL:** `attachmentDownloadUrl(selected.id, att.id)` → `/api/reports/${id}/attachments/${attId}/download`
- **Backend endpoint:** `GET /reports/:reportId/attachments/:attachmentId/download` — requires `reports.view` perm; calls `assertCanViewReport` (sector + state scope); streams object server-side; never exposes `objectPath` in response
- **States handled:** Loading / Error / Empty ("No supporting attachments.") / Populated
- **Metadata shown:** `att.fileName` only; accessible `aria-label="Download {filename}"` on anchor

### Legacy Attachment Block Removed

The `HqSectorSectionsView` component previously rendered a secondary attachment list from `sections.attachments` JSON data, which:
- Had no authenticated download links
- Could expose `objectPath` values embedded in persisted section JSON
- Duplicated content with the secure block

This secondary block has been **removed**. The variable `attachmentsArr` is also removed. A code comment notes that attachments are handled by the secure block in `reports.tsx`.

---

## Voice-Note Architecture

### HQSR Voice-Note Enable

- **Location:** `artifacts/cafa-pmis/src/pages/reports.tsx` — `{/* Voice Notes */}` block
- **Guard removed:** `selected.reportType !== "hq_sector"` exclusion deleted; `<VoiceNotePanel entityType="report" entityId={selected.id} readOnly />` now renders for all non-activity types
- **Mode:** `readOnly` prop set — Record, Upload, and Delete controls are suppressed by `VoiceNotePanel` logic
- **Playback:** Available via `playbackUrl` from the API response (secure stream endpoint, never raw `objectPath`)
- **Backend security:** `GET /api/voice-notes/:id/stream` calls `assertCanViewReport` (sector + state scope); `objectPath` resolved server-side only

### Reviewer Access

| Control | Reviewer (readOnly) |
|---|---|
| Playback | ✅ Available |
| Record | ❌ Absent |
| Upload | ❌ Absent |
| Delete | ❌ Absent |

---

## Access-Control Verification

### Attachment Download (`GET /reports/:id/attachments/:attId/download`)

| Actor | Access |
|---|---|
| `super_admin` | ✅ Full Operational Access (#373) |
| `programme_manager` | ✅ Full Operational Access (#373) |
| `technical_coordinator` (matching sector) | ✅ Sector-scoped access |
| `technical_coordinator` (wrong sector) | ❌ 403 sector scope |
| `technical_coordinator` (no sectors) | ❌ 403 fails closed |
| `state_program_officer` | ❌ 403 — HQSR has null `stateId` |
| `state_office_manager` | ❌ 403 — HQSR has null `stateId` |
| `viewer` | ❌ 403 insufficient permissions |

### Voice-Note Stream (`GET /api/voice-notes/:id/stream`)

Same access control as above — `assertCanViewReport` applied at stream endpoint.

### SPC Fallback Reports

SPC-authored HQSRs use the same `reportType = "hq_sector"` and `sector` field. The detail block renders identically regardless of `workflow_path`. No evidence is hidden based on author path.

---

## Gaps Fixed

1. **Supporting Attachments hidden from HQSR reviewers** — removed `!== "hq_sector"` exclusion guard  
2. **Voice Notes hidden from HQSR reviewers** — removed `!== "hq_sector"` exclusion guard  
3. **Legacy insecure attachment block in `HqSectorSectionsView`** — removed; was rendering `objectPath`-containing section JSON without authenticated download links  
4. **SPR-EVID-01 / SPR-EVID-05 test assertions** — updated to reflect that both attachment and voice-note blocks now render for all non-activity types (the old `!== "hq_sector"` assertion was stale)

---

## Intentionally Excluded Internal Fields

| Field | Reason |
|---|---|
| `sections.attachments` (raw JSON) | Replaced by secure download block; embedded metadata has no auth |
| `stateId` / `projectId` | HQSR canonical constraint — null linkage; HQSR-002/004 closed |
| `workflow_path` | Internal routing — not reviewer-visible content |
| `submitted_by_id` (raw) | Displayed as resolved name via `authorName ?? submittedByName` |

---

## Closed Contracts Preserved

| Contract | Status |
|---|---|
| **HQSR-001** Author Governance | ✅ Unchanged — author gate untouched |
| **HQSR-002** Identity Immutability | ✅ Unchanged — no identity fields changed |
| **HQSR-003** Submit Content Gate | ✅ Unchanged — validation logic untouched |
| **HQSR-004** Location Integrity | ✅ Unchanged — null state/project maintained |
| **HQSR-005** Draft/Edit/Revision | ✅ Unchanged — edit form untouched |
| **HQSR-006** Notification Routing | ✅ Unchanged — notification logic untouched |
| **SPC Fallback Workflow** | ✅ Unchanged — same detail completeness confirmed |
| **Task #373 Full Operational Access** | ✅ Preserved — `hasFullOperationalAccess` in all access checks |

---

## Remaining Non-Blocking Follow-Ups

1. **Task #403** — Update PM author-gate tests (hqsr-author-gate, pmr-author-gate, spr-author-gate) to reflect the #373 Full Operational Access grant. These are pre-existing failures unrelated to this task.
2. **Task #146** — Fix pre-existing TypeScript errors in reports, plans, and risks pages (`locationType`, `reportingFrequency`, etc.).
3. **i18n** — HQSR section title numbering in `HqSectorSectionsView` `analysisFields` has a pre-existing mismatch between locale section numbers and actual content fields (e.g. `section3Title` = "3. Beneficiary Analysis" renders `technicalAnalysis`). Deferred to i18n Phase 4.

---

## Test Evidence

### New Tests Created

| File | Tests | IDs |
|---|---|---|
| `src/test/hqsr-reviewer-detail.test.tsx` | 29 tests | HQSR-DETAIL-01..08 |
| `src/test/hqsr-evidence.test.tsx` | 28 tests | HQSR-EVID-01..08, HQSR-EVID-SEC-01..05 |
| `src/test/hqsr-voice-notes.test.tsx` | 15 tests | HQSR-VOICE-01..06 |

**Total new tests: 72**

### Updated Tests

| File | Change |
|---|---|
| `src/test/spr-submitted-detail.test.tsx` | Updated SPR-EVID-01 and SPR-EVID-05 assertions to reflect that the hq_sector exclusion guard has been removed (both blocks now render for all non-activity types) |

### Test Results

```
Test Files  3 failed (pre-existing) | 49 passed (52)
     Tests  6 failed (pre-existing) | 4105 passed (4111)
```

All 6 remaining failures are **pre-existing** (tracked as tasks #403 and #146):
- `hqsr-author-gate.test.tsx` — PM full access (task #403)
- `pmr-author-gate.test.tsx` — PM full access (task #403)  
- `spr-author-gate.test.tsx` — PM/author-set mismatch (task #403)

**Zero new test failures introduced by this task.**

---

## Closure Readiness

HQSR is **ready for Final Closure Audit**.

All acceptance criteria met:
1. ✅ Reviewer sees every HQSR-003 required narrative (9/9)
2. ✅ Support requests rendered as individual cards
3. ✅ Relevant optional structured content visible when present
4. ✅ Canonical HQ identity correct — no State/Project rendered
5. ✅ Secure attachments available; no raw storage metadata exposed
6. ✅ Voice notes playable read-only; record/delete absent
7. ✅ Evidence endpoints remain authorised; wrong-sector TC blocked
8. ✅ PM / Super Admin #373 access preserved
9. ✅ Comments preserved (generic taxonomy)
10. ✅ Approval history preserved (rendered by existing block — unchanged)
11. ✅ SPC fallback gets same detail completeness
12. ✅ No authoring regression
13. ✅ No submit-rule, identity, location, or notification changes
14. ✅ All required HQSR-DETAIL / HQSR-EVID / HQSR-VOICE / security tests pass
15. ✅ Frontend TypeScript clean for touched code (zero new errors)
16. ✅ Audit artifact committed
