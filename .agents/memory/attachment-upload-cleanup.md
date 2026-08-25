---
name: Attachment upload cleanup durability
description: Durable rules for removing abandoned upload objects across parent deletion and worker retries
---

Cleanup retry and audit state must not depend on the lifetime of the upload operation or its parent record.

**Why:** A parent deletion can remove an unfinalised operation before a scheduled expiry worker claims it, or after a claim but before provider cleanup finishes. Keeping retry state only on the source row can permanently lose object identities and failure evidence.

**How to apply:** Enqueue temporary and recorded final object identities into a parent-independent outbox in the same transaction as expiry, terminal finalisation failure, or deletion, before removing source rows. Claim outbox work with an expiring lease and guard terminal updates with the lease token; provider deletion must treat missing objects as success.