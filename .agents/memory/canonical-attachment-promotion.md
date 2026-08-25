---
name: Canonical attachment promotion consistency
description: Durable rules for coordinating external object storage promotion with attachment metadata and parent deletion.
---

Provider promotion is not transactional with PostgreSQL. Persist the deterministic final-object identity before promotion, and acquire locks in the order parent → attachment for finalisation, replacement, lifecycle actions, and parent deletion.

**Why:** A provider copy can succeed while a database transaction rolls back or a parent is being deleted. Without a durable final identity, cleanup cannot find the promoted object; opposite lock ordering can also deadlock replacement and archive/delete requests.

**How to apply:** Any future parent-bound attachment surface must use a server-generated operation ID, record both temporary and final identities before external work, and collect both identities for post-commit cleanup. Never use caller-supplied storage identity or lock a child attachment before its canonical parent.