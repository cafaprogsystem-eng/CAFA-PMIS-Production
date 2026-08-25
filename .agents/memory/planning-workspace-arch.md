---
name: Planning Workspace Architecture
description: Plans page is now the primary Planning workspace; Planning Dashboard removed from nav and redirected. Key data architecture decisions.
---

## Rule

`/plans` is the canonical Planning entry point. `/planning` and `/planning-dashboard` both redirect to `/plans` via wouter `<Redirect>` in App.tsx.

The standalone `planning-dashboard.tsx` file is kept as a redirect-only component (to preserve any deep links) but is no longer registered as a lazy import in App.tsx.

## Data Architecture

The Plans workspace uses **two independent data sources:**
1. `useListPlans(query)` — filtered plan list (drives table/card/kanban/calendar views)
2. `useGetPlanningDashboard()` — unfiltered scope-wide summary + follow-up sections

The summary KPI strip and Operational Follow-Up (Upcoming Deadlines + Delayed Activities) always show **all plans in scope**, unaffected by the user's current list filters.

## KPI Strip (5 cards)

| Card | Value |
|---|---|
| Total Plans | `totals.total` |
| Draft Plans | `totals.draft` |
| Awaiting Approval | `totals.awaitingApproval` (= submitted + technically_approved + coordination_approved) |
| Active Plans | `totals.active` (= active + in_progress combined) |
| Completed Plans | `totals.completed` |

**None** of the cards use `alert` prop when value is 0 — zero = neutral styling always.

## What Is NOT in the Plans Workspace

- Budget Utilisation analytics (Spec B §14 — belongs in Plan Details/Budget module)
- Linked Risks KPI (Spec B §16 — belongs in Plan Details/Risks module)
- Plans By State / By Sector charts
- "Delayed" KPI card (0 plans currently; it's a list-filter concern, not a workspace KPI)

## API Extension

`GET /plans/dashboard` → `totals` now includes two new fields (added additively, backward compatible):
- `awaitingApproval: number` — submitted + technically_approved + coordination_approved
- `statusBreakdown: Record<string, number>` — full status map for all statuses

The generated `PlanningDashboardTotals` type does NOT yet include these fields. On the frontend, cast with:
```tsx
const extTotals = dashData?.totals as PlanningDashboardTotals & { awaitingApproval?: number };
```

## Budget Display Fix

`formatCurrency()` hardcodes `$`. All plan-level budget rendering now uses `formatPlanBudget(amount, currency)` in plans.tsx — shows `{ISO_CODE} {amount}` (e.g. `USD 459,700`), or raw number if currency is missing (never assumes USD).

## Follow-Up Components

`UpcomingDeadlines` and `DelayedActivities` are defined at **module scope** (not inside PlansPage) to avoid React recreating component identity on every parent render, which would unmount/remount subtrees and reset focus.

## Sidebar

Planning nav item: `{ href: "/plans", icon: CalendarClock, label: "Planning" }` — no children array. The "Dashboard" submenu item has been removed.

**Why:** The Planning Dashboard was a redundant page. Plans is the workspace. Dashboard submenu caused navigation confusion and dual-entry-point problems.
