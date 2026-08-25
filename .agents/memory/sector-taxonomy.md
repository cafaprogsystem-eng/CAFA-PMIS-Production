---
name: Sector taxonomy — single source of truth
description: 7 canonical main sectors post-unification; MPCA correction; nullable sector columns; SectorBudgetResponse shape
---

## Rule
7 canonical Main Sectors: Health, Nutrition, WASH, Education, Protection, Food Security & Livelihoods, Shelter & NFI.

`MAIN_SECTORS` + `SECTORS` alias + `SUB_SECTORS` + `ASSISTANCE_MODALITIES` live in:
- `artifacts/cafa-pmis/src/lib/sectors.ts` (frontend)
- `artifacts/api-server/src/lib/sectors.ts` (backend)

`PR_SECTORS = General/Cross-Cutting + MAIN_SECTORS`.

**NEVER add local sector lists to pages or components.**

## MPCA
MPCA is an Assistance Modality only, not a Main Sector. Project 4 (CAFA-2024-004, "Multi-Purpose Cash Assistance — Gedaref") has `sector = NULL` and `assistance_modality = "Multipurpose Cash Assistance (MPCA)"` with a `migration_review_notes` flag. Indicator 8 (I4.1) also has `sector = NULL`.

## Nullable sector columns (post-migration 004)
`projects.sector` and `indicators.sector` are both nullable. `sector = NULL` = unresolved pending manual review.
- Projects 3, 5, 7 are deterministically resolved — `sector` is canonical, `migration_review_notes = NULL`.
- Project 4 is unresolved — `sector = NULL`, `migration_review_notes` is SET.
- Plan 5 (Multi-Sector) has `sector = NULL`, `migration_review_notes` SET.

## SectorBudgetResponse API shape
`GET /dashboard/sector-budget` returns:
```json
{
  "sectors": SectorBudgetEntry[],
  "unresolvedSectorProjects": number,
  "unresolvedBudgetByCurrency": { "USD": number, ... }
}
```
TCs always receive `unresolvedSectorProjects: 0` (fail closed — unresolved falls outside all TC sector scopes).
Old shape was a plain array; any client code must use `sectorData?.sectors`.

## Why
`null !== zero` for sector. A provisional guess (Protection) on an MPCA project is worse than honest `null` — it corrupts sector analytics and TC scope-gate enforcement. Budget banner informs HQ users without exposing unresolved data to TC-scoped views.
