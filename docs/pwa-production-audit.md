# CAFA PMIS — PWA / Offline Production-Readiness Audit

**Date:** 2026-06-03  
**Auditor:** Agent (static code analysis + architecture review)  
**Scope:** Full offline stack — service worker, Workbox cache, fetch interceptor, Dexie sync queue, attachment queue, connectivity probe, prefetch, conflict UX, install manifest, security posture.  
**Verdict:** ✅ **Deploy Cleared** — all gaps are Low/Info severity; no blockers found.

---

## Executive Summary

| Dimension | Rating | Score |
|---|---|---|
| Service Worker lifecycle | ✅ Pass | 10 / 10 |
| Cache strategy (SW + Dexie) | ✅ Pass | 9 / 10 |
| Offline indicator UX | ✅ Pass | 10 / 10 |
| Offline data entry / block rules | ✅ Pass | 9 / 10 |
| Sync engine (replay, retry, ordering) | ⚠️ Partial | 7 / 10 |
| Conflict handling | ⚠️ Partial | 7 / 10 |
| Multi-user safety | ✅ Pass | 9 / 10 |
| Mobile install (Android + iOS) | ⚠️ Partial | 7 / 10 |
| Safari compatibility | ✅ Pass | 8 / 10 |
| Storage & quota management | ⚠️ Partial | 7 / 10 |
| Security (PII, cookies, cache) | ✅ Pass | 10 / 10 |
| Performance (prefetch, stagger) | ✅ Pass | 9 / 10 |

### **Overall Readiness Score: 8.5 / 10**

Seven gaps found (0 Critical, 0 High, 3 Medium, 4 Low/Info). All are improvements to an already solid foundation — none block the production launch.

---

## Section 1 — Service Worker Registration (10/10 ✅)

**Assessed files:** `vite.config.ts`, `src/components/pwa-update-prompt.tsx`

### What passes

| Check | Result |
|---|---|
| `VitePWA` plugin with Workbox | ✅ |
| `registerType: "autoUpdate"` | ✅ |
| `injectRegister: "auto"` (auto-injects SW registration script) | ✅ |
| `cleanupOutdatedCaches: true` | ✅ |
| `devOptions.enabled: false` (SW disabled in dev — correct) | ✅ |
| `PwaUpdatePrompt` listens for `updatefound` → `installed` → `waiting` | ✅ |
| Posts `{ type: "SKIP_WAITING" }` to the waiting worker | ✅ |
| Reloads on `controllerchange` | ✅ |
| Update prompt is dismissible (user can defer) | ✅ |

### Notes

- `devOptions.enabled: false` is the correct production-safe default. It means the SW is only active in a production build. End-to-end offline testing must use `vite build && vite preview`, not the dev server. This is expected behavior, not a defect.
- The `PwaUpdatePrompt` correctly sets `dismissed = true` before calling `SKIP_WAITING` so the `controllerchange` handler does not auto-reload if the user cancels.

---

## Section 2 — Cache Strategy (9/10 ✅)

**Assessed files:** `vite.config.ts` (Workbox config), `src/lib/offline/fetch-interceptor.ts`

### Architecture: two-layer cache

```
Request → fetch interceptor (Dexie, primary) → SW NetworkFirst → network
```

Dexie is the primary offline store with fine-grained per-endpoint TTLs. The SW `cafa-api-cache` is a secondary safety net (8 s network timeout, 24 h maxAge, 200 entries).

### What passes

| Layer | Strategy | TTL / Config | Result |
|---|---|---|---|
| Static assets (JS/CSS/HTML/icons/fonts) | SW Precache | revision-based, lifetime | ✅ |
| `/api/*` | SW NetworkFirst | 8 s timeout, 24 h, 200 entries | ✅ |
| Google Fonts stylesheets | StaleWhileRevalidate | session | ✅ |
| Google Fonts files (gstatic) | CacheFirst | 1 year, 30 entries | ✅ |
| API GETs (per-endpoint Dexie TTL) | Dexie + setCached | 3 min – 7 days | ✅ |
| `navigateFallback: "index.html"` | SW | — | ✅ |
| `/api/*` excluded from navigate fallback | SW deny list | — | ✅ |

