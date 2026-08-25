# Plans Module Zero-Residual Closure — Wave 2 Audit Report

**Date:** 18 August 2026
**Scope:** Four residuals from the Plans Final Closure Audit — PLAN-015 list performance, migration 021 identity guard, soft duplicate UX, and Continue Editing view parity. Closure work only; no redesign.

---

## 1. PLAN-015 — List performance (CLOSED)

### Final architecture
`planSummarySelect` (`artifacts/api-server/src/routes/plans.ts`) no longer contains any correlated
subqueries. The two per-row `plan_activities` probes (`AVG(pa.progress_pct)` and `COUNT(*)`) were
replaced by a single pre-aggregated LEFT JOIN:

```sql
LEFT JOIN (
  SELECT plan_id,
         ROUND(AVG(CASE WHEN status <> 'cancelled' THEN progress_pct END))::int AS "progressPct",
         COUNT(*)::int AS "activitiesCount"
  FROM plan_activities
  GROUP BY plan_id
) pa_agg ON pa_agg.plan_id = pl.id
```

The SELECT list uses `pa_agg."progressPct"` and `COALESCE(pa_agg."activitiesCount", 0)`. The DB
computes every plan's activity aggregates in one grouped pass instead of O(N) correlated work.

### Query count evidence
- PLAN-PERF-01 intercepts `pool.query` during `GET /plans` and asserts exactly **one** query is
  issued for the whole list — and that its SQL contains no `WHERE pa.plan_id = pl.id` correlated
  reference; the only `plan_activities` linkage to `pl.id` is the JOIN's `ON` clause.
- `GROUP BY plan_id` inside the subquery structurally guarantees 1:1 join cardinality — one plan
  row per plan regardless of activity count (PLAN-PERF-02).

### Progress regression confirmation
- `progressPct` remains **null** (never COALESCE'd to 0) when a plan has no activities or only
  cancelled ones: `AVG` over zero eligible rows (the `CASE WHEN` yields NULL for cancelled rows)
  is NULL (PLAN-PERF-03, PLAN-PERF-04).
- `COALESCE` guards only `activitiesCount` — a source assertion confirms no
  `COALESCE(pa_agg."progressPct" …)` exists.

### Scope security (unchanged)
- State roles remain clamped to their own state; crafted `?stateId=` is ignored; null-state SPO
  fails closed with an empty list and **no query issued** (PLAN-PERF-05).
- TC sector scope still uses the effective-sectors EXISTS filter (PLAN-PERF-06).
- PM / Super Admin full access: no state/sector filters injected (PLAN-PERF-07).

---

## 2. Migration 021 duplicate prefix (CLOSED — NOT A DEFECT)

### Final classification
**NOT A DEFECT.** The migration runner keys identity on the FULL migration name
(`schema_migrations.filename`); the numeric prefix is a readability aid only.
`021_hq_sector_location_integrity` and `021_report_attachments_drive_file_id.sql` execute
independently exactly once.

### Migration safety
The regression test that Task #511 was supposed to add now exists (MIG-021-01…05 in
`plans-wave2.test.ts`):
1. All full migration names in the registry are unique.
2. Both 021-prefixed migrations are present with distinct full names and independent SQL.
3. The runner's applied-check and tracking insert both key on the full name; no numeric-prefix
   parsing exists anywhere in the runner.
4. The `021_` prefix appears exactly twice — proving it is non-semantic.
5. The forward-looking convention comment sits above the second `021_` entry (already present;
   verified, not re-added).

The Plans Final Closure Audit (`plans-final-closure-audit.md`) was updated to remove all language
classifying the 021 prefix as an accepted residual or follow-up.

---

## 3. Soft duplicate UX (CLOSED)

