---
name: SPR author gate (SPR-BD-2)
description: Governance for who may author State Programme Reports and the narrow-permission fallback pattern
---

# SPR authoring governance (SPR-BD-2)

Rule: `program_state` reports are authored only by SPO (primary, state profile-clamped), SOM (bounded fallback ONLY while no active SPO covers their state — vacancy verified server-side), and super_admin (emergency; must supply an explicit canonical stateId, never clamped). TC/SPC/PM/ED/Viewer are never SPR authors, even though some hold generic `reports.create`.

**Why:** generic create permission let roles with no state scope author SPRs they could never subsequently access; the fallback also had to be workflow-complete (create + edit + submit), or fallback drafts become orphaned.

**How to apply:**
- A fallback role must be given a *narrow* type-specific permission, and every route in the report lifecycle (create, draft edit, submit transition) must honour it with own-report + own-state + own-type bounds, failing closed when either the user's or the report's state is null — never grant the broad update/create perms.
- Outer permission middlewares that gain an "or narrow perm" path should delegate to the existing `requirePerm(...)` call so test suites that stub `requirePerm` keep their semantics.
- Type author gates fire before field/location validation, so validation-precedence tests must authenticate as an approved author role.
