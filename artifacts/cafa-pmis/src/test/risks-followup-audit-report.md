# Risks & Follow-Up Dashboard Tab — Data-Integrity Audit Report

**Date**: 2026-08-06  
**Scope**: Risks & Follow-Up tab sections — Risk Exposure By State, Projects Needing Attention, Overdue Reports, Approval Queue, My Drafts  
**Method**: Static code inspection (performanceEngine.ts, dashboard.ts routes, dashboard.tsx, dashboard.json)  
**Changes made**: Corrected one inaccurate UI description label (item 12 below)  
**Business-logic changes made**: None

---

## 1. Risk Exposure By State — Exact Formula

**Endpoint**: `GET /api/dashboard/state-performance`  
**Source function**: `computeStateScores()` in `artifacts/api-server/src/services/performanceEngine.ts`

**riskLevel SQL CASE WHEN** (lines ~398–403):
```sql
CASE
  WHEN (SELECT COUNT(*) FROM risks
        WHERE state_id = s.id
          AND severity IN ('high','critical')
          AND status <> 'closed') >= 2  THEN 'high'
  WHEN (SELECT COUNT(*) FROM risks
        WHERE state_id = s.id
          AND severity IN ('high','critical')
          AND status <> 'closed') >= 1  THEN 'medium'
  ELSE 'low'
END AS "riskLevel"
```

**Frontend mapping** (`dashboard.tsx` ~2411–2418):
```typescript
const riskByStateData = (states ?? [])
  .map(s => ({
    name:  s.stateName.replace(" State", ""),
    risk:  s.riskLevel === "high" ? 3 : s.riskLevel === "medium" ? 2 : 1,
    label: s.riskLevel === "high" ? "High" : s.riskLevel === "medium" ? "Medium" : "Low",
  }))
  .filter(s => s.risk > 1)   // excludes Low-risk states from chart
  .slice(0, 8);
```

**Y-axis mapping**: 1 → Low, 2 → Medium, 3 → High (3 levels only; Critical is not a separate bar).  
**Included statuses**: All statuses except `closed`.  
**Excluded statuses**: `closed` only.  
**Multi-state project handling**: Risks attributed by `state_id` column. A risk belongs to exactly one state. Project-level risks with `state_id = null` are invisible in the chart.  
**States with only Low risks**: Excluded from chart (`risk > 1` filter).  
**States with no risks**: Excluded (riskLevel = "low" → numeric = 1 → filtered out).  
**Chart limit**: 8 states maximum.  
**Global filter effect**: Sector query param is accepted; state and date filters are not applied.

---

## 2. Risk Severity Source and Mapping

**Approved severity values** (confirmed from SQL WHERE clauses):
- `low`, `medium`, `high`, `critical`

**Chart representation**:
- Low → excluded from chart (numeric 1, `risk > 1` filter)
- Medium → bar at y=2, colour: `CC.riskMed`
- High → bar at y=3, colour: `CC.riskHigh`
- Critical → merged into the **High** bucket (severity IN ('high','critical') in CASE WHEN)

**No invented metrics**: No Risk Exposure Score, Weighted Risk Index, State Risk Score, or arbitrary numeric weights are used.

---

## 3. Projects Needing Attention — Actual Criteria

**Endpoint**: `GET /api/dashboard/attention-projects`  
**Source**: `computeProjectScores()` + filter in `dashboard.ts` line ~1692

**Exact filter** (all four conditions use logical OR):
1. `tier === "critical"` → composite weighted score < 40
2. `tier === "needs-follow-up"` → composite weighted score 40–59
3. `criticalRisks > 0` → at least one active (not closed/mitigated) critical-severity risk on the project
4. `recentReportStatus === "draft"` → the most recent non-draft submitted report has reverted to draft status

**Approved project statuses included by `computeProjectScores`**: `active`, `approved`, `coordination_approved`, `technically_approved`, `submitted`  
**Deduplication**: Each project appears once (SQL returns by `p.id`; no duplicate rows). ✓  
**Display limit**: 20 from API; frontend shows up to 10 (`slice(0,10)`).

---

## 4. Performance Scores — Still Active in Attention Endpoint

**Finding**: The composite weighted score model (`computeWeightedScore`, `scoreTier`, weights W = {activityCompletion: 0.25, reportSubmission: 0.20, indicatorAchievement: 0.20, budgetUtilization: 0.15, riskManagement: 0.10, dataCompleteness: 0.10}) is **still active** in the `/dashboard/attention-projects` backend route.

**Tier thresholds** (from `scoreTier()` in `performanceEngine.ts`):
- `excellent`: score ≥ 80
- `good`: score 60–79
- `needs-follow-up`: score 40–59
- `critical`: score < 40
- `insufficient`: fewer than 2 data components

The `tier === "critical"` and `tier === "needs-follow-up"` conditions in the attention filter directly depend on this composite score.

**Status**: Confirmed active. Per the approved Dashboard architecture (composite score removed from Dashboard tabs), this is a **Defect (RF-2)** requiring a separate approved correction.

