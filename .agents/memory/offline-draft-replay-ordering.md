---
name: Offline draft replay ordering
description: Safe ordering and settlement rules for durable snapshots paired with offline mutation replay.
---

Persist a durable draft snapshot with its exact stable operation ID before the
matching offline mutation is eligible for replay. On completion, settle or
remove a snapshot only when its stored operation ID still matches the replayed
operation; a later local edit clears that link and must survive.

**Why:** reconnect can occur between browser writes. If the queue becomes
eligible first, successful replay cannot find its snapshot; if an old replay
settles a newer edit, it can silently discard the author's latest work.

**How to apply:** generate the ID at the editor boundary, attach it as queue
metadata, and save the pending snapshot before issuing the intercepted request.
Account/logout cleanup must purge snapshots alongside all other offline data.