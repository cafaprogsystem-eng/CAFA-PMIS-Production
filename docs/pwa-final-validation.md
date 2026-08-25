# CAFA PMIS — PWA Final Validation Audit

**Date:** 2026-06-03  
**Auditor:** Automated code inspection across all PWA-related source files  
**Build:** `artifacts/cafa-pmis` — React 19 + Vite 7 + Workbox (vite-plugin-pwa) + Dexie 4

---

## Readiness Score

```
██████████████████████████████████████████████████ 98 / 100
```

| Severity | Count | Points deducted |
|---|---|---|
| Critical | **0** | 0 |
| High | **0** | 0 |
| Medium | **0** | 0 |
| Low | **4** | −2 |
| **Score** | | **98 / 100** |

---

## Findings Summary

### Critical Findings — 0

*None.*

---

### High Findings — 0

*None.*

---

### Medium Findings — 0

*None.*

---

### Low Findings — 4

| # | Section | Title | File |
|---|---|---|---|
| L-01 | Security | `idempotencyMiddleware` registered before `requireAuth` | `routes/index.ts:39–42` |
| L-02 | Storage Limits | Storage quota exhaustion silently ignored — no user warning | `fetch-interceptor.ts:177` |
| L-03 | Sync Engine | `handleRetryAll` uses `navigator.onLine` instead of probed state | `sync-status.tsx:488` |
| L-04 | Service Worker | SW disabled in dev (`devOptions.enabled: false`) — offline untestable without production build | `vite.config.ts:109` |

---

## Validation Sections

---

### 1 · Service Worker

**Result: PASS**

| Check | Status | Evidence |
|---|---|---|
| SW registered with `autoUpdate` strategy | ✅ | `registerType: "autoUpdate"` |
| Outdated cache cleaned on SW activation | ✅ | `cleanupOutdatedCaches: true` |
| SPA fallback for navigation requests | ✅ | `navigateFallback: "index.html"` |
| API calls excluded from navigate fallback | ✅ | `navigateFallbackDenylist: [/^\/api\//]` — matches all `/api/…` paths |
| Static asset glob covers all file types | ✅ | `**/*.{js,css,html,ico,png,svg,woff,woff2,ttf,eot}` — includes splash PNGs |
| `start_url` dynamic per deployment base | ✅ | `start_url: basePath` (env `BASE_PATH ?? "/"`) — G-08 resolved |
| `scope` dynamic per deployment base | ✅ | `scope: basePath` (env `BASE_PATH ?? "/"`) — G-08 resolved |
| SW inactive in development | ⚠️ L-04 | `devOptions.enabled: false` — requires a production build to test offline behaviour |

---

### 2 · Cache Strategy

**Result: PASS**

**Dual-layer architecture:**
- **Layer 1 — Workbox SW (safety net):** NetworkFirst for all `/api/` requests with 8 s network timeout; 24 h max-age / 200-entry cap. StaleWhileRevalidate for Google Fonts stylesheets. CacheFirst for webfonts (365-day TTL / 30 entries).
- **Layer 2 — Dexie IndexedDB (primary):** Per-endpoint TTL map, user-scoped entries, startup eviction of expired rows.

| Check | Status | Evidence |
|---|---|---|
| API responses cached for offline reads | ✅ | `setCached()` on every successful GET 200 in `fetch-interceptor.ts` |
| Per-endpoint TTL map (13 buckets) | ✅ | `states/sectors` 7 d → `notifications/messages/conversations` 3 min |
| PII / sensitive endpoints never cached | ✅ | `NEVER_CACHE_PATTERNS`: `/api/audit-log`, `/api/users($\|?)`, `/api/budget` |
| Cross-user cache isolation | ✅ | `getCached()` rejects entries where `entry.userId !== userId` |
| Expired Dexie entries evicted on mount | ✅ | G-04: startup `useEffect` deletes rows where `cachedAt + ttlSeconds * 1000 < now` |
| Workbox API entry cap enforced | ✅ | `maxEntries: 200`, `maxAgeSeconds: 86400` on `cafa-api-cache` |
| Attachment binary data excluded from IDB | ✅ | `fileCache` is an in-memory `Map<string, File>` — no binary blobs in Dexie |
| Storage quota failure | ⚠️ L-02 | `setCached` silently swallows quota errors; no user-facing storage warning |

