---
name: Sector Budget currency architecture
description: SectorBudgetEntry now has budgetByCurrency[] (per-currency rows); null vs zero distinction; overallocation/overspend flags; no invented performance tiers.
---

## Rule
Sector Budget data is structured as one entry per (sector, currency) pair in SQL, then aggregated in TypeScript into `SectorBudgetEntry.budgetByCurrency[]`. Never cross-sum currencies.

## Key invariants

### Null-preserving financial fields (SectorBudgetCurrencyEntry)
- `budgetTotal`, `activityPlanned`, `activitySpent` — **no COALESCE**; null = missing, not zero.
- `remaining = budget − spent` — null if either operand is null.
- `unallocated = budget − planned` — null if either missing; **negative = over-planned** (factual, not clamped).
- `utilisationPct = spent/budget×100` — null if budget=0 or either operand is null; **>100 preserved factually** (do not cap).

### Exception counts (authoritative zeros — COALESCE is correct here)
- `overallocatedProjectCount`, `overspentProjectCount` — `COALESCE(SUM(...), 0)` — zero means "no exceptions", which is definitive.
- `overallocatedAmount`, `overspentAmount` — same.

### Activity counts (on SectorBudgetEntry, not per-currency)
- `totalActivityCount` — null when no activities exist for any project in sector.
- `incompleteActivityCount` — null when no activities; 0 = all complete; N = N incomplete.
- Label: "No activities" / "0 incomplete activities" / "N incomplete" — never "N active".

## Badge policy
- **No invented tiers**: "Under Budget" / "On Track" / "Over Budget" are removed.
- Only factual flags: "Overspent" (red) if `overspentProjectCount > 0`; "Overallocated" (amber) if `overallocatedProjectCount > 0`.

## fmtMoney helper
`fmtMoney(val: number | null | undefined, currency: string | null | undefined)` — returns "—" for null/undefined val; always requires explicit currency code (no USD fallback).

## Filter rules
- Sector dropdown uses `MAIN_SECTORS` (7 values only), not `SECTORS` alias.
- Date filter is "Project Period" (implementation period overlap), not expenditure dates.
- Status filter label = "Project Status" / option = "All Project Statuses".
- All Projects selector hidden when `overviewTab === "sector"` (inert on that tab).

## TC scope
- TCs always receive `unresolvedSectorProjects: 0` — unresolved fails closed (sector = null is outside any TC scope).

**Why:** Sector budgets span multiple project currencies; cross-summing produces meaningless totals. Null preservation prevents false $0 confidence when financial data is missing. Exception flags are factual not interpretive.