### Backend
Both soft paths (structured-with-no-hard-match and irregular types) now share
`runSoftDuplicateQuery`, which returns the matching count plus the most recent matching plan's ID.
`resolveAccessibleSoftPlanId` mirrors the hard path's accessibility check
(`getPlanEffectiveSectors` → `assertAnySectorAllowed`; state scope is already enforced by the
query's scope predicate). Response shape: `{ matchType: "soft", count, planId }` where `planId`
is null whenever the actor's sector scope forbids viewing the match — no navigation is exposed
out of scope. The `count` field is preserved.

### Frontend
`create-plan-registration-dialog.tsx`: when the soft response includes a non-null `planId`, the
amber warning renders a **"Review Existing Plan"** button (British English) that closes the dialog
and navigates to `/plans/${planId}`. No automatic redirect; the proceed/create path remains fully
available (soft duplicates never disable the save buttons). When `planId` is null only the text
warning shows. The link is derived exclusively from the CURRENT `duplicateCheck` state, so the
existing cancelled-flag debounce guard automatically prevents a stale response from replacing a
current response's link (PLAN-DUP-UX-07).

### Hard duplicate regression
Unchanged: hard drafts retain "Continue Editing Existing Draft" with save buttons disabled
(PLAN-DUP-UX-06); the full pre-existing suite `plan-duplicate-ux.test.tsx` (26 tests) and backend
`plan-duplicate-integrity.test.ts` still pass.

---

## 4. Continue Editing view parity (CLOSED)

### Behaviour
- **Rule:** `status === "draft"` — identical to the table (covers fresh drafts and
  returned-for-revision drafts, which re-enter `draft`).
- **Routing:** `/plans/${plan.id}?edit=1` — identical across Table, Card, and Kanban.
- **Implementation:** the `viewRecords` mapping in `plans.tsx` now populates the existing
  `ViewRecord.actions` slot with a "Continue Editing" `Link` for draft plans. `CardGrid` already
  rendered `item.actions` in the card footer; `KanbanBoard` was extended to render the action slot
  (wrapped in a click-stopping container so the card's detail navigation is not hijacked).
- Cards/kanban items still open plan detail on click — the edit affordance is a separate,
  visible-text link, not an implicit whole-card action.
- No edit action appears for submitted / approved / active / in_progress / completed / rejected
  plans in any view.

### Returned drafts
Returned-for-revision plans have `status === "draft"`, so all three views expose the same
affordance and routing (PLAN-VIEW-04).

### Accessibility / responsive
The affordance is a real anchor (`<Link>`) with the visible text label "Continue Editing" —
keyboard focusable, screen-reader named, not icon- or colour-only. `stopPropagation` keeps the
parent card/row click from firing when the link is activated. Card and kanban layouts are
unchanged apart from the added link (no visual redesign).

---

## 5. Files changed

| File | Change |
|---|---|
| `artifacts/api-server/src/routes/plans.ts` | PLAN-015 pre-aggregated JOIN; soft-duplicate helpers + `planId` in soft responses |
| `artifacts/cafa-pmis/src/components/create-plan-registration-dialog.tsx` | Soft type gains `planId`; "Review Existing Plan" link |
| `artifacts/cafa-pmis/src/pages/plans.tsx` | `viewRecords.actions` Continue Editing for drafts |
| `artifacts/cafa-pmis/src/components/view-modes/kanban-board.tsx` | Renders `item.actions` slot |
| `artifacts/api-server/src/test/plans-wave2.test.ts` | NEW — 7 PLAN-PERF + 5 MIG-021 tests |
| `artifacts/cafa-pmis/src/test/plans-wave2-ui.test.tsx` | NEW — 7 PLAN-DUP-UX + 10 PLAN-VIEW tests |
| `artifacts/api-server/src/test/plans-wave1.test.ts` | Assertions updated to new pa_agg SQL shape (contracts unchanged) |
| `artifacts/api-server/src/test/plans-closure-sentinel.test.ts` | PLAN-CLOSE-07 structural assertion updated to pa_agg shape |
| `artifacts/api-server/src/test/plan-progress-consistency.test.ts` | PLAN-PROG-AVG-01 assertion updated to the pa_agg CASE-expression form |
| `docs/audit-reports/plans-final-closure-audit.md` | Residual table updated: all four Wave 2 items CLOSED; 021 reclassified NOT A DEFECT |

## 6. Test totals

| Suite | Result |
|---|---|
| `plans-wave2.test.ts` (7 PLAN-PERF + 5 MIG-021) | 12/12 pass |
| `plans-wave2-ui.test.tsx` (7 PLAN-DUP-UX + 10 PLAN-VIEW) | 17/17 pass |
| Full api-server test suite (all 66 files, including every Plans regression suite; `plan-progress-consistency` updated to the pa_agg CASE-expression assertion) | 1709/1709 pass |
| Frontend plan suites (`plan-duplicate-ux`, `plans-ux-accessibility`) | 49/49 pass |

## 7. TypeScript result

`tsc --noEmit` introduces **zero new errors**. api-server: 5 pre-existing errors remain (reports.ts
`overrideReason`, risks.ts `locationType` — tracked under Task #146 scope), none in plans.ts.
cafa-pmis: 17 pre-existing errors remain (unchanged count vs. pre-change baseline), none introduced
by Wave 2 files.

## 8. Remaining Plans residuals

None known. All items in the Plans Final Closure Audit residual table are now CLOSED (Wave 1:
PLAN-009 sector semantics, progressPct nullable type, completed-plan gate; Wave 2: PLAN-015,
migration 021, soft duplicate navigation, Continue Editing parity). The only Plans-adjacent open
debt is the pre-existing cross-module TypeScript debt tracked separately (Task #146), which is not
a Plans functional residual.

## 9. Recommendation

The Plans module is **ready for the zero-residual final re-closure audit**. All four Wave 2
residuals are eliminated with regression tests guarding each closure, scope security is verified
unchanged, and no new TypeScript errors were introduced.