---

### 3 · Offline Banner

**Result: PASS**

| Check | Status | Evidence |
|---|---|---|
| Banner component exists | ✅ | `src/components/offline-indicator.tsx` |
| Mounted globally inside SyncProvider | ✅ | `App.tsx:216` |
| Visible on every page | ✅ | `fixed bottom-0 inset-x-0 z-[100]` |
| State: fully offline | ✅ | Yellow banner, WifiOff icon, queue count, "View queue" link to `/sync-status` |
| State: back online + actively syncing | ✅ | Blue banner, spinning RefreshCw, pending count |
| State: online with pending items | ✅ | Amber banner, links to `/sync-status` |
| State: online with failed / conflict items | ✅ | Red banner, alert icon, links to `/sync-status` |
| State: all clear | ✅ | Returns `null` — no DOM node rendered |
| Connectivity source | ✅ | Reads `isOnline` from `SyncContext` (probe-derived, not `navigator.onLine`) |

---

### 4 · Offline Data Entry

**Result: PASS**

| Check | Status | Evidence |
|---|---|---|
| Fetch interceptor installed globally | ✅ | `main.tsx:6` — `installFetchInterceptor(getUserId)` before React renders |
| Offline mutations queued to Dexie | ✅ | `syncService.queue({method, url, body, userId})` → throws `OfflineQueuedError` |
| Offline GETs served from Dexie cache | ✅ | `getCached(url, userId)` → synthetic `Response(cached, {status:200})` |
| SW NetworkFirst fallback for uncached GETs | ✅ | Let-through to `originalFetch` → Workbox serves stale entry if network fails |
| `OfflineQueuedError` type guard exported | ✅ | `isOfflineQueuedError()` for UI error handling |
| `OfflineBlockedError` type guard exported | ✅ | `isOfflineBlockedError()` for blocking UI feedback |
| Blocked-offline rules enforced | ✅ | User CRUD, all DELETEs, final approvals, budget ops, file uploads, invite actions |
| Attachment upload blocked offline | ✅ | `queueAttachment()` records metadata; `OfflineBlockedError` thrown; user sees status in Sync Status page |
| Session forwarded on sync replay | ✅ | `credentials: "include"` on every `fetch()` in `sync-service.ts:117` |

---

### 5 · Sync Engine

**Result: PASS**

| Check | Status | Evidence |
|---|---|---|
| G-01 — Orphaned `"syncing"` recovery | ✅ | `sync-context.tsx:77–85` — mount `useEffect` resets `syncing` → `pending`; logs recovered count |
| FIFO processing order | ✅ | `processQueue()` uses `.sortBy("createdAt")` |
| Concurrent sync guard (double-locked) | ✅ | `_running` flag in `SyncService` + `syncingRef.current` in context |
| Idempotency key on every replay | ✅ | `"x-client-id": item.clientId` header in `sync-service.ts:113` |
| HTTP 409 → `"conflict"` status | ✅ | `sync-service.ts:118–122` |
| Retry with counter; max 3 then `"failed"` | ✅ | `sync-service.ts:130–134` |
| Manual retry resets counter to 0 | ✅ | `retryItem()` sets `{syncStatus:"pending", retryCount:0, lastError:null}` |
| Discard permanently deletes item | ✅ | `discardItem()` — `db.syncQueue.delete(id)` |
| Periodic probe: 30 s offline / 60 s online | ✅ | `PROBE_INTERVAL_MS = 30_000`, `ONLINE_PROBE_MS = 60_000` |
| Auto-sync on browser `online` event | ✅ | `handleOnline` probes then calls `triggerSync()` |
| Auto-sync when probe detects reconnection | ✅ | `if (online && !wasOnline) triggerSync()` in interval handler |
| Pending items retried on every online interval | ✅ | `if (pending > 0 && !syncingRef.current) triggerSync()` |
| Attachment uploads triggered after form sync | ✅ | `processAllPendingAttachments()` called at `sync-context.tsx:148` |
| `clearSynced()` exposed to UI | ✅ | Context value + "Clear Synced" button in Sync Status page |
| `handleRetryAll` connectivity check | ⚠️ L-03 | Uses `navigator.onLine` (line 488) instead of probed `isOnline`; `triggerSync()` re-probes internally so impact is at most a 30 s delay |

