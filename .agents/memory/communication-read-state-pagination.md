---
name: Communication read state and pagination
description: Truthful unread and receipt semantics plus the stable conversation-list continuation contract.
---

Communication read state is only `conversation_members.last_read_at`; it is
not a per-message delivery or seen receipt system. An authorised operational
viewer who is not a member of a non-direct conversation must receive a null
personal unread state and must never gain a membership row or a synthetic read
marker. Direct Messages remain actual-member-only for every role.

**Why:** Treating a null membership row as an old read timestamp reports
fictional unread messages, while a sender-side Seen/Delivered badge would claim
recipient evidence that is not stored.

**How to apply:** Keep sender-authored messages out of a member's unread count;
apply per-user hides and shared-delete-safe previews before calculating list
state. Do not reintroduce sender receipt labels unless a persisted, recipient
scoped receipt model is explicitly designed.

Conversation-list continuation is an opaque cursor over descending visible
activity timestamp plus descending conversation ID. Filters, access checks, and
search must apply before the page boundary; client merges must deduplicate
overlap caused by refetches or realtime invalidation.

**Why:** The ID tie-breaker prevents missing or duplicate records when multiple
conversations have the same activity time, and an identity-only realtime event
can race with an in-flight page fetch.

**How to apply:** Keep `{ items, hasMore, nextCursor }` as the list contract.
Return only an authorised user's visible last-message preview and use the
server, not local slicing, for bounded list/filter results.