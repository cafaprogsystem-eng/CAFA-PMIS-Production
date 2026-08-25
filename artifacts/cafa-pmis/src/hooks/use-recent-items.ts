/* ─────────────────────────────────────────────────────────────────────────
 * CAFA PMIS – useRecentItems hook
 * Manages user-scoped recent history with cross-instance sync via
 * a CustomEvent ("cafa:recent-updated") and cross-tab sync via the
 * storage event.  All state is local to this hook but stays in sync
 * across every component that calls it within the same tab/page.
 * ────────────────────────────────────────────────────────────────────────── */

import { useState, useEffect, useCallback } from "react";
import { useGetMe } from "@workspace/api-client-react";
import {
  type RecentItem,
  loadItems,
  recordItem,
  removeItem,
  clearItems,
  getStorageKey,
} from "@/lib/recent-items";

const SYNC_EVENT = "cafa:recent-updated";

export function useRecentItems() {
  const { data: meData } = useGetMe();
  const userId = meData?.user?.id;

  const [items, setItems] = useState<RecentItem[]>([]);

  /* ── Initial load + reload when user changes ────────────────────────── */
  useEffect(() => {
    setItems(loadItems(userId));
  }, [userId]);

  /* ── Cross-instance sync (same tab) ─────────────────────────────────── */
  useEffect(() => {
    const onUpdate = () => setItems(loadItems(userId));
    window.addEventListener(SYNC_EVENT, onUpdate);
    return () => window.removeEventListener(SYNC_EVENT, onUpdate);
  }, [userId]);

  /* ── Cross-tab sync ──────────────────────────────────────────────────── */
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (userId && e.key === getStorageKey(userId)) {
        setItems(loadItems(userId));
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [userId]);

  /* ── Notify all hook instances in this tab ──────────────────────────── */
  const notify = useCallback(() => {
    setItems(loadItems(userId));
    window.dispatchEvent(new CustomEvent(SYNC_EVENT));
  }, [userId]);

  /* ── Public API ─────────────────────────────────────────────────────── */
  const record = useCallback(
    (data: Omit<RecentItem, "id" | "ts">) => {
      if (!userId) return;
      recordItem(userId, data);
      notify();
    },
    [userId, notify]
  );

  const remove = useCallback(
    (itemId: string) => {
      if (!userId) return;
      removeItem(userId, itemId);
      notify();
    },
    [userId, notify]
  );

  const clear = useCallback(() => {
    if (!userId) return;
    clearItems(userId);
    notify();
  }, [userId, notify]);

  return { items, record, remove, clear, userId };
}