---

### 6 · Multi-user Updates

**Result: PASS**

| Check | Status | Evidence |
|---|---|---|
| DB-backed idempotency log | ✅ | `idempotency_log` table — survives server restarts, scales to multi-process |
| Duplicate mutation prevention | ✅ | `ON CONFLICT (client_id) DO NOTHING`; replays original response |
| Idempotency TTL | ✅ | 24 h; `pruneExpired()` runs on startup then hourly via `setInterval` |
| Applies to POST / PUT / PATCH only | ✅ | `IDEMPOTENT_METHODS = new Set(["POST","PUT","PATCH"])` |
| DB unavailable degrades gracefully | ✅ | Catch block calls `next()` — handler runs normally; no crash |
| idempotency middleware ordering | ⚠️ L-01 | `routes/index.ts:39` before `requireAuth` at `:42` — replay path skips auth; UUID v4 entropy (122 bits) makes exploitation infeasible |
| Cross-user Dexie cache isolation | ✅ | `getCached()` compares `entry.userId !== userId` and rejects mismatches |
| All offline data cleared on logout | ✅ | `layout.tsx:164` calls `clearOfflineData()` — wipes syncQueue + apiCache + attachmentQueue |

---

### 7 · Mobile PWA

**Result: PASS**

| Check | Status | Evidence |
|---|---|---|
| `display: "standalone"` | ✅ | `vite.config.ts:36` |
| `orientation: "any"` | ✅ | `vite.config.ts:37` |
| `theme_color` matches brand | ✅ | `"#1a2744"` in manifest + `<meta name="theme-color">` in `index.html` |
| `background_color` set | ✅ | `"#ffffff"` |
| Icon ladder complete | ✅ | 72, 96, 128, 144, 152, 192, 384, 512 px PNG + SVG `any` |
| Maskable icons declared | ✅ | 192 and 512 with `purpose: "any maskable"` |
| Apple touch icons declared | ✅ | 72, 96, 128, 144, 152, 167→180, 180 px in `<head>` |
| `apple-mobile-web-app-capable` | ✅ | `index.html:16` |
| `apple-mobile-web-app-status-bar-style` | ✅ | `"black-translucent"` — full-bleed content under status bar |
| `viewport-fit=cover` | ✅ | `index.html:5` — safe-area insets honoured |
| iOS splash — iPhone 15 Pro Max | ✅ | `1290×2796` @ `430×932 @3x` — 46 KB PNG |
| iOS splash — iPhone 15 / 14 | ✅ | `1170×2532` @ `390×844 @3x` — 44 KB PNG |
| iOS splash — iPhone 13 mini | ✅ | `1125×2436` @ `375×812 @3x` — 43 KB PNG |
| iOS splash — iPhone SE (3rd gen) | ✅ | `750×1334` @ `375×667 @2x` — 34 KB PNG |
| iOS splash — iPad Pro 12.9" | ✅ | `2048×2732` @ `1024×1366 @2x` — 54 KB PNG |
| iOS splash — iPad Air / Pro 11" | ✅ | `1640×2360` @ `820×1180 @2x` — 46 KB PNG |
| Manifest screenshots (rich install UI) | ✅ | `opengraph.jpg` wide (1200×630) + `screenshot-mobile.jpg` narrow (390×844) — both present |
| Windows tile metadata | ✅ | `msapplication-TileColor` + `msapplication-TileImage` (icon-144) |
| `msapplication-tap-highlight` disabled | ✅ | `"no"` — removes tap flash on Windows Phone |
| `format-detection: telephone=no` | ✅ | Prevents iOS auto-linking phone numbers in project codes |

---

### 8 · Safari Compatibility

**Result: PASS**

