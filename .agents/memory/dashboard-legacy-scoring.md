---
name: Dashboard legacy scoring model — fully removed
description: Documents what was removed, what was kept, and why; guards against re-introduction.
---

## Removed — unsupported composite performance scoring model

The following components depended on a Dashboard-only composite scoring model
(weighted dimensions: activity completion 25%, report submission 20%, indicator
achievement 20%, budget utilisation 15%, risk management 10%, data completeness 10%)
with unapproved tier classifications (Excellent / Good / Needs Follow-Up / Critical).
None of these components had a counterpart in approved CAFA Business Logic.

**Removed from `dashboard.tsx`:**
- `PerformanceBadge` — tier-coloured badge with threshold labels
- `stateInsightLine` — insight text derived from tier
- `ExecutiveInsights` — state ranking cards (#1/#2/#3, "Best Current Performance", "Needs Attention")
- `tierColor` / `tierLabel` — helpers used only by the above
- `ScoreBar` — weighted component bar for composite score
- `PerformanceScoreBanner` — full score banner with 6 component bars (dead code, never rendered)
- `ProjectPerformanceRankings` — ranked top/bottom project list by overallScore (dead code, never rendered)
- Score and Status columns from `StatePerformanceTable`
- Threshold legend (Excellent ≥80 / Good ≥60 / Needs Follow-Up ≥40 / Critical <40)
- Compliance bar threshold colour (was: emerald/amber/red; now: neutral `bg-primary`)
- `PerformanceScore` type import from api-client-react
- `Gauge` and `Star` lucide imports

**Replaced with:**
- `OperationalFollowUp` — simple two-card panel: Active Critical Risks + Overdue Reports (genuine counts only)
- `AttentionProjectsPanel` cleaned up: neutral dot, no score badge, only `criticalRisks` badge retained

## Kept — genuinely approved data

- `useGetSectorPerformance` — returns `projects`, `beneficiaries`, `indicatorAchievementPct`, `budgetUtilizationPct` per sector. These are direct factual calculations, not composite.
- `ProjectPerformanceScore` type — still needed by `AttentionProjectsPanel` and `PriorityActionsPanel` (both use `criticalRisks` field only).
- `tierColor` / `tierLabel` would only be justified if a formally approved scoring model is documented outside the Dashboard.

## Backend fix — null vs zero for zero-denominator pct fields

`computeStateScores` in `performanceEngine.ts` previously used `COALESCE(..., 0)` and `ELSE 0`
for `activityCompletionPct` and `reportingCompliancePct`, causing zero-denominator states
(no activities / no non-draft reports) to show `0%` instead of `—`.

**Fix:** Changed `ELSE 0 → ELSE NULL` and removed `COALESCE(..., 0)` wrappers for both fields.
Updated `StateScoreRow` interface to `number | null` for both. Updated JS mapping to preserve null.
Frontend already handled null correctly (`actPct == null ? dash : ...`), but added explicit guard:
`(noData || state.activityCompletionPct == null) ? null : ...`

**Why:** The spec rule is: show `—` when numerator or denominator is unavailable; show `0%` only
when genuine result is zero. The previous SQL conflated "no data" with "zero result".

## State table rename

"State Performance Overview" → "State Implementation Overview"
"State Performance" (isState view) → "State Implementation"
Description: "Review project delivery, reporting and operational follow-up across states."

**Why:** The table now shows factual implementation and operational data, not an approved
performance score.
