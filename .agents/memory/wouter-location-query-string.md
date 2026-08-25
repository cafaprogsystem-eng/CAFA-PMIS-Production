---
name: Wouter location and query strings
description: Wouter's useLocation value is pathname-only in this app; compatibility redirects must read window.location.search to preserve safe query context.
---

Wouter's `useLocation()` value does not include the browser query string in this app. Compatibility redirects that preserve approved query parameters must read `window.location.search` directly, then construct a strict allow-listed destination.

**Why:** A legacy File & Archive redirect initially appeared correct in source but dropped the allowed search filter in the browser because it parsed the pathname-only location.

**How to apply:** When implementing or reviewing safe one-way redirects, parse `window.location.search`, retain only explicitly supported keys and bounded values, and drop all other query input.