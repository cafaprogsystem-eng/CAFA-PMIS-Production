/**
 * Proactively warms the Dexie API cache so that critical data is available
 * immediately when the user goes offline.
 *
 * Called:
 *  - On SyncProvider mount (if online)
 *  - After coming back online (after sync)
 *
 * The fetch calls go through the fetch interceptor which caches every
 * successful 200 GET response in Dexie automatically.
 */

const CRITICAL_PATHS = [
  "/api/me",
  "/api/states",
  "/api/users/switcher",
  "/api/manual/chapters",
  "/api/dashboard/summary",
  "/api/dashboard/agenda",
  "/api/projects",
  "/api/plans",
  "/api/risks",
  "/api/reports",
  "/api/notifications?limit=30",
  "/api/conversations?limit=50",
];

let _lastPrefetch = 0;
const MIN_INTERVAL_MS = 5 * 60 * 1000; // Don't prefetch more than once per 5 min

export async function prefetchCriticalData(): Promise<void> {
  // Do not guard on navigator.onLine — it is unreliable in proxied environments.
  // The /api/me fetch below already handles the unauthenticated / unreachable case.
  const now = Date.now();
  if (now - _lastPrefetch < MIN_INTERVAL_MS) return;

  // Guard: only prefetch when authenticated. Check /api/me first.
  try {
    const meRes = await fetch("/api/me", { credentials: "include" });
    if (!meRes.ok) return; // Not logged in — skip prefetch
  } catch {
    return; // Network error
  }

  _lastPrefetch = now;

  // Fire-and-forget: each fetch goes through the interceptor which caches the
  // response. Stagger the requests slightly so we don't hammer the server.
  // Skip /api/me since we just fetched it above.
  const pathsToWarm = CRITICAL_PATHS.filter((p) => p !== "/api/me");
  for (let i = 0; i < pathsToWarm.length; i++) {
    const path = pathsToWarm[i];
    setTimeout(() => {
      fetch(path, { credentials: "include" }).catch(() => {});
    }, i * 150); // 150 ms apart
  }
}
