import { createContext, useContext, useState, useEffect, useCallback, useRef, useSyncExternalStore } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, setOfflineUser } from "@/lib/offline/db";
import { syncService, type SyncResult } from "@/lib/offline/sync-service";
import { prefetchCriticalData } from "@/lib/offline/prefetch";
import { checkStorageQuota } from "@/lib/offline/storage-quota";
import { processAllPendingAttachments } from "@/lib/offline/attachment-store";
import { toast } from "sonner";
import {
  getConnectivitySnapshot,
  recordConnectivityEvidence,
  subscribeConnectivity,
  subscribeConnectivityConfirmations,
  type ConnectivitySnapshot,
  type ConnectivityStatus,
} from "@/lib/connectivity-state";

interface SyncContextValue {
  isOnline: boolean;
  connectivityState: ConnectivityStatus;
  connectivityReason: ConnectivitySnapshot["reason"];
  isSyncing: boolean;
  pendingCount: number;
  failedCount: number;
  conflictCount: number;
  totalQueued: number;
  /** Number of attachments needing attention (pending + re-select + failed). */
  attachmentCount: number;
  triggerSync: () => Promise<void>;
  clearSynced: () => Promise<void>;
}

const SyncContext = createContext<SyncContextValue>({
  isOnline: true,
  connectivityState: "online",
  connectivityReason: "initial",
  isSyncing: false,
  pendingCount: 0,
  failedCount: 0,
  conflictCount: 0,
  totalQueued: 0,
  attachmentCount: 0,
  triggerSync: async () => {},
  clearSynced: async () => {},
});

type ProbeResult =
  | { kind: "success" }
  | { kind: "http"; status: number }
  | { kind: "transport" };

/** Probe only the same-origin CAFA service. A probe timeout is transport
 * evidence, but it needs a second independent confirmation before Offline. */
async function probeConnectivity(): Promise<ProbeResult> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 2500);
  try {
    const res = await fetch("/api/healthz", {
      method: "GET",
      cache: "no-store",
      credentials: "include",
      headers: { accept: "application/json" },
      signal: ac.signal,
    });
    return res.ok ? { kind: "success" } : { kind: "http", status: res.status };
  } catch {
    return { kind: "transport" };
  } finally {
    clearTimeout(timer);
  }
}

