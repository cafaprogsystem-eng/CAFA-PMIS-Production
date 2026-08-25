---
name: Report duplicate-check queries
description: Rules for any query that mirrors the reports partial unique indexes (duplicate-check endpoint, POST pre-guards)
---

**Rule:** Every query that mirrors a reports uniqueness index (GET /reports/duplicate-check branches, POST create pre-guards) must include BOTH `status NOT IN ('rejected','archived')` AND `migration_is_duplicate = FALSE`.

**Why:** Migration 006 recreated ALL reports partial unique indexes (project, activity, program_state, hq_sector) with `migration_is_duplicate = FALSE`. The earlier index definitions (migration 005 block, ~line 732 in run-migrations.ts) look authoritative but are dropped and recreated later in the same file — read the LAST definition. A guard that omits the migration filter is stricter than the DB and falsely blocks valid creation next to a preserved historical duplicate; a completion code review rejected exactly this.

**How to apply:** When adding a new duplicate-check branch or pre-INSERT guard for any report type, grep run-migrations.ts for the final index recreation (not the first occurrence) and mirror its full predicate. on_demand kinds have no unique index — never block them. Period string conventions on the endpoint: monthly "YYYY-MM", quarterly "YYYY-Q{n}", annual "YYYY".
