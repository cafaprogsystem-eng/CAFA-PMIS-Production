---
name: Dashboard hook/component stability architecture
description: Permanent fix for hook-order crash and inner-component identity bug in dashboard.tsx; rules to prevent recurrence.
---

## The bug class
Two distinct React violations caused the Dashboard global error boundary to trigger:

1. **Hook after early return** — `const statusChartData = useMemo(...)` was declared *after* `if (isSummaryLoading) return <skeleton />`. Because React requires hooks to be called the same number of times on every render, the hook-call count differed between the loading and loaded renders, triggering the Rules-of-Hooks invariant and crashing reconciliation.

2. **Inner components used as JSX** — `ChartCard`, `MonthlyTrendChart`, `SectorOrReportsChart`, and `TT` were defined *inside* the `Dashboard` function body and then used as `<ChartCard>`, `<MonthlyTrendChart>` JSX. Because they are recreated on every parent render, React treats them as a different component type each cycle, unmounting and remounting the entire subtree, which also corrupts hook reconciliation in those subtrees.

## Permanent fix applied
- `statusChartData = useMemo(...)` moved to *before* the first conditional return (`if (isSummaryLoading)`). All `useMemo`/`useState`/`useCallback` calls must live in the unconditional top section of Dashboard.
- `ChartCard`, `MonthlyTrendChart`, `TT` (constant object), `SortableTableHeader`, `StateTableErrorBoundary` all promoted to **module scope** (outside the exported `default function Dashboard`).
- `SectorOrReportsChart` — confirmed dead code; removed along with `REPORT_STATUS_COLORS`.
- `StateTableErrorBoundary` (class component) wraps `<StatePerformanceTable>` so table render failures are isolated from the global error boundary.
- `MonthlyTrendChart` now takes an explicit `monthlyData` prop instead of closing over `summary` from Dashboard scope.

## Rules to maintain
- **All React hooks in Dashboard must be declared before any `if (…) return` statement.** Add new ones only at the top of the hook block.
- **Never define a function component inside Dashboard (or any other component) and use it as JSX.** Extract to module scope with explicit typed props.
- **Render-prop / children functions** that are passed as props (not used directly as JSX elements) are acceptable (`allowAsProps: true` in ESLint).
- The ESLint rule `react/no-unstable-nested-components: error` is now configured in `eslint.config.js` to enforce this automatically.

## Test suite
`src/test/state-performance-table.test.tsx` — 35 tests covering loading/success/error transitions, sort stability, null vs zero pct cells, prop-array mutation, strict-mode double-invoke, and covered/all-states toggle. Run with `pnpm test` in `artifacts/cafa-pmis`.

**Why:** Without the ESLint rule and tests, this class of bug is invisible until runtime and appears as an intermittent "Something went wrong" crash with no obvious cause in the stack trace.
