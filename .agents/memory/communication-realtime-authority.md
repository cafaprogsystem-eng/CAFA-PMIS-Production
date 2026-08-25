---
name: Communication realtime authority
description: Durable authority and privacy rules for Communication Centre Socket.IO delivery.
---

Conversation room joins and protected room emissions must use the same
canonical access decision as HTTP. Direct Messages always require actual
membership, even for Full Operational Access roles. Operational non-members
may receive only a minimal user-room invalidation after the same canonical
check; never create a membership row just to deliver realtime state.

**Why:** Membership is a privacy boundary for Direct Messages, while
operational access exists for a narrow set of non-direct views. Treating either
as a broad room grant leaks state or corrupts the membership model.

**How to apply:** Recheck user status, role, and conversation access before
each protected room emission. Use identity-only events followed by authorised
HTTP refetch. A Delete For Me mutation is private: use an actor-only
conversation invalidation, never a shared conversation event.