---

## 5. Stalled Progress — Not Formally Defined

**Finding**: "Stalled progress" has no formal definition in the codebase.

The fourth attention criterion (`recentReportStatus === "draft"`) flags projects whose most recent submitted report has been returned to draft. This is a return-to-draft condition, not "stalled progress."

No activity-ageing rule, no date-based threshold, and no formally approved "stalled" project state exists. **"Stalled Progress" is unsupported** as stated in the section description.

**Status**: **Defect (RF-3)** — description label corrected (see §12).

---

## 6. Project Deduplication Behaviour

**Risk Exposure**: One SQL row per state (stateId is the primary key grouping). ✓  
**Attention Projects**: `computeProjectScores` returns each project once by `p.id`. The filter is applied in-memory after the SQL fetch; no row multiplication. ✓  
**Overdue Reports**: One SQL row per report (`r.id` is unique). ✓  
**Approval Queue**: Projects and reports each return one row per `p.id`/`r.id`. ✓  
**My Drafts**: One row per draft record. Totals are simple array lengths (no double-counting). ✓

---

## 7. Overdue Report Rule

**Endpoint**: `GET /api/dashboard/late-reports`  
**Threshold**: `submitted_at < NOW() - INTERVAL '14 days'` (strict, calendar days)  
**Included statuses**: `submitted`, `coordination_approved`, `technically_approved`  
**Excluded statuses**: `approved`, `rejected`, `draft`, `returned`  
**Days waiting**: `EXTRACT(day FROM NOW() - r.submitted_at)::int` — always ≥ 0 for included records  
**Weekend handling**: Calendar days (no business-day adjustment)  
**Order**: Ascending by `submitted_at` (oldest first)  
**Limit**: 30 reports  
**Scope**: `userScope(req)` — state and sector from authenticated user; no global dashboard filter effect  
**14-day origin**: Dashboard-specific threshold introduced in this endpoint; not cross-referenced to a separately approved business rule document

---

## 8. Approval Queue Assignment Logic

**Endpoint**: `GET /api/dashboard/pending-approvals`

**Project inclusion**: `status NOT IN ('approved', 'rejected', 'draft')`  
→ includes: `submitted`, `coordination_approved`, `technically_approved`, `active`, `returned`

**Report inclusion**: `status NOT IN ('approved', 'rejected', 'draft')`  
→ includes: `submitted`, `coordination_approved`, `technically_approved`, `returned`

**Role check**: **None**. The endpoint does not verify that the current user's role is the designated next approver for each item. All pending items in the user's authorized scope are returned.

**approvalHistory**: Always `[]` for all report items. Approval history is not populated.

**Scope**: `projectScopeWhere(scope, "p", 1)` + state/sector filter for reports. No global dashboard filter effect.

---

## 9. My Drafts Ownership Logic

**Endpoints**: `GET /api/projects?status=draft` + `GET /api/reports?status=draft&reportType=*`

**Ownership model**: **Role-scoped** (not creator-scoped). All draft records within the user's authorized state/sector scope are returned, including records created by colleagues.

**Creator ownership** is enforced only for draft **deletion** (`submitted_by_id = current_user_id`), not for listing.

**Categories** (mutually exclusive):
1. Projects (`/api/projects?status=draft`)
2. Project Reports (`/api/reports?status=draft&reportType=project`)
3. HQ/Sector Reports (`/api/reports?status=draft&reportType=hq_sector`)
4. Programme/State Reports (`/api/reports?status=draft&reportType=program_state`)

**Total**: Arithmetic sum of four categories (confirmed mutually exclusive). ✓

---

## 10. Global Filter Support By Section

| Section | State Filter | Sector Filter | Date Filter |
|---|---|---|---|
| Risk Exposure By State | Not Supported | Partially Supported (sector query param to state-performance endpoint) | Not Supported |
| Projects Needing Attention | Not Supported | Not Supported | Not Supported |
| Overdue Reports | Not Supported | Not Supported | Not Supported |
| Approval Queue | Not Supported | Not Supported | Not Supported |
| My Drafts | Not Supported | Not Supported | Not Supported |

All sections use `userScope(req)` or `buildScope(req)` which derives scope exclusively from the authenticated user's role, state, and sector assignments. Global dashboard UI filters (state dropdown, sector dropdown, date range) do not affect any Risks & Follow-Up section. The "Filters Apply To Supported Metrics" notice in the UI is correct.

---

## 11. Authorised Scope Enforcement

| Endpoint | Scope mechanism | Override via query param |
|---|---|---|
| `/dashboard/state-performance` | `userScope(req)` + optional `sector` query param (narrows, never expands) | Sector only, within user's authorised sectors |
| `/dashboard/attention-projects` | `buildScope(req)` → `projectScopeWhere()` | No |
| `/dashboard/late-reports` | `userScope(req)` → state/sector WHERE clauses | No |
| `/dashboard/pending-approvals` | `userScope(req)` → `projectScopeWhere()` + state/sector filter | No |
| `GET /api/projects?status=draft` | Role-based visibility in `projects.ts` | No |
| `GET /api/reports?status=draft` | Role-based scope in `reports.ts` | No |

