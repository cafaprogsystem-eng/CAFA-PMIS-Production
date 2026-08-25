---
name: Production PWA browser certification
description: Why offline browser readiness must be verified on a routed production PWA rather than a Vite development worker.
---

A Vite development service worker can register and cache its development entry point
without caching the application's module graph. It must never be used as evidence
that a full offline navigation or browser restart will reach the application shell.

**Why:** An authenticated browser diagnostic showed an active development worker,
Workbox caches, and the PMIS IndexedDB stores, but full-network offline navigation
still produced a blank page or Chrome's network error. Worker registration alone was
therefore a false positive for offline readiness.

**How to apply:** Run offline certification only against a routed production PWA where
the web application and `/api` share an origin. Make production assertions fail fast
when the routed URL or isolated credentials are absent, assert that a built app asset
is in the worker cache, and then exercise a physical offline reload.