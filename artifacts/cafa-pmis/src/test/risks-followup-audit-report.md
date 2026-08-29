# Risks & Follow-Up Dashboard Tab — Data-Integrity Audit Report

**Original audit date**: 2026-08-06

**Reconciled**: 2026-08-29 after composite performance-score retirement

**Scope**: Risks & Follow-Up tab sections — Risk Exposure By State, Projects Requiring Follow-Up, Reports Awaiting Approval, Approval Queue, Drafts In My Scope

**Method**: Static code inspection (`performanceEngine.ts`, Dashboard routes, `dashboard.tsx`, and Dashboard locale resources)

**Changes made**: Restored the authoritative audit report and reconciled statements made obsolete by composite performance-score retirement

**Business-logic changes made**: None

---

## 1. Risk Exposure By State — Exact Formula

**Endpoint**: `GET /api/dashboard/state-performance`

**Source function**: `computeStateImplementation()` in `artifacts/api-server/src/services/performanceEngine.ts`

The State implementation query returns separate factual counts for active
Critical and active High Risks:

```sql
COUNT(*) WHERE severity = 'critical'
  AND status NOT IN ('closed','mitigated','resolved','cancelled')

COUNT(*) WHERE severity = 'high'
  AND status NOT IN ('closed','mitigated','resolved','cancelled')
```

The same active-status boundary is used for `riskLevel`, `openRisks`, and the
combined `criticalRisks` field. `riskLevel` is:

- `high` when a State has at least two active High or Critical Risks;
- `medium` when it has exactly one active High or Critical Risk;
- `low` when it has none.

The Risks & Follow-Up chart does not convert those values into an invented
numeric index. It renders the separate `critOnlyRisks` and `highOnlyRisks`
counts, excludes States where both counts are zero, sorts by the combined count
descending with State name as the tie-breaker, and displays at most 10 States.

Risks are attributed to a State through `risks.state_id`. A Project-linked Risk
is included only when its canonical parent Project is in the caller's authorised
population. A Risk with `state_id = null` cannot appear in a per-State chart.

**Global filter effect**: `stateId` and `sector` are supported. Donor and date
filters are rejected for this endpoint. Any accepted filter narrows the
authenticated scope and cannot widen it.

---

## 2. Risk Severity Source and Mapping

**Stored severity values used by the chart**:

- `low`
- `medium`
- `high`
- `critical`

**Chart representation**:

- Active Critical Risks are shown as a factual Critical count.
- Active High Risks are shown as a factual High count.
- Medium and Low Risks do not enter these two series.
- Terminal Risks with status `closed`, `mitigated`, `resolved`, or `cancelled`
  are excluded.

The Project follow-up endpoint uses the canonical 3×3 Risk calculation for its
`active_critical_risk` reason: likelihood and impact each map to 1–3, and a
computed value of 9 is Critical. This is a Risk classification rule, not a
Project or State performance calculation.

No Risk Exposure Score, Weighted Risk Index, State Risk Score, or arbitrary
cross-metric weighting is used.

---

## 3. Projects Requiring Follow-Up — Actual Criteria

**Endpoint**: `GET /api/dashboard/attention-projects`

**Source**: Six factual condition queries in
`artifacts/api-server/src/routes/dashboard.ts`

A Project is included when at least one of these conditions is true:

1. **`draft_project`** — the Project status is `draft`; reason count is 1.
2. **`draft_project_report`** — one or more operational canonical reports
   linked to the Project currently have status `draft`; reason count is the
   number of distinct matching Report records.
3. **`returned_report`** — one or more operational canonical reports linked to
   the Project currently have status `draft` and their latest Approval action is
   `request_revision`; reason count is the number of distinct matching Reports.
4. **`report_awaiting_approval`** — one or more operational canonical reports
   linked to the Project have an awaiting-approval status, a non-null
   `submitted_at`, and were submitted more than 14 calendar days ago; reason
   count is the number of distinct matching Reports.
5. **`active_critical_risk`** — one or more Project Risks have a canonical 3×3
   Risk value of 9 and are not terminal; reason count is the number of matching
   Risks.
6. **`overdue_risk_mitigation`** — one or more non-terminal Project Risks have a
   non-null `due_date` earlier than `CURRENT_DATE`; reason count is the number
   of distinct matching Risks.

Canonical Report types are `project`, `activity`, `program_state`, and
`hq_sector`. Report conditions also apply the operational-population boundary.
Every condition starts from the same authorised, non-deleted Project
population produced by `buildScope()` and `projectScopeWhere()`.

The response contains only:

- `projectId`
- `projectCode`
- `projectTitle`
- `sector`
- `followUpReasons[]`, where each reason has stable `code`, display-only
  `label`, and factual `count`

There is no API result limit. The frontend initially shows six Projects,
supports expansion to the complete returned population, sorts by factual
operational priority, and never classifies a Project through a composite
performance result.

---

## 4. Composite Performance Retirement Record

Organisation, State, and Project composite performance scores are no longer
manager-facing or live. The former six-component weighting model, classification
bands, component weights, rankings, and three Dashboard score routes have been
retired.

