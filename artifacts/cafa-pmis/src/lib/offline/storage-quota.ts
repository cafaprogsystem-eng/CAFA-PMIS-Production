/**
 * Browser storage quota monitoring for the offline layer.
 *
 * Uses the Storage API (navigator.storage.estimate) to measure how much of
 * the browser's origin storage budget has been consumed by Dexie (IndexedDB)
 * and the Workbox service worker cache combined.
 *
 * Called from SyncContext alongside prefetchCriticalData so it runs:
 *  - On mount (if authenticated)
 *  - After coming back online
 *
 * Rate-limited to once per hour so it does not interfere with sync performance.
 * All errors are silently swallowed — quota monitoring is purely advisory.
 */

import { toast } from "sonner";

const WARN_THRESHOLD  = 0.80; // 80 % → warning
const CRIT_THRESHOLD  = 0.95; // 95 % → error
const CHECK_INTERVAL_MS = 60 * 60 * 1_000; // at most once per hour

let _lastCheck = 0;

function fmt(bytes: number): string {
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(0)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

/**
 * Check IndexedDB / cache storage quota and surface a toast if usage is high.
 * Non-blocking — returns immediately; the actual check runs asynchronously.
 */
export function checkStorageQuota(): void {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return;

  const now = Date.now();
  if (now - _lastCheck < CHECK_INTERVAL_MS) return;
  _lastCheck = now;

  navigator.storage.estimate().then(({ usage = 0, quota = 0 }) => {
    if (quota === 0) return;
    const ratio = usage / quota;
    const pct   = Math.round(ratio * 100);

    if (ratio >= CRIT_THRESHOLD) {
      toast.error(
        `Storage almost full — ${fmt(usage)} of ${fmt(quota)} used (${pct}%). ` +
        `Offline data may not be saved. Clear synced records to free space.`,
        { id: "storage-critical", duration: 12_000 },
      );
    } else if (ratio >= WARN_THRESHOLD) {
      toast.warning(
        `Storage at ${pct}% — ${fmt(usage)} of ${fmt(quota)} used. ` +
        `Consider clearing synced records to maintain offline coverage.`,
        { id: "storage-warn", duration: 8_000 },
      );
    }
  }).catch(() => {
    // Quota API unavailable — silently ignore.
  });
}