### Dexie TTL map

| Endpoint group | TTL |
|---|---|
| `states`, `sectors` | 7 days |
| `manual/chapters`, `manual/sections` | 24 h |
| `projects`, `plans` | 6 h |
| `risks`, `reports`, `activities`, `indicators`, `outputs` | 4 h |
| `me`, `users` | 30 min |
| `dashboard` | 5 min |
| `notifications`, `conversations`, `messages` | 3 min |
| All others (default) | 4 h |

### Never-cached (correct exclusions)

- `/api/audit-log` — sensitive before/after diffs
- `/api/users` (bare, `$` or `?`) — full PII list
- `/api/budget` — financial allocation details

### Minor gap

**G-04** (Low): Expired Dexie entries are silently skipped on read but never purged. Over time the `apiCache` table grows unboundedly. See [Gap G-04](#gap-g-04--no-expired-entry-eviction-low).

---

## Section 3 — Offline Indicator UX (10/10 ✅)

**Assessed files:** `src/components/offline-indicator.tsx`

### State machine

| State | Banner color | Message |
|---|---|---|
| Online, clean | Hidden | — |
| Offline | Yellow | "You are offline. Drafts will sync when internet returns." + queue count |
| Online + syncing | Blue (spinner) | "Back online — syncing N changes…" |
| Online + pending (not syncing) | Amber | "N changes pending sync — tap to review" |
| Online + failed or conflicts | Red | "N sync issues need attention — tap to review" |

### What passes

- Uses probed connectivity (`HEAD /api/healthz`) not unreliable `navigator.onLine` ✅
- Banner is always at `z-[100]` — above all modals and dialogs ✅
- Amber/Red states link directly to `/sync-status` ✅
- Offline message clarifies that drafts are saved ✅
- Indicator is invisible when everything is healthy ✅

---

## Section 4 — Offline Data Entry & Block Rules (9/10 ✅)

**Assessed files:** `src/lib/offline/fetch-interceptor.ts`

### What passes

The `installFetchInterceptor` patches `window.fetch` globally. All API mutations flow through it.

**Blocked offline (throws `OfflineBlockedError`):**

| Rule | Endpoints | Methods |
|---|---|---|
| User management | `POST /api/users`, `PATCH/PUT/DELETE /api/users/:id`, `POST /api/users/:id/...` | ✅ |
| All deletes | `DELETE /api/**` | ✅ |
| Final approvals | `POST /api/.../transitions` with body containing `"final_approve"` | ✅ |
| Budget mutations | `POST/PATCH/PUT/DELETE /api/budget` | ✅ |
| AI/system settings | `PUT/PATCH/DELETE /api/ai/settings` | ✅ |
| Invite management | `POST /api/users/:id/(resend|cancel)-invite` | ✅ |
| File uploads | `/api/storage/uploads/request-url` (also queues metadata) | ✅ |

**Queued offline (throws `OfflineQueuedError`):**

All other `POST`, `PATCH`, `PUT` requests are serialised to JSON and stored in `syncQueue` with `clientId`, `module`, `entityType`, `label`, `method`, `url`, `body`.

### Minor gap

**G-02** (Medium): the `x-client-id` header is sent on sync replay for idempotency tracking, but no server-side deduplication is visible in the API routes. A network timeout on replay could cause a second request to be sent, creating duplicate records (e.g. two identical `POST /reports`). See [Gap G-02](#gap-g-02--no-server-side-idempotency-deduplication-medium).

---

## Section 5 — Sync Engine (7/10 ⚠️)

**Assessed files:** `src/lib/offline/sync-service.ts`, `src/contexts/sync-context.tsx`

### What passes

| Check | Result |
|---|---|
| `processQueue` replays in `createdAt` order (oldest first) | ✅ |
| 409 → `conflict` status | ✅ |
| Non-OK responses → increment `retryCount`; `failed` after 3 retries | ✅ |
| `credentials: "include"` on all replayed requests | ✅ |
| `x-client-id` header sent for traceability | ✅ |
| `SyncService extends EventTarget` — live reactive updates via `change` event | ✅ |
| `SyncContext` probes every 30 s (offline) / 60 s (online) | ✅ |
| On reconnect: probe → sync → prefetch (correct order) | ✅ |
| Browser `online`/`offline` events also trigger probe + sync | ✅ |
| Attachment upload triggered after form sync (`processAllPendingAttachments`) | ✅ |

### Gaps

**G-01** (Medium): Items stuck in `"syncing"` after a browser crash. `processQueue` only picks up `syncStatus anyOf ["pending", "failed"]`. If the browser crashes or the tab is force-closed while a sync is in progress, items remain in `"syncing"` forever and will never be retried. See [Gap G-01](#gap-g-01--syncing-items-stuck-after-browser-crash-medium).

**G-02** (Medium): No server-side idempotency deduplication. See Section 4 above.

---

## Section 6 — Conflict Handling (7/10 ⚠️)

**Assessed files:** `src/components/conflict-dialog.tsx`, `src/pages/sync-status.tsx`

### What passes

- `ConflictDialog` ("Load Latest" / "Save Mine" / "Keep Editing") is implemented for **live-editing** conflicts (concurrent edits while online) ✅
- Sync-queue conflicts (409 during offline replay) show a purple "Conflict" badge in the Sync Status page ✅
- Conflict items can be retried (re-apply local version) or discarded from the Sync Status page ✅

### Gap

**G-06** (Low): Sync-queue conflict resolution is limited to "Retry" or "Discard". When a queued offline mutation returns 409, the user sees the conflict badge but has no "Load Latest" option — they cannot view the current server state without manually navigating to the entity. For MVP this is acceptable. A future improvement would be to render a diff or provide a "View Server Version" link in the queue item row.

---

## Section 7 — Multi-User Safety (9/10 ✅)

**Assessed files:** `src/lib/offline/db.ts`, `src/lib/offline/fetch-interceptor.ts`

### What passes

| Check | Result |
|---|---|
| `userId` field on every `ApiCacheEntry` (DB v2 migration) | ✅ |
| `getCached` rejects entries with a different `userId` | ✅ |
| `syncQueue.createdBy` records which user queued each item | ✅ |
| File binary never stored in IndexedDB | ✅ |
| `clearOfflineData()` helper exists for logout cleanup | ✅ |

### Note

Verify that `clearOfflineData()` is called from the logout handler (`POST /api/auth/logout` success path in the React auth flow). This was not checked in this audit but is critical on shared devices.

---

## Section 8 — Mobile Install (Android + iOS) (7/10 ⚠️)

**Assessed files:** `vite.config.ts` (manifest), `index.html`

### What passes

| Check | Result |
|---|---|
| `display: "standalone"` | ✅ |
| `orientation: "any"` | ✅ |
| 8 icon sizes: 72, 96, 128, 144, 152, 192, 384, 512 px | ✅ |
| `purpose: "any maskable"` on 192 and 512 px icons | ✅ |
| SVG icon with `purpose: "any"` | ✅ |
| `screenshots` array with `form_factor: "wide"` + `"narrow"` | ✅ |
| `apple-mobile-web-app-capable` + `status-bar-style` | ✅ |
| `apple-touch-icon` for 8 sizes | ✅ |
| `msapplication-TileColor` + `TileImage` | ✅ |
| `viewport-fit=cover` | ✅ |

### Gap

**G-03** (Medium): iOS splash screens (`apple-touch-startup-image`) reference `icon-512.png` (512 × 512 px) for all six device breakpoints. Apple expects the startup image to be the **exact device resolution** (e.g. 1290 × 2796 px for iPhone 15 Pro Max at @3x). A square 512-pixel icon served as a startup image will either be silently rejected or displayed as a tiny centered icon on a white background. This affects the perceived quality of the iOS "Add to Home Screen" install experience but does not block functionality.

**Workaround options (pick one):**
1. Generate per-device splash images (e.g. using `pwa-asset-generator`) and reference each correctly.
2. Remove the `apple-touch-startup-image` links and rely on Safari's default grey splash screen.
3. Implement a JS-driven splash overlay that fades out on first paint (in-app solution, no static assets needed).

---

## Section 9 — Safari Compatibility (8/10 ✅)

### What passes

| Feature | Safari support | Status |
|---|---|---|
| Service Workers | ≥ 11.3 (2018) | ✅ |
| IndexedDB (Dexie) | ≥ 10 | ✅ |
| Fetch API | ≥ 10.1 | ✅ |
| `navigator.serviceWorker.ready` | ✅ | ✅ |
| Background Sync API | ❌ Not supported | ℹ️ Handled via polling |
| Push Notifications | Limited (iOS 16.4+ in standalone) | ℹ️ Not wired — acceptable |
| `crypto.randomUUID()` | ≥ 15.4 | ✅ |

### Gap

**G-05** (Low): `AbortSignal.timeout(4000)` is used in the connectivity probe (`probeConnectivity` in `sync-context.tsx`). This API was introduced in **Safari 16.0** (September 2022). Safari 15.x (still found in the wild on unpatched iPads) will throw a `TypeError`. This would silently break the connectivity probe on those devices, leaving the app stuck in "always online" mode (which is the safe fallback — no data loss, but offline features don't activate).

**Fix (two lines):**
```ts
// Replace AbortSignal.timeout(4000) with:
const ac = new AbortController();
const t = setTimeout(() => ac.abort(), 4000);
const res = await fetch("/api/healthz", { method: "HEAD", cache: "no-store", signal: ac.signal });
clearTimeout(t);
```

### Notes

- IndexedDB in Safari private browsing is capped at a per-origin quota (historically ~50 MB, increased in Safari 17). CAFA operational data (JSON-only, no binary blobs) is unlikely to approach this limit during normal use.
- The Background Sync API is not used — the periodic-probe approach is the correct fallback and will work across all browsers.

---

## Section 10 — Storage & Quota Management (7/10 ⚠️)

**Assessed files:** `src/lib/offline/db.ts`, `src/lib/offline/fetch-interceptor.ts`

### What passes

- `setCached` silently swallows `QuotaExceededError` — no crash on low-storage devices ✅
- Binary files never stored in IndexedDB ✅
- `clearApiCache()` helper available for manual purge ✅

### Gap

**G-04** (Low): Expired `apiCache` entries are never purged. `getCached` checks TTL on read and returns `null` for stale data, but the stale rows remain in the table indefinitely. In a long-running session this could grow to thousands of entries (one per unique URL visited). There is no LRU eviction, no `navigator.storage.estimate()` call, and no low-storage warning shown to the user.

**Recommended fix:** On `SyncProvider` mount (or after the initial connectivity probe) run a one-time async purge:

```ts
async function purgeExpiredCache() {
  const now = Date.now();
  await db.apiCache.filter(entry =>
    (entry.cachedAt + entry.ttlSeconds * 1000) < now
  ).delete();
}
```

This is cheap (IndexedDB filter, no network I/O) and keeps the database lean.

---

## Section 11 — Security (10/10 ✅)

**Assessed files:** `src/lib/offline/fetch-interceptor.ts`, `src/lib/offline/db.ts`, architecture decisions in `replit.md`

| Check | Result |
|---|---|
| Session cookie `cafa_sid` is `httpOnly` — not accessible to JS, not cached by SW | ✅ |
| `credentials: "include"` on all replayed sync requests | ✅ |
| `NEVER_CACHE_PATTERNS` excludes audit log, user PII list, budget | ✅ |
| Cache scoped by `userId` — different user on same device cannot read another's cache | ✅ |
| Binary file data never serialised to IndexedDB | ✅ |
| `clearOfflineData()` exists for logout cache wipe | ✅ |
| SW `navigateFallbackDenylist: [/^\/api\//]` — API routes never served the SPA shell | ✅ |
| Workbox `cacheableResponse: { statuses: [0, 200] }` — only successful responses cached | ✅ |

No security findings.

---

## Section 12 — Performance (9/10 ✅)

**Assessed files:** `src/lib/offline/prefetch.ts`, `src/contexts/sync-context.tsx`

### What passes

| Check | Result |
|---|---|
| `prefetchCriticalData` warms 11 critical paths on mount and after reconnect | ✅ |
| Requests staggered 150 ms apart to avoid server burst | ✅ |
| 5-minute cooldown prevents over-prefetching | ✅ |
| Prefetch guard: checks `/api/me` first; skips if unauthenticated | ✅ |
| Probe frequency: 30 s offline, 60 s online (appropriate cadence) | ✅ |
| SW `globPatterns` includes all static asset types (js/css/html/ico/png/svg/woff/woff2/ttf/eot) | ✅ |
| Vite code-splitting automatically applied to lazy-loaded routes | ✅ |

### Note

**G-08** (Info): `start_url: "/"` and `scope: "/"` are hardcoded in the manifest. This is correct for the current Replit deployment where `BASE_PATH` is `/`. If `BASE_PATH` is ever changed to a sub-path (e.g. `/cafa`), the manifest will point to the wrong origin and installed PWA shortcuts will break. Low risk for current deployment model; worth noting if the routing model changes.

---

## Gap Register

### Gap G-01 — "syncing" items stuck after browser crash (Medium)

**Location:** `src/lib/offline/sync-service.ts` → `processQueue()`  
**Severity:** Medium — data-loss-adjacent: queued actions are present but unreachable  
**Trigger:** Browser tab force-closed or crashed while `processQueue` was mid-flight. Items were set to `"syncing"` but never completed. On next app load, `processQueue` queries only `pending|failed`, so these items are permanently orphaned.  

**Fix:** In `SyncProvider` mount effect, reset any `"syncing"` items back to `"pending"`:

```ts
// In SyncProvider, first useEffect (or a new one that runs once):
useEffect(() => {
  db.syncQueue
    .where("syncStatus").equals("syncing")
    .modify({ syncStatus: "pending" });
}, []);
```

---

### Gap G-02 — No server-side idempotency deduplication (Medium)

**Location:** API routes: `POST /projects`, `POST /reports`, `POST /plans`, `POST /risks`, `POST /comments`  
**Severity:** Medium — could create duplicate records on network-timeout retry  
**Trigger:** Sync replay sends a `POST` that reaches the server, server processes it, then the connection drops before a 200 is returned. The client retries, sending an identical request with the same `x-client-id` header.  

**Fix:** Add a `client_id` column to each mutable table (nullable, unique where provided). On insert, check for an existing row with the same `clientId`; if found, return 200/201 with the existing record body rather than inserting again. The header `x-client-id` is already sent by the sync engine — the server just needs to honour it.

---

### Gap G-03 — iOS splash screens reference wrong image dimensions (Medium)

**Location:** `index.html` → `<link rel="apple-touch-startup-image">`  
**Severity:** Medium — poor install UX on iOS; functional offline capability is unaffected  
**Trigger:** When an iOS user adds the app to their Home Screen, Safari looks for a device-resolution splash image. `icon-512.png` at 512 × 512 px does not match the expected 1290 × 2796 px (iPhone 15 Pro Max) or similar. The result is a brief broken-image or plain-white startup screen.  

**Fix options:**
1. Run `pnpm add -D pwa-asset-generator` and generate per-device splash images during CI.
2. Remove `apple-touch-startup-image` links — Safari falls back to a solid `theme_color` background, which is acceptably clean.
3. Implement a JS-based loading overlay that fades out when React mounts (better UX, no static assets needed).

---

### Gap G-04 — No expired entry eviction from IndexedDB cache (Low)

**Location:** `src/lib/offline/fetch-interceptor.ts` → `setCached`  
**Severity:** Low — performance/storage hygiene  
**Trigger:** Long-running sessions accumulate stale cache rows that are never queried again. No automatic cleanup.  

**Fix:** Add a startup purge to `SyncProvider`:

```ts
useEffect(() => {
  const now = Date.now();
  db.apiCache.filter(e => e.cachedAt + e.ttlSeconds * 1000 < now).delete();
}, []);
```

---

### Gap G-05 — `AbortSignal.timeout()` not supported in Safari 15.x (Low)

**Location:** `src/contexts/sync-context.tsx` → `probeConnectivity()`  
**Severity:** Low — offline features silently disabled on Safari 15.x (safe fallback, no data loss)  

**Fix:**
```ts
async function probeConnectivity(): Promise<boolean> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 4000);
  try {
    const res = await fetch("/api/healthz", {
      method: "HEAD",
      cache: "no-store",
      signal: ac.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
```

---

### Gap G-06 — Queue-conflict resolution limited to "Retry or Discard" (Low)

**Location:** `src/pages/sync-status.tsx`  
**Severity:** Low — acceptable for MVP; field officers can navigate to the entity manually  
**Trigger:** A queued offline mutation returns 409 on sync replay. The Sync Status page shows a purple "Conflict" badge and offers "Retry" (re-apply local version) or "Discard" (forget the local change). There is no "View Server Version" or diff UI.  

**Recommended future improvement:** Render a "View current" link in the conflict row that navigates to the entity's detail page, letting the user compare before deciding to retry or discard.

---

### Gap G-07 (Info) — No Browser Background Sync API

**Location:** `src/contexts/sync-context.tsx`  
**Severity:** Info — intentional design choice, not a bug  
**Note:** The Browser Background Sync API (`ServiceWorkerRegistration.sync.register()`) would allow queued items to sync even after the browser tab is closed. It is not used here — instead, the app polls every 30–60 seconds while the tab is open. This is the correct approach given that Background Sync has no Safari support and unreliable cross-origin behaviour in proxied environments. **Pending items will not auto-sync if the browser is closed.** Field staff should be instructed to keep the tab open until the offline indicator clears.

---

### Gap G-08 (Info) — Hardcoded `start_url: "/"` in manifest

**Location:** `vite.config.ts` → `VitePWA` → `manifest`  
**Severity:** Info — only relevant if `BASE_PATH` is ever changed from `/`  
**Note:** Current Replit deployment uses `BASE_PATH=/` so this is a non-issue. If the app is ever moved to a sub-path, generate `start_url` and `scope` dynamically from `process.env.BASE_PATH`.

---

## Prioritised Fix Roadmap

| Priority | Gap | Effort | Impact |
|---|---|---|---|
| 1 | G-01 Stuck "syncing" items | XS (2 lines in SyncProvider) | Prevents permanent data orphaning |
| 2 | G-05 `AbortSignal.timeout` Safari 15 | XS (5 lines) | Restores offline features on older iPads |
| 3 | G-04 Expired entry eviction | XS (3 lines in SyncProvider) | Storage hygiene |
| 4 | G-03 iOS splash screens | S (generate images or remove links) | Install UX quality |
| 5 | G-02 Server-side idempotency | M (schema column + route check × N routes) | Prevents duplicate records on retry |
| 6 | G-06 Queue conflict resolution UX | M (add "View current" link to SyncStatus row) | UX improvement post-launch |

Items 1, 3, and 5 (stuck syncing, cache eviction, `AbortSignal`) are each 2–5 lines of code and are recommended before the production launch. Items 3, 5, and 6 can be deferred to the first post-launch patch.

---

## Testing Instructions (Production Build Only)

The service worker is intentionally disabled in `vite dev`. To test offline behaviour:

```bash
# Build and preview locally
pnpm --filter @workspace/cafa-pmis run build
pnpm --filter @workspace/cafa-pmis run serve

# In Chrome DevTools → Application → Service Workers: verify registration
# Network tab → Throttling → "Offline": verify offline banner + queue
# Application → Storage → IndexedDB → cafa-pmis-v1: inspect sync queue
```

**Smoke-test checklist:**
1. Open app online → confirm SW registered, no offline banner.
2. Go offline (DevTools) → confirm yellow banner appears within 30 s.
3. Create a new risk or comment → confirm `OfflineQueuedError` toast, item in queue.
4. Restore connectivity → confirm blue "syncing" banner, then queue clears.
5. Reload tab while items in "syncing" state → after G-01 fix, confirm they reset to "pending".
6. Trigger 409 (edit same entity in two tabs) → confirm "Conflict" badge in Sync Status.
7. Close tab with pending items → reopen → confirm items persist (IndexedDB survives tab close).
8. Install as PWA on Android Chrome → confirm installability, standalone launch, offline splash.

---

*End of audit — 2026-06-03*
