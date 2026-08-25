---
name: Offline PWA blocked actions
description: Fail-closed offline replay policy and safety rules for sync.
---

## Rule

Offline support is a strict allow-list, not a broad mutation fallback:

**Blocked (OfflineBlockedError — user sees a toast, action is refused):**
- Workflow transitions, approvals, returns, rejections, deletion, administration,
  budgets, AI, communication/realtime work, and every unlisted endpoint.
- Attachments: files are online-only and must be re-selected after reconnecting.
- Draft updates without a captured server revision.

**Queued (OfflineQueuedError — saved to IndexedDB syncQueue, replayed on reconnect):**
- Draft-only creation and updates for the explicitly supported operational records.
- Replays must have an account owner, stable operation ID, dependencies where
  applicable, and a current revision for existing records.

## Why

Workflow and authority-sensitive actions require the live server to validate
current lifecycle state and permissions. Draft replay must be safe under stale
data, account switching, retries, and multiple tabs: account-owned persistence,
authoritative browser locking, server-side actor-bound idempotency, and an
optimistic revision precondition are all required. When any safety mechanism is
unavailable, fail closed rather than silently queue or replay.

## navigator.onLine is unreliable

Never use `navigator.onLine` to gate sync logic. In Replit's proxied iframe it can be `false` even when the API is fully reachable. Always use the probed `isOnline` state from SyncContext (derived from `HEAD /api/healthz`). The old bug in `triggerSync` used `!navigator.onLine` — fixed to re-probe before syncing.

## How to apply

- Adding a draft-capable endpoint requires explicit policy approval, account
  scoping, an atomically enforced revision at the write point, and focused
  replay/conflict tests.
- Never broaden offline support by omission or by method-only matching.
- Never call `navigator.onLine` in sync-related code. Call `probeConnectivity()` instead.
- In-progress idempotency claims with an unknown outcome must not expire into a
  second execution; retain them for safe recovery.
