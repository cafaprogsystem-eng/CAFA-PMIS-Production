---
name: Communication attachment capability
description: Dedicated permission and privacy rules for Communication Centre attachment and voice transport.
---

**Rule:** Communication Centre attachments and voice messages use `messages.attachments.upload`, not `documents.upload`. Operational messaging roles receive it; viewers may send text but cannot upload. The client must use the generated `uploadURL` descriptor field and expose attachments only through the parent-authorised message proxy.

**Why:** A shared upload-descriptor endpoint must not turn document repository authority into message-attachment authority, and stale client field naming otherwise breaks the storage-first send flow.

**How to apply:** Keep message-upload capability checks tied to `scope: "messages"` at the descriptor endpoint, preserve the existing `documents.upload` contract for other callers, and never replace message-bound proxy URLs with raw object paths or public storage links.