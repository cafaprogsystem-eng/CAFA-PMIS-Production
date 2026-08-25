---
name: Revocable authenticated sessions
description: The canonical browser-session and logout boundary for HTTP and Socket.IO.
---

## Rule
An authenticated browser session is an opaque signed cookie backed by one active,
unexpired server-side record. HTTP middleware and Socket.IO must use that same
record; legacy numeric signed user-ID cookies are never authentication.

**Why:** Clearing a self-contained signed user-ID cookie cannot invalidate a
captured copy. A durable session record permits targeted revocation, prevents
cookie replay, and ensures realtime access follows the same authorization state.

**How to apply:** Login-like flows issue a fresh opaque session, logout revokes
the underlying session before clearing the cookie and disconnects only that
session's sockets. Do not add fallbacks that resolve a user directly from a
cookie value. Demo identity switching may layer on a valid administrator
session, but must not replace the session authority.