/**
 * Proactively warms the Dexie API cache so that critical data is available
 * immediately when the user goes offline.
 *
 * Called:
 *  - After the authenticated SyncProvider has mounted and connectivity is
 *    confirmed
 *  - After coming back online (after sync)
 *
 * The fetch calls go through the fetch interceptor which caches every
 * successful 200 GET response in Dexie automatically.
 */

const CRITICAL_PATHS = [
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
let prefetchGeneration = 0;
const activePrefetches = new Set<AbortController>();
const scheduledPrefetches = new Set<ReturnType<typeof setTimeout>>();

/**
 * Stop delayed and in-flight warmups when the authenticated shell goes away.
 * A timer can otherwise outlive a logout and issue staff requests in the
 * public shell.
 */
export function cancelCriticalPrefetch(): void {
  prefetchGeneration += 1;
  _lastPrefetch = 0;
  for (const timer of scheduledPrefetches) clearTimeout(timer);
  scheduledPrefetches.clear();
  for (const controller of activePrefetches) controller.abort();
  activePrefetches.clear();
}

export async function prefetchCriticalData(): Promise<void> {
  // This function is only called from the authenticated SyncProvider. AuthGate
  // is the single session decision; do not issue another /api/me guard here.
  const now = Date.now();
  if (now - _lastPrefetch < MIN_INTERVAL_MS) return;

  _lastPrefetch = now;
  const generation = prefetchGeneration;
  const controller = new AbortController();
  activePrefetches.add(controller);

  // Fire-and-forget: each fetch goes through the interceptor which caches the
  // response. Stagger the requests slightly so we don't hammer the server.
  let remaining = CRITICAL_PATHS.length;
  const settle = () => {
    remaining -= 1;
    if (remaining <= 0) activePrefetches.delete(controller);
  };
  for (let i = 0; i < CRITICAL_PATHS.length; i++) {
    const path = CRITICAL_PATHS[i];
    const timer = setTimeout(() => {
      scheduledPrefetches.delete(timer);
      if (generation !== prefetchGeneration || controller.signal.aborted) {
        settle();
        return;
      }
      fetch(path, { credentials: "include", signal: controller.signal })
        .catch(() => {})
        .finally(settle);
    }, i * 150); // 150 ms apart
    scheduledPrefetches.add(timer);
  }
}
