---
name: Communication lifecycle integrity
description: How to harden Communication Centre history, private hides, and identity without destructively rewriting historical rows.
---

**Rule:** Keep shared deletion separate from viewer-private message hiding.
When historical conversation data prevents validating global uniqueness or
foreign-key constraints, preserve it for human reconciliation while enforcing
future writes through dedicated canonical key tables, transaction-scoped
advisory locks, forward-only membership guards, and `NOT VALID` foreign keys.

**Why:** Existing duplicate memberships, malformed Direct rooms, and orphan
references are ambiguous historical records. Auto-merging or deleting them
could lose message history or breach Direct Message privacy, while leaving new
writes unconstrained would repeat the defect.

**How to apply:** Use `(created_at, id)` keyset pagination and a tracked
history index for bounded history. Store Delete For Me in a per-user relation;
every message read, preview, reply, attachment, and mutation path must apply
that viewer hide. Treat a historical-reconciliation register as separate from
software closure, and do not clean storage objects under unresolved retention
policy. Realtime message events must carry only stable identifiers when any
returned field (such as reply preview) is viewer-specific; recipients refetch
their authorised projection.