| Check | Status | Evidence |
|---|---|---|
| G-05 — `AbortSignal.timeout()` replaced | ✅ | `probeConnectivity()` uses `AbortController + setTimeout` — Safari 11.1+ compatible |
| Dexie / IndexedDB Safari support | ✅ | IndexedDB available Safari 7+; Dexie 4 fully compatible |
| Splash images in PNG (not WebP) | ✅ | All 6 splash files are `.png` — WebP has no splash support in Safari |
| Apple meta tags present | ✅ | `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, title |
| `viewport-fit=cover` for notch support | ✅ | Required for iPhone X+ safe-area rendering |
| Font loading strategy | ✅ | Google Fonts via `<link>` + SW `StaleWhileRevalidate`; no `font-display: optional` cache issues |
| `crypto.randomUUID()` | ✅ | Available Safari 15.4+ — matches minimum browser target |
| No SharedArrayBuffer / Web Workers in sync path | ✅ | All sync logic is main-thread; no Safari-specific restrictions apply |
| `useLiveQuery` Dexie hooks | ✅ | Uses IndexedDB events; no exotic APIs |

---

### 9 · Storage Limits

**Result: PASS**

| Check | Status | Evidence |
|---|---|---|
| Binary file data excluded from IndexedDB | ✅ | `fileCache` is `Map<string, File>` in memory; Dexie holds metadata only |
| File reference loss handled gracefully | ✅ | Page reload → `status: "re-select-required"` with user-visible hint in Sync Status |
| Workbox API cache entry cap | ✅ | `maxEntries: 200`, `maxAgeSeconds: 86400` on `cafa-api-cache` |
| Expired Dexie rows purged on mount | ✅ | G-04: deletes where `cachedAt + ttlSeconds * 1000 < Date.now()` |
| High-churn endpoints use short TTLs | ✅ | notifications / conversations / messages: 3 min; dashboard: 5 min |
| Large / sensitive payloads excluded | ✅ | `NEVER_CACHE_PATTERNS`: audit-log, full user list, budget |
| All local data cleared on logout | ✅ | `clearOfflineData()` wipes syncQueue + apiCache + attachmentQueue |
| Proactive storage quota monitoring | ⚠️ L-02 | `navigator.storage.estimate()` not called; `setCached` silently discards writes on quota exhaustion — user receives no warning |

---

### 10 · Security

**Result: PASS**

| Check | Status | Evidence |
|---|---|---|
| Session cookie `httpOnly: true` | ✅ | `lib/session.ts:19` |
| Session cookie `sameSite: "lax"` | ✅ | `lib/session.ts:20` |
| Session cookie `secure: IS_PROD` | ✅ | `lib/session.ts:22` — HTTPS-only in production |
| `SESSION_SECRET` sourced from env | ✅ | `app.ts:23` logs a loud warning when secret is absent |
| `requireAuth` applied globally | ✅ | `routes/index.ts:42` — precedes all resource routers |
| PII endpoints excluded from Dexie cache | ✅ | `/api/users($\|?)` regex — bare list and query-string variants excluded |
| Sensitive mutations blocked offline | ✅ | `BLOCKED_OFFLINE` rules: user CRUD, all DELETEs, final approvals, budget ops, invite management |
| Session cookie forwarded on sync replay | ✅ | `credentials: "include"` on every fetch in `sync-service.ts` |
| Cross-user data leak prevention | ✅ | `getCached()` rejects mismatched `userId`; `clearOfflineData()` on logout |
| Idempotency replay bypasses `requireAuth` | ⚠️ L-01 | `idempotencyMiddleware` at line 39, `requireAuth` at line 42 — a caller with a known `x-client-id` gets a replayed response without authentication. UUID v4 (122-bit entropy) makes guessing infeasible within the 24 h window. **Fix:** move idempotency middleware after `requireAuth`. |

---

### 11 · Performance

**Result: PASS**

| Check | Status | Evidence |
|---|---|---|
| Critical data prefetched on mount | ✅ | `prefetchCriticalData()` warms 11 endpoints staggered 150 ms apart |
| Prefetch gated on authentication | ✅ | Checks `/api/me` first; aborts on 401 |
| Prefetch rate-limited | ✅ | `MIN_INTERVAL_MS = 5 min` — no stampede on repeated reconnections |
| Prefetch triggered after reconnect | ✅ | Called after `triggerSync()` completes in both the browser event and periodic probe paths |
| Workbox outdated cache pruned | ✅ | `cleanupOutdatedCaches: true` |
| Google Fonts — stylesheet strategy | ✅ | `StaleWhileRevalidate` — fast paint, background revalidation |
| Google Fonts — webfont strategy | ✅ | `CacheFirst`, 365-day TTL, 30-entry cap |
| Reactive Dexie state (no polling) | ✅ | `useLiveQuery` hooks — push-based updates, zero `setInterval` for UI sync state |
| React deduplication | ✅ | `resolve.dedupe: ["react","react-dom"]` in Vite config |
| `handleRetryAll` connectivity check | ⚠️ L-03 | `navigator.onLine` (line 488) — may skip `triggerSync()` in proxied envs; `triggerSync` re-probes internally so worst case is a 30 s automatic retry delay |

---

## Low Finding Details

### L-01 · `idempotencyMiddleware` registered before `requireAuth`

**File:** `artifacts/api-server/src/routes/index.ts` lines 39 and 42  
**Risk:** An unauthenticated HTTP request carrying a known `x-client-id` UUID would have its cached response replayed without the caller being authenticated. `requireAuth` is bypassed for the replay path.  
**Exploitability:** Negligible. UUID v4 provides 122 bits of random entropy. Brute-forcing a valid unexpired UUID within its 24 h window is computationally infeasible. No new data is disclosed — only a previously computed response body is replayed.  
**Fix:** Move `router.use(idempotencyMiddleware)` to after `router.use(requireAuth)`. Replayed responses will still be served; unauthenticated callers will hit the 401 gate first.

---

### L-02 · Silent storage quota failure with no user warning

**File:** `artifacts/cafa-pmis/src/lib/offline/fetch-interceptor.ts` line 177  
**Risk:** When the browser's IndexedDB quota is exhausted, `setCached` silently catches the error and returns. The user continues working with the belief that data is cached offline, when in fact new responses stop being recorded.  
**Fix:** Add a `navigator.storage.estimate()` call in `prefetchCriticalData()` and emit a `toast.warning()` when usage exceeds 80% of the available quota.

---

### L-03 · `handleRetryAll` uses `navigator.onLine` instead of probed state

**File:** `artifacts/cafa-pmis/src/pages/sync-status.tsx` line 488  
**Risk:** In Replit's proxied iframe sandbox `navigator.onLine` can return `false` even when the server is fully reachable. If it does, the `triggerSync()` call is skipped. The 30 s periodic probe will auto-trigger sync anyway.  
**Actual impact:** At most a 30 s delay on manual "Retry All". `triggerSync()` itself calls `probeConnectivity()` as its first action, so a false-positive `true` does not cause an incorrect sync attempt.  
**Fix:** Replace `if (navigator.onLine)` with `if (isOnline)` from `useSyncContext()`.

---

### L-04 · Service worker disabled during development

**File:** `artifacts/cafa-pmis/vite.config.ts` line 109  
**Risk:** `devOptions.enabled: false` means Workbox strategies (NetworkFirst fallback, navigateFallback, cache expiry) are inactive during `pnpm dev`. Offline regression testing requires `pnpm build && pnpm preview`.  
**Accepted trade-off:** SW in dev causes cache confusion and complicates hot-module reload. This is a well-established Vite PWA pattern.  
**Fix:** Document in developer onboarding; add a pre-release offline smoke-test checklist step.

---

## Final Verdict

```
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║          ✅  PRODUCTION READY  —  98 / 100                  ║
║                                                              ║
║  Critical: 0   High: 0   Medium: 0   Low: 4                 ║
║                                                              ║
║  All 8 audit gaps (G-01 – G-08) resolved.                   ║
║  Four low-severity observations remain; none block           ║
║  production deployment.                                      ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
```

| Gap | Description | Status |
|---|---|---|
| G-01 | Orphaned `"syncing"` recovery on app startup | ✅ RESOLVED |
| G-02 | Server-side idempotency — DB-backed, 24 h TTL | ✅ CONFIRMED (pre-existing) |
| G-03 | iOS splash screens — 6 devices, pixel-accurate PNGs | ✅ RESOLVED |
| G-04 | Expired Dexie cache eviction on mount | ✅ RESOLVED |
| G-05 | `AbortSignal.timeout()` → `AbortController + setTimeout` | ✅ RESOLVED |
| G-06 | Conflict detail panel with live server-state fetch and field diff | ✅ RESOLVED |
| G-07 | No hardcoded URLs in polling or sync paths | ✅ CONFIRMED |
| G-08 | `start_url` and `scope` use `BASE_PATH` env var | ✅ RESOLVED |
