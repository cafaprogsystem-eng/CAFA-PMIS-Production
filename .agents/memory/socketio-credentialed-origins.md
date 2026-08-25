---
name: Socket.IO credentialed origins
description: Keep credentialed browser-origin checks consistent across Engine.IO polling and WebSocket upgrades.
---

For credentialed Socket.IO connections, enforce the validated public-origin predicate in both the Socket.IO CORS configuration and `allowRequest`. CORS response handling alone is not sufficient to guarantee that a WebSocket upgrade is rejected.

**Why:** Engine.IO polling uses CORS middleware, while WebSocket upgrades need an explicit request-admission decision. Leaving the latter permissive can let an arbitrary browser origin establish a credentialed realtime connection even when HTTP CORS is strict.

**How to apply:** Derive both checks from the same parsed `PUBLIC_APP_URL` allowlist. Keep originless requests explicitly allowed for legitimate server-side clients, and restrict any empty-allowlist development affordance to non-production.