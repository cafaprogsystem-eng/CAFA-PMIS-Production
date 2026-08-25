---
name: Dashboard analytics endpoint authorization
description: Required authorization pattern for any new dashboard/analytics read endpoint
---

Any new dashboard/analytics endpoint that returns report or location data must:

1. Register `requirePerm("reports.view")` (or the appropriate perm) as route middleware — a frontend permission check is not an API authorization control.
2. Clamp state roles (state_office_manager, state_program_officer) to their own `state_id` in EVERY query touching locations or reports — filtering projects to those operating in the state is not enough; multi-state projects otherwise leak sibling states' data. HQ rows are excluded for state-clamped users.
3. Fail closed (empty result, before any data query) when a state role has no `stateId` assigned.

**Why:** a completeness endpoint that scoped only the project list passed all its own tests but exposed cross-state report metadata; completion review rejected it as broken access control.

**How to apply:** mirror the report route scope (clamps `r.state_id`); add cross-state, null-state, and permission-gate regression tests when adding such endpoints.
