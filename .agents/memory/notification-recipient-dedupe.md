---
name: Notification recipient integrity and event dedupe
description: Rules for active recipients, event-aware atomic notification dedupe, and startup ordering.
---

**Rule:** Every notification recipient must resolve to an existing active user at the central service boundary; role and actor queries may narrow candidates but never bypass that gate. Deduped notifications require a documented source-event key and claim it atomically per recipient before in-app, realtime, or email side effects. Email-only events still claim the key without creating an in-app row.

**Why:** Historic owner/assignment IDs can point to inactive accounts, and generic entity/kind/time-window dedupe both races under concurrency and collapses separate conversation or workflow events.

**How to apply:** Preserve source-specific keys (message ID, pin ID, explicit transition states, or documented recurring-date bucket) rather than generic hashes. Start background work that needs migrated schema only after tracked migrations complete. Never auto-mutate historical duplicate notifications without an explicit retention decision.