---
name: Risk Register module semantics
description: Durable decisions from the Risk Register full functional audit
---

- **Scoring is a 3×3 model** (thresholds ≥9 critical / ≥6 high / ≥2 medium), not the 5×5/1–25 matrix the manual FAQ describes. Whether the 5×5 text is aspirational is an open business decision (RISK-BD-02); until resolved, treat the 3×3 code as canonical.
- **Convention: `severity` mirrors `impact` in every create UI**, and all displays must use the computed `riskLevel`, never stored severity. **Why:** stored severity can diverge from the computed level via partial PATCH; the audit's headline P1 was a KPI counting stored severity while its link filtered by computed level.
- **Rule: any risk KPI tile must link to a list with an identical population.** Active-risk counts exclude `closed`/`mitigated`; a tile linking to the register must pass the matching filter (e.g. `activeOnly`). **How to apply:** when adding/altering risk analytics, verify the count SQL and the linked list filter share both the level expression and the status exclusion.
- Enum domains (likelihood/impact/status) are enforced app-side with allow-lists, not DB CHECKs; legacy aliases (unlikely/possible/likely/almost_certain, mitigated, identified…) must remain accepted so historical rows round-trip.
- Risk deletion intentionally does not exist (RISK-BD-05); plan↔risk links are owned by the plans module and app-side nulling is the only referential guard. The org-wide due-date notification trigger is super_admin-only — job triggers are privileged operations, not reads.
- Full finding register: docs/audit-reports/risk-register-module-full-functional-audit.md.

## Residual Wave 2 (pagination, locks, soft delete, clearing)
- **`risks.locked_by`/`locked_at` are LIVE, not dead schema** — the realtime record-lock routes (routes/realtime.ts) read/write them on projects/reports/plans/risks. **Why:** the residual audit nearly dropped them as "dead optimistic locking"; only `risks.version` was truly dead (dropped, migration 028). **How to apply:** before dropping "unused" columns, grep for the raw column name across ALL routes, not just the owning module's route file.
- GET /risks is paginated: `{ items, total, page, limit, totalPages }`, limit default 50 / max 200, `ORDER BY identified_at DESC, id DESC`. All frontend consumers (risks page, plan-detail, create-plan dialog, reports raw fetch) read `.items`.
- All risk queries JOIN projects with `AND p.deleted_at IS NULL` — soft-deleted projects must never surface titles or grant TC sector scope; risks are retained with NULL projectTitle (frontend shows "[Project removed]").
- Clearing a nullable field via PATCH requires an explicit `null` in the payload — omit means "unchanged". Edit forms must send `field: value ?? null`, never delete falsy keys (#576 root cause).
- Due-date checker reference dates come from PG `CURRENT_DATE` (single query), never JS `setHours`+`toISOString` (UTC shift on non-UTC servers).
- Canonical create status is `open` (DB default aligned, migration 028); `identified` remains a valid legacy lifecycle value — never mass-update it. stateId existence is checked on create (422 state_not_found), actor-independent; stateId is not patchable.

## Reference & date integrity policy
- Risk write-path validation policy: references validated on write only (grandfathering — existing rows never retro-invalidated); PM/SA Full Access bypasses scope, never existence.
- Strict YYYY-MM-DD dates must also reject year 0000 — JS UTC round-trip accepts it but PostgreSQL `date` does not (would 500).
- No date-ordering or assignee State/Sector scope rule exists for risks (RISK-BD-06) — do not invent one.

## No-FK parent/child concurrency protocol
- Where a parent row's children have no DB-level FKs, destroy-cascades must delete the parent first (RETURNING ids) and purge children after, while every child writer locks the parent row (FOR UPDATE/FOR SHARE) in the same transaction as its write and fails closed if the parent is gone. **Why:** validate-then-insert writers otherwise commit orphans after the purge; the parent row lock serialises all interleavings.
