---
name: Donor Portfolio table architecture
description: Design decisions for the redesigned Donor Portfolio section in the Budget & Donors dashboard tab, including access rules and financial-display rules.
---

## Rule
The `/dashboard/donor-portfolio` server route uses a **single flat SQL JOIN** (projects + donors) and groups in TypeScript — not in SQL — to handle canonical-vs-free-text mismatch detection and project deduplication cleanly.

**Why:** `array_agg(DISTINCT ...)` with ORDER BY is unsupported in PostgreSQL; TypeScript grouping also makes the mismatch classification logic explicit and testable without a live database.

## How to apply
- Server: one `scopeParams` invocation (not `[...sp, ...sp, ...sp]`); group by `canonical:${donor_id}` or `free:${normalised_free_text}` or `missing:${project_id}`.
- Response fields: new canonical fields (`donorId`, `donorName`, `freeTextDonorName`, `dataStatus`, `dataIssues`, `projectCount`, `projectList`, `allocatedBudget`) PLUS legacy fields (`donor`, `projects`, `budgetTotal`, `budgetSpent`, `beneficiaries`) for backward compat.
- `budgetByCurrency` items now have `allocatedBudget` as alias for `budgetTotal`.

## Frontend
- `DonorPortfolioTable` is a **module-scope** React component (with hooks) — never defined inside Dashboard.
- Sub-components also at module scope: `DonorStatusBadge`, `DonorAllocationBar`, `DonorPortfolioSkeleton`.
- `SortableCol` type in dashboard.tsx must include `"donorName" | "dataStatus" | "projectCount" | "allocatedBudget" | "portfolioShare"` — the `SortableTableHeader` component is shared with the State table and has a typed `column` prop.
- `SortableTableHeader` now accepts an optional `className` prop (for width/alignment overrides); must be used **directly** inside `<TableRow>` — never wrapped in `<TableHead>` (that creates nested `<th>` = invalid HTML).
- `fmtUsdCompact` was removed (was only used by the old bar chart).
- All currency selector, sort, search, status-filter state lives inside `DonorPortfolioTable` (not in Dashboard).
- Portfolio share computed on frontend from selected-currency total: `budget / total * 100`, null when total = 0.
- Numeric sort (allocatedBudget, portfolioShare) uses **null-last** logic regardless of direction; tie-break always donor name ascending.
- `/projects?donor_id=…` link was removed — Projects page only reads status/sector/stateId from URL; `donor_id` param is silently ignored. Action column uses expand/collapse for all donors.

## Access rules — approved roles (CAFA PMIS spec)
Both Budget tab and Donor Portfolio share the same 6-role approved gate:
- `super_admin`, `executive_director` — org-wide scope
- `program_manager`, `senior_program_coordinator` — org-wide scope
- `technical_coordinator` — sector-scoped via `tcSectorRestriction`
- `state_program_officer` — state-scoped via `stateId`

**Explicitly excluded** (authentication alone ≠ access):
- `state_office_manager` — state role, but NO approved Budget & Donors permission
- `state_manager`, `viewer`, `project_officer`, `program_assistant`, all others

Frontend: `canViewBudgetAndDonors(role)` module-scope helper (Set-based, mirrors backend).  
**Do NOT use** `isStrategic || isOperational || isState` — those broad groups incorrectly include `state_office_manager`.

Backend: `BUDGET_DONORS_ROLES` Set + `requireBudgetDonorsRole(req, res)` helper applied at the TOP of each handler, BEFORE `userScope()`. Both layers required:
- Role check = module access
- `userScope()` = record-level restriction

Applied to: `/dashboard/donor-portfolio`, `/dashboard/beneficiaries`.

## Fail-closed scope rules
TC without assigned Sectors → 403 backend, config message frontend (no org-wide fallback).  
SPO without assigned State → 403 backend, config message frontend (no org-wide fallback).

Frontend booleans: `tcMissingScope = isTc && !(userSectors?.length)`, `spoMissingScope = role === "state_program_officer" && !spoStateId`.

React hooks: `useGetDonorPortfolio` and `useGetBeneficiariesBreakdown` pass `{ query: { queryKey: getGetXxxQueryKey(), enabled: canViewBudgetAndDonors(role) } }` to prevent API calls for unapproved roles.

**Why:** Spec requires both layers. `requireBudgetDonorsRole` without `userScope()` would expose org-wide data to TC/SPO; `userScope()` without the role check would expose financial data to viewer/SOM etc.

## Financial display labels — scope-aware text
Budget tab `SectionHeader` description and card notes vary by role to avoid implying org-wide data for scoped users:
- State users → `"Project-level financial values for Projects operating in your authorised State."`
- TC → `"Project-level financial information for Projects within your authorised Sector scope."`
- All others → standard text
- Allocated Budget card **heading** for state users: `"Project-Level Budget"` (not `"Allocated Budget"`)
- Allocated Budget card **note** for state users: explains no State-level allocation; never says "State Budget"
- Donor Portfolio `description` prop: also role-aware (state/TC get scoped description)

**Why:** For state officers and TC, the `budgetTotal` field is a project-level aggregate, not an approved State or Sector allocation. Labelling it "Total approved Programme Budget" would be misleading.

**SPO budget display rule (project level):**
- If `project_state_allocations` has a row for the SPO's stateId → show that amount, label "State Allocation"
- Otherwise → show full `project.budgetTotal`, label "Project-Level Budget"
- Never divide the project budget proportionally between States
- Never invent a State-specific percentage

## Test file
`artifacts/cafa-pmis/src/test/donor-portfolio-table.test.tsx` — 7 describe sections (§A–§G):
- §A permission rules (all 8 roles, including new PM/SC/TC/state approval)
- §B backend auth
- §C grouping logic
- §D sort/filter helpers
- §E Projects page donor_id support
- §F React Strict Mode
- §G 24 scenarios: TC scope, SPO scope, HQ projects, multi-state deduplication, budget display labels, no invented allocations, scope-before-aggregation, URL injection guards
Total: 135 pure unit tests, no RTL imports, no live DB.