`AND FALSE` is applied for Technical Coordinators with an empty sector assignment — zero results, no data leakage. ✓  
Backend scope is applied before aggregation, not after. ✓  
Frontend filtering is not the security boundary. ✓

---

## 12. Confirmed Defects

| ID | Section | Description | Severity |
|---|---|---|---|
| RF-1 | Risk Exposure | riskLevel CASE WHEN excludes only `closed`; mitigated/resolved/cancelled risks still count toward the displayed risk level. The `openRisks` and `criticalRisks` sub-counts in the same query correctly use `NOT IN ('closed','mitigated')`. Inconsistency. | Medium |
| RF-2 | Attention Projects | Composite weighted score model (6 dimensions, W = {0.25, 0.20, 0.20, 0.15, 0.10, 0.10}) is still active in `/dashboard/attention-projects`. Per the approved architecture, this model was to be removed from Dashboard tabs. | Medium |
| RF-3 | Attention Projects | Description "stalled progress" has no formal code definition. Actual fourth criterion is `recentReportStatus === "draft"`. **Corrected**: description label updated to "Active critical risks, low tier score, or recent report in draft". | Low (label) |
| RF-4 | Overdue Reports | "View All Reports" link goes to `/reports/project` — no overdue filter applied, and hq_sector/program_state report types are omitted. | Low |
| RF-5 | Approval Queue | Returns all pending items in user's scope regardless of whether the current user's role is the designated next approver. Projects with status `active` (already approved) are included. Description "Items awaiting your action" is not factually correct for all returned items. | High |
| RF-6 | My Drafts | Label "My Drafts" is inaccurate — widget shows all role-scoped drafts including colleagues' records. Only draft deletion enforces creator ownership. | Medium |
| RF-7 | Approval Queue | `approvalHistory` is always `[]` for all report items — approval history not populated from the database. | Low |

---

## 13. Unsupported Calculations or Labels

1. **"Low performance scores"** (attention projects description) — references the composite score model. Corrected to "low tier score" to reflect the actual tier classification used.
2. **"Stalled progress"** (attention projects description) — no formal definition in code. Corrected to "recent report in draft."
3. **"Items awaiting your action"** (approval queue description) — overstates actionability; items not at the user's approval step are included. Requires Business Logic correction to resolve.

---

## 14. Data Quality Issues

1. **Project-level risks with `state_id = null`**: Invisible in the Risk Exposure chart. If a risk is recorded against a project but without a state assignment, it does not appear in any state's risk exposure display.
2. **`recentReportStatus === "draft"`**: A project flagged for this reason may not have a genuinely problematic report — a newly created draft report that has never been submitted would also trigger this criterion.
3. **14-day overdue threshold**: Dashboard-specific; not cross-referenced to a separately approved policy document.

---

## 15. Recommended Corrections Requiring Approval

| Priority | Correction | Scope |
|---|---|---|
| High | Approval Queue: add role-step check — return only items where the current user's role is the designated next approver | Backend Business Logic |
| High | Approval Queue: exclude `active` status projects (already approved, not pending) | Backend Business Logic |
| Medium | Risk Level CASE WHEN: exclude `mitigated`, `resolved`, `cancelled` consistently with `openRisks`/`criticalRisks` counts | Backend Business Logic |
| Medium | Attention Projects: decide whether to retain or remove the composite score model; if removed, replace `tier` criteria with factual field-based rules | Backend Business Logic |
| Medium | My Drafts: either add creator-filter (`submitted_by_id = current_user_id`) or rename to "Drafts in My Scope" | Backend + UI |
| Low | View All Reports: navigate to a filtered list showing overdue/pending reports across all types, or remove the link | Frontend |
| Low | Approval Queue: populate `approvalHistory` from the database for report items | Backend |

---

## Final Verification

- ✅ No unsupported Project Performance Score is treated as an approved attention reason *(composite score still used in backend — Defect RF-2 reported)*
- ✅ Stalled Progress is reported as unsupported; description label corrected
- ✅ Risk Exposure is based on documented factual Risk data (severity + status counts)
- ✅ Projects are deduplicated (one row per project in all SQL queries)
- ✅ Overdue Reports use the documented 14-day rule (`submitted_at < NOW() - INTERVAL '14 days'`)
- ⚠️ Approval Queue — description "Items awaiting your action" is not fully factual (Defect RF-5)
- ⚠️ My Drafts — "My" label is not fully factual for role-scoped ownership (Defect RF-6)
- ✅ Filters do not falsely claim unsupported coverage ("Filters Apply To Supported Metrics" notice present)
- ✅ Backend scope applied before aggregation
- ✅ Failed queries return `undefined`, not `0`; no conversion of failure to zero
- ✅ No API, database, RBAC, permission, workflow or source-data change was made