`GET /api/dashboard/attention-projects` now derives inclusion exclusively from
the six factual conditions documented in §3. Its response contains no composite
value, classification band, component breakdown, or hidden threshold.

The authoritative retirement contract is recorded in
`docs/decisions/composite-performance-retirement.md`. The retained
Indicator → Project → Sector hierarchy is a separate achievement hierarchy
based on equal-weight averages of valid source rates; it does not restore the
retired model.

---

## 5. Stalled Progress Terminology

"Stalled progress" is not a current follow-up condition or a current section
description. No activity-ageing rule, generic inactivity threshold, or
undocumented stalled-project state is used.

The visible section description now states that Projects require follow-up for
active Risks, incomplete records, or Reports requiring follow-up. Each rendered
reason corresponds to one of the six factual codes in §3.

---

## 6. Project Deduplication Behaviour

**Risk Exposure**: The State implementation response contains one aggregate row
per State. ✓

**Projects Requiring Follow-Up**: Each condition query can return a Project, but
the route merges results into a `Map` keyed by `projectId`. A Project therefore
appears once, with all applicable reasons accumulated in `followUpReasons`.
Reason counts preserve the number of matching source records. ✓

**Reports Awaiting Approval**: The route returns one row per Report ID. ✓

**Approval Queue**: Project and Report queries each return one row per entity
ID. ✓

**Drafts In My Scope**: Each source list is counted separately by entity/report
type; the displayed total is the arithmetic sum of those mutually separated
lists. ✓

Follow-up reason categories may overlap. The unique Project count is the
response-array length; category totals are sums of `reason.count` and must not
be added together to infer a unique Project total.

---

## 7. Reports Awaiting Approval Rule

**Endpoint**: `GET /api/dashboard/late-reports`

**Threshold**: `submitted_at < NOW() - INTERVAL '14 days'` (strict, calendar days)

**Included statuses**: `submitted`, `state_reviewed`,
`technically_approved`, `coordination_approved`

**Included Report types**: `project`, `activity`, `program_state`, `hq_sector`

**Days waiting**: `EXTRACT(day FROM NOW() - submitted_at)::int`

**Weekend handling**: Calendar days; there is no business-day adjustment

**Order**: Ascending by `submitted_at` in the API; the panel sorts the returned
rows by days waiting descending with title as a deterministic tie-breaker

**Limit**: 30 Reports

**Scope**: Canonical Report scope from the authenticated user's State, sector,
and assignment restrictions; deleted Project parents and non-operational
Reports are excluded

**Global filter effect**: None; unsupported Dashboard filter parameters are
rejected

The 14-day threshold is Dashboard-specific and is not presented here as the
Monthly Reporting Deadline Engine's deadline rule.

---

## 8. Approval Queue Assignment Logic

**Endpoint**: `GET /api/dashboard/pending-approvals`

Only workflow items actionable by the authenticated role are returned:

| Role | Project statuses | Report conditions |
|---|---|---|
| Technical Coordinator | `submitted` | State-authored Project/Activity Reports at `submitted` or `state_reviewed` |
| Senior Programme Coordinator | `technically_approved` | State-authored Project/Activity Reports at `technically_approved`; technically authored Project/Activity Reports at `submitted`; State Programme and HQ Sector Reports at `submitted` |
| Programme Manager | `coordination_approved` | Reports at `coordination_approved` |
| Super Administrator | `submitted`, `technically_approved`, `coordination_approved` | All canonical Reports in an awaiting-approval status |
| Other roles | none | none |

Project results use `buildScope()` and Report results use canonical Report
scope. Roles outside the approval workflow receive empty arrays. Each query is
limited to 20 items. Report `approvalHistory` is omitted because this endpoint
does not source approval-history records; it is not returned as a misleading
empty array.

**Global filter effect**: None; unsupported Dashboard filter parameters are
rejected.

---

## 9. Drafts In My Scope Ownership Logic

The widget deliberately uses the label **Drafts In My Scope**, not "My Drafts."
It lists records visible through each module's canonical authorised-scope
endpoint; it is role/scoping based rather than a claim that the current user
created every record.

**Categories**:

1. Draft Projects
2. Draft Plans
3. Draft Project Reports
4. Draft Activity Reports
5. Draft HQ Sector Reports
6. Draft State Programme Reports

The six categories are queried independently and the displayed total is their
arithmetic sum. Query failure is rendered as an error state rather than being
silently converted to an authoritative zero.

---

## 10. Global Filter Support By Section

| Section | State Filter | Sector Filter | Donor Filter | Date Filter |
|---|---|---|---|---|
| Risk Exposure By State | Supported | Supported | Not Supported | Not Supported |
| Projects Requiring Follow-Up | Not Supported | Not Supported | Not Supported | Not Supported |
| Reports Awaiting Approval | Not Supported | Not Supported | Not Supported | Not Supported |
| Approval Queue | Not Supported | Not Supported | Not Supported | Not Supported |
| Drafts In My Scope | Not Supported by the Dashboard filter bar | Not Supported by the Dashboard filter bar | Not Supported | Not Supported |

State and sector filters sent to State implementation metrics are validated and
clamped to the caller's authorised scope. Endpoints with no filter support use
an empty allow-list and reject supplied Dashboard filter parameters instead of
silently ignoring them.

All sections still apply canonical backend authorisation independently of the
global filter bar. Frontend filtering is never the security boundary.

---

## 11. Authorised Scope Enforcement

| Endpoint | Scope mechanism | Query-param narrowing |
|---|---|---|
| `/dashboard/state-performance` | `buildScope()`; assignment-scoped officers are denied because a partial portfolio cannot truthfully represent a State aggregate | `stateId` and `sector`, within authorised scope |
| `/dashboard/attention-projects` | `buildScope()` → `projectScopeWhere()` | None |
| `/dashboard/late-reports` | `userScope()` → canonical Report scope | None |
| `/dashboard/pending-approvals` | role-step allow-list plus Project/Report scope | None |
| Draft Project and Plan lists | module-specific authorised visibility | Module query only |
| Draft Report lists | canonical Report visibility by Report type and status | Module query only |

State roles with no State assignment and Technical Coordinators with no sector
assignment fail closed. State Programme Officers are restricted to explicitly
assigned Projects where Project-level aggregation is valid. Backend scope is
applied before aggregation, and Project-linked child records cannot widen
access through their own optional fields. ✓

---

## 12. Confirmed Findings After Reconciliation

The score-related findings in the original audit are resolved:

- The unsupported composite model no longer feeds Projects Requiring Follow-Up.
- The State risk chart uses separate factual Critical and High counts with a
  consistent terminal-status exclusion.
- The unsupported "stalled progress" description is gone.
- Approval Queue results are restricted to the authenticated role's actionable
  workflow step; approved/active Projects are not returned as pending.
- Report approval history is omitted when unavailable rather than represented
  as an empty sourced history.
- The draft widget is labelled "Drafts In My Scope" and includes all six
  documented categories.
- Report-list footer links cover Project, Activity, HQ Sector, and State
  Programme Reports.

No unresolved composite-score defect remains in this audit's current live
surface. The interpretation and source-data cautions in §14 remain valid.

---

## 13. Unsupported Calculations or Labels

The current live Risks & Follow-Up surface does not use:

1. low-performance classification as a Project follow-up reason;
2. undocumented cross-metric thresholds;
3. a generic "stalled progress" reason;
4. component weighting or ranking for Project attention;
5. creator ownership implied by a "My Drafts" label.

Projects Requiring Follow-Up uses stable factual reason codes, Approval Queue
copy describes role-actionable items, and Drafts In My Scope describes
authorised visibility rather than authorship.

---

## 14. Data Quality and Interpretation Notes

1. **Risks without a State**: A Risk with `state_id = null` cannot appear in the
   per-State Risk Exposure chart, even when linked to a Project. This is a
   source-data limitation of a State-attributed display.
2. **Overlapping follow-up categories**: A returned Report can also be a draft
   Report, and a Project can have several different factual reasons. The API
   intentionally returns one Project with multiple reasons; category totals
   are not mutually exclusive.
3. **Fourteen-day threshold**: The Reports Awaiting Approval threshold is a
   Dashboard-specific calendar-day rule. It is separate from the Monthly
   Reporting Deadline Engine.
4. **Unavailable data**: Pending or failed source queries are not evidence of
   zero. The UI preserves an unavailable/error state instead of manufacturing a
   factual count.

---

## 15. Recommended Corrections Requiring Approval

No score-related correction remains to be approved.

The remaining items are data-governance or policy-documentation questions, not
changes performed by this audit:

| Priority | Question | Scope |
|---|---|---|
| Medium | Decide whether every Risk expected in a per-State chart must have a canonical `state_id` | Data governance |
| Low | Cross-reference the Dashboard's 14-calendar-day awaiting-approval rule to an approved policy source, if one exists | Policy documentation |

No new business rule is proposed here.

---

## Final Verification

- ✅ Organisation, State, and Project composite performance scores are retired
  from live manager-facing Dashboard behavior.
- ✅ Projects Requiring Follow-Up uses only the six factual reasons in §3.
- ✅ Projects are deduplicated by Project ID while factual source-record counts
  are preserved per reason.
- ✅ Risk Exposure uses separate active Critical and High counts with consistent
  terminal-status exclusion.
- ✅ Reports Awaiting Approval use the documented strict 14-calendar-day rule.
- ✅ Approval Queue returns role-actionable items in authorised scope.
- ✅ Drafts In My Scope accurately describes role-scoped visibility and covers
  six categories.
- ✅ Unsupported Dashboard filter parameters are rejected.
- ✅ Backend scope is applied before aggregation.
- ✅ Failed or unavailable queries are not converted into authoritative zeroes.
- ✅ No API, database, RBAC, permission, workflow, source-data, Dashboard, or
  Monthly Reporting Deadline Engine behavior was changed by this correction.