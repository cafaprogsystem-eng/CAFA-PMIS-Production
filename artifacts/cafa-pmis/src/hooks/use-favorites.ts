/* ─────────────────────────────────────────────────────────────────────────
 * CAFA PMIS – useFavorites hook
 * Manages user-scoped pinned items with cross-instance sync via
 * a CustomEvent ("cafa:favorites-updated") and cross-tab sync via
 * the storage event.
 * ────────────────────────────────────────────────────────────────────────── */

import { useState, useEffect, useCallback } from "react";
import { useGetMe } from "@workspace/api-client-react";
import {
  type FavoriteItem,
  FAV_SYNC_EVENT,
  getFavStorageKey,
  loadFavorites,
  addFavorite,
  removeFavorite,
  clearFavorites,
} from "@/lib/favorites";

export function useFavorites() {
  const { data: meData } = useGetMe();
  const userId = meData?.user?.id;

  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);

  /* ── Initial load + reload when user changes ───────────────────────── */
  useEffect(() => {
    setFavorites(loadFavorites(userId));
  }, [userId]);

  /* ── Cross-instance sync (same tab) ─────────────────────────────────── */
  useEffect(() => {
    const onUpdate = () => setFavorites(loadFavorites(userId));
    window.addEventListener(FAV_SYNC_EVENT, onUpdate);
    return () => window.removeEventListener(FAV_SYNC_EVENT, onUpdate);
  }, [userId]);

  /* ── Cross-tab sync ──────────────────────────────────────────────────── */
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (userId && e.key === getFavStorageKey(userId)) {
        setFavorites(loadFavorites(userId));
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [userId]);

  /* ── Notify all hook instances in this tab ──────────────────────────── */
  const notify = useCallback(() => {
    setFavorites(loadFavorites(userId));
    window.dispatchEvent(new CustomEvent(FAV_SYNC_EVENT));
  }, [userId]);

  /* ── Public API ─────────────────────────────────────────────────────── */

  const add = useCallback(
    (data: Omit<FavoriteItem, "id" | "pinnedAt">) => {
      if (!userId) return;
      addFavorite(userId, data);
      notify();
    },
    [userId, notify],
  );

  const remove = useCallback(
    (itemId: string) => {
      if (!userId) return;
      removeFavorite(userId, itemId);
      notify();
    },
    [userId, notify],
  );

  /** Toggle: pins if not pinned, unpins if already pinned. */
  const toggle = useCallback(
    (data: Omit<FavoriteItem, "id" | "pinnedAt">) => {
      if (!userId) return;
      const id = `${data.iconKey}:${data.path}`;
      const pinned = loadFavorites(userId).some(f => f.id === id);
      if (pinned) {
        removeFavorite(userId, id);
      } else {
        addFavorite(userId, data);
      }
      notify();
    },
    [userId, notify],
  );

  const isFavorite = useCallback(
    (itemId: string) => favorites.some(f => f.id === itemId),
    [favorites],
  );

  const clear = useCallback(() => {
    if (!userId) return;
    clearFavorites(userId);
    notify();
  }, [userId, notify]);

  return { favorites, add, remove, toggle, isFavorite, clear, userId };
}
