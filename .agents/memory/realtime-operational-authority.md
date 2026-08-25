---
name: Realtime operational authority
description: Rules for validating realtime operational subscriptions, locks, and event delivery.
---

Realtime rooms and scope hints are candidate-delivery optimisations only. Every
operational subscription, lock mutation, and delivery must reapply the exact
canonical HTTP record-view boundary, including record-type-specific effective
sector and assignment rules, then verify the durable session and active user.

**Why:** A broad room or a simplified copy of scope logic can disclose a lock
or invalidation hint to users who cannot retrieve the underlying record; a
read permission must also never become lock-write authority.

**How to apply:** Reuse or extend shared record-access resolvers whenever a
new operational entity becomes realtime-enabled. Keep edit permission checks
separate for lock ownership, and retain reauthorisation immediately before
transport fan-out.

For deletion invalidations, the record can no longer be resolved after commit.
Capture a private, scoped recipient grant only after the destructive
transaction holds the parent row lock; never include it in the socket payload.
At delivery, recheck the live session plus unchanged role/state/sector scope
and every surviving dynamic predicate. When the deletion transaction itself
removes the predicate evidence (such as a project assignment), preserve only
the authority captured while that same locked transaction proved it.

**Why:** Looking up deleted records drops every legitimate viewer, while a
module-wide fallback leaks record IDs to users whose state, sector, or direct
assignment changed during the operation.

**How to apply:** Lock first, capture second, commit before publishing. Treat
the grant as an internal, post-commit proof rather than a public event field;
for linked records that survive deletion, re-query dynamic access such as
project assignment immediately before fan-out.