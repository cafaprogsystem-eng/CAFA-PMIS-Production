---
name: IndexedDB primary-key bridge
description: Safe migration pattern for offline schema changes that cannot alter an existing IndexedDB primary key.
---

Use a new canonical database when an IndexedDB primary key must change; read the old database natively without requesting an upgrade, copy only account-attributable rows in one transaction, and leave the source untouched until retirement is separately reviewed.

**Why:** IndexedDB rejects in-place primary-key changes, while an interrupted migration must not expose new writes to an account before legacy queue and draft data has been copied. Stable operation IDs, account-prefixed draft keys, and diagnostic-only quarantine counts preserve safety across retries.

**How to apply:** Gate Dexie readiness on the copy; derive canonical cache keys from validated ownership and URL, deduplicate queues by operation ID (not auto-increment IDs), quarantine malformed or mismatched rows, and make retry completion marker + copied rows atomic.