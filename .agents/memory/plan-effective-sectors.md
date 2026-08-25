---
name: Plan sector authorisation & write-lock ordering
description: Durable rules — sector precedence chain for access control; guard and lock inside the write transaction.
---

**Rules:**
1. A plan's authoritative sectors are a strict precedence chain (multi-sector array wins outright, single legacy sector and linked-project sector only as fallbacks). Scope predicates must test membership against that chain — never `array-overlap OR legacy-match`, which leaks records whose stale legacy field matches another coordinator's assignment.
2. Authorisation and integrity re-checks for writes belong INSIDE the write transaction, on the locked row: post-commit rechecks cannot undo an unauthorised change, and pre-transaction editability checks run on a stale snapshot.
3. Parent-before-child lock order: any mutation of a plan's activities must first lock the parent plan row, matching the completion transition's lock order, or an interleaved completion can be invalidated by a late activity write.

**Why:** each rule closed a concrete review-found defect (cross-sector data leak, sector-escalation via PATCH, completion-gate race).

**How to apply:** route all sector-scope decisions through the shared effective-sectors helper (server and client trust the API's `sectors` field); when adding write paths, lock the plan row FOR UPDATE first and re-validate status/scope under the lock before COMMIT.
