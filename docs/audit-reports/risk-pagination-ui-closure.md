# Risk Register — Pagination UI Closure

## #589 Closure

### Primary Register

**File**: `artifacts/cafa-pmis/src/pages/risks.tsx`

- Server-side pagination added: `query.page = page` and `query.limit = DEFAULT_LIMIT` (50)
- `useState(1)` for `page`; constant `DEFAULT_LIMIT = 50`
- Removed hardcoded `query.limit = 200`
- Previous/Next controls render beneath the risk table when `totalPages > 1`
- Both buttons carry `aria-label` attributes; `disabled` when at first/last page
- Card title header shows server-envelope `total` (actor-scoped count)
- **Atomic filter reset**: every filter setter (Select `onValueChange`, Input `onChange`, StatCard `onClick`, `clearFilters`) calls `setPage(1)` in the same event handler — no `useEffect` double-request
- **Empty-page recovery**: resets to page 1 when `page > tp` (no `totalPages > 0` exclusion — handles the empty-result / `totalPages=0` case correctly)
- **KPI tiles**: counts read from `risksRaw.summary` (server aggregate) — accurate across all pages

**File**: `artifacts/api-server/src/routes/risks.ts`

- `riskCountSelect` replaced with `riskSummarySelect` that returns `total`, `open`, `critical`, `high`, `medium`, `low` in one aggregate query
- Count + data queries run in parallel via `Promise.all`
- Response envelope extended: `{ items, total, page, limit, totalPages, summary }`

### Bounded Consumers (intentional — no pagination controls added)

| Consumer | File | Limit | Reason |
|---|---|---|---|
| Plan risk selector | `plan-detail.tsx` | 200 | Selector only — linking flow; search-within-selector functionality is out of scope for this task. Known limitation: >200 risks on a project silently truncates. |
| Project risk view | `project-detail.tsx` | n/a | Embedded array from project payload; no `useListRisks` call |
| State risk view | `state-detail.tsx` | n/a | Embedded array from `useGetState` payload |
| HQ Sector Report form | `hq-sector-report-form.tsx` | 200 | Bounded form selector dependency |
| Programme State Report form | `program-state-report-form.tsx` | 200 | Bounded form selector dependency |
| Create-plan dialog | `create-plan-registration-dialog.tsx` | 200 | Selector |
| Reports page inline selector | `reports.tsx` | 200 | Bounded project-risk selector |
| Command palette | `/api/search?limit=5` | 5 | Different endpoint entirely (`/api/search`, not `/api/risks`) |
| Global search | `/api/search?limit=5` | 5 | Different endpoint entirely |

### URL State

Filters and `page` are **not** persisted to URL params. This is consistent with the
existing filter architecture in `risks.tsx`, which only reads `riskLevel` and `activeOnly`
from `window.location.search` on mount. A broad URL-state refactor for filter/page
persistence is a separate task and was not introduced here.

### Scope / Security

`total` and `totalPages` in the response envelope come from the server-side query that
already applies `userScope()` (TC sector scoping, SPO/SOM state scoping). No client-side
inference of counts from inaccessible data occurs. The frontend reads `risksRaw.total`
directly from the server response.

### Accessibility

- Previous/Next `<Button>` elements carry `aria-label="Previous page"` and
  `aria-label="Next page"` (screen-reader friendly text even when visible label is just
  the word "Previous" / "Next").
- `disabled` attribute applied when on first/last page respectively.
- Pagination wrapper is inside the `<Card>` below `<CardContent>`, separated by a
  `border-t` divider.

### Summary Counts (KPI tiles)

The four KPI stat-cards (Critical, High, Medium, Open) read from a `summary` field
returned by the server in the same `GET /risks` response envelope. The server runs a
parallel aggregate query (`riskSummarySelect`) with the same WHERE clause (same actor
scope and filters) so tile counts reflect the full accessible register across all pages,
not just the current page's items. Clicking Next/Previous does not change the tile values.

### Tests

| ID | Description | File |
|---|---|---|
| RISK-PAGE-01 | First-page renders items array and envelope | frontend + api |
| RISK-PAGE-02 | Clicking Next requests `page=2` | frontend + api |
| RISK-PAGE-03 | Clicking Previous decrements page | frontend + api |
| RISK-PAGE-04 | Single-page result: controls hidden / totalPages=1 | frontend + api |
| RISK-PAGE-05 | `total` in display from scoped server envelope | frontend + api |
| RISK-PAGE-06 | Changing any filter resets page to 1 | frontend |
| RISK-PAGE-07 | `total` reflects actor-scoped count (not global) | frontend + api |
| RISK-PAGE-08 | `identified_at DESC` ordering preserved across pages | frontend + api |
| RISK-PAGE-09 | Bounded consumers retain limit cap, no pagination controls | frontend |
| RISK-PAGE-10 | No Risk data semantics, scoring, or lifecycle changed | frontend |

### Status

**#589: CLOSED**

### Remaining Risk Findings

RISK-PAGE-01 through RISK-PAGE-10 are all addressed in this closure.

The following sentinel IDs from prior waves remain on record but are not affected by
this pagination-only task:

- RISK-001 through RISK-022 (Wave 1/2 closure — unchanged)
- RISK-RES-01 through RISK-RES-12 (residual integrity closure — unchanged)
- RISK-BD-06 (budget-data guard — unchanged)