const PROBE_INTERVAL_MS = 30_000;
const ONLINE_PROBE_MS = 60_000;
const CHECKING_PROBE_MS = 5_000;
const CONFIRMATION_DELAY_MS = 400;

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const connectivity = useSyncExternalStore(
    subscribeConnectivity,
    getConnectivitySnapshot,
    getConnectivitySnapshot,
  );
  // `isOnline` is retained as the compatibility flag used by forms. It means
  // "not verified offline"; degraded/auth/access states must not enter the
  // offline draft or queue path.
  const isOnline = connectivity.status !== "offline";
  const [isSyncing, setIsSyncing] = useState(false);
  const syncingRef = useRef(false);
  const probeInFlightRef = useRef(false);
  const storedUserId = (() => {
    const value = window.localStorage.getItem("cafa.userId");
    const parsed = value ? Number(value) : NaN;
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  })();

  useEffect(() => {
    syncService.setUserId(storedUserId);
    void setOfflineUser(storedUserId);
  }, [storedUserId]);

  // ── G-01: Orphaned "syncing" item recovery ─────────────────────────────
  // ── G-04: Expired API cache eviction ──────────────────────────────────
  // Run once on mount — before any sync attempt.
  useEffect(() => {
    // Any item stuck in "syncing" on startup was abandoned mid-flight (browser
    // crash / force-close). Reset them to "pending" so the next sync trigger
    // retries them. The server-side idempotency middleware (x-client-id) prevents
    // double-processing even if the request was already received.
    if (storedUserId === null) return;
    db.syncQueue
      .where("syncStatus")
      .equals("syncing")
      .and((item) => item.userId === storedUserId)
      .modify({ syncStatus: "pending" })
      .then((count: number) => {
        if (count > 0)
          console.info(`[sync] Recovered ${count} orphaned sync item(s) → pending`);
      })
      .catch(() => {});

    // Remove expired API cache rows. They are silently skipped on read but
    // never automatically deleted, causing the table to grow over long sessions.
    const now = Date.now();
    db.apiCache
      .filter((e) => e.cachedAt + e.ttlSeconds * 1000 < now)
      .delete()
      .catch(() => {});
  }, [storedUserId]);

  const pendingCount = useLiveQuery(
    () => storedUserId === null ? 0 : db.syncQueue.where("syncStatus").anyOf(["pending", "syncing"]).and((item) => item.userId === storedUserId).count(),
    [storedUserId], 0
  ) ?? 0;

  const failedCount = useLiveQuery(
    () => storedUserId === null ? 0 : db.syncQueue.where("syncStatus").equals("failed").and((item) => item.userId === storedUserId).count(),
    [storedUserId], 0
  ) ?? 0;

  const conflictCount = useLiveQuery(
    () => storedUserId === null ? 0 : db.syncQueue.where("syncStatus").equals("conflict").and((item) => item.userId === storedUserId).count(),
    [storedUserId], 0
  ) ?? 0;

  const totalQueued = useLiveQuery(
    () => storedUserId === null ? 0 : db.syncQueue.where("userId").equals(storedUserId).count(),
    [storedUserId], 0
  ) ?? 0;

  const attachmentCount = useLiveQuery(
    () => storedUserId === null ? 0 : db.attachmentQueue
      .where("status")
      .anyOf(["pending", "re-select-required", "failed"])
      .and((item) => item.userId === storedUserId)
      .count(),
    [storedUserId], 0
  ) ?? 0;

  const triggerSync = useCallback(async () => {
    if (syncingRef.current) return;
    const connectivity = getConnectivitySnapshot();
    if (connectivity.status !== "online" || connectivity.accessOutcome !== null) return;
    syncingRef.current = true;
    setIsSyncing(true);
    try {
      const result: SyncResult = await syncService.processQueue();
      if (result.synced > 0 && result.failed === 0 && result.conflicts === 0) {
        toast.success(
          `${result.synced} offline change${result.synced > 1 ? "s" : ""} synced successfully`,
          { id: "sync-complete" }
        );
      } else if (result.failed > 0 || result.conflicts > 0) {
        toast.warning(
          `Synced ${result.synced} · Failed ${result.failed} · Conflicts ${result.conflicts} — check Sync Status`,
          { id: "sync-warning", duration: 6000 }
        );
      }
      // After the form queue syncs, attempt to upload any attachments that
      // still have a File in the in-memory cache.
      processAllPendingAttachments().catch(() => {});
    } finally {
      syncingRef.current = false;
      setIsSyncing(false);
    }
  }, []);

  const clearSynced = useCallback(async () => {
    await syncService.clearSynced();
  }, []);

  const confirmConnectivity = useCallback(async (): Promise<boolean> => {
    if (probeInFlightRef.current) return getConnectivitySnapshot().status === "online";
    probeInFlightRef.current = true;
    try {
      let result = await probeConnectivity();
      const record = (probe: ProbeResult) => {
        if (probe.kind === "success") {
          recordConnectivityEvidence({ kind: "probe-success" });
        } else if (probe.kind === "http") {
          recordConnectivityEvidence({ kind: "probe-http", status: probe.status });
        } else {
          recordConnectivityEvidence({ kind: "transport-failure" });
        }
      };
      record(result);

      // A single timeout/abort is not enough to claim Offline. Confirm with a
      // bounded second probe; successful traffic between attempts resets the
      // reducer's failure count.
      if (
        (result.kind === "transport" || (result.kind === "http" && result.status >= 500)) &&
        getConnectivitySnapshot().status !== "offline"
      ) {
        await new Promise((resolve) => setTimeout(resolve, CONFIRMATION_DELAY_MS));
        result = await probeConnectivity();
        record(result);
      }
      return result.kind === "success";
    } finally {
      probeInFlightRef.current = false;
    }
  }, []);

  // A failed ordinary API request only asks for a reachability confirmation.
  // It can never directly enable offline cache or draft behaviour.
  useEffect(() => subscribeConnectivityConfirmations(() => {
    void confirmConnectivity();
  }), [confirmConnectivity]);

  // Confirm real connectivity on mount, then warm the Dexie cache and
  // check storage quota so the user is alerted before the cache fills up.
  useEffect(() => {
    confirmConnectivity().then((online) => {
      if (online && getConnectivitySnapshot().status === "online" && getConnectivitySnapshot().accessOutcome === null) {
        prefetchCriticalData();
        checkStorageQuota();
      }
    });
  }, [confirmConnectivity]);

  // Handle browser online/offline events.
  useEffect(() => {
    const handleOnline = () => {
      const wasOffline = getConnectivitySnapshot().status === "offline";
      recordConnectivityEvidence({ kind: "browser-online" });
      confirmConnectivity().then((online) => {
        if (online && getConnectivitySnapshot().status === "online" && getConnectivitySnapshot().accessOutcome === null) {
          if (wasOffline) triggerSync().then(() => prefetchCriticalData());
          else prefetchCriticalData();
        }
      });
    };
    const handleOffline = () => {
      recordConnectivityEvidence({ kind: "browser-offline" });
      void confirmConnectivity();
    };
    const handleResume = () => { void confirmConnectivity(); };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("focus", handleResume);
    document.addEventListener("visibilitychange", handleResume);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("focus", handleResume);
      document.removeEventListener("visibilitychange", handleResume);
    };
  }, [confirmConnectivity, triggerSync]);

  // Periodic probe — catches cases where browser events are suppressed (e.g.
  // Replit iframe sandbox), or the network drops silently without firing events.
  // Also acts as an automatic retry mechanism for pending/failed items.
  useEffect(() => {
    const interval = setInterval(async () => {
      const wasOffline = getConnectivitySnapshot().status === "offline";
      const online = await confirmConnectivity();
      if (online && getConnectivitySnapshot().status === "online" && getConnectivitySnapshot().accessOutcome === null && wasOffline) {
        triggerSync().then(() => prefetchCriticalData());
        return;
      }

      // Only a confirmed healthy service should replay queued work.
      if (online && getConnectivitySnapshot().status === "online" && getConnectivitySnapshot().accessOutcome === null) {
        const pending = storedUserId === null ? 0 : await db.syncQueue
          .where("syncStatus").equals("pending")
          .and((item) => item.userId === storedUserId).count();
        if (pending > 0 && !syncingRef.current) {
          triggerSync();
        }
      }
    }, connectivity.status === "online"
      ? ONLINE_PROBE_MS
      : connectivity.status === "offline" ? PROBE_INTERVAL_MS : CHECKING_PROBE_MS);

    return () => clearInterval(interval);
  }, [connectivity.status, confirmConnectivity, triggerSync, storedUserId]);

  return (
    <SyncContext.Provider
      value={{
        isOnline,
        connectivityState: connectivity.status,
        connectivityReason: connectivity.reason,
        isSyncing,
        pendingCount,
        failedCount,
        conflictCount,
        totalQueued,
        attachmentCount,
        triggerSync,
        clearSynced,
      }}
    >
      {children}
    </SyncContext.Provider>
  );
}

export function useSyncContext() {
  return useContext(SyncContext);
}
