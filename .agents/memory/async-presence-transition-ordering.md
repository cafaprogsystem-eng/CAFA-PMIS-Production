---
name: Async presence transition ordering
description: Prevent stale presence transitions from being broadcast after reconnects.
---

Presence transitions that perform asynchronous work must carry a monotonic per-user version and verify it is still current after every await, immediately before each external side effect or recipient emit.

**Why:** A final offline transition can begin persistence or recipient reauthorisation just as a new authenticated connection advances the user to online. Without a version fence, the older offline event can arrive after the newer online event and leave clients in a false state.

**How to apply:** Keep the version internal to the server. Increment it for every online/offline transition, check it before/after database or access-control awaits, and stop fan-out as soon as it becomes stale. Directory-wide events and conversation-member events need separate audience boundaries; never reuse a broad directory permission for chat presence.