---
name: TC sector enforcement
description: How Technical Coordinator sector access is gated in CAFA PMIS, including the fail-closed contract and remaining gaps.
---

# Rule
For `role = technical_coordinator`, every read or mutation that touches a sector-bearing resource (project, report, risk, and their sub-resources) must be filtered or guarded by the TC's assigned-sector set. List endpoints filter in SQL via `= ANY($n::text[])`; detail/mutation endpoints call `assertSectorAllowed(req, sector)` before doing anything else.

# Why
The product spec is explicit: "Technical Coordinators must not access or approve data outside their assigned sector." This is a strict permission rule, not advisory. A bypass on a detail endpoint or transition endpoint is a real authorization vulnerability, even when the list endpoint is filtered — IDs are guessable.

# How to apply
- `tcSectorRestriction(req)` is the single source of truth and is **fail-closed**: it returns `[]` (deny-all) for a TC whose parsed `sectors` is empty, never `null` (unrestricted). Do not introduce a code path that treats "TC with no sectors" as "no restriction."
- When adding a new endpoint that touches a project/report/risk/sub-resource, you must do one of: (a) JOIN to `projects` and add `p.sector = ANY($n::text[])` to the WHERE clause for list endpoints, or (b) load the resource's effective sector first and call `assertSectorAllowed(req, sector)` before any work for detail/mutation endpoints.
- When changing a user's role *to* `technical_coordinator` in PATCH `/users/:id`, re-run `normalizeSector` against the effective sector (request body OR existing DB value). Do not gate only on whether `body.sector` was sent — legacy/blank values would otherwise inherit silently.

# Known gaps (deferred, not blockers)
- `/dashboard/*` aggregates are not sector-scoped — they remain global counts for all roles. Acceptable for the MVP because they're informational, but should be revisited before adding any actionable dashboard widget (e.g. "approve from dashboard").
- The earlier `state_review` project transition was removed; do not reintroduce it without revisiting the TC chain.
