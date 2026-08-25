---
name: Notification taxonomy contract
description: Canonical event kinds, historical compatibility, and central delivery policy.
---

New notification writes must use the central canonical kind registry, while
historical aliases are mapped only when notifications are presented to clients;
do not rewrite stored notification history to normalise it.

**Why:** Delivery preferences, email handling, mandatory events, realtime
payloads, and UI presentation used to classify kinds independently. A report
workflow status was consequently emitted as a notification event and missed its
approval category.

**How to apply:** Add a new kind to the registry before adding a production
producer, give the caller a stable source-event key when the event may retry,
and add a presentation alias only for demonstrably historical notification
values. Workflow status strings are not automatically notification kinds.