---
name: Express rate-limit IPv6 keys
description: How to create custom express-rate-limit keys without triggering its IPv6 bypass validation.
---

For a custom rate-limit key that falls back to an IP address, use `ipKeyGenerator(req.ip)` from `express-rate-limit`; do not concatenate `req.ip` directly.

**Why:** Current express-rate-limit validates custom key generators at startup and reports a potential IPv6 rate-limit bypass when it detects raw IP use.

**How to apply:** Authenticated routes may key by stable user ID. Any unauthenticated/IP fallback must pass through the library helper.