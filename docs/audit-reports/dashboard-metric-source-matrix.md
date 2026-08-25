# Dashboard Metric-Source Matrix

**Audit date:** 2026-08-21  
**Purpose:** This is the operational contract for the five Dashboard tabs. A
Dashboard surface may summarise a source module, but it must not redefine that
module’s lifecycle, access rules, or record viewer.

## Scope and filter contract

| Scope / filter | Contract |
| --- | --- |
| Organisation roles | See records allowed by the source module; state, sector, donor, and date filters narrow supported project-derived aggregates only. |
| Technical Coordinator | Server-side effective-sector restriction. No assigned sector is an empty result, never an organisation fallback. |
| State Office Manager | Server-side state restriction. A missing state is deny-all. |
| State Programme Officer | Server-side intersection of the assigned-project list and assigned state. No assignment is an empty result; no state is deny-all. |
| Financial data | Budget totals, spend, allocations, currency and utilisation are structurally omitted or gated for non-Budget roles. State expenditure is never inferred from a project-wide figure. |
| Date range | Project aggregates use overlap semantics: project end on/after `dateFrom` and start on/before `dateTo`. Unsupported filters are not silently applied to queues or user-owned notifications. |

## Authoritative panels

| Dashboard surface | Canonical source and lifecycle | Supported filters / scope | Empty or unavailable meaning | Canonical destination |
| --- | --- | --- | --- | --- |
| Total, active, completed projects and status distribution | `projects`, excluding soft-deleted records; statuses are the Project workflow statuses | Project aggregate filters; project/state/sector scope | `0` means no matching projects | `/projects` with the matching status where applicable |
| Beneficiary target and reached | Project beneficiary columns, not the legacy beneficiary table | Project aggregate filters and scope | `0` is a verified aggregate zero | Beneficiary breakdown dialog; project list for record work |
| Budget totals, allocated, spent, remaining, currency and utilisation | `projects`, `project_state_allocations`, and `activities.budget_spent` | Budget roles only; project aggregate filters and scope | `null` means unknown/unrecorded; zero is a verified value; mixed currencies are separate groups | `/budget` or Project Budget view |
| Active critical/open risks | `risks`; canonical likelihood × impact risk level; closed/mitigated excluded | Project/state/sector scope | `0` means none in scope | `/risks?riskLevel=critical` or `/risks` |
| Reports submitted, pending and overdue | Canonical report types/statuses plus `operationalPopulationSQL()` | Report-authorised source scope; project-derived Dashboard scopes for SPO | `0` means none; migrated duplicates/unverified rows excluded | Type-specific report list or `?open=<id>` record viewer |
| Activities planned, completed and delayed | `activities` joined to authorised projects | Project aggregate scope | `0` means no matching activities | Project activity view |
| Monthly achievement trend | No valid dated beneficiary snapshot source exists | N/A | Empty series means **unavailable**, never a zero or a fabricated curve | Static explanatory state |
| State and sector performance | `performanceEngine` and project/indicator aggregates | Scope-aware; financial percentage redacted without Budget access | `null` rate means insufficient denominator/source data | Expanded contributing project list |
| Drafts in My Scope | Authorised draft Projects, Plans, and report lists | Each source endpoint’s own scope | `0` means no drafts of that type | Project, Planning, or type-specific Report list |
| Approval Queue | Current role’s actionable Project and Report workflow state only | Authorised next-approver scope | Empty means no action available | Authorised Project/Report record |
| Projects requiring follow-up | Project drafts, returned/overdue reports, active critical risks, overdue mitigation actions; deduplicated by project | Project scope | Empty means no factual follow-up condition | `/projects` then existing record viewer |
| Calendar and reminders | Due Projects, Plans, Plan Activities, and in-scope operational Reports | Record source scope | Empty means no scheduled records | Per-item canonical link; no false mixed “View all” module link |
| Notifications | `notifications` owned by the current user | User ownership only; dashboard project filters intentionally unsupported | `0` means no unread notifications | Stored notification link |
| Donor portfolio and project financial rows | Canonical `donors` relationship plus free-text data-quality flags; real activity spend | Budget roles and project scope | Missing/unlinked donor or currency is a data-quality state, not auto-corrected | Budget Project/Donor view |

## Reconciliation rules

- **Project totals** and all project-derived KPI cards use the same scoped
  `projects` population. A different population must be labelled by its source,
  such as “draft reports” or “actionable approvals”.
- **Critical risks** use the canonical calculated risk level and the same active
  population as the Risk Register, not the legacy `severity` column alone.
- **Drafts** are generic only when Projects, Plans, and Reports are included.
- **Budget values** never combine currencies and never turn a missing value into
  zero. Financial values do not cross the Budget authorisation boundary.
- **Report KPIs and queues** exclude migration duplicates/unverified rows from
  operational aggregation and show only valid current workflow statuses.

## Remaining source-data findings

These are source-data limitations, not Dashboard defects:

1. CAFA has no dated, validated beneficiary-achievement snapshot table, so a
   truthful monthly achievement trend cannot be calculated yet.
2. State-level expenditure is not recorded. Project-level activity spend must
   remain unavailable for a state allocation basis rather than being presented
   as a state spend proxy.
3. Donor linkage, missing currency, and absent budgets remain visible as
   data-quality states and are not silently repaired by Dashboard aggregation.