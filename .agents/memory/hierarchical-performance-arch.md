---
name: Hierarchical Performance Architecture
description: The approved indicator→project→sector calculation model for the Programme Performance tab, including backend service, API route, and frontend hook.
---

## The Approved Calculation Hierarchy

Four pure functions in `performanceEngine.ts`:
1. `calculateIndicatorAchievement(target, achieved)` — `achieved/target × 100`, no cap, null when target ≤ 0
2. `calculateProjectAchievement(indicators[])` — equal-weight avg of valid indicator rates
3. `calculateSectorAchievement(projectRates[])` — equal-weight avg of valid project rates
4. `calculateAverageSectorAchievement(sectorRates[])` — equal-weight avg of valid sector rates

**Why:** Prevents raw indicator value aggregation across incompatible units (e.g. a target of 453M distorts a simple SUM/SUM ratio across all indicators).

**How to apply:** Never sum raw indicator values. Never cap at 100% in calculated or displayed numbers (progress bar width may cap, numeric display must not).

## Main Backend Function

`computeHierarchicalPerformance(pool, filterSql, filterParams)` in `performanceEngine.ts`.
- Accepts pre-built `$N`-indexed SQL fragment for `projects p` table
- Three queries: projects, states, indicators — all in one pass each
- Returns `HierarchicalPerformance` with `averageSectorAchievementRate`, `validSectorCount`, `validProjectCount`, `sectors[]` (each with nested `projects[]`)

## API Route

`GET /api/dashboard/hierarchical-performance` in `dashboard.ts`.
- Full filter support: stateId, sector, donor, dateFrom, dateTo via `applyFilterParams` + `projectScopeWhere` + `reindex`
- Route handler builds `filterSql` + `filterParams`, passes to `computeHierarchicalPerformance`

## Frontend Hook

`useHierarchicalPerformance(params)` in `artifacts/cafa-pmis/src/hooks/use-hierarchical-performance.ts`.
- Raw `fetch` with `credentials: "include"` (same pattern as other custom hooks in the codebase)
- QueryKey: `["hierarchical-performance", params]`
- Accepts same `summaryParams` shape as `useGetDashboardSummary`

## Dashboard.tsx Integration

- KPI card renamed: "Average Sector Achievement Rate" — uses `hierarchicalData.averageSectorAchievementRate`
- Sector Performance: replaced bar chart with analytical table + inline drill-down (`expandedSector` state, `ChevronRight` icon)
- Target vs Achievement: uses `hierarchicalData.sectors[].sectorAchievementRate`
- Project Performance: new full-width table section (section 5), showing all projects from `hierarchicalData.sectors[].projects`
- `useGetSectorPerformance()` retained for Overview-tab's `SectorOrReportsChart` component
- `PerformanceScore` type retained for `PerformanceScoreBanner` component